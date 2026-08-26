'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const {
  REQUEST_SCHEMA, RESULT_SCHEMA, SUPPORTED_INTERPOLATION,
  normalizeRequest, resolveContained, resolveCliPath, detectPngPattern, validatePngSequence,
  exactOutputTiming, buildFfmpegArgs, validateEncoded, atomicWrite,
  publishStaged, commitOutputAndReceipt, main,
} = require('../tools/frame-sequence-to-mp4');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

function temporary() { return fs.mkdtempSync(path.join(os.tmpdir(), 'narova-frame-encode-test-')); }
function request(overrides = {}) {
  return {
    schema: REQUEST_SCHEMA,
    correlationId: 'encode-test',
    input: 'frames',
    output: 'clips/take.mp4',
    inputFps: 15,
    outputFps: 30,
    interpolation: 'hold',
    width: 1280,
    height: 720,
    scale: 'lanczos',
    codec: 'libx264',
    pixFmt: 'yuv420p',
    crf: 18,
    preset: 'medium',
    ...overrides,
  };
}
function writeJson(root, name, value) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  return file;
}
function writeFrames(root, names = ['frame_0001.png', 'frame_0002.png']) {
  const directory = path.join(root, 'frames');
  fs.mkdirSync(directory, { recursive: true });
  for (const name of names) fs.writeFileSync(path.join(directory, name), PNG);
  return directory;
}
function validProbe(overrides = {}) {
  return {
    streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1280, height: 720, avg_frame_rate: '30/1', nb_read_frames: '4' }],
    format: { duration: '0.133333', size: '9' },
    ...overrides,
  };
}
async function invoke(root, value, deps = {}) {
  const requestPath = writeJson(root, 'request.json', value);
  const receiptPath = path.join(root, 'receipts', 'encode.json');
  const receipt = await main([root, requestPath, receiptPath], { emitProgress: () => {}, ...deps });
  assert.deepEqual(receipt, JSON.parse(fs.readFileSync(receiptPath, 'utf8')));
  return receipt;
}

test('all creative encoding choices are required and the schema is strict', () => {
  assert.equal(normalizeRequest(request()).schema, REQUEST_SCHEMA);
  for (const field of ['inputFps', 'outputFps', 'interpolation', 'width', 'height', 'scale', 'codec', 'pixFmt', 'crf', 'preset']) {
    const value = request();
    delete value[field];
    assert.throws(() => normalizeRequest(value), new RegExp(field));
  }
  assert.throws(() => normalizeRequest(request({ surprise: true })), /surprise/);
  assert.throws(() => normalizeRequest(request({ output: 'take.webm' })), /\.mp4/);
  assert.throws(() => normalizeRequest(request({ width: 1279.5 })), /integer/);
  assert.throws(() => normalizeRequest(request({ height: 719.5 })), /integer/);
});

test('the plural interpolation modes are declared without a preferred mode', () => {
  assert.deepEqual([...SUPPORTED_INTERPOLATION], ['hold', 'blend', 'motion-compensated']);
  for (const interpolation of SUPPORTED_INTERPOLATION) assert.equal(normalizeRequest(request({ interpolation })).interpolation, interpolation);
  assert.throws(() => normalizeRequest(request({ interpolation: 'automatic' })), /must be one of/);
});

test('sequence discovery preserves the actual prefix, padding, and starting frame', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = writeFrames(root, ['beauty-007.png', 'beauty-008.png', 'beauty-009.png']);
  const sequence = detectPngPattern(directory);
  assert.equal(sequence.pattern, 'beauty-%03d.png');
  assert.equal(sequence.startFrame, 7);
  assert.equal(sequence.endFrame, 9);
  assert.equal(sequence.frameCount, 3);
});

test('sequence discovery preserves extension case and escapes literal percent signs', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = writeFrames(root, ['foo%bar_0001.PNG', 'foo%bar_0002.PNG']);
  assert.equal(detectPngPattern(directory).pattern, 'foo%%bar_%04d.PNG');
});

test('gaps, mixed prefixes, mixed padding, empty directories, and false PNGs fail before encoding', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, files] of [
    ['gap', ['frame_0001.png', 'frame_0003.png']],
    ['prefix', ['a0001.png', 'b0002.png']],
    ['padding', ['frame_001.png', 'frame_0002.png']],
  ]) {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    for (const file of files) fs.writeFileSync(path.join(directory, file), PNG);
    assert.throws(() => validatePngSequence(directory), /contiguous, equally padded/);
  }
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  assert.throws(() => validatePngSequence(empty), /contiguous, equally padded/);
  const invalid = path.join(root, 'invalid');
  fs.mkdirSync(invalid);
  fs.writeFileSync(path.join(invalid, 'frame_0001.png'), 'not-png');
  assert.throws(() => validatePngSequence(invalid), /regular project-local PNG|valid PNG/);
});

test('input validation enforces its byte bound and records a stable aggregate identity', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = writeFrames(root);
  const first = validatePngSequence(directory, PNG.length * 2);
  const second = validatePngSequence(directory, PNG.length * 2);
  assert.equal(first.bytes, PNG.length * 2);
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.sha256, second.sha256);
  assert.throws(() => validatePngSequence(directory, PNG.length), /maxInputBytes/);
});

test('sequence validation rejects child-frame symbolic links', t => {
  const root = temporary();
  const outside = temporary();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  const directory = path.join(root, 'frames');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(outside, 'outside.png'), PNG);
  fs.symlinkSync(path.join(outside, 'outside.png'), path.join(directory, 'frame_0001.png'));
  assert.throws(() => validatePngSequence(directory), /regular project-local PNG/);
});

test('output timing must be exactly representable at the selected output rate', () => {
  assert.deepEqual(exactOutputTiming({ frameCount: 83 }, request()), { frameCount: 166, duration: 83 / 15 });
  assert.throws(() => exactOutputTiming({ frameCount: 120 }, request({ inputFps: 240, outputFps: 1 })), /not exactly representable/);
  assert.throws(() => exactOutputTiming({ frameCount: 1 }, request({ inputFps: 240, outputFps: 1 })), /not exactly representable/);
  assert.throws(() => exactOutputTiming({ frameCount: 1 }, request({ inputFps: 10, outputFps: 10.000000005 })), /not exactly representable/);
});

test('each explicit interpolation choice produces a distinct exact FFmpeg filter', () => {
  const sequence = { pattern: 'frame_%04d.png', startFrame: 1, frameCount: 15 };
  const staged = '/tmp/staged.mp4';
  const args = mode => buildFfmpegArgs('/project/frames', sequence, request({ interpolation: mode }), staged);
  const filter = values => values[values.indexOf('-vf') + 1];
  assert.match(filter(args('hold')), /^fps=30:round=near,/);
  assert.match(filter(args('blend')), /^tpad=stop_mode=clone:stop_duration=0\.13333333333333333,minterpolate=fps=30:mi_mode=blend,/);
  assert.match(filter(args('motion-compensated')), /^tpad=stop_mode=clone:stop_duration=0\.13333333333333333,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,/);
  for (const values of [args('hold'), args('blend'), args('motion-compensated')]) {
    assert.match(filter(values), /scale=1280:720:flags=lanczos/);
    assert.equal(values[values.indexOf('-c:v') + 1], 'libx264');
    assert.equal(values[values.indexOf('-pix_fmt') + 1], 'yuv420p');
    assert.equal(values[values.indexOf('-crf') + 1], '18');
    assert.equal(values[values.indexOf('-preset') + 1], 'medium');
  }
});

test('encoded validation proves stream count, no audio, dimensions, rate, duration, and size', () => {
  const sequence = { frameCount: 2 };
  const measured = validateEncoded(validProbe(), request(), sequence, 9, 20);
  assert.deepEqual(measured, { duration: 0.133333, frameCount: 4, streamCount: 1, width: 1280, height: 720, fps: 30, codec: 'h264', pixFmt: 'yuv420p' });
  assert.throws(() => validateEncoded(validProbe({ streams: [...validProbe().streams, { codec_type: 'audio' }] }), request(), sequence, 9, 20), /no other streams/);
  assert.throws(() => validateEncoded(validProbe({ streams: [...validProbe().streams, { codec_type: 'subtitle' }] }), request(), sequence, 9, 20), /no other streams/);
  assert.throws(() => validateEncoded(validProbe({ streams: [{ ...validProbe().streams[0], width: 640 }] }), request(), sequence, 9, 20), /dimensions/);
  assert.throws(() => validateEncoded(validProbe({ streams: [{ ...validProbe().streams[0], avg_frame_rate: '24/1' }] }), request(), sequence, 9, 20), /frame rate/);
  assert.throws(() => validateEncoded(validProbe({ streams: [{ ...validProbe().streams[0], codec_name: 'hevc' }] }), request(), sequence, 9, 20), /codec/);
  assert.throws(() => validateEncoded(validProbe({ streams: [{ ...validProbe().streams[0], pix_fmt: 'yuv444p' }] }), request(), sequence, 9, 20), /pixel format/);
  assert.throws(() => validateEncoded(validProbe({ streams: [{ ...validProbe().streams[0], nb_read_frames: '3' }] }), request(), sequence, 9, 20), /frame count/);
  assert.throws(() => validateEncoded(validProbe({ format: { duration: '9' } }), request(), sequence, 9, 20), /duration/);
  assert.throws(() => validateEncoded(validProbe(), request(), sequence, 21, 20), /maxOutputBytes/);
});

test('contained paths reject lexical and symbolic-link escapes', t => {
  const root = temporary();
  const outside = temporary();
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); });
  assert.throws(() => resolveContained(root, '../escape.mp4'), /escapes/);
  fs.symlinkSync(outside, path.join(root, 'link'));
  assert.throws(() => resolveContained(root, 'link/escape.mp4'), /symbolic link/);
  fs.writeFileSync(path.join(root, 'request.json'), '{}');
  assert.equal(resolveCliPath(root, 'request.json', { mustExist: true, field: 'request file' }), path.join(root, 'request.json'));
});

test('failed publication restores the previous destination', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const staged = path.join(root, 'staged.mp4');
  const destination = path.join(root, 'output.mp4');
  fs.writeFileSync(staged, 'new');
  fs.writeFileSync(destination, 'old');
  const io = { ...fs, renameSync() { throw new Error('publish failed'); } };
  assert.throws(() => publishStaged(staged, destination, io), /publish failed/);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'old');
});

test('output publication rolls back when the success receipt cannot commit', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const staged = path.join(root, 'staged.mp4');
  const destination = path.join(root, 'output.mp4');
  const blocked = path.join(root, 'blocked');
  fs.writeFileSync(staged, 'new');
  fs.writeFileSync(destination, 'old');
  fs.writeFileSync(blocked, 'not-a-directory');
  assert.throws(() => commitOutputAndReceipt(staged, destination, path.join(blocked, 'receipt.json'), { status: 'succeeded' }));
  assert.equal(fs.readFileSync(destination, 'utf8'), 'old');
  assert.equal(fs.readdirSync(root).some(name => name.endsWith('.rollback')), false);
});

test('receipts are replaced atomically without leftover temporary files', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'receipt.json');
  atomicWrite(file, 'one');
  atomicWrite(file, 'two');
  assert.equal(fs.readFileSync(file, 'utf8'), 'two');
  assert.deepEqual(fs.readdirSync(root), ['receipt.json']);
});

test('failed receipt publication removes only its owned temporary file', t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destination = path.join(root, 'receipt.json');
  fs.mkdirSync(destination);
  assert.throws(() => atomicWrite(destination, 'receipt'), /regular file/);
  assert.deepEqual(fs.readdirSync(root), ['receipt.json']);
});

test('missing media tools produces an honest needs-user-action receipt', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFrames(root);
  const receipt = await invoke(root, request(), { resolveMediaTools: () => ({ ffmpeg: null, ffprobe: null }) });
  assert.equal(receipt.schema, RESULT_SCHEMA);
  assert.equal(receipt.status, 'needs-user-action');
  assert.match(receipt.warnings[0], /required/);
  assert.deepEqual(receipt.bounds, {
    timeoutMs: 300000,
    maxInputBytes: 2147483648,
    maxOutputBytes: 4294967296,
  });
  const relative = await main([root, 'request.json', 'relative-receipt.json'], {
    emitProgress: () => {}, resolveMediaTools: () => ({ ffmpeg: null, ffprobe: null }),
  });
  assert.equal(relative.status, 'needs-user-action');
  assert.equal(fs.existsSync(path.join(root, 'relative-receipt.json')), true);
});

test('malformed requests produce a bounded failure receipt when the receipt path is safe', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requestPath = path.join(root, 'bad-request.json');
  const receiptPath = path.join(root, 'receipt.json');
  fs.writeFileSync(requestPath, '{bad json');
  const receipt = await main([root, requestPath, receiptPath], { emitProgress: () => {} });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.correlationId, 'unavailable');
  assert.match(receipt.warnings[0], /JSON/);
  assert.deepEqual(receipt, JSON.parse(fs.readFileSync(receiptPath, 'utf8')));
});

test('unsafe request, receipt, input, and output aliases are rejected without corruption', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFrames(root);
  const requestPath = writeJson(root, 'request.json', request());
  const output = path.join(root, 'clips', 'take.mp4');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, 'old-clip');
  await assert.rejects(main([root, requestPath, output], { emitProgress: () => {} }), /receipt file and output/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'old-clip');

  const insideRequest = request({ output: 'frames/inside.mp4' });
  const receipt = await invoke(root, insideRequest, { resolveMediaTools: () => ({ ffmpeg: null, ffprobe: null }) });
  assert.equal(receipt.status, 'failed');
  assert.match(receipt.warnings[0], /outside the input frame directory/);
});

test('invalid staged media preserves the old clip and cleans only the owned stage', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFrames(root);
  fs.mkdirSync(path.join(root, 'clips'), { recursive: true });
  fs.writeFileSync(path.join(root, 'clips', 'take.mp4'), 'old-valid');
  fs.mkdirSync(path.join(root, 'clips', '.narova-frame-encode-unrelated'));
  const receipt = await invoke(root, request(), {
    resolveMediaTools: () => ({ ffmpeg: '/fake/ffmpeg', ffprobe: '/fake/ffprobe' }),
    identifyMediaTool: name => ({ name, path: `/fake/${name}`, sha256: 'a'.repeat(64), build: `${name} test` }),
    encodeWithFfmpeg: async (_tool, args) => { fs.writeFileSync(args.at(-1), 'invalid'); return { elapsedMs: 1, diagnostics: '' }; },
    probeVideo: () => { throw new Error('invalid staged media'); },
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.choices.interpolation, 'hold');
  assert.equal(receipt.input.frames, 2);
  assert.equal(fs.readFileSync(path.join(root, 'clips', 'take.mp4'), 'utf8'), 'old-valid');
  assert.equal(fs.existsSync(path.join(root, 'clips', '.narova-frame-encode-unrelated')), true);
  assert.equal(fs.readdirSync(path.join(root, 'clips')).some(name => name.startsWith('.narova-frame-encode-') && name !== '.narova-frame-encode-unrelated'), false);
});

test('successful handoff records exact agent choices and measured output identity', async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeFrames(root);
  const selected = request({ interpolation: 'motion-compensated', scale: 'bicubic', crf: 21, preset: 'slow' });
  const receipt = await invoke(root, selected, {
    resolveMediaTools: () => ({ ffmpeg: '/fake/ffmpeg', ffprobe: '/fake/ffprobe' }),
    identifyMediaTool: name => ({ name, path: `/fake/${name}`, sha256: 'a'.repeat(64), build: `${name} test` }),
    encodeWithFfmpeg: async (_tool, args) => { fs.writeFileSync(args.at(-1), 'valid-mp4'); return { elapsedMs: 2, diagnostics: 'bounded diagnostic' }; },
    probeVideo: () => validProbe(),
  });
  assert.equal(receipt.status, 'succeeded');
  assert.deepEqual(receipt.choices, {
    inputFps: 15, outputFps: 30, interpolation: 'motion-compensated',
    width: 1280, height: 720, scale: 'bicubic', codec: 'libx264',
    pixFmt: 'yuv420p', crf: 21, preset: 'slow',
  });
  assert.equal(receipt.input.frames, 2);
  assert.match(receipt.input.sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.output.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(path.join(root, 'clips', 'take.mp4'), 'utf8'), 'valid-mp4');
});

test('real FFmpeg handoff preserves exact timing for every interpolation mode and a 24-to-30 conversion', { skip: spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0 || spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status !== 0 }, async t => {
  const root = temporary();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const identity = (name, executable) => ({
    name, path: executable, sha256: 'c'.repeat(64),
    build: spawnSync(executable, ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0],
  });
  const makeFrames = (directory, rate, count) => {
    fs.mkdirSync(directory, { recursive: true });
    const generated = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', `testsrc2=size=64x64:rate=${rate}`, '-frames:v', String(count),
      path.join(directory, 'frame_%04d.png'),
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
  };

  makeFrames(path.join(root, 'frames'), 12, 12);
  for (const interpolation of SUPPORTED_INTERPOLATION) {
    const receipt = await invoke(root, request({
      correlationId: `real-${interpolation}`, output: `clips/${interpolation}.mp4`,
      inputFps: 12, outputFps: 24, interpolation, width: 64, height: 64,
      scale: 'bilinear', crf: 23, preset: 'ultrafast',
    }), { identifyMediaTool: identity });
    assert.equal(receipt.status, 'succeeded');
    assert.equal(receipt.output.frameCount, 24);
    assert.equal(receipt.output.streamCount, 1);
    assert.equal(receipt.output.duration, 1);
    assert.equal(receipt.output.codec, 'h264');
    assert.equal(receipt.output.pixFmt, 'yuv420p');
  }

  makeFrames(path.join(root, 'awkward'), 24, 24);
  const awkward = await invoke(root, request({
    correlationId: 'real-24-to-30', input: 'awkward', output: 'clips/24-to-30.mp4',
    inputFps: 24, outputFps: 30, width: 64, height: 64,
    scale: 'bilinear', crf: 23, preset: 'ultrafast',
  }), { identifyMediaTool: identity });
  assert.equal(awkward.status, 'succeeded');
  assert.equal(awkward.output.frameCount, 30);
  assert.equal(awkward.output.duration, 1);
});
