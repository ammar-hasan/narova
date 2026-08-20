'use strict';
/* Bind shared build context to one rendered video without making `judge`
 * mutate the project. Build writes one compact receipt beside each primary
 * video; judgement consumes it only when the artifact digest still matches. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

function writeVideoCiBinding(video, { outDir, projectDir } = {}) {
  const artifact = path.resolve(video);
  const output = path.resolve(outDir || path.dirname(artifact));
  const project = path.resolve(projectDir || path.dirname(output));
  const manifestFile = path.join(output, 'manifest.json');
  const timingFile = path.join(output, 'timings.json');
  const receipt = {
    schema: SCHEMA,
    artifact: { path: path.basename(artifact), ...fileIdentity(artifact) },
    context: {
      manifest: snapshotJson(manifestFile, project),
      timings: snapshotJson(timingFile, project),
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

module.exports = { SCHEMA, receiptPath, writeVideoCiBinding };
