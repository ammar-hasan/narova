'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveConfig } = require('../src/schema');
const { audioFingerprint, narrationContextDigest } = require('../src/audio-fingerprint');
const { compile } = require('../src/manifest');
const { configFromManifest } = require('../src/pipeline');
const { packProject } = require('../src/project-archive');
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-bound-files-'));
  const old = process.env.NAROVA_HOME;
  process.env.NAROVA_HOME = dir;
  fs.mkdirSync(path.join(dir, 'providers'));
  fs.writeFileSync(path.join(dir, 'providers/fake.json'), JSON.stringify({ name: 'fake',
    protocol: 'narova-tts-provider/v1', command: [process.execPath, '-e', 'process.exit(0)'],
    capabilities: { synthesis: true } }));
  fs.writeFileSync(path.join(dir, 'state.safetensors'), 'first bytes');
  const raw = { voices: { a: { backend: 'fake', speaker: 'alba', providerOptions: { temperature: .3 },
    providerFiles: { voiceState: 'state.safetensors' } } },
    scenes: [{ id: 'one', body: '<p>Hello</p>', vo: [{ who: 'a', text: 'Hello.' }] }] };
  try { return fn(dir, raw); }
  finally { if (old == null) delete process.env.NAROVA_HOME; else process.env.NAROVA_HOME = old;
    fs.rmSync(dir, { recursive: true, force: true }); }
}
test('bound provider bytes invalidate whole and shared reuse at the same path; authored metadata is ignored', () => fixture((dir, raw) => {
  raw.voices.a.providerFileInputs = { voiceState: { path: '/forged', sha256: 'a'.repeat(64) } };
  const first = resolveConfig(raw, {}, dir);
  assert.deepEqual(first.voices.a.providerFileInputs.voiceState, {
    path: path.join(dir, 'state.safetensors'), sha256: crypto.createHash('sha256').update('first bytes').digest('hex'),
  });
  fs.writeFileSync(path.join(dir, 'state.safetensors'), 'second bytes');
  const next = resolveConfig(raw, {}, dir);
  assert.notEqual(audioFingerprint(first), audioFingerprint(next));
  assert.notEqual(narrationContextDigest(first), narrationContextDigest(next));
  assert.equal(audioFingerprint(next), audioFingerprint(resolveConfig(raw, {}, dir)));
}));
test('manifest and reconstructable config retain authored dependencies and current byte evidence', () => fixture((dir, raw) => {
  const config = resolveConfig(raw, {}, dir), manifest = compile(config);
  assert.deepEqual(manifest.voices.a.providerFiles, raw.voices.a.providerFiles);
  assert.deepEqual(manifest.voices.a.providerFileInputs, config.voices.a.providerFileInputs);
  assert.deepEqual(configFromManifest(manifest).voices.a.providerFiles, raw.voices.a.providerFiles);
}));

test('authored dependency identities are replaced with current declared bytes', () => fixture((dir, raw) => {
  fs.mkdirSync(path.join(dir, 'voice'));
  fs.writeFileSync(path.join(dir, 'voice/profile.json'), '{}'); fs.writeFileSync(path.join(dir, 'voice/sample.wav'), 'sample');
  raw.voices.a.providerFiles.voiceState = 'voice/profile.json';
  raw.voices.a.providerDependencyInputs = { voiceState: { 'voice/sample.wav': 'a'.repeat(64) } };
  raw.localResources = ['voice/profile.json', 'voice/sample.wav'];
  raw.localResourceDependencies = { 'voice/profile.json': ['voice/sample.wav'] };
  const resolved = resolveConfig(raw, {}, dir);
  assert.equal(resolved.voices.a.providerDependencyInputs.voiceState['voice/sample.wav'], crypto.createHash('sha256').update('sample').digest('hex'));
}));
test('invalid file inputs fail before reuse with precise field errors', () => fixture((dir, raw) => {
  for (const [files, expected] of [[null, /expected an object/], [[], /expected an object/], [{ voiceState: 'missing' }, /cannot read/],
    [{ voiceState: '.' }, /regular file/], [{ voiceState: 'https:\/\/example.com/state' }, /local file/],
    [{ seed: 'state.safetensors' }, /unsafe or conflicting/], [{ temperature: 'state.safetensors' }, /unsafe or conflicting/],
    [{ constructor: 'state.safetensors' }, /unsafe or conflicting/], [{ 'bad-name': 'state.safetensors' }, /unsafe or conflicting/]]) {
    raw.voices.a.providerFiles = files;
    assert.throws(() => resolveConfig(raw, {}, dir), expected);
  }
  raw.voices.a.backend = 'piper'; raw.voices.a.providerFiles = { state: 'state.safetensors' };
  assert.throws(() => resolveConfig(raw, {}, dir), /requires Pocket TTS or an external/);
}));
test('portable archives reject provider dependencies outside the project', () => fixture((dir, raw) => {
  const project = path.join(dir, 'project'); fs.mkdirSync(project);
  raw.voices.a.providerFiles.voiceState = '../state.safetensors';
  fs.writeFileSync(path.join(project, 'reel.config.json'), JSON.stringify(raw));
  assert.throws(() => packProject({ projectDir: project, raw, config: resolveConfig(raw, {}, project), configFile: path.join(project, 'reel.config.json'), output: path.join(dir, 'file.narova'), productVersion: 'test' }), /outside|escapes|project/i);
}));
