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

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return { bytes: bytes.length, sha256: sha256Bytes(bytes) };
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

function validateBindingSource(source, kind) {
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
  SCHEMA, receiptPath, writeVideoCiBinding, validateSceneStateContext,
};
