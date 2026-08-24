'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  loadVideoCiBinding, verifyVideoCiBinding, writeVideoCiBinding,
} = require('../src/video-ci-binding');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-video-ci-binding-'));
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  const video = path.join(out, 'video.mp4');
  const bytes = Buffer.from('artifact bytes');
  fs.writeFileSync(video, bytes);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({
    renderer: { provider: 'no-browser', providerVersion: 'test' },
    scenes: [],
  }));
  fs.writeFileSync(path.join(out, 'timings.json'), '{}');
  const receipt = writeVideoCiBinding(video, {
    outDir: out, projectDir: root, sceneState: [],
  });
  const artifact = {
    path: video, bytes: bytes.length, sha256: sha256(bytes),
  };
  return { root, out, video, receipt, artifact };
}

test('shared video CI binding loader returns only an exact artifact-bound receipt', () => {
  const value = fixture();
  try {
    const binding = loadVideoCiBinding(value.artifact, value.out);
    assert.equal(binding.used, true);
    assert.equal(binding.grade, 'RECORDED');
    assert.equal(binding.document.context.manifest.content.renderer.provider, 'no-browser');
    assert.doesNotThrow(() => verifyVideoCiBinding(binding));

    const stale = loadVideoCiBinding({ ...value.artifact, sha256: '0'.repeat(64) }, value.out);
    assert.equal(stale.used, false);
    assert.equal(stale.grade, 'INVALID');
    assert.match(stale.reason, /artifact identity does not match/);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});

test('shared video CI binding verification detects receipt mutation and rejects outside artifacts', () => {
  const value = fixture();
  try {
    const binding = loadVideoCiBinding(value.artifact, value.out);
    fs.appendFileSync(value.receipt, ' ');
    assert.throws(() => verifyVideoCiBinding(binding), /binding changed during analysis/);

    const outside = path.join(value.root, 'outside.mp4');
    fs.writeFileSync(outside, 'outside');
    const unavailable = loadVideoCiBinding({
      path: outside, bytes: 7, sha256: sha256(Buffer.from('outside')),
    }, value.out);
    assert.equal(unavailable.used, false);
    assert.equal(unavailable.grade, 'UNAVAILABLE');
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
});
