'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveConfig } = require('../src/schema');
const { audioFingerprint } = require('../src/pipeline');
const { compile } = require('../src/manifest');

function withRegisteredProvider(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-external-config-'));
  const dir = path.join(home, 'providers');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'fake.json'), JSON.stringify({
    name: 'fake',
    displayName: 'Fake Cloud',
    protocol: 'narova-tts-provider/v1',
    providerVersion: '1.2.3',
    command: [process.execPath, '-e', 'process.exit(0)'],
    requiredEnvironment: ['FAKE_API_KEY'],
    capabilities: { synthesis: true, voiceListing: false, languages: true, wordTimings: false },
  }));
  const old = process.env.NAROVA_HOME;
  process.env.NAROVA_HOME = home;
  try { return fn(home); }
  finally {
    if (old == null) delete process.env.NAROVA_HOME;
    else process.env.NAROVA_HOME = old;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const raw = options => ({
  voices: {
    narrator: {
      backend: 'fake',
      speaker: 'voice-id',
      providerOptions: options,
    },
  },
  scenes: [{
    id: 'scene',
    body: '<p>Hello</p>',
    vo: [{ who: 'narrator', text: 'Welcome to Narova.', lang: 'en' }],
  }],
});

test('registered external provider resolves with opaque options and version metadata', () => withRegisteredProvider(() => {
  const options = { stability: 0.45, nested: { enabled: true } };
  const config = resolveConfig(raw(options), {}, os.tmpdir());
  assert.deepEqual(config.voices.narrator.providerOptions, options);
  assert.equal(config.voices.narrator.providerProtocol, 'narova-tts-provider/v1');
  assert.equal(config.voices.narrator.providerVersion, '1.2.3');
  const voice = compile(config).voices.narrator;
  assert.deepEqual(voice.providerOptions, options);
  assert.equal(voice.providerVersion, '1.2.3');
}));

test('providerOptions must be JSON-compatible and cannot contain likely secrets', () => withRegisteredProvider(() => {
  assert.throws(() => resolveConfig(raw({ bad: undefined }), {}, os.tmpdir()), /JSON-compatible/);
  assert.throws(() => resolveConfig(raw({ apiKey: 'never-here' }), {}, os.tmpdir()), /secret-like key/);
  assert.throws(() => resolveConfig(raw(['not', 'an', 'object']), {}, os.tmpdir()), /expected a JSON-compatible object/);
  process.env.FAKE_API_KEY = 'environment-only-secret';
  try {
    assert.throws(
      () => resolveConfig(raw({ innocuousName: 'environment-only-secret' }), {}, os.tmpdir()),
      /keep secrets out of reel\.config\.mjs/,
    );
  } finally {
    delete process.env.FAKE_API_KEY;
  }
}));

test('audio fingerprints sort provider options and change with provider synthesis inputs', () => withRegisteredProvider(() => {
  const first = resolveConfig(raw({ stability: 0.45, nested: { b: 2, a: 1 } }), {}, os.tmpdir());
  const reordered = resolveConfig(raw({ nested: { a: 1, b: 2 }, stability: 0.45 }), {}, os.tmpdir());
  const changed = resolveConfig(raw({ nested: { a: 1, b: 2 }, stability: 0.5 }), {}, os.tmpdir());
  assert.equal(audioFingerprint(first), audioFingerprint(reordered));
  assert.notEqual(audioFingerprint(first), audioFingerprint(changed));
  changed.voices.narrator.providerVersion = '1.2.4';
  assert.notEqual(audioFingerprint(first), audioFingerprint(changed));
}));

test('an unregistered external provider fails with a registration hint', () => withRegisteredProvider(() => {
  const config = raw({});
  config.voices.narrator.backend = 'ghost';
  assert.throws(() => resolveConfig(config, {}, os.tmpdir()), /unregistered external provider/);
}));
