'use strict';

/* A passing proof is useful only when its rendered evidence still belongs to
 * the exact config, manifest, timings, and frame files being snapshotted. */
const fs = require('node:fs');
const path = require('node:path');
const { sha256, hashConfig, hashFile, buildHashes } = require('./manifest');
const { projectIdentity } = require('./releases');

const RECEIPT = '.proof-receipt.json';

function receiptPath(outDir) { return path.join(outDir, RECEIPT); }

function sameHashMap(left, right) {
  if (!left || typeof left !== 'object' || Array.isArray(left)
      || !right || typeof right !== 'object' || Array.isArray(right)) return false;
  const ordered = value => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

function sourceHashesMatch(config, outDir) {
  const manifestFile = path.join(outDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const projectDir = config.projectDir || path.resolve(outDir, '..');
  return sameHashMap(manifest.hashes, buildHashes(config, projectDir));
}

function relativeRecord(outDir, file) {
  const absolute = path.resolve(file);
  const relative = path.relative(outDir, absolute);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep)) {
    throw new Error(`proof artifact is outside the output directory: ${file}`);
  }
  const sha256 = hashFile(absolute);
  if (!sha256) throw new Error(`proof artifact is missing: ${file}`);
  return { path: relative, sha256 };
}

function writeProofReceipt(config, outDir, evidenceFiles, frameFiles) {
  const manifest = path.join(outDir, 'manifest.json');
  const timings = path.join(outDir, 'timings.json');
  const resolvedConfig = path.join(outDir, 'config.resolved.json');
  if (!fs.existsSync(manifest) || !fs.existsSync(timings) || !fs.existsSync(resolvedConfig)) {
    throw new Error('proof receipt needs config.resolved.json, manifest.json, and timings.json');
  }
  if (!sourceHashesMatch(config, outDir)) {
    throw new Error('project sources changed while rendering proof');
  }
  const receipt = {
    version: 2,
    created: new Date().toISOString(),
    projectIdentity: projectIdentity(config.projectDir || path.resolve(outDir, '..')),
    configSha256: hashConfig(config),
    configResolvedSha256: hashFile(resolvedConfig),
    manifestSha256: hashFile(manifest),
    timingsSha256: hashFile(timings),
    evidence: (evidenceFiles || []).map(file => relativeRecord(outDir, file)),
    frames: (frameFiles || []).map(file => relativeRecord(outDir, file)),
  };
  if (!receipt.evidence.length || !receipt.frames.length) {
    throw new Error('proof receipt needs both a contact sheet and audited frames');
  }
  fs.writeFileSync(receiptPath(outDir), JSON.stringify(receipt, null, 2));
  return receipt;
}

function verifyRecords(outDir, records, label) {
  if (!Array.isArray(records) || !records.length) return `${label} are missing`;
  for (const record of records) {
    if (!record || typeof record.path !== 'string' || typeof record.sha256 !== 'string') return `${label} receipt is malformed`;
    const file = path.resolve(outDir, record.path);
    const relative = path.relative(outDir, file);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep)) return `${label} path escapes the output directory`;
    if (hashFile(file) !== record.sha256) return `${label} changed after proof review`;
  }
  return null;
}

function verifyProofReceipt(config, outDir) {
  const file = receiptPath(outDir);
  if (!fs.existsSync(file)) return { ok: false, reason: 'no successful proof receipt found' };
  try {
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (receipt.version !== 2) return { ok: false, reason: 'proof receipt version is unsupported' };
    if (receipt.projectIdentity !== projectIdentity(config.projectDir || path.resolve(outDir, '..'))) {
      return { ok: false, reason: 'proof receipt belongs to another project' };
    }
    if (receipt.configSha256 !== hashConfig(config)) return { ok: false, reason: 'project config changed after proof review' };
    if (receipt.configResolvedSha256 !== hashFile(path.join(outDir, 'config.resolved.json'))) return { ok: false, reason: 'resolved config changed after proof review' };
    if (receipt.manifestSha256 !== hashFile(path.join(outDir, 'manifest.json'))) return { ok: false, reason: 'manifest changed after proof review' };
    if (receipt.timingsSha256 !== hashFile(path.join(outDir, 'timings.json'))) return { ok: false, reason: 'timings changed after proof review' };
    if (!sourceHashesMatch(config, outDir)) return { ok: false, reason: 'project source assets changed after proof review' };
    const evidenceError = verifyRecords(outDir, receipt.evidence, 'proof evidence');
    if (evidenceError) return { ok: false, reason: evidenceError };
    const frameError = verifyRecords(outDir, receipt.frames, 'audited proof frames');
    if (frameError) return { ok: false, reason: frameError };
    return {
      ok: true,
      receipt,
      evidenceFiles: receipt.evidence.map(record => path.resolve(outDir, record.path)),
      frameFiles: receipt.frames.map(record => path.resolve(outDir, record.path)),
    };
  } catch (error) {
    return { ok: false, reason: `proof receipt is invalid: ${error.message}` };
  }
}

function safeArtifact(rootDir, relative) {
  if (typeof relative !== 'string' || !relative.trim()) return null;
  const file = path.resolve(rootDir, relative);
  const rel = path.relative(rootDir, file);
  return rel && rel !== '..' && !rel.startsWith('..' + path.sep) ? file : null;
}

function snapshotHashes(dir) {
  const hashes = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else hashes[path.relative(dir, file)] = hashFile(file);
    }
  }
  visit(dir);
  return hashes;
}

function stableManifestHash(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.project && typeof manifest.project === 'object') delete manifest.project.created;
  return sha256(JSON.stringify(manifest));
}

function snapshotContentIdentity(dir) {
  const hashes = snapshotHashes(dir);
  if (hashes['manifest.json']) hashes['manifest.json'] = stableManifestHash(path.join(dir, 'manifest.json'));
  return sha256(JSON.stringify(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b))));
}

function proofContentIdentity(receipt, manifestFile) {
  const hashes = records => (records || []).map(record => record.sha256).sort();
  return sha256(JSON.stringify({
    version: receipt.version,
    projectIdentity: receipt.projectIdentity,
    configSha256: receipt.configSha256,
    configResolvedSha256: receipt.configResolvedSha256,
    manifest: stableManifestHash(manifestFile),
    timingsSha256: receipt.timingsSha256,
    evidence: hashes(receipt.evidence),
    frames: hashes(receipt.frames),
  }));
}

/* Preserve the complete reviewed proof outside the authored release namespace.
 * The portable receipt points at copied resolved config, manifest, timings,
 * contact sheets, and every audited frame. Snapshot hashes additionally bind
 * all editable source/assets in the release that can later be restored. */
function writeProofBundle(outDir, verified, metadataDir, snapshotDir) {
  if (!verified || !verified.ok || !verified.receipt) throw new Error('proof bundle needs a verified receipt');
  const receipt = verified.receipt;
  const finalDir = path.join(metadataDir, 'proof');
  const staging = fs.mkdtempSync(path.join(metadataDir, '.proof-staging-'));
  const finalRef = relative => path.join('proof', relative);
  try {
    const copyIdentity = (sourceName, destName, expectedSha256) => {
      const source = path.join(outDir, sourceName);
      if (!fs.existsSync(source)) throw new Error(`proof ${sourceName} is missing`);
      if (hashFile(source) !== expectedSha256) throw new Error(`proof ${sourceName} changed while saving proof`);
      const destination = path.join(staging, destName);
      fs.copyFileSync(source, destination);
      if (hashFile(destination) !== expectedSha256) throw new Error(`proof ${sourceName} changed while copying proof`);
      return finalRef(destName);
    };
    const copyRecords = (records, kind, prefix) => {
      const dir = path.join(staging, kind);
      fs.mkdirSync(dir, { recursive: true });
      return records.map((record, index) => {
        const source = safeArtifact(outDir, record.path);
        if (!source || hashFile(source) !== record.sha256) throw new Error(`${kind} changed while saving proof`);
        const ext = path.extname(record.path) || '.bin';
        const name = `${prefix}-${String(index + 1).padStart(2, '0')}${ext.toLowerCase()}`;
        const destination = path.join(dir, name);
        fs.copyFileSync(source, destination);
        if (hashFile(destination) !== record.sha256) throw new Error(`${kind} changed while copying proof`);
        return { path: finalRef(path.join(kind, name)), sha256: record.sha256 };
      });
    };
    const portable = {
      version: receipt.version,
      created: receipt.created,
      projectIdentity: receipt.projectIdentity,
      configSha256: receipt.configSha256,
      configResolvedSha256: receipt.configResolvedSha256,
      manifestSha256: receipt.manifestSha256,
      timingsSha256: receipt.timingsSha256,
      configPath: copyIdentity('config.resolved.json', 'config.resolved.json', receipt.configResolvedSha256),
      manifestPath: copyIdentity('manifest.json', 'manifest.json', receipt.manifestSha256),
      timingsPath: copyIdentity('timings.json', 'timings.json', receipt.timingsSha256),
      evidence: copyRecords(receipt.evidence, 'evidence', 'contact-sheet'),
      frames: copyRecords(receipt.frames, 'frames', 'frame'),
    };
    const receiptFile = path.join(staging, 'receipt.json');
    fs.writeFileSync(receiptFile, JSON.stringify(portable, null, 2));
    const snapshot = snapshotHashes(snapshotDir);
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(staging, finalDir);
    return {
      proofReceipt: finalRef('receipt.json'),
      proofReceiptSha256: hashFile(path.join(finalDir, 'receipt.json')),
      proofIdentity: proofContentIdentity(portable, path.join(finalDir, 'manifest.json')),
      snapshotIdentity: snapshotContentIdentity(snapshotDir),
      snapshotHashes: snapshot,
      evidence: portable.evidence.map(record => record.path),
      evidenceHashes: Object.fromEntries(portable.evidence.map(record => [record.path, record.sha256])),
    };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function verifyProofBundle(metadataDir, snapshotDir, branch, expectedProjectIdentity = null) {
  try {
    const receiptFile = safeArtifact(metadataDir, branch && branch.proofReceipt);
    if (!receiptFile || hashFile(receiptFile) !== branch.proofReceiptSha256) return false;
    const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    if (receipt.version !== 2 || typeof receipt.projectIdentity !== 'string') return false;
    if (branch.projectIdentity !== receipt.projectIdentity) return false;
    if (expectedProjectIdentity && receipt.projectIdentity !== expectedProjectIdentity) return false;
    const configFile = safeArtifact(metadataDir, receipt.configPath);
    const manifestFile = safeArtifact(metadataDir, receipt.manifestPath);
    const timingsFile = safeArtifact(metadataDir, receipt.timingsPath);
    if (!configFile || !manifestFile || !timingsFile) return false;
    if (branch.proofIdentity !== proofContentIdentity(receipt, manifestFile)) return false;
    if (hashFile(configFile) !== receipt.configResolvedSha256) return false;
    if (hashConfig(JSON.parse(fs.readFileSync(configFile, 'utf8'))) !== receipt.configSha256) return false;
    if (hashFile(manifestFile) !== receipt.manifestSha256 || hashFile(timingsFile) !== receipt.timingsSha256) return false;
    if (hashFile(path.join(snapshotDir, 'manifest.json')) !== receipt.manifestSha256) return false;
    if (hashFile(path.join(snapshotDir, 'timings.json')) !== receipt.timingsSha256) return false;
    if (verifyRecords(metadataDir, receipt.evidence, 'proof evidence')) return false;
    if (verifyRecords(metadataDir, receipt.frames, 'audited proof frames')) return false;
    const proofRoot = path.dirname(receiptFile);
    const inventory = [receiptFile, configFile, manifestFile, timingsFile,
      ...receipt.evidence.map(record => safeArtifact(metadataDir, record.path)),
      ...receipt.frames.map(record => safeArtifact(metadataDir, record.path))];
    if (inventory.some(file => !file)) return false;
    const expectedProofPaths = inventory.map(file => path.relative(proofRoot, file)).sort();
    if (expectedProofPaths.some(relative => !relative || relative === '..' || relative.startsWith('..' + path.sep))) return false;
    const actualProofPaths = Object.keys(snapshotHashes(proofRoot)).sort();
    if (JSON.stringify(actualProofPaths) !== JSON.stringify(expectedProofPaths)) return false;
    const expected = branch.snapshotHashes;
    if (!expected || typeof expected !== 'object' || !Object.keys(expected).length) return false;
    const actual = snapshotHashes(snapshotDir);
    const expectedPaths = Object.keys(expected).sort();
    const actualPaths = Object.keys(actual).sort();
    if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) return false;
    for (const [relative, sha256] of Object.entries(expected)) {
      if (typeof sha256 !== 'string' || actual[relative] !== sha256) return false;
    }
    if (branch.snapshotIdentity !== snapshotContentIdentity(snapshotDir)) return false;
    return true;
  } catch { return false; }
}

function clearProofReceipt(outDir) {
  fs.rmSync(receiptPath(outDir), { force: true });
}

module.exports = {
  RECEIPT, receiptPath, writeProofReceipt, verifyProofReceipt, clearProofReceipt,
  writeProofBundle, verifyProofBundle,
  _internals: { stableManifestHash, snapshotContentIdentity, proofContentIdentity },
};
