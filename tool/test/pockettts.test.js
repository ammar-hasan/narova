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
async function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-pocket-builtin-'));
  const old = process.env.NAROVA_POCKETTTS_VENV;
  process.env.NAROVA_POCKETTTS_VENV = dir;
  const raw = { voices: { a: { backend: 'pockettts', speaker: 'alba' } }, scenes: [{ id: 'one', vo: [{ who: 'a', text: 'Hello.' }], body: '<p>Hello</p>' }] };
  try { await fn(dir, raw); } finally {
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
  assert.deepEqual(Object.keys(report.data.languages).sort(), ['de', 'en', 'es', 'fr', 'it', 'nl', 'pt']);
  assert.equal(report.data.languages.en, 'english_2026-09');
  for (const model of Object.values(report.data.models)) assert.equal(model.preview, model.layers === 24);
}));

test('Pocket authored file records cannot bypass core hashes, regardless of saved metadata', () => fixture((dir, raw) => {
  const input = path.join(dir, 'state'); fs.writeFileSync(input, 'initial bytes');
  const binding = { path: input, sha256: '0'.repeat(64) };
  for (const name of pocket.FILE_OPTIONS) {
    raw.voices.a.providerOptions = { [name]: binding };
    raw.voices.a.providerFileInputs = { [name]: binding };
    assert.throws(() => resolveConfig(raw, {}, dir), new RegExp(`local resources must use providerFiles.${name}`));
  }
  raw.voices.a.providerOptions = { voiceState: binding };
  const project = path.join(dir, 'reel.config.json'); fs.writeFileSync(project, JSON.stringify(raw));
  for (const args of [['build', '--reuse'], ['pack', '--output', path.join(dir, 'bad.narova')]]) {
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/narova.js'), ...args, '--project', dir, '--json'], { env: process.env, encoding: 'utf8' });
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout + r.stderr, /local resources must use providerFiles.voiceState/);
  }
}));

test('Pocket maxTokens accepts only the documented numeric bound and retains secret containment', () => fixture((dir, raw) => {
  const hashes = [];
  for (const value of [16, 64, 256]) {
    raw.voices.a.providerOptions = { maxTokens: value };
    const config = resolveConfig(raw, {}, dir);
    assert.equal(config.voices.a.providerOptions.maxTokens, value);
    assert.equal(compile(config).voices.a.providerOptions.maxTokens, value);
    hashes.push(audioFingerprint(config));
  }
  assert.equal(new Set(hashes).size, 3);
  for (const value of [15, 257, 64.5, '64', null, true, {}, [], Infinity]) {
    raw.voices.a.providerOptions = { maxTokens: value };
    assert.throws(() => resolveConfig(raw, {}, dir), /maxTokens: expected an integer from 16 to 256/);
  }
  raw.voices.a.providerOptions = { maxTokens: 64, apiKey: 'must-not-be-accepted' };
  assert.throws(() => resolveConfig(raw, {}, dir), /secret-like key/);
  raw.voices.a.providerOptions = { maxTokens: 64, nested: { token: 'secret' } };
  assert.throws(() => resolveConfig(raw, {}, dir), /secret-like key/);
  assert.match(require('../src/providers').jsonCompatibilityError({ maxTokens: 64 }), /secret-like key/);
  raw.voices.a.providerOptions = Object.assign(new Date(), { maxTokens: 64 });
  assert.throws(() => resolveConfig(raw, {}, dir), /plain JSON objects/);
}));

test('Pocket setup rejects base and foreign effective interpreter prefixes before pip', () => fixture((dir) => {
  const foreign = path.join(dir, 'foreign');
  const created = spawnSync('python3', ['-m', 'venv', '--without-pip', foreign], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  const selected = path.join(dir, 'selected'); fs.mkdirSync(path.join(selected, 'bin'), { recursive: true });
  const marker = path.join(dir, 'pip-would-mutate');
  const shim = path.join(selected, 'bin/python');
  fs.writeFileSync(shim, `#!${process.execPath}\nconst c=require('child_process'),fs=require('fs');const args=process.argv.slice(2);if(args.includes('pip')){fs.writeFileSync(${JSON.stringify(marker)},'unsafe');process.exit(9);}if(args[0]==='-c')args[1]=args[1].replace('assert sys.version_info[:2] == (3, 12)','assert True').replace('sys.version_info[:2] != (3, 12)','False');const r=c.spawnSync(process.env.TEST_PREFIX_PYTHON,args,{stdio:'inherit'});process.exit(r.status==null?1:r.status);\n`, { mode: 0o755 });
  for (const target of ['python3', path.join(foreign, 'bin/python')]) {
    const r = spawnSync('bash', [path.resolve(__dirname, '../setup.sh'), '--pockettts'], {
      env: { ...process.env, NAROVA_HOME: dir, NAROVA_SETUP_PYTHON: shim, NAROVA_POCKETTTS_VENV: selected, TEST_PREFIX_PYTHON: target }, encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /must belong to the selected isolated virtual environment/);
    assert.ok(!fs.existsSync(marker), 'pip must not run');
  }
}));

test('Pocket setup neutralizes inherited pip target/prefix/user and configuration before installation', () => fixture(dir => {
  const selected = path.join(dir, 'selected');
  const created = spawnSync('python3', ['-m', 'venv', '--without-pip', selected], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  const real = path.join(selected, 'bin/realpython'); fs.renameSync(path.join(selected, 'bin/python'), real);
  const marker = path.join(dir, 'pip-call.json');
  fs.writeFileSync(path.join(selected, 'bin/python'), `#!${process.execPath}
const fs=require('fs'),c=require('child_process');const args=process.argv.slice(2);
if(args.includes('pip')){fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({args,config:process.env.PIP_CONFIG_FILE}));process.exit(41);}
if(args[0]==='-c')args[1]=args[1].replace('assert sys.version_info[:2] == (3, 12)','assert True').replace('sys.version_info[:2] != (3, 12)','False');
const r=c.spawnSync(${JSON.stringify(real)},args,{stdio:'inherit'});process.exit(r.status==null?1:r.status);
`, { mode: 0o755 });
  const foreign = path.join(dir, 'core'); fs.mkdirSync(foreign);
  const config = path.join(dir, 'redirect.ini'); fs.writeFileSync(config, `[install]\ntarget = ${foreign}\n`);
  const env = { ...process.env, NAROVA_HOME: dir, NAROVA_VENV: foreign, NAROVA_POCKETTTS_VENV: selected, NAROVA_SETUP_PYTHON: path.join(selected, 'bin/python'), PIP_TARGET: foreign, PIP_PREFIX: foreign, PIP_USER: '1', PIP_CONFIG_FILE: config };
  const r = spawnSync('bash', [path.resolve(__dirname, '../setup.sh'), '--pockettts'], { env, encoding: 'utf8' });
  assert.equal(r.status, 41, r.stderr); // intercepted before any pip mutation
  const call = JSON.parse(fs.readFileSync(marker, 'utf8'));
  assert.equal(call.config, '/dev/null');
  assert.ok(call.args.includes('--isolated'));
  // Verify pip's actual option interpretation, not just a recording double.
  const parsed = spawnSync('python3', ['-c', `import json\nfrom pip._internal.commands import create_command\no,a=create_command('install', isolated=True).parse_args(['example==1'])\nprint(json.dumps(dict(target=o.target_dir,prefix=o.prefix_path,root=o.root_path,user=o.use_user_site)))`], { env: { ...env, PIP_CONFIG_FILE: call.config }, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const options = JSON.parse(parsed.stdout);
  assert.equal(options.target, null); assert.equal(options.prefix, null); assert.equal(options.root, null); assert.notEqual(options.user, true);
  assert.deepEqual(fs.readdirSync(foreign), []);
}));

function helperRuntime(dir) {
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin/python'), `#!${process.execPath}
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const mode=process.env.TEST_POCKET_MODE,sub=process.argv[3],args=process.argv.slice(4);
fs.writeFileSync(path.join(__dirname,'../worker.pid'),String(process.pid));
const i=args.indexOf('--output'),output=i<0?null:args[i+1];
if(output)fs.writeFileSync(output,'complete new state');
if(mode==='hang'){process.on('SIGTERM',()=>{});setInterval(()=>{},1000);}
else if(mode==='bad-json')process.stdout.write('not-json');
else if(mode==='stderr-overflow'){process.stderr.write('.'.repeat(1024*1024-12)+process.env.TEST_HELPER_TOKEN.slice(0,12));setTimeout(()=>process.stderr.write(process.env.TEST_HELPER_TOKEN.slice(12)),100);setInterval(()=>{},1000);}
else if(mode.startsWith('descendant-')){
 const cp=require('child_process');const descendant=cp.spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)",path.join(__dirname,'../descendant.pid')],{stdio:'ignore'});descendant.unref();
 const ready=setInterval(()=>{if(!fs.existsSync(path.join(__dirname,'../descendant.pid')))return;clearInterval(ready);if(mode==='descendant-timeout')setInterval(()=>{},1000);else if(mode==='descendant-failed')process.exit(2);else if(mode==='descendant-malformed')process.stdout.write('not-json');else console.log(JSON.stringify({ok:true}));},10);
}
else if(mode==='stderr'){process.stderr.write(process.env.TEST_HELPER_TOKEN.slice(0,8));setTimeout(()=>{process.stderr.write(process.env.TEST_HELPER_TOKEN.slice(8));console.log(JSON.stringify({ok:true}));},20);}
else console.log(JSON.stringify(output?{ok:true,output,sha256:mode==='bad-digest'?'0'.repeat(64):crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')}:{ok:true,model:'english_2026-09'}));
`, { mode: 0o755 });
}

test('Pocket stalled helpers time out, kill resistant children and preserve export destinations', () => fixture((dir) => {
  helperRuntime(dir);
  const dest = path.join(dir, 'voice.state'); fs.writeFileSync(dest, 'previous valid state');
  const env = { ...process.env, TEST_POCKET_MODE: 'hang', NAROVA_PROVIDER_TIMEOUT: '1' };
  delete env.NAROVA_POCKETTTS_TIMEOUT;
  for (const sub of ['doctor', 'export-voice']) {
    const start = Date.now();
    const args = [path.resolve(__dirname, '../bin/narova.js'), 'pockettts', sub, '--json'];
    if (sub === 'export-voice') args.push('--output', dest);
    const r = spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
    assert.equal(r.error, undefined);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /timed out/);
    assert.match(r.stderr, /size unknown/);
    assert.equal(JSON.parse(r.stdout).success, false);
    assert.ok(Date.now() - start < 4000);
    const pid = Number(fs.readFileSync(path.join(dir, 'worker.pid'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    assert.equal(fs.readFileSync(dest, 'utf8'), 'previous valid state');
    assert.ok(!fs.readdirSync(dir).some(name => name.startsWith('.narova-pocket-export-')));
  }
}));

test('Pocket helper deadline selection, heartbeat and failure output are bounded', () => fixture(async dir => {
  helperRuntime(dir);
  assert.equal(pocket.helperTimeoutMs({}), 120000);
  assert.equal(pocket.helperTimeoutMs({ NAROVA_PROVIDER_TIMEOUT: '3' }), 3000);
  assert.equal(pocket.helperTimeoutMs({ NAROVA_PROVIDER_TIMEOUT: '3', NAROVA_POCKETTTS_TIMEOUT: '0.2' }), 200);
  for (const value of ['', '0', '-1', 'Infinity', 'bad', '86401']) assert.throws(() => pocket.helperTimeoutMs({ NAROVA_POCKETTTS_TIMEOUT: value }), /positive finite/);
  const messages = [];
  await assert.rejects(pocket.runPocketHelper('doctor', [], { env: { ...process.env, TEST_POCKET_MODE: 'hang', NAROVA_POCKETTTS_TIMEOUT: '0.2' }, heartbeatMs: 30, diagnostic: text => messages.push(text) }), /timed out/);
  assert.ok(messages.filter(text => /elapsed/.test(text)).length >= 2);
  await assert.rejects(pocket.runPocketHelper('doctor', [], { env: { ...process.env, TEST_POCKET_MODE: 'bad-json' }, diagnostic: () => {} }), /invalid helper result/);
}));

test('Pocket export verifies stage digest before publication and cleans success/failure stages', () => fixture(async dir => {
  helperRuntime(dir);
  const dest = path.join(dir, 'voice.state'); fs.writeFileSync(dest, 'previous valid state');
  const opts = mode => ({ env: { ...process.env, TEST_POCKET_MODE: mode }, diagnostic: () => {} });
  await assert.rejects(pocket.exportPocketVoice(dest, [], opts('bad-digest')), /digest mismatch/);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'previous valid state');
  const result = await pocket.exportPocketVoice(dest, [], opts('success'));
  assert.equal(result.output, dest);
  assert.equal(fs.readFileSync(dest, 'utf8'), 'complete new state');
  assert.ok(!fs.readdirSync(dir).some(name => name.startsWith('.narova-pocket-export-')));
  const alias = path.join(dir, 'alias'); fs.symlinkSync(dest, alias);
  await assert.rejects(pocket.exportPocketVoice(alias, [], opts('success')), /symbolic link/);
}));

test('Pocket machine helper diagnostics redact secrets spanning child output chunks', () => fixture(dir => {
  helperRuntime(dir);
  const secret = 'helper-private-token';
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/narova.js'), 'pockettts', 'doctor', '--json'], { env: { ...process.env, TEST_POCKET_MODE: 'stderr', TEST_HELPER_TOKEN: secret }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).success, true);
  assert.ok(!r.stderr.includes(secret));
  assert.match(r.stderr, /\[REDACTED\]/);
}));

test('Pocket helper exit always stops resistant descendants, including failed and malformed results', () => fixture(dir => {
  helperRuntime(dir);
  const marker = path.join(dir, 'descendant.pid');
  for (const mode of ['descendant-timeout', 'descendant-failed', 'descendant-malformed', 'descendant-success']) {
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    const r = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/narova.js'), 'pockettts', 'doctor', '--json'], { env: { ...process.env, TEST_POCKET_MODE: mode, NAROVA_POCKETTTS_TIMEOUT: '1' }, encoding: 'utf8', timeout: 5000 });
    assert.equal(r.error, undefined);
    assert.equal(JSON.parse(r.stdout).success, mode === 'descendant-success');
    const pid = Number(fs.readFileSync(marker, 'utf8'));
    try { assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); }
    finally { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
}));

test('Pocket over-limit diagnostics never replay truncated credential prefixes', () => fixture(dir => {
  helperRuntime(dir);
  const secret = 'PRIVATE-PREFIX-and-sensitive-tail';
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../bin/narova.js'), 'pockettts', 'doctor', '--json'], { env: { ...process.env, TEST_POCKET_MODE: 'stderr-overflow', TEST_HELPER_TOKEN: secret, NAROVA_POCKETTTS_TIMEOUT: '5' }, encoding: 'utf8', timeout: 7000 });
  assert.equal(r.error, undefined);
  assert.equal(JSON.parse(r.stdout).success, false);
  assert.match(r.stdout + r.stderr, /stderr exceeds 1 MiB/);
  assert.ok(!r.stderr.includes(secret.slice(0,12)));
  assert.ok(r.stderr.length < 10000);
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
