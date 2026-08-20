'use strict';
/* Agent machine protocol (CHANGE-2026-030 / NAR-015-070..073). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REGISTRY } = require('../src/diagnostic-codes');
const { resolveConfig } = require('../src/schema');
const { audioFingerprint, timingsFingerprint } = require('../src/audio-fingerprint');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, 'tool', 'bin', 'narova.js');
const PROTOCOL = path.join(ROOT, 'AGENT_PROTOCOL.md');
const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], {
  encoding: 'utf8',
  env: { ...process.env, NAROVA_FIRST_RUN: '0', ...(opts.env || {}) },
  ...opts,
});
const canRender = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && (() => { try { require.resolve('@napi-rs/canvas'); return true; } catch { return false; } })();

function envelope(result) {
  assert.ok(result.stdout.trim(), `missing envelope; stderr=${result.stderr}`);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.schema, 'narova.result/1');
  assert.equal(parsed.success, result.status === 0);
  assert.equal(parsed.exit.code, result.status);
  assert.ok(['success', 'operation-failure', 'usage-error', 'subject-non-pass'].includes(parsed.exit.class));
  assert.equal(typeof parsed.data, 'object');
  assert.equal(Array.isArray(parsed.data), false);
  assert.ok(Array.isArray(parsed.diagnostics));
  assert.ok(Array.isArray(parsed.artifacts));
  for (const diagnostic of parsed.diagnostics) {
    assert.ok(['info', 'warning', 'error'].includes(diagnostic.severity));
    assert.ok(Object.hasOwn(REGISTRY, diagnostic.code), diagnostic.code);
    assert.equal(typeof diagnostic.message, 'string');
  }
  for (const artifact of parsed.artifacts) {
    assert.equal(typeof artifact.path, 'string');
    assert.ok(artifact.path);
    assert.equal(typeof artifact.role, 'string');
    assert.ok(artifact.role);
  }
  return parsed;
}

test('success, usage error, operation failure, and subject non-pass have distinct envelopes', () => {
  const success = run(['--version', '--json']);
  assert.equal(success.status, 0);
  assert.equal(envelope(success).exit.class, 'success');
  assert.match(success.stderr.trim(), /^\d+\.\d+\.\d+$/);

  const emptyAssignment = run(['--version', '--json=']);
  assert.equal(emptyAssignment.status, 0);
  assert.equal(envelope(emptyAssignment).operation, 'version');

  const versionIgnoresIrrelevantFlags = run(['--version', '--fps', '0', '--json']);
  assert.equal(versionIgnoresIrrelevantFlags.status, 0);
  assert.equal(envelope(versionIgnoresIrrelevantFlags).operation, 'version');
  const helpIgnoresIrrelevantFlags = run(['help', '--size', 'bananas', '--json']);
  assert.equal(helpIgnoresIrrelevantFlags.status, 0);
  assert.equal(envelope(helpIgnoresIrrelevantFlags).operation, 'help');

  assert.equal(envelope(run(['-h', '--json'])).operation, 'help');
  const nestedUsage = envelope(run(['assets', 'list', '--project', '--json']));
  assert.equal(nestedUsage.operation, 'assets list');
  assert.equal(nestedUsage.exit.class, 'usage-error');
  const optionValue = envelope(run(['--project', 'check', '--definitely-not-an-option', '--json']));
  assert.equal(optionValue.operation, null);

  const usage = run(['check', '--definitely-not-an-option', '--json']);
  assert.equal(usage.status, 2);
  const usageResult = envelope(usage);
  assert.equal(usageResult.operation, 'check');
  assert.equal(usageResult.exit.class, 'usage-error');
  assert.equal(usageResult.diagnostics[0].code, 'usage.invalid');

  const missing = path.join(os.tmpdir(), `narova-missing-${process.pid}-${Date.now()}`);
  const failure = run(['check', '--project', missing, '--json']);
  assert.equal(failure.status, 1);
  assert.equal(envelope(failure).exit.class, 'operation-failure');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-subject-'));
  const project = path.join(dir, 'project');
  assert.equal(run(['init', project]).status, 0);
  const asset = path.join(project, 'assets', 'x.jpg');
  fs.writeFileSync(asset, 'original');
  assert.equal(run(['assets', 'import', 'assets/x.jpg', '--project', project]).status, 0);
  fs.writeFileSync(asset, 'tampered');
  const nonPass = run(['assets', 'verify', '--project', project, '--json']);
  assert.equal(nonPass.status, 3);
  const nonPassResult = envelope(nonPass);
  assert.equal(nonPassResult.exit.class, 'subject-non-pass');
  assert.equal(nonPassResult.diagnostics[0].code, 'audit.assets.verify');
});

test('successful project operations expose data and created artifacts without stdout prose', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-project-'));
  const project = path.join(root, 'project');
  const initialized = run(['init', project, '--json']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const initResult = envelope(initialized);
  assert.equal(initResult.operation, 'init');
  assert.equal(initResult.data.dir, project);
  assert.ok(initResult.artifacts.some(item => item.role === 'authoring-source'));

  const compiled = run(['compile', '--project', project, '--json']);
  assert.equal(compiled.status, 0, compiled.stderr);
  const compileResult = envelope(compiled);
  assert.equal(compileResult.operation, 'compile');
  assert.ok(compileResult.data.scenes > 0);
  assert.ok(compileResult.artifacts.some(item => item.role === 'manifest'));
  assert.ok(compileResult.artifacts.filter(item => item.role === 'stage-input').length >= 2);

  for (const args of [
    ['check', '--project', project],
    ['critique', 'all', '--project', project],
    ['plan', '--project', project],
    ['provenance', '--project', project],
    ['diff', '--project', project],
    ['history', 'list', '--project', project],
    ['assets', 'list', '--project', project],
    ['assets', 'verify', '--project', project],
    ['assets', 'credits', '--project', project],
    ['review', '--coverage', '--project', project],
    ['preview', '--stop', '--project', project],
  ]) {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    envelope(result);
  }
});

test('every public command can return a pre-dispatch usage envelope and is documented', () => {
  const commands = [
    'init', 'demo', 'pack', 'open', 'remix', 'ingest', 'assets', 'compile', 'check', 'critique',
    'walkthrough', 'plan', 'provenance', 'diff', 'history', 'release', 'branch',
    'render', 'synth', 'compose', 'captions', 'review', 'shots', 'build', 'preview',
    'renderers', 'voices', 'providers', 'voice', 'doctor', 'karaoke', 'retime',
    'generate',
  ];
  const protocol = fs.readFileSync(PROTOCOL, 'utf8');
  const defaults = {
    walkthrough: 'walkthrough status', release: 'release list', branch: 'branch list',
    history: 'history list', providers: 'providers list', renderers: 'renderers list',
    voices: 'voices list',
  };
  for (const command of commands) {
    const result = run([command, '--machine-protocol-probe', '--json']);
    assert.equal(result.status, 2, command);
    const parsed = envelope(result);
    assert.equal(parsed.operation, defaults[command] || command, command);
    assert.match(protocol, new RegExp(`\\b${command.replace('-', '\\-')}\\b`), `${command} missing from protocol`);
  }
});

test('public operation handlers preserve stdout purity under controlled dispatch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-sweep-'));
  const project = path.join(root, 'project');
  assert.equal(run(['init', project]).status, 0);
  assert.equal(run(['compile', '--project', project]).status, 0);
  const missing = path.join(root, 'missing-project');
  const cases = [
    { operation: 'help', args: ['help'] },
    { operation: 'version', args: ['--version'] },
    { operation: 'init', args: ['init'] },
    { operation: 'pack', args: ['pack', '--project', project, '--output', path.join(root, 'project.narova')] },
    { operation: 'open', args: ['open'] },
    { operation: 'remix', args: ['remix'] },
    { operation: 'ingest', args: ['ingest'] },
    { operation: 'assets providers', args: ['assets', 'providers'] },
    { operation: 'assets search', args: ['assets', 'search', 'x', '--provider', 'wikimedia', '--limit', '0'] },
    { operation: 'assets list', args: ['assets', 'list', '--project', project] },
    { operation: 'assets verify', args: ['assets', 'verify', '--project', project] },
    { operation: 'assets credits', args: ['assets', 'credits', '--project', project] },
    { operation: 'assets import', args: ['assets', 'import', '--project', project] },
    { operation: 'assets download', args: ['assets', 'download', 'https://example.test/x', '--project', project] },
    { operation: 'assets acquire', args: ['assets', 'acquire', 'x', '--output', 'assets/x.jpg', '--project', project] },
    { operation: 'assets untrack', args: ['assets', 'untrack', '--project', project] },
    { operation: 'compile', args: ['compile', '--project', project] },
    { operation: 'check', args: ['check', '--project', project] },
    { operation: 'critique', args: ['critique', 'all', '--project', project] },
    { operation: 'walkthrough status', args: ['walkthrough', 'status', '--project', project] },
    { operation: 'plan', args: ['plan', '--project', project] },
    { operation: 'provenance', args: ['provenance', '--project', project] },
    { operation: 'diff', args: ['diff', '--project', project] },
    { operation: 'history list', args: ['history', 'list', '--project', project] },
    { operation: 'history annotate', args: ['history', 'annotate', '--project', project] },
    { operation: 'history compare', args: ['history', 'compare', '--project', project] },
    { operation: 'release list', args: ['release', 'list', '--project', project] },
    { operation: 'release save', args: ['release', 'save', '--project', missing] },
    { operation: 'release restore', args: ['release', 'restore', '--project', project] },
    { operation: 'release remove', args: ['release', 'remove', '--project', project] },
    { operation: 'branch list', args: ['branch', 'list', '--project', project] },
    { operation: 'branch save', args: ['branch', 'save', '--project', project] },
    { operation: 'branch set', args: ['branch', 'set', '--project', project] },
    { operation: 'branch show', args: ['branch', 'show', '--project', project] },
    { operation: 'render', args: ['render'] },
    { operation: 'synth', args: ['synth', '--project', missing] },
    { operation: 'compose', args: ['compose', '--project', project] },
    { operation: 'captions', args: ['captions', '--project', project] },
    { operation: 'review', args: ['review', '--coverage', '--project', project] },
    { operation: 'shots', args: ['shots', '--project', project] },
    { operation: 'preview', args: ['preview', '--stop', '--project', project] },
    { operation: 'renderers list', args: ['renderers', 'list'] },
    { operation: 'renderers doctor', args: ['renderers', 'doctor', 'unknown'] },
    { operation: 'voices list', args: ['voices', 'list', '--project', project] },
    { operation: 'voices get', args: ['voices', 'get', '--project', project] },
    { operation: 'providers list', args: ['providers', 'list'] },
    { operation: 'providers add', args: ['providers', 'add'] },
    { operation: 'providers remove', args: ['providers', 'remove'] },
    { operation: 'providers doctor', args: ['providers', 'doctor'] },
    { operation: 'voice', args: ['voice'] },
    { operation: 'voice sample list', args: ['voice', 'sample', 'list'] },
    { operation: 'voice sample add', args: ['voice', 'sample', 'add'] },
    { operation: 'voice sample remove', args: ['voice', 'sample', 'remove'] },
    { operation: 'doctor', args: ['doctor', '--project', project] },
    { operation: 'karaoke generate', args: ['karaoke', 'generate'] },
    { operation: 'retime', args: ['retime'] },
    { operation: 'generate', args: ['generate'] },
  ];
  for (const item of cases) {
    const result = run([...item.args, '--json']);
    assert.ok([0, 1, 2, 3].includes(result.status), `${item.operation}: ${result.stderr}`);
    const parsed = envelope(result);
    assert.equal(parsed.operation, item.operation, item.operation);
  }
});

test('diagnostic registry and protocol document stay synchronized', () => {
  const protocol = fs.readFileSync(PROTOCOL, 'utf8');
  const registrySection = protocol.split('## Diagnostic code registry')[1].split('## Canonical agent loop')[0];
  const documented = [...registrySection.matchAll(/^\| `([^`]+)` \|/gm)].map(match => match[1]).sort();
  assert.deepEqual(documented, Object.keys(REGISTRY).sort());

  const sources = [
    fs.readFileSync(path.join(ROOT, 'tool', 'bin', 'narova.js'), 'utf8'),
    fs.readFileSync(path.join(ROOT, 'tool', 'src', 'check.js'), 'utf8'),
  ].join('\n');
  const emitted = new Set([
    ...[...sources.matchAll(/mDiag\([^,]+,\s*'([^']+)'/g)].map(match => match[1]),
    ...[...sources.matchAll(/return '((?:gate|check)\.[^']+)'/g)].map(match => match[1]),
  ]);
  for (const code of emitted) assert.ok(Object.hasOwn(REGISTRY, code), code);
});

test('schema-1 consumers can ignore additive fields', () => {
  const parsed = envelope(run(['--version', '--json']));
  const future = { ...parsed, additiveExample: { ignored: true } };
  const consumer = ({ schema, operation, success, data }) => ({ schema, operation, success, data });
  assert.deepEqual(consumer(future), consumer(parsed));
});

test('machine envelopes redact secret-shaped environment values', () => {
  const secret = `narova-machine-secret-${process.pid}`;
  const result = run([
    'check', '--project', path.join(os.tmpdir(), secret, 'missing'), '--json',
  ], { env: { ...process.env, NAROVA_TEST_SECRET: secret, NAROVA_FIRST_RUN: '0' } });
  assert.equal(result.status, 1);
  envelope(result);
  assert.doesNotMatch(result.stdout, new RegExp(secret));
  assert.match(result.stdout, /\[REDACTED\]/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-provider-'));
  const worker = path.join(dir, 'worker.js');
  fs.writeFileSync(worker, [
    "let input = '';",
    "process.stdin.on('data', chunk => { input += chunk; });",
    "process.stdin.on('end', () => process.stdout.write(JSON.stringify({",
    "  ok: true, protocol: 'narova-tts-provider/v1', provider: 'redaction-test',",
    "  providerVersion: '1.0.0', apiKey: 'credential-from-worker',",
    "  session: process.env.ACME_LICENSE,",
    "}) + '\\n'));",
  ].join('\n'));
  const manifest = path.join(dir, 'provider.json');
  fs.writeFileSync(manifest, JSON.stringify({
    name: 'redaction-test', protocol: 'narova-tts-provider/v1',
    command: [process.execPath, worker, '--api-key=credential-from-manifest'],
    requiredEnvironment: ['ACME_LICENSE'], capabilities: { synthesis: true, voiceListing: true },
  }));
  const env = {
    ...process.env,
    NAROVA_HOME: path.join(dir, 'home'), NAROVA_FIRST_RUN: '0',
    ACME_LICENSE: 'arbitrary-provider-credential',
  };
  const added = run(['providers', 'add', manifest, '--json'], { env });
  assert.equal(added.status, 0, added.stderr);
  const addedEnvelope = envelope(added);
  assert.equal(Object.hasOwn(addedEnvelope.data.provider, 'command'), false);
  assert.doesNotMatch(added.stdout, /credential-from-manifest/);
  const doctor = run(['providers', 'doctor', 'redaction-test', '--json'], { env });
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorEnvelope = envelope(doctor);
  assert.deepEqual(Object.keys(doctorEnvelope.data.hello).sort(), ['protocol', 'provider', 'providerVersion']);
  assert.doesNotMatch(doctor.stdout, /credential-from-worker|arbitrary-provider-credential/);
  const listed = run(['providers', 'list', '--json'], { env });
  assert.equal(listed.status, 0, listed.stderr);
  const listedEnvelope = envelope(listed);
  assert.equal(Object.hasOwn(listedEnvelope.data.providers[0], 'command'), false);
  assert.doesNotMatch(listed.stdout, /credential-from-manifest/);

  const inlineWorker = path.join(dir, 'inline-worker.js');
  fs.writeFileSync(inlineWorker, [
    "process.stdin.resume();",
    "process.stdin.on('end', () => {",
    "  const args = process.argv.slice(2);",
    "  const header = args[args.indexOf('--header') + 1] || '';",
    "  const valueOnly = header.split(':').slice(1).join(':').trim();",
    "  console.log(JSON.stringify({ ok: false, error: `bad credential ${args.join(' ')} ${valueOnly}` }));",
    "});",
  ].join('\n'));
  const inlineManifest = path.join(dir, 'inline-provider.json');
  fs.writeFileSync(inlineManifest, JSON.stringify({
    name: 'inline-redaction-test', protocol: 'narova-tts-provider/v1',
    command: [
      process.execPath, inlineWorker,
      '--api-key=inline-provider-secret',
      '--header=Authorization: Bearer header-provider-secret',
      '--header', 'X-API-Key: separated-header-secret',
    ],
    capabilities: { synthesis: true },
  }));
  const inlineFailure = run(['providers', 'add', inlineManifest, '--json'], { env });
  assert.equal(inlineFailure.status, 1);
  assert.doesNotMatch(inlineFailure.stdout + inlineFailure.stderr, /inline-provider-secret|header-provider-secret|separated-header-secret/);
  assert.match(inlineFailure.stdout + inlineFailure.stderr, /\[REDACTED\]/);

  fs.writeFileSync(worker, [
    "const readline = require('readline');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    "  const request = JSON.parse(line);",
    "  if (request.operation === 'hello') console.log(JSON.stringify({ ok: true, protocol: 'narova-tts-provider/v1', provider: 'redaction-test', providerVersion: '1.0.0' }));",
    "  else if (request.operation === 'listVoices') console.log(JSON.stringify({ ok: true, voices: [{ id: process.env.ACME_LICENSE, name: process.env.ACME_LICENSE }] }));",
    "});",
  ].join('\n'));
  const voices = run(['voices', 'list', '--backend', 'redaction-test', '--json'], { env });
  assert.equal(voices.status, 0, voices.stderr);
  envelope(voices);
  assert.doesNotMatch(voices.stdout + voices.stderr, /arbitrary-provider-credential/);
  assert.match(voices.stdout + voices.stderr, /\[REDACTED\]/);

  fs.writeFileSync(worker, [
    "const readline = require('readline');",
    "readline.createInterface({ input: process.stdin }).on('line', line => {",
    "  const request = JSON.parse(line);",
    "  if (request.operation === 'hello') console.log(JSON.stringify({ ok: true, protocol: 'narova-tts-provider/v1', provider: 'redaction-test', providerVersion: '1.0.0' }));",
    "  else console.log(JSON.stringify({ ok: false, error: 'upstream unavailable' }));",
    "});",
  ].join('\n'));
  const voiceFailure = run(['voices', 'list', '--backend', 'redaction-test', '--json'], { env });
  assert.equal(voiceFailure.status, 1);
  assert.equal(envelope(voiceFailure).exit.class, 'operation-failure');

  const signedUrl = 'https://alice:hunter2@example.test/v1?X-Amz-Credential=acme%2Fscope&X-Amz-Signature=signed-secret&mode=test';
  const urlResult = run([signedUrl, '--json']);
  assert.equal(urlResult.status, 2);
  const urlEnvelope = envelope(urlResult);
  assert.doesNotMatch(urlResult.stdout, /alice|hunter2|acme|signed-secret/);
  assert.match(urlEnvelope.operation, /%5BREDACTED%5D/);
  assert.doesNotMatch(urlEnvelope.operation, /mode=test/);
  assert.match(urlEnvelope.operation, /mode=%5BREDACTED%5D/);

  const oauthUrl = 'https://example.test/callback?code=oauth-secret&state=session-state';
  const oauthResult = run([oauthUrl, '--json']);
  assert.equal(oauthResult.status, 2);
  assert.doesNotMatch(oauthResult.stdout, /oauth-secret|session-state/);
  const fragmentUrl = 'https://example.test/callback#access_token=fragment-secret&state=session-state';
  const fragmentResult = run([fragmentUrl, '--json']);
  assert.equal(fragmentResult.status, 2);
  assert.doesNotMatch(fragmentResult.stdout, /fragment-secret|session-state/);

  fs.writeFileSync(worker, [
    "process.stdin.resume();",
    "process.stdin.on('end', () => process.stdout.write(JSON.stringify({",
    "  ok: false, error: `bad license ${process.env.ACME_LICENSE}`",
    "}) + '\\n'));",
  ].join('\n'));
  const failedDoctor = run(['providers', 'doctor', 'redaction-test', '--json'], { env });
  assert.equal(failedDoctor.status, 1);
  assert.doesNotMatch(failedDoctor.stdout, /arbitrary-provider-credential/);
  assert.match(failedDoctor.stdout, /\[REDACTED\]/);

  const shortSecret = run(['providers', 'doctor', 'redaction-test', '--json'], {
    env: { ...env, ACME_LICENSE: 'a' },
  });
  assert.equal(shortSecret.status, 1);
  assert.equal(envelope(shortSecret).schema, 'narova.result/1');
  assert.doesNotMatch(shortSecret.stdout + shortSecret.stderr, /bad license a(?:\s|"|$)/);
  assert.match(shortSecret.stdout + shortSecret.stderr, /\[REDACTED\]/);
});

(process.platform === 'win32' ? test.skip : test)('machine synthesis redacts inherited child stderr', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-synth-redaction-'));
  const project = path.join(root, 'project');
  assert.equal(run(['init', project]).status, 0);
  const fakePython = path.join(project, '.venv', 'bin', 'python');
  fs.mkdirSync(path.dirname(fakePython), { recursive: true });
  fs.writeFileSync(fakePython, '#!/bin/sh\nprintf "%s\\n" "$NAROVA_TEST_SECRET" >&2\nexit 1\n');
  fs.chmodSync(fakePython, 0o755);
  const secret = `synth-child-secret-${process.pid}`;
  const result = run(['synth', '--project', project, '--json'], {
    env: { ...process.env, NAROVA_TEST_SECRET: secret, NAROVA_FIRST_RUN: '0' },
  });
  assert.equal(result.status, 1);
  envelope(result);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secret));
  assert.match(result.stderr, /\[REDACTED\]/);
});

(process.platform === 'win32' ? test.skip : test)('machine synthesis registers an explicitly selected provider secret', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-synth-provider-'));
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  assert.equal(run(['init', project]).status, 0);
  const worker = path.join(root, 'worker.js');
  fs.writeFileSync(worker, "process.stdin.resume();\nprocess.stdin.on('end', () => console.log(JSON.stringify({ ok: true, protocol: 'narova-tts-provider/v1', provider: 'override-redaction', providerVersion: '1.0.0' })));\n");
  const manifest = path.join(root, 'provider.json');
  fs.writeFileSync(manifest, JSON.stringify({
    name: 'override-redaction', protocol: 'narova-tts-provider/v1',
    command: [process.execPath, worker], requiredEnvironment: ['OVERRIDE_LICENSE'],
    capabilities: { synthesis: true },
  }));
  const env = {
    ...process.env, NAROVA_HOME: home, NAROVA_FIRST_RUN: '0',
    OVERRIDE_LICENSE: `override-provider-secret-${process.pid}`,
  };
  assert.equal(run(['providers', 'add', manifest], { env }).status, 0);
  const fakePython = path.join(project, '.venv', 'bin', 'python');
  fs.mkdirSync(path.dirname(fakePython), { recursive: true });
  fs.writeFileSync(fakePython, '#!/bin/sh\nprintf "%s\\n" "$OVERRIDE_LICENSE" >&2\nexit 1\n');
  fs.chmodSync(fakePython, 0o755);
  const result = run(['synth', '--backend', 'override-redaction', '--project', project, '--json'], { env });
  assert.equal(result.status, 1);
  envelope(result);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(env.OVERRIDE_LICENSE));
  assert.match(result.stderr, /\[REDACTED\]/);
});

(process.platform === 'win32' ? test.skip : test)('a signal-terminated voices process is an operation failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-voices-signal-'));
  const project = path.join(root, 'project');
  const fakePython = path.join(project, '.venv', 'bin', 'python');
  fs.mkdirSync(path.dirname(fakePython), { recursive: true });
  fs.writeFileSync(fakePython, '#!/bin/sh\nkill -TERM $$\n');
  fs.chmodSync(fakePython, 0o755);
  const result = run(['voices', 'list', '--project', project, '--json']);
  assert.equal(result.status, 1);
  assert.equal(envelope(result).exit.class, 'operation-failure');
});

test('a no-op branch set does not claim an artifact write', () => {
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-branch-noop-'));
  const name = 'existing';
  fs.mkdirSync(path.join(releases, name), { recursive: true });
  fs.writeFileSync(path.join(releases, name, 'manifest.json'), '{}');
  const metadataDir = path.join(releases, '.branches', name);
  fs.mkdirSync(metadataDir, { recursive: true });
  fs.writeFileSync(path.join(metadataDir, 'branch.json'), JSON.stringify({
    created: new Date(0).toISOString(), status: 'candidate', rationale: 'already recorded', evidence: [],
  }));
  const result = run(['branch', 'set', name, '--json'], {
    env: { ...process.env, NAROVA_RELEASES_DIR: releases, NAROVA_FIRST_RUN: '0' },
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = envelope(result);
  assert.equal(parsed.artifacts.some(item => item.role === 'branch-metadata'), false);
});

test('machine help bypasses first-run interaction and provisioning output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-first-run-'));
  const result = run(['--json'], {
    env: { ...process.env, NAROVA_HOME: path.join(dir, 'home'), NAROVA_FIRST_RUN: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed = envelope(result);
  assert.equal(parsed.operation, 'help');
  assert.doesNotMatch(result.stderr, /First video in one command|What would you like to make|Checking this machine/);
});

test('failed first demo reports the reusable project it retained', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-demo-failure-'));
  const result = run(['demo', '--json'], {
    cwd,
    env: { ...process.env, PATH: '', NAROVA_FIRST_RUN: '0' },
  });
  assert.equal(result.status, 3, result.stderr);
  const parsed = envelope(result);
  assert.equal(parsed.data.created, true);
  assert.ok(parsed.artifacts.some(item => item.role === 'project'));
  assert.ok(parsed.artifacts.some(item => item.role === 'authoring-source'));
});

test('malformed recognized option values are usage errors', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-port-'));
  fs.writeFileSync(path.join(project, 'reel.config.json'), JSON.stringify({
    title: 'Port validation', voices: {},
    scenes: [{ id: 'one', dur: 1, vo: [], body: '<div>one</div>' }],
  }));
  const out = path.join(project, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(out, 'audio', 'full.wav'), 'RIFFfake');
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
    total: 1, one: { dur: 1, turns: [], words: [] },
  }));
  const result = run(['preview', '--detach', '--port', 'nope', '--project', project, '--json']);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(envelope(result).diagnostics[0].code, 'usage.invalid');
  assert.equal(fs.existsSync(path.join(out, 'hf-port-validation')), false);

  const noBrowser = JSON.parse(fs.readFileSync(path.join(project, 'reel.config.json'), 'utf8'));
  noBrowser.renderer = 'no-browser';
  fs.writeFileSync(path.join(project, 'reel.config.json'), JSON.stringify(noBrowser));
  const conflicting = run(['preview', '--detach', '--project', project, '--json']);
  assert.equal(conflicting.status, 2, conflicting.stderr);
  assert.equal(envelope(conflicting).diagnostics[0].code, 'usage.invalid');

  for (const args of [
    ['check', '--tempo', 'nope', '--project', project],
    ['check', '--platform', 'myspace', '--project', project],
    ['check', '--renderer', 'imaginary', '--project', project],
    ['check', '--variant', 'missing', '--project', project],
    ['check', '--fps', '0', '--project', project],
    ['check', '--quality', 'lossless', '--project', project],
    ['check', '--size', 'bananas', '--project', project],
    ['karaoke', 'generate', '/missing.wav', '--max-words', '1.5'],
    ['generate', 'prompt', '--duration', 'never'],
    ['generate', 'prompt', '--provider', 'sora', '--duration', '5'],
  ]) {
    const malformed = run([...args, '--json']);
    assert.equal(malformed.status, 2, `${args.join(' ')}: ${malformed.stderr}`);
    assert.equal(envelope(malformed).diagnostics[0].code, 'usage.invalid');
  }

  const generationSize = run(['generate', 'prompt', '--size', '1280x720', '--project', project, '--json'], {
    env: { ...process.env, OPENAI_API_KEY: '' },
  });
  assert.equal(generationSize.status, 1, generationSize.stderr);
  assert.equal(envelope(generationSize).exit.class, 'operation-failure');
});

test('compile does not claim an untouched stale restore marker', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-stale-marker-'));
  fs.writeFileSync(path.join(project, 'reel.config.json'), JSON.stringify({
    title: 'Stale marker', voices: {},
    scenes: [{ id: 'one', dur: 1, vo: [], body: '<div>one</div>' }],
  }));
  const out = path.join(project, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, '.restored-manifest.json'), JSON.stringify({ manifestSha256: 'stale' }));
  const result = run(['compile', '--project', project, '--json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(envelope(result).artifacts.some(item => item.role === 'compatibility-state'), false);
});

test('handler-level malformed asset options are usage errors', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-assets-'));
  const project = path.join(dir, 'project');
  assert.equal(run(['init', project]).status, 0);
  fs.writeFileSync(path.join(project, 'assets', 'bad.jpg'), 'bad');
  for (const args of [
    ['assets', 'acquire', 'item', '--kind', 'image', '--output', 'assets/x.jpg', '--project', project],
    ['assets', 'search', 'sunset', '--provider', 'wikimedia', '--kind', 'image', '--limit', '0'],
    ['assets', 'providers', '--pack', 'imaginary'],
    ['assets', 'credits', '--format', 'yaml', '--project', project],
    ['assets', 'import', 'assets/bad.jpg', '--source-page', 'file:///bad', '--project', project],
  ]) {
    const result = run([...args, '--json']);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.equal(envelope(result).diagnostics[0].code, 'usage.invalid');
  }
});

test('release gates use one condition in human prose and machine diagnostics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-gate-'));
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({
    title: 'Gate', voices: {},
    scenes: [{ id: 'empty', dur: 1, vo: [], body: '<div></div>' }],
  }));
  const human = run(['check', '--release', '--project', dir]);
  assert.equal(human.status, 3);
  assert.match(human.stdout, /black frame/);
  const result = run(['check', '--release', '--project', dir, '--json']);
  assert.equal(result.status, 3);
  const parsed = envelope(result);
  assert.ok(parsed.diagnostics.some(item => item.code === 'gate.release.black-frame'));
  assert.match(result.stderr, /black frame/);
});

(canRender ? test : test.skip)('failed builds report only stages committed by this invocation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-partial-build-'));
  const wav = path.join(dir, 'narration.wav');
  assert.equal(spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=0.5',
    '-ar', '48000', '-ac', '1', wav,
  ]).status, 0);
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify([
    { start: 0.05, end: 0.45, text: 'Built.', words: [{ text: 'Built.', start: 0.05, end: 0.45 }] },
  ]));
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({
    title: 'Partial build', size: { w: 160, h: 90 }, renderer: 'no-browser', chrome: false,
    narration: { file: 'narration.wav', wordTimings: 'words.json' },
    voices: { a: { speaker: 'external', color: '#ffffff' } },
    scenes: [{
      id: 'one', dur: 0.5, vo: [{ who: 'a', text: 'Built.' }],
      visual: { type: 'text', text: 'BUILT', style: { color: '#ffffff', background: '#000000' } },
    }],
  }));

  // The absolute Node executable still launches the CLI, while an empty PATH
  // makes the later FFmpeg encode fail after stage inputs, timings, audio, and
  // captions have committed.
  const result = run(['build', '--project', dir, '--json'], {
    env: { ...process.env, PATH: '', NAROVA_FIRST_RUN: '0' },
  });
  assert.equal(result.status, 1, result.stderr);
  const parsed = envelope(result);
  for (const role of ['manifest', 'stage-input', 'audio', 'timings', 'captions']) {
    assert.ok(parsed.artifacts.some(item => item.role === role), role);
  }
  assert.ok(parsed.artifacts.some(item => item.role === 'renderer-project'));
  assert.equal(parsed.artifacts.some(item => item.role === 'video'), false);
});

test('delegated voice usage errors preserve exit 2', () => {
  const result = run(['voices', 'get', '--json']);
  assert.equal(result.status, 2, result.stderr);
  const parsed = envelope(result);
  assert.equal(parsed.exit.class, 'usage-error');
  assert.equal(parsed.diagnostics[0].code, 'usage.invalid');
});

(canRender ? test : test.skip)('reuse builds do not claim pre-existing audio or timings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-reuse-build-'));
  const raw = {
    title: 'Reuse build', size: { w: 160, h: 90 }, renderer: 'no-browser', chrome: false,
    voices: { a: { backend: 'piper', speaker: 'en_US-ryan-medium', color: '#ffffff' } },
    scenes: [{
      id: 'one', dur: 0.5, vo: [{ who: 'a', text: 'Reuse.' }],
      visual: { type: 'text', text: 'REUSE', style: { color: '#ffffff', background: '#000000' } },
    }],
  };
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify(raw));
  const config = resolveConfig(raw, {}, dir);
  const out = path.join(dir, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  assert.equal(spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=0.5',
    '-ar', '48000', '-ac', '1', path.join(out, 'audio', 'full.wav'),
  ]).status, 0);
  fs.copyFileSync(path.join(out, 'audio', 'full.wav'), path.join(out, 'audio', '01.wav'));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
    total: 0.5,
    one: { dur: 0.5, turns: [0.05], words: [{ w: 'Reuse.', t0: 0.05, t1: 0.45, who: 'a', si: 0 }] },
  }));
  fs.writeFileSync(path.join(out, '.audio-fingerprint'), `${audioFingerprint(config)}\n`);
  fs.writeFileSync(path.join(out, '.timings-fingerprint'), `${timingsFingerprint(config)}\n`);

  const result = run(['build', '--reuse', '--project', dir, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const parsed = envelope(result);
  assert.equal(parsed.artifacts.some(item => item.role === 'audio'), false);
  assert.equal(parsed.artifacts.some(item => item.role === 'timings'), false);
  assert.ok(parsed.artifacts.some(item => item.role === 'manifest'));
  assert.ok(parsed.artifacts.some(item => item.role === 'video'));
});

(canRender ? test : test.skip)('real agent loop is driven entirely by envelopes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-machine-loop-'));
  const wav = path.join(dir, 'narration.wav');
  const words = path.join(dir, 'words.json');
  assert.equal(spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.8',
    '-ar', '48000', '-ac', '1', wav,
  ]).status, 0);
  fs.writeFileSync(words, JSON.stringify([
    { start: 0.1, end: 0.7, text: 'Ready.', words: [{ text: 'Ready.', start: 0.1, end: 0.7 }] },
  ]));
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({
    title: 'Machine loop', size: { w: 160, h: 90 }, renderer: 'no-browser',
    narration: { file: 'narration.wav', wordTimings: 'words.json' },
    voices: { a: { speaker: 'external', color: '#ffffff' } }, chrome: false,
    scenes: [{
      id: 'ready', dur: 0.8, vo: [{ who: 'a', text: 'Ready.' }],
      visual: { type: 'stack', style: { background: '#101820' }, children: [
        { type: 'text', text: 'READY', style: { color: '#ffffff', fontSize: 24 } },
      ] },
    }],
  }));

  // Establish prior timing evidence, then run the documented inspect →
  // validate → preview → critique → build → verify cycle only via envelopes.
  assert.equal(run(['build', '--project', dir, '--json']).status, 0);
  const operations = [
    ['provenance', '--project', dir],
    ['check', '--project', dir],
    ['preview', '--project', dir],
    ['critique', 'all', '--project', dir],
    ['build', '--companion', '1MB', '--project', dir],
    ['review', '--contact-sheet', '--project', dir],
  ];
  let built = null;
  let preview = null;
  for (const args of operations) {
    const result = run([...args, '--json']);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
    const parsed = envelope(result);
    if (args[0] === 'build') built = parsed;
    if (args[0] === 'preview') preview = parsed;
  }
  assert.equal(preview.data.detached, false);
  assert.ok(built);
  assert.ok(built.artifacts.some(item => item.role === 'video' && item.path.endsWith('video.mp4')));
  assert.ok(built.artifacts.some(item => item.role === 'captions'));
  assert.ok(built.artifacts.some(item => item.role === 'video-companion' && item.path.endsWith('-companion.mp4')));
});
