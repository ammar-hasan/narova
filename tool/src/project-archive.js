'use strict';
/* Shareable Narova projects (CHANGE-2026-031).
 *
 * The .narova boundary is intentionally small: deterministic stored ZIPs,
 * one digest manifest, complete verification before staged extraction, and no
 * config loading while opening or remixing untrusted content. */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { builtinModules } = require('module');
const { CANDIDATES } = require('./config');
const { fingerprint } = require('./creative-identity');
const { validateLock } = require('./asset-registry');

const FORMAT = 'narova.project/1';
const MANIFEST_PATH = 'narova.archive.json';
const REMIX_PATH = '.narova-remix.json';
const NORMALIZED_TIME = '1980-01-01T00:00:00.000Z';
const MAX_MEMBER_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_FETCH_BYTES = 256 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_MEMBERS = 10_000;
const MAX_ARCHIVE_BYTES = MAX_TOTAL_BYTES + MAX_MANIFEST_BYTES + ((MAX_MEMBERS + 1) * 128);
const EXCLUDED_DIRS = new Set(['.git', '.venv', 'node_modules', 'out']);
const EXCLUDED_FILES = new Set([
  '.DS_Store', '.audio-fingerprint', '.timings-fingerprint',
  'creative-identity.json', 'revisions.jsonl',
]);
const SECRET_PATH_RE = /(?:^|\/|[._-])(?:\.env|credential|private[-_]?key|secret|token|api[-_]?key)(?=\/|[._-]|$)/i;
const SECRET_ENV_RE = /(?:api[-_]?key|authorization|credential|password|secret|token)/i;
const CREDENTIAL_FILE_RE = /(?:^|\/)(?:\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.netrc|\.git-credentials|\.docker\/config\.json|\.aws\/(?:credentials|config)|application_default_credentials\.json|service[-_]?account[^/]*\.json|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)$/i;
const CREDENTIAL_ASSIGNMENT_RE = /(?:_authToken|access[-_]?key(?:[-_]?id)?|api[-_]?key|authorization|client[-_]?secret|password|private[-_]?key|secret|token)\s*["']?\s*[:=]\s*["']?[^\s"']{4,}/i;
const BUILTIN_MODULES = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const slash = value => value.split(path.sep).join('/');
const comparePath = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const aliasKey = value => value.normalize('NFC').toLowerCase();
const excludedName = (set, value) => [...set].some(name => aliasKey(name) === aliasKey(value));
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const WINDOWS_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const diagnosticValue = value => JSON.stringify(String(value));

function safeMetadataString(value, label) {
  if (typeof value !== 'string' || !value || CONTROL_RE.test(value)) {
    throw new Error(`${label} must be a non-empty string without control characters`);
  }
  return value;
}

function decodeUtf8(bytes, label) {
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) throw new Error(`${label} is not valid UTF-8`);
  return value;
}

function safeMemberPath(value) {
  if (typeof value !== 'string' || !value || CONTROL_RE.test(value) || value.includes('\\')) {
    throw new Error(`archive member has an invalid path: ${JSON.stringify(value)}`);
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`archive member path is absolute: ${value}`);
  }
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`archive member path escapes its project: ${value}`);
  }
  for (const part of parts) {
    if (Buffer.byteLength(part, 'utf8') > 255) {
      throw new Error(`archive member path component exceeds the 255-byte portability bound: ${value}`);
    }
    if (/[<>:"|?*]/.test(part) || /[ .]$/.test(part) || WINDOWS_DEVICE_RE.test(part)) {
      throw new Error(`archive member path is not portable across supported filesystems: ${value}`);
    }
  }
  if (Buffer.byteLength(value, 'utf8') > 4096) throw new Error(`archive member path exceeds the 4096-byte portability bound: ${value}`);
  return parts.join('/');
}

function secretValues(env = process.env) {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_ENV_RE.test(name) && typeof value === 'string' && value.length >= 4)
    .map(([, value]) => Buffer.from(value));
}

function assertNoSecret(rel, data, secrets) {
  if (SECRET_PATH_RE.test(rel) || CREDENTIAL_FILE_RE.test(rel) || /(?:^|\/)\.env(?:\.|$)/i.test(rel)) {
    throw new Error(`refusing to pack secret-shaped project file: ${rel}`);
  }
  const text = data.toString('utf8');
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    throw new Error(`refusing to pack private-key material from ${rel}`);
  }
  if (CREDENTIAL_ASSIGNMENT_RE.test(text)) throw new Error(`refusing to pack credential-shaped content from ${rel}`);
  for (const secret of secrets) {
    if (data.includes(secret)) throw new Error(`refusing to pack an environment credential found in ${rel}`);
  }
}

function assertPortablePaths(paths, label = 'archive') {
  const files = new Set();
  const parents = new Set();
  for (const value of paths) {
    const rel = safeMemberPath(value);
    const key = aliasKey(rel);
    if (files.has(key)) throw new Error(`${label} contains filesystem-aliasing paths: ${rel}`);
    if (parents.has(key)) throw new Error(`${label} contains a file/directory prefix conflict: ${rel}`);
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/');
      if (files.has(parent)) throw new Error(`${label} contains a file/directory prefix conflict: ${rel}`);
      parents.add(parent);
    }
    files.add(key);
  }
}

function roleFor(rel, configName) {
  if (rel === configName) return 'authoring-config';
  if (rel === 'creative-brief.md') return 'creative-brief';
  if (/^claims\.md$/i.test(rel)) return 'claims-ledger';
  if (rel === 'creative.md') return 'creative-rationale';
  if (rel === 'assets.lock.json') return 'asset-registry';
  if (rel === REMIX_PATH) return 'remix-lineage';
  if (rel.startsWith('assets/')) return 'asset';
  if (/\.(?:js|cjs|mjs|json|css|html|svg)$/i.test(rel)) return 'authored-module';
  return 'project-file';
}

function collectProjectFiles(projectDir, opts = {}) {
  const root = fs.realpathSync(path.resolve(projectDir));
  const configNames = CANDIDATES.filter(name => {
    try { return fs.lstatSync(path.join(root, name)).isFile(); } catch { return false; }
  });
  if (configNames.length !== 1) {
    throw new Error(`project must contain exactly one root config (${CANDIDATES.join('|')})`);
  }
  const secrets = opts.scanSecrets === false ? [] : secretValues(opts.env);
  const files = [];
  function visit(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => comparePath(a.name, b.name));
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excludedName(EXCLUDED_DIRS, entry.name)) continue;
      if (entry.isSymbolicLink()) throw new Error(`project contains a symbolic link: ${rel}`);
      if (entry.isDirectory()) {
        visit(path.join(dir, entry.name), rel);
        continue;
      }
      if (!entry.isFile()) throw new Error(`project contains a non-regular file: ${rel}`);
      if (excludedName(EXCLUDED_FILES, entry.name) || entry.name.toLowerCase().endsWith('.narova')) continue;
      const normalized = safeMemberPath(rel);
      const data = fs.readFileSync(path.join(dir, entry.name));
      if (data.length > MAX_MEMBER_BYTES) throw new Error(`project member exceeds ${MAX_MEMBER_BYTES} bytes: ${normalized}`);
      assertNoSecret(normalized, data, secrets);
      files.push({ path: normalized, data, role: roleFor(normalized, configNames[0]) });
    }
  }
  visit(root);
  const total = files.reduce((sum, item) => sum + item.data.length, 0);
  if (files.length > MAX_MEMBERS) throw new Error(`project has more than ${MAX_MEMBERS} packable files`);
  if (total > MAX_TOTAL_BYTES) throw new Error(`project exceeds the ${MAX_TOTAL_BYTES}-byte archive expansion bound`);
  assertPortablePaths(files.map(item => item.path), 'project');
  return { root, configName: configNames[0], files, total };
}

let crcTable;
function crc32(data) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(safeMemberPath(entry.path));
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const record = Buffer.concat([header, name, data]);
    local.push(record);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    offset += record.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

function findEnd(buffer) {
  const floor = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= floor; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('not a supported ZIP archive (end record missing)');
}

function parseZip(buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length > (opts.maxArchiveBytes || MAX_ARCHIVE_BYTES)) throw new Error('archive exceeds the compressed-byte bound');
  const endAt = findEnd(buffer);
  const disk = buffer.readUInt16LE(endAt + 4);
  const centralDisk = buffer.readUInt16LE(endAt + 6);
  const diskCount = buffer.readUInt16LE(endAt + 8);
  const count = buffer.readUInt16LE(endAt + 10);
  const cdSize = buffer.readUInt32LE(endAt + 12);
  const cdOffset = buffer.readUInt32LE(endAt + 16);
  const commentLength = buffer.readUInt16LE(endAt + 20);
  if (disk !== 0 || centralDisk !== 0 || diskCount !== count || count > MAX_MEMBERS + 1
      || cdOffset + cdSize !== endAt || endAt + 22 + commentLength !== buffer.length) {
    throw new Error('ZIP central directory or end record is invalid, unsupported, or exceeds bounds');
  }
  let cursor = cdOffset;
  let total = 0;
  const entries = [];
  const names = new Set();
  const aliases = new Set();
  const parentAliases = new Set();
  const directoryAliases = new Set();
  const localRanges = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP central directory entry is invalid');
    const madeBy = buffer.readUInt16LE(cursor + 4) >>> 8;
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressed = buffer.readUInt32LE(cursor + 20);
    const bytes = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const external = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    if (flags & 1) throw new Error('encrypted ZIP members are not supported');
    if (![0, 8].includes(method)) throw new Error(`unsupported ZIP compression method ${method}`);
    const rawNameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLen);
    const rawName = decodeUtf8(rawNameBytes, 'ZIP member name');
    const directory = rawName.endsWith('/');
    const name = safeMemberPath(directory ? rawName.slice(0, -1) : rawName);
    const alias = aliasKey(name);
    if (directory) {
      if (!opts.allowDirectories) throw new Error(`explicit ZIP directory members are not supported: ${name}`);
      if (aliases.has(alias) || directoryAliases.has(alias)) throw new Error(`filesystem-aliasing ZIP member: ${name}`);
      directoryAliases.add(alias);
    } else {
      if (names.has(name)) throw new Error(`duplicate ZIP member: ${name}`);
      if (aliases.has(alias) || directoryAliases.has(alias) || parentAliases.has(alias)) throw new Error(`filesystem-aliasing ZIP member: ${name}`);
      const parts = alias.split('/');
      for (let part = 1; part < parts.length; part++) {
        const parent = parts.slice(0, part).join('/');
        if (aliases.has(parent)) throw new Error(`ZIP member has a file/directory prefix conflict: ${name}`);
        parentAliases.add(parent);
      }
      names.add(name);
      aliases.add(alias);
    }
    const mode = madeBy === 3 ? (external >>> 16) & 0xffff : 0;
    if (flags & ~0x080e) throw new Error(`ZIP member uses unsupported flags: ${name}`);
    if ((mode & 0o170000) === 0o120000) throw new Error(`ZIP symbolic link is forbidden: ${name}`);
    if (mode && ![0o040000, 0o100000].includes(mode & 0o170000)) throw new Error(`ZIP non-regular member is forbidden: ${name}`);
    if (bytes > MAX_MEMBER_BYTES) throw new Error(`ZIP member exceeds the byte bound: ${name}`);
    total += directory || name === MANIFEST_PATH ? 0 : bytes;
    if (total > (opts.maxTotalBytes || MAX_TOTAL_BYTES)) throw new Error('ZIP exceeds the total expansion bound');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP local header is invalid: ${name}`);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressed = buffer.readUInt32LE(localOffset + 18);
    const localBytes = buffer.readUInt32LE(localOffset + 22);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const localName = decodeUtf8(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLen), 'ZIP local member name');
    const deferredSizes = Boolean(flags & 0x0008);
    const sizesMatch = deferredSizes
      ? [localCrc, localCompressed, localBytes].every((value, index) => value === 0 || value === [crc, compressed, bytes][index])
      : localCrc === crc && localCompressed === compressed && localBytes === bytes;
    if (localFlags !== flags || localMethod !== method || localName !== rawName || !sizesMatch) {
      throw new Error(`ZIP local header does not match its central entry: ${name}`);
    }
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart > cdOffset) throw new Error(`ZIP local record overlaps the central directory: ${name}`);
    let recordEnd = dataStart + compressed;
    if (recordEnd > cdOffset) throw new Error(`ZIP member data is truncated or overlaps the central directory: ${name}`);
    if (directory) {
      if (compressed !== 0 || bytes !== 0 || crc !== 0) throw new Error(`ZIP directory member carries data: ${name}`);
      if (deferredSizes) throw new Error(`ZIP directory member uses an unsupported data descriptor: ${name}`);
    } else {
      const packed = buffer.subarray(dataStart, recordEnd);
      let data;
      try { data = method === 0 ? Buffer.from(packed) : zlib.inflateRawSync(packed, { maxOutputLength: Math.min(bytes + 1, MAX_MEMBER_BYTES + 1) }); }
      catch (error) { throw new Error(`ZIP member cannot be decompressed: ${name} (${error.message})`); }
      if (data.length !== bytes) throw new Error(`ZIP member size mismatch: ${name}`);
      if (crc32(data) !== crc) throw new Error(`ZIP member checksum mismatch: ${name}`);
      if (deferredSizes) {
        let descriptor = recordEnd;
        if (descriptor + 4 <= buffer.length && buffer.readUInt32LE(descriptor) === 0x08074b50) descriptor += 4;
        if (descriptor + 12 > cdOffset
            || buffer.readUInt32LE(descriptor) !== crc
            || buffer.readUInt32LE(descriptor + 4) !== compressed
            || buffer.readUInt32LE(descriptor + 8) !== bytes) {
          throw new Error(`ZIP data descriptor does not match its central entry: ${name}`);
        }
        recordEnd = descriptor + 12;
      }
      entries.push({ path: name, data, bytes, compressed, method, mode });
    }
    localRanges.push({ start: localOffset, end: recordEnd, name });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  if (cursor !== cdOffset + cdSize) throw new Error('ZIP central directory length does not match');
  localRanges.sort((a, b) => a.start - b.start);
  let covered = 0;
  for (const range of localRanges) {
    if (range.start !== covered) throw new Error(`ZIP has overlapping or unaccounted payload bytes before ${range.name}`);
    covered = range.end;
  }
  if (covered !== cdOffset) throw new Error('ZIP has unaccounted payload bytes before the central directory');
  return entries;
}

function validateManifest(value, zipEntries) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('archive manifest must be an object');
  if (typeof value.format !== 'string') throw new Error('archive manifest format is missing');
  safeMetadataString(value.format, 'archive manifest format');
  const match = value.format.match(/^narova\.project\/(\d+)$/);
  if (!match || Number(match[1]) !== 1) throw new Error('unsupported Narova archive version');
  if (value.container !== 'zip') throw new Error('archive manifest container must be zip');
  if (!value.packer || typeof value.packer !== 'object') throw new Error('archive manifest packer is missing');
  safeMetadataString(value.packer.product, 'archive manifest packer product');
  safeMetadataString(value.packer.version, 'archive manifest packer version');
  if (!value.source || typeof value.source !== 'object') throw new Error('archive manifest source is missing');
  safeMetadataString(value.source.title, 'archive manifest source title');
  if (value.source.creativeIdentity != null && !/^[a-f0-9]{64}$/.test(value.source.creativeIdentity)) {
    throw new Error('archive manifest creative identity must be a lowercase SHA-256 digest or null');
  }
  if (value.packedAt !== NORMALIZED_TIME) throw new Error(`archive manifest packedAt must be ${NORMALIZED_TIME}`);
  if (!Array.isArray(value.members) || value.members.length > MAX_MEMBERS) throw new Error('archive manifest members are invalid');
  const byName = new Map(zipEntries.map(entry => [entry.path, entry]));
  const expected = new Set([MANIFEST_PATH]);
  let total = 0;
  for (const member of value.members) {
    const memberPath = safeMemberPath(member && member.path);
    if (memberPath === MANIFEST_PATH || expected.has(memberPath)) throw new Error(`duplicate archive manifest member: ${memberPath}`);
    if (!Number.isSafeInteger(member.bytes) || member.bytes < 0 || member.bytes > MAX_MEMBER_BYTES) throw new Error(`invalid declared size for ${memberPath}`);
    if (!/^[a-f0-9]{64}$/.test(member.sha256 || '')) throw new Error(`invalid digest for ${memberPath}`);
    safeMetadataString(member.role, `archive manifest role for ${memberPath}`);
    const actual = byName.get(memberPath);
    if (!actual) throw new Error(`archive member is missing: ${memberPath}`);
    if (actual.bytes !== member.bytes) throw new Error(`archive member size mismatch: ${memberPath}`);
    if (sha256(actual.data) !== member.sha256) throw new Error(`archive member digest mismatch: ${memberPath}`);
    expected.add(memberPath);
    total += member.bytes;
    if (total > MAX_TOTAL_BYTES) throw new Error('archive exceeds the declared total-byte bound');
  }
  for (const entry of zipEntries) if (!expected.has(entry.path)) throw new Error(`archive contains an undeclared member: ${entry.path}`);
  const configs = value.members.filter(member => CANDIDATES.includes(member.path));
  if (configs.length !== 1) throw new Error(`archive must contain exactly one root config (${CANDIDATES.join('|')})`);
  return value;
}

function readArchiveBytes(buffer) {
  const entries = parseZip(buffer);
  const manifestEntry = entries.find(entry => entry.path === MANIFEST_PATH);
  if (!manifestEntry || manifestEntry.bytes > MAX_MANIFEST_BYTES) throw new Error('archive manifest is missing or too large');
  let parsed;
  try { parsed = JSON.parse(decodeUtf8(manifestEntry.data, 'archive manifest')); }
  catch (error) { throw new Error(`archive manifest is invalid JSON: ${error.message}`); }
  const manifest = validateManifest(parsed, entries);
  const byName = new Map(entries.map(entry => [entry.path, entry.data]));
  return { manifest, entries: manifest.members.map(member => ({ ...member, data: byName.get(member.path) })) };
}

function readArchive(file) {
  const absolute = path.resolve(file);
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw new Error(`archive is not a regular file: ${absolute}`);
  if (stat.size > MAX_ARCHIVE_BYTES) throw new Error('archive exceeds the compressed-byte bound');
  return { file: absolute, bytes: fs.readFileSync(absolute) };
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function resolvedPathIdentity(value) {
  const absolute = path.resolve(value);
  const suffix = [];
  let cursor = absolute;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) return absolute;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  try { return path.join(fs.realpathSync(cursor), ...suffix); }
  catch { return absolute; }
}

function assertSourceTargetSeparate(source, target) {
  const sourcePath = resolvedPathIdentity(source);
  const targetPath = resolvedPathIdentity(target);
  if (sourcePath === targetPath || isInside(sourcePath, targetPath) || isInside(targetPath, sourcePath)) {
    throw new Error(`source and target must not overlap: ${diagnosticValue(sourcePath)} and ${diagnosticValue(targetPath)}`);
  }
}

function resolveAuthoredDependency(root, fromFile, specifier, selectedPaths, label) {
  if (typeof specifier !== 'string' || !specifier) throw new Error(`${label} has an empty dependency`);
  if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) {
    if (BUILTIN_MODULES.has(specifier)) {
      throw new Error(`${label} uses ambient Node built-in ${JSON.stringify(specifier)}; portable executable configs must be self-contained or use project-local modules`);
    }
    throw new Error(`${label} uses machine-local package dependency ${JSON.stringify(specifier)}; portable configs require project-local modules`);
  }
  if (path.isAbsolute(specifier)) throw new Error(`${label} uses an absolute machine-local dependency: ${specifier}`);
  const unresolved = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [unresolved, ...['.js', '.cjs', '.mjs', '.json'].map(ext => `${unresolved}${ext}`),
    ...['index.js', 'index.cjs', 'index.mjs', 'index.json'].map(name => path.join(unresolved, name))];
  const found = candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  if (!found) throw new Error(`${label} does not resolve to a portable project file: ${diagnosticValue(specifier)}`);
  const real = fs.realpathSync(found);
  if (!isInside(root, real)) throw new Error(`${label} resolves outside the packed project: ${diagnosticValue(specifier)}`);
  const rel = slash(path.relative(root, real));
  if (!selectedPaths.has(rel)) throw new Error(`${label} would be excluded from the archive: ${rel}`);
  return real;
}

function assertExecutableModuleClosure(root, configFile, selectedPaths) {
  if (!/\.(?:js|cjs|mjs)$/i.test(configFile)) return;
  const seen = new Set();
  const scan = file => {
    const real = fs.realpathSync(file);
    if (seen.has(real)) return;
    seen.add(real);
    const source = fs.readFileSync(real, 'utf8');
    if (source.length > 8 * 1024 * 1024) throw new Error(`executable authoring module is too large to inspect safely: ${slash(path.relative(root, real))}`);
    if (/\b(?:require|import)\s*\(\s*(?:\)|[^'"\s])/.test(source)) {
      throw new Error(`executable authoring module uses a dynamic module dependency: ${slash(path.relative(root, real))}`);
    }
    if (/\b(?:readFileSync|readFile|createReadStream|openSync)\s*\(\s*(?:\)|[^'"\s])/.test(source)) {
      throw new Error(`executable authoring module uses a dynamic file dependency: ${slash(path.relative(root, real))}`);
    }
    if (/\b(?:process|fetch|XMLHttpRequest|WebSocket|Deno|Bun)\b|\b(?:eval|Function)\s*\(|\b(?:module|require)\s*\.\s*constructor\b/.test(source)) {
      throw new Error(`executable authoring module uses ambient runtime authority: ${slash(path.relative(root, real))}`);
    }
    const dependencies = [];
    let match;
    const calls = /\b(?:require|import)\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
    while ((match = calls.exec(source)) !== null) dependencies.push({ specifier: match[2], label: 'module dependency' });
    const statements = /\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s+)?(['"])([^'"]+)\1/g;
    while ((match = statements.exec(source)) !== null) dependencies.push({ specifier: match[2], label: 'module dependency' });
    const reads = /\b(?:readFileSync|readFile|createReadStream|openSync)\s*\(\s*(['"])([^'"]+)\1/g;
    while ((match = reads.exec(source)) !== null) dependencies.push({ specifier: match[2], label: 'file dependency' });
    for (const dependency of dependencies) {
      const resolved = resolveAuthoredDependency(root, real, dependency.specifier, selectedPaths,
        `${slash(path.relative(root, real))} ${dependency.label}`);
      if (resolved && /\.(?:js|cjs|mjs)$/i.test(resolved)) scan(resolved);
    }
  };
  scan(configFile);
}

function rawProjectReferences(raw) {
  const refs = [];
  const add = (value, label) => {
    if (typeof value === 'string' && value.trim()) refs.push({ value, label });
  };
  add(raw && raw.theme && raw.theme.css, 'config.theme.css');
  add(raw && raw.choreography, 'config.choreography');
  const bed = raw && (raw.bed || raw.music);
  add(typeof bed === 'string' ? bed : bed && bed.file, 'config.bed.file');
  for (const [index, effect] of ((raw && raw.sfx) || []).entries()) add(typeof effect === 'string' ? effect : effect && effect.file, `config.sfx[${index}].file`);
  if (raw && raw.narration && typeof raw.narration === 'object') {
    add(raw.narration.file, 'config.narration.file');
    add(raw.narration.wordTimings, 'config.narration.wordTimings');
  }
  for (const [id, character] of Object.entries((raw && raw.characters) || {})) {
    add(character && character.model, `config.characters.${id}.model`);
    add(character && character.src, `config.characters.${id}.src`);
  }
  for (const [id, voice] of Object.entries((raw && raw.voices) || {})) {
    if (voice && voice.backend === 'chatterbox' && path.isAbsolute(String(voice.speaker || ''))) add(voice.speaker, `config.voices.${id}.speaker`);
  }
  for (const [name, ref] of Object.entries((raw && raw.imports) || {})) add(ref, `config.imports.${name}`);
  for (const [id, walkthrough] of Object.entries((raw && raw.walkthroughs) || {})) {
    add(walkthrough && walkthrough.actionPolicy, `config.walkthroughs.${id}.actionPolicy`);
  }
  const sceneFileKeys = ['bodyFile', 'cssFile', 'choreographyFile', 'scriptFile', 'threeFile', 'threeModule', 'elementsFile', 'visualFile', 'clip'];
  const addThree = (three, label) => {
    if (!three || typeof three !== 'object') return;
    add(typeof three.envMap === 'string' ? three.envMap : three.envMap && three.envMap.src, `${label}.envMap`);
    const visit = (object, at) => {
      if (!object || typeof object !== 'object') return;
      for (const key of ['src', 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'texture']) add(object[key], `${at}.${key}`);
      for (const [index, child] of (object.children || []).entries()) visit(child, `${at}.children[${index}]`);
    };
    for (const [index, object] of (three.objects || []).entries()) visit(object, `${label}.objects[${index}]`);
  };
  const visitVisual = (node, at) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'image' || node.type === 'svg' || node.type === 'video') add(node.src, `${at}.src`);
    add(node.style && node.style.fontFile, `${at}.style.fontFile`);
    for (const [childIndex, child] of (node.children || []).entries()) visitVisual(child, `${at}.children[${childIndex}]`);
  };
  const addScene = (scene, label, includeFiles = true) => {
    if (!scene || typeof scene !== 'object') return;
    if (includeFiles) for (const key of sceneFileKeys) add(scene[key], `${label}.${key}`);
    addThree(scene.three, `${label}.three`);
    addThree({ objects: scene.elements || [] }, `${label}.elements`);
    visitVisual(scene.visual, `${label}.visual`);
  };
  for (const [index, scene] of ((raw && raw.scenes) || []).entries()) addScene(scene, `config.scenes[${index}]`);
  for (const [index, variant] of ((raw && raw.variants) || []).entries()) {
    addScene(variant && variant.scene, `config.variants[${index}].scene`, false);
    for (const [sceneId, override] of Object.entries((variant && variant.sceneOverrides) || {})) {
      addScene(override, `config.variants[${index}].sceneOverrides.${sceneId}`, false);
    }
  }
  return refs;
}

function decodeCssEscapes(value) {
  return String(value).replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\r\n\f0-9a-f])/gi, (whole, hex, escaped) => {
    if (hex) {
      const code = Number.parseInt(hex, 16);
      return code === 0 || code > 0x10ffff ? '\ufffd' : String.fromCodePoint(code);
    }
    return escaped;
  });
}

function decodeHtmlReference(value, label) {
  const named = { amp: '&', colon: ':', sol: '/', quot: '"', apos: "'", lt: '<', gt: '>' };
  const decoded = String(value).replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z]+));?/gi, (whole, hex, decimal, name) => {
    if (hex || decimal) {
      const code = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return code === 0 || code > 0x10ffff ? '\ufffd' : String.fromCodePoint(code);
    }
    return Object.hasOwn(named, name.toLowerCase()) ? named[name.toLowerCase()] : whole;
  });
  if (/&(?:#[xX]?[0-9a-fA-F]+|[a-z][a-z0-9]+);/i.test(decoded)) {
    throw new Error(`${label} uses an unsupported HTML entity in a resource reference`);
  }
  return decoded;
}

function htmlAttribute(tag, attr, label) {
  const match = new RegExp(`(?<![-\\w])${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, 'i').exec(tag);
  return match ? decodeHtmlReference(match[1] ?? match[2] ?? match[3], label) : null;
}

function htmlTags(value, label) {
  const source = String(value || '');
  const tags = [];
  for (let start = source.indexOf('<'); start !== -1; start = source.indexOf('<', start + 1)) {
    if (!/[A-Za-z]/.test(source[start + 1] || '')) continue;
    let quote = null;
    let end = start + 1;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end >= source.length) throw new Error(`${label} contains an unterminated HTML tag`);
    tags.push(source.slice(start, end + 1));
    start = end;
  }
  return tags;
}

function cssReferences(css, label, baseDir) {
  const refs = [];
  const add = (value, at, extra = {}) => {
    if (typeof value === 'string' && value.trim()) refs.push({ value: value.trim(), label: at, baseDir, browserUrl: true, ...extra });
  };
  const withoutComments = String(css || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const canonicalCss = decodeCssEscapes(withoutComments);
  let match;
  const urls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;
  while ((match = urls.exec(canonicalCss)) !== null) add(match[1] ?? match[2] ?? match[3], `${label} url()`);
  const imports = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)|"([^"]*)"|'([^']*)')/gi;
  while ((match = imports.exec(canonicalCss)) !== null) {
    add(match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5], `${label} @import`, { cssImport: true });
  }
  return refs;
}

function markupReferences(markup, label, baseDir) {
  const refs = [];
  const add = (value, at, extra = {}) => {
    if (typeof value === 'string' && value.trim()) refs.push({ value: value.trim(), label: at, baseDir, ...extra });
  };
  for (const tag of htmlTags(markup, label)) {
    const tagName = /^<\s*([a-zA-Z][\w:-]*)/.exec(tag)[1].toLowerCase();
    const httpEquiv = tagName === 'meta' ? htmlAttribute(tag, 'http-equiv', `${label} http-equiv`) : null;
    if (tagName === 'base' || tagName === 'iframe' || (httpEquiv && httpEquiv.toLowerCase() === 'refresh')) {
      throw new Error(`${label} contains browser URL-base or refresh behavior, or a nested frame, that is not portable`);
    }
    const attrs = ['src', 'poster', 'srcset'];
    if (['link', 'image', 'use', 'feimage'].includes(tagName)) attrs.push('href');
    if (tagName === 'object') attrs.push('data');
    for (const attr of attrs) {
      const value = htmlAttribute(tag, attr, `${label} ${attr}`);
      if (value === null) continue;
      if (attr === 'srcset') {
        if (/(?:^|[\s,])data:/i.test(value)) {
          throw new Error(`${label} srcset with data URLs is not supported for portable dependency closure; use src or project-local files`);
        }
        for (const candidate of value.split(',')) add(candidate.trim().split(/\s+/)[0], `${label} srcset`, { browserUrl: true });
      } else add(value, `${label} ${attr}`, {
        browserUrl: true,
        cssFile: tagName === 'link' && attr === 'href' && /(?:^|\s)stylesheet(?:\s|$)/i.test(tag),
      });
    }
  }
  refs.push(...cssReferences(markup, label, baseDir));
  return refs;
}

function embeddedProjectReferences(config, root) {
  const refs = [];
  const add = (value, label, extra = {}) => {
    if (typeof value === 'string' && value.trim()) refs.push({ value: value.trim(), label, baseDir: root, ...extra });
  };
  const visitVisual = (node, label) => {
    if (!node || typeof node !== 'object') return;
    if (['image', 'svg', 'video'].includes(node.type)) add(node.src, `${label}.src`);
    add(node.style && node.style.fontFile, `${label}.style.fontFile`);
    for (const [index, child] of (node.children || []).entries()) visitVisual(child, `${label}.children[${index}]`);
  };
  const visitThree = (three, label) => {
    if (!three || typeof three !== 'object') return;
    add(typeof three.envMap === 'string' ? three.envMap : three.envMap && three.envMap.src, `${label}.envMap`);
    const visit = (object, at) => {
      if (!object || typeof object !== 'object') return;
      for (const key of ['src', 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'texture']) add(object[key], `${at}.${key}`);
      for (const [index, child] of (object.children || []).entries()) visit(child, `${at}.children[${index}]`);
    };
    for (const [index, object] of (three.objects || []).entries()) visit(object, `${label}.objects[${index}]`);
  };
  const visitScene = (scene, label) => {
    const body = String((scene && scene.body) || '');
    refs.push(...markupReferences(body, `${label}.body`, root));
    visitVisual(scene && scene.visual, `${label}.visual`);
    visitThree(scene && scene.three, `${label}.three`);
    visitThree({ objects: (scene && scene.elements) || [] }, `${label}.elements`);
  };
  for (const [index, scene] of ((config && config.scenes) || []).entries()) visitScene(scene, `config.scenes[${index}]`);
  for (const [index, variant] of ((config && config.variants) || []).entries()) {
    visitScene(variant && variant.scene, `config.variants[${index}].scene`);
    for (const [sceneId, override] of Object.entries((variant && variant.sceneOverrides) || {})) {
      visitScene(override, `config.variants[${index}].sceneOverrides.${sceneId}`);
    }
  }
  return refs;
}

function assertPortableReferences(root, raw, config, selectedPaths) {
  if (raw && typeof raw.assets === 'string') {
    if (path.isAbsolute(raw.assets)) throw new Error('config.assets must be project-relative before packing');
    const assetRoot = fs.realpathSync(path.resolve(root, raw.assets));
    if (!isInside(root, assetRoot) || !fs.statSync(assetRoot).isDirectory()) throw new Error('config.assets resolves outside the packed project');
  }
  for (const [id, voice] of Object.entries((raw && raw.voices) || {})) {
    if (voice && voice.backend === 'chatterbox' && voice.speaker && !path.isAbsolute(String(voice.speaker))) {
      throw new Error(`config.voices.${id}.speaker names a machine-local saved sample; portable projects require bundled narration audio`);
    }
  }
  for (const [id, walkthrough] of Object.entries((raw && raw.walkthroughs) || {})) {
    for (const field of ['profile', 'restore', 'session']) {
      if (walkthrough && walkthrough[field]) {
        throw new Error(`config.walkthroughs.${id}.${field} depends on machine-local browser state and cannot be packed`);
      }
    }
    const urlFields = [
      ['url', walkthrough && walkthrough.url],
      ['ready.url', walkthrough && walkthrough.ready && walkthrough.ready.url],
      ...(((walkthrough && walkthrough.steps) || []).map((step, index) => [`steps[${index}].url`, step && step.url])),
    ];
    for (const [field, value] of urlFields) {
      if (typeof value === 'string' && /^file:/i.test(value)) {
        throw new Error(`config.walkthroughs.${id}.${field} is a machine-local file URL and cannot be packed`);
      }
    }
  }
  const embedded = embeddedProjectReferences(config, root);
  const references = [
    ...rawProjectReferences(raw).map(reference => ({ ...reference, baseDir: root })),
    ...embedded,
  ];
  const scannedDocuments = new Set();
  for (let index = 0; index < references.length; index++) {
    const reference = references[index];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference.value)) {
      if (/^(?:data:|#|mailto:|tel:)/i.test(reference.value)) continue;
      throw new Error(`${reference.label} is a remote dependency; acquire it into the project before packing`);
    }
    if (reference.value.startsWith('#')) continue;
    if (path.isAbsolute(reference.value)) throw new Error(`${reference.label} must be project-relative before packing`);
    const localValue = reference.browserUrl ? reference.value.split(/[?#]/, 1)[0] : reference.value;
    let candidate;
    try { candidate = fs.realpathSync(path.resolve(reference.baseDir || root, localValue)); }
    catch { throw new Error(`${reference.label} does not resolve to a project file: ${diagnosticValue(reference.value)}`); }
    if (!isInside(root, candidate) || !fs.statSync(candidate).isFile()) throw new Error(`${reference.label} resolves outside the packed project`);
    const rel = slash(path.relative(root, candidate));
    if (!selectedPaths.has(rel)) throw new Error(`${reference.label} would be excluded from the archive: ${rel}`);
    const documentKey = aliasKey(candidate);
    if (scannedDocuments.has(documentKey)) continue;
    const extension = path.extname(candidate).toLowerCase();
    if (!['.css', '.html', '.htm', '.svg'].includes(extension)) continue;
    scannedDocuments.add(documentKey);
    const contents = fs.readFileSync(candidate, 'utf8');
    const discovered = extension === '.css'
      ? cssReferences(contents, reference.label, path.dirname(candidate))
      : markupReferences(contents, reference.label, path.dirname(candidate));
    references.push(...discovered);
  }
}

function assertEntryDependencyClosure(entries) {
  const byName = new Map(entries.map(entry => [safeMemberPath(entry.path), entry.data]));
  const configs = CANDIDATES.filter(name => byName.has(name));
  if (configs.length !== 1) throw new Error(`project must contain exactly one root config (${CANDIDATES.join('|')})`);
  const configName = configs[0];
  const external = value => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
  const resolveReference = reference => {
    const value = String(reference.value || '').trim();
    if (external(value)) {
      if (/^(?:data:|mailto:|tel:)/i.test(value)) return null;
      throw new Error(`${reference.label} is a remote dependency; acquire it into the project before sharing`);
    }
    if (value.startsWith('#')) return null;
    if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
      throw new Error(`${reference.label} must be a portable project-relative path`);
    }
    const withoutSuffix = value.split(/[?#]/, 1)[0];
    const candidate = path.posix.normalize(path.posix.join(reference.baseDir || '', withoutSuffix));
    safeMemberPath(candidate);
    if (!byName.has(candidate)) throw new Error(`${reference.label} does not resolve to an archived project file: ${value}`);
    return candidate;
  };

  const seenResources = new Set();
  const scanVirtualResource = (candidate, label) => {
    if (!candidate || seenResources.has(aliasKey(candidate))) return;
    const extension = path.posix.extname(candidate).toLowerCase();
    if (!['.css', '.html', '.htm', '.svg'].includes(extension)) return;
    seenResources.add(aliasKey(candidate));
    const contents = decodeUtf8(byName.get(candidate), label);
    const discovered = extension === '.css'
      ? cssReferences(contents, label, path.posix.dirname(candidate))
      : markupReferences(contents, label, path.posix.dirname(candidate));
    for (const reference of discovered) {
      const dependency = resolveReference(reference);
      scanVirtualResource(dependency, reference.label);
    }
  };

  if (configName.endsWith('.json')) {
    let raw;
    try { raw = JSON.parse(decodeUtf8(byName.get(configName), configName)); }
    catch (error) { throw new Error(`${configName} is not valid UTF-8 JSON: ${error.message}`); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${configName} must contain a project object`);
    for (const [id, voice] of Object.entries(raw.voices || {})) {
      if (voice && voice.backend === 'chatterbox' && voice.speaker) {
        throw new Error(`config.voices.${id}.speaker depends on machine-local voice state and cannot be shared`);
      }
    }
    for (const [id, walkthrough] of Object.entries(raw.walkthroughs || {})) {
      for (const field of ['profile', 'restore', 'session']) {
        if (walkthrough && walkthrough[field]) throw new Error(`config.walkthroughs.${id}.${field} depends on machine-local browser state and cannot be shared`);
      }
      const urls = [walkthrough && walkthrough.url, walkthrough && walkthrough.ready && walkthrough.ready.url,
        ...((walkthrough && walkthrough.steps) || []).map(step => step && step.url)];
      if (urls.some(value => typeof value === 'string' && /^file:/i.test(value))) {
        throw new Error(`config.walkthroughs.${id} contains a machine-local file URL and cannot be shared`);
      }
    }
    const resolved = { ...raw };
    if (raw.theme && typeof raw.theme.css === 'string') {
      const themePath = resolveReference({ value: raw.theme.css, label: 'config.theme.css', baseDir: '' });
      resolved.themeCss = decodeUtf8(byName.get(themePath), 'config.theme.css');
    }
    resolved.scenes = (raw.scenes || []).map((scene, index) => {
      const copy = { ...scene };
      const parseSceneJson = (field, targetField) => {
        if (typeof scene[field] !== 'string') return;
        const memberPath = resolveReference({ value: scene[field], label: `config.scenes[${index}].${field}`, baseDir: '' });
        try { copy[targetField] = JSON.parse(decodeUtf8(byName.get(memberPath), `config.scenes[${index}].${field}`)); }
        catch (error) { throw new Error(`config.scenes[${index}].${field} is invalid JSON: ${error.message}`); }
      };
      if (typeof scene.bodyFile === 'string') {
        const bodyPath = resolveReference({ value: scene.bodyFile, label: `config.scenes[${index}].bodyFile`, baseDir: '' });
        copy.body = decodeUtf8(byName.get(bodyPath), `config.scenes[${index}].bodyFile`);
      }
      if (typeof scene.cssFile === 'string') {
        const cssPath = resolveReference({ value: scene.cssFile, label: `config.scenes[${index}].cssFile`, baseDir: '' });
        copy._cssFileContents = decodeUtf8(byName.get(cssPath), `config.scenes[${index}].cssFile`);
      }
      parseSceneJson('threeFile', 'three');
      parseSceneJson('elementsFile', 'elements');
      parseSceneJson('visualFile', 'visual');
      return copy;
    });
    resolved.imports = {};
    for (const [name, ref] of Object.entries(raw.imports || {})) {
      const importPath = resolveReference({ value: ref, label: `config.imports.${name}`, baseDir: '' });
      resolved.imports[name] = { file: ref, contents: decodeUtf8(byName.get(importPath), `config.imports.${name}`) };
    }
    const embedded = embeddedProjectReferences(resolved, '');
    const references = [
      ...rawProjectReferences(raw).map(reference => ({ ...reference, baseDir: '' })),
      ...embedded,
    ];
    for (const reference of references) {
      const candidate = resolveReference(reference);
      scanVirtualResource(candidate, reference.label);
    }
    return;
  }

  const seenModules = new Set();
  const scanModule = modulePath => {
    if (seenModules.has(modulePath)) return;
    seenModules.add(modulePath);
    const source = decodeUtf8(byName.get(modulePath), modulePath);
    const specifiers = [];
    let match;
    const calls = /\b(?:require|import)\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
    while ((match = calls.exec(source)) !== null) specifiers.push(match[2]);
    const statements = /\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s+)?(['"])([^'"]+)\1/g;
    while ((match = statements.exec(source)) !== null) specifiers.push(match[2]);
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue;
      const unresolved = path.posix.normalize(path.posix.join(path.posix.dirname(modulePath), specifier));
      const candidates = [unresolved, ...['.js', '.cjs', '.mjs', '.json'].map(ext => `${unresolved}${ext}`),
        ...['index.js', 'index.cjs', 'index.mjs', 'index.json'].map(name => path.posix.join(unresolved, name))];
      const found = candidates.find(candidate => byName.has(candidate));
      if (!found) throw new Error(`${modulePath} module dependency does not resolve inside the archive: ${diagnosticValue(specifier)}`);
      if (/\.(?:js|cjs|mjs)$/i.test(found)) scanModule(found);
    }
  };
  scanModule(configName);
}

function assertAssetClosure(entries) {
  const byName = new Map(entries.map(entry => [entry.path, entry.data]));
  const lockData = byName.get('assets.lock.json');
  if (!lockData) return;
  let parsed;
  try { parsed = JSON.parse(lockData.toString('utf8')); }
  catch (error) { throw new Error(`assets.lock.json: invalid JSON (${error.message})`); }
  const lock = validateLock(parsed, 'assets.lock.json');
  for (const asset of lock.assets) {
    const data = byName.get(asset.file);
    if (!data) throw new Error(`tracked asset dependency would be excluded from the project: ${asset.file}`);
    if (data.length !== asset.bytes || sha256(data) !== asset.sha256) {
      throw new Error(`tracked asset does not match assets.lock.json: ${asset.file}`);
    }
    if (asset.recipe && !byName.has(asset.recipe)) {
      throw new Error(`tracked asset dependency would be excluded from the project: ${asset.recipe}`);
    }
  }
}

function isFreshnessExcluded(rel) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  return isArchiveStateExcluded(rel)
    || aliasKey(rel) === aliasKey(REMIX_PATH);
}

function isArchiveStateExcluded(rel) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  return parts.some(part => excludedName(EXCLUDED_DIRS, part))
    || excludedName(EXCLUDED_FILES, base)
    || base.toLowerCase().endsWith('.narova');
}

function assertOpenProfile(entries, opts = {}) {
  const secrets = opts.scanSecrets === false ? [] : secretValues(opts.env);
  for (const entry of entries) {
    const rel = safeMemberPath(entry.path);
    if (isArchiveStateExcluded(rel)) throw new Error(`archive contains forbidden generated, repository, or nested-archive state: ${rel}`);
    assertNoSecret(rel, entry.data, secrets);
  }
}

function freshProjectEntries(entries, opts = {}) {
  const secrets = opts.scanSecrets === false ? [] : secretValues(opts.env);
  const selected = [];
  for (const entry of entries) {
    const rel = safeMemberPath(entry.path);
    if (isFreshnessExcluded(rel)) continue;
    assertNoSecret(rel, entry.data, secrets);
    selected.push({ ...entry, path: rel });
  }
  const configs = selected.filter(item => CANDIDATES.includes(item.path));
  if (configs.length !== 1) throw new Error(`project must contain exactly one root config (${CANDIDATES.join('|')})`);
  if (selected.length > MAX_MEMBERS) throw new Error(`project has more than ${MAX_MEMBERS} files`);
  const total = selected.reduce((sum, item) => sum + item.data.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error('project exceeds the total expansion bound');
  assertPortablePaths(selected.map(item => item.path), 'project');
  assertAssetClosure(selected);
  assertEntryDependencyClosure(selected);
  return selected;
}

function packProject({ projectDir, config, raw, configFile, output, productVersion }) {
  const selected = collectProjectFiles(projectDir);
  const configRel = slash(path.relative(selected.root, fs.realpathSync(path.resolve(configFile))));
  if (configRel !== selected.configName) throw new Error('pack requires the project root authoring config');
  const selectedPaths = new Set(selected.files.map(item => item.path));
  assertEntryDependencyClosure(selected.files);
  assertExecutableModuleClosure(selected.root, path.resolve(configFile), selectedPaths);
  assertPortableReferences(selected.root, raw, config, selectedPaths);
  assertAssetClosure(selected.files);
  const members = selected.files
    .map(item => ({ path: item.path, bytes: item.data.length, sha256: sha256(item.data), role: item.role }))
    .sort((a, b) => comparePath(a.path, b.path));
  const stableConfig = selected.configName.endsWith('.json');
  const sourceTitle = safeMetadataString(
    stableConfig ? (config.title || path.basename(selected.root)) : path.basename(selected.root),
    'archive source title',
  );
  safeMetadataString(productVersion, 'archive packer version');
  const creativeIdentity = stableConfig ? sha256(Buffer.from(JSON.stringify(fingerprint(config)))) : null;
  const manifest = {
    format: FORMAT,
    container: 'zip',
    packer: { product: 'narova', version: productVersion },
    source: { title: sourceTitle, creativeIdentity },
    packedAt: NORMALIZED_TIME,
    normalization: { memberOrder: 'path-ascending', timestamp: NORMALIZED_TIME, compression: 'store' },
    limits: { memberBytes: MAX_MEMBER_BYTES, totalBytes: MAX_TOTAL_BYTES },
    members,
  };
  const dataByName = new Map(selected.files.map(item => [item.path, item.data]));
  const manifestData = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (manifestData.length > MAX_MANIFEST_BYTES) throw new Error('archive manifest exceeds the manifest-byte bound');
  const archiveEntries = [
    { path: MANIFEST_PATH, data: manifestData },
    ...members.map(member => ({ path: member.path, data: dataByName.get(member.path) })),
  ].sort((a, b) => comparePath(a.path, b.path));
  const archive = zipStored(archiveEntries);
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('packed archive exceeds the local archive-byte bound');
  const destination = path.resolve(output);
  if (!/\.narova$/i.test(destination)) throw new Error('archive output must use the .narova extension');
  if (destination === selected.root || isInside(selected.root, destination)) {
    const rel = slash(path.relative(selected.root, destination));
    if (selectedPaths.has(rel)) throw new Error(`archive output would replace a project input: ${rel}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temp, archive, { mode: 0o644 });
    fs.renameSync(temp, destination);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
  return { path: destination, members: members.length, bytes: archive.length, sha256: sha256(archive), manifest };
}

function inspectArchive(file) {
  const read = readArchive(file);
  const verified = readArchiveBytes(read.bytes);
  assertOpenProfile(verified.entries);
  assertAssetClosure(verified.entries);
  assertEntryDependencyClosure(verified.entries);
  return { ...verified.manifest, path: read.file, sha256: sha256(read.bytes) };
}

function publishEntries(entries, target, opts = {}) {
  const destination = path.resolve(target);
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(destination) && !opts.overwrite) throw new Error(`target already exists: ${destination} (pass --overwrite to replace it)`);
  const stage = fs.mkdtempSync(path.join(parent, `.${path.basename(destination)}.stage-`));
  let backup = null;
  try {
    for (const entry of entries) {
      const rel = safeMemberPath(entry.path);
      const out = path.join(stage, ...rel.split('/'));
      const relative = path.relative(stage, out);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`member escapes target: ${rel}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, entry.data, { mode: 0o644 });
    }
    if (fs.existsSync(destination)) {
      backup = `${destination}.backup-${process.pid}-${Date.now()}`;
      fs.renameSync(destination, backup);
    }
    fs.renameSync(stage, destination);
    if (backup) {
      try { fs.rmSync(backup, { recursive: true, force: true }); }
      catch { /* publication is already committed; retain the recoverable backup */ }
    }
  } catch (error) {
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    if (backup && !fs.existsSync(destination)) {
      try { fs.renameSync(backup, destination); } catch {}
    }
    throw error;
  }
  return destination;
}

function openArchive(file, target, opts = {}) {
  const read = readArchive(file);
  assertSourceTargetSeparate(read.file, target);
  const verified = readArchiveBytes(read.bytes);
  assertOpenProfile(verified.entries, opts);
  assertAssetClosure(verified.entries);
  assertEntryDependencyClosure(verified.entries);
  const destination = publishEntries(verified.entries, target, opts);
  return { target: destination, archive: read.file, sha256: sha256(read.bytes), manifest: verified.manifest };
}

function projectIdentity(files) {
  const hash = crypto.createHash('sha256');
  for (const item of [...files].sort((a, b) => comparePath(a.path, b.path))) {
    if (item.path === REMIX_PATH) continue;
    hash.update(item.path).update('\0').update(sha256(item.data)).update('\n');
  }
  return hash.digest('hex');
}

function lineageEntry(origin) {
  return {
    path: REMIX_PATH,
    role: 'remix-lineage',
    data: Buffer.from(`${JSON.stringify({ schema: 'narova.remix/1', parent: origin }, null, 2)}\n`),
  };
}

function withLineage(entries, origin) {
  const lineage = lineageEntry(origin);
  const combined = [...entries, lineage];
  if (combined.length > MAX_MEMBERS) throw new Error(`remix project has more than ${MAX_MEMBERS} files after adding lineage`);
  const total = combined.reduce((sum, item) => sum + item.data.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error('remix project exceeds the total expansion bound after adding lineage');
  assertPortablePaths(combined.map(item => item.path), 'remix project');
  return combined;
}

function remixDirectory(source, target, opts = {}) {
  assertSourceTargetSeparate(source, target);
  const selected = collectProjectFiles(source, { scanSecrets: true });
  const origin = { kind: 'project', identity: projectIdentity(selected.files) };
  const files = withLineage(freshProjectEntries(selected.files, opts), origin);
  const destination = publishEntries(files, target, opts);
  return { target: destination, origin, members: files.length };
}

function remixArchive(file, target, opts = {}) {
  const read = readArchive(file);
  assertSourceTargetSeparate(read.file, target);
  const verified = readArchiveBytes(read.bytes);
  const origin = { kind: 'archive', identity: sha256(read.bytes) };
  const entries = withLineage(freshProjectEntries(verified.entries, opts), origin);
  const destination = publishEntries(entries, target, opts);
  return { target: destination, origin, members: entries.length };
}

async function boundedFetch(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('remote remix requires fetch support');
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: { Accept: opts.accept || 'application/vnd.github+json', 'User-Agent': 'narova-project-remix' },
    signal: AbortSignal.timeout(opts.timeoutMs || FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`remote fetch failed: HTTP ${response.status}`);
  const declared = Number(response.headers && response.headers.get && response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > (opts.maxBytes || MAX_FETCH_BYTES)) throw new Error('remote fetch exceeds the byte bound');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const data = Buffer.from(chunk);
    total += data.length;
    if (total > (opts.maxBytes || MAX_FETCH_BYTES)) throw new Error('remote fetch exceeds the byte bound');
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}

function githubLocator(value) {
  if (String(value).length > 512) throw new Error('remote GitHub locator exceeds the 512-character bound');
  const match = String(value).match(/^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:#([^\s]+))?$/);
  if (!match) throw new Error('remote source must match github:<owner>/<repo>[#ref]');
  return { owner: match[1], repo: match[2].replace(/\.git$/, ''), ref: match[3] || 'HEAD', locator: String(value) };
}

function stripGithubRoot(entries) {
  const names = entries.map(item => item.path);
  const roots = new Set(names.map(name => name.split('/')[0]));
  if (roots.size !== 1) throw new Error('GitHub archive does not have one repository root');
  const root = [...roots][0];
  return entries
    .filter(item => item.path !== root)
    .map(item => ({ ...item, path: item.path.slice(root.length + 1) }))
    .filter(item => item.path);
}

function locateRemoteProject(entries) {
  const archives = entries.filter(item => !item.path.includes('/') && item.path.endsWith('.narova'));
  if (archives.length === 1) return { archive: archives[0] };
  const configs = entries.filter(item => CANDIDATES.includes(path.posix.basename(item.path))
    && !item.path.split('/').some(part => excludedName(EXCLUDED_DIRS, part)));
  if (!configs.length) throw new Error('remote repository contains no discoverable Narova project or root archive');
  configs.sort((a, b) => a.path.split('/').length - b.path.split('/').length || comparePath(a.path, b.path));
  const depth = configs[0].path.split('/').length;
  if (configs.filter(item => item.path.split('/').length === depth).length !== 1) throw new Error('remote repository contains multiple equally discoverable Narova projects');
  const dir = path.posix.dirname(configs[0].path);
  const prefix = dir === '.' ? '' : `${dir}/`;
  return { entries: entries.filter(item => item.path.startsWith(prefix)).map(item => ({ ...item, path: item.path.slice(prefix.length) })) };
}

function selectRemoteProjectEntries(entries, opts = {}) {
  return freshProjectEntries(entries.map(entry => ({
    ...entry,
    role: roleFor(entry.path, CANDIDATES.find(name => entry.path === name)),
  })), opts);
}

async function remixGithub(locatorValue, target, opts = {}) {
  const parsed = githubLocator(locatorValue);
  const refBytes = await boundedFetch(`https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/commits/${encodeURIComponent(parsed.ref)}`, { ...opts, maxBytes: 2 * 1024 * 1024 });
  let commit;
  try { commit = JSON.parse(refBytes.toString('utf8')).sha; } catch {}
  if (!/^[a-f0-9]{40}$/i.test(commit || '')) throw new Error('GitHub did not return a resolved commit identity');
  const archiveBytes = await boundedFetch(`https://codeload.github.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/zip/${commit}`, { ...opts, accept: 'application/zip' });
  const remoteEntries = stripGithubRoot(parseZip(archiveBytes, { maxArchiveBytes: MAX_FETCH_BYTES, allowDirectories: true }));
  const located = locateRemoteProject(remoteEntries);
  const origin = { kind: 'github', locator: parsed.locator, commit };
  let entries;
  if (located.archive) {
    entries = freshProjectEntries(readArchiveBytes(located.archive.data).entries, opts);
  } else {
    entries = selectRemoteProjectEntries(located.entries, opts);
  }
  entries = withLineage(entries, origin);
  const destination = publishEntries(entries, target, opts);
  return { target: destination, origin, members: entries.length };
}

async function remix(source, target, opts = {}) {
  if (String(source).startsWith('github:')) return remixGithub(source, target, opts);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(String(source))) {
    throw new Error('remote source must match github:<owner>/<repo>[#ref]');
  }
  const absolute = path.resolve(source);
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) return remixDirectory(absolute, target, opts);
  if (stat.isFile()) return remixArchive(absolute, target, opts);
  throw new Error(`remix source must be a project directory, .narova archive, or github: locator: ${source}`);
}

const trustNotice = target => `Untrusted project opened at ${JSON.stringify(String(target))}. Opening did not execute it. Inspect first; building executes the project's authored source with your account's ambient authority.`;

module.exports = {
  FORMAT, MANIFEST_PATH, REMIX_PATH, NORMALIZED_TIME,
  MAX_MEMBER_BYTES, MAX_TOTAL_BYTES, MAX_FETCH_BYTES, MAX_MANIFEST_BYTES, MAX_ARCHIVE_BYTES, FETCH_TIMEOUT_MS,
  collectProjectFiles, zipStored, parseZip, readArchiveBytes,
  packProject, inspectArchive, openArchive, remix, trustNotice,
};
