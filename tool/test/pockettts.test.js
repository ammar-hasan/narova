'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveConfig } = require('../src/schema');
const { audioFingerprint, narrationContextDigest } = require('../src/audio-fingerprint');
const { compile } = require('../src/manifest');
const { configFromManifest } = require('../src/pipeline');
const { builtinNames, deliveryCapabilitiesFor } = require('../src/tts-backends');
const pocket = require('../src/pockettts');
function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-pocket-builtin-'));
  const old = process.env.NAROVA_POCKETTTS_VENV;
  process.env.NAROVA_POCKETTTS_VENV = dir;
  const raw = { voices: { a: { backend: 'pockettts', speaker: 'alba' } }, scenes: [{ id: 'one', vo: [{ who: 'a', text: 'Hello.' }], body: '<p>Hello</p>' }] };
  try { fn(dir, raw); } finally {
    if (old == null) delete process.env.NAROVA_POCKETTTS_VENV; else process.env.NAROVA_POCKETTTS_VENV = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test('Pocket is built in; registry-free resolution and backend override work with optional runtime absent', () => fixture((dir, raw) => {
  assert.ok(builtinNames().includes('pockettts'));
  const caps = deliveryCapabilitiesFor('pockettts');
  assert.equal(caps['seed-stabilization'], 'honored');
  assert.equal(caps['delivery-instruct'], 'ignored');
  raw.voices.a.providerVersion = 'authored-stale';
  raw.voices.a.providerCapabilities = { surroundingText: true };
  const config = resolveConfig(raw, {}, dir);
  assert.equal(config.voices.a.providerVersion, 'pockettts:runtime-missing');
  assert.equal(config.voices.a.providerCapabilities, undefined);
  raw.voices.a.backend = 'piper';
  assert.equal(resolveConfig(raw, { backend: 'pockettts' }, dir).voices.a.backend, 'pockettts');
}));
test('Pocket pre-reuse file identities survive manifests and change at the same path', () => fixture((dir, raw) => {
  fs.writeFileSync(path.join(dir, 'state'), 'first');
  raw.voices.a.providerFiles = { voiceState: 'state' };
  const first = resolveConfig(raw, {}, dir);
  const projected = configFromManifest(compile(first)).voices.a;
  assert.deepEqual(projected.providerFileInputs, first.voices.a.providerFileInputs);
  assert.deepEqual(projected.providerFiles, raw.voices.a.providerFiles);
  fs.writeFileSync(path.join(dir, 'state'), 'second');
  const second = resolveConfig(raw, {}, dir);
  assert.notEqual(audioFingerprint(first), audioFingerprint(second));
  assert.notEqual(narrationContextDigest(first), narrationContextDigest(second));
  fs.unlinkSync(path.join(dir, 'state'));
  assert.throws(() => resolveConfig(raw, {}, dir), /cannot read local file/);
}));
test('fresh installed runtime profile invalidates whole/shared identities before model use', () => fixture((dir, raw) => {
  fs.mkdirSync(path.join(dir, 'bin'));
  // A recording executable substitutes only the metadata probe, with no
  // interpreter/dependency/model installation or network effects.
  fs.writeFileSync(path.join(dir, 'bin/python'), `#!${process.execPath}\nconst fs=require('fs'),path=require('path');if(process.argv[3]!=='version')process.exit(2);process.stdout.write(JSON.stringify({providerVersion:fs.readFileSync(path.join(__dirname,'../profile'),'utf8')}));\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'profile'), 'profile-first');
  const first = resolveConfig(raw, {}, dir);
  fs.writeFileSync(path.join(dir, 'profile'), 'profile-second');
  const second = resolveConfig(raw, {}, dir);
  assert.equal(second.voices.a.providerVersion, 'profile-second');
  assert.notEqual(audioFingerprint(first), audioFingerprint(second));
  assert.notEqual(narrationContextDigest(first), narrationContextDigest(second));
}));
test('catalog and presets need no Pocket runtime, Python, registration or model access; machine envelope works', () => fixture((dir) => {
  const env = { ...process.env, NAROVA_HOME: dir, NAROVA_POCKETTTS_VENV: dir, NAROVA_PYTHON: '/unavailable/python', HF_HUB_OFFLINE: '1' };
  for (const args of [['pockettts', 'catalog'], ['voices', 'list', '--backend', 'pockettts']]) {
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/narova.js'), ...args], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /alba/);
    assert.doesNotMatch(r.stdout, /undefined/);
  }
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/narova.js'), 'pockettts', 'catalog', '--json'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.operation, 'pockettts catalog');
  assert.equal(pocket.catalog.voices.length, 27);
  assert.equal(Object.keys(pocket.catalog.models).length, 18);
}));
test('Pocket seed remains core-owned and helper failure gives setup guidance', () => fixture((dir, raw) => {
  raw.voices.a.providerOptions = { seed: 123 };
  assert.throws(() => resolveConfig(raw, {}, dir), /core-owned/);
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/narova.js'), 'pockettts', 'doctor'], { env: process.env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /narova-setup --pockettts/);
}));
test('Pocket setup rejects aliased core/chatterbox environment overrides before mutation', () => fixture((dir) => {
  const core = path.join(dir, 'core'); fs.mkdirSync(core);
  const marker = path.join(core, 'existing'); fs.writeFileSync(marker, 'preserve');
  const shim = path.join(dir, 'python-shim');
  // Bypass only the platform-independent 3.12 prerequisite so any CI Python
  // can execute the real path-containment guard; never emulate that guard.
  fs.writeFileSync(shim, `#!${process.execPath}\nconst c=require('child_process');const args=process.argv.slice(2);if(args[0]==='-c'&&args[1].includes('sys.version_info'))process.exit(0);const r=c.spawnSync('python3',args,{stdio:'inherit'});process.exit(r.status==null?1:r.status);\n`, { mode: 0o755 });
  const alias = path.join(dir, 'alias'); fs.symlinkSync(core, alias);
  for (const [pocketDir, other] of [[core, 'NAROVA_VENV'], [alias, 'NAROVA_VENV'], [path.join(core, 'nested'), 'NAROVA_CHATTERBOX_VENV']]) {
    const env = { ...process.env, NAROVA_SETUP_PYTHON: shim, NAROVA_HOME: dir, NAROVA_POCKETTTS_VENV: pocketDir, [other]: core };
    const r = spawnSync('bash', [path.resolve(__dirname, '../setup.sh'), '--pockettts'], { env, encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /must be separate/);
    assert.deepEqual(fs.readdirSync(core), ['existing']);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
  }
}));
test('legacy Pocket registrations never block built-in project commands and can be explicitly removed', () => fixture((dir, raw) => {
  const env = { ...process.env, NAROVA_HOME: dir, NAROVA_POCKETTTS_VENV: dir };
  fs.mkdirSync(path.join(dir, 'providers'));
  const legacy = path.join(dir, 'providers/pockettts.json');
  const project = path.join(dir, 'reel.config.json'); fs.writeFileSync(project, JSON.stringify(raw));
  const cli = args => spawnSync(process.execPath, [path.resolve(__dirname, '../bin/narova.js'), ...args], { env, encoding: 'utf8' });
  for (const content of [JSON.stringify({ name: 'pockettts', protocol: 'narova-tts-provider/v1', command: ['/missing/legacy/worker'], requiredEnvironment: [], capabilities: { synthesis: true }, providerVersion: 'legacy' }), 'invalid legacy json']) {
    fs.writeFileSync(legacy, content);
    const checked = cli(['check', '--project', dir]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.equal(fs.readFileSync(legacy, 'utf8'), content);
    const listed = cli(['providers', 'list']);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /Pocket TTS/);
    const removed = cli(['providers', 'remove', 'pockettts']);
    assert.equal(removed.status, 0, removed.stderr);
    assert.ok(!fs.existsSync(legacy));
  }
}));
