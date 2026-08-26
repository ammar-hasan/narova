#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const REQUEST_SCHEMA = 'narova.3d-dcc-operation/1';
const RESULT_SCHEMA = 'narova.3d-operation-result/1';
const SUPPORTED_OPERATIONS = new Set([
  'assess-environment', 'inspect-scene', 'render-proof-still',
  'render-proof-sequence', 'render-final-shot', 'export',
]);
const UNSUPPORTED_ADVERTISED = new Set([
  'scene-assembly', 'arbitrary-simulation', 'managed-installation',
]);
const KNOWN_OPERATIONS = new Set([...SUPPORTED_OPERATIONS, ...UNSUPPORTED_ADVERTISED]);
const DRIVER = path.join(__dirname, 'blender-dcc-driver.py');
const MAX_TIMEOUT_MS = 600_000;
const MAX_CAPTURE_BYTES = 256 * 1024;
const MAX_DIMENSION = 8192;
const MAX_FRAMES = 10_000;
const MAX_INSPECTION_FRAMES = 32;
const MAX_INSPECTION_OBJECTS = 32;
const MAX_PIXEL_MEASUREMENT_PIXELS = 20_000_000;
const COMMON_BLENDER_PATHS = [
  '/Applications/Blender.app/Contents/MacOS/Blender',
  '/usr/local/bin/blender',
  '/usr/bin/blender',
];

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
function exactKeys(value, field, keys) {
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(`${field}.${key} is not supported`);
}
function sha256hex(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function hashFile(file) { return sha256hex(fs.readFileSync(file)); }

function validateSampleFrames(value, field, maximum) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) fail(`${field} must be a non-empty array of at most ${maximum} frames`);
  let previous = null;
  value.forEach((frame, index) => {
    if (!Number.isInteger(frame)) fail(`${field}[${index}] must be an integer`);
    boundedNumber(frame, `${field}[${index}]`, 0, MAX_FRAMES);
    if (previous !== null && frame <= previous) fail(`${field} must contain unique strictly increasing frames`);
    previous = frame;
  });
}

function normalizeRequest(raw) {
  if (!isObject(raw)) fail('request must be an object');
  exactKeys(raw, 'request', new Set([
    'schema', 'correlationId', 'operation', 'targetOverride', 'secretNames',
    'input', 'output', 'workload', 'requiredCapabilities', 'inspection',
    'evidence',
  ]));
  if (raw.schema !== REQUEST_SCHEMA) fail(`request.schema must be '${REQUEST_SCHEMA}'`);
  boundedString(raw.correlationId, 'request.correlationId', 128);
  boundedString(raw.operation, 'request.operation', 64);
  if (!KNOWN_OPERATIONS.has(raw.operation)) fail(`request.operation '${raw.operation}' is not recognized`);
  if (raw.targetOverride !== undefined) boundedString(raw.targetOverride, 'request.targetOverride', 2048);
  for (const field of ['input', 'output']) if (raw[field] !== undefined) boundedString(raw[field], `request.${field}`, 2048);
  if (raw.input && raw.output && raw.input === raw.output) fail('request.input and request.output must differ');
  if (raw.secretNames !== undefined) {
    if (!Array.isArray(raw.secretNames) || raw.secretNames.length > 32) fail('request.secretNames must be an array of at most 32 names');
    for (const name of raw.secretNames) {
      if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) fail('request.secretNames contains an invalid environment variable name');
    }
  }
  if (raw.requiredCapabilities !== undefined) {
    if (!Array.isArray(raw.requiredCapabilities) || raw.requiredCapabilities.length > 32) fail('request.requiredCapabilities must be an array of at most 32 strings');
    raw.requiredCapabilities.forEach((item, index) => boundedString(item, `request.requiredCapabilities[${index}]`, 128));
  }
  if (raw.workload !== undefined) {
    if (!isObject(raw.workload)) fail('request.workload must be an object');
    exactKeys(raw.workload, 'request.workload', new Set([
      'width', 'height', 'startFrame', 'endFrame', 'fps', 'engine',
      'timeoutMs', 'deadlineMs', 'maxMemoryBytes', 'maxOutputBytes',
      'sampleFrames',
    ]));
    const w = raw.workload;
    if (w.width !== undefined) boundedNumber(w.width, 'request.workload.width', 1, MAX_DIMENSION);
    if (w.height !== undefined) boundedNumber(w.height, 'request.workload.height', 1, MAX_DIMENSION);
    if (w.startFrame !== undefined) boundedNumber(w.startFrame, 'request.workload.startFrame', 0, MAX_FRAMES);
    if (w.endFrame !== undefined) boundedNumber(w.endFrame, 'request.workload.endFrame', 0, MAX_FRAMES);
    if (w.startFrame !== undefined && w.endFrame !== undefined && w.endFrame < w.startFrame) fail('request.workload.endFrame must be >= startFrame');
    if (w.fps !== undefined) boundedNumber(w.fps, 'request.workload.fps', 1, 240);
    if (w.engine !== undefined) boundedString(w.engine, 'request.workload.engine', 64);
    if (w.timeoutMs !== undefined) boundedNumber(w.timeoutMs, 'request.workload.timeoutMs', 1, MAX_TIMEOUT_MS);
    if (w.deadlineMs !== undefined) boundedNumber(w.deadlineMs, 'request.workload.deadlineMs', 1, Number.MAX_SAFE_INTEGER);
    if (w.maxMemoryBytes !== undefined) boundedNumber(w.maxMemoryBytes, 'request.workload.maxMemoryBytes', 1, Number.MAX_SAFE_INTEGER);
    if (w.maxOutputBytes !== undefined) boundedNumber(w.maxOutputBytes, 'request.workload.maxOutputBytes', 1, Number.MAX_SAFE_INTEGER);
    if (w.sampleFrames !== undefined) {
      if (!['inspect-scene', 'render-proof-sequence'].includes(raw.operation)) fail('request.workload.sampleFrames is supported only for inspect-scene and render-proof-sequence');
      if (w.startFrame !== undefined || w.endFrame !== undefined) fail('request.workload.sampleFrames cannot be combined with startFrame or endFrame');
      validateSampleFrames(w.sampleFrames, 'request.workload.sampleFrames', raw.operation === 'render-proof-sequence' ? 10 : MAX_INSPECTION_FRAMES);
    }
  }
  if (raw.inspection !== undefined) {
    if (raw.operation !== 'inspect-scene') fail('request.inspection is supported only for inspect-scene');
    if (!isObject(raw.inspection)) fail('request.inspection must be an object');
    exactKeys(raw.inspection, 'request.inspection', new Set(['objects']));
    if (raw.inspection.objects !== undefined) {
      if (!Array.isArray(raw.inspection.objects) || raw.inspection.objects.length > MAX_INSPECTION_OBJECTS) fail(`request.inspection.objects must be an array of at most ${MAX_INSPECTION_OBJECTS} names`);
      const names = new Set();
      raw.inspection.objects.forEach((name, index) => {
        boundedString(name, `request.inspection.objects[${index}]`, 128);
        if (names.has(name)) fail('request.inspection.objects must contain unique names');
        names.add(name);
      });
    }
  }
  if (raw.evidence !== undefined) {
    if (!['render-proof-still', 'render-proof-sequence'].includes(raw.operation)) fail('request.evidence is supported only for proof rendering');
    if (!isObject(raw.evidence)) fail('request.evidence must be an object');
    exactKeys(raw.evidence, 'request.evidence', new Set(['pixelMeasurements']));
    if (raw.evidence.pixelMeasurements !== true) fail('request.evidence.pixelMeasurements must be true when supplied');
    const width = raw.workload?.width ?? 640;
    const height = raw.workload?.height ?? 360;
    const frameCount = raw.operation === 'render-proof-still'
      ? 1
      : raw.workload?.sampleFrames?.length
        ?? ((raw.workload?.endFrame ?? (raw.workload?.startFrame ?? 1)) - (raw.workload?.startFrame ?? 1) + 1);
    if (width * height * frameCount > MAX_PIXEL_MEASUREMENT_PIXELS) {
      fail(`request.evidence pixel budget exceeds ${MAX_PIXEL_MEASUREMENT_PIXELS} pixels`);
    }
  }
  return raw;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePngRgb8(data) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(data) || data.length < 33 || !data.subarray(0, 8).equals(signature)) fail('pixel measurement requires a valid PNG');
  let offset = 8;
  let header = null;
  const compressed = [];
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > data.length) fail('pixel measurement PNG chunk is truncated');
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      if (length !== 13) fail('pixel measurement PNG has an invalid IHDR');
      header = {
        width: chunk.readUInt32BE(0), height: chunk.readUInt32BE(4), bitDepth: chunk[8],
        colorType: chunk[9], compression: chunk[10], filter: chunk[11], interlace: chunk[12],
      };
    } else if (type === 'IDAT') compressed.push(chunk);
    else if (type === 'IEND') break;
    offset = end;
  }
  if (!header || compressed.length === 0) fail('pixel measurement PNG is missing required chunks');
  if (header.width < 1 || header.height < 1 || header.width * header.height > MAX_PIXEL_MEASUREMENT_PIXELS) fail('pixel measurement PNG dimensions exceed the bounded profile');
  if (header.bitDepth !== 8 || ![2, 6].includes(header.colorType) || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
    fail('pixel measurement supports only non-interlaced 8-bit RGB or RGBA PNG');
  }
  const channels = header.colorType === 6 ? 4 : 3;
  const stride = header.width * channels;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * header.height }); }
  catch { fail('pixel measurement PNG data could not be decoded'); }
  if (raw.length !== (stride + 1) * header.height) fail('pixel measurement PNG scanline size is invalid');
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) fail('pixel measurement PNG uses an unsupported scanline filter');
    const sourceStart = y * (stride + 1) + 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const source = raw[sourceStart + x];
      const left = x >= channels ? pixels[rowStart + x - channels] : 0;
      const above = y > 0 ? pixels[rowStart + x - stride] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[rowStart + x - stride - channels] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? above
            : filter === 3 ? Math.floor((left + above) / 2)
              : paeth(left, above, upperLeft);
      pixels[rowStart + x] = (source + predictor) & 255;
    }
  }
  return { ...header, channels, pixels };
}

function roundedMetric(value) { return Math.round(value * 1_000_000) / 1_000_000; }
function percentile(histogram, total, fraction) {
  const target = Math.max(1, Math.ceil(total * fraction));
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index];
    if (seen >= target) return roundedMetric(index / 255);
  }
  return 1;
}

function measurePng(data) {
  const decoded = decodePngRgb8(data);
  const total = decoded.width * decoded.height;
  const lumaHistogram = new Uint32Array(256);
  const saturationHistogram = new Uint32Array(256);
  const sums = { red: 0, green: 0, blue: 0, luma: 0, saturation: 0, alpha: 0 };
  const minima = { red: 255, green: 255, blue: 255, luma: 1, saturation: 1, alpha: 255 };
  const maxima = { red: 0, green: 0, blue: 0, luma: 0, saturation: 0, alpha: 0 };
  let nearDark = 0;
  let nearBright = 0;
  let transparent = 0;
  for (let index = 0; index < decoded.pixels.length; index += decoded.channels) {
    const red8 = decoded.pixels[index];
    const green8 = decoded.pixels[index + 1];
    const blue8 = decoded.pixels[index + 2];
    const alpha8 = decoded.channels === 4 ? decoded.pixels[index + 3] : 255;
    const red = red8 / 255;
    const green = green8 / 255;
    const blue = blue8 / 255;
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const highest = Math.max(red, green, blue);
    const lowest = Math.min(red, green, blue);
    const saturation = highest === 0 ? 0 : (highest - lowest) / highest;
    const lumaBin = Math.min(255, Math.max(0, Math.round(luma * 255)));
    const saturationBin = Math.min(255, Math.max(0, Math.round(saturation * 255)));
    lumaHistogram[lumaBin] += 1;
    saturationHistogram[saturationBin] += 1;
    for (const [name, value] of [['red', red8], ['green', green8], ['blue', blue8], ['alpha', alpha8]]) {
      sums[name] += value;
      minima[name] = Math.min(minima[name], value);
      maxima[name] = Math.max(maxima[name], value);
    }
    sums.luma += luma;
    sums.saturation += saturation;
    minima.luma = Math.min(minima.luma, luma);
    maxima.luma = Math.max(maxima.luma, luma);
    minima.saturation = Math.min(minima.saturation, saturation);
    maxima.saturation = Math.max(maxima.saturation, saturation);
    if (luma <= 16 / 255) nearDark += 1;
    if (luma >= 235 / 255) nearBright += 1;
    if (alpha8 === 0) transparent += 1;
  }
  const channel = name => ({
    min: roundedMetric(minima[name] / 255), max: roundedMetric(maxima[name] / 255),
    mean: roundedMetric(sums[name] / total / 255),
  });
  return {
    basis: {
      pixels: 'decoded-png-8bit-rgb', luma: 'rec709:0.2126R+0.7152G+0.0722B',
      saturation: 'hsv:(max-min)/max', alpha: decoded.channels === 4 ? 'decoded-alpha' : 'implicit-opaque',
      nearDarkThreshold: roundedMetric(16 / 255), nearBrightThreshold: roundedMetric(235 / 255),
    },
    width: decoded.width, height: decoded.height, pixelCount: total,
    channels: { red: channel('red'), green: channel('green'), blue: channel('blue') },
    luma: {
      min: roundedMetric(minima.luma), max: roundedMetric(maxima.luma), mean: roundedMetric(sums.luma / total),
      p05: percentile(lumaHistogram, total, 0.05), p50: percentile(lumaHistogram, total, 0.5), p95: percentile(lumaHistogram, total, 0.95),
      nearDarkFraction: roundedMetric(nearDark / total), nearBrightFraction: roundedMetric(nearBright / total),
    },
    saturation: {
      min: roundedMetric(minima.saturation), max: roundedMetric(maxima.saturation), mean: roundedMetric(sums.saturation / total),
      p05: percentile(saturationHistogram, total, 0.05), p50: percentile(saturationHistogram, total, 0.5), p95: percentile(saturationHistogram, total, 0.95),
    },
    alpha: {
      min: roundedMetric(minima.alpha / 255), max: roundedMetric(maxima.alpha / 255), mean: roundedMetric(sums.alpha / total / 255),
      transparentFraction: roundedMetric(transparent / total),
    },
  };
}

function measureStagedPngs(staged, destination, projectRoot) {
  const files = fs.statSync(staged).isDirectory()
    ? fs.readdirSync(staged).sort().map(name => ({ staged: path.join(staged, name), destination: path.join(destination, name) }))
    : [{ staged, destination }];
  return files.map(item => {
    const data = fs.readFileSync(item.staged);
    return {
      relativePath: path.relative(projectRoot, item.destination),
      sourceSha256: sha256hex(data),
      ...measurePng(data),
    };
  });
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
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) fail(`${field} must not be a symbolic link`);
    if (!inside(realRoot, fs.realpathSync(candidate))) fail(`${field} escapes the project through a symbolic link`);
  } else {
    const existing = nearestExisting(candidate);
    if (!existing || !inside(realRoot, fs.realpathSync(existing))) fail(`${field} escapes the project through a symbolic link`);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) fail(`${field} must not be a symbolic link`);
  }
  return candidate;
}

function resolveTarget(projectRoot, request, options = {}) {
  const exists = options.existsSync || fs.existsSync;
  const env = options.env || process.env;
  const common = options.commonPaths || COMMON_BLENDER_PATHS;
  const candidates = [];
  if (request.targetOverride) candidates.push({ path: path.isAbsolute(request.targetOverride) ? request.targetOverride : path.resolve(projectRoot, request.targetOverride), source: 'request-override' });
  if (env.NAROVA_BLENDER) candidates.push({ path: env.NAROVA_BLENDER, source: 'NAROVA_BLENDER' });
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) candidates.push({ path: path.join(dir, process.platform === 'win32' ? 'blender.exe' : 'blender'), source: 'PATH' });
  for (const file of common) candidates.push({ path: file, source: 'common-location' });
  for (const candidate of candidates) if (exists(candidate.path)) return candidate;
  return null;
}

function redactSecrets(text, secretNames = [], env = process.env) {
  if (typeof text !== 'string') return text;
  let redacted = text;
  for (const name of secretNames) {
    const value = env[name];
    if (typeof value === 'string' && value.length > 0) redacted = redacted.split(value).join(`[REDACTED:${name}]`);
  }
  return redacted;
}

function executeBlender(blenderPath, args, options = {}) {
  const timeoutMs = Math.min(options.timeoutMs || 120_000, MAX_TIMEOUT_MS);
  const emit = options.emitProgress || (() => {});
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const started = Date.now();
    const detached = process.platform !== 'win32';
    const child = spawn(blenderPath, args, { stdio: ['ignore', 'pipe', 'pipe'], detached });
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
    const append = (current, chunk) => {
      const next = current + chunk.toString();
      if (Buffer.byteLength(next) > MAX_CAPTURE_BYTES) {
        terminate('SIGKILL');
        finish(new Error('blender diagnostics exceeded the capture limit'));
        return current;
      }
      return next;
    };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', error => finish(error));
    child.on('close', code => {
      const diagnostic = redactSecrets(stderr, options.secretNames, options.env).slice(0, MAX_CAPTURE_BYTES);
      if (timedOut) return finish(new Error(`blender execution timed out after ${timeoutMs}ms`));
      if (code !== 0) return finish(new Error(`blender exited with code ${code}: ${diagnostic}`));
      finish(null, {
        stdout: redactSecrets(stdout, options.secretNames, options.env),
        stderr: diagnostic,
        elapsedMs: Date.now() - started,
      });
    });
    heartbeat = setInterval(() => emit({ phase: 'running', elapsedMs: Date.now() - started }), 2000);
    timer = setTimeout(() => {
      timedOut = true;
      terminate('SIGTERM');
      setTimeout(() => terminate('SIGKILL'), 250).unref();
    }, timeoutMs);
  });
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const staged = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(staged, data, { flag: 'wx' });
  publishStaged(staged, file);
}

function publishStaged(staged, destination, io = fs) {
  io.mkdirSync(path.dirname(destination), { recursive: true });
  if (!io.existsSync(staged)) fail('staged artifact does not exist');
  if (io.existsSync(destination) && io.lstatSync(destination).isSymbolicLink()) fail('destination must not be a symbolic link');
  const backup = path.join(path.dirname(destination), `.${path.basename(destination)}.${process.pid}.${crypto.randomUUID()}.backup`);
  let backedUp = false;
  try {
    if (io.existsSync(destination)) {
      io.renameSync(destination, backup);
      backedUp = true;
    }
    io.renameSync(staged, destination);
  } catch (error) {
    if (backedUp && !io.existsSync(destination) && io.existsSync(backup)) io.renameSync(backup, destination);
    throw error;
  }
  if (backedUp) {
    try {
      io.rmSync(backup, { recursive: true, force: true });
    } catch {
      // Publication has committed. A stale private backup is safer than
      // reporting failure after the destination has already changed.
    }
  }
}

function machineFacts() {
  let storage = { value: null, grade: 'unknown' };
  try {
    const stat = fs.statfsSync(process.cwd());
    storage = { value: stat.bavail * stat.bsize, grade: 'measurement' };
  } catch {}
  return {
    os: { value: os.platform(), architecture: os.arch(), grade: 'measurement' },
    cpu: { logicalCores: os.cpus().length, grade: 'measurement' },
    memoryBytes: { value: os.totalmem(), grade: 'measurement' },
    storageBytesAvailable: storage,
    gpuBackend: { value: null, grade: 'unknown' },
  };
}

function operationDecisions(available, workload = {}) {
  const result = {};
  for (const op of SUPPORTED_OPERATIONS) {
    let state = available ? 'unknown' : 'unsuitable';
    let reasons = available ? ['target is available but operation-specific scene/backend evidence is incomplete'] : ['Blender target is unavailable'];
    if (op === 'assess-environment') {
      state = available ? 'suitable' : 'unsuitable';
      reasons = available ? ['target version probe succeeded'] : ['Blender target is unavailable'];
    }
    result[op] = { state, reasons, evidenceGrades: available ? ['measurement', 'declaration', 'unknown'] : ['measurement'] };
  }
  for (const op of UNSUPPORTED_ADVERTISED) result[op] = { state: 'unsuitable', reasons: ['operation is outside this bounded adapter'], evidenceGrades: ['declaration'] };
  return result;
}

function alternativesFor(request, reason) {
  const retained = request.requiredCapabilities || [];
  return [
    {
      id: 'use-existing-compatible-blender', kind: 'local-target', unranked: true,
      retained, lost: [], unknown: ['target version and workload suitability until assessed'],
      editability: 'editable Blender source retained',
      fidelity: { physical: 'unknown', spatial: 'unknown', visual: 'unknown' },
      time: 'unknown', cost: 'no Narova charge; acquisition cost unknown', privacy: 'local', reversibility: 'full',
    },
    {
      id: 'stop-before-production', kind: 'stop', unranked: true,
      retained: ['declared creative intent and existing project state'], lost: ['requested DCC result'], unknown: [],
      editability: 'unchanged', fidelity: { physical: 'unchanged', spatial: 'unchanged', visual: 'unchanged' },
      time: 'immediate', cost: 'none', privacy: 'no transmission', reversibility: 'full', reason,
    },
  ];
}

function workloadEvidence(workload = {}) {
  const declared = key => workload[key] === undefined ? { value: null, grade: 'unknown' } : { value: workload[key], grade: 'declaration' };
  return {
    dimensions: { width: declared('width'), height: declared('height') },
    frames: { start: declared('startFrame'), end: declared('endFrame') },
    sampleFrames: declared('sampleFrames'),
    fps: declared('fps'), engine: declared('engine'), deadlineMs: declared('deadlineMs'),
    timeoutMs: declared('timeoutMs'), maxMemoryBytes: declared('maxMemoryBytes'), maxOutputBytes: declared('maxOutputBytes'),
  };
}

function emitJsonl(request, details) {
  const event = {
    schema: 'narova.3d-operation-progress/1', correlationId: request.correlationId,
    operation: request.operation, phase: details.phase, elapsedMs: details.elapsedMs,
  };
  process.stderr.write(`${JSON.stringify(event)}\n`);
}

function outputRecords(destination, projectRoot, kind) {
  if (!destination || !fs.existsSync(destination)) return [];
  const files = fs.statSync(destination).isDirectory()
    ? fs.readdirSync(destination).sort().map(name => path.join(destination, name)).filter(file => fs.statSync(file).isFile())
    : [destination];
  return files.map(file => ({
    relativePath: path.relative(projectRoot, file), bytes: fs.statSync(file).size,
    sha256: hashFile(file), kind,
  }));
}

function validateArtifact(operation, staged, driverResult, request) {
  if (operation === 'inspect-scene') {
    if (!isObject(driverResult.inspection)) fail('Blender inspection result is missing');
    return;
  }
  if (!fs.existsSync(staged)) fail('Blender did not produce the expected output');
  if (operation === 'render-proof-sequence' || operation === 'render-final-shot') {
    if (!fs.statSync(staged).isDirectory()) fail('Blender sequence output is not a directory');
    const files = fs.readdirSync(staged).sort();
    const frames = request.workload?.sampleFrames || (() => {
      const start = request.workload?.startFrame ?? 1;
      const end = request.workload?.endFrame ?? start;
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    })();
    const expected = frames.map(frame => `frame_${String(frame).padStart(4, '0')}.png`);
    if (files.length !== expected.length || files.some((name, index) => name !== expected[index])) fail('Blender produced an invalid or incomplete frame sequence');
    for (const name of files) if (fs.statSync(path.join(staged, name)).size === 0) fail('Blender produced an empty frame');
  } else if (!fs.statSync(staged).isFile() || fs.statSync(staged).size === 0) {
    fail('Blender produced an empty or invalid output file');
  }
  const max = request.workload?.maxOutputBytes;
  if (max !== undefined) {
    const bytes = fs.statSync(staged).isDirectory()
      ? fs.readdirSync(staged).reduce((sum, name) => sum + fs.statSync(path.join(staged, name)).size, 0)
      : fs.statSync(staged).size;
    if (bytes > max) fail('Blender output exceeded maxOutputBytes');
  }
}

async function assess(projectRoot, request, deps) {
  const target = (deps.resolveTarget || resolveTarget)(projectRoot, request, deps.targetOptions);
  let targetSection = { available: false, path: null, source: 'not-found', version: null, headless: { value: null, grade: 'unknown' } };
  if (target) {
    try {
      const executed = await (deps.executeBlender || executeBlender)(target.path, ['--version'], {
        timeoutMs: request.workload?.timeoutMs || 15_000, secretNames: request.secretNames,
        emitProgress: details => (deps.emitProgress || (() => {}))(details),
      });
      targetSection = {
        available: true, path: target.path, source: target.source,
        version: executed.stdout.match(/Blender\s+(\S+)/)?.[1] || null,
        headless: { value: true, grade: 'measurement' },
      };
    } catch (error) {
      targetSection = { available: false, path: target.path, source: target.source, version: null, headless: { value: null, grade: 'unknown' }, diagnostic: error.message.slice(0, 512) };
    }
  }
  const payload = {
    target: targetSection, machine: machineFacts(), workload: workloadEvidence(request.workload),
    decision: operationDecisions(targetSection.available, request.workload),
  };
  return targetSection.available
    ? { status: 'succeeded', target: targetSection, payload }
    : { status: 'needs-user-action', target: targetSection, payload, warnings: ['Blender is not available'], nextActions: ['Provide an existing compatible Blender executable or authorize a separately scoped installation workflow'], alternatives: alternativesFor(request, 'No compatible Blender target was resolved') };
}

async function runDccOperation(projectRoot, request, deps) {
  const target = (deps.resolveTarget || resolveTarget)(projectRoot, request, deps.targetOptions);
  if (!target) return {
    status: 'needs-user-action', target: { available: false, source: 'not-found' },
    warnings: ['Blender is not available'],
    nextActions: ['Provide an existing compatible Blender executable or authorize a separately scoped installation workflow'],
    alternatives: alternativesFor(request, 'No compatible Blender target was resolved'),
  };
  if (!request.input) return { status: 'failed', target: { available: true, ...target }, warnings: ['request.input is required'] };
  const input = resolveContained(projectRoot, request.input, { mustExist: true, field: 'request.input' });
  const needsOutput = request.operation !== 'inspect-scene';
  if (needsOutput && !request.output) return { status: 'failed', target: { available: true, ...target }, warnings: ['request.output is required'] };
  const destination = needsOutput ? resolveContained(projectRoot, request.output, { field: 'request.output' }) : null;
  const stageParent = destination ? path.dirname(destination) : projectRoot;
  fs.mkdirSync(stageParent, { recursive: true });
  const stageRoot = fs.mkdtempSync(path.join(stageParent, '.narova-dcc-stage-'));
  const sequence = request.operation === 'render-proof-sequence' || request.operation === 'render-final-shot';
  const staged = needsOutput ? path.join(stageRoot, sequence ? 'artifact' : `artifact${request.operation === 'export' ? '.blend' : '.png'}`) : null;
  const driverRequest = path.join(stageRoot, 'request.json');
  const driverResultPath = path.join(stageRoot, 'result.json');
  const normalizedWorkload = {
    width: request.workload?.width ?? (request.operation.startsWith('render-proof') ? 640 : 1920),
    height: request.workload?.height ?? (request.operation.startsWith('render-proof') ? 360 : 1080),
    fps: request.workload?.fps ?? 30,
    engine: request.workload?.engine ?? null,
  };
  if (request.workload?.sampleFrames) {
    normalizedWorkload.sampleFrames = [...request.workload.sampleFrames];
  } else {
    normalizedWorkload.startFrame = request.workload?.startFrame ?? 1;
    normalizedWorkload.endFrame = request.workload?.endFrame ?? (request.workload?.startFrame ?? 1);
  }
  if (request.operation === 'render-proof-sequence' && !normalizedWorkload.sampleFrames && normalizedWorkload.endFrame - normalizedWorkload.startFrame + 1 > 10) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    return { status: 'failed', target: { available: true, ...target }, warnings: ['proof sequence is limited to 10 frames'] };
  }
  fs.writeFileSync(driverRequest, `${JSON.stringify({ operation: request.operation, outputPath: staged, workload: normalizedWorkload, inspection: request.inspection || {} })}\n`);
  const args = ['--background', input, '--python', DRIVER, '--', request.operation, driverRequest, driverResultPath];
  const emit = deps.emitProgress || (details => emitJsonl(request, details));
  try {
    emit({ phase: 'starting', elapsedMs: 0 });
    const executed = await (deps.executeBlender || executeBlender)(target.path, args, {
      timeoutMs: request.workload?.timeoutMs || (request.operation === 'render-final-shot' ? 300_000 : 120_000),
      secretNames: request.secretNames, emitProgress: emit,
    });
    if (!fs.existsSync(driverResultPath)) fail('Blender driver did not return a result');
    const driverResult = JSON.parse(fs.readFileSync(driverResultPath, 'utf8'));
    if (driverResult.status !== 'succeeded') fail(driverResult.error || 'Blender driver failed');
    validateArtifact(request.operation, staged, driverResult, request);
    const pixelMeasurements = request.evidence?.pixelMeasurements
      ? measureStagedPngs(staged, destination, projectRoot)
      : null;
    if (destination) publishStaged(staged, destination);
    emit({ phase: 'completed', elapsedMs: executed.elapsedMs || 0 });
    return {
      status: 'succeeded', target: { available: true, ...target, runtime: driverResult.runtime || null },
      input: { relativePath: request.input, bytes: fs.statSync(input).size, sha256: hashFile(input) },
      outputs: outputRecords(destination, projectRoot, driverResult.kind || 'binary'),
      diagnostics: executed.stderr ? [executed.stderr.slice(0, 1024)] : [],
      payload: request.operation === 'inspect-scene'
        ? { inspection: driverResult.inspection }
        : {
          ...driverResult.payload, workload: normalizedWorkload,
          authoredLocalAsset: true, editableSource: request.operation === 'export',
          ...(pixelMeasurements ? { pixelMeasurements } : {}),
        },
      determinism: { scope: 'target-bounded', limits: driverResult.determinismLimits || ['Blender version', 'render engine', 'hardware backend'] },
    };
  } catch (error) {
    return { status: 'failed', target: { available: true, ...target }, warnings: [redactSecrets(error.message, request.secretNames).slice(0, 1024)] };
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function receiptFor(request, result, started) {
  return {
    schema: RESULT_SCHEMA, status: result.status, correlationId: request.correlationId,
    operation: request.operation, target: result.target || { available: false },
    input: result.input || null, outputs: result.outputs || [],
    timing: { elapsedMs: Date.now() - started }, warnings: result.warnings || [],
    diagnostics: result.diagnostics || [], determinism: result.determinism || { scope: 'not-applicable', limits: [] },
    nextActions: result.nextActions || [], alternatives: result.alternatives || [], payload: result.payload || {},
  };
}

async function main(argv, deps = {}) {
  if (argv.length !== 3) fail('usage: node tools/blender-dcc.js <project-root> <request.json> <receipt.json>');
  const projectRoot = path.resolve(argv[0]);
  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) fail('project root must be an existing directory');
  const requestPath = resolveContained(projectRoot, path.relative(projectRoot, path.resolve(argv[1])), { mustExist: true, field: 'request file' });
  const receiptPath = resolveContained(projectRoot, path.relative(projectRoot, path.resolve(argv[2])), { field: 'receipt file' });
  const request = normalizeRequest(JSON.parse(fs.readFileSync(requestPath, 'utf8')));
  const started = Date.now();
  let result;
  if (UNSUPPORTED_ADVERTISED.has(request.operation)) {
    result = {
      status: 'needs-user-action', target: { available: 'unknown', source: 'not-resolved' },
      warnings: [`${request.operation} is outside this bounded Blender adapter`],
      nextActions: ['Use a deliberate Blender authoring workflow or choose a capability-preserving alternative'],
      alternatives: alternativesFor(request, `${request.operation} is unsupported`),
    };
  } else if (request.operation === 'assess-environment') result = await assess(projectRoot, request, deps);
  else result = await runDccOperation(projectRoot, request, deps);
  const receipt = receiptFor(request, result, started);
  atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`blender-dcc failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUEST_SCHEMA, RESULT_SCHEMA, SUPPORTED_OPERATIONS, UNSUPPORTED_ADVERTISED,
  normalizeRequest, resolveContained, resolveTarget, redactSecrets, executeBlender,
  atomicWrite, publishStaged, alternativesFor, validateArtifact, sha256hex,
  decodePngRgb8, measurePng, main,
};
