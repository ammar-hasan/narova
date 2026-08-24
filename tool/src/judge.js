'use strict';
/* Video CI Phase 1 (NAR-SPEC-023).
 *
 * This module is deliberately a mirror, not a taste model. It measures the
 * encoded artifact, joins those facts to authored intent and production state,
 * and says UNCERTAIN whenever the active local perceivers cannot establish a
 * semantic claim. No report path is written and no provider/network work runs.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  loadVideoCiBinding,
} = require('./video-ci-binding');
const {
  analyzeFrames, framesFromBundle, samplingFromBundle, visualMetrics, witnessArtifact,
} = require('./witness');

const REPORT_SCHEMA = 'narova.judgement/1';
const FAMILIES = Object.freeze([
  'intent-rendered-correspondence',
  'visual-narrative-correspondence',
  'entity-continuity',
  'attention-visual-hierarchy',
  'temporal-behavior',
]);
const SILENCE_DB = -50;
const MAX_CONTEXT_BYTES = 1024 * 1024;
const MEDIA_INPUT_OPTIONS = Object.freeze(['-protocol_whitelist', 'file,pipe']);
const INDIRECT_MEDIA_FORMATS = new Set(['concat', 'dash', 'hls', 'image2', 'image2pipe', 'sdp']);

const round = (value, places = 4) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function hashBytes(file) {
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

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    ...opts,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', ...(opts.env || {}) },
    maxBuffer: opts.maxBuffer || 32 * 1024 * 1024,
    timeout: opts.timeout || 120000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : String(result.stderr || '');
    const detail = stderr.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
    throw new Error(`${command} analysis exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function probeArtifact(file) {
  const requested = path.resolve(file);
  if (!fs.existsSync(requested)) throw new Error(`judge video not found: ${requested}`);
  const resolved = fs.realpathSync(requested);
  if (!fs.statSync(resolved).isFile()) throw new Error(`judge video is not a regular file: ${resolved}`);
  const result = run('ffprobe', [
    '-v', 'error', ...MEDIA_INPUT_OPTIONS, '-show_entries',
    'format=format_name,start_time,duration:stream=index,codec_type,codec_name,width,height,sample_rate,channels,start_time,duration:stream_disposition=default,attached_pic,still_image',
    '-of', 'json', resolved,
  ], { encoding: 'utf8' });
  let document;
  try { document = JSON.parse(result.stdout); }
  catch (error) { throw new Error(`ffprobe returned invalid artifact metadata: ${error.message}`); }
  const streams = Array.isArray(document.streams) ? document.streams : [];
  const formats = String(document.format && document.format.format_name || '')
    .split(',').map(value => value.trim()).filter(Boolean);
  if (!formats.length || formats.some(format => INDIRECT_MEDIA_FORMATS.has(format))) {
    throw new Error(`judge artifact is not a supported self-contained encoded media file: ${resolved}`);
  }
  const isTimedVideo = stream => stream.codec_type === 'video'
    && !(stream.disposition && (stream.disposition.attached_pic === 1 || stream.disposition.still_image === 1));
  const select = type => {
    const candidates = streams.filter(stream => type === 'video' ? isTimedVideo(stream) : stream.codec_type === type);
    return candidates.find(stream => stream.disposition && stream.disposition.default === 1)
      || candidates[0] || null;
  };
  const video = select('video');
  if (!video) throw new Error(`judge artifact has no decodable video stream: ${resolved}`);
  const duration = Number(document.format && document.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`judge artifact has no positive measured duration: ${resolved}`);
  }
  const audio = select('audio');
  const subtitles = streams.filter(stream => stream.codec_type === 'subtitle');
  const formatStart = Number(document.format && document.format.start_time);
  const finiteStarts = streams.map(stream => Number(stream.start_time)).filter(Number.isFinite);
  const timelineOrigin = Number.isFinite(formatStart) ? formatStart
    : finiteStarts.length ? Math.min(...finiteStarts) : 0;
  const common = stream => ({
    index: Number.isInteger(stream.index) ? stream.index : null,
    codec: stream.codec_name || null,
    default: Boolean(stream.disposition && stream.disposition.default === 1),
    start: Number.isFinite(Number(stream.start_time)) ? round(Number(stream.start_time), 6) : null,
    duration: Number.isFinite(Number(stream.duration)) ? round(Number(stream.duration), 6) : null,
    timelineOffset: Number.isFinite(Number(stream.start_time))
      ? round(Math.max(0, Number(stream.start_time) - timelineOrigin), 6) : 0,
    attachedPicture: Boolean(stream.disposition && stream.disposition.attached_pic === 1),
    stillImage: Boolean(stream.disposition && stream.disposition.still_image === 1),
  });
  const videoSummary = stream => ({
    ...common(stream),
    width: Number(stream.width) || null,
    height: Number(stream.height) || null,
  });
  const audioSummary = stream => ({
    ...common(stream),
    sampleRate: Number(stream.sample_rate) || null,
    channels: Number(stream.channels) || null,
  });
  return {
    path: resolved,
    sha256: hashBytes(resolved),
    bytes: fs.statSync(resolved).size,
    duration: round(duration, 6),
    container: { formats, timelineOrigin: round(timelineOrigin, 6) },
    streams: {
      video: videoSummary(video),
      videos: streams.filter(stream => stream.codec_type === 'video').map(videoSummary),
      audio: audio ? audioSummary(audio) : null,
      audios: streams.filter(stream => stream.codec_type === 'audio').map(audioSummary),
      subtitles: subtitles.map(common),
    },
  };
}

function verifyArtifactIdentity(artifact) {
  let stat;
  try { stat = fs.statSync(artifact.path); }
  catch { throw new Error('judge artifact changed or disappeared during analysis'); }
  if (!stat.isFile() || stat.size !== artifact.bytes || hashBytes(artifact.path) !== artifact.sha256) {
    throw new Error('judge artifact bytes changed during analysis');
  }
}

function parseSilences(log, duration) {
  const events = [];
  for (const match of String(log).matchAll(/silence_(start|end):\s*([0-9.]+)/g)) {
    events.push({ kind: match[1], value: Number(match[2]) });
  }
  const intervals = [];
  let start = null;
  for (const event of events) {
    if (event.kind === 'start') start = event.value;
    else if (start != null) {
      intervals.push({ start: Math.max(0, start), end: Math.min(duration, event.value) });
      start = null;
    }
  }
  if (start != null) intervals.push({ start: Math.max(0, start), end: duration });
  return mergeIntervals(intervals.filter(interval => interval.end > interval.start));
}

function mergeIntervals(intervals) {
  const sorted = intervals
    .map(interval => ({ start: interval.start, end: interval.end }))
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of sorted) {
    const prior = merged[merged.length - 1];
    if (!prior || interval.start > prior.end) merged.push(interval);
    else prior.end = Math.max(prior.end, interval.end);
  }
  return merged;
}

function volumeFacts(log) {
  const meanMatch = String(log).match(/mean_volume:\s*(-?(?:inf|[0-9.]+))\s*dB/i);
  const peakMatch = String(log).match(/max_volume:\s*(-?(?:inf|[0-9.]+))\s*dB/i);
  const parse = match => {
    if (!match) return null;
    if (/^-?inf$/i.test(match[1])) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };
  return { meanDb: parse(meanMatch), peakDb: parse(peakMatch) };
}

function paddedAudioFilter(duration, start = 0, end = duration, tail = '') {
  const filters = [
    'aresample=async=1:first_pts=0',
    `apad=whole_dur=${duration}`,
    `atrim=start=${start}:end=${end}`,
    'asetpts=PTS-STARTPTS',
  ];
  if (tail) filters.push(tail);
  return filters.join(',');
}

function analyzeAudio(file, duration, stream = null) {
  if (!stream) {
    return {
      present: false,
      silences: [{ start: 0, end: duration }],
      meanDb: null,
      peakDb: null,
      thresholdDb: SILENCE_DB,
      duration,
      file,
      stream: null,
      levels: new Map(),
    };
  }
  const selector = Number.isInteger(stream.index) ? `0:${stream.index}` : '0:a:0';
  const result = run('ffmpeg', [
    '-hide_banner', '-nostats', '-xerror', ...MEDIA_INPUT_OPTIONS, '-i', file, '-map', selector, '-vn',
    '-af', paddedAudioFilter(duration, 0, duration,
      `silencedetect=noise=${SILENCE_DB}dB:d=0.1,volumedetect`),
    '-f', 'null', '-',
  ], { encoding: 'utf8' });
  const facts = volumeFacts(result.stderr);
  return {
    present: true,
    silences: parseSilences(result.stderr, duration),
    meanDb: facts.meanDb,
    peakDb: facts.peakDb,
    thresholdDb: SILENCE_DB,
    duration,
    file,
    stream,
    levels: new Map([[`0:${round(duration, 6)}`, facts]]),
  };
}

function scopedAudioLevels(audio, start, end) {
  if (!audio.present || end <= start) return { meanDb: null, peakDb: null };
  const key = `${round(start, 6)}:${round(end, 6)}`;
  if (audio.levels.has(key)) return audio.levels.get(key);
  const selector = Number.isInteger(audio.stream.index) ? `0:${audio.stream.index}` : '0:a:0';
  const result = run('ffmpeg', [
    '-hide_banner', '-nostats', '-xerror', ...MEDIA_INPUT_OPTIONS, '-i', audio.file, '-map', selector, '-vn',
    '-af', paddedAudioFilter(audio.duration, start, end, 'volumedetect'),
    '-f', 'null', '-',
  ], { encoding: 'utf8' });
  const facts = volumeFacts(result.stderr);
  audio.levels.set(key, facts);
  return facts;
}

function readJson(file) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
  catch { return null; }
}

function usableManifestScenes(document) {
  if (!document || !Array.isArray(document.scenes) || !document.scenes.length) return null;
  const rows = document.scenes.map(scene => ({
    id: scene.id,
    start: Number(scene.start),
    end: Number(scene.start) + Number(scene.duration),
  }));
  return rows.every(row => row.id && Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
    ? rows : null;
}

function finishTimeline(rows, duration, basis) {
  if (!rows || !rows.length) return rows;
  const last = rows[rows.length - 1];
  if (Math.abs(last.end - duration) <= 0.05) last.end = duration;
  else if (last.end < duration) rows.push({
    id: null, start: last.end, end: duration, basis: 'artifact-unmapped-tail',
  });
  for (const row of rows) row.basis = row.basis || basis;
  return rows;
}

function cumulativeScenes(config, durations, duration, basis) {
  const rows = [];
  let cursor = 0;
  for (let index = 0; index < config.scenes.length; index++) {
    const seconds = Number(durations[index]);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    rows.push({ id: config.scenes[index].id, start: cursor, end: cursor + seconds, basis });
    cursor += seconds;
  }
  if (!cursor) return null;
  return finishTimeline(rows, duration, basis);
}

function sceneTimeline(config, outDir, duration, binding) {
  const manifestPath = path.join(outDir, 'manifest.json');
  const boundManifest = binding && binding.used && binding.document.context
    ? binding.document.context.manifest : null;
  const manifest = boundManifest && boundManifest.available ? boundManifest.content : null;
  const fromManifest = usableManifestScenes(manifest);
  if (fromManifest) {
    return {
      rows: finishTimeline(fromManifest.map(row => ({ ...row, basis: 'derived-bound-manifest-timing' })), duration),
      manifest,
      source: 'binding-manifest',
      path: `${binding.path}#manifest`,
    };
  }
  const timingPath = path.join(outDir, 'timings.json');
  const boundTimings = binding && binding.used && binding.document.context
    ? binding.document.context.timings : null;
  const timings = boundTimings && boundTimings.available ? boundTimings.content : null;
  if (timings) {
    const durations = config.scenes.map(scene => Number(timings[scene.id] && timings[scene.id].dur));
    const rows = cumulativeScenes(config, durations, duration, 'derived-bound-timings');
    if (rows) return {
      rows, manifest, timings, source: 'binding-timings', path: `${binding.path}#timings`,
    };
  }
  const rows = cumulativeScenes(config, config.scenes.map(scene => scene.dur), duration, 'authored-config-estimate');
  return {
    rows: rows || [{ id: null, start: 0, end: duration, basis: 'artifact-only' }],
    manifest,
    timings,
    source: rows ? 'config-estimate' : 'artifact-only',
    path: null,
  };
}

function parseCaptionTimestamp(value, format) {
  const pattern = format === 'srt'
    ? /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/
    : /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/;
  const match = String(value).match(pattern);
  if (!match) return null;
  return (Number(match[1] || 0) * 3600) + (Number(match[2]) * 60)
    + Number(match[3]) + (Number(match[4]) / 1000);
}

function parseCaptionCues(text, declaredFormat = null) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '');
  const format = declaredFormat || (/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized) ? 'vtt' : 'srt');
  const body = format === 'vtt' ? normalized.replace(/^WEBVTT(?:[ \t].*)?(?:\n|$)/, '') : normalized;
  const cues = [];
  for (const block of body.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const arrow = lines.findIndex(line => line.includes('-->'));
    if (arrow < 0) continue;
    const match = lines[arrow].trim().match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if (!match) continue;
    const start = parseCaptionTimestamp(match[1], format);
    const end = parseCaptionTimestamp(match[2], format);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const cueText = lines.slice(arrow + 1).join(' ')
      .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    cues.push({ start, end, text: cueText, words: cueText ? cueText.split(/\s+/).length : 0 });
  }
  return cues;
}

function validateCaptionDocument(text, format, duration) {
  const normalized = String(text).replace(/^\uFEFF/, '').replace(/\r/g, '');
  if (format === 'vtt' && !/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(normalized)) {
    return { valid: false, cues: [], reason: 'missing WEBVTT header' };
  }
  const cues = parseCaptionCues(normalized, format);
  const arrowCount = (normalized.match(/-->/g) || []).length;
  const emptyBody = format === 'vtt'
    ? normalized.replace(/^WEBVTT(?:[ \t].*)?(?:\n|$)/, '').trim() === ''
    : normalized.trim() === '';
  if (!arrowCount && !emptyBody) return { valid: false, cues, reason: 'no valid caption cues' };
  if (arrowCount !== cues.length) return { valid: false, cues, reason: 'one or more caption timestamps are malformed' };
  let priorStart = -1;
  for (const cue of cues) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) {
      return { valid: false, cues, reason: 'caption cue has an invalid time range' };
    }
    if (cue.start < priorStart) return { valid: false, cues, reason: 'caption cues are not in timeline order' };
    if (Number.isFinite(duration) && cue.end > duration + 0.5) {
      return { valid: false, cues, reason: 'caption cue exceeds artifact duration' };
    }
    priorStart = cue.start;
  }
  return { valid: true, cues, reason: null };
}

function captionEvidence(outDir, artifact, binding) {
  const candidates = [];
  const textCodecs = new Set(['subrip', 'srt', 'webvtt', 'mov_text', 'ass', 'ssa', 'text']);
  const orderedSubtitles = artifact.streams.subtitles.slice()
    .sort((a, b) => Number(b.default) - Number(a.default) || a.index - b.index);
  let canonicalEmbedded = null;
  for (let index = 0; index < orderedSubtitles.length; index++) {
    const stream = orderedSubtitles[index];
    const retain = candidate => {
      if (index === 0) canonicalEmbedded = candidate;
      else candidates.push(candidate);
    };
    const source = `${artifact.path}#stream-${stream.index}`;
    if (!textCodecs.has(stream.codec)) {
      retain({
        available: false, path: source, cues: [], format: stream.codec,
        source: 'embedded', reason: 'embedded subtitle codec is not text-decodable',
      });
      continue;
    }
    try {
      const decoded = run('ffmpeg', [
        '-v', 'error', '-xerror', ...MEDIA_INPUT_OPTIONS, '-i', artifact.path, '-map', `0:${stream.index}`,
        '-c:s', 'webvtt', '-f', 'webvtt', 'pipe:1',
      ], { encoding: 'utf8' });
      const checked = validateCaptionDocument(decoded.stdout, 'vtt', artifact.duration);
      const candidate = {
        available: checked.valid,
        path: source,
        cues: checked.cues,
        format: 'vtt',
        source: 'embedded',
        codec: stream.codec,
        reason: checked.reason,
      };
      retain(candidate);
    } catch (error) {
      retain({
        available: false, path: source, cues: [], format: stream.codec,
        source: 'embedded', reason: `embedded subtitle decode failed: ${error.message}`,
      });
    }
  }
  // Subtitle tracks can carry different languages or editorial versions. The
  // default stream (or first stream when no default exists) is canonical; a
  // decode failure must not silently substitute another track's words.
  if (canonicalEmbedded) return { ...canonicalEmbedded, alternatives: candidates };

  const snapshots = binding && binding.used && binding.document.context
    && Array.isArray(binding.document.context.captions)
    ? binding.document.context.captions : [];
  for (const snapshot of snapshots) {
    const source = `${binding.path}#${snapshot.path || `captions.${snapshot.format}`}`;
    if (!snapshot.available || typeof snapshot.content !== 'string') {
      candidates.push({
        available: false, path: source, cues: [], format: snapshot.format,
        source: 'bound-sidecar-snapshot', reason: snapshot.reason || 'caption snapshot unavailable',
      });
      continue;
    }
    const checked = validateCaptionDocument(snapshot.content, snapshot.format, artifact.duration);
    const candidate = {
      available: checked.valid, path: source, cues: checked.cues,
      format: snapshot.format, source: 'bound-sidecar-snapshot', reason: checked.reason,
      sourceSha256: snapshot.sha256,
    };
    if (candidate.available) return { ...candidate, alternatives: candidates };
    candidates.push(candidate);
  }

  if (!snapshots.length) {
    for (const name of ['captions.vtt', 'captions.srt']) {
      const file = path.join(outDir, name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        candidates.push({
          available: false, path: file, cues: [], format: path.extname(name).slice(1),
          source: 'unbound-sidecar', reason: 'sidecar is not bound to the selected artifact',
        });
      }
    }
  }
  return candidates.length ? { ...candidates[0], alternatives: candidates.slice(1) } : null;
}

function intervalOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function silenceRatio(audio, start, end) {
  if (end <= start) return null;
  const silent = audio.silences.reduce((sum, interval) => sum + intervalOverlap(start, end, interval.start, interval.end), 0);
  return round(Math.min(1, silent / (end - start)));
}

function wordsInRange(captions, config, scene, start, end, authoredSource = 'resolved-project') {
  if (captions && captions.available) {
    return {
      value: captions.cues.filter(cue => ((cue.start + cue.end) / 2) >= start && ((cue.start + cue.end) / 2) < end)
        .reduce((sum, cue) => sum + cue.words, 0),
      source: captions.path,
      grade: 'derived-caption-sidecar',
    };
  }
  const sourceScene = config.scenes.find(item => item.id === scene);
  const text = sourceScene ? (sourceScene.vo || []).map(turn => turn.text).join(' ') : '';
  return {
    value: text.trim() ? text.trim().split(/\s+/).length : 0,
    source: authoredSource,
    grade: 'authored-fallback',
  };
}

function rangeCoverage(start, end, duration) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return {
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
      measuredStart: 0,
      measuredEnd: 0,
      fullyCovered: false,
      status: 'unavailable',
    };
  }
  const measuredStart = Math.max(0, Math.min(duration, start));
  const measuredEnd = Math.max(0, Math.min(duration, end));
  const fullyCovered = start >= 0 && end <= duration && end > start;
  return {
    start, end, measuredStart, measuredEnd,
    fullyCovered,
    status: fullyCovered ? 'available' : measuredEnd > measuredStart ? 'partial' : 'unavailable',
  };
}

function assertionRange(assertion, scenes, duration) {
  if (assertion.scope && Number.isFinite(assertion.scope.start) && Number.isFinite(assertion.scope.end)) {
    return { ...rangeCoverage(assertion.scope.start, assertion.scope.end, duration), basis: 'authored-global-time' };
  }
  if (assertion.scope && assertion.scope.scene) {
    const row = scenes.find(scene => scene.id === assertion.scope.scene);
    if (row) return { ...rangeCoverage(row.start, row.end, duration), basis: row.basis };
    return { ...rangeCoverage(null, null, duration), basis: 'unavailable-scene-scope' };
  }
  return { ...rangeCoverage(0, duration, duration), basis: 'whole-artifact' };
}

function visualProbeCoverage(range, context) {
  const stream = context.artifact.streams.video;
  const streamStart = Number.isFinite(stream.timelineOffset) ? stream.timelineOffset : 0;
  let streamEnd = Number.isFinite(stream.duration) ? streamStart + stream.duration : null;
  const witnessFrames = !Number.isFinite(streamEnd) ? framesFromBundle(context.witness) : [];
  if (!Number.isFinite(streamEnd) && witnessFrames.length) {
    const lastFrame = witnessFrames[witnessFrames.length - 1];
    const sampleStep = context.sampling && context.sampling.fps > 0 ? 1 / context.sampling.fps : 0;
    streamEnd = Math.min(context.artifact.duration, lastFrame.time + sampleStep);
  }
  if (!Number.isFinite(streamEnd)) streamEnd = streamStart;
  const measuredStart = Math.max(range.measuredStart, streamStart);
  const measuredEnd = Math.min(range.measuredEnd, streamEnd);
  const hasCoverage = measuredEnd > measuredStart;
  const fullyCovered = range.fullyCovered
    && range.start >= streamStart - 1e-6 && range.end <= streamEnd + 1e-6;
  return {
    ...range,
    measuredStart: hasCoverage ? measuredStart : 0,
    measuredEnd: hasCoverage ? measuredEnd : 0,
    fullyCovered,
    status: fullyCovered ? 'available' : hasCoverage ? 'partial' : 'unavailable',
  };
}

function probeCoverage(metric, range, context) {
  return metric.startsWith('video.') || metric.startsWith('attention.')
    ? visualProbeCoverage(range, context) : range;
}

function combinedCoverage(coverages, fallback) {
  if (!coverages.length) return fallback;
  const statuses = coverages.map(coverage => coverage.status);
  const status = statuses.every(value => value === 'available') ? 'available'
    : statuses.every(value => value === 'unavailable') ? 'unavailable' : 'partial';
  const covered = coverages.filter(coverage => coverage.measuredEnd > coverage.measuredStart);
  const measuredStart = covered.length ? Math.max(...covered.map(coverage => coverage.measuredStart)) : 0;
  const measuredEnd = covered.length ? Math.min(...covered.map(coverage => coverage.measuredEnd)) : 0;
  return {
    ...fallback,
    measuredStart: measuredEnd > measuredStart ? measuredStart : 0,
    measuredEnd: measuredEnd > measuredStart ? measuredEnd : 0,
    fullyCovered: status === 'available',
    status,
  };
}

function metricUnit(metric) {
  if (metric.endsWith('_ratio') || metric === 'attention.dominant_region_share') return 'ratio';
  if (metric.endsWith('_db')) return 'dBFS';
  if (metric === 'caption.word_count') return 'words';
  if (metric === 'video.cut_count') return 'count';
  return 'normalized-frame-difference';
}

function metricValue(metric, visual, audio, captions, config, scene, start, end) {
  const levels = metric === 'audio.mean_db' || metric === 'audio.peak_db'
    ? scopedAudioLevels(audio, start, end) : null;
  const values = {
    'audio.silence_ratio': silenceRatio(audio, start, end),
    'audio.mean_db': levels ? levels.meanDb : null,
    'audio.peak_db': levels ? levels.peakDb : null,
    'video.motion_mean': visual.motionMean,
    'video.motion_p95': visual.motionP95,
    'video.static_ratio': visual.staticRatio,
    'video.black_ratio': visual.blackRatio,
    'video.cut_count': visual.cutCount,
    'attention.dominant_region_share': visual.dominantRegionShare,
    // Authored narration can describe intended information density, but it
    // cannot establish that text survived into the encoded artifact. An
    // assertion probe therefore needs an actual caption sidecar.
    'caption.word_count': captions && captions.available
      ? wordsInRange(captions, config, scene, start, end).value : null,
  };
  return values[metric];
}

function compareProbe(actual, probe) {
  if (typeof actual !== 'number' || !Number.isFinite(actual)) {
    if (typeof actual !== typeof probe.value) return null;
    if (probe.operator === 'eq') return actual === probe.value;
    if (probe.operator === 'ne') return actual !== probe.value;
    return null;
  }
  const tolerance = probe.tolerance || 0;
  switch (probe.operator) {
    case 'eq': return Math.abs(actual - probe.value) <= tolerance;
    case 'ne': return Math.abs(actual - probe.value) > tolerance;
    case 'lt': return actual < (probe.value + tolerance);
    case 'lte': return actual <= (probe.value + tolerance);
    case 'gt': return actual > (probe.value - tolerance);
    case 'gte': return actual >= (probe.value - tolerance);
    case 'between': return actual >= (probe.value[0] - tolerance) && actual <= (probe.value[1] + tolerance);
    default: return null;
  }
}

function stateTime(observation, scene) {
  const local = observation.time;
  if (Number.isFinite(local.at)) {
    return {
      local: { at: local.at },
      global: { at: scene.start + local.at },
      insideScene: local.at <= (scene.end - scene.start) + 1e-9,
    };
  }
  return {
    local: { start: local.start, end: local.end },
    global: { start: scene.start + local.start, end: scene.start + local.end },
    insideScene: local.end <= (scene.end - scene.start) + 1e-9,
  };
}

function stateProbeFact(probe, assertion, range, context) {
  const sceneId = assertion.scope && assertion.scope.scene;
  const binding = context.binding;
  const unavailable = (reason, detail = {}) => ({
    probe,
    value: null,
    result: null,
    coverage: { ...range, fullyCovered: false, status: 'unavailable' },
    source: binding && binding.path ? `${binding.path}#sceneState/${sceneId || 'unknown'}/${probe.ref || 'unknown'}`
      : context.authoredSource,
    unit: 'unavailable',
    basis: 'UNAVAILABLE',
    availability: 'unavailable',
    sourceIdentity: { scene: sceneId || null, observation: probe.ref || null, reason, ...detail },
  });
  if (!sceneId) return unavailable('scene.state probe has no scene scope');
  if (!binding || binding.used !== true) return unavailable('selected artifact has no usable bound scene-state evidence');
  const entries = binding.document.context.sceneState || [];
  const entry = entries.find(item => item.scene === sceneId);
  if (!entry) return unavailable(`receipt has no scene-state source for scene "${sceneId}"`);
  const producer = entry.source.content && entry.source.content.producer;
  const baseIdentity = {
    scene: sceneId,
    observation: probe.ref,
    sourcePath: entry.source.path,
    sourceSha256: entry.source.sha256,
    producer: producer ? { ...producer } : null,
  };
  const observation = entry.source.content.observations.find(item => item.id === probe.ref);
  if (!observation) return unavailable(`receipt source has no observation "${probe.ref}"`, baseIdentity);
  const identity = {
    ...baseIdentity,
    method: observation.method,
    localTime: { ...observation.time },
  };
  const scene = context.scenes.find(item => item.id === sceneId);
  if (!scene) return unavailable(`artifact timing has no scene "${sceneId}"`, identity);
  const timing = stateTime(observation, scene);
  identity.globalTime = timing.global;
  if (observation.status !== 'available') {
    return unavailable(observation.reason || 'producer marked state unavailable', identity);
  }
  const insideAssertion = Object.hasOwn(timing.global, 'at')
    ? timing.global.at >= range.measuredStart - 1e-9 && timing.global.at <= range.measuredEnd + 1e-9
    : timing.global.start >= range.measuredStart - 1e-9 && timing.global.end <= range.measuredEnd + 1e-9;
  if (!timing.insideScene || !insideAssertion || !range.fullyCovered) {
    return unavailable('state observation time is outside the bound scene, artifact, or assertion scope', identity);
  }
  const result = compareProbe(observation.value, probe);
  if (result == null) return unavailable('bound state value cannot be compared with this probe', identity);
  return {
    probe,
    value: observation.value,
    result,
    coverage: { ...range, fullyCovered: true, status: 'available' },
    source: `${binding.path}#sceneState/${sceneId}/${probe.ref}`,
    unit: observation.unit,
    basis: observation.basis,
    availability: 'available',
    sourceIdentity: identity,
  };
}

function relatedState(assertion, scenes, start, end) {
  const declared = assertion && assertion.related ? { ...assertion.related } : {};
  const scoped = assertion && assertion.scope && assertion.scope.scene;
  const midpoint = (start + end) / 2;
  const explicitlyTimed = assertion && assertion.scope
    && Number.isFinite(assertion.scope.start) && Number.isFinite(assertion.scope.end)
    && end > start;
  const timed = explicitlyTimed
    ? scenes.find(scene => midpoint >= scene.start && midpoint < scene.end)
    : null;
  const scene = declared.scene || scoped || (timed && timed.id) || null;
  return {
    scene,
    ...(declared.beat ? { beat: declared.beat } : {}),
    ...(declared.component ? { component: declared.component } : {}),
    ...(declared.source ? { source: { value: declared.source, basis: 'AUTHORED' } } : {}),
    ...(declared.asset ? { asset: { value: declared.asset, basis: 'AUTHORED' } } : {}),
    ...(declared.generation ? { generation: { value: declared.generation, basis: 'AUTHORED' } } : {}),
    ...(declared.creativeLineage ? { creativeLineage: { value: declared.creativeLineage, basis: 'AUTHORED' } } : {}),
    ...(declared.protected ? { protected: declared.protected.slice() } : {}),
    mappingBasis: (declared.scene || scoped) ? 'AUTHORED'
      : timed && timed.id ? 'INFERRED_FROM_TIME' : 'UNAVAILABLE',
    causality: 'not-established',
  };
}

function evidence(source, metric, value, unit, basis = 'MEASURED', availability = (value == null ? 'unavailable' : 'available'), sourceIdentity = null) {
  return {
    source, metric, value, unit, basis, availability,
    ...(sourceIdentity ? { sourceIdentity } : {}),
  };
}

function formatRange(range) {
  return { start: round(range.start, 3), end: round(range.end, 3), scope: range.basis };
}

function observationId(family, index) {
  const prefix = {
    'intent-rendered-correspondence': 'intent',
    'visual-narrative-correspondence': 'narrative',
    'entity-continuity': 'entity',
    'attention-visual-hierarchy': 'attention',
    'temporal-behavior': 'temporal',
  }[family];
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function buildIntentObservations(config, context) {
  const assertions = config.assertions || [];
  if (!assertions.length) {
    return [{
      id: observationId(FAMILIES[0], 0),
      family: FAMILIES[0],
      timeRange: { start: 0, end: context.artifact.duration, scope: 'whole-artifact' },
      assertion: null,
      intent: 'Compare rendered evidence with explicit creator-owned assertions when they are available.',
      observed: 'No structured creative assertion was available; unstructured context was not converted into an implicit taste objective.',
      evidence: [evidence(context.authoredSource, 'creative_assertions', 0, 'count', 'AUTHORED', 'unavailable')],
      interpretation: 'Intent preservation cannot be established without declared intent. Other families remain descriptive.',
      confidence: 0,
      confidenceBasis: 'No structured assertion was available; this is not a judgement of the artifact.',
      classification: 'INFERRED',
      outcome: 'UNCERTAIN',
      relatedProductionState: { scene: null, mappingBasis: 'UNAVAILABLE', causality: 'not-established' },
      suggestedQuestions: ['Should any decisive finished-artifact intent be recorded as an explicit assertion?'],
    }];
  }
  return assertions.map((assertion, index) => {
    const range = assertionRange(assertion, context.scenes, context.artifact.duration);
    const visual = visualMetrics(context.witness, range.measuredStart, range.measuredEnd);
    const scene = (assertion.scope && assertion.scope.scene)
      || context.scenes.find(item => ((range.start + range.end) / 2) >= item.start && ((range.start + range.end) / 2) < item.end)?.id
      || null;
    const probes = assertion.observe || [];
    const facts = probes.map(probe => {
      if (probe.metric === 'scene.state') {
        return stateProbeFact(probe, assertion, range, context);
      }
      const coverage = probeCoverage(probe.metric, range, context);
      const value = metricValue(
        probe.metric, visual, context.audio, context.captions, config, scene,
        range.measuredStart, range.measuredEnd,
      );
      return {
        probe, value, coverage,
        result: coverage.fullyCovered ? compareProbe(value, probe) : null,
        source: probe.metric.startsWith('audio.') ? context.artifact.path
          : probe.metric.startsWith('caption.') ? (context.captions ? context.captions.path : context.authoredSource)
            : context.artifact.path,
        unit: metricUnit(probe.metric),
        basis: 'MEASURED',
        availability: coverage.fullyCovered && compareProbe(value, probe) != null
          ? 'available'
          : Number.isFinite(value) && coverage.status === 'partial' ? 'partial' : 'unavailable',
      };
    });
    const scopeCoverage = combinedCoverage(facts.map(fact => fact.coverage), range);
    const available = facts.filter(fact => fact.result != null);
    const unavailable = facts.filter(fact => fact.result == null);
    let outcome = 'UNCERTAIN';
    if (facts.some(fact => fact.result === false)) outcome = 'DIVERGED';
    else if (facts.length && unavailable.length === 0) outcome = 'ALIGNED';
    const evidenceRows = facts.map(fact => evidence(
      fact.source,
      fact.probe.metric,
      typeof fact.value === 'number' && Number.isFinite(fact.value) ? round(fact.value) : fact.value,
      fact.unit,
      fact.basis,
      fact.availability,
      fact.sourceIdentity,
    ));
    if (!facts.length) {
      evidenceRows.push(
        evidence(context.artifact.path, 'video.motion_mean', visual.motionMean, 'normalized-frame-difference'),
        evidence(context.artifact.path, 'video.static_ratio', visual.staticRatio, 'ratio'),
        evidence(context.artifact.path, 'audio.silence_ratio', silenceRatio(context.audio, range.measuredStart, range.measuredEnd), 'ratio'),
      );
    }
    const deliberate = assertion.class === 'deliberate-choice' || assertion.class === 'deliberate-violation';
    const observed = facts.length
      ? facts.map(fact => `${fact.probe.metric}${fact.probe.ref ? `:${fact.probe.ref}` : ''}=${fact.value == null ? 'unavailable' : JSON.stringify(typeof fact.value === 'number' ? round(fact.value) : fact.value)} ${fact.unit} (${fact.probe.operator} ${JSON.stringify(fact.probe.value)})`).join('; ')
      : 'Local built-in perceivers measured the scoped artifact, but no explicit measurable probe or semantic perceiver can establish the free-form expectation.';
    return {
      id: observationId(FAMILIES[0], index),
      family: FAMILIES[0],
      timeRange: formatRange(range),
      scopeCoverage: {
        status: scopeCoverage.status,
        measuredRange: { start: round(scopeCoverage.measuredStart, 3), end: round(scopeCoverage.measuredEnd, 3) },
      },
      assertion: { ...assertion },
      intent: assertion.expect,
      observed,
      evidence: evidenceRows,
      interpretation: outcome === 'ALIGNED'
        ? `The declared measurable condition survived the encoded artifact${deliberate ? '; this supports the intentional exception without judging its style' : ''}.`
        : outcome === 'DIVERGED'
          ? `The encoded artifact differs from the declared measurable condition${deliberate ? '; the creative choice remains authoritative, but its execution is not the declared one' : ''}.`
          : 'Available evidence cannot establish whether the intended creative effect survived rendering.',
      confidence: outcome === 'UNCERTAIN' ? (available.length ? 0.35 : 0.1) : 0.99,
      confidenceBasis: outcome === 'UNCERTAIN'
        ? 'Confidence covers only the availability of the declared local probes; it does not estimate artistic success.'
        : 'Confidence covers deterministic comparison of the declared probes against bounded artifact measurements, not the quality of the creative effect.',
      classification: available.some(fact => fact.basis === 'INFERRED') ? 'INFERRED'
        : available.length ? 'MEASURED' : 'INFERRED',
      outcome,
      relatedProductionState: relatedState(assertion, context.scenes, range.start, range.end),
      suggestedQuestions: assertion.questions && assertion.questions.length
        ? assertion.questions.slice()
        : [outcome === 'DIVERGED'
          ? 'Was the rendered difference intentional, or should the declared execution be restored?'
          : 'Did the measured property create the effect you intended?'],
    };
  });
}

function buildNarrativeObservations(config, context) {
  return context.scenes.map((scene, index) => {
    const coverage = rangeCoverage(scene.start, scene.end, context.artifact.duration);
    const visual = visualMetrics(context.witness, coverage.measuredStart, coverage.measuredEnd);
    const words = wordsInRange(
      context.captions, config, scene.id, coverage.measuredStart, coverage.measuredEnd,
      context.authoredSource,
    );
    return {
      id: observationId(FAMILIES[1], index),
      family: FAMILIES[1],
      timeRange: formatRange(scene),
      scopeCoverage: {
        status: coverage.status,
        measuredRange: { start: round(coverage.measuredStart, 3), end: round(coverage.measuredEnd, 3) },
      },
      assertion: null,
      intent: 'Expose temporal correspondence between rendered visual change and available narrative timing while leaving semantic match unclaimed.',
      observed: `${words.value} words overlap this range; rendered sampling found ${visual.cutCount} abrupt state-change proxy event(s), motion mean ${visual.motionMean}, and static ratio ${visual.staticRatio}.`,
      evidence: [
        evidence(words.source, 'caption.word_count', words.value, 'words',
          words.grade === 'authored-fallback' ? 'AUTHORED' : 'MEASURED'),
        evidence(context.artifact.path, 'video.cut_count', visual.cutCount, 'count'),
        evidence(context.artifact.path, 'video.motion_mean', visual.motionMean, 'normalized-frame-difference'),
        evidence(context.artifact.path, 'video.static_ratio', visual.staticRatio, 'ratio'),
      ],
      interpretation: `The information rhythm here combines ${words.grade === 'authored-fallback' ? 'authored narration' : 'derived caption timing'} with measured rendered change. Sparse or dense correspondence is a property, not a defect. No active semantic perceiver established whether the imagery means what the narrative says.`,
      confidence: words.grade === 'authored-fallback' ? 0.62 : 0.82,
      confidenceBasis: 'Confidence covers the timing-density join only; semantic narrative correspondence remains unavailable.',
      classification: 'INFERRED',
      outcome: coverage.status === 'unavailable' ? 'UNCERTAIN' : 'OBSERVED',
      perceptionCoverage: 'partial',
      relatedProductionState: { scene: scene.id, mappingBasis: scene.id ? 'INFERRED_FROM_TIME' : 'UNAVAILABLE', causality: 'not-established' },
      suggestedQuestions: ['Did the relationship between narrative information and visual change match the intended rhythm?'],
    };
  });
}

function buildEntityObservations(config, context) {
  const entries = Object.entries(config.characters || {});
  if (!entries.length) {
    return [{
      id: observationId(FAMILIES[2], 0),
      family: FAMILIES[2],
      timeRange: { start: 0, end: context.artifact.duration, scope: 'whole-artifact' },
      assertion: null,
      intent: 'Establish continuity only when a declared entity and capable rendered-identity perceiver are available.',
      observed: 'No declared entity reference is available in the resolved project.',
      evidence: [evidence(context.authoredSource, 'entity.references', 0, 'count', 'AUTHORED')],
      interpretation: 'Entity continuity is not established; no absence or continuity defect is inferred.',
      confidence: 0,
      confidenceBasis: 'No entity reference or rendered-identity comparison is available.',
      classification: 'INFERRED',
      outcome: 'UNCERTAIN',
      relatedProductionState: { scene: null, mappingBasis: 'UNAVAILABLE', causality: 'not-established' },
      suggestedQuestions: ['Does this project need an explicit entity reference and identity perceiver?'],
    }];
  }
  return entries.map(([id, character], index) => ({
    id: observationId(FAMILIES[2], index),
    family: FAMILIES[2],
    timeRange: { start: 0, end: context.artifact.duration, scope: 'whole-artifact' },
    assertion: null,
    intent: `Establish whether ${id} retains the intended identity across the encoded artifact, except where explicitly waived.`,
    observed: `A project reference for ${id} is declared, but Phase 1 has no active semantic identity perceiver capable of locating and comparing that entity in rendered frames.`,
    evidence: [evidence(context.authoredSource, 'entity.reference_declared', 1, 'boolean', 'AUTHORED')],
    interpretation: 'Continuity is unavailable rather than failed; source declaration alone does not prove rendered identity.',
    confidence: 0.05,
    confidenceBasis: 'The authored reference is known, but no rendered-identity perceiver established continuity.',
    classification: 'INFERRED',
    outcome: 'UNCERTAIN',
    relatedProductionState: {
      scene: null,
      entity: id,
      reference: character.src || character.model || (Array.isArray(character.parts) ? 'parts' : null),
      mappingBasis: 'AUTHORED',
      causality: 'not-established',
    },
    suggestedQuestions: ['Should a specialized identity perceiver inspect this entity, and are any discontinuities intentional?'],
  }));
}

function buildAttentionObservations(context) {
  return context.scenes.map((scene, index) => {
    const coverage = rangeCoverage(scene.start, scene.end, context.artifact.duration);
    const visual = visualMetrics(context.witness, coverage.measuredStart, coverage.measuredEnd);
    const available = visual.sampledFrames > 0;
    return {
      id: observationId(FAMILIES[3], index),
      family: FAMILIES[3],
      timeRange: formatRange(scene),
      scopeCoverage: {
        status: coverage.status,
        measuredRange: { start: round(coverage.measuredStart, 3), end: round(coverage.measuredEnd, 3) },
      },
      assertion: null,
      intent: 'Expose a spatial contrast/edge distribution proxy without treating it as human gaze or prescribing composition.',
      observed: available
        ? `The strongest accumulated edge-energy region is ${visual.dominantRegion}, carrying ${visual.dominantRegionShare} of measured edge energy across ${visual.sampledFrames} sampled frame(s).`
        : 'No bounded sample landed inside this time range, so spatial edge-energy is unavailable.',
      evidence: [
        evidence(context.artifact.path, 'attention.dominant_region_share', visual.dominantRegionShare, 'ratio'),
        evidence(context.artifact.path, 'attention.dominant_region', visual.dominantRegion, '3x3-region'),
      ],
      interpretation: available
        ? 'This is a rendered spatial-energy proxy, not eye tracking, salience truth, readability, or a recommendation to center content.'
        : 'No visual hierarchy claim is made from a sample outside the requested range.',
      confidence: available ? 0.78 : 0,
      confidenceBasis: available
        ? 'Confidence covers the deterministic spatial edge-energy proxy only, not human gaze or compositional merit.'
        : 'No in-range rendered frame was sampled.',
      classification: available ? 'MEASURED' : 'INFERRED',
      outcome: available ? 'OBSERVED' : 'UNCERTAIN',
      perceptionCoverage: available && coverage.fullyCovered ? 'partial' : 'uncertain',
      relatedProductionState: { scene: scene.id, mappingBasis: scene.id ? 'INFERRED_FROM_TIME' : 'UNAVAILABLE', causality: 'not-established' },
      suggestedQuestions: ['Did the measured concentration support the intended visual hierarchy, including any deliberate asymmetry or obstruction?'],
    };
  });
}

function motionCharacter(visual) {
  if (!Number.isFinite(visual.staticRatio) || !Number.isFinite(visual.motionMean)) return 'motion unavailable';
  if (visual.staticRatio >= 0.9) return 'nearly static';
  if (visual.motionMean < 0.02) return 'low motion';
  if (visual.motionMean < 0.06) return 'moderate motion';
  return 'high motion';
}

function buildTemporalObservations(context) {
  return context.scenes.map((scene, index) => {
    const coverage = rangeCoverage(scene.start, scene.end, context.artifact.duration);
    const visual = visualMetrics(context.witness, coverage.measuredStart, coverage.measuredEnd);
    const silence = silenceRatio(context.audio, coverage.measuredStart, coverage.measuredEnd);
    const motionAvailable = visual.internalComparedFramePairs > 0;
    return {
      id: observationId(FAMILIES[4], index),
      family: FAMILIES[4],
      timeRange: formatRange(scene),
      scopeCoverage: {
        status: coverage.status,
        measuredRange: { start: round(coverage.measuredStart, 3), end: round(coverage.measuredEnd, 3) },
      },
      assertion: null,
      intent: 'Describe temporal behavior without assuming that faster pacing or more cuts is better.',
      observed: `${motionCharacter(visual)}; motion mean ${visual.motionMean}, p95 ${visual.motionP95}, static ratio ${visual.staticRatio}, abrupt state-change proxy count ${visual.cutCount}, black-frame ratio ${visual.blackRatio}, audio silence ratio ${silence}.`,
      evidence: [
        evidence(context.artifact.path, 'video.motion_mean', visual.motionMean, 'normalized-frame-difference'),
        evidence(context.artifact.path, 'video.motion_p95', visual.motionP95, 'normalized-frame-difference'),
        evidence(context.artifact.path, 'video.static_ratio', visual.staticRatio, 'ratio'),
        evidence(context.artifact.path, 'video.cut_count', visual.cutCount, 'count'),
        evidence(context.artifact.path, 'video.black_ratio', visual.blackRatio, 'ratio'),
        evidence(context.artifact.path, 'audio.silence_ratio', silence, 'ratio'),
        evidence(context.artifact.path, 'video.compared_frame_pairs', visual.comparedFramePairs, 'count'),
      ],
      interpretation: 'The measured pacing character is descriptive. Stillness, silence, darkness, and abrupt change may be deliberate.',
      confidence: motionAvailable ? 0.98 : 0.62,
      confidenceBasis: motionAvailable
        ? 'Confidence covers deterministic bounded frame/audio measurements, not whether the pacing is creatively correct.'
        : 'Audio and single-frame properties are available, but no in-range frame pair established motion.',
      classification: 'MEASURED',
      outcome: coverage.status === 'unavailable' ? 'UNCERTAIN' : 'OBSERVED',
      perceptionCoverage: coverage.fullyCovered && motionAvailable ? 'available' : 'partial',
      relatedProductionState: { scene: scene.id, mappingBasis: scene.id ? 'INFERRED_FROM_TIME' : 'UNAVAILABLE', causality: 'not-established' },
      suggestedQuestions: ['Did the rendered timing preserve the intended stillness, motion, silence, and transition character?'],
    };
  });
}

function familySummaries(observations) {
  return FAMILIES.map(family => {
    const rows = observations.filter(observation => observation.family === family);
    const outcomes = { ALIGNED: 0, DIVERGED: 0, OBSERVED: 0, UNCERTAIN: 0 };
    rows.forEach(row => { outcomes[row.outcome] += 1; });
    return {
      family,
      observations: rows.length,
      outcomes,
      coverage: !rows.length || outcomes.UNCERTAIN === rows.length ? 'uncertain'
        : outcomes.UNCERTAIN > 0 || rows.some(row => row.perceptionCoverage === 'partial') ? 'partial'
          : 'available',
    };
  });
}

function inspectTextSource(file, grade) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return { available: false, path: null, grade: 'UNAVAILABLE', used: false };
  }
  const bytes = fs.statSync(file).size;
  if (bytes > MAX_CONTEXT_BYTES) {
    return {
      available: true, path: file, grade: 'UNAVAILABLE', used: false, bytes,
      reason: `context exceeds the ${MAX_CONTEXT_BYTES}-byte inspection bound`,
    };
  }
  try {
    const contents = fs.readFileSync(file, 'utf8');
    const status = contents.match(/^Status:\s*(.+)$/im)?.[1].trim() || null;
    return {
      available: true,
      path: file,
      grade,
      used: true,
      bytes,
      sha256: crypto.createHash('sha256').update(contents).digest('hex'),
      lines: contents ? contents.split(/\r?\n/).length : 0,
      status,
      interpretation: 'bounded metadata only; unstructured prose was not converted into a hidden objective',
    };
  } catch (error) {
    return { available: true, path: file, grade: 'UNAVAILABLE', used: false, bytes, reason: error.message };
  }
}

function inspectRevisionHistory(file) {
  const inspected = inspectTextSource(file, 'RECORDED');
  if (!inspected.available || !inspected.used) return inspected;
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.trim());
    const records = lines.map(line => JSON.parse(line));
    return {
      ...inspected,
      records: records.length,
      lastOrdinal: records.length && Number.isInteger(records[records.length - 1].ordinal)
        ? records[records.length - 1].ordinal : null,
      interpretation: 'bounded revision records parsed; temporal correlation does not establish causality',
    };
  } catch (error) {
    return { ...inspected, grade: 'INVALID', used: false, reason: `invalid revision history: ${error.message}` };
  }
}

function stableValue(value, seen = new WeakSet()) {
  if (value == null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return { $function: String(value) };
  if (typeof value === 'undefined') return { $undefined: true };
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return { $circular: true };
  seen.add(value);
  const projected = Array.isArray(value)
    ? value.map(item => stableValue(item, seen))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key], seen)]));
  seen.delete(value);
  return projected;
}

function resolvedConfigSource(config, configFile) {
  const effectiveSha256 = crypto.createHash('sha256')
    .update(JSON.stringify(stableValue(config))).digest('hex');
  if (!configFile) {
    return { available: true, path: null, grade: 'AUTHORED', effectiveSha256, source: 'resolved-project' };
  }
  try {
    const resolved = fs.realpathSync(configFile);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('resolved config source is not a regular file');
    return {
      available: true, path: resolved, bytes: stat.size, sha256: hashBytes(resolved),
      effectiveSha256, grade: 'AUTHORED', source: resolved,
    };
  } catch (error) {
    return {
      available: false, path: path.resolve(configFile), grade: 'UNAVAILABLE',
      effectiveSha256, source: 'resolved-project', reason: error.message,
    };
  }
}

function sourceCoverage(projectDir, outDir, config, timeline, captions, binding, configSource) {
  const present = file => fs.existsSync(file) && fs.statSync(file).isFile();
  const creativeBrief = path.join(projectDir, 'creative-brief.md');
  const history = path.join(outDir, 'revisions.jsonl');
  const manifest = path.join(outDir, 'manifest.json');
  const timings = path.join(outDir, 'timings.json');
  const assertions = config.assertions || [];
  const proofLineage = assertions.filter(assertion => assertion.related && assertion.related.creativeLineage);
  const intendedExceptions = assertions.filter(assertion => (
    assertion.class === 'deliberate-choice' || assertion.class === 'deliberate-violation'
  ));
  const timingPath = timeline.path || null;
  const boundManifest = timeline.source === 'binding-manifest';
  const boundSceneState = binding && binding.used && binding.document.context
    && Array.isArray(binding.document.context.sceneState)
    ? binding.document.context.sceneState : [];
  return {
    encodedArtifact: { available: true, grade: 'MEASURED' },
    evidenceBinding: {
      available: binding.available, used: binding.used, path: binding.path,
      grade: binding.grade, sha256: binding.sha256 || null, reason: binding.reason || null,
    },
    resolvedConfig: configSource,
    assertions: {
      available: assertions.length > 0, count: assertions.length, grade: 'AUTHORED',
      path: configSource.path, sourceSha256: configSource.sha256 || null,
      effectiveSha256: configSource.effectiveSha256,
    },
    sceneTiming: {
      available: timeline.source !== 'artifact-only',
      source: timeline.source,
      path: timingPath,
      grade: timeline.source === 'config-estimate' ? 'AUTHORED'
        : timingPath ? 'DERIVED' : 'UNAVAILABLE',
    },
    captions: captions ? {
      available: captions.available,
      path: captions.path,
      grade: captions.available ? 'DERIVED' : 'INVALID',
      source: captions.source,
      format: captions.format,
      cues: captions.available ? captions.cues.length : 0,
      reason: captions.reason || null,
      alternatives: (captions.alternatives || []).map(item => ({
        path: item.path, source: item.source, format: item.format,
        available: item.available, reason: item.reason || null,
      })),
    } : { available: false, path: null, grade: 'UNAVAILABLE', reason: 'no caption sidecar or embedded subtitle stream' },
    creativeBrief: inspectTextSource(creativeBrief, 'AUTHORED'),
    manifest: {
      available: boundManifest,
      path: boundManifest ? timeline.path : (present(manifest) ? manifest : null),
      grade: boundManifest ? 'DERIVED' : present(manifest) ? 'UNBOUND' : 'UNAVAILABLE',
      used: boundManifest,
      reason: !boundManifest && present(manifest) ? 'current output manifest is not bound to the selected artifact' : null,
    },
    timings: {
      available: timeline.source === 'binding-timings',
      path: timeline.source === 'binding-timings' ? timeline.path : (present(timings) ? timings : null),
      grade: timeline.source === 'binding-timings' ? 'DERIVED' : present(timings) ? 'UNBOUND' : 'UNAVAILABLE',
      used: timeline.source === 'binding-timings',
      reason: timeline.source !== 'binding-timings' && present(timings) ? 'current output timings are not bound to the selected artifact' : null,
    },
    sceneState: {
      available: boundSceneState.length > 0,
      count: boundSceneState.length,
      grade: boundSceneState.length ? 'RECORDED' : 'UNAVAILABLE',
      used: boundSceneState.length > 0,
      reason: !boundSceneState.length && (config.sceneState || []).length
        ? 'selected artifact receipt has no bound scene-state evidence' : null,
    },
    revisionHistory: inspectRevisionHistory(history),
    proofLineage: { available: proofLineage.length > 0, count: proofLineage.length, grade: proofLineage.length ? 'AUTHORED' : 'UNAVAILABLE' },
    intendedExceptions: { available: intendedExceptions.length > 0, count: intendedExceptions.length, grade: intendedExceptions.length ? 'AUTHORED' : 'UNAVAILABLE' },
    entities: {
      available: Object.keys(config.characters || {}).length > 0,
      count: Object.keys(config.characters || {}).length,
      grade: 'AUTHORED', path: configSource.path,
      effectiveSha256: configSource.effectiveSha256,
    },
    semanticPerception: { available: false, grade: 'UNAVAILABLE', reason: 'Phase 1 has no implicit multimodal or hosted-model provider' },
  };
}

function judge(config, opts = {}) {
  const projectDir = path.resolve(opts.projectDir || config.projectDir || '.');
  const outDir = path.resolve(opts.outDir || path.join(projectDir, 'out'));
  const artifact = probeArtifact(opts.video || path.join(outDir, 'video.mp4'));
  const binding = loadVideoCiBinding(artifact, outDir);
  const configSource = resolvedConfigSource(config, opts.configFile);
  const timeline = sceneTimeline(config, outDir, artifact.duration, binding);
  const witness = witnessArtifact(artifact, { binding });
  const sampling = samplingFromBundle(witness);
  const audio = analyzeAudio(artifact.path, artifact.duration, artifact.streams.audio);
  const captions = captionEvidence(outDir, artifact, binding);
  const context = {
    artifact,
    scenes: timeline.rows,
    witness,
    sampling,
    audio,
    captions,
    binding,
    authoredSource: configSource.source,
  };
  const observations = [
    ...buildIntentObservations(config, context),
    ...buildNarrativeObservations(config, context),
    ...buildEntityObservations(config, context),
    ...buildAttentionObservations(context),
    ...buildTemporalObservations(context),
  ];
  const familyOrder = new Map(FAMILIES.map((family, index) => [family, index]));
  observations.sort((a, b) => familyOrder.get(a.family) - familyOrder.get(b.family)
    || a.timeRange.start - b.timeRange.start || a.id.localeCompare(b.id));
  verifyArtifactIdentity(artifact);
  if (binding.used && hashBytes(binding.path) !== binding.sha256) {
    throw new Error('judge evidence binding changed during analysis');
  }
  return {
    schema: REPORT_SCHEMA,
    purpose: 'rendered-evidence mirror; creator retains creative authority',
    score: null,
    validityEffect: 'none',
    mutation: 'none',
    artifact,
    sampling,
    witness: {
      schema: witness.schema,
      bundleId: witness.bundleId,
      artifact: witness.artifact,
      coverage: witness.coverage,
      summary: witness.summary,
      effect: witness.effect,
    },
    perception: {
      core: 'narova-evidence-normalization/v1',
      implementations: [
        { id: 'ffprobe-stream-facts/v1', kind: 'local-built-in', coverage: ['artifact-identity', 'stream-presence', 'duration', 'selected-stream-index'] },
        { id: sampling.implementation, kind: 'local-built-in-witness', coverage: ['motion', 'state-change-proxy', 'luma', 'spatial-edge-proxy'], witnessBundleId: witness.bundleId },
        { id: 'ffmpeg-silencedetect-volumedetect/v1', kind: 'local-built-in', coverage: ['silence', 'scoped-audio-level'], thresholdDb: SILENCE_DB, available: Boolean(artifact.streams.audio) },
        { id: 'caption-parser/v1', kind: 'local-built-in', coverage: ['sidecar-captions', 'embedded-text-subtitles', 'caption-timing', 'caption-word-count'], available: Boolean(captions && captions.available), reason: captions && !captions.available ? captions.reason : null },
        { id: 'scene-state-evidence/v1', kind: 'local-built-in', coverage: ['task-specific-scene-state'], available: Boolean(binding.used && binding.document.context.sceneState && binding.document.context.sceneState.length), reason: binding.used && (!binding.document.context.sceneState || !binding.document.context.sceneState.length) ? 'matching artifact receipt has no scene-state snapshot' : !binding.used ? 'matching artifact receipt is unavailable' : null },
        { id: 'semantic-perception', kind: 'replaceable-provider', coverage: ['visual-meaning', 'entity-identity', 'human-attention'], available: false },
      ],
    },
    sources: sourceCoverage(projectDir, outDir, config, timeline, captions, binding, configSource),
    assertions: (config.assertions || []).map(assertion => ({ ...assertion })),
    families: familySummaries(observations),
    observations,
  };
}

function clock(seconds) {
  if (!Number.isFinite(seconds)) return '--:--.-';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - (minutes * 60);
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function displayValue(value, unit) {
  if (value == null) return 'unavailable';
  const rendered = typeof value === 'string' ? value : JSON.stringify(value);
  return `${rendered}${unit ? ` ${unit}` : ''}`;
}

function formatJudgement(report) {
  const video = report.artifact.streams.video;
  const audio = report.artifact.streams.audio;
  const lines = [
    'Narova Video CI — rendered-evidence mirror',
    `Artifact: ${report.artifact.path}`,
    `Identity: sha256:${report.artifact.sha256} · ${report.artifact.duration.toFixed(3)}s`,
    `Streams: video #${video.index} ${video.codec || 'unknown'} ${video.width || '?'}x${video.height || '?'}; audio ${audio ? `#${audio.index} ${audio.codec || 'unknown'} ${audio.channels || '?'}ch` : 'unavailable'}; subtitles ${report.artifact.streams.subtitles.length}`,
    `Sampling: ${report.sampling.frames}/${report.sampling.maximumFrames} frame(s) at ${report.sampling.fps} fps, ${report.sampling.width}x${report.sampling.height}; ${report.sampling.timestampBasis}`,
    'Creative authority: the creator decides. No universal score, validity gate, hidden lens, or automatic repair.',
    `Assertions: ${report.assertions.length} · Families: ${report.families.map(family => `${family.family}=${family.coverage}`).join(', ')}`,
    'Perception implementations:',
  ];
  for (const implementation of report.perception.implementations) {
    lines.push(`- ${implementation.id}: ${implementation.available === false ? 'unavailable' : 'available'}; ${implementation.coverage.join(', ')}${implementation.reason ? `; ${implementation.reason}` : ''}`);
  }
  lines.push('Source coverage:');
  for (const [name, source] of Object.entries(report.sources)) {
    lines.push(`- ${name}: ${source.available ? 'available' : 'unavailable'}; ${source.grade || 'UNSPECIFIED'}${source.used === false ? '; not used' : ''}${source.path ? `; ${source.path}` : ''}${source.sha256 ? `; sha256=${source.sha256}` : ''}${source.effectiveSha256 ? `; effective-sha256=${source.effectiveSha256}` : ''}${source.reason ? `; ${source.reason}` : ''}`);
    for (const alternative of source.alternatives || []) {
      lines.push(`  - rejected/alternate: ${alternative.path || 'unknown'}; ${alternative.available ? 'available' : 'unavailable'}${alternative.reason ? `; ${alternative.reason}` : ''}`);
    }
  }
  if (report.assertions.length) {
    lines.push('Assertion context:');
    for (const assertion of report.assertions) {
      lines.push(`- ${assertion.id}: class=${assertion.class}; origin=${JSON.stringify(assertion.origin)}${assertion.riskyBecause ? `; risky because=${JSON.stringify(assertion.riskyBecause)}` : ''}`);
    }
  } else {
    lines.push('Assertion context: no structured intent assertion was available.');
  }
  for (const observation of report.observations) {
    lines.push('', `OBSERVATION ${clock(observation.timeRange.start)}–${clock(observation.timeRange.end)}  ${observation.id}`);
    lines.push(`Family: ${observation.family}`);
    lines.push(`Outcome: ${observation.outcome}`);
    if (observation.scopeCoverage && observation.scopeCoverage.status !== 'available') {
      lines.push(`Scope coverage: ${observation.scopeCoverage.status}; measured ${clock(observation.scopeCoverage.measuredRange.start)}–${clock(observation.scopeCoverage.measuredRange.end)}`);
    }
    if (observation.assertion) {
      lines.push(`Assertion: ${observation.assertion.id} (${observation.assertion.class})`);
    }
    lines.push(`Intent: ${observation.intent}`);
    lines.push(`Observed: ${observation.observed}`);
    lines.push('Evidence:');
    for (const item of observation.evidence) {
      lines.push(`- [${item.basis}] ${item.metric}: ${displayValue(item.value, item.unit)} (${item.source}${item.availability !== 'available' ? `; ${item.availability}` : ''})`);
      if (item.sourceIdentity) {
        const identity = item.sourceIdentity;
        lines.push(`  state source: scene=${identity.scene || 'unavailable'}; observation=${identity.observation || item.metric}; path=${identity.sourcePath || 'unavailable'}; sha256=${identity.sourceSha256 || 'unavailable'}; producer=${identity.producer ? `${identity.producer.id}@${identity.producer.version}` : 'unavailable'}; method=${identity.method || 'unavailable'}; local-time=${JSON.stringify(identity.localTime || null)}; global-time=${JSON.stringify(identity.globalTime || null)}${identity.reason ? `; reason=${identity.reason}` : ''}`);
      }
    }
    lines.push(`Interpretation: ${observation.interpretation}`);
    lines.push(`Confidence: ${observation.confidence}`);
    lines.push(`Confidence basis: ${observation.confidenceBasis}`);
    lines.push(`Classification: ${observation.classification}`);
    lines.push(`Related production state: ${JSON.stringify(observation.relatedProductionState)}`);
    if (observation.suggestedQuestions.length) {
      lines.push('Suggested questions:');
      for (const question of observation.suggestedQuestions) lines.push(`- ${question}`);
    }
  }
  return lines.join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, character => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ));
}

module.exports = {
  REPORT_SCHEMA,
  FAMILIES,
  judge,
  formatJudgement,
  probeArtifact,
  verifyArtifactIdentity,
  analyzeFrames,
  analyzeAudio,
  visualMetrics,
  compareProbe,
  parseCaptionCues,
  captionEvidence,
};
