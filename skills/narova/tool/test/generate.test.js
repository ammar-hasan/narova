'use strict';
/* Tests for generated-asset provenance: a generated clip persists its full
 * generative specification as a .gen.json sidecar so it survives as an
 * editable creative source, not just an opaque downloaded MP4. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSpec, readSpec, specPathFor, providerInfo } = require('../src/generate');

test('specPathFor maps an artifact to its sidecar path', () => {
  assert.equal(specPathFor('assets/gen-sora-foo.mp4'), 'assets/gen-sora-foo.gen.json');
  assert.equal(specPathFor('clips/take.webm'), 'clips/take.gen.json');
  assert.equal(specPathFor('a/b/c.MOV'), 'a/b/c.gen.json');
});

test('buildSpec captures provider, model, prompt, params, and the artifact hash', () => {
  const info = providerInfo('sora');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  const artifact = path.join(dir, 'gen-sora-x.mp4');
  fs.writeFileSync(artifact, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  const params = { model: 'sora-2', size: '1280x720', duration: 5 };
  const spec = buildSpec('sora', info, 'a rainy city at night', params, 'https://x/v.mp4', artifact, 8);

  assert.equal(spec.kind, 'narova-generate-spec');
  assert.equal(spec.version, 1);
  assert.equal(spec.provider, 'sora');
  assert.equal(spec.providerName, 'OpenAI Sora');
  assert.equal(spec.model, 'sora-2');
  assert.equal(spec.prompt, 'a rainy city at night');
  assert.deepEqual(spec.params, params);
  assert.equal(spec.artifact, 'gen-sora-x.mp4');
  assert.equal(spec.artifactBytes, 8);
  assert.equal(spec.artifactSha256.length, 64);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readSpec round-trips a written sidecar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  const artifact = path.join(dir, 'clip.mp4');
  fs.writeFileSync(artifact, Buffer.from('hi'));
  const info = providerInfo('runway');
  const spec = buildSpec('runway', info, 'kite in storm', { model: 'gen4.5' }, 'https://r/v.mp4', artifact, 2);
  fs.writeFileSync(specPathFor(artifact), JSON.stringify(spec));
  const back = readSpec(artifact);
  assert.equal(back.prompt, 'kite in storm');
  assert.equal(back.provider, 'runway');
  assert.equal(back.model, 'gen4.5');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readSpec returns null when no sidecar exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  const artifact = path.join(dir, 'lonely.mp4');
  fs.writeFileSync(artifact, 'x');
  assert.equal(readSpec(artifact), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSpec captures null model when params omit it (regeneration still works)', () => {
  const info = providerInfo('sora');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  const artifact = path.join(dir, 'g.mp4');
  fs.writeFileSync(artifact, 'x');
  const spec = buildSpec('sora', info, 'p', {}, 'u', artifact, 1);
  assert.equal(spec.model, null);
  assert.deepEqual(spec.params, {});
  fs.rmSync(dir, { recursive: true, force: true });
});
