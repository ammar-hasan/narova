'use strict';
/* Comprehensive export profiles — render flags, encode presets, and
 * ffmpeg post-processing for platform deliverables.

 * The HyperFrames renderer produces a source-quality MP4. This module
 * defines the delivery profiles and the ffmpeg post-processing chain
 * (audio loudness, encode settings, thumbnails) that turns a render
 * into a platform-ready deliverable. */

const fs = require('fs');
const path = require('path');
const { sh, probe, which, ensureDir } = require('./util');

/* ---- preset catalog ------------------------------------------------------- */

/* Each preset carries render flags (handed to HyperFrames) and an encode
 * profile (handed to ffmpeg post-processing). Fields marked `hf:` are
 * passed directly to the HyperFrames CLI; fields marked `enc:` go into
 * the ffmpeg post-process step. */
const PRESETS = {
  'youtube-1080p': {
    label:    'YouTube 1080p',
    hf:       { format: 'mp4', quality: 'standard' },
    width:    1920, height: 1080, fps: 30,
    enc:      { videoBitrate: '8M', audioBitrate: '192k', sampleRate: 48000,
                loudness: { target: -14, peak: -1.0, lra: 11 },
                codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: { width: 1280, at: 3 },
  },
  'youtube-4k': {
    label:    'YouTube 4K',
    hf:       { format: 'mp4', quality: 'high', resolution: 'landscape-4k' },
    width:    3840, height: 2160, fps: 30,
    enc:      { videoBitrate: '45M', audioBitrate: '192k', sampleRate: 48000,
                loudness: { target: -14, peak: -1.0, lra: 11 },
                codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: { width: 1280, at: 3 },
  },
  'shorts-1080p': {
    label:    'YouTube Shorts 1080p',
    hf:       { format: 'mp4', quality: 'standard' },
    width:    1080, height: 1920, fps: 30,
    enc:      { videoBitrate: '4M', audioBitrate: '128k', sampleRate: 48000,
                loudness: { target: -14, peak: -1.0, lra: 11 },
                codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: { width: 720, at: 1 },
  },
  'tiktok-1080p': {
    label:    'TikTok 1080p',
    hf:       { format: 'mp4', quality: 'standard' },
    width:    1080, height: 1920, fps: 30,
    enc:      { videoBitrate: '4M', audioBitrate: '128k', sampleRate: 48000,
                loudness: { target: -14, peak: -1.0, lra: 11 },
                codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: { width: 720, at: 1 },
    safeArea:  { top: 0.1, bottom: 0.15 },
  },
  'reels-1080p': {
    label:    'Instagram Reels 1080p',
    hf:       { format: 'mp4', quality: 'standard' },
    width:    1080, height: 1920, fps: 30,
    enc:      { videoBitrate: '4M', audioBitrate: '128k', sampleRate: 48000,
                loudness: { target: -14, peak: -1.0, lra: 11 },
                codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: { width: 720, at: 1 },
  },
  'linkedin-1080p': {
    label:    'LinkedIn 1080p',
    hf:       { format: 'mp4', quality: 'standard' },
    width:    1080, height: 1080, fps: 30,
    enc:      { videoBitrate: '5M', audioBitrate: '192k', sampleRate: 48000,
                loudness: { target: -16, peak: -1.0, lra: 11 },
                codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: { width: 720, at: 2 },
  },
  'x-1080p': {
    label:    'X 1080p',
    hf:       { format: 'mp4', quality: 'standard' },
    width:    1080, height: 1920, fps: 30,
    enc:      { videoBitrate: '4M', audioBitrate: '128k', sampleRate: 48000,
                loudness: { target: -14, peak: -1.0, lra: 11 },
                codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: { width: 720, at: 1 },
  },
  'narova-standard': {
    label:    'Narova Standard 720p',
    hf:       { format: 'mp4', quality: 'standard' },
    width:    1280, height: 720, fps: 30,
    enc:      { videoBitrate: '4M', audioBitrate: '128k', sampleRate: 48000,
                loudness: null, /* no loudnorm — rendering is already at this level */
                codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: null,
  },
  'whatsapp-compressed': {
    label:    'WhatsApp Compressed (under 16MB)',
    hf:       { format: 'mp4', quality: 'standard' },
    width:    540, height: 960, fps: 24,
    enc:      { videoBitrate: '560k', maxRate: '650k', bufSize: '1300k',
                audioBitrate: '72k', sampleRate: 44100,
                loudness: null,
                codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: null,
  },
};

/* Map a legacy `platform` config value to the canonical preset id. */
const PLATFORM_TO_PRESET = {
  youtube:  'youtube-1080p',
  tiktok:   'tiktok-1080p',
  reels:    'reels-1080p',
  shorts:   'shorts-1080p',
  linkedin: 'linkedin-1080p',
  x:        'x-1080p',
};

/* Pick the right preset for a deliverable / platform combo. */
function presetFor(id) {
  return PRESETS[id] || PRESETS['narova-standard'];
}

function presetsFor(config, explicitDeliverables) {
  const ids = new Set();
  ids.add('narova-standard');
  if (config.platform && PLATFORM_TO_PRESET[config.platform]) {
    ids.add(PLATFORM_TO_PRESET[config.platform]);
  }
  // config.deliverables: explicit preset ids or platform names
  const explicit = explicitDeliverables || config.deliverables;
  if (Array.isArray(explicit)) {
    for (const d of explicit) {
      const presetId = PLATFORM_TO_PRESET[d] || d; // resolve platform name → preset id
      if (PRESETS[presetId]) ids.add(presetId);
    }
  }
  return [...ids].map(id => ({ id, ...presetFor(id) }));
}

/* ---- ffmpeg post-processing ----------------------------------------------- */

/* Build the ffmpeg argument array for post-processing. Pure — no side effects.

 * Always inserts a scale+pad filter matching the preset dimensions so the
 * encoded deliverable is exactly the declared size. Safe-area guides are
 * ONLY applied when opts.safeAreaGuides is true — they are authoring
 * lint hints, not default burn-in elements. */
function buildFfmpegArgs(inputPath, outputPath, preset, opts = {}) {
  const enc = preset.enc || {};
  const loud = enc.loudness;
  const hasSafeArea = opts.safeAreaGuides && preset.safeArea;

  const args = ['-y', '-loglevel', 'error', '-i', inputPath];

  // Video: bitrate-targeted encode for platform deliverables.
  if (enc.codec === 'h264') {
    args.push('-c:v', 'libx264');
    if (enc.pixelFormat) args.push('-pix_fmt', enc.pixelFormat);
    if (enc.videoBitrate) args.push('-b:v', enc.videoBitrate);
    if (enc.maxRate) args.push('-maxrate', enc.maxRate);
    if (enc.bufSize) args.push('-bufsize', enc.bufSize);
    args.push('-preset', 'slow');
  } else {
    args.push('-c:v', 'copy');
  }

  // Scale + pad to enforce exact preset dimensions.
  if (preset.width && preset.height) {
    const scaleFilter = `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`;
    if (hasSafeArea) {
      const sa = preset.safeArea;
      const drawExpr = [];
      if (sa.top) drawExpr.push(`drawbox=0:0:iw:ih*${sa.top}:t=fill:c=black@0.15`);
      if (sa.bottom) drawExpr.push(`drawbox=0:ih-ih*${sa.bottom}:iw:ih*${sa.bottom}:t=fill:c=black@0.15`);
      args.push('-vf', [scaleFilter, ...drawExpr].join(','));
    } else {
      args.push('-vf', scaleFilter);
    }
  } else if (hasSafeArea) {
    const sa = preset.safeArea;
    const drawExpr = [];
    if (sa.top) drawExpr.push(`drawbox=0:0:iw:ih*${sa.top}:t=fill:c=black@0.15`);
    if (sa.bottom) drawExpr.push(`drawbox=0:ih-ih*${sa.bottom}:iw:ih*${sa.bottom}:t=fill:c=black@0.15`);
    if (drawExpr.length) args.push('-vf', drawExpr.join(','));
  }

  // Audio: loudness normalize + encode.
  if (loud) {
    args.push(
      '-af', `loudnorm=I=${loud.target}:TP=${loud.peak}:LRA=${loud.lra}:linear=true:print_format=summary`,
      '-c:a', 'aac', '-b:a', enc.audioBitrate || '128k',
      '-ar', String(enc.sampleRate || 48000),
    );
  } else {
    args.push('-c:a', 'aac', '-b:a', enc.audioBitrate || '128k');
  }

  args.push('-movflags', '+faststart', outputPath);
  return args;
}

/* Loudness-normalize + encode the audio track of an already-rendered
 * source mp4, emitting a delivery-ready mp4. */
function postProcess(inputPath, outputPath, preset, opts = {}) {
  sh('ffmpeg', buildFfmpegArgs(inputPath, outputPath, preset, opts));
  return outputPath;
}

/* Extract a thumbnail frame from an mp4. */
function generateThumbnail(inputPath, preset, outDir) {
  const thumb = preset.thumbnail;
  if (!thumb) return null;
  const outPath = path.join(outDir, path.basename(inputPath, path.extname(inputPath)) + '.jpg');
  sh('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', inputPath,
    '-ss', String(thumb.at || 2),
    '-vframes', '1',
    '-vf', `scale=${thumb.width || 1280}:-1`,
    outPath,
  ]);
  return outPath;
}

/* ---- deliverable render --------------------------------------------------- */

/* Render one deliverable: HyperFrames render → ffmpeg post-process → thumbnail.
 * Returns { mp4, seconds, thumbnail }. */
function renderDeliverable(hfDir, outDir, preset, opts = {}) {
  const log = opts.log || console.log;
  const baseName = (opts.name || 'video').replace(/\.mp4$/i, '');
  const presetId = opts.presetId || 'default';
  const suffix = presetId === 'narova-standard' ? '' : `-${presetId}`;
  const outName = `${baseName}${suffix}.mp4`;

  // Step 1: HyperFrames render (source-quality).
  const hf = preset.hf || {};
  const args = ['render', '--output', path.join('..', outName)];
  if (opts.videoFrameFormat) args.push('--video-frame-format', opts.videoFrameFormat);
  if (preset.fps) args.push('--fps', String(preset.fps));
  if (hf.quality) args.push('--quality', hf.quality);
  if (hf.format) args.push('--format', hf.format);
  if (hf.resolution) args.push('--resolution', hf.resolution);

  const { runHf } = require('./hf');
  runHf(args, hfDir);

  const sourceMp4 = path.join(outDir, outName);

  // Step 2: ffmpeg post-process for delivery encode.
  // Always post-process to a temp path (never in-place — ffmpeg can't
  // read and write the same file).
  const tempMp4 = path.join(outDir, `${baseName}${suffix}-enc.mp4`);

  const hasEncode = preset.enc && preset.enc.codec === 'h264';
  const hasLoudness = preset.enc && preset.enc.loudness;
  const hasSafeArea = opts.safeAreaGuides && preset.safeArea;

  if (hasEncode || hasLoudness || hasSafeArea) {
    postProcess(sourceMp4, tempMp4, preset, { safeAreaGuides: opts.safeAreaGuides });
    try { fs.unlinkSync(sourceMp4); } catch {}
    try { fs.renameSync(tempMp4, sourceMp4); } catch {}
  }

  const mp4 = fs.existsSync(sourceMp4) ? sourceMp4 : (fs.existsSync(tempMp4) ? tempMp4 : null);
  if (!mp4) throw new Error(`deliverable ${outName} not found after render`);
  const seconds = probe(mp4);

  // Step 3: Thumbnail.
  let thumbnail = null;
  if (preset.thumbnail) {
    thumbnail = generateThumbnail(mp4, preset, outDir);
    if (thumbnail) log(`thumbnail -> ${thumbnail}`);
  }

  log(`deliverable -> ${mp4}  (${seconds.toFixed(1)}s, ${preset.label})`);
  return { mp4, seconds, thumbnail };
}

/* Render all deliverable presets for a project. */
function buildDeliverables(config, hfDir, outDir, opts = {}) {
  const log = opts.log || console.log;
  const explicitDeliverables = opts.deliverables === true ? null : opts.deliverables;
  const presets = presetsFor(config, explicitDeliverables);
  const results = [];

  // Always do narova-standard first (it's the quickest baseline render).
  const standard = presets.find(p => p.id === 'narova-standard');
  const rest = presets.filter(p => p.id !== 'narova-standard');

  const ordered = standard ? [standard, ...rest] : [...rest];

  for (const p of ordered) {
    log(`  deliverable: ${p.label} (${p.width}x${p.height}, ${p.enc?.codec || 'copy'}, ${p.enc?.videoBitrate || '-'})`);
    const r = renderDeliverable(hfDir, outDir, p, { ...opts, presetId: p.id });
    results.push({ id: p.id, ...r });
  }

  return results;
}

/* Post-process one already-rendered source for every requested delivery
 * profile. No-browser renders once at the project frame size; unlike HyperFrames,
 * it does not need a browser render per profile. */
function buildDeliverablesFromSource(config, sourceMp4, outDir, opts = {}) {
  const log = opts.log || console.log;
  const explicit = opts.deliverables === true ? null : opts.deliverables;
  const presets = presetsFor(config, explicit);
  const standard = presets.find(p => p.id === 'narova-standard');
  const ordered = standard ? [standard, ...presets.filter(p => p.id !== 'narova-standard')] : presets;
  const baseName = path.basename(opts.name || sourceMp4, '.mp4');
  const results = [];

  for (const preset of ordered) {
    const suffix = preset.id === 'narova-standard' ? '' : `-${preset.id}`;
    const destination = path.join(outDir, `${baseName}${suffix}.mp4`);
    const temporary = path.join(outDir, `${baseName}${suffix}-enc.mp4`);
    log(`  deliverable: ${preset.label} (${preset.width}x${preset.height}, ${preset.enc?.codec || 'copy'}, ${preset.enc?.videoBitrate || '-'})`);
    postProcess(sourceMp4, temporary, preset, { safeAreaGuides: opts.safeAreaGuides });
    if (destination === sourceMp4) {
      fs.unlinkSync(sourceMp4);
      fs.renameSync(temporary, sourceMp4);
    } else {
      fs.renameSync(temporary, destination);
    }
    const mp4 = destination === sourceMp4 ? sourceMp4 : destination;
    const seconds = probe(mp4);
    const thumbnail = preset.thumbnail ? generateThumbnail(mp4, preset, outDir) : null;
    if (thumbnail) log(`thumbnail -> ${thumbnail}`);
    log(`deliverable -> ${mp4}  (${seconds.toFixed(1)}s, ${preset.label})`);
    results.push({ id: preset.id, mp4, seconds, thumbnail });
  }
  return results;
}

/* ---- Optional compressed companion (NAR-017-058..060) -----------------
 * An agent-owned iteration lever: one request at build or delivery time
 * produces an additional compressed copy beside the primary video. The
 * primary is untouched; nothing is ever created unrequested; no size is
 * enforced anywhere. The aim (when given) feeds deterministic arithmetic;
 * the evidence line reports reality back. The adjustment loop belongs to
 * the requester, visibly. */

/* Quick-review defaults when no aim is given (NAR-017-059). */
const COMPANION_DEFAULTS = Object.freeze({
  width: 1280,          // half-HD long edge; height follows the source aspect
  videoBitrate: 1000,   // kbps — a moderate quick-review band
  audioBitrateKbps: 80, // mono-review narration is fine at 80k
  channels: 1,
});

/* Container overhead allowance for the derived-bitrate arithmetic: a fixed
 * base plus a duration-proportional term (faststart moov + index growth).
 * Deliberately conservative; a visible miss is cheaper than a hidden one. */
function containerOverheadBytes(seconds) {
  return 256 * 1024 + Math.round(seconds * 2048);
}

function parseSizeAim(raw) {
  if (raw == null || raw === true) return null;
  const text = String(raw).trim().toLowerCase();
  const m = text.match(/^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g)?$/);
  if (!m) throw new Error(
    `companion aim must be a size like 60MB, 16MB, or 250000000 (got ${JSON.stringify(String(raw))})`);
  const value = parseFloat(m[1]);
  const unit = m[2] || 'b';
  const mult = { b: 1, kb: 1024, k: 1024, mb: 1024 * 1024, m: 1024 * 1024, gb: 1024 ** 3, g: 1024 ** 3 }[unit];
  return Math.round(value * mult);
}

/* Deterministic derivation (NAR-017-059): pure function of the aim, the
 * source's measured duration, the companion audio bitrate, dimensions, and
 * the preset rate ceiling. One pass, no retries. */
function deriveCompanionParams({ aimBytes, seconds, audioBitrateKbps, maxVideoBitrateKbps }) {
  const audio = COMPANION_DEFAULTS.audioBitrateKbps;
  const abr = audioBitrateKbps != null ? audioBitrateKbps : audio;
  if (aimBytes == null) {
    let bitrate = COMPANION_DEFAULTS.videoBitrate;
    if (maxVideoBitrateKbps != null) bitrate = Math.min(bitrate, maxVideoBitrateKbps);
    return { videoBitrateKbps: bitrate, audioBitrateKbps: abr, derived: false };
  }
  const available = aimBytes - containerOverheadBytes(seconds) - (abr * 1000 / 8) * seconds;
  let bitrate = Math.floor((available * 8) / 1000 / Math.max(0.1, seconds));
  if (!Number.isFinite(bitrate) || bitrate < 1) bitrate = 1; // physical floor
  if (maxVideoBitrateKbps != null) bitrate = Math.min(bitrate, maxVideoBitrateKbps);
  return { videoBitrateKbps: bitrate, audioBitrateKbps: abr, derived: true };
}

/* Create the companion for an existing primary mp4 (NAR-017-058).
 * Returns { mp4, aimBytes, achievedBytes, videoBitrateKbps, seconds } and
 * logs the evidence line (NAR-017-060). Never touches the primary. */
function buildCompanion(primaryMp4, outDir, request = {}, opts = {}) {
  const log = opts.log || console.log;
  const seconds = probe(primaryMp4);
  const aimBytes = parseSizeAim(request.aim);
  // Half-HD long edge; height keeps the source aspect and stays even.
  const srcW = Number(probeStream(primaryMp4, 'width')) || 1920;
  const srcH = Number(probeStream(primaryMp4, 'height')) || 1080;
  let width = Number(request.width) || COMPANION_DEFAULTS.width;
  if (width % 2 === 1) width += 1;
  let height = Math.round((width * srcH) / srcW);
  if (height % 2 === 1) height += 1;

  const params = deriveCompanionParams({
    aimBytes,
    seconds,
    audioBitrateKbps: COMPANION_DEFAULTS.audioBitrateKbps,
    maxVideoBitrateKbps: 12000, // ceiling: never worse than a generous preset max
  });

  const base = path.basename(primaryMp4, '.mp4');
  const outName = `${base}-companion.mp4`;
  const outPath = path.join(path.dirname(primaryMp4), outName);
  const tmp = `${outPath}.tmp.mp4`;
  sh('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', primaryMp4,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    '-c:v', 'libx264', '-preset', 'slow',
    '-b:v', `${params.videoBitrateKbps}k`,
    '-maxrate', `${Math.round(params.videoBitrateKbps * 1.2)}k`,
    '-bufsize', `${Math.round(params.videoBitrateKbps * 2.4)}k`,
    '-pix_fmt', 'yuv420p',
    '-ac', String(COMPANION_DEFAULTS.channels),
    '-c:a', 'aac', '-b:a', `${params.audioBitrateKbps}k`,
    '-movflags', '+faststart',
    tmp,
  ]);
  fs.renameSync(tmp, outPath);
  const achievedBytes = fs.statSync(outPath).size;
  const fmtAim = aimBytes != null ? `${(aimBytes / (1024 * 1024)).toFixed(1)}MB` : 'default';
  const fmtGot = `${(achievedBytes / (1024 * 1024)).toFixed(1)}MB`;
  log(`companion -> ${path.join(outDir ? path.basename(outPath) : outPath, '')}`.replace(/\/$/, '') +
      `  (aim=${fmtAim} achieved=${fmtGot} video=${params.videoBitrateKbps}k${params.derived ? ' (derived)' : ''} ${width}x${height})`);
  return { mp4: outPath, aimBytes, achievedBytes, videoBitrateKbps: params.videoBitrateKbps, seconds };
}

/* Stream property via ffprobe (width/height of the video stream). */
function probeStream(file, field) {
  const { execFileSync } = require('child_process');
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', `stream=${field}`,
      '-of', 'default=noprint_wrappers=1:nokey=1', String(file),
    ], { encoding: 'utf8' });
    return out.trim();
  } catch { return null; }
}

module.exports = {
  PRESETS,
  PLATFORM_TO_PRESET,
  presetFor,
  presetsFor,
  buildFfmpegArgs,
  postProcess,
  generateThumbnail,
  renderDeliverable,
  buildDeliverables,
  buildDeliverablesFromSource,
  buildCompanion,
  deriveCompanionParams,
  parseSizeAim,
  COMPANION_DEFAULTS,
};
