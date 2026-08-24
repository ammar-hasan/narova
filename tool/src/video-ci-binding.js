'use strict';
/* Bind shared build context to one rendered video without making `judge`
 * mutate the project. Build writes one compact receipt beside each primary
 * video; judgement consumes it only when the artifact digest still matches. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  SCHEMA: SCENE_STATE_SCHEMA,
  ID_RE,
  receiptEntries,
  validateSceneStateDocument,
} = require('./scene-state');

const SCHEMA = 'narova.video-ci-evidence/1';
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_RECEIPT_BYTES = MAX_SNAPSHOT_BYTES * 3;

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, sha256: sha256Bytes(bytes) };
}

function fileSha256(file) {
  const digest = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest('hex');
}

function receiptPath(video) {
  return `${video}.narova-ci.json`;
}

function snapshotJson(file, project) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const bytes = fs.readFileSync(file);
  const identity = { path: path.relative(project, file), bytes: bytes.length, sha256: sha256Bytes(bytes) };
  if (bytes.length > MAX_SNAPSHOT_BYTES) return { ...identity, available: false, reason: 'source exceeds snapshot bound' };
  try { return { ...identity, available: true, content: JSON.parse(bytes.toString('utf8')) }; }
  catch { return { ...identity, available: false, reason: 'source is not valid JSON' }; }
}

function snapshotText(file, project, format) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const bytes = fs.readFileSync(file);
  const identity = { path: path.relative(project, file), bytes: bytes.length, sha256: sha256Bytes(bytes), format };
  if (bytes.length > MAX_SNAPSHOT_BYTES) return { ...identity, available: false, reason: 'source exceeds snapshot bound' };
  return { ...identity, available: true, content: bytes.toString('utf8') };
}

function validateBindingSource(source, kind, { optional = false } = {}) {
  if (source == null && optional) return;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(`${kind} binding source is not an object`);
  }
  const allowed = new Set(['path', 'bytes', 'sha256', 'available', 'format', 'content', 'reason']);
  const unknown = Object.keys(source).filter(key => !allowed.has(key));
  if (unknown.length) throw new Error(`${kind} binding source has unsupported field: ${unknown[0]}`);
  if (typeof source.path !== 'string' || !source.path
      || !Number.isInteger(source.bytes) || source.bytes < 0
      || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
      || typeof source.available !== 'boolean') {
    throw new Error(`${kind} binding source identity is invalid`);
  }
  if (source.available && !Object.hasOwn(source, 'content')) {
    throw new Error(`${kind} binding source has no canonical content`);
  }
  if (kind === 'caption' && source.available && typeof source.content !== 'string') {
    throw new Error('caption binding source content is not text');
  }
}

function validateSceneStateContext(entries) {
  if (!Array.isArray(entries)) throw new Error('binding sceneState is not an array');
  const scenes = new Set();
  entries.forEach((entry, index) => {
    const at = `sceneState[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).some(key => !['scene', 'source'].includes(key))) {
      throw new Error(`${at} binding entry is invalid`);
    }
    if (typeof entry.scene !== 'string' || !ID_RE.test(entry.scene) || scenes.has(entry.scene)) {
      throw new Error(`${at}.scene binding identity is invalid or duplicate`);
    }
    scenes.add(entry.scene);
    validateBindingSource(entry.source, 'scene-state');
    if (path.isAbsolute(entry.source.path) || entry.source.path.split(/[\\/]/).includes('..')) {
      throw new Error(`${at}.source.path is not project-relative`);
    }
    if (!entry.source.available || entry.source.format !== SCENE_STATE_SCHEMA) {
      throw new Error(`${at}.source is not an available ${SCENE_STATE_SCHEMA} snapshot`);
    }
    const checked = validateSceneStateDocument(entry.source.content, `${at}.source.content`);
    if (checked.errors.length) throw new Error(checked.errors[0]);
  });
}

function validateBindingContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error('binding context is invalid');
  }
  // Preserve the original Judge fallback contract for older/partial receipts:
  // manifest and timings may be absent, while every present snapshot remains
  // strict. Privileged Witness simply stays unavailable without a manifest.
  validateBindingSource(context.manifest, 'manifest', { optional: true });
  validateBindingSource(context.timings, 'timings', { optional: true });
  if (context.sceneState != null) validateSceneStateContext(context.sceneState);
  if (!Array.isArray(context.captions)) throw new Error('binding captions are not an array');
  context.captions.forEach(source => validateBindingSource(source, 'caption'));
}

function inside(root, file) {
  const canonical = value => {
    try { return fs.realpathSync(value); }
    catch { return path.resolve(value); }
  };
  const relative = path.relative(canonical(root), canonical(file));
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function loadVideoCiBinding(artifact, outDir) {
  const candidate = receiptPath(artifact.path);
  if (!inside(outDir, artifact.path) || !inside(outDir, candidate)) {
    return { available: false, used: false, path: null, grade: 'UNAVAILABLE', reason: 'selected artifact has no project-output evidence binding' };
  }
  if (!fs.existsSync(candidate)) {
    return { available: false, used: false, path: candidate, grade: 'UNAVAILABLE', reason: 'no evidence binding exists for the selected artifact' };
  }
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile() || stat.size > MAX_RECEIPT_BYTES) throw new Error('binding is not a bounded regular file');
    const document = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    if (document.schema !== SCHEMA) throw new Error('binding schema is unsupported');
    if (!document.artifact || document.artifact.sha256 !== artifact.sha256
        || document.artifact.bytes !== artifact.bytes
        || document.artifact.path !== path.basename(artifact.path)) {
      throw new Error('binding artifact identity does not match the selected bytes');
    }
    validateBindingContext(document.context);
    return {
      available: true, used: true, path: candidate, grade: 'RECORDED',
      sha256: fileSha256(candidate), document,
    };
  } catch (error) {
    return { available: true, used: false, path: candidate, grade: 'INVALID', reason: error.message };
  }
}

function verifyVideoCiBinding(binding) {
  let current = null;
  try {
    if (binding && binding.used && binding.path && binding.sha256) current = fileSha256(binding.path);
  } catch { /* Normalize disappearance and replacement to one freshness failure. */ }
  if (!binding || !binding.used || !binding.path || !binding.sha256 || current !== binding.sha256) {
    throw new Error('video CI evidence binding changed during analysis');
  }
  return binding;
}

function writeVideoCiBinding(video, {
  outDir, projectDir, config = null, sceneState: suppliedSceneState = null,
} = {}) {
  const artifact = path.resolve(video);
  const output = path.resolve(outDir || path.dirname(artifact));
  const project = path.resolve(projectDir || path.dirname(output));
  const manifestFile = path.join(output, 'manifest.json');
  const timingFile = path.join(output, 'timings.json');
  const sceneState = suppliedSceneState == null
    ? receiptEntries(config)
    : JSON.parse(JSON.stringify(suppliedSceneState));
  validateSceneStateContext(sceneState);
  const receipt = {
    schema: SCHEMA,
    artifact: { path: path.basename(artifact), ...fileIdentity(artifact) },
    context: {
      manifest: snapshotJson(manifestFile, project),
      timings: snapshotJson(timingFile, project),
      sceneState,
      captions: [
        snapshotText(path.join(output, 'captions.vtt'), project, 'vtt'),
        snapshotText(path.join(output, 'captions.srt'), project, 'srt'),
      ].filter(Boolean),
    },
  };
  const destination = receiptPath(artifact);
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return destination;
}

module.exports = {
  SCHEMA, loadVideoCiBinding, receiptPath, validateBindingContext,
  validateSceneStateContext, verifyVideoCiBinding, writeVideoCiBinding,
};
