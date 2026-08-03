'use strict';
/* Versioned project manifest — narova's canonical intermediate representation.

 * narova projects compile the friendly reel.config.* surface into a single
 * versioned manifest.json document. The manifest captures every datum the
 * pipeline needs — project metadata, format, voices, scenes, narration,
 * timing slots, asset inventory, and deliverables — in one self-contained,
 * hash-addressable file.

 * Contract:
 *   compile(config)       — reel.config (resolved) → manifest document
 *   validate(manifest)    — check a manifest against the schema; returns errors[]
 *   mergeTimings(tl, path) — read timings.json and merge word/scene data into tl
 *   MANIFEST_SCHEMA_VER   — the schema version string

 * The manifest is forward-compatible: unknown top-level keys are ignored by
 * consumers. New pipelines read the `narova` key to decide compatibility. */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PLATFORMS } = require('./util');
// Lazy-load exports module to avoid circular dependency at parse time.
let _exports = null;
function exportsMod() {
  if (!_exports) _exports = require('./exports');
  return _exports;
}

/* ---- schema version ------------------------------------------------------- */
const MANIFEST_SCHEMA_VER = '1.0';

/* ---- hashing --------------------------------------------------------------- */

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return sha256(fs.readFileSync(filePath));
}

function hashConfig(config) {
  const { assetsDir: _a, projectDir = '.', ...serializable } = config;
  // Resolved action-policy paths are absolute so the capture adapter can use
  // them from any working directory. Keep the config fingerprint portable:
  // moving an otherwise-identical project must not make every capture stale.
  if (serializable.walkthroughs) {
    serializable.walkthroughs = Object.fromEntries(
      Object.entries(serializable.walkthroughs).map(([id, flow]) => [
        id,
        flow && flow.actionPolicy
          ? {
              ...flow,
              actionPolicy: path.relative(projectDir, flow.actionPolicy) || path.basename(flow.actionPolicy),
              actionPolicyHash: hashFile(flow.actionPolicy),
            }
          : flow,
      ]),
    );
  }
  return sha256(JSON.stringify(serializable));
}

function buildHashes(config, projectDir) {
  const h = {};
  h.config = hashConfig(config);
  // Theme CSS
  if (config.themeCss) h.themeCss = sha256(config.themeCss);
  // Assets: hash each discoverable file
  const assetsRoot = config.assetsDir || path.join(projectDir || '.', 'assets');
  if (fs.existsSync(assetsRoot)) {
    function walk(dir, prefix) {
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isFile()) {
            h[path.join(prefix || '', e.name)] = hashFile(path.join(dir, e.name));
          } else if (e.isDirectory()) {
            walk(path.join(dir, e.name), path.join(prefix || '', e.name));
          }
        }
      } catch {}
    }
    walk(assetsRoot, '');
  }
  // Bed / sfx / clip files — hash by relative path (portable).
  const pd = projectDir || '.';
  if (config.bed && config.bed.file) {
    const rel = path.relative(pd, config.bed.file) || config.bed.file;
    h[rel] = hashFile(config.bed.file);
  }
  if (config.sfx) config.sfx.forEach(s => {
    const rel = path.relative(pd, s.file) || s.file;
    h[rel] = hashFile(s.file);
  });
  config.scenes.forEach(s => {
    if (s.clip) {
      const absClip = path.resolve(pd, s.clip);
      h[s.clip] = hashFile(absClip);
    }
  });
  return h;
}

/* ---- compilation ---------------------------------------------------------- */

function compile(config, opts = {}) {
  const { title, size, renderer = 'hyperframes', voices, theme = {}, mode = 'dark', chrome = {},
    themeCss = '', timing = {}, scenes, platform = null, bed = null, sfx = [],
    captions = {}, align = false, variants = [], variant = null, series = null,
    walkthroughs = {}, projectDir = '.' } = config;

  const assets = collectAssets(config, projectDir);
  const deliverables = buildDeliverables(config);

  return {
    narova: opts.toolVersion || '0.8.0',
    version: MANIFEST_SCHEMA_VER,
    project: {
      title,
      created: new Date().toISOString(),
      platform: platform || null,
    },
    renderer: {
      provider: renderer,
      protocol: 'narova-renderer-provider/v1',
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
      bed: bed ? { file: path.relative(projectDir, bed.file) || bed.file, volume: bed.volume, fadeIn: bed.fadeIn, fadeOut: bed.fadeOut } : null,
      sfx: (sfx || []).map(s => ({ file: path.relative(projectDir, s.file) || s.file, scene: s.scene || null, at: s.at, volume: s.volume })),
    },
    captions: {
      preset:   (captions && captions.preset)   || 'karaoke',
      emphasis: (captions && captions.emphasis) || [],
      maxWords: (captions && captions.maxWords) || null,
    },
    align: align === false ? null : (typeof align === 'object' ? align : { engine: 'auto' }),
    assets,
    walkthroughs: compileWalkthroughs(walkthroughs, projectDir),
    scenes: compileScenes(scenes || []),
    variants: compileVariants(variants || []),
    series: series || null,
    variant: variant || null,
    environment: {
      narova:    opts.toolVersion || '0.8.0',
      backend:   opts.backend || config.voices && Object.values(config.voices)[0]?.backend || 'piper',
      renderer,
      compiled:  new Date().toISOString(),
    },
    hashes: buildHashes(config, projectDir),
    deliverables,
  };
}

/* ---- helpers -------------------------------------------------------------- */

function collectAssets(config, projectDir) {
  const seen = new Set();
  const assets = [];
  function add(type, file) {
    if (!file) return;
    const pd = projectDir || '.';
    const abs = path.resolve(pd, file);
    if (seen.has(abs)) return;
    seen.add(abs);
    const rel = path.relative(pd, abs) || file;
    const entry = { id: path.basename(file, path.extname(file)), type, file: rel };
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
    const speaker = v.speaker;
    const cleanSpeaker = (v.backend === 'chatterbox' || v.backend === 'xtts') && speaker && path.isAbsolute(speaker)
      ? path.basename(speaker, path.extname(speaker))
      : speaker;
    out[id] = {
      label:   v.label,
      color:   v.color,
      backend: v.backend,
      speaker: cleanSpeaker,
      ...(v.gainDb != null ? { gainDb: v.gainDb } : {}),
      ...(v.lang ? { lang: v.lang } : {}),
      ...(v.instruct ? { instruct: v.instruct } : {}),
      ...(v.exaggeration != null ? { exaggeration: v.exaggeration } : {}),
      ...(v.cfg_weight != null ? { cfg_weight: v.cfg_weight } : {}),
      ...(v.providerProtocol ? { providerProtocol: v.providerProtocol } : {}),
      ...(v.providerVersion ? { providerVersion: v.providerVersion } : {}),
      ...(v.providerOptions ? { providerOptions: v.providerOptions } : {}),
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
      ...(turn.synthesisText ? { synthesisText: turn.synthesisText } : {}),
      start: 0,            // filled after synth
      words: [],           // filled after synth
    })),
    body: s.body || '',
    visual: s.visual || null,
    clip: s.clip || null,
    walkthrough: s.walkthrough || null,
    dur:  s.dur || null,   // silent scene fixed duration
    sfx:  [],              // per-scene SFX anchors (filled by audio.sfx resolution)
  }));
}

function portableUrl(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '<invalid-url>';
  }
}

function privateReference(value) {
  if (!value) return { value, hash: null };
  return { value: '<configured>', hash: sha256(String(value)) };
}

function compileWait(value) {
  if (!value) return value;
  if (!value.url) return { ...value };
  return {
    ...value,
    url: portableUrl(value.url),
    urlHash: sha256(value.url),
  };
}

function compileWalkthroughs(walkthroughs, projectDir) {
  const out = {};
  for (const [id, flow] of Object.entries(walkthroughs || {})) {
    const session = privateReference(flow.session);
    const profile = privateReference(flow.profile);
    const restore = typeof flow.restore === 'string'
      ? privateReference(flow.restore)
      : { value: flow.restore, hash: null };
    out[id] = {
      id: flow.id,
      driver: flow.driver,
      url: portableUrl(flow.url),
      urlHash: sha256(flow.url),
      title: flow.title,
      session: session.value,
      ...(session.hash ? { sessionHash: session.hash } : {}),
      restore: restore.value,
      ...(restore.hash ? { restoreHash: restore.hash } : {}),
      profile: profile.value,
      ...(profile.hash ? { profileHash: profile.hash } : {}),
      viewport: flow.viewport,
      ready: compileWait(flow.ready),
      preRoll: flow.preRoll,
      postRoll: flow.postRoll,
      cursor: flow.cursor,
      screenshots: flow.screenshots,
      mutates: flow.mutates,
      allowedDomains: flow.allowedDomains,
      actionPolicy: flow.actionPolicy
        ? path.relative(projectDir, flow.actionPolicy) || path.basename(flow.actionPolicy)
        : null,
      actionPolicyHash: flow.actionPolicy ? hashFile(flow.actionPolicy) : null,
      // Typed/selected input and URL queries never belong in a portable build
      // manifest. Digests retain deterministic change detection.
      steps: (flow.steps || []).map(step => {
        const compiled = compileWait(step);
        if (!['fill', 'type', 'select'].includes(step.action)) return compiled;
        return {
          ...compiled,
          value: '<redacted>',
          valueHash: sha256(JSON.stringify(step.value)),
        };
      }),
    };
  }
  return out;
}

function compileVariants(variants) {
  return (variants || []).map(v => ({
    id: v.id,
    scene: v.scene ? {
      body:       v.scene.body || '',
      visual:     v.scene.visual || null,
      vo:         (v.scene.vo || []).map(turn => ({
        who: turn.who,
        text: turn.text,
        ...(turn.lang ? { lang: turn.lang } : {}),
        ...(turn.synthesisText ? { synthesisText: turn.synthesisText } : {}),
      })),
      ...(v.scene.transition ? { transition: v.scene.transition } : {}),
    } : null,
  }));
}

function buildDeliverables(config) {
  const { platform, size } = config;
  const e = exportsMod();
  const list = [];
  // Always emit a baseline deliverable from the canonical narova-standard preset.
  const standardPreset = e.PRESETS['narova-standard'];
  list.push({
    id:         'default',
    preset:     'narova-standard',
    width:      standardPreset ? standardPreset.width : (size.w || 1280),
    height:     standardPreset ? standardPreset.height : (size.h || 720),
    fps:        30,
    codec:      standardPreset && standardPreset.enc ? standardPreset.enc.codec : 'h264',
    bitrate:    standardPreset && standardPreset.enc ? standardPreset.enc.videoBitrate : '4M',
    sampleRate: 48000,
    loudness:   standardPreset && standardPreset.enc && standardPreset.enc.loudness ? standardPreset.enc.loudness : null,
    safeArea:   null,
    thumbnail:  standardPreset && standardPreset.thumbnail ? { width: standardPreset.thumbnail.width, at: standardPreset.thumbnail.at } : null,
  });
  if (platform && e.PLATFORM_TO_PRESET[platform]) {
    const presetId = e.PLATFORM_TO_PRESET[platform];
    const preset = e.PRESETS[presetId];
    if (preset) {
      list.push({
        id:         platform,
        preset:     presetId,
        width:      preset.width,
        height:     preset.height,
        fps:        preset.fps,
        codec:      preset.enc ? preset.enc.codec : 'h264',
        bitrate:    preset.enc ? preset.enc.videoBitrate : '4M',
        sampleRate: preset.enc ? preset.enc.sampleRate : 48000,
        loudness:   preset.enc && preset.enc.loudness ? preset.enc.loudness : null,
        safeArea:   preset.safeArea || null,
        thumbnail:  preset.thumbnail ? { width: preset.thumbnail.width, at: preset.thumbnail.at } : null,
        ...(PLATFORMS[platform] && PLATFORMS[platform].band ? { durationBand: PLATFORMS[platform].band } : {}),
      });
    }
  }
  return list;
}

/* ---- validation --------------------------------------------------------- */

function validate(tl) {
  const errs = [];
  if (!tl || typeof tl !== 'object') { errs.push('manifest: expected an object'); return errs; }
  // Compatibility gating: the narova key is required for forward compatibility.
  if (!tl.narova || typeof tl.narova !== 'string') {
    errs.push('manifest.narova: required (string) — the tool version that produced this timeline');
  }
  if (!tl.version || typeof tl.version !== 'string') errs.push('manifest.version: required (string)');
  else if (tl.version !== MANIFEST_SCHEMA_VER) {
    errs.push(`manifest.version: expected "${MANIFEST_SCHEMA_VER}", got "${tl.version}"`);
  }
  if (!tl.project || typeof tl.project !== 'object') errs.push('manifest.project: required (object)');
  else if (!tl.project.title || typeof tl.project.title !== 'string') errs.push('manifest.project.title: required (string)');
  if (tl.renderer != null) {
    if (!tl.renderer || typeof tl.renderer !== 'object' || Array.isArray(tl.renderer)) {
      errs.push('manifest.renderer: expected an object');
    } else {
      if (!['hyperframes', 'native'].includes(tl.renderer.provider)) {
        errs.push('manifest.renderer.provider: expected hyperframes|native');
      }
      if (tl.renderer.protocol !== 'narova-renderer-provider/v1') {
        errs.push('manifest.renderer.protocol: expected narova-renderer-provider/v1');
      }
    }
  }
  if (!tl.format || typeof tl.format !== 'object') errs.push('manifest.format: required (object)');
  else {
    if (!Number.isFinite(tl.format.width)) errs.push('manifest.format.width: required (number)');
    if (!Number.isFinite(tl.format.height)) errs.push('manifest.format.height: required (number)');
  }
  if (!tl.voices || typeof tl.voices !== 'object' || Object.keys(tl.voices).length === 0) {
    errs.push('manifest.voices: at least one voice required');
  }
  if (!Array.isArray(tl.scenes)) errs.push('manifest.scenes: required (array)');
  else if (tl.scenes.length === 0) errs.push('manifest.scenes: at least one scene required');
  else {
    tl.scenes.forEach((s, i) => {
      if (!s.id) errs.push(`manifest.scenes[${i}].id: required`);
      if (s.walkthrough && (!tl.walkthroughs || !tl.walkthroughs[s.walkthrough.id])) {
        errs.push(`manifest.scenes[${i}].walkthrough.id: "${s.walkthrough.id}" is not declared`);
      }
      if (!Array.isArray(s.vo)) errs.push(`manifest.scenes[${i}].vo: required (array)`);
      else {
        s.vo.forEach((turn, j) => {
          if (!turn.who) errs.push(`manifest.scenes[${i}].vo[${j}].who: required`);
          if (typeof turn.text !== 'string') errs.push(`manifest.scenes[${i}].vo[${j}].text: required`);
        });
      }
    });
  }
  if (tl.walkthroughs != null
      && (typeof tl.walkthroughs !== 'object' || Array.isArray(tl.walkthroughs))) {
    errs.push('manifest.walkthroughs: expected an object');
  }
  if (!Array.isArray(tl.deliverables)) errs.push('manifest.deliverables: required (array)');
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

const SENTENCE_SPLIT_RE = /(?<=[.?!۔؟]["'»)]*)\s+/;

function countSentencesPerTurn(vo) {
  return vo.map(t => {
    if (!t.text) return 1;
    const parts = t.text.split(SENTENCE_SPLIT_RE);
    const nonEmpty = parts.filter(p => p.trim());
    return nonEmpty.length || 1;
  });
}

/* ---- JSON round-trip helpers -------------------------------------------- */

function read(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function write(m, outPath) {
  fs.writeFileSync(outPath, JSON.stringify(m, null, 2));
}

module.exports = {
  MANIFEST_SCHEMA_VER,
  compile,
  validate,
  isValid,
  mergeTimings,
  sha256,
  hashFile,
  hashConfig,
  buildHashes,
  read,
  write,
};
