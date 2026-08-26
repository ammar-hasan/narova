'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');

const {
  REQUEST_SCHEMA, RESULT_SCHEMA, SUPPORTED_OPERATIONS, UNSUPPORTED_ADVERTISED,
  normalizeRequest, resolveContained, resolveTarget, redactSecrets, executeBlender,
  atomicWrite, publishStaged, alternativesFor, measurePng, main,
} = require('../tools/blender-dcc');

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}

function rgbaPng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]));
    rows.push(Buffer.from(rgba.slice(y * width * 4, (y + 1) * width * 4)));
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), 'narova-dcc-test-')); }
function request(overrides = {}) {
  return { schema: REQUEST_SCHEMA, correlationId: 'test-correlation', operation: 'assess-environment', ...overrides };
}
function writeJson(root, name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  return file;
}

function fakeBlender(root, options = {}) {
  const log = path.join(root, 'fake-blender-log.jsonl');
  const file = path.join(root, 'blender');
  const fakePng = (options.pngData || Buffer.from('png')).toString('base64');
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('Blender 5.2.0 LTS\\n'); process.exit(0); }
const divider = args.indexOf('--');
const operation = args[divider + 1];
const input = args[1];
const driverRequest = JSON.parse(fs.readFileSync(args[divider + 2], 'utf8'));
const resultPath = args[divider + 3];
const fakePng = Buffer.from(${JSON.stringify(fakePng)}, 'base64');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, driverRequest }) + '\\n');
if (${JSON.stringify(Boolean(options.fail))}) { process.stderr.write('failed ' + (process.env.DCC_TEST_SECRET || '') + '\\n'); process.exit(2); }
if (${JSON.stringify(Boolean(options.noOutput))}) { fs.writeFileSync(resultPath, JSON.stringify({ status: 'succeeded' })); process.exit(0); }
let result = { status: 'succeeded', runtime: { blenderVersion: '5.2.0', background: true } };
if (operation === 'inspect-scene') result.inspection = { scene: 'Fake', objects: 3, input, sampleFrames: driverRequest.workload.sampleFrames || [], requestedObjects: driverRequest.inspection.objects || [] };
else if (operation === 'render-proof-still') { fs.mkdirSync(path.dirname(driverRequest.outputPath), { recursive: true }); fs.writeFileSync(driverRequest.outputPath, fakePng); result.kind = 'proof-still'; result.payload = { frame: driverRequest.workload.startFrame }; }
else if (operation === 'export') { fs.writeFileSync(driverRequest.outputPath, 'blend'); result.kind = 'blend-source'; result.payload = { editable: true }; }
else { fs.mkdirSync(driverRequest.outputPath, { recursive: true }); const frames = driverRequest.workload.sampleFrames || Array.from({ length: driverRequest.workload.endFrame - driverRequest.workload.startFrame + 1 }, (_, index) => driverRequest.workload.startFrame + index); for (const frame of frames) fs.writeFileSync(path.join(driverRequest.outputPath, 'frame_' + String(frame).padStart(4, '0') + '.png'), fakePng); result.kind = 'image-frame'; result.payload = { frameCount: frames.length, sampleFrames: driverRequest.workload.sampleFrames || undefined }; }
fs.writeFileSync(resultPath, JSON.stringify(result));
`;
  fs.writeFileSync(file, source, { mode: 0o755 });
  return { file, log };
}

async function invoke(root, value, deps = {}) {
  const requestPath = writeJson(root, 'request.json', value);
  const receiptPath = path.join(root, 'receipt.json');
  await main([root, requestPath, receiptPath], { emitProgress: () => {}, ...deps });
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

test('request schema is strict and bounded', () => {
  assert.equal(normalizeRequest(request()).schema, REQUEST_SCHEMA);
  assert.throws(() => normalizeRequest({}), /schema/);
  assert.throws(() => normalizeRequest(request({ extra: true })), /extra/);
  assert.throws(() => normalizeRequest(request({ operation: 'anything' })), /not recognized/);
  assert.throws(() => normalizeRequest(request({ secretNames: ['BAD-NAME'] })), /invalid/);
  assert.throws(() => normalizeRequest(request({ workload: { width: Infinity } })), /between/);
  assert.throws(() => normalizeRequest(request({ workload: { startFrame: 5, endFrame: 4 } })), />= startFrame/);
  assert.throws(() => normalizeRequest(request({ operation: 'inspect-scene', workload: { sampleFrames: [] } })), /non-empty array/);
  assert.throws(() => normalizeRequest(request({ operation: 'inspect-scene', workload: { sampleFrames: [1.5] } })), /must be an integer/);
  assert.throws(() => normalizeRequest(request({ operation: 'render-proof-sequence', workload: { sampleFrames: [1, 1] } })), /strictly increasing/);
  assert.throws(() => normalizeRequest(request({ operation: 'render-proof-sequence', workload: { sampleFrames: [2, 1] } })), /strictly increasing/);
  assert.throws(() => normalizeRequest(request({ operation: 'render-proof-sequence', workload: { sampleFrames: Array.from({ length: 11 }, (_, index) => index + 1) } })), /at most 10/);
  assert.throws(() => normalizeRequest(request({ operation: 'render-proof-sequence', workload: { sampleFrames: [1, 5], startFrame: 1 } })), /cannot be combined/);
  assert.throws(() => normalizeRequest(request({ operation: 'render-final-shot', workload: { sampleFrames: [1, 5] } })), /supported only/);
  assert.throws(() => normalizeRequest(request({ operation: 'render-proof-still', inspection: { objects: ['Cube'] } })), /supported only for inspect-scene/);
  assert.throws(() => normalizeRequest(request({ operation: 'inspect-scene', inspection: { objects: Array.from({ length: 33 }, (_, index) => `Object${index}`) } })), /at most 32/);
  assert.throws(() => normalizeRequest(request({ operation: 'inspect-scene', inspection: { objects: ['Cube', 'Cube'] } })), /unique names/);
  assert.throws(() => normalizeRequest(request({ operation: 'inspect-scene', evidence: { pixelMeasurements: true } })), /only for proof rendering/);
  assert.throws(() => normalizeRequest(request({ operation: 'render-proof-still', evidence: { pixelMeasurements: false } })), /must be true/);
  assert.throws(() => normalizeRequest(request({ operation: 'render-proof-sequence', workload: { width: 8192, height: 8192, startFrame: 1, endFrame: 2 }, evidence: { pixelMeasurements: true } })), /pixel budget/);
});

test('decoded PNG measurements expose literal luma, saturation, channel, and alpha facts', () => {
  const measured = measurePng(rgbaPng(2, 1, [0, 0, 0, 255, 255, 0, 0, 0]));
  assert.equal(measured.width, 2);
  assert.equal(measured.height, 1);
  assert.equal(measured.pixelCount, 2);
  assert.equal(measured.channels.red.mean, 0.5);
  assert.equal(measured.channels.green.max, 0);
  assert.equal(measured.luma.min, 0);
  assert.equal(measured.luma.max, 0.2126);
  assert.equal(measured.luma.mean, 0.1063);
  assert.equal(measured.luma.nearDarkFraction, 0.5);
  assert.equal(measured.luma.nearBrightFraction, 0);
  assert.equal(measured.saturation.mean, 0.5);
  assert.equal(measured.alpha.transparentFraction, 0.5);
  assert.match(measured.basis.luma, /rec709/);
});

test('all six bounded operations and three explicit unsupported operations remain declared', () => {
  assert.deepEqual([...SUPPORTED_OPERATIONS], ['assess-environment', 'inspect-scene', 'render-proof-still', 'render-proof-sequence', 'render-final-shot', 'export']);
  assert.deepEqual([...UNSUPPORTED_ADVERTISED], ['scene-assembly', 'arbitrary-simulation', 'managed-installation']);
});

test('target resolution order is override, environment, PATH, common location', () => {
  const root = temporary();
  try {
    const override = path.join(root, 'override');
    const envTarget = path.join(root, 'env');
    const pathTarget = path.join(root, 'bin', 'blender');
    const common = path.join(root, 'common');
    for (const file of [override, envTarget, pathTarget, common]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x'); }
    const found = resolveTarget(root, request({ targetOverride: override }), { env: { NAROVA_BLENDER: envTarget, PATH: path.dirname(pathTarget) }, commonPaths: [common] });
    assert.equal(found.path, override);
    assert.equal(resolveTarget(root, request(), { env: {}, commonPaths: [] }), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('contained paths allow harmless double dots but reject lexical and symlink escapes', t => {
  const root = temporary();
  const outside = temporary();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'take..one.blend'), 'x');
  assert.equal(resolveContained(root, 'take..one.blend', { mustExist: true }), path.join(root, 'take..one.blend'));
  assert.throws(() => resolveContained(root, '../outside.blend'), /escapes/);
  fs.symlinkSync(outside, path.join(root, 'link'));
  assert.throws(() => resolveContained(root, 'link/output.png'), /symbolic link/);
});

test('secret values are redacted and undeclared text is retained', () => {
  assert.equal(redactSecrets('token=swordfish', ['TOKEN'], { TOKEN: 'swordfish' }), 'token=[REDACTED:TOKEN]');
  assert.equal(redactSecrets('safe', [], {}), 'safe');
});

test('execution timeout terminates the owned process tree', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const marker = path.join(root, 'child-survived');
  const binary = path.join(root, 'blender');
  fs.writeFileSync(binary, `#!/usr/bin/env node
const { spawn } = require('node:child_process');
spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad'), 350)`) }], { stdio: 'ignore' });
setTimeout(() => {}, 5000);
`, { mode: 0o755 });
  await assert.rejects(executeBlender(binary, [], { timeoutMs: 80 }), /timed out/);
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(fs.existsSync(marker), false);
});

test('atomic writes replace successfully without leaving temporary files', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'receipt.json');
  atomicWrite(file, 'one');
  atomicWrite(file, 'two');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
  assert.deepEqual(fs.readdirSync(root), ['receipt.json']);
});

test('failed atomic publication restores the previous valid destination', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const staged = path.join(root, 'staged');
  const destination = path.join(root, 'output');
  fs.writeFileSync(staged, 'new');
  fs.writeFileSync(destination, 'old');
  let calls = 0;
  const io = { ...fs, renameSync(source, target) { calls += 1; if (calls === 2) throw new Error('publish failed'); return fs.renameSync(source, target); } };
  assert.throws(() => publishStaged(staged, destination, io), /publish failed/);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'old');
});

test('committed publication stays successful when backup cleanup fails', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const staged = path.join(root, 'staged');
  const destination = path.join(root, 'output');
  fs.writeFileSync(staged, 'new');
  fs.writeFileSync(destination, 'old');
  const io = {
    ...fs,
    rmSync(target, options) {
      if (String(target).endsWith('.backup')) throw new Error('cleanup failed');
      return fs.rmSync(target, options);
    },
  };
  assert.doesNotThrow(() => publishStaged(staged, destination, io));
  assert.equal(fs.readFileSync(destination, 'utf8'), 'new');
});

test('alternatives are unranked, disclose tradeoffs, and include an explicit stop', () => {
  const alternatives = alternativesFor(request({ requiredCapabilities: ['editable-simulation'] }), 'missing');
  assert.ok(alternatives.every(item => item.unranked));
  assert.ok(alternatives.every(item => item.fidelity && item.privacy && item.reversibility));
  assert.ok(alternatives.some(item => item.kind === 'stop'));
});

test('missing target is hermetic and needs user action', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const receipt = await invoke(root, request({ operation: 'render-proof-still', input: 'scene.blend', output: 'proof.png' }), { resolveTarget: () => null });
  assert.equal(receipt.status, 'needs-user-action');
  assert.equal(receipt.target.available, false);
  assert.ok(receipt.alternatives.some(item => item.kind === 'stop'));
});

test('unsupported operation returns before target resolution', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let resolved = false;
  const receipt = await invoke(root, request({ operation: 'scene-assembly' }), { resolveTarget() { resolved = true; throw new Error('must not execute'); } });
  assert.equal(resolved, false);
  assert.equal(receipt.status, 'needs-user-action');
  assert.equal(receipt.target.source, 'not-resolved');
});

test('assessment separates availability, unknown workload facts, and per-operation decisions', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fake = fakeBlender(root);
  const receipt = await invoke(root, request({ targetOverride: fake.file }));
  assert.equal(receipt.status, 'succeeded');
  assert.equal(receipt.payload.target.version, '5.2.0');
  assert.equal(receipt.payload.workload.deadlineMs.grade, 'unknown');
  assert.equal(receipt.payload.machine.gpuBackend.grade, 'unknown');
  for (const decision of Object.values(receipt.payload.decision)) assert.ok(['suitable', 'unsuitable', 'unknown'].includes(decision.state));
});

test('inspection uses correct Blender CLI order and a private result file', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'scene.blend'), 'blend');
  const fake = fakeBlender(root);
  const receipt = await invoke(root, request({ operation: 'inspect-scene', targetOverride: fake.file, input: 'scene.blend' }));
  assert.equal(receipt.status, 'succeeded');
  assert.equal(receipt.payload.inspection.objects, 3);
  const { args } = JSON.parse(fs.readFileSync(fake.log, 'utf8').trim());
  assert.equal(args[0], '--background');
  assert.equal(args[1], path.join(root, 'scene.blend'));
  assert.equal(args[2], '--python');
  assert.equal(args[4], '--');
  assert.equal(args[5], 'inspect-scene');
});

test('inspection forwards bounded shot frames and exact object selectors', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'shot.blend'), 'blend');
  const fake = fakeBlender(root);
  const receipt = await invoke(root, request({
    operation: 'inspect-scene', targetOverride: fake.file, input: 'shot.blend',
    workload: { sampleFrames: [1, 50, 100] }, inspection: { objects: ['Camera', 'Subject'] },
  }));
  assert.equal(receipt.status, 'succeeded');
  assert.deepEqual(receipt.payload.inspection.sampleFrames, [1, 50, 100]);
  assert.deepEqual(receipt.payload.inspection.requestedObjects, ['Camera', 'Subject']);
  const { driverRequest } = JSON.parse(fs.readFileSync(fake.log, 'utf8').trim());
  assert.deepEqual(driverRequest.workload.sampleFrames, [1, 50, 100]);
  assert.deepEqual(driverRequest.inspection.objects, ['Camera', 'Subject']);
});

test('proof still applies declared workload and returns project-relative output identity', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'scene.blend'), 'blend');
  const fake = fakeBlender(root);
  const receipt = await invoke(root, request({ operation: 'render-proof-still', targetOverride: fake.file, input: 'scene.blend', output: 'proof.png', workload: { width: 321, height: 181, startFrame: 7, fps: 24, engine: 'BLENDER_EEVEE_NEXT' } }));
  assert.equal(receipt.status, 'succeeded');
  assert.equal(receipt.outputs[0].relativePath, 'proof.png');
  assert.match(receipt.outputs[0].sha256, /^[a-f0-9]{64}$/);
  const { driverRequest } = JSON.parse(fs.readFileSync(fake.log, 'utf8').trim());
  assert.deepEqual(driverRequest.workload, { width: 321, height: 181, startFrame: 7, endFrame: 7, fps: 24, engine: 'BLENDER_EEVEE_NEXT' });
});

test('proof sequence enforces ten-frame bound and validates exact files', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'scene.blend'), 'blend');
  const fake = fakeBlender(root);
  const rejected = await invoke(root, request({ operation: 'render-proof-sequence', targetOverride: fake.file, input: 'scene.blend', output: 'too-many', workload: { startFrame: 1, endFrame: 11 } }));
  assert.equal(rejected.status, 'failed');
  const accepted = await invoke(root, request({ correlationId: 'second', operation: 'render-proof-sequence', targetOverride: fake.file, input: 'scene.blend', output: 'proof', workload: { startFrame: 3, endFrame: 5 } }));
  assert.equal(accepted.status, 'succeeded');
  assert.deepEqual(accepted.outputs.map(item => item.relativePath), ['proof/frame_0003.png', 'proof/frame_0004.png', 'proof/frame_0005.png']);
});

test('sparse proof sequence publishes exactly the caller-selected frames', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'scene.blend'), 'blend');
  const fake = fakeBlender(root);
  const receipt = await invoke(root, request({
    operation: 'render-proof-sequence', targetOverride: fake.file, input: 'scene.blend', output: 'proof',
    workload: { width: 640, height: 360, sampleFrames: [1, 75, 150, 225, 300], fps: 30 },
  }));
  assert.equal(receipt.status, 'succeeded');
  assert.deepEqual(receipt.outputs.map(item => item.relativePath), [
    'proof/frame_0001.png', 'proof/frame_0075.png', 'proof/frame_0150.png',
    'proof/frame_0225.png', 'proof/frame_0300.png',
  ]);
  assert.deepEqual(receipt.payload.sampleFrames, [1, 75, 150, 225, 300]);
  assert.deepEqual(receipt.payload.workload.sampleFrames, [1, 75, 150, 225, 300]);
  assert.equal(Object.hasOwn(receipt.payload.workload, 'startFrame'), false);
  assert.equal(Object.hasOwn(receipt.payload.workload, 'endFrame'), false);
});

test('requested proof pixel facts bind to exact outputs without changing PNG bytes', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'scene.blend'), 'blend');
  const pngData = rgbaPng(2, 1, [0, 0, 0, 255, 255, 0, 0, 0]);
  const fake = fakeBlender(root, { pngData });
  const ordinary = await invoke(root, request({
    correlationId: 'ordinary', operation: 'render-proof-sequence', targetOverride: fake.file,
    input: 'scene.blend', output: 'ordinary', workload: { width: 2, height: 1, sampleFrames: [1, 2], fps: 24 },
  }));
  const measured = await invoke(root, request({
    correlationId: 'measured', operation: 'render-proof-sequence', targetOverride: fake.file,
    input: 'scene.blend', output: 'measured', workload: { width: 2, height: 1, sampleFrames: [1, 2], fps: 24 },
    evidence: { pixelMeasurements: true },
  }));
  assert.equal(Object.hasOwn(ordinary.payload, 'pixelMeasurements'), false);
  assert.equal(measured.payload.pixelMeasurements.length, 2);
  assert.deepEqual(measured.payload.pixelMeasurements.map(item => item.relativePath), ['measured/frame_0001.png', 'measured/frame_0002.png']);
  assert.ok(measured.payload.pixelMeasurements.every(item => item.luma.mean === 0.1063));
  assert.deepEqual(measured.payload.pixelMeasurements.map(item => item.sourceSha256), measured.outputs.map(item => item.sha256));
  assert.deepEqual(ordinary.outputs.map(item => item.sha256), measured.outputs.map(item => item.sha256));
});

test('invalid staged output fails without replacing an existing artifact', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'scene.blend'), 'blend');
  fs.writeFileSync(path.join(root, 'proof.png'), 'old-valid');
  const fake = fakeBlender(root, { noOutput: true });
  const receipt = await invoke(root, request({ operation: 'render-proof-still', targetOverride: fake.file, input: 'scene.blend', output: 'proof.png' }));
  assert.equal(receipt.status, 'failed');
  assert.equal(fs.readFileSync(path.join(root, 'proof.png'), 'utf8'), 'old-valid');
  assert.equal(fs.readdirSync(root).some(name => name.startsWith('.narova-dcc-stage-')), false);
});

test('Blender diagnostics redact declared environment secrets', async t => {
  const root = temporary();
  t.after(() => { delete process.env.DCC_TEST_SECRET; fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'scene.blend'), 'blend');
  process.env.DCC_TEST_SECRET = 'swordfish';
  const fake = fakeBlender(root, { fail: true });
  const receipt = await invoke(root, request({ operation: 'inspect-scene', targetOverride: fake.file, input: 'scene.blend', secretNames: ['DCC_TEST_SECRET'] }));
  assert.equal(receipt.status, 'failed');
  assert.doesNotMatch(JSON.stringify(receipt), /swordfish/);
  assert.match(JSON.stringify(receipt), /REDACTED:DCC_TEST_SECRET/);
});

test('editable export and final sequence return distinct typed outputs', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'scene.blend'), 'blend');
  const fake = fakeBlender(root);
  const exported = await invoke(root, request({ operation: 'export', targetOverride: fake.file, input: 'scene.blend', output: 'editable.blend' }));
  assert.equal(exported.status, 'succeeded');
  assert.equal(exported.outputs[0].kind, 'blend-source');
  const final = await invoke(root, request({ correlationId: 'final', operation: 'render-final-shot', targetOverride: fake.file, input: 'scene.blend', output: 'frames', workload: { width: 1920, height: 1080, startFrame: 1, endFrame: 2, fps: 30 } }));
  assert.equal(final.status, 'succeeded');
  assert.equal(final.outputs.length, 2);
  assert.ok(final.outputs.every(item => item.kind === 'image-frame'));
});

test('receipt schema stays versioned and receipt publication replaces prior bytes', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'receipt.json'), 'old');
  const receipt = await invoke(root, request(), { resolveTarget: () => null });
  assert.equal(receipt.schema, RESULT_SCHEMA);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'receipt.json'), 'utf8')).schema, RESULT_SCHEMA);
});
