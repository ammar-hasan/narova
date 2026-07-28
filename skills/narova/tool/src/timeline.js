'use strict';
/* Versioned timeline intermediate representation.

 * narova projects compile the friendly reel.config.* surface into a single
 * versioned timeline.json document. The timeline captures every datum the
 * pipeline needs — project metadata, format, voices, scenes, narration,
 * timing slots, and deliverables — in one self-contained file.

 * Contract:
 *   compile(config)       — reel.config (resolved) → timeline document
 *   validate(timeline)    — check a timeline against the schema; returns errors[]
 *   mergeTimings(tl, path) — read timings.json and merge word/scene data into tl
 *   TIMELINE_SCHEMA_VER   — the schema version string

 * The timeline is forward-compatible: unknown top-level keys are ignored by
 * consumers. New pipelines read the `narova` key to decide compatibility. */

const path = require('path');
const fs = require('fs');
const { PLATFORMS } = require('./util');

/* ---- schema version ------------------------------------------------------- */
const TIMELINE_SCHEMA_VER = '1.0';

/* Platfom-specific deliverable presets (future: codec/bitrate/safe-area).
 * Today they carry the frame size + advisory duration band. */
const DELIVERABLE_PRESET_MAP = {
  tiktok:   { size: { w: 1080, h: 1920 }, band: [21, 34] },
  reels:    { size: { w: 1080, h: 1920 }, band: [15, 30] },
  shorts:   { size: { w: 1080, h: 1920 }, band: [30, 50] },
  linkedin: { size: { w: 1080, h: 1080 }, band: [30, 90] },
  x:        { size: { w: 1080, h: 1920 }, band: [0, 140] },
};

/* ---- compilation ---------------------------------------------------------- */

function compile(config, opts = {}) {
  const { title, size, voices, theme = {}, mode = 'dark', chrome = {},
    themeCss = '', timing = {}, scenes, platform = null, bed = null, sfx = [],
    captions = {}, align = false, variants = [], variant = null, series = null,
    projectDir = '.' } = config;

  const assets = collectAssets(config, projectDir);
  const deliverables = buildDeliverables(config);

  return {
    narova: opts.toolVersion || '0.8.0',
    version: TIMELINE_SCHEMA_VER,
    project: {
      title,
      created: new Date().toISOString(),
      platform: platform || null,
    },
    format: {
      width:  (size && size.w) || 1280,
      height: (size && size.h) || 720,
      fps:    30,
      sampleRate: 48000,
      colorSpace: 'rec709',
    },
    theme: {
      accent: (theme && theme.accent) || '#2ee6d6',
      bg:     (theme && theme.bg)     || '#080d16',
      mode,
      css:    themeCss || '',
    },
    chrome: { ...(chrome || {}) },
    voices: compileVoices(voices || {}),
    timing: {
      gapSentence: timing.gapSentence != null ? timing.gapSentence : 0.24,
      gapTurn:     timing.gapTurn     != null ? timing.gapTurn     : 0.44,
      lead:        timing.lead        != null ? timing.lead        : 0.16,
      tail:        timing.tail        != null ? timing.tail        : 0.58,
      tempo:       timing.tempo != null ? timing.tempo : null,
    },
    audio: {
      bed: bed ? { file: bed.file, volume: bed.volume, fadeIn: bed.fadeIn, fadeOut: bed.fadeOut } : null,
      sfx: (sfx || []).map(s => ({ file: s.file, scene: s.scene || null, at: s.at, volume: s.volume })),
    },
    captions: {
      preset:   (captions && captions.preset)   || 'karaoke',
      emphasis: (captions && captions.emphasis) || [],
      maxWords: (captions && captions.maxWords) || null,
    },
    align: align === false ? null : (typeof align === 'object' ? align : { engine: 'auto' }),
    assets,
    scenes: compileScenes(scenes || []),
    variants: compileVariants(variants || []),
    series: series || null,
    variant: variant || null,
    deliverables,
  };
}

/* ---- helpers -------------------------------------------------------------- */

function collectAssets(config, projectDir) {
  const seen = new Set();
  const assets = [];
  function add(type, file) {
    if (!file) return;
    const abs = path.resolve(projectDir || '.', file);
    if (seen.has(abs)) return;
    seen.add(abs);
    const entry = { id: path.basename(file, path.extname(file)), type, file };
    if (fs.existsSync(abs)) {
      try { entry.size = fs.statSync(abs).size; } catch {}
    }
    assets.push(entry);
  }
  // Explicit pipeline assets (bed, sfx, clip).
  if (config.bed) add('audio', config.bed.file);
  if (config.sfx) config.sfx.forEach(s => add('audio', s.file));
  config.scenes.forEach(s => { if (s.clip) add('video', s.clip); });
  // Assets directory — the full project asset tree referenced from scene HTML.
  for (const root of [config.assetsDir, path.join(projectDir, 'assets')].filter(Boolean)) {
    if (!root || !fs.existsSync(root)) continue;
    walkAssets(root, '', seen, assets, projectDir);
  }
  return assets;
}

function walkAssets(dir, relPrefix, seen, assets, projectDir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = relPrefix ? path.join(relPrefix, e.name) : e.name;
    if (e.isDirectory()) {
      walkAssets(full, rel, seen, assets, projectDir);
    } else if (e.isFile()) {
      const abs = path.resolve(full);
      if (seen.has(abs)) continue;
      seen.add(abs);
      const ext = path.extname(e.name).toLowerCase();
      let type = 'file';
      if (/\.(mp4|mov|webm|avi)$/i.test(e.name)) type = 'video';
      else if (/\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(e.name)) type = 'audio';
      else if (/\.(png|jpg|jpeg|gif|svg|webp|avif)$/i.test(e.name)) type = 'image';
      else if (/\.(ttf|otf|woff2?|eot)$/i.test(e.name)) type = 'font';
      else if (/\.css$/i.test(e.name)) type = 'style';
      const entry = { id: path.basename(e.name, path.extname(e.name)), type, file: rel };
      try { entry.size = fs.statSync(abs).size; } catch {}
      assets.push(entry);
    }
  }
}

function compileVoices(voices) {
  const out = {};
  for (const [id, v] of Object.entries(voices)) {
    out[id] = {
      label:   v.label,
      color:   v.color,
      backend: v.backend,
      speaker: v.speaker,
      ...(v.gainDb != null ? { gainDb: v.gainDb } : {}),
      ...(v.lang ? { lang: v.lang } : {}),
      ...(v.instruct ? { instruct: v.instruct } : {}),
      ...(v.exaggeration != null ? { exaggeration: v.exaggeration } : {}),
      ...(v.cfg_weight != null ? { cfg_weight: v.cfg_weight } : {}),
    };
  }
  return out;
}

function compileScenes(scenes) {
  return (scenes || []).map((s, i) => ({
    id:         s.id,
    index:      i,
    start:      0,          // filled after synth
    duration:   0,          // filled after synth
    transition: s.transition || 'fade',
    vo:         (s.vo || []).map(turn => ({
      who:  turn.who,
      text: turn.text,
      ...(turn.lang ? { lang: turn.lang } : {}),
      start: 0,            // filled after synth
      words: [],           // filled after synth
    })),
    body: s.body || '',
    clip: s.clip || null,
    dur:  s.dur || null,   // silent scene fixed duration
    sfx:  [],              // per-scene SFX anchors (filled by audio.sfx resolution)
  }));
}

function compileVariants(variants) {
  return (variants || []).map(v => ({
    id: v.id,
    scene: v.scene ? {
      body:       v.scene.body || '',
      vo:         (v.scene.vo || []).map(turn => ({
        who: turn.who,
        text: turn.text,
        ...(turn.lang ? { lang: turn.lang } : {}),
      })),
      ...(v.scene.transition ? { transition: v.scene.transition } : {}),
    } : null,
  }));
}

function buildDeliverables(config) {
  const { platform, size } = config;
  const list = [];
  // Always emit a baseline deliverable.
  list.push({
    id:         'default',
    preset:     'narova-standard',
    width:      size.w,
    height:     size.h,
    fps:        30,
    codec:      'h264',
    bitrate:    '4M',
    sampleRate: 48000,
  });
  if (platform && PLATFORMS[platform]) {
    const p = PLATFORMS[platform];
    list.push({
      id:         platform,
      preset:     `${platform}-preset`,
      width:      p.size.w,
      height:     p.size.h,
      fps:        30,
      codec:      'h264',
      bitrate:    '4M',
      sampleRate: 48000,
      durationBand: p.band,
    });
  }
  return list;
}

/* ---- validation --------------------------------------------------------- */

function validate(tl) {
  const errs = [];
  if (!tl || typeof tl !== 'object') { errs.push('timeline: expected an object'); return errs; }
  // Compatibility gating: the narova key is required for forward compatibility.
  if (!tl.narova || typeof tl.narova !== 'string') {
    errs.push('timeline.narova: required (string) — the tool version that produced this timeline');
  }
  if (!tl.version || typeof tl.version !== 'string') errs.push('timeline.version: required (string)');
  else if (tl.version !== TIMELINE_SCHEMA_VER) {
    errs.push(`timeline.version: expected "${TIMELINE_SCHEMA_VER}", got "${tl.version}"`);
  }
  if (!tl.project || typeof tl.project !== 'object') errs.push('timeline.project: required (object)');
  else if (!tl.project.title || typeof tl.project.title !== 'string') errs.push('timeline.project.title: required (string)');
  if (!tl.format || typeof tl.format !== 'object') errs.push('timeline.format: required (object)');
  else {
    if (!Number.isFinite(tl.format.width)) errs.push('timeline.format.width: required (number)');
    if (!Number.isFinite(tl.format.height)) errs.push('timeline.format.height: required (number)');
  }
  if (!tl.voices || typeof tl.voices !== 'object' || Object.keys(tl.voices).length === 0) {
    errs.push('timeline.voices: at least one voice required');
  }
  if (!Array.isArray(tl.scenes)) errs.push('timeline.scenes: required (array)');
  else if (tl.scenes.length === 0) errs.push('timeline.scenes: at least one scene required');
  else {
    tl.scenes.forEach((s, i) => {
      if (!s.id) errs.push(`timeline.scenes[${i}].id: required`);
      if (!Array.isArray(s.vo)) errs.push(`timeline.scenes[${i}].vo: required (array)`);
      else {
        s.vo.forEach((turn, j) => {
          if (!turn.who) errs.push(`timeline.scenes[${i}].vo[${j}].who: required`);
          if (typeof turn.text !== 'string') errs.push(`timeline.scenes[${i}].vo[${j}].text: required`);
        });
      }
    });
  }
  if (!Array.isArray(tl.deliverables)) errs.push('timeline.deliverables: required (array)');
  return errs;
}

function isValid(tl) { return validate(tl).length === 0; }

/* ---- timing merge ------------------------------------------------------- */

function mergeTimings(tl, timingsPath) {
  const timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  if (!timings || typeof timings !== 'object') return tl;

  const updated = JSON.parse(JSON.stringify(tl)); // deep copy
  let globalStart = 0;
  updated.totalDuration = 0;

  for (const s of updated.scenes) {
    const ts = timings[s.id];
    if (!ts) { s.start = globalStart; s.duration = s.dur || 0; globalStart += s.duration; continue; }
    s.start    = globalStart;
    s.duration = ts.dur || 0;

    if (ts.words && Array.isArray(ts.words) && s.vo.length > 0) {
      // Group words by sentence index (si).
      const bySi = new Map();
      for (const w of ts.words) {
        const si = w.si != null ? w.si : 0;
        if (!bySi.has(si)) bySi.set(si, []);
        bySi.get(si).push({ w: w.w, t0: w.t0, t1: w.t1 });
      }
      // Count sentences per turn so si ranges map to the correct turn.
      const sentCounts = countSentencesPerTurn(s.vo);
      const sortedSi = [...bySi.keys()].sort((a, b) => a - b);
      let siCursor = 0;
      for (let ti = 0; ti < s.vo.length && siCursor < sortedSi.length; ti++) {
        const nSent = sentCounts[ti] || 1;
        const words = [];
        for (let j = 0; j < nSent && siCursor < sortedSi.length; j++, siCursor++) {
          words.push(...bySi.get(sortedSi[siCursor]));
        }
        // turns[ti] is already scene-local including lead — no extra offset.
        s.vo[ti].words = words;
        s.vo[ti].start = globalStart + (ts.turns ? ts.turns[ti] || 0 : 0);
      }
      // Remaining turns (if any) keep empty words.
      for (let ti = s.vo.length - 1; ti >= 0; ti--) {
        if (!s.vo[ti].words || s.vo[ti].words.length === 0) {
          s.vo[ti].words = [];
        }
      }
    }

    globalStart += s.duration;
  }
  updated.totalDuration = Math.round(globalStart * 1000) / 1000;
  updated.stages = updated.stages || {};
  updated.stages.synth = new Date().toISOString();

  return updated;
}

function countSentencesPerTurn(vo) {
  return vo.map(t => {
    if (!t.text) return 1;
    // Match Python's sentences() in pipeline.py: split on terminal punctuation.
    const parts = t.text.split(/(?<=[.?!]["'»)]*)\s+/);
    const nonEmpty = parts.filter(p => p.trim());
    return nonEmpty.length || 1;
  });
}

/* ---- JSON round-trip helpers -------------------------------------------- */

function read(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function write(timeline, outPath) {
  fs.writeFileSync(outPath, JSON.stringify(timeline, null, 2));
}

module.exports = {
  TIMELINE_SCHEMA_VER,
  compile,
  validate,
  isValid,
  mergeTimings,
  read,
  write,
};
