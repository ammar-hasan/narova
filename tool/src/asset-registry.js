'use strict';
/* Durable creative-asset provenance for a Narova project.
 *
 * `assets.lock.json` is project source metadata, not renderer input. Acquisition
 * commands and existing producers (ingest/generate/walkthrough) register local
 * artifacts here after they succeed. Builds remain offline consumers of the
 * local files.
 *
 * This module deliberately stays provider-neutral. Provider search adapters can
 * be added later without changing the lock format or download/verify lifecycle. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ASSET_LOCK_FILE = 'assets.lock.json';
const ASSET_LOCK_VERSION = 1;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const ASSET_MUTATION_LOCK = '.assets.lock.json.lock';
const RESERVED_ASSET_PATHS = new Set([
  ASSET_LOCK_FILE,
  ASSET_MUTATION_LOCK,
  'manifest.json',
  'timings.json',
  '.audio-fingerprint',
  '.timings-fingerprint',
  '.restored-manifest.json',
  '.restored-overrides.json',
]);

function reservedAssetPath(relative) {
  const lower = relative.toLowerCase();
  return [...RESERVED_ASSET_PATHS].find(control => lower === control || lower.startsWith(`${control}/`));
}

const KIND_BY_EXT = new Map([
  ['.mp4', 'video'], ['.mov', 'video'], ['.webm', 'video'], ['.avi', 'video'], ['.mkv', 'video'],
  ['.mp3', 'audio'], ['.wav', 'audio'], ['.ogg', 'audio'], ['.flac', 'audio'], ['.m4a', 'audio'], ['.aac', 'audio'],
  ['.png', 'image'], ['.jpg', 'image'], ['.jpeg', 'image'], ['.gif', 'image'], ['.svg', 'image'], ['.webp', 'image'], ['.avif', 'image'],
  ['.ttf', 'font'], ['.otf', 'font'], ['.woff', 'font'], ['.woff2', 'font'], ['.eot', 'font'],
  ['.gltf', 'model'], ['.glb', 'model'], ['.obj', 'model'], ['.fbx', 'model'], ['.usdz', 'model'],
  ['.hdr', 'image'], ['.exr', 'image'],
]);

const MIME_BY_EXT = new Map([
  ['.mp4', 'video/mp4'], ['.mov', 'video/quicktime'], ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.ogg', 'audio/ogg'], ['.flac', 'audio/flac'], ['.m4a', 'audio/mp4'], ['.aac', 'audio/aac'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.gif', 'image/gif'], ['.svg', 'image/svg+xml'], ['.webp', 'image/webp'], ['.avif', 'image/avif'],
  ['.ttf', 'font/ttf'], ['.otf', 'font/otf'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
  ['.gltf', 'model/gltf+json'], ['.glb', 'model/gltf-binary'],
]);

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function toPosix(value) {
  return String(value).split(path.sep).join('/');
}

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function resolveProjectRecordPath(projectDir, ref) {
  const root = path.resolve(projectDir || '.');
  if (typeof ref !== 'string' || !ref.trim()) throw new Error('asset file must be a non-empty project-relative path');
  if (path.isAbsolute(ref)) throw new Error(`asset file must be project-relative: ${ref}`);
  const absolute = path.resolve(root, ref);
  if (!inside(root, absolute)) throw new Error(`asset file escapes the project: ${ref}`);
  const relative = toPosix(path.relative(root, absolute));
  if (relative === ASSET_LOCK_FILE) throw new Error(`${ASSET_LOCK_FILE} cannot register or replace itself`);
  if (reservedAssetPath(relative)) {
    throw new Error(`asset file cannot reference release control path ${JSON.stringify(relative)}`);
  }
  return { absolute, relative };
}

function nearestExistingParent(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

/* Resolve a project-relative file while preventing lexical and symlink escapes.
 * New download targets are checked through their nearest existing parent. */
function resolveProjectFile(projectDir, ref, { mustExist = true } = {}) {
  const root = path.resolve(projectDir || '.');
  const { absolute, relative } = resolveProjectRecordPath(root, ref);
  if (mustExist) {
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`asset file not found: ${absolute}`);
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(absolute);
    if (!inside(realRoot, realFile)) throw new Error(`asset file resolves outside the project: ${ref}`);
  } else {
    const parent = nearestExistingParent(path.dirname(absolute));
    if (!parent) throw new Error(`cannot resolve asset destination parent: ${ref}`);
    const realRoot = fs.realpathSync(root);
    const realParent = fs.realpathSync(parent);
    if (realParent !== realRoot && !inside(realRoot, realParent)) {
      throw new Error(`asset destination resolves outside the project: ${ref}`);
    }
  }
  return { absolute, relative };
}

function lockPath(projectDir) {
  return path.join(path.resolve(projectDir || '.'), ASSET_LOCK_FILE);
}

function acquireAssetMutationLock(projectDir) {
  const root = fs.realpathSync(path.resolve(projectDir || '.'));
  const lockDir = path.join(root, ASSET_MUTATION_LOCK);
  let lockStat;
  try { lockStat = fs.lstatSync(lockDir); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { fs.mkdirSync(lockDir); }
    catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
    lockStat = fs.lstatSync(lockDir);
  }
  if (!lockStat.isDirectory() || fs.realpathSync(lockDir) !== lockDir) {
    throw new Error(`asset mutation control path must be a project-local directory: ${lockDir}`);
  }
  const nonce = crypto.randomBytes(12).toString('hex');
  const ownIntent = path.join(lockDir, `intent-${process.pid}-${nonce}.json`);
  fs.writeFileSync(ownIntent, JSON.stringify({ pid: process.pid, nonce, createdAt: new Date().toISOString() }), { flag: 'wx' });
  const release = () => { try { fs.rmSync(ownIntent, { force: true }); } catch {} };
  const busy = () => new Error('asset registry is being changed by another process — retry after it finishes');
  try {
    for (const entry of fs.readdirSync(lockDir, { withFileTypes: true })) {
      const file = path.join(lockDir, entry.name);
      if (file === ownIntent) continue;
      // Only Narova's nonce-bearing intents participate in reclamation. Never
      // delete an unrelated file that happens to exist in the control dir.
      if (!entry.isFile() || !/^intent-\d+-[a-f0-9]{24}\.json$/.test(entry.name)) throw busy();
      let stale = false;
      try {
        const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); }
          catch (failure) { stale = failure.code === 'ESRCH'; }
        } else {
          stale = Date.now() - fs.statSync(file).mtimeMs > 60_000;
        }
      } catch {
        try { stale = Date.now() - fs.statSync(file).mtimeMs > 60_000; } catch { continue; }
      }
      // Intent names contain unguessable nonces and are never reused, so this
      // cannot remove a replacement owner's live lock.
      if (stale) fs.rmSync(file, { force: true });
      else throw busy();
    }
    // Close the scan/create race: a contender created after the scan sees our
    // intent and fails, or appears here and makes this attempt fail.
    if (fs.readdirSync(lockDir).some(entry => path.join(lockDir, entry) !== ownIntent)) throw busy();
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

function withAssetMutation(projectDir, callback) {
  const release = acquireAssetMutationLock(projectDir);
  let result;
  try { result = callback(); }
  catch (error) { release(); throw error; }
  if (result && typeof result.then === 'function') {
    return result.then(
      value => { release(); return value; },
      error => { release(); throw error; },
    );
  }
  release();
  return result;
}

function emptyLock() {
  return { version: ASSET_LOCK_VERSION, assets: [] };
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateRecordPath(value, label) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value)) {
    throw new Error(`${label} must be a project-relative path`);
  }
  const normalized = toPosix(path.normalize(value));
  if (!normalized || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`${label} escapes the project`);
  }
  if (normalized !== value) throw new Error(`${label} must be normalized as ${JSON.stringify(normalized)}`);
  if (reservedAssetPath(normalized)) {
    throw new Error(`${label} cannot reference release control path ${JSON.stringify(normalized)}`);
  }
  return normalized;
}

function validateOptionalString(value, label) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not supported by assets lock version ${ASSET_LOCK_VERSION}`);
  }
}

function validateLock(value, file = ASSET_LOCK_FILE) {
  if (!isRecord(value)) throw new Error(`${file}: expected an object`);
  assertAllowedKeys(value, new Set(['version', 'assets']), file);
  if (value.version !== ASSET_LOCK_VERSION) {
    throw new Error(`${file}: expected version ${ASSET_LOCK_VERSION}, got ${JSON.stringify(value.version)}`);
  }
  if (!Array.isArray(value.assets)) throw new Error(`${file}: assets must be an array`);
  const seen = new Set();
  for (let i = 0; i < value.assets.length; i++) {
    const asset = value.assets[i];
    const at = `${file}: assets[${i}]`;
    if (!isRecord(asset)) throw new Error(`${at} must be an object`);
    assertAllowedKeys(asset, new Set(['file', 'sha256', 'bytes', 'kind', 'origin', 'rights', 'acquiredAt', 'recipe', 'media']), at);
    const normalized = validateRecordPath(asset.file, `${at}.file`);
    if (seen.has(normalized)) throw new Error(`${file}: duplicate asset file ${JSON.stringify(normalized)}`);
    seen.add(normalized);
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw new Error(`${at}.sha256 must be a lowercase SHA-256 digest`);
    }
    if (!Number.isInteger(asset.bytes) || asset.bytes < 0) throw new Error(`${at}.bytes must be a non-negative integer`);
    if (typeof asset.kind !== 'string' || !asset.kind.trim()) throw new Error(`${at}.kind must be a non-empty string`);
    if (!isRecord(asset.origin) || typeof asset.origin.mode !== 'string' || !asset.origin.mode.trim()) {
      throw new Error(`${at}.origin.mode must be a non-empty string`);
    }
    assertAllowedKeys(asset.origin, new Set([
      'mode', 'provider', 'itemId', 'model',
      'sourcePage', 'sourcePageHash', 'sourceUrl', 'sourceUrlHash', 'pdf',
    ]), `${at}.origin`);
    for (const key of ['provider', 'itemId', 'model']) validateOptionalString(asset.origin[key], `${at}.origin.${key}`);
    for (const key of ['sourcePage', 'sourceUrl']) {
      if (asset.origin[key] !== undefined) {
        validateOptionalString(asset.origin[key], `${at}.origin.${key}`);
        const clean = sanitizeUrl(asset.origin[key], { stripQuery: true });
        if (clean !== asset.origin[key]) throw new Error(`${at}.origin.${key} must omit query parameters and fragments`);
      }
      const hash = asset.origin[`${key}Hash`];
      if (hash !== undefined && (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) {
        throw new Error(`${at}.origin.${key}Hash must be a lowercase SHA-256 digest`);
      }
    }
    if (asset.origin.mode === 'local-pdf' && asset.origin.pdf === undefined) {
      throw new Error(`${at}.origin.pdf is required when origin.mode is local-pdf`);
    }
    if (asset.origin.pdf !== undefined && asset.origin.mode !== 'local-pdf') {
      throw new Error(`${at}.origin.pdf requires origin.mode local-pdf`);
    }
    if (asset.origin.pdf !== undefined) {
      const pdf = asset.origin.pdf;
      if (!isRecord(pdf)) throw new Error(`${at}.origin.pdf must be an object`);
      assertAllowedKeys(pdf, new Set([
        'sourceBasename', 'sourceSha256', 'sourceBytes', 'documentPageCount',
        'physicalPage', 'parser', 'renderer', 'textAvailability',
      ]), `${at}.origin.pdf`);
      for (const key of ['sourceBasename', 'parser', 'renderer']) {
        if (typeof pdf[key] !== 'string' || !pdf[key].trim()) {
          throw new Error(`${at}.origin.pdf.${key} must be a non-empty string`);
        }
      }
      if (typeof pdf.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pdf.sourceSha256)) {
        throw new Error(`${at}.origin.pdf.sourceSha256 must be a lowercase SHA-256 digest`);
      }
      if (!Number.isInteger(pdf.sourceBytes) || pdf.sourceBytes < 1) {
        throw new Error(`${at}.origin.pdf.sourceBytes must be a positive integer`);
      }
      for (const key of ['documentPageCount', 'physicalPage']) {
        if (!Number.isInteger(pdf[key]) || pdf[key] < 1) {
          throw new Error(`${at}.origin.pdf.${key} must be a positive integer`);
        }
      }
      if (!['available', 'unavailable'].includes(pdf.textAvailability)) {
        throw new Error(`${at}.origin.pdf.textAvailability must be available or unavailable`);
      }
    }
    if (!isRecord(asset.rights) || typeof asset.rights.status !== 'string' || !asset.rights.status.trim()) {
      throw new Error(`${at}.rights.status must be a non-empty string`);
    }
    assertAllowedKeys(asset.rights, new Set(['status', 'license', 'licenseUrl', 'creator', 'attribution']), `${at}.rights`);
    for (const key of ['license', 'creator', 'attribution']) validateOptionalString(asset.rights[key], `${at}.rights.${key}`);
    if (asset.rights.licenseUrl !== undefined) {
      validateOptionalString(asset.rights.licenseUrl, `${at}.rights.licenseUrl`);
      if (sanitizeUrl(asset.rights.licenseUrl) !== asset.rights.licenseUrl) {
        throw new Error(`${at}.rights.licenseUrl must be a normalized HTTP(S) URL without a fragment`);
      }
    }
    if (typeof asset.acquiredAt !== 'string' || !Number.isFinite(Date.parse(asset.acquiredAt))) {
      throw new Error(`${at}.acquiredAt must be a valid timestamp string`);
    }
    if (asset.recipe !== undefined) validateRecordPath(asset.recipe, `${at}.recipe`);
    if (asset.media !== undefined) {
      if (!isRecord(asset.media)) throw new Error(`${at}.media must be an object`);
      assertAllowedKeys(asset.media, new Set(['mime', 'duration', 'width', 'height']), `${at}.media`);
      validateOptionalString(asset.media.mime, `${at}.media.mime`);
      if (asset.media.duration !== undefined && (!Number.isFinite(asset.media.duration) || asset.media.duration < 0)) {
        throw new Error(`${at}.media.duration must be a non-negative number`);
      }
      for (const key of ['width', 'height']) {
        if (asset.media[key] !== undefined && (!Number.isInteger(asset.media[key]) || asset.media[key] <= 0)) {
          throw new Error(`${at}.media.${key} must be a positive integer`);
        }
      }
    }
  }
  return value;
}

function readAssetLock(projectDir, { missingOk = true } = {}) {
  const file = lockPath(projectDir);
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT' && missingOk) return emptyLock();
    if (error.code === 'ENOENT') throw new Error(`${ASSET_LOCK_FILE} not found`);
    throw error;
  }
  if (!stat.isFile()) throw new Error(`${file}: expected a regular file, not a symlink or directory`);
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`${file}: invalid JSON (${error.message})`); }
  return validateLock(value, file);
}

function writeAssetLock(projectDir, value) {
  const root = path.resolve(projectDir || '.');
  const file = lockPath(root);
  const normalized = validateLock({
    version: ASSET_LOCK_VERSION,
    assets: [...value.assets].sort((a, b) => Buffer.compare(Buffer.from(a.file), Buffer.from(b.file))),
  }, file);
  const temp = path.join(root, `.${ASSET_LOCK_FILE}.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.writeFileSync(temp, JSON.stringify(normalized, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch {}
    throw error;
  }
  return file;
}

function cleanObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''));
}

function sanitizeUrl(value, { stripQuery = false } = {}) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error(`invalid asset source URL: ${value}`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`asset source URL must use http(s): ${value}`);
  if (parsed.username || parsed.password) throw new Error('asset source URL must not contain embedded credentials');
  parsed.hash = '';
  if (stripQuery) parsed.search = '';
  return parsed.toString();
}

function inferKind(file) {
  return KIND_BY_EXT.get(path.extname(file).toLowerCase()) || 'file';
}

function inferMime(file) {
  return MIME_BY_EXT.get(path.extname(file).toLowerCase()) || null;
}

function probeMedia(file, kind) {
  if (!['video', 'audio'].includes(kind)) return {};
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height',
    '-of', 'json', file,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return {};
  try {
    const parsed = JSON.parse(result.stdout);
    const video = (parsed.streams || []).find(stream => stream.codec_type === 'video');
    const duration = Number(parsed.format && parsed.format.duration);
    return cleanObject({
      ...(Number.isFinite(duration) ? { duration } : {}),
      ...(video && Number.isInteger(video.width) ? { width: video.width } : {}),
      ...(video && Number.isInteger(video.height) ? { height: video.height } : {}),
    });
  } catch { return {}; }
}

function inspectAsset(projectDir, fileRef, { contentType } = {}) {
  const resolved = resolveProjectFile(projectDir, fileRef);
  const stat = fs.statSync(resolved.absolute);
  const kind = inferKind(resolved.relative);
  const media = cleanObject({ mime: contentType || inferMime(resolved.relative), ...probeMedia(resolved.absolute, kind) });
  return {
    file: resolved.relative,
    kind,
    sha256: sha256File(resolved.absolute),
    bytes: stat.size,
    ...(Object.keys(media).length ? { media } : {}),
  };
}

function normalizeOrigin(origin) {
  const value = cleanObject(origin);
  if (!value.mode) value.mode = 'user';
  if (value.sourcePage) {
    const raw = value.sourcePage;
    value.sourcePage = sanitizeUrl(raw, { stripQuery: true });
    value.sourcePageHash = value.sourcePageHash || sha256(raw);
  }
  if (value.sourceUrl) {
    const raw = value.sourceUrl;
    value.sourceUrl = sanitizeUrl(raw, { stripQuery: true });
    value.sourceUrlHash = value.sourceUrlHash || sha256(raw);
  }
  return value;
}

function normalizeRights(rights) {
  const value = cleanObject(rights);
  value.status = value.status || (Object.keys(value).length ? 'declared' : 'unknown');
  if (value.licenseUrl) value.licenseUrl = sanitizeUrl(value.licenseUrl);
  return value;
}

function normalizeRegistrationMetadata(registration = {}) {
  if (!isRecord(registration)) throw new Error('asset registration metadata must be an object');
  return {
    ...(Object.hasOwn(registration, 'origin') ? { origin: normalizeOrigin(registration.origin) } : {}),
    ...(Object.hasOwn(registration, 'rights') ? { rights: normalizeRights(registration.rights) } : {}),
  };
}

function registerAssets(projectDir, registrations, opts = {}) {
  if (!opts.lockHeld) {
    return withAssetMutation(projectDir, () => registerAssets(projectDir, registrations, { ...opts, lockHeld: true }));
  }
  if (!Array.isArray(registrations) || registrations.length === 0) return { lock: readAssetLock(projectDir), file: null, records: [] };
  const lock = readAssetLock(projectDir);
  const byFile = new Map(lock.assets.map(asset => [asset.file, asset]));
  const records = [];
  for (const registration of registrations) {
    if (!isRecord(registration)) throw new Error('asset registration must be an object');
    const inspected = inspectAsset(projectDir, registration.file, { contentType: registration.contentType });
    const previous = byFile.get(inspected.file) || {};
    const replacesOrigin = Object.hasOwn(registration, 'origin');
    const replacesRights = Object.hasOwn(registration, 'rights');
    const replacesRecipe = Object.hasOwn(registration, 'recipe');
    const metadata = normalizeRegistrationMetadata(registration);
    const record = {
      ...previous,
      ...inspected,
      origin: replacesOrigin ? metadata.origin : normalizeOrigin(previous.origin),
      rights: replacesRights ? metadata.rights : normalizeRights(previous.rights),
      acquiredAt: registration.acquiredAt || previous.acquiredAt || new Date().toISOString(),
    };
    if (replacesRecipe) {
      if (registration.recipe) record.recipe = resolveProjectFile(projectDir, registration.recipe).relative;
      else delete record.recipe;
    }
    byFile.set(record.file, record);
    records.push(record);
  }
  lock.assets = [...byFile.values()];
  const file = writeAssetLock(projectDir, lock);
  return { lock, file, records };
}

function registerAsset(projectDir, registration, opts = {}) {
  return registerAssets(projectDir, [registration], opts).records[0];
}

function unregisterAsset(projectDir, fileRef, opts = {}) {
  if (!opts.lockHeld) {
    return withAssetMutation(projectDir, () => unregisterAsset(projectDir, fileRef, { ...opts, lockHeld: true }));
  }
  // Untracking only changes the registry. It must remain possible after the
  // corresponding directory becomes a broken or escaping symlink.
  const resolved = resolveProjectRecordPath(projectDir, fileRef);
  const lock = readAssetLock(projectDir);
  const before = lock.assets.length;
  lock.assets = lock.assets.filter(asset => asset.file !== resolved.relative);
  if (lock.assets.length === before) throw new Error(`asset is not tracked: ${resolved.relative}`);
  writeAssetLock(projectDir, lock);
  return resolved.relative;
}

function verifyAssets(projectDir) {
  const lock = readAssetLock(projectDir);
  const results = lock.assets.map(asset => {
    try {
      const inspected = inspectAsset(projectDir, asset.file);
      const issues = [];
      if (inspected.sha256 !== asset.sha256) issues.push('content hash changed');
      if (inspected.bytes !== asset.bytes) issues.push(`size changed (${asset.bytes} -> ${inspected.bytes})`);
      if (inspected.kind !== asset.kind) issues.push(`kind changed (${asset.kind} -> ${inspected.kind})`);
      if (asset.recipe) {
        try { resolveProjectFile(projectDir, asset.recipe); }
        catch (error) { issues.push(`recipe ${error.message}`); }
      }
      return { file: asset.file, ok: issues.length === 0, issues };
    } catch (error) {
      return { file: asset.file, ok: false, issues: [error.message] };
    }
  });
  return { ok: results.every(result => result.ok), results, count: results.length };
}

function creditLines(projectDir) {
  const lock = readAssetLock(projectDir);
  const lines = [];
  const seen = new Set();
  for (const asset of lock.assets) {
    const rights = asset.rights || {};
    const credit = rights.attribution || rights.creator;
    if (!credit) continue;
    const license = rights.license ? ` (${rights.license})` : '';
    const source = asset.origin && asset.origin.sourcePage ? ` — ${asset.origin.sourcePage}` : '';
    const line = `${credit}${license}${source}`;
    if (!seen.has(line)) { seen.add(line); lines.push(line); }
  }
  return lines.sort();
}

/* Credit entries behind creditLines: the same selection (records carrying
 * attribution or creator text), deduplication (on the composed line), and
 * sorting — enriched with the recorded fields the other output formats need.
 * Records without creator/attribution produce no entry in any format. */
function creditEntries(projectDir) {
  const lock = readAssetLock(projectDir);
  const entries = [];
  const seen = new Set();
  for (const asset of lock.assets) {
    const rights = asset.rights || {};
    const credit = rights.attribution || rights.creator;
    if (!credit) continue;
    const license = rights.license ? ` (${rights.license})` : '';
    const source = asset.origin && asset.origin.sourcePage ? ` — ${asset.origin.sourcePage}` : '';
    const line = `${credit}${license}${source}`;
    if (seen.has(line)) continue;
    seen.add(line);
    entries.push({
      line,
      creator: rights.creator || null,
      attribution: rights.attribution || null,
      license: rights.license || null,
      licenseUrl: rights.licenseUrl || null,
      sourceUrl: (asset.origin && asset.origin.sourcePage) || null,
    });
  }
  return entries.sort((a, b) => (a.line < b.line ? -1 : a.line > b.line ? 1 : 0));
}

const CREDIT_FORMATS = ['text', 'youtube', 'web', 'json'];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* Render credit entries in a selected output format (NAR-009-029). Format
 * changes presentation only: every format derives from the same deduplicated,
 * sorted entries, and no format invents missing fields — text/youtube/web
 * omit absent values, json carries them as null. */
function formatCredits(entries, format = 'text') {
  if (!CREDIT_FORMATS.includes(format)) {
    throw new Error(`unknown credits format ${JSON.stringify(format)} (${CREDIT_FORMATS.join('|')})`);
  }
  if (format === 'json') {
    return JSON.stringify(entries.map(({ creator, attribution, license, licenseUrl, sourceUrl }) => ({
      creator, attribution, license, licenseUrl, sourceUrl,
    })), null, 2);
  }
  if (format === 'youtube') {
    return entries.map(entry => entry.line).join('\n');
  }
  if (format === 'web') {
    const items = entries.map(entry => {
      const credit = escapeHtml(entry.attribution || entry.creator);
      const license = entry.license
        ? ` (${entry.licenseUrl ? `<a href="${escapeHtml(entry.licenseUrl)}">${escapeHtml(entry.license)}</a>` : escapeHtml(entry.license)})`
        : '';
      const source = entry.sourceUrl ? ` — <a href="${escapeHtml(entry.sourceUrl)}">${escapeHtml(entry.sourceUrl)}</a>` : '';
      return `  <li>${credit}${license}${source}</li>`;
    });
    return `<ul class="narova-credits">\n${items.join('\n')}\n</ul>`;
  }
  return entries.map(entry => entry.line).join('\n');
}


function validateDownloadType(contentType, { destination } = {}) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!type) return;
  const extension = path.extname(destination || '').toLowerCase();
  const jsonAsset = extension === '.json' || extension === '.gltf';
  if (type === 'text/html' || type === 'application/xhtml+xml' || type === 'application/problem+json'
      || ((type === 'application/json' || type.endsWith('+json')) && !jsonAsset)) {
    throw new Error(`download returned unexpected content-type: ${type}`);
  }
}

function validateDownloadBody(prefix, { contentType, destination } = {}) {
  if (!prefix.length) throw new Error('download returned an empty response body');
  const text = prefix.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(text)) {
    throw new Error('download returned an HTML error body');
  }
  const extension = path.extname(destination || '').toLowerCase();
  const jsonAsset = extension === '.json' || extension === '.gltf';
  const genericType = !contentType || contentType === 'application/octet-stream' || contentType === 'text/plain';
  const jsonLike = /^[{[]/.test(text);
  const explicitError = jsonLike && /"(?:error|errors)"\s*:/i.test(text);
  const genericError = !jsonAsset && genericType && jsonLike
    && /"(?:message|detail|statusCode|status)"\s*:/i.test(text);
  if (explicitError || genericError) {
    throw new Error('download returned a JSON error body');
  }
}

/* Bounded, atomic HTTP(S) download. Existing destinations survive any failed
 * response, timeout, content-type rejection, or size-limit breach. */
async function downloadAsset(url, destination, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  if (!fetchImpl) throw new Error('global fetch unavailable — asset downloads need Node 18+');
  const source = sanitizeUrl(url);
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('download maxBytes must be a positive integer');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('download timeoutMs must be a positive integer');
  const temp = `${destination}.part-${process.pid}-${Date.now()}`;
  let fd = null;
  let reader = null;
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const response = await fetchImpl(source, {
      redirect: 'follow',
      headers: opts.headers || {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    (opts.validateContentType || validateDownloadType)(contentType, { destination, source });
    const declaredHeader = response.headers.get('content-length');
    const declared = declaredHeader == null ? null : Number(declaredHeader);
    if (declared != null && Number.isFinite(declared) && declared > maxBytes) throw new Error(`download exceeds ${maxBytes} byte limit`);
    if (!response.body || typeof response.body.getReader !== 'function') throw new Error('download response has no readable body');
    fd = fs.openSync(temp, 'wx');
    reader = response.body.getReader();
    let bytes = 0;
    let prefix = Buffer.alloc(0);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error(`download exceeds ${maxBytes} byte limit`);
      if (prefix.length < 1024) prefix = Buffer.concat([prefix, chunk.subarray(0, 1024 - prefix.length)]);
      fs.writeSync(fd, chunk);
    }
    validateDownloadBody(prefix, { contentType, destination });
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, destination);
    return { path: destination, bytes, contentType, finalUrl: response.url || source };
  } catch (error) {
    if (reader) { try { await reader.cancel(); } catch {} }
    if (fd != null) { try { fs.closeSync(fd); } catch {} }
    try { fs.rmSync(temp, { force: true }); } catch {}
    const why = error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      ? `download timed out after ${timeoutMs}ms` : error.message;
    throw new Error(why);
  }
}

module.exports = {
  ASSET_LOCK_FILE,
  ASSET_LOCK_VERSION,
  CREDIT_FORMATS,
  creditEntries,
  creditLines,
  downloadAsset,
  escapeHtml,
  formatCredits,
  inferKind,
  inspectAsset,
  lockPath,
  readAssetLock,
  normalizeRegistrationMetadata,
  registerAsset,
  registerAssets,
  resolveProjectFile,
  sanitizeUrl,
  sha256,
  sha256File,
  validateDownloadType,
  validateLock,
  unregisterAsset,
  verifyAssets,
  withAssetMutation,
  writeAssetLock,
};
