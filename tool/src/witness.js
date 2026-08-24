'use strict';
/* Narova Witness: local, artifact-bound visual perceptual evidence.
 *
 * Witness measures the encoded artifact. It does not judge creative quality,
 * relate evidence to intent, mutate projects, or make network/model calls.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCHEMA = 'narova.witness/1';
const FRAME_WIDTH = 64;
const FRAME_HEIGHT = 36;
const MAX_ANALYSIS_FRAMES = 600;
const STATIC_THRESHOLD = 0.01;
const CUT_THRESHOLD = 0.12;
const BLACK_LUMA = 24 / 255;
const MEDIA_INPUT_OPTIONS = Object.freeze(['-protocol_whitelist', 'file,pipe']);
const REGIONS = Object.freeze([
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]);
const TOP_LEVEL_KEYS = new Set([
  'schema', 'bundleId', 'artifact', 'compiler', 'bindings', 'coverage',
  'methods', 'resources', 'subjects', 'observations', 'summary', 'effect',
  'extensions',
]);
const FORBIDDEN_KEYS = new Set([
  'score', 'qualityscore', 'beauty', 'recommendedstyle', 'recommendation',
  'mutation', 'repair', 'aesthetic', 'aesthetics', 'taste', 'ranking', 'rank',
  'verdict', 'desirability', 'engagement', 'engagementscore', 'aestheticscore',
  'beautyscore', 'creativityscore', 'creativequality',
]);
const JUDGE_ONLY_VALUES = new Set(['ALIGNED', 'DIVERGED']);

const round = (value, places = 4) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function stableValue(value, location = '$') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${location} must contain only finite numbers`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item, index) => stableValue(item, `${location}[${index}]`));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${location} must contain only JSON values`);
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`${location}.${key} must not be undefined`);
    result[key] = stableValue(value[key], `${location}.${key}`);
  }
  return result;
}

function canonicalize(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  const digest = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return digest.digest('hex');
}

function verifyArtifactBytes(artifact) {
  let stat;
  try {
    stat = fs.statSync(artifact.path);
  } catch {
    throw new Error('Witness artifact changed during analysis');
  }
  if (!stat.isFile() || stat.size !== artifact.bytes
      || sha256File(artifact.path) !== artifact.sha256) {
    throw new Error('Witness artifact changed during analysis');
  }
  return artifact;
}

function digestRef(value) {
  return { algorithm: 'sha256', digest: sha256(value) };
}

function expectedBundleId(bundle) {
  const { bundleId: ignored, ...payload } = bundle;
  return `sha256:${sha256(canonicalize(payload))}`;
}

function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', args, {
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120000,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') throw new Error('Witness requires ffmpeg for artifact frame analysis');
    if (result.error.code === 'ETIMEDOUT') throw new Error('Witness frame analysis exceeded its time limit');
    throw new Error('Witness could not start bounded frame analysis');
  }
  if (result.status !== 0) throw new Error('Witness could not decode the selected artifact');
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || '');
}

let cachedFfmpegVersion = null;
function ffmpegVersion() {
  if (cachedFfmpegVersion) return cachedFfmpegVersion;
  const result = spawnSync('ffmpeg', ['-version'], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    maxBuffer: 1024 * 1024,
    timeout: 10000,
  });
  const firstLine = result.status === 0 ? String(result.stdout || '').split('\n')[0].trim() : '';
  cachedFfmpegVersion = firstLine || 'ffmpeg-version-unavailable';
  return cachedFfmpegVersion;
}

function mean(buffer) {
  if (!buffer.length) return 0;
  let total = 0;
  for (const value of buffer) total += value;
  return total / buffer.length;
}

function frameDifference(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return null;
  let total = 0;
  for (let index = 0; index < a.length; index++) total += Math.abs(a[index] - b[index]);
  return total / (a.length * 255);
}

function edgeEnergy(buffer) {
  const energy = new Array(9).fill(0);
  for (let y = 1; y < FRAME_HEIGHT - 1; y++) {
    for (let x = 1; x < FRAME_WIDTH - 1; x++) {
      const at = (xx, yy) => buffer[(yy * FRAME_WIDTH) + xx];
      const gx = -at(x - 1, y - 1) + at(x + 1, y - 1)
        - (2 * at(x - 1, y)) + (2 * at(x + 1, y))
        - at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - (2 * at(x, y - 1)) - at(x + 1, y - 1)
        + at(x - 1, y + 1) + (2 * at(x, y + 1)) + at(x + 1, y + 1);
      const column = Math.min(2, Math.floor((x / FRAME_WIDTH) * 3));
      const row = Math.min(2, Math.floor((y / FRAME_HEIGHT) * 3));
      energy[(row * 3) + column] += Math.abs(gx) + Math.abs(gy);
    }
  }
  return energy;
}

function analyzeFrames(file, duration, stream = null) {
  const fps = Math.min(4, MAX_ANALYSIS_FRAMES / duration);
  const selector = stream && Number.isInteger(stream.index) ? `0:${stream.index}` : '0:v:0';
  const timelineOffset = stream && Number.isFinite(stream.timelineOffset) ? stream.timelineOffset : 0;
  let bytes = runFfmpeg([
    '-v', 'error', '-xerror', ...MEDIA_INPUT_OPTIONS, '-i', file, '-map', selector, '-an',
    '-vf', `setpts=PTS-STARTPTS,fps=${fps.toFixed(8)},scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=area,format=gray`,
    '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1',
  ]);
  const frameSize = FRAME_WIDTH * FRAME_HEIGHT;
  if (bytes.length % frameSize !== 0) throw new Error('Witness video decode returned an incomplete frame');
  let count = Math.min(MAX_ANALYSIS_FRAMES, Math.floor(bytes.length / frameSize));
  if (!count) {
    bytes = runFfmpeg([
      '-v', 'error', '-xerror', ...MEDIA_INPUT_OPTIONS, '-i', file, '-map', selector, '-an',
      '-frames:v', '1',
      '-vf', `setpts=PTS-STARTPTS,scale=${FRAME_WIDTH}:${FRAME_HEIGHT}:flags=area,format=gray`,
      '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1',
    ]);
    count = Math.min(1, Math.floor(bytes.length / frameSize));
  }
  if (!count) throw new Error('Witness could not decode any video frames');
  const frames = [];
  let prior = null;
  for (let index = 0; index < count; index++) {
    const gray = bytes.subarray(index * frameSize, (index + 1) * frameSize);
    frames.push({
      index,
      time: Math.min(duration, timelineOffset + (index / fps)),
      bytes: gray.length,
      digest: sha256(gray),
      luma: mean(gray) / 255,
      difference: frameDifference(gray, prior),
      edgeEnergy: edgeEnergy(gray),
    });
    prior = gray;
  }
  return {
    frames,
    sampling: {
      implementation: 'narova.artifact-frame-proxy/v1',
      fps: round(fps, 8),
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT,
      frames: count,
      maximumFrames: MAX_ANALYSIS_FRAMES,
      timestampBasis: `selected stream normalized for sampling, then placed at container-relative offset ${round(timelineOffset, 6)}s; sample n occurs at offset+n/fps`,
      staticThreshold: STATIC_THRESHOLD,
      cutThreshold: CUT_THRESHOLD,
      blackLumaThreshold: round(BLACK_LUMA, 6),
    },
  };
}

function rationalTime(seconds) {
  return { ticks: Math.round(seconds * 100000000), timescale: 100000000 };
}

function series(frames, read) {
  return frames.flatMap((frame, index) => {
    const number = read(frame, index);
    return Number.isFinite(number) ? [{ time: rationalTime(frame.time), number }] : [];
  });
}

function mediaType(artifact) {
  const formats = artifact.container && Array.isArray(artifact.container.formats)
    ? artifact.container.formats : [];
  if (formats.includes('mp4')) return 'video/mp4';
  if (formats.includes('webm')) return 'video/webm';
  if (formats.includes('matroska')) return 'video/x-matroska';
  if (formats.includes('avi')) return 'video/x-msvideo';
  if (formats.includes('mpeg')) return 'video/mpeg';
  if (formats.includes('ogg')) return 'video/ogg';
  const extension = path.extname(artifact.path || '').toLowerCase();
  if (extension === '.mp4' || extension === '.m4v') return 'video/mp4';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.mkv') return 'video/x-matroska';
  return 'application/octet-stream';
}

function implementationDigest() {
  return sha256(fs.readFileSync(__filename));
}

function summarize(observations) {
  const byBasis = { MEASURED: 0, INFERRED: 0, LEARNED: 0, INTERPRETIVE: 0 };
  for (const observation of observations) byBasis[observation.basis] += 1;
  return {
    observations: observations.length,
    available: observations.filter(item => item.availability === 'AVAILABLE').length,
    partial: observations.filter(item => item.availability === 'PARTIAL').length,
    unavailable: observations.filter(item => item.availability === 'UNAVAILABLE').length,
    byBasis,
    escalations: 0,
  };
}

function witnessArtifact(artifact) {
  if (!artifact || !artifact.path || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0
      || !Number.isFinite(artifact.duration) || artifact.duration <= 0) {
    throw new Error('Witness requires a validated encoded-artifact identity');
  }
  verifyArtifactBytes(artifact);
  const analysis = analyzeFrames(artifact.path, artifact.duration, artifact.streams && artifact.streams.video);
  verifyArtifactBytes(artifact);
  const implementation = implementationDigest();
  const options = {
    width: FRAME_WIDTH, height: FRAME_HEIGHT, maximumFrames: MAX_ANALYSIS_FRAMES,
    samplingFps: analysis.sampling.fps,
    selectedStreamIndex: artifact.streams && artifact.streams.video
      && Number.isInteger(artifact.streams.video.index) ? artifact.streams.video.index : 0,
    timelineOffset: artifact.streams && artifact.streams.video
      && Number.isFinite(artifact.streams.video.timelineOffset)
      ? artifact.streams.video.timelineOffset : 0,
    timestampNormalization: 'setpts=PTS-STARTPTS',
    scaleFlags: 'area',
    pixelFormat: 'gray8',
    staticThreshold: STATIC_THRESHOLD, cutThreshold: CUT_THRESHOLD,
    blackLumaThreshold: BLACK_LUMA,
  };
  const optionsRef = digestRef(canonicalize(options));
  const method = {
    id: 'method:artifact.frame-proxy:v1',
    kind: 'narova.artifact.frame-proxy',
    version: '1',
    basis: 'MEASURED',
    deterministic: true,
    implementation: { algorithm: 'sha256', digest: implementation },
    options: optionsRef,
    provider: ffmpegVersion(),
    networkUsed: false,
    limitations: [
      'low-resolution grayscale samples do not establish semantic identity, readability, salience, or creative quality',
      'frame difference is a bounded motion/state-change proxy, not optical flow',
      'edge energy is a spatial contrast proxy, not human attention',
    ],
  };
  const frameResources = analysis.frames.map(frame => ({
    id: `resource:frame:${String(frame.index).padStart(6, '0')}`,
    role: 'ARTIFACT',
    kind: 'decoded-grayscale-frame',
    mediaType: 'application/octet-stream',
    algorithm: 'sha256',
    digest: frame.digest,
    bytes: frame.bytes,
    extensions: {
      'narova.frame-binding': {
        parentArtifact: { algorithm: 'sha256', digest: artifact.sha256 },
        extractionMethod: method.id,
        extractionOptions: optionsRef,
        frameIndex: frame.index,
        time: rationalTime(frame.time),
      },
    },
  }));
  const frameEvidence = frameResources.map(resource => resource.id);
  const observation = (id, kind, values, unit, limitations) => ({
    id,
    kind,
    availability: 'AVAILABLE',
    basis: 'MEASURED',
    sourceRoles: ['ARTIFACT'],
    method: method.id,
    value: { type: 'series', series: values, unit },
    confidence: { value: 1, meaning: 'exact-calculation' },
    evidence: ['resource:artifact', ...frameEvidence],
    limitations,
  });
  const observations = [
    observation(
      'observation:artifact.frame-difference',
      'artifact.frame-difference.mean-absolute-series',
      series(analysis.frames, frame => frame.difference),
      'normalized-absolute-difference',
      ['values compare sampled grayscale frames and do not distinguish camera, subject, or encode motion'],
    ),
    observation(
      'observation:artifact.luma',
      'artifact.luma.mean-series',
      series(analysis.frames, frame => frame.luma),
      'normalized-luma',
      ['mean luma does not establish visibility, contrast, or intended darkness for a subject'],
    ),
    ...REGIONS.map((region, index) => observation(
      `observation:artifact.edge-energy.${region}`,
      `artifact.edge-energy.${region}-series`,
      series(analysis.frames, frame => frame.edgeEnergy[index]),
      'sobel-absolute-gradient-sum',
      ['3x3 regional edge energy is not gaze, salience, composition quality, or readability'],
    )),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const sourceMarker = canonicalize({
    schema: 'narova.witness-source/1',
    profile: 'PIXELS_ONLY',
    privilegedChannels: 'UNAVAILABLE',
  });
  const type = mediaType(artifact);
  const payload = {
    schema: SCHEMA,
    artifact: {
      algorithm: 'sha256', digest: artifact.sha256, bytes: artifact.bytes,
      mediaType: type,
    },
    compiler: {
      name: '@narova/narova:witness',
      version: require('../package.json').version,
      implementation: { algorithm: 'sha256', digest: implementation },
    },
    bindings: {
      witnessSource: { ...digestRef(sourceMarker), schema: 'narova.witness-source/1' },
      analysisOptions: optionsRef,
      references: [],
    },
    coverage: {
      profile: 'PIXELS_ONLY',
      channels: [
        { kind: 'artifact.decoded-grayscale', availability: 'AVAILABLE', resource: 'resource:artifact' },
        { kind: 'dom.element-boxes', availability: 'UNAVAILABLE', reason: 'ADAPTER_DOES_NOT_EXPOSE_CHANNEL' },
        { kind: 'dom.glyph-boxes', availability: 'UNAVAILABLE', reason: 'ADAPTER_DOES_NOT_EXPOSE_CHANNEL' },
        { kind: 'renderer.visual-node-boxes', availability: 'UNAVAILABLE', reason: 'ADAPTER_DOES_NOT_EXPOSE_CHANNEL' },
        { kind: 'renderer.instance-mask', availability: 'UNAVAILABLE', reason: 'ADAPTER_DOES_NOT_EXPOSE_CHANNEL' },
        { kind: 'renderer.depth', availability: 'UNAVAILABLE', reason: 'ADAPTER_DOES_NOT_EXPOSE_CHANNEL' },
        { kind: 'renderer.motion-vectors', availability: 'UNAVAILABLE', reason: 'ADAPTER_DOES_NOT_EXPOSE_CHANNEL' },
      ],
      artifactFrames: { analyzed: analysis.frames.length, propagated: 0, total: analysis.frames.length },
      extensions: { 'narova.sampling': analysis.sampling },
    },
    methods: [method],
    resources: [{
      id: 'resource:artifact', role: 'ARTIFACT', kind: 'encoded-video',
      mediaType: type, algorithm: 'sha256', digest: artifact.sha256, bytes: artifact.bytes,
    }, ...frameResources],
    subjects: [],
    observations,
    summary: summarize(observations),
    effect: 'NONE',
    extensions: {
      'narova.renderer-compatibility': { artifactOnly: ['hyperframes', 'no-browser'] },
    },
  };
  const bundle = { ...payload, bundleId: expectedBundleId(payload) };
  validateWitnessBundle(bundle);
  return bundle;
}

function rejectForbiddenKeys(value, location = '$') {
  if (typeof value === 'string') {
    if (JUDGE_ONLY_VALUES.has(value)) throw new Error(`${location} contains a Judge-only verdict`);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenKeys(item, `${location}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replace(/[-_]/g, '').toLowerCase();
    if (FORBIDDEN_KEYS.has(normalizedKey)) throw new Error(`${location}.${key} is not permitted in Witness evidence`);
    rejectForbiddenKeys(child, `${location}.${key}`);
  }
}

function validateWitnessBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('Witness bundle must be an object');
  const unknown = Object.keys(bundle).filter(key => !TOP_LEVEL_KEYS.has(key));
  if (unknown.length) throw new Error(`Witness bundle contains unknown field ${unknown[0]}`);
  rejectForbiddenKeys(bundle);
  if (bundle.schema !== SCHEMA || bundle.effect !== 'NONE') throw new Error('Witness bundle schema or effect is invalid');
  if (!bundle.artifact || bundle.artifact.algorithm !== 'sha256'
      || !/^[a-f0-9]{64}$/.test(bundle.artifact.digest || '')
      || !Number.isSafeInteger(bundle.artifact.bytes) || bundle.artifact.bytes < 0) {
    throw new Error('Witness artifact binding is invalid');
  }
  for (const key of ['methods', 'resources', 'subjects', 'observations']) {
    if (!Array.isArray(bundle[key])) throw new Error(`Witness ${key} registry must be an array`);
  }
  const registry = values => new Set(values.map(value => value && value.id));
  const methods = registry(bundle.methods);
  const resources = registry(bundle.resources);
  const observations = registry(bundle.observations);
  for (const [name, values] of Object.entries({ methods: bundle.methods, resources: bundle.resources, subjects: bundle.subjects, observations: bundle.observations })) {
    const ids = values.map(value => value && value.id);
    if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error(`Witness ${name} identifiers are invalid`);
    const sorted = ids.slice().sort((left, right) => left.localeCompare(right));
    if (ids.some((id, index) => id !== sorted[index])) throw new Error(`Witness ${name} registry is not canonically ordered`);
  }
  const artifactResource = bundle.resources.find(item => item.id === 'resource:artifact');
  if (!artifactResource || artifactResource.algorithm !== bundle.artifact.algorithm
      || artifactResource.digest !== bundle.artifact.digest
      || artifactResource.bytes !== bundle.artifact.bytes
      || artifactResource.mediaType !== bundle.artifact.mediaType) {
    throw new Error('Witness artifact resource does not match the enclosing artifact binding');
  }
  const frameResources = bundle.resources.filter(item => item.kind === 'decoded-grayscale-frame');
  const frameIndexes = new Set();
  for (const resource of frameResources) {
    const binding = resource.extensions && resource.extensions['narova.frame-binding'];
    const method = binding && bundle.methods.find(item => item.id === binding.extractionMethod);
    if (!binding || !binding.parentArtifact
        || binding.parentArtifact.algorithm !== bundle.artifact.algorithm
        || binding.parentArtifact.digest !== bundle.artifact.digest
        || !method || canonicalize(binding.extractionOptions) !== canonicalize(method.options)
        || !Number.isSafeInteger(binding.frameIndex) || binding.frameIndex < 0
        || frameIndexes.has(binding.frameIndex)
        || !binding.time || !Number.isSafeInteger(binding.time.ticks)
        || !Number.isSafeInteger(binding.time.timescale) || binding.time.timescale <= 0) {
      throw new Error(`Witness frame resource ${resource.id} has an invalid artifact or extraction binding`);
    }
    frameIndexes.add(binding.frameIndex);
  }
  const artifactFrames = bundle.coverage && bundle.coverage.artifactFrames;
  if (!artifactFrames || artifactFrames.analyzed !== frameResources.length) {
    throw new Error('Witness frame coverage does not match its bound frame resources');
  }
  for (const item of bundle.observations) {
    if (!methods.has(item.method)) throw new Error(`Witness observation ${item.id} has an unknown method`);
    if (!['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'].includes(item.availability)
        || !['MEASURED', 'INFERRED', 'LEARNED', 'INTERPRETIVE'].includes(item.basis)
        || !Array.isArray(item.sourceRoles) || !item.sourceRoles.length
        || !item.confidence || !Number.isFinite(item.confidence.value)
        || item.confidence.value < 0 || item.confidence.value > 1
        || !Array.isArray(item.limitations)) {
      throw new Error(`Witness observation ${item.id} has invalid evidence fields`);
    }
    if (item.availability === 'UNAVAILABLE' ? item.value !== undefined : item.value === undefined) {
      throw new Error(`Witness observation ${item.id} has invalid availability/value semantics`);
    }
    for (const evidence of item.evidence || []) {
      if (!resources.has(evidence) && !observations.has(evidence)) throw new Error(`Witness observation ${item.id} has dangling evidence`);
    }
  }
  for (const channel of bundle.coverage && bundle.coverage.channels || []) {
    if (channel.availability === 'AVAILABLE' && !resources.has(channel.resource)) throw new Error(`Witness channel ${channel.kind} has dangling evidence`);
    if (channel.availability !== 'AVAILABLE' && !channel.reason) throw new Error(`Witness channel ${channel.kind} has no unavailable reason`);
  }
  const expectedSummary = summarize(bundle.observations);
  if (canonicalize(bundle.summary) !== canonicalize(expectedSummary)) throw new Error('Witness summary does not match observations');
  if (bundle.bundleId !== expectedBundleId(bundle)) throw new Error('Witness bundle identifier does not match its semantic payload');
  return bundle;
}

function timeNumber(value) {
  return value.ticks / value.timescale;
}

function framesFromBundle(bundle) {
  validateWitnessBundle(bundle);
  const find = kind => bundle.observations.find(item => item.kind === kind)?.value?.series || [];
  const luma = find('artifact.luma.mean-series');
  const differences = new Map(find('artifact.frame-difference.mean-absolute-series')
    .map(item => [timeNumber(item.time).toFixed(8), item.number]));
  const edges = REGIONS.map(region => new Map(find(`artifact.edge-energy.${region}-series`)
    .map(item => [timeNumber(item.time).toFixed(8), item.number])));
  return luma.map(item => {
    const time = timeNumber(item.time);
    const key = time.toFixed(8);
    return {
      time,
      luma: item.number,
      difference: differences.has(key) ? differences.get(key) : null,
      edgeEnergy: edges.map(values => values.get(key) || 0),
    };
  });
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function visualMetrics(bundle, start, end) {
  const selected = framesFromBundle(bundle).filter(frame => frame.time >= start && frame.time < end);
  const differences = selected.slice(1).map(frame => frame.difference).filter(Number.isFinite);
  const entryDifference = start > 0 && selected.length && Math.abs(selected[0].time - start) < 1e-6
    && Number.isFinite(selected[0].difference) ? selected[0].difference : null;
  const edgeTotals = new Array(9).fill(0);
  for (const frame of selected) frame.edgeEnergy.forEach((value, index) => { edgeTotals[index] += value; });
  const totalEdges = edgeTotals.reduce((sum, value) => sum + value, 0);
  const dominantIndex = edgeTotals.indexOf(Math.max(...edgeTotals));
  return {
    motionMean: differences.length ? round(differences.reduce((sum, value) => sum + value, 0) / differences.length) : null,
    motionP95: differences.length ? round(percentile(differences, 0.95)) : null,
    staticRatio: differences.length ? round(differences.filter(value => value <= STATIC_THRESHOLD).length / differences.length) : null,
    blackRatio: selected.length ? round(selected.filter(frame => frame.luma <= BLACK_LUMA).length / selected.length) : null,
    cutCount: differences.length || Number.isFinite(entryDifference)
      ? differences.filter(value => value >= CUT_THRESHOLD).length
        + (Number.isFinite(entryDifference) && entryDifference >= CUT_THRESHOLD ? 1 : 0)
      : null,
    dominantRegion: selected.length ? (totalEdges > 0 ? REGIONS[dominantIndex] : 'none') : null,
    dominantRegionShare: selected.length ? round(totalEdges > 0 ? edgeTotals[dominantIndex] / totalEdges : 0) : null,
    sampledFrames: selected.length,
    comparedFramePairs: differences.length + (Number.isFinite(entryDifference) ? 1 : 0),
    internalComparedFramePairs: differences.length,
    entryDifference: round(entryDifference),
  };
}

function samplingFromBundle(bundle) {
  validateWitnessBundle(bundle);
  return bundle.coverage.extensions['narova.sampling'];
}

function publishWitnessBundle(bundle, output, { verifyInputs } = {}) {
  validateWitnessBundle(bundle);
  if (typeof verifyInputs !== 'function') {
    throw new Error('Witness publication requires commit-time input verification');
  }
  const destination = path.resolve(output);
  const parent = path.dirname(destination);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error('Witness output parent directory must already exist');
  }
  const temporary = `${destination}.part-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    validateWitnessBundle(JSON.parse(fs.readFileSync(temporary, 'utf8')));
    verifyInputs();
    fs.renameSync(temporary, destination);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
  return destination;
}

function formatWitness(bundle, output = null) {
  return [
    'Narova Witness — artifact-bound perceptual evidence',
    `Artifact: sha256:${bundle.artifact.digest} · ${bundle.artifact.bytes} bytes`,
    `Bundle: ${bundle.bundleId}`,
    `Coverage: ${bundle.coverage.profile}; ${bundle.coverage.artifactFrames.analyzed} sampled frame(s); ${bundle.summary.observations} neutral observation series`,
    'Creative authority: evidence only; no score, taste judgement, gate, mutation, model, VLM, or network call.',
    ...(output ? [`Written: ${output}`] : []),
  ].join('\n');
}

module.exports = {
  SCHEMA,
  analyzeFrames,
  canonicalize,
  expectedBundleId,
  formatWitness,
  framesFromBundle,
  publishWitnessBundle,
  samplingFromBundle,
  stableValue,
  validateWitnessBundle,
  verifyArtifactBytes,
  visualMetrics,
  witnessArtifact,
};
