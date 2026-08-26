#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const REQUEST_SCHEMA = 'narova.3d-frame-encode/1';
const RESULT_SCHEMA = 'narova.3d-frame-encode-result/1';
const SUPPORTED_INTERPOLATION = new Set(['hold', 'blend', 'motion-compensated']);
const SUPPORTED_SCALE = new Set(['neighbor', 'bilinear', 'bicubic', 'lanczos']);
const SUPPORTED_CODECS = new Set(['libx264', 'libx265']);
const SUPPORTED_PIXEL_FORMATS = new Set(['yuv420p', 'yuv422p', 'yuv444p']);
const SUPPORTED_PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']);
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_INPUT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_DIMENSION = 16_384;
const MAX_FRAMES = 100_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(message) { throw new Error(message); }
function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function boundedString(value, field, max = 512) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) fail(`${field} must be a non-empty string of at most ${max} characters`);
  return value;
}
function boundedNumber(value, field, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) fail(`${field} must be between ${min} and ${max}`);
  return value;
}
function boundedInteger(value, field, min, max) {
  boundedNumber(value, field, min, max);
  if (!Number.isInteger(value)) fail(`${field} must be an integer`);
  return value;
}
function exactKeys(value, field, keys) {
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${field}.${key} is not supported`);
}
function hashFile(file, maxBytes = Number.MAX_SAFE_INTEGER) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const digest = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let bytes = 0;
  try {
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read === 0) break;
      bytes += read;
      if (bytes > maxBytes) fail(`${path.basename(file)} exceeds its byte bound`);
      digest.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return { bytes, sha256: digest.digest('hex') };
}

function normalizeRequest(raw) {
  if (!isObject(raw)) fail('request must be an object');
  exactKeys(raw, 'request', new Set([
    'schema', 'correlationId', 'input', 'output', 'inputFps', 'outputFps',
    'interpolation', 'width', 'height', 'scale', 'codec', 'pixFmt', 'crf',
    'preset', 'timeoutMs', 'maxInputBytes', 'maxOutputBytes',
  ]));
  if (raw.schema !== REQUEST_SCHEMA) fail(`request.schema must be '${REQUEST_SCHEMA}'`);
  boundedString(raw.correlationId, 'request.correlationId', 128);
  boundedString(raw.input, 'request.input', 2048);
  boundedString(raw.output, 'request.output', 2048);
  boundedNumber(raw.inputFps, 'request.inputFps', 1, 240);
  boundedNumber(raw.outputFps, 'request.outputFps', 1, 240);
  boundedInteger(raw.width, 'request.width', 1, MAX_DIMENSION);
  boundedInteger(raw.height, 'request.height', 1, MAX_DIMENSION);
  boundedNumber(raw.crf, 'request.crf', 0, 51);
  for (const [field, values] of [
    ['interpolation', SUPPORTED_INTERPOLATION], ['scale', SUPPORTED_SCALE],
    ['codec', SUPPORTED_CODECS], ['pixFmt', SUPPORTED_PIXEL_FORMATS],
    ['preset', SUPPORTED_PRESETS],
  ]) {
    boundedString(raw[field], `request.${field}`, 64);
    if (!values.has(raw[field])) fail(`request.${field} must be one of: ${[...values].join(', ')}`);
  }
  if (!raw.output.toLowerCase().endsWith('.mp4')) fail('request.output must use an .mp4 extension');
  if (raw.timeoutMs !== undefined) boundedNumber(raw.timeoutMs, 'request.timeoutMs', 1, MAX_TIMEOUT_MS);
  if (raw.maxInputBytes !== undefined) boundedNumber(raw.maxInputBytes, 'request.maxInputBytes', 1, DEFAULT_MAX_INPUT_BYTES);
  if (raw.maxOutputBytes !== undefined) boundedNumber(raw.maxOutputBytes, 'request.maxOutputBytes', 1, DEFAULT_MAX_OUTPUT_BYTES);
  return { ...raw };
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function nearestExisting(candidate) {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function resolveContained(projectRoot, relativePath, { mustExist = false, field = 'path' } = {}) {
  boundedString(relativePath, field, 2048);
  if (path.isAbsolute(relativePath)) fail(`${field} must be project-relative`);
  const lexicalRoot = path.resolve(projectRoot);
  const candidate = path.resolve(lexicalRoot, relativePath);
  if (!inside(lexicalRoot, candidate)) fail(`${field} escapes the project`);
  const realRoot = fs.realpathSync(lexicalRoot);
  if (mustExist) {
    if (!fs.existsSync(candidate)) fail(`${field} does not exist`);
    if (fs.lstatSync(candidate).isSymbolicLink()) fail(`${field} must not be a symbolic link`);
    if (!inside(realRoot, fs.realpathSync(candidate))) fail(`${field} escapes the project through a symbolic link`);
  } else {
    const existing = nearestExisting(candidate);
    if (!existing || !inside(realRoot, fs.realpathSync(existing))) fail(`${field} escapes the project through a symbolic link`);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) fail(`${field} must not be a symbolic link`);
  }
  return candidate;
}

function resolveCliPath(projectRoot, argument, options) {
  boundedString(argument, options.field, 2048);
  const absolute = path.isAbsolute(argument) ? argument : path.resolve(projectRoot, argument);
  return resolveContained(projectRoot, path.relative(projectRoot, absolute), options);
}

function detectPngPattern(directory) {
  const names = fs.readdirSync(directory).filter(name => name.toLowerCase().endsWith('.png')).sort();
  if (names.length === 0 || names.length > MAX_FRAMES) return null;
  const frames = [];
  for (const name of names) {
    const match = name.match(/^(.*?)(\d+)(\.png)$/i);
    if (!match) return null;
    frames.push({ name, prefix: match[1], digits: match[2], extension: match[3], number: Number(match[2]) });
  }
  const { prefix } = frames[0];
  const padding = frames[0].digits.length;
  const extension = frames[0].extension;
  if (!frames.every(frame => frame.prefix === prefix && frame.digits.length === padding && frame.extension === extension)) return null;
  const ordered = frames.sort((a, b) => a.number - b.number);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].number !== ordered[index - 1].number + 1) return null;
  }
  return {
    pattern: `${prefix.replaceAll('%', '%%')}%0${padding}d${extension}`,
    startFrame: ordered[0].number,
    endFrame: ordered.at(-1).number,
    frameCount: ordered.length,
    files: ordered,
  };
}

function validatePngSequence(directory, maxInputBytes = DEFAULT_MAX_INPUT_BYTES) {
  const sequence = detectPngPattern(directory);
  if (!sequence) fail(`request.input must contain 1-${MAX_FRAMES} contiguous, equally padded PNG frames with one filename prefix`);
  const realDirectory = fs.realpathSync(directory);
  let bytes = 0;
  const identity = crypto.createHash('sha256');
  for (const frame of sequence.files) {
    const file = path.join(directory, frame.name);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size < PNG_MAGIC.length) fail(`${frame.name} must be a regular project-local PNG file`);
    if (!inside(realDirectory, fs.realpathSync(file))) fail(`${frame.name} escapes the input directory`);
    if (stat.size > maxInputBytes - bytes) fail('input sequence exceeds maxInputBytes');
    const header = Buffer.alloc(PNG_MAGIC.length);
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try { fs.readSync(descriptor, header, 0, header.length, 0); } finally { fs.closeSync(descriptor); }
    if (!header.equals(PNG_MAGIC)) fail(`${frame.name} is not a valid PNG file`);
    const hashed = hashFile(file, maxInputBytes - bytes);
    bytes += hashed.bytes;
    identity.update(`${frame.name}:${hashed.sha256}\n`);
  }
  return { ...sequence, bytes, sha256: identity.digest('hex') };
}

function whichTool(name, override) {
  const executable = process.platform === 'win32' ? `${name}.exe` : name;
  const candidates = [override, ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, executable))].filter(Boolean);
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
  return null;
}

function resolveMediaTools(env = process.env) {
  return { ffmpeg: whichTool('ffmpeg', env.NAROVA_FFMPEG), ffprobe: whichTool('ffprobe', env.NAROVA_FFPROBE) };
}

function mediaToolIdentity(name, executable) {
  const resolvedPath = fs.realpathSync(executable);
  const version = spawnSync(executable, ['-version'], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024,
  });
  if (version.error || version.status !== 0) fail(`${name} version probe failed`);
  return {
    name,
    path: resolvedPath,
    sha256: hashFile(resolvedPath, 512 * 1024 * 1024).sha256,
    build: String(version.stdout || '').slice(0, 4096).trim(),
  };
}

function decimalFraction(value) {
  const match = String(value).toLowerCase().match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/);
  if (!match) fail('frame rate must have a finite decimal representation');
  const fractionDigits = match[2] || '';
  const exponent = Number(match[3] || 0) - fractionDigits.length;
  let numerator = BigInt(`${match[1]}${fractionDigits}`);
  let denominator = 1n;
  if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
  else denominator = 10n ** BigInt(-exponent);
  return { numerator, denominator };
}

function exactOutputTiming(sequence, request) {
  const input = decimalFraction(request.inputFps);
  const output = decimalFraction(request.outputFps);
  const numerator = BigInt(sequence.frameCount) * output.numerator * input.denominator;
  const denominator = output.denominator * input.numerator;
  if (denominator === 0n || numerator % denominator !== 0n) {
    fail('input duration is not exactly representable at request.outputFps; choose an output rate that yields a whole frame count');
  }
  const frameCount = numerator / denominator;
  if (frameCount < 1n || frameCount > BigInt(Number.MAX_SAFE_INTEGER)) fail('exact output frame count is outside the supported range');
  return { frameCount: Number(frameCount), duration: sequence.frameCount / request.inputFps };
}

function scaleFlag(mode) {
  return { neighbor: 'neighbor', bilinear: 'bilinear', bicubic: 'bicubic', lanczos: 'lanczos' }[mode];
}

function buildFfmpegArgs(inputDir, sequence, request, staged) {
  const { duration } = exactOutputTiming(sequence, request);
  const filters = [];
  if (request.interpolation === 'hold') filters.push(`fps=${request.outputFps}:round=near`);
  if (request.interpolation !== 'hold') {
    filters.push(`tpad=stop_mode=clone:stop_duration=${2 / request.inputFps}`);
  }
  if (request.interpolation === 'blend') filters.push(`minterpolate=fps=${request.outputFps}:mi_mode=blend`);
  if (request.interpolation === 'motion-compensated') filters.push(`minterpolate=fps=${request.outputFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
  filters.push(`scale=${request.width}:${request.height}:flags=${scaleFlag(request.scale)}`, 'setsar=1', `trim=duration=${duration}`, 'setpts=PTS-STARTPTS');
  return [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-framerate', String(request.inputFps), '-start_number', String(sequence.startFrame),
    '-i', path.join(inputDir, sequence.pattern),
    '-vf', filters.join(','), '-an', '-fps_mode', 'cfr',
    '-c:v', request.codec, '-preset', request.preset, '-crf', String(request.crf),
    '-pix_fmt', request.pixFmt, '-movflags', '+faststart', '-f', 'mp4', staged,
  ];
}

function emitJsonl(request, details) {
  process.stderr.write(`${JSON.stringify({
    schema: 'narova.3d-operation-progress/1', correlationId: request.correlationId,
    operation: 'frame-sequence-to-mp4', phase: details.phase, elapsedMs: details.elapsedMs,
  })}\n`);
}

function encodeWithFfmpeg(ffmpegPath, args, options = {}) {
  const timeoutMs = Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const emit = options.emitProgress || (() => {});
  return new Promise((resolve, reject) => {
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const started = Date.now();
    const detached = process.platform !== 'win32';
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], detached });
    const terminate = signal => {
      try {
        if (detached && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };
    let timer;
    let heartbeat;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      error ? reject(error) : resolve(value);
    };
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (Buffer.byteLength(stderr) > MAX_CAPTURE_BYTES) {
        terminate('SIGKILL');
        finish(new Error('ffmpeg diagnostics exceeded the capture limit'));
      }
    });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (timedOut) return finish(new Error(`ffmpeg encoding timed out after ${timeoutMs}ms`));
      if (code !== 0) return finish(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(0, 1024)}`));
      finish(null, { elapsedMs: Date.now() - started, diagnostics: stderr.slice(0, 1024) });
    });
    heartbeat = setInterval(() => emit({ phase: 'running', elapsedMs: Date.now() - started }), 2000);
    timer = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      setTimeout(() => terminate('SIGKILL'), 250).unref();
    }, timeoutMs);
  });
}

function parseRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/').map(Number);
  return denominator ? numerator / denominator : null;
}

function probeVideo(ffprobePath, file, timeoutMs = 30_000) {
  const result = spawnSync(ffprobePath, [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,avg_frame_rate,nb_read_frames:format=duration,size',
    '-of', 'json', file,
  ], { encoding: 'utf8', timeout: Math.min(timeoutMs, 30_000), maxBuffer: MAX_CAPTURE_BYTES });
  if (result.error) fail(`ffprobe failed: ${result.error.message}`);
  if (result.status !== 0) fail(`ffprobe exited with code ${result.status}: ${(result.stderr || '').slice(0, 512)}`);
  try { return JSON.parse(result.stdout); } catch { fail('ffprobe returned invalid JSON'); }
}

function validateEncoded(probe, request, sequence, bytes, maxOutputBytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) fail('encoded output is empty');
  if (bytes > maxOutputBytes) fail('encoded output exceeds maxOutputBytes');
  const streams = probe.streams || [];
  const videoStreams = streams.filter(stream => stream.codec_type === 'video');
  const audioStreams = (probe.streams || []).filter(stream => stream.codec_type === 'audio');
  if (streams.length !== 1 || videoStreams.length !== 1 || audioStreams.length !== 0) fail('encoded output must contain exactly one video stream and no other streams');
  const video = videoStreams[0];
  const expectedCodec = request.codec === 'libx264' ? 'h264' : 'hevc';
  if (video.codec_name !== expectedCodec) fail('encoded codec differs from the explicit request');
  if (video.pix_fmt !== request.pixFmt) fail('encoded pixel format differs from the explicit request');
  if (video.width !== request.width || video.height !== request.height) fail('encoded dimensions differ from the explicit request');
  const measuredFps = parseRate(video.avg_frame_rate);
  if (!Number.isFinite(measuredFps) || Math.abs(measuredFps - request.outputFps) > 0.01) fail('encoded frame rate differs from the explicit request');
  const expected = exactOutputTiming(sequence, request);
  const measuredFrames = Number(video.nb_read_frames);
  if (!Number.isInteger(measuredFrames) || measuredFrames !== expected.frameCount) fail('encoded frame count differs from the exact source timing');
  const duration = Number(probe.format?.duration);
  if (!Number.isFinite(duration) || Math.abs(duration - expected.duration) > 0.002) fail('encoded duration differs from the exact source timing');
  return {
    duration, frameCount: measuredFrames, streamCount: streams.length, width: video.width, height: video.height,
    fps: measuredFps, codec: video.codec_name, pixFmt: video.pix_fmt,
  };
}

function publishStaged(staged, destination, io = fs) {
  io.mkdirSync(path.dirname(destination), { recursive: true });
  if (!io.existsSync(staged)) fail('staged artifact does not exist');
  if (!io.lstatSync(staged).isFile()) fail('staged artifact must be a regular file');
  if (io.existsSync(destination)) {
    const destinationStat = io.lstatSync(destination);
    if (destinationStat.isSymbolicLink() || !destinationStat.isFile()) fail('destination must be a regular file');
  }
  io.renameSync(staged, destination);
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const staged = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(staged, data, { flag: 'wx' });
    publishStaged(staged, file);
  } finally {
    if (fs.existsSync(staged)) fs.rmSync(staged, { force: true });
  }
}

function sameFileOrPath(first, second) {
  if (path.resolve(first) === path.resolve(second)) return true;
  if (!fs.existsSync(first) || !fs.existsSync(second)) return false;
  const a = fs.statSync(first);
  const b = fs.statSync(second);
  return a.dev === b.dev && a.ino === b.ino;
}

function rejectUnsafeAliases({ requestPath, receiptPath, inputDir, output }) {
  for (const [label, first, second] of [
    ['request file and receipt file', requestPath, receiptPath],
    ['request file and output', requestPath, output],
    ['receipt file and output', receiptPath, output],
    ['input directory and output', inputDir, output],
  ]) if (sameFileOrPath(first, second)) fail(`${label} must not alias`);
  if (inside(inputDir, receiptPath)) fail('receipt file must be outside the input frame directory');
  if (inside(inputDir, output)) fail('request.output must be outside the input frame directory');
}

function commitOutputAndReceipt(staged, output, receiptPath, receipt) {
  let rollback = null;
  const hadOutput = fs.existsSync(output);
  if (hadOutput) {
    const stat = fs.lstatSync(output);
    if (stat.isSymbolicLink() || !stat.isFile()) fail('destination must be a regular file');
    rollback = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.${crypto.randomUUID()}.rollback`);
    fs.copyFileSync(output, rollback, fs.constants.COPYFILE_EXCL);
  }
  try {
    publishStaged(staged, output);
    atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    try {
      if (rollback && fs.existsSync(rollback)) publishStaged(rollback, output);
      else if (!hadOutput && fs.existsSync(output)) fs.rmSync(output, { force: true });
    } catch (rollbackError) {
      error.message = `${error.message}; rollback failed: ${rollbackError.message}`;
    }
    throw error;
  } finally {
    if (rollback && fs.existsSync(rollback)) fs.rmSync(rollback, { force: true });
  }
}

function receiptFor(request, result, started) {
  return {
    schema: RESULT_SCHEMA, status: result.status, correlationId: request.correlationId,
    operation: 'frame-sequence-to-mp4', input: result.input || null,
    output: result.output || null, choices: result.choices || null,
    tools: result.tools || null, bounds: result.bounds || null,
    timing: { elapsedMs: Date.now() - started },
    warnings: result.warnings || [], diagnostics: result.diagnostics || [],
    nextActions: result.nextActions || [],
    determinism: result.determinism || { scope: 'not-applicable', limits: [] },
  };
}

async function main(argv, deps = {}) {
  if (argv.length !== 3) fail('usage: node tools/frame-sequence-to-mp4.js <project-root> <request.json> <receipt.json>');
  const projectRoot = path.resolve(argv[0]);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) fail('project root must be an existing directory');
  const receiptPath = resolveCliPath(projectRoot, argv[2], { field: 'receipt file' });
  const started = Date.now();
  let requestPath = null;
  let request = null;
  let receiptIdentity = { correlationId: 'unavailable' };
  let choices = null;
  let bounds = null;
  let stageRoot = null;
  let inputEvidence = null;
  let toolEvidence = null;
  let safeToWriteReceipt = true;
  let result;
  try {
    requestPath = resolveCliPath(projectRoot, argv[1], { mustExist: true, field: 'request file' });
    if (sameFileOrPath(requestPath, receiptPath)) {
      safeToWriteReceipt = false;
      fail('request file and receipt file must not alias');
    }
    const raw = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    if (isObject(raw) && typeof raw.correlationId === 'string' && raw.correlationId.length > 0 && raw.correlationId.length <= 128) {
      receiptIdentity = { correlationId: raw.correlationId };
    }
    request = normalizeRequest(raw);
    choices = {
      inputFps: request.inputFps, outputFps: request.outputFps,
      interpolation: request.interpolation, width: request.width, height: request.height,
      scale: request.scale, codec: request.codec, pixFmt: request.pixFmt,
      crf: request.crf, preset: request.preset,
    };
    bounds = {
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxInputBytes: request.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
      maxOutputBytes: request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    };
    const emit = deps.emitProgress || (details => emitJsonl(request, details));
    const inputDir = resolveContained(projectRoot, request.input, { mustExist: true, field: 'request.input' });
    const output = resolveContained(projectRoot, request.output, { field: 'request.output' });
    if (!fs.statSync(inputDir).isDirectory()) fail('request.input must be a directory');
    if (sameFileOrPath(receiptPath, output) || inside(inputDir, receiptPath)) safeToWriteReceipt = false;
    rejectUnsafeAliases({ requestPath, receiptPath, inputDir, output });
    const sequence = validatePngSequence(inputDir, bounds.maxInputBytes);
    exactOutputTiming(sequence, request);
    inputEvidence = { relativePath: request.input, frames: sequence.frameCount, bytes: sequence.bytes, sha256: sequence.sha256 };
    const tools = (deps.resolveMediaTools || resolveMediaTools)();
    if (!tools.ffmpeg || !tools.ffprobe) {
      toolEvidence = { ffmpeg: null, ffprobe: null };
      result = {
        input: inputEvidence, choices, bounds, tools: toolEvidence,
        status: 'needs-user-action', warnings: ['ffmpeg and ffprobe are required'],
        nextActions: ['Provide both tools on PATH or through NAROVA_FFMPEG and NAROVA_FFPROBE'],
      };
    } else {
      const identify = deps.identifyMediaTool || mediaToolIdentity;
      toolEvidence = {
        ffmpeg: identify('ffmpeg', tools.ffmpeg),
        ffprobe: identify('ffprobe', tools.ffprobe),
      };
      fs.mkdirSync(path.dirname(output), { recursive: true });
      stageRoot = fs.mkdtempSync(path.join(path.dirname(output), '.narova-frame-encode-'));
      const staged = path.join(stageRoot, 'clip.mp4');
      const args = buildFfmpegArgs(inputDir, sequence, request, staged);
      emit({ phase: 'starting', elapsedMs: 0 });
      const executed = await (deps.encodeWithFfmpeg || encodeWithFfmpeg)(tools.ffmpeg, args, {
        timeoutMs: bounds.timeoutMs, emitProgress: emit,
      });
      const hashedOutput = hashFile(staged, bounds.maxOutputBytes);
      const probe = await (deps.probeVideo || probeVideo)(tools.ffprobe, staged, bounds.timeoutMs);
      const measured = validateEncoded(probe, request, sequence, hashedOutput.bytes, bounds.maxOutputBytes);
      emit({ phase: 'completed', elapsedMs: Date.now() - started });
      result = {
        status: 'succeeded',
        input: inputEvidence,
        output: { relativePath: request.output, bytes: hashedOutput.bytes, sha256: hashedOutput.sha256, ...measured },
        choices, bounds,
        tools: toolEvidence,
        diagnostics: executed.diagnostics ? [executed.diagnostics] : [],
        determinism: { scope: 'toolchain-bounded', limits: ['FFmpeg build', 'codec build', 'CPU implementation'] },
      };
      const receipt = receiptFor(request, result, started);
      commitOutputAndReceipt(staged, output, receiptPath, receipt);
      return receipt;
    }
  } catch (error) {
    result = {
      status: 'failed', input: inputEvidence, choices, bounds, tools: toolEvidence,
      warnings: [String(error.message || error).slice(0, 1024)],
    };
  } finally {
    if (stageRoot) fs.rmSync(stageRoot, { recursive: true, force: true });
  }
  const receiptRequest = request || receiptIdentity;
  const receipt = receiptFor(receiptRequest, result, started);
  if (!safeToWriteReceipt) fail(result.warnings[0]);
  atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(receipt => {
    if (receipt.status === 'failed') process.exitCode = 1;
    if (receipt.status === 'needs-user-action') process.exitCode = 2;
  }).catch(error => {
    process.stderr.write(`frame-sequence-to-mp4 failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUEST_SCHEMA, RESULT_SCHEMA, SUPPORTED_INTERPOLATION, SUPPORTED_SCALE,
  normalizeRequest, resolveContained, resolveCliPath, detectPngPattern, validatePngSequence,
  resolveMediaTools, mediaToolIdentity, exactOutputTiming, buildFfmpegArgs,
  encodeWithFfmpeg, probeVideo, validateEncoded, atomicWrite, publishStaged,
  rejectUnsafeAliases, commitOutputAndReceipt, main,
};
