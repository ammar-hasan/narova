'use strict';
/* Comprehensive export profiles — render flags, encode presets, and
 * ffmpeg post-processing for platform deliverables.

 * The HyperFrames renderer produces a source-quality MP4. This module
 * defines the delivery profiles and the ffmpeg post-processing chain
 * (audio loudness, encode settings, thumbnails) that turns a render
 * into a platform-ready deliverable. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

/* Stable identity serialization. Objects are sorted recursively so preset IDs
 * and labels can remain publication metadata while every active execution
 * field participates in equality (NAR-017-061). */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deliverySourceIdentity(preset, opts = {}) {
  return stableJson({
    version: 1,
    renderer: opts.renderer || 'hyperframes',
    compositionIdentity: opts.compositionIdentity || null,
    fps: preset.fps || null,
    hf: preset.hf || {},
    videoFrameFormat: opts.videoFrameFormat || null,
  });
}

function deliveryEncodeIdentity(preset, sourceIdentity, opts = {}) {
  return stableJson({
    version: 1,
    sourceIdentity,
    width: preset.width || null,
    height: preset.height || null,
    enc: preset.enc || {},
    safeArea: opts.safeAreaGuides && preset.safeArea ? preset.safeArea : null,
  });
}

function deliveryThumbnailIdentity(preset, encodeIdentity) {
  if (!preset.thumbnail) return null;
  return stableJson({ version: 1, encodeIdentity, thumbnail: preset.thumbnail });
}

function orderedPresets(config, opts = {}) {
  const selected = Array.isArray(opts.presets)
    ? opts.presets
    : presetsFor(config, opts.deliverables === true ? null : opts.deliverables);
  const standard = selected.find(p => p.id === 'narova-standard');
  return standard
    ? [standard, ...selected.filter(p => p.id !== 'narova-standard')]
    : [...selected];
}

function memberPath(outDir, baseName, presetId) {
  const suffix = presetId === 'narova-standard' ? '' : `-${presetId}`;
  return path.join(outDir, `${baseName}${suffix}.mp4`);
}

/* Publish an independent named member without exposing a half-written copy. */
function publishCopy(source, destination) {
  if (path.resolve(source) === path.resolve(destination)) return destination;
  const temporary = `${destination}.copy-${process.pid}`;
  try {
    fs.copyFileSync(source, temporary);
    fs.renameSync(temporary, destination);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
  return destination;
}

function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function deliveryStatePath(outDir, baseName) {
  return path.join(outDir, `.${baseName}-delivery-identities.json`);
}

function readDeliveryState(outDir, baseName) {
  try {
    const value = JSON.parse(fs.readFileSync(deliveryStatePath(outDir, baseName), 'utf8'));
    return value && value.version === 1 && value.members ? value : null;
  } catch {
    return null;
  }
}

function priorArtifactIsValid(file, record) {
  if (!record || !fs.existsSync(file)) return false;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0 || stat.size !== record.bytes) return false;
    if (fileDigest(file) !== record.sha256) return false;
    if (record.seconds != null) {
      const seconds = probe(file);
      if (!Number.isFinite(seconds) || Math.abs(seconds - record.seconds) > 0.08) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function writeDeliveryState(outDir, baseName, members) {
  const destination = deliveryStatePath(outDir, baseName);
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, members }, null, 2));
    fs.renameSync(temporary, destination);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

function processDeliverableMembers(presets, outDir, sourceFor, opts = {}) {
  const log = opts.log || console.log;
  const baseName = path.basename(opts.name || 'video.mp4', '.mp4');
  const encoded = new Map();
  const thumbnails = new Map();
  const previous = readDeliveryState(outDir, baseName);
  // Preserve unselected member identities as ordinary reusable history. Their
  // files are revalidated before any future reuse, and a changed composition
  // identity makes them immediate misses.
  const nextMembers = previous ? { ...previous.members } : {};
  const results = [];

  for (const preset of presets) {
    const source = sourceFor(preset);
    const destination = memberPath(outDir, baseName, preset.id);
    const encodeIdentity = deliveryEncodeIdentity(
      preset, source.identity, { safeAreaGuides: opts.safeAreaGuides });
    const priorEncode = encoded.get(encodeIdentity);
    const priorMember = previous && previous.members[preset.id];
    let seconds;
    let encodeExecution;
    let sourceExecution;

    log(`  deliverable: ${preset.label} (${preset.width}x${preset.height}, ${preset.enc?.codec || 'copy'}, ${preset.enc?.videoBitrate || '-'})`);
    // Prefer work already selected or performed in THIS attempt. A valid prior
    // member may have been encoded in another process and need not be byte-
    // identical to a freshly repaired equal member, even when both decode the
    // same. Copying the first current-attempt identity keeps the published set
    // byte-identical as NAR-017-061 requires.
    if (priorEncode) {
      publishCopy(priorEncode.mp4, destination);
      seconds = priorEncode.seconds;
      encodeExecution = { status: 'reused', from: priorEncode.id };
      // Preserve the render origin independently of the encode donor. If the
      // donor itself reused a scene-cache or previous-build source, that is the
      // origin this member reused too; otherwise the donor performed it.
      sourceExecution = priorEncode.sourceExecution?.status === 'reused'
        ? { ...priorEncode.sourceExecution }
        : { status: 'reused', from: priorEncode.id };
      log(`    encode reused — same execution identity as ${priorEncode.id}`);
    } else if (source.reusableAcrossBuilds !== false
        && priorMember && priorMember.encodeIdentity === encodeIdentity
        && priorArtifactIsValid(destination, priorMember.mp4)) {
      seconds = priorMember.mp4.seconds;
      encodeExecution = { status: 'reused', from: preset.id, attempt: 'previous-build' };
      sourceExecution = { status: 'reused', from: preset.id, attempt: 'previous-build' };
      encoded.set(encodeIdentity, {
        id: preset.id, mp4: destination, seconds, sourceExecution,
      });
      log('    encode reused — validated previous build identity and digest');
    } else {
      const temporary = destination.replace(/\.mp4$/i, `.enc-${process.pid}.mp4`);
      try {
        const sourceMp4 = typeof source.getMp4 === 'function'
          ? source.getMp4(preset.id)
          : source.mp4;
        postProcess(sourceMp4, temporary, preset, { safeAreaGuides: opts.safeAreaGuides });
        fs.renameSync(temporary, destination);
      } finally {
        try { fs.rmSync(temporary, { force: true }); } catch {}
      }
      seconds = probe(destination);
      encodeExecution = { status: 'performed', from: null };
      sourceExecution = preset.id === source.performedBy
        ? (source.execution || { status: 'performed', from: null })
        : { status: 'reused', from: source.performedBy };
      encoded.set(encodeIdentity, {
        id: preset.id, mp4: destination, seconds, sourceExecution,
      });
    }

    if (typeof opts.artifact === 'function') {
      opts.artifact(destination, 'deliverable');
      // Preserve the canonical-video role historically emitted by the
      // browserless delivery path. HyperFrames gains only an additive role for
      // the same committed Standard path, keeping machine consumers stable.
      if (preset.id === 'narova-standard') opts.artifact(destination, 'video');
    }

    let thumbnail = null;
    let thumbnailExecution = { status: 'not-applicable', from: null };
    const thumbnailIdentity = deliveryThumbnailIdentity(preset, encodeIdentity);
    if (thumbnailIdentity) {
      const priorThumbnail = thumbnails.get(thumbnailIdentity);
      const expectedThumbnail = destination.replace(/\.mp4$/i, '.jpg');
      if (priorThumbnail) {
        publishCopy(priorThumbnail.path, expectedThumbnail);
        thumbnail = expectedThumbnail;
        thumbnailExecution = { status: 'reused', from: priorThumbnail.id };
        log(`    thumbnail reused — same execution identity as ${priorThumbnail.id}`);
      } else if (source.reusableAcrossBuilds !== false
          && priorMember && priorMember.thumbnailIdentity === thumbnailIdentity
          && priorArtifactIsValid(expectedThumbnail, priorMember.thumbnail)) {
        thumbnail = expectedThumbnail;
        thumbnailExecution = { status: 'reused', from: preset.id, attempt: 'previous-build' };
        thumbnails.set(thumbnailIdentity, { id: preset.id, path: thumbnail });
        log('    thumbnail reused — validated previous build identity and digest');
      } else {
        thumbnail = generateThumbnail(destination, preset, outDir);
        thumbnailExecution = { status: 'performed', from: null };
        thumbnails.set(thumbnailIdentity, { id: preset.id, path: thumbnail });
      }
      if (thumbnail && typeof opts.artifact === 'function') opts.artifact(thumbnail, 'thumbnail');
      if (thumbnail) log(`thumbnail -> ${thumbnail}`);
    }

    if (sourceExecution.status === 'reused') {
      const origin = sourceExecution.attempt === 'previous-build'
        ? `${sourceExecution.from} from previous build`
        : sourceExecution.from;
      log(`    source render reused — ${origin}`);
    }
    log(`deliverable -> ${destination}  (${seconds.toFixed(1)}s, ${preset.label})`);
    results.push({
      id: preset.id,
      mp4: destination,
      seconds,
      thumbnail,
      execution: {
        source: sourceExecution,
        encode: encodeExecution,
        thumbnail: thumbnailExecution,
      },
    });
    nextMembers[preset.id] = {
      sourceIdentity: source.identity,
      encodeIdentity,
      mp4: {
        bytes: fs.statSync(destination).size,
        sha256: fileDigest(destination),
        seconds,
      },
      thumbnailIdentity,
      thumbnail: thumbnail ? {
        bytes: fs.statSync(thumbnail).size,
        sha256: fileDigest(thumbnail),
        seconds: null,
      } : null,
    };
  }
  writeDeliveryState(outDir, baseName, nextMembers);
  return results;
}

function renderDeliverySource(hfDir, outDir, preset, sourceIndex, opts = {}) {
  const sourceMp4 = path.join(outDir, `.narova-delivery-source-${process.pid}-${sourceIndex}.mp4`);
  const hf = preset.hf || {};
  const args = ['render', '--output', path.relative(hfDir, sourceMp4)];
  if (opts.videoFrameFormat) args.push('--video-frame-format', opts.videoFrameFormat);
  if (preset.fps) args.push('--fps', String(preset.fps));
  if (hf.quality) args.push('--quality', hf.quality);
  if (hf.format) args.push('--format', hf.format);
  if (hf.resolution) args.push('--resolution', hf.resolution);
  const { runHf } = require('./hf');
  try {
    runHf(args, hfDir);
    if (!fs.existsSync(sourceMp4) || fs.statSync(sourceMp4).size === 0) {
      throw new Error(`delivery source render missing for ${preset.id}`);
    }
    return sourceMp4;
  } catch (error) {
    try { fs.rmSync(sourceMp4, { force: true }); } catch {}
    throw error;
  }
}

/* Render one deliverable through the same identity-minimal path as a set. */
function renderDeliverable(hfDir, outDir, preset, opts = {}) {
  const presetId = opts.presetId || preset.id || 'default';
  const [result] = buildDeliverables({}, hfDir, outDir, {
    ...opts, presets: [{ id: presetId, ...preset }],
  });
  const { id, ...withoutId } = result;
  return withoutId;
}

/* Render all HyperFrames deliverables. Equal source identities render once;
 * equal post-process identities encode once and publish independent copies. */
function buildDeliverables(config, hfDir, outDir, opts = {}) {
  const presets = orderedPresets(config, opts);
  const sources = new Map();
  const sourceFiles = [];
  try {
    return processDeliverableMembers(presets, outDir, preset => {
      const identity = deliverySourceIdentity(preset, {
        renderer: 'hyperframes', videoFrameFormat: opts.videoFrameFormat,
        compositionIdentity: opts.compositionIdentity,
      });
      // Pipeline callers may supply an already-rendered source for one exact
      // identity while leaving all other identities on the ordinary lazy
      // HyperFrames path. This keeps one ordered publication loop and its
      // partial-failure boundary intact.
      const supplied = typeof opts.sourceFor === 'function'
        ? opts.sourceFor(preset, identity)
        : null;
      if (supplied) return supplied;
      let source = sources.get(identity);
      if (!source) {
        const sourceIndex = sources.size;
        source = {
          identity,
          reusableAcrossBuilds: opts.compositionIdentity != null,
          mp4: null,
          performedBy: null,
          execution: null,
          getMp4(requestedBy) {
            if (!this.mp4) {
              this.mp4 = renderDeliverySource(
                hfDir, outDir, preset, sourceIndex, opts);
              this.performedBy = requestedBy;
              this.execution = { status: 'performed', from: null };
              sourceFiles.push(this.mp4);
            }
            return this.mp4;
          },
        };
        sources.set(identity, source);
      }
      return source;
    }, opts);
  } finally {
    for (const file of sourceFiles) {
      try { fs.rmSync(file, { force: true }); } catch {}
    }
  }
}

/* Post-process one immutable already-rendered source for requested profiles.
 * If the source is also the Standard destination, stage it before publishing
 * any member so later profiles never derive from Standard's padded output. */
function buildDeliverablesFromSource(config, sourceMp4, outDir, opts = {}) {
  const presets = orderedPresets(config, opts);
  const baseName = path.basename(opts.name || sourceMp4, '.mp4');
  const collides = presets.some(p => path.resolve(memberPath(outDir, baseName, p.id)) === path.resolve(sourceMp4));
  let immutableSource = sourceMp4;
  if (collides) {
    immutableSource = path.join(outDir, `.${baseName}-delivery-source-${process.pid}.mp4`);
    fs.copyFileSync(sourceMp4, immutableSource);
  }
  const identity = opts.sourceIdentity || stableJson({
    version: 1,
    renderer: opts.renderer || 'supplied-source',
    source: {
      path: path.resolve(sourceMp4),
      bytes: fs.statSync(immutableSource).size,
      sha256: fileDigest(immutableSource),
    },
  });
  const performedBy = presets.length ? presets[0].id : null;
  try {
    return processDeliverableMembers(presets, outDir, () => ({
      identity, mp4: immutableSource, performedBy,
      reusableAcrossBuilds: true,
      execution: opts.sourceExecution || { status: 'performed', from: null },
    }), opts);
  } finally {
    if (collides) {
      try { fs.rmSync(immutableSource, { force: true }); } catch {}
    }
  }
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
  deliverySourceIdentity,
  deliveryEncodeIdentity,
  deliveryThumbnailIdentity,
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
