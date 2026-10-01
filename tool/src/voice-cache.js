'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const SCHEMA = 'narova.voice-cache/1';
const MAX_BYTES = 64 * 1024 * 1024, MAX_ENTRIES = 10000;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const cacheDir = () => path.resolve(process.env.NAROVA_CACHE || path.join(process.env.NAROVA_HOME || path.join(os.homedir(), '.narova'), 'cache', 'sentences'));
function regular(file, limit = MAX_BYTES) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || stat.size === 0) throw new Error(`voice cache: expected a bounded regular file: ${file}`);
  return fs.readFileSync(file);
}
function wavFacts(bytes) {
  if (bytes.length < 44 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) !== bytes.length - 8) throw new Error('voice cache: invalid WAV envelope');
  let fmt = false, frames = null;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('voice cache: truncated WAV chunk');
    const type = bytes.toString('latin1', offset, offset + 4), length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (start + length > bytes.length) throw new Error('voice cache: truncated WAV payload');
    if (type === 'fmt ') {
      if (fmt || length < 16 || bytes.readUInt16LE(start) !== 1 || bytes.readUInt16LE(start + 2) !== 1 || bytes.readUInt32LE(start + 4) !== 22050 || bytes.readUInt32LE(start + 8) !== 44100 || bytes.readUInt16LE(start + 12) !== 2 || bytes.readUInt16LE(start + 14) !== 16) throw new Error('voice cache: sentence must be mono 22050 Hz signed-16-bit PCM');
      fmt = true;
    }
    if (type === 'data') {
      if (!fmt || frames !== null || !length || length % 2) throw new Error('voice cache: invalid WAV samples');
      frames = length / 2;
    }
    offset = start + length + (length % 2);
    if (offset > bytes.length) throw new Error('voice cache: missing WAV padding');
  }
  if (!fmt || frames === null) throw new Error('voice cache: missing WAV data or format');
  return { sampleRate: 22050, channels: 1, sampleWidth: 2, frames, duration: frames / 22050 };
}
function exportCache(outDir, bundleDir) {
  outDir = path.resolve(outDir); bundleDir = path.resolve(bundleDir);
  if (fs.existsSync(bundleDir) || (() => { try { fs.lstatSync(bundleDir); return true; } catch { return false; } })()) throw new Error('voice cache: export destination already exists; choose a new directory');
  const takes = JSON.parse(regular(path.join(outDir, 'audio', 'takes.json'), 4 * 1024 * 1024));
  if (!Array.isArray(takes) || !takes.length || takes.length > MAX_ENTRIES) throw new Error('voice cache: no supported sentence takes; synthesize with the current CLI first');
  const entries = new Map();
  let totalBytes = 0;
  // Validate all inputs before creating a bundle. Source paths are fixed to the
  // durable take directory; executable/provider configuration is never copied.
  for (const take of takes) {
    if (!/^[a-f0-9]{40}$/.test(take.cacheKey) || !/^audio\/sentences\/\d+_\d+\.wav$/.test(take.file)) throw new Error('voice cache: invalid take key or sentence path');
    const source = path.join(outDir, take.file);
    const relativeReal = path.relative(fs.realpathSync(outDir), fs.realpathSync(source));
    if (relativeReal.startsWith('..') || path.isAbsolute(relativeReal)) throw new Error('voice cache: source escapes output directory');
    const bytes = regular(source), facts = wavFacts(bytes), sha256 = hash(bytes);
    if (!/^[a-f0-9]{64}$/.test(take.sha256) || take.sha256 !== sha256) throw new Error('voice cache: sentence bytes do not match the completed take record; synthesize successfully before export');
    if (entries.has(take.cacheKey) && entries.get(take.cacheKey).sha256 !== sha256) throw new Error('voice cache: same key identifies different current takes');
    if (!entries.has(take.cacheKey)) totalBytes += bytes.length;
    if (totalBytes > 512 * 1024 * 1024) throw new Error('voice cache: bundle exceeds 512 MiB');
    entries.set(take.cacheKey, { key: take.cacheKey, file: `${take.cacheKey}.wav`, sha256, bytes, ...facts });
  }
  fs.mkdirSync(path.dirname(bundleDir), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(bundleDir), '.voice-cache-export-'));
  try {
    const records = [...entries.values()].sort((a, b) => a.key.localeCompare(b.key));
    for (const entry of records) fs.writeFileSync(path.join(stage, entry.file), entry.bytes);
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ schema: SCHEMA, entries: records.map(({ bytes, ...entry }) => ({ ...entry, bytes: bytes.length })) }, null, 2) + '\n');
    fs.renameSync(stage, bundleDir);
    return { dir: bundleDir, entries: records.length, bytes: records.reduce((n, e) => n + e.bytes.length, 0) };
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
function importCache(bundleDir, { overwrite = false } = {}) {
  bundleDir = path.resolve(bundleDir);
  if (!fs.lstatSync(bundleDir).isDirectory() || fs.lstatSync(bundleDir).isSymbolicLink()) throw new Error('voice cache: bundle must be a real directory');
  const manifest = JSON.parse(regular(path.join(bundleDir, 'manifest.json'), 4 * 1024 * 1024));
  if (manifest.schema !== SCHEMA || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > MAX_ENTRIES) throw new Error('voice cache: unsupported or invalid manifest');
  const expectedFiles = new Set(['manifest.json', ...manifest.entries.map(e => e.file)]);
  if (fs.readdirSync(bundleDir).some(name => !expectedFiles.has(name))) throw new Error('voice cache: unexpected bundle member');
  const seen = new Set(), records = [];
  let totalBytes = 0;
  for (const entry of manifest.entries) {
    if (!/^[a-f0-9]{40}$/.test(entry.key) || entry.file !== `${entry.key}.wav` || !/^[a-f0-9]{64}$/.test(entry.sha256) || seen.has(entry.key)) throw new Error('voice cache: invalid or duplicate entry');
    seen.add(entry.key);
    const bytes = regular(path.join(bundleDir, entry.file)), facts = wavFacts(bytes);
    if (hash(bytes) !== entry.sha256 || bytes.length !== entry.bytes || Object.entries(facts).some(([key, value]) => entry[key] !== value)) throw new Error(`voice cache: integrity mismatch for ${entry.key}`);
    totalBytes += bytes.length;
    if (totalBytes > 512 * 1024 * 1024) throw new Error('voice cache: bundle exceeds 512 MiB');
    records.push({ ...entry, bytes });
  }
  const destination = cacheDir();
  const changes = records.filter(entry => {
    const file = path.join(destination, entry.file);
    try {
      const existing = regular(file);
      entry.priorDigest = hash(existing);
      if (entry.priorDigest === entry.sha256) return false;
      if (!overwrite) throw new Error(`voice cache: conflicting entry ${entry.key}; pass --overwrite to replace`);
      return true;
    } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  });
  fs.mkdirSync(destination, { recursive: true });
  const stage = fs.mkdtempSync(path.join(destination, '.import-'));
  const committed = [];
  try {
    for (const entry of changes) fs.writeFileSync(path.join(stage, entry.file), entry.bytes);
    for (const entry of changes) {
      const target = path.join(destination, entry.file), backup = path.join(stage, entry.file + '.prior');
      const prior = fs.existsSync(target);
      if (prior) {
        if (!entry.priorDigest || hash(regular(target)) !== entry.priorDigest) throw new Error('voice cache: destination changed during import');
        fs.renameSync(target, backup);
      } else if (entry.priorDigest) throw new Error('voice cache: destination disappeared during import');
      committed.push({ target, backup, prior });
      fs.renameSync(path.join(stage, entry.file), target);
    }
  } catch (error) {
    for (const { target, backup, prior } of committed.reverse()) {
      fs.rmSync(target, { force: true });
      if (prior) fs.renameSync(backup, target);
    }
    throw error;
  } finally { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} }
  return { dir: destination, entries: records.length, imported: changes.length, reused: records.length - changes.length };
}
module.exports = { exportCache, importCache, wavFacts, cacheDir, SCHEMA };
