'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FIXTURE = path.join(__dirname, 'fixtures', 'fake-provider-worker.py');
const VIDEO_FIXTURE = path.join(__dirname, 'fixtures', 'fake-video-provider-worker.py');
const BIN = path.join(__dirname, '..', 'bin', 'narova.js');

function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-provider-'));
  const previous = process.env.NAROVA_HOME;
  process.env.NAROVA_HOME = home;
  try {
    const providers = require('../src/providers');
    return fn(home, providers);
  } finally {
    if (previous == null) delete process.env.NAROVA_HOME;
    else process.env.NAROVA_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

function manifest(dir, name = 'fake', mode = 'ok') {
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify({
    name,
    displayName: name.toUpperCase(),
    protocol: 'narova-tts-provider/v1',
    command: [process.env.PYTHON || 'python3', FIXTURE, mode, name],
    requiredEnvironment: [],
    capabilities: { synthesis: true, voiceListing: true, languages: true, wordTimings: false },
  }));
  return file;
}

function videoManifest(dir, name = 'fake-video', mode = 'ok') {
  const file = path.join(dir, `${name}-video.json`);
  fs.writeFileSync(file, JSON.stringify({
    name,
    displayName: `${name.toUpperCase()} Video`,
    protocol: 'narova-video-provider/v1',
    command: [process.env.PYTHON || 'python3', VIDEO_FIXTURE, mode, name],
    requiredEnvironment: [],
    capabilities: { generation: true },
  }));
  return file;
}

test('provider registration normalizes, handshakes, lists, and removes', () => withHome((home, p) => {
  const source = manifest(home);
  const added = p.addProvider(source);
  assert.equal(added.name, 'fake');
  assert.equal(added.protocol, p.PROVIDER_PROTOCOL);
  assert.equal(added.providerVersion, '1.2.3');
  assert.ok(path.isAbsolute(added.command[1]));
  assert.deepEqual(p.listProviders().map(x => x.name), ['fake']);
  assert.equal(p.getProvider('fake').name, 'fake');
  assert.equal(p.removeProvider('fake').name, 'fake');
  assert.equal(p.getProvider('fake'), null);
}));

test('duplicate provider registration is rejected', () => withHome((home, p) => {
  const source = manifest(home);
  p.addProvider(source);
  assert.throws(() => p.addProvider(source), /already registered/);
}));

test('invalid manifests are rejected before registration', () => withHome((home, p) => {
  const badName = JSON.parse(fs.readFileSync(manifest(home), 'utf8'));
  badName.name = '../escape';
  assert.throws(() => p.validateManifest(badName, home), /name/);
  const badProtocol = { ...badName, name: 'fine', protocol: 'narova-tts-provider/v2' };
  assert.throws(() => p.validateManifest(badProtocol, home), /unsupported protocol/);
  const badCommand = { ...badProtocol, protocol: p.PROVIDER_PROTOCOL, command: 'python worker.py' };
  assert.throws(() => p.validateManifest(badCommand, home), /command/);
  const unavailable = { ...badProtocol, protocol: p.PROVIDER_PROTOCOL, command: ['definitely-not-a-real-interpreter'] };
  assert.throws(() => p.validateManifest(unavailable, home), /not found/);
}));

test('doctor reports handshake failure and unsupported worker protocols', () => withHome((home, p) => {
  for (const [mode, pattern] of [['handshake-failure', /unavailable/], ['wrong-protocol', /unsupported protocol/]]) {
    const source = manifest(home, `fake-${mode}`, mode);
    assert.throws(() => p.addProvider(source), pattern);
  }
}));

test('more than one external provider can be registered', () => withHome((home, p) => {
  p.addProvider(manifest(home, 'alpha'));
  p.addProvider(manifest(home, 'beta'));
  assert.deepEqual(p.listProviders().map(x => x.name), ['alpha', 'beta']);
}));

test('speech and video providers share one explicit globally unique registry', () => withHome((home, p) => {
  p.addProvider(manifest(home, 'speech-one'));
  const video = p.addProvider(videoManifest(home, 'video-one'));
  assert.equal(video.protocol, p.VIDEO_PROVIDER_PROTOCOL);
  assert.equal(p.providerKind(video), 'video-generation');
  assert.deepEqual(p.listProviders().map(x => x.name), ['speech-one', 'video-one']);
  assert.deepEqual(p.listProviders(p.TTS_PROVIDER_PROTOCOL).map(x => x.name), ['speech-one']);
  assert.deepEqual(p.listProviders(p.VIDEO_PROVIDER_PROTOCOL).map(x => x.name), ['video-one']);
  assert.equal(p.getSpeechProvider('video-one'), null);
  assert.equal(p.getVideoProvider('video-one').name, 'video-one');

  assert.throws(() => p.addProvider(videoManifest(home, 'speech-one')), /already registered/);
}));

test('video manifests require generation capability and reject speech-only fields', () => withHome((home, p) => {
  const source = videoManifest(home, 'bad-video');
  const value = JSON.parse(fs.readFileSync(source, 'utf8'));
  value.capabilities = { synthesis: true };
  assert.throws(() => p.validateManifest(value, home), /capabilities\.generation/);
  value.capabilities = { generation: true };
  value.deliveryCapabilities = { 'delivery-instruct': 'honored' };
  assert.throws(() => p.validateManifest(value, home), /speech providers/);
}));

test('doctor reports missing required environment without reading a secret value', () => withHome((home, p) => {
  const source = manifest(home, 'needs-env');
  const value = JSON.parse(fs.readFileSync(source, 'utf8'));
  value.requiredEnvironment = ['FAKE_PROVIDER_API_KEY'];
  fs.writeFileSync(source, JSON.stringify(value));
  p.addProvider(source);
  const old = process.env.FAKE_PROVIDER_API_KEY;
  delete process.env.FAKE_PROVIDER_API_KEY;
  try {
    const result = p.doctorProvider('needs-env');
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingEnvironment, ['FAKE_PROVIDER_API_KEY']);
    assert.ok(!JSON.stringify(result).includes('secret-value'));
  } finally {
    if (old != null) process.env.FAKE_PROVIDER_API_KEY = old;
  }
}));

test('stableStringify is deterministic and JSON compatibility rejects secrets', () => withHome((_home, p) => {
  assert.equal(p.stableStringify({ b: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"b":1}');
  assert.equal(p.jsonCompatibilityError({ nested: [1, true, null] }), null);
  assert.match(p.jsonCompatibilityError({ apiKey: 'do-not-store-me' }), /secret-like key/);
  assert.match(p.jsonCompatibilityError({ value: undefined }), /JSON-compatible/);
}));

test('registered environment secrets are detected inside nested string values', () => withHome((_home, p) => {
  const previous = process.env.NAROVA_PROVIDER_SECRET;
  process.env.NAROVA_PROVIDER_SECRET = 'do-not-persist';
  try {
    const provider = { requiredEnvironment: ['NAROVA_PROVIDER_SECRET'] };
    assert.equal(p.containsRequiredEnvironmentValue({ prompt: 'prefix-do-not-persist-suffix' }, provider), true);
    assert.equal(p.containsRequiredEnvironmentValue({ prompt: 'safe' }, provider), false);
  } finally {
    if (previous == null) delete process.env.NAROVA_PROVIDER_SECRET;
    else process.env.NAROVA_PROVIDER_SECRET = previous;
  }
}));

test('provider prose redaction covers every manifest-declared environment value', () => withHome((_home, p) => {
  const previous = process.env.CUSTOM_PROVIDER_VALUE;
  process.env.CUSTOM_PROVIDER_VALUE = 'provider-private-value';
  try {
    const redacted = p.redactProviderText(
      'worker echoed provider-private-value in an error',
      { requiredEnvironment: ['CUSTOM_PROVIDER_VALUE'] },
    );
    assert.equal(redacted, 'worker echoed [REDACTED] in an error');
  } finally {
    if (previous == null) delete process.env.CUSTOM_PROVIDER_VALUE;
    else process.env.CUSTOM_PROVIDER_VALUE = previous;
  }
}));

test('providers and external voice listing are wired through the public CLI', () => withHome((home) => {
  const source = manifest(home, 'fake');
  const run = args => spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NAROVA_HOME: home },
  });
  const added = run(['providers', 'add', source]);
  assert.equal(added.status, 0, added.stderr);
  assert.match(added.stdout, /registered/);
  assert.match(run(['providers', 'list']).stdout, /fake.*narova-tts-provider\/v1/);
  const doctor = run(['providers', 'doctor', 'fake']);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /worker ok: fake 1\.2\.3 speaks/);
  const voices = run(['voices', 'list', '--backend', 'fake']);
  assert.equal(voices.status, 0, voices.stderr);
  assert.match(voices.stdout, /voice-a\s+Voice A/);
  assert.equal(run(['providers', 'remove', 'fake']).status, 0);
}));

test('provider CLI lists and doctors registered video providers by kind', () => withHome((home) => {
  const source = videoManifest(home, 'fake-video');
  const run = args => spawnSync('node', [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NAROVA_HOME: home },
  });
  assert.equal(run(['providers', 'add', source]).status, 0);
  const listed = run(['providers', 'list']);
  assert.match(listed.stdout, /fake-video.*narova-video-provider\/v1.*video generation/);
  const doctor = run(['providers', 'doctor', 'fake-video']);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /worker ok: fake-video 1\.2\.3 speaks narova-video-provider\/v1/);
}));
