'use strict';
/* Resolve + validate a project config into the shape the renderer/synth expect. */
const fs = require('fs');
const path = require('path');
const { resolveSize, PLATFORMS, resolveVoiceSample } = require('./util');

const DEFAULT_VOICE_COLORS = ['#2ee6d6', '#ff7eb6', '#ffd27a', '#46d98a'];
const DEFAULT_TIMING = { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: null };
const TTS_BACKENDS = new Set(['piper', 'xtts', 'qwen', 'chatterbox']);
const CAPTION_PRESETS = new Set(['karaoke', 'slam', 'pop', 'rise']);
const ALIGN_ENGINES = new Set(['auto', 'faster-whisper', 'whisper-cpp']);

/* Resolve a raw config (from reel.config.*) applying defaults + CLI overrides.
 * Returns { title, size:{w,h}, voices, theme, mode, chrome, themeCss, timing,
 * scenes, assetsDir, projectDir, platform, bed, sfx, captions, align,
 * variants, variant } and throws on anything the pipeline can't render. */
function resolveConfig(raw, overrides = {}, baseDir = '.') {
  if (!raw || typeof raw !== 'object') throw new Error('config: expected an object');
  const errs = [];

  const title = raw.title || 'narova';
  // Platform preset (--platform / config.platform): picks the frame size when
  // no explicit size is set and carries the target duration band for `check`.
  // Precedence: --size > config.size > platform preset > 16:9 default.
  const platformName = overrides.platform ?? raw.platform ?? null;
  if (platformName != null && !PLATFORMS[platformName]) {
    errs.push(`config.platform: unknown platform ${JSON.stringify(platformName)} (${Object.keys(PLATFORMS).join('|')})`);
  }
  let size = { w: 1280, h: 720 };
  const sizeRef = overrides.size ?? raw.size ?? (platformName && PLATFORMS[platformName] ? PLATFORMS[platformName].size : undefined);
  try { size = resolveSize(sizeRef); }
  catch (e) { errs.push(`config.size: ${e.message}`); }

  // Scene/voice ids land in element ids, CSS selectors, and getElementById —
  // anything outside this set breaks the composition silently (or worse,
  // escapes an attribute).
  const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

  // theme.css is a FILE reference (scene-layout classes), not a token — pull it out
  // of the token block (else it leaks as `--css:...`) and load its contents.
  // `mode` is also a directive, not a color token: "light" flips the built-in
  // palette defaults (compose/css.js); user tokens still override them.
  const { css: cssRef, mode, ...themeTokens } = raw.theme || {};
  let themeCss = '';
  if (cssRef) {
    const cssPath = path.resolve(baseDir, cssRef);
    if (!fs.existsSync(cssPath)) errs.push(`config.theme.css: file not found: ${cssPath}`);
    else themeCss = fs.readFileSync(cssPath, 'utf8');
  }
  const themeMode = mode ?? 'dark';
  if (themeMode !== 'dark' && themeMode !== 'light') {
    errs.push(`config.theme.mode: expected "dark" or "light", got ${JSON.stringify(mode)}`);
  }

  // Chrome (topbar/counter/progress bar) is generated page furniture — on by
  // default, `chrome: false` removes all of it, an object tunes the pieces.
  let chrome = { topbar: true, counter: true, progress: true };
  if (raw.chrome === false) chrome = { topbar: false, counter: false, progress: false };
  else if (raw.chrome != null) {
    if (typeof raw.chrome !== 'object' || Array.isArray(raw.chrome)) {
      errs.push('config.chrome: expected false or an object like { topbar: true, counter: true, progress: true }');
    } else {
      for (const [k, v] of Object.entries(raw.chrome)) {
        if (!(k in chrome)) errs.push(`config.chrome.${k}: unknown key (topbar|counter|progress)`);
        else if (typeof v !== 'boolean') errs.push(`config.chrome.${k}: must be a boolean`);
        else chrome[k] = v;
      }
    }
  }

  // Project media is source, not build output. By convention an assets/
  // directory beside the config is copied into out/hf/assets/. A different
  // project-local directory can be selected with top-level `assets`.
  let assetsDir = null;
  const defaultAssets = path.resolve(baseDir, 'assets');
  const assetsRef = raw.assets ?? (fs.existsSync(defaultAssets) ? 'assets' : null);
  if (assetsRef != null) {
    if (typeof assetsRef !== 'string' || !assetsRef.trim()) {
      errs.push('config.assets: expected a non-empty project-relative directory path');
    } else {
      const candidate = path.resolve(baseDir, assetsRef);
      const rel = path.relative(path.resolve(baseDir), candidate);
      if (path.isAbsolute(assetsRef) || !rel || rel.startsWith(`..${path.sep}`) || rel === '..') {
        errs.push('config.assets: directory must be inside the project');
      } else if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
        errs.push(`config.assets: directory not found: ${candidate}`);
      } else {
        assetsDir = candidate;
      }
    }
  }

  // Theme token keys/values are interpolated into the generated stylesheet.
  Object.entries(themeTokens).forEach(([k, v]) => {
    if (!ID_RE.test(k)) errs.push(`config.theme.${k}: token name must match ${ID_RE}`);
    if (/[;{}<]/.test(String(v))) errs.push(`config.theme.${k}: value must not contain ; { } <`);
  });

  const voices = { ...(raw.voices || {}) };
  const voiceIds = Object.keys(voices);
  if (voiceIds.length === 0) errs.push('config.voices: at least one voice required');
  voiceIds.forEach(id => {
    if (!ID_RE.test(id)) errs.push(`config.voices.${id}: voice id must match ${ID_RE}`);
  });
  voiceIds.forEach((id, i) => {
    const v = voices[id] = { ...voices[id] };
    if (!v.color) v.color = DEFAULT_VOICE_COLORS[i % DEFAULT_VOICE_COLORS.length];
    if (!v.label) v.label = `narrator · ${id.toUpperCase()}`;
    if (!v.backend) v.backend = overrides.backend || 'piper';
  });
  // CLI voice overrides map onto the first two declared voices.
  if (overrides.voiceA && voiceIds[0]) voices[voiceIds[0]].speaker = overrides.voiceA;
  if (overrides.voiceB && voiceIds[1]) voices[voiceIds[1]].speaker = overrides.voiceB;
  if (overrides.backend) voiceIds.forEach(id => { voices[id].backend = overrides.backend; });
  voiceIds.forEach(id => {
    const v = voices[id];
    const at = `config.voices.${id}`;
    // Per-voice gain trim in dB — works for all backends.
    if (v.gainDb != null && (typeof v.gainDb !== 'number' || !Number.isFinite(v.gainDb)
        || v.gainDb < -24 || v.gainDb > 24)) {
      errs.push(`${at}.gainDb: must be a number from -24 to 24`);
    }
    if (!TTS_BACKENDS.has(v.backend)) {
      errs.push(`${at}.backend: unknown backend ${JSON.stringify(v.backend)} (piper|xtts|qwen|chatterbox)`);
    }
    if (v.backend !== 'chatterbox') return;
    const resolved = resolveVoiceSample(v.speaker);
    if (!resolved) {
      if (v.speaker && !path.isAbsolute(v.speaker)) {
        errs.push(`${at}.speaker: "${v.speaker}" is not a saved voice sample — use "narova voice sample add <file>" first, or provide an absolute path to a 10–20s recording`);
      } else {
        errs.push(`${at}.speaker: chatterbox requires a clone-recording path — use "narova voice sample add <file>" or set an absolute path`);
      }
    } else if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      errs.push(`${at}.speaker: clone recording not found: ${resolved}`);
    } else {
      // Store the resolved absolute path so the Python stage never sees a name.
      v.speaker = resolved;
    }
    for (const [key, min, max] of [['exaggeration', 0.25, 2.0], ['cfg_weight', 0.0, 1.0]]) {
      const value = v[key];
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) {
        errs.push(`${at}.${key}: must be a number from ${min} to ${max}`);
      }
    }
  });

  const timing = { ...DEFAULT_TIMING, ...(raw.timing || {}) };
  if (overrides.tempo != null) timing.tempo = Number(overrides.tempo);

  // Copy the scenes array: the variant swap below replaces scenes[0], and the
  // caller's raw config must never be mutated (the CLI re-resolves one raw
  // config for base + each variant in a --variants build).
  const scenes = Array.isArray(raw.scenes) ? raw.scenes.map(s => ({ ...s })) : [];
  if (scenes.length === 0) errs.push('config.scenes: at least one scene required');
  const seen = new Set();
  scenes.forEach((s, i) => {
    const at = `config.scenes[${i}]`;
    if (!s || typeof s !== 'object') { errs.push(`${at}: not an object`); return; }
    if (!s.id) errs.push(`${at}.id: required`);
    else if (!ID_RE.test(s.id)) errs.push(`${at}.id: "${s.id}" must match ${ID_RE}`);
    else if (seen.has(s.id)) errs.push(`${at}.id: duplicate "${s.id}"`);
    else seen.add(s.id);
    if (typeof s.body !== 'string') errs.push(`${at}.body: HTML string required`);
    if (!Array.isArray(s.vo)) {
      errs.push(`${at}.vo: turn list required`);
    } else if (s.vo.length === 0 && !(typeof s.dur === 'number' && Number.isFinite(s.dur) && s.dur > 0)) {
      errs.push(`${at}.vo: empty turn list requires a positive explicit dur for a silent scene`);
    } else s.vo.forEach((turn, j) => {
      if (!turn || !turn.who) errs.push(`${at}.vo[${j}].who: required`);
      else if (!voices[turn.who]) errs.push(`${at}.vo[${j}].who: "${turn.who}" not in config.voices`);
      if (typeof turn.text !== 'string' || !turn.text.trim()) errs.push(`${at}.vo[${j}].text: required`);
      // Per-turn language override for multilingual TTS (chatterbox/qwen).
      // Accepted but not validated against a list — the backend decides.
      if (turn.lang != null && typeof turn.lang !== 'string') {
        errs.push(`${at}.vo[${j}].lang: must be a language code string (e.g. "en", "ar", "ur")`);
      }
    });
    if (s.dur != null && typeof s.dur !== 'number') errs.push(`${at}.dur: must be a number`);
    // Optional b-roll video clip per scene: a project-relative video file
    // that plays looped behind the HTML overlay.
    if (s.clip != null) {
      if (typeof s.clip !== 'string' || !s.clip.trim()) {
        errs.push(`${at}.clip: must be a project-relative path to a video file`);
      } else {
        const clipPath = path.resolve(baseDir, s.clip);
        if (!fs.existsSync(clipPath) || !fs.statSync(clipPath).isFile()) {
          errs.push(`${at}.clip: file not found: ${clipPath}`);
        }
      }
    }
  });

  // Sound: an optional background bed plus spot SFX, mixed into the narration
  // track by the Python stage. Accepts `bed` or the legacy `music` key.
  let bed = null;
  const bedRaw = raw.bed ?? raw.music;
  if (bedRaw != null) {
    const m = bedRaw;
    if (typeof m !== 'object' || Array.isArray(m)) {
      errs.push('config.bed: expected an object like { file, volume, fadeIn, fadeOut }');
    } else if (typeof m.file !== 'string' || !m.file.trim()) {
      errs.push('config.bed.file: required (a project-relative audio file)');
    } else {
      const p = path.resolve(baseDir, m.file);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
        errs.push(`config.bed.file: not found: ${p}`);
      } else {
        bed = { file: p, volume: m.volume ?? 0.14, fadeIn: m.fadeIn ?? 0.5, fadeOut: m.fadeOut ?? 1.5 };
        for (const k of ['volume', 'fadeIn', 'fadeOut']) {
          const v = bed[k];
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            errs.push(`config.bed.${k}: must be a non-negative number`);
          }
        }
      }
    }
  }
  const sfx = [];
  if (raw.sfx != null) {
    if (!Array.isArray(raw.sfx)) {
      errs.push('config.sfx: expected an array like [{ file, scene, at, volume }]');
    } else raw.sfx.forEach((e, i) => {
      const at = `config.sfx[${i}]`;
      if (!e || typeof e !== 'object') { errs.push(`${at}: not an object`); return; }
      if (typeof e.file !== 'string' || !e.file.trim()) { errs.push(`${at}.file: required`); return; }
      const p = path.resolve(baseDir, e.file);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) { errs.push(`${at}.file: not found: ${p}`); return; }
      if (e.scene != null && !seen.has(e.scene)) {
        errs.push(`${at}.scene: "${e.scene}" is not a scene id — sfx anchors to a scene or, without one, to the global timeline`);
      }
      if (e.at != null && (typeof e.at !== 'number' || !Number.isFinite(e.at) || e.at < 0)) {
        errs.push(`${at}.at: must be a non-negative number of seconds`);
      }
      if (e.volume != null && (typeof e.volume !== 'number' || !Number.isFinite(e.volume) || e.volume < 0)) {
        errs.push(`${at}.volume: must be a non-negative number`);
      }
      sfx.push({ file: p, scene: e.scene ?? null, at: e.at ?? 0, volume: e.volume ?? 0.8 });
    });
  }

  // Captions: a karaoke style preset plus words to auto-emphasize (matched
  // case-insensitively, punctuation-stripped, against each spoken token).
  const captions = { preset: 'karaoke', emphasis: [], maxWords: null };
  if (raw.captions != null) {
    const c = raw.captions;
    if (typeof c !== 'object' || Array.isArray(c)) {
      errs.push('config.captions: expected an object like { preset, emphasis, maxWords }');
    } else {
      if (c.preset != null) {
        if (!CAPTION_PRESETS.has(c.preset)) {
          errs.push(`config.captions.preset: unknown preset ${JSON.stringify(c.preset)} (${[...CAPTION_PRESETS].join('|')})`);
        } else captions.preset = c.preset;
      }
      if (c.emphasis != null) {
        if (!Array.isArray(c.emphasis) || c.emphasis.some(w => typeof w !== 'string' || !w.trim())) {
          errs.push('config.captions.emphasis: expected an array of words');
        } else captions.emphasis = c.emphasis.map(w => w.trim());
      }
      if (c.maxWords != null) {
        if (!Number.isInteger(c.maxWords) || c.maxWords < 1 || c.maxWords > 30) {
          errs.push('config.captions.maxWords: expected an integer from 1 to 30');
        } else captions.maxWords = c.maxWords;
      }
    }
  }

  // Forced alignment: replace estimated word timings with measured ones
  // (narova_tts aligns each scene wav after synth; off by default).
  let align = false;
  if (raw.align != null) {
    if (typeof raw.align === 'boolean') align = raw.align ? { engine: 'auto' } : false;
    else if (typeof raw.align === 'object' && !Array.isArray(raw.align)) {
      const engine = raw.align.engine ?? 'auto';
      if (!ALIGN_ENGINES.has(engine)) {
        errs.push(`config.align.engine: unknown engine ${JSON.stringify(engine)} (${[...ALIGN_ENGINES].join('|')})`);
      } else align = { engine };
    } else errs.push('config.align: expected true/false or { engine }');
  }

  // Hook variants: alternative scene-1 definitions for A/B testing openers.
  // `narova build --variant <id>` swaps one in; the scene keeps the original
  // scene-1 id so timings keys and DOM ids stay stable across variants.
  const variants = [];
  if (raw.variants != null) {
    if (!Array.isArray(raw.variants)) {
      errs.push('config.variants: expected an array like [{ id, scene: { body, vo } }]');
    } else raw.variants.forEach((v, i) => {
      const at = `config.variants[${i}]`;
      if (!v || typeof v !== 'object') { errs.push(`${at}: not an object`); return; }
      if (typeof v.id !== 'string' || !ID_RE.test(v.id)) { errs.push(`${at}.id: must match ${ID_RE}`); return; }
      if (variants.some(x => x.id === v.id)) { errs.push(`${at}.id: duplicate "${v.id}"`); return; }
      const sc = v.scene;
      if (!sc || typeof sc !== 'object' || typeof sc.body !== 'string') {
        errs.push(`${at}.scene.body: HTML string required`); return;
      }
      if (!Array.isArray(sc.vo) || sc.vo.length === 0) { errs.push(`${at}.scene.vo: non-empty turn list required`); return; }
      let ok = true;
      sc.vo.forEach((turn, j) => {
        if (!turn || !turn.who || !voices[turn.who]) { errs.push(`${at}.scene.vo[${j}].who: ${turn && turn.who ? `"${turn.who}" not in config.voices` : 'required'}`); ok = false; }
        if (!turn || typeof turn.text !== 'string' || !turn.text.trim()) { errs.push(`${at}.scene.vo[${j}].text: required`); ok = false; }
      });
      if (ok) variants.push({ id: v.id, scene: { body: sc.body, vo: sc.vo, ...(sc.transition ? { transition: sc.transition } : {}) } });
    });
  }

  // Series: multi-part mode for long scripts split into numbered episodes.
  // `part` is 1-indexed; `total` is optional (unknown series length).
  // compose adds a "Part X/Y" badge overlay; no enforcement of cliffhangers.
  let series = null;
  if (raw.series != null) {
    if (typeof raw.series !== 'object' || Array.isArray(raw.series)) {
      errs.push('config.series: expected an object like { part, total }');
    } else {
      const part = raw.series.part;
      if (typeof part !== 'number' || !Number.isInteger(part) || part < 1) {
        errs.push('config.series.part: must be a positive integer (1-indexed)');
      }
      const total = raw.series.total;
      if (total != null && (typeof total !== 'number' || !Number.isInteger(total) || total < 1)) {
        errs.push('config.series.total: must be a positive integer');
      } else if (total != null && part != null && part > total) {
        errs.push(`config.series.part: ${part} exceeds total ${total}`);
      }
      if (part != null) series = { part, total: total ?? null };
    }
  }

  if (errs.length) throw new Error('Invalid config:\n  - ' + errs.join('\n  - '));

  // Fill a fallback duration for any scene missing one (player uses audio dur once synthed).
  scenes.forEach(s => { if (s.dur == null) s.dur = Math.max(6, (s.vo.length || 1) * 5); });

  // --variant <id>: swap the variant's scene in as scene 1 (keeping its id).
  let variant = null;
  if (overrides.variant != null) {
    const v = variants.find(x => x.id === overrides.variant);
    if (!v) {
      const ids = variants.map(x => x.id).join(', ') || '(none declared)';
      throw new Error(`unknown variant "${overrides.variant}" — declared variants: ${ids}`);
    }
    variant = v.id;
    scenes[0] = { ...scenes[0], body: v.scene.body, vo: v.scene.vo, ...(v.scene.transition ? { transition: v.scene.transition } : {}) };
  }

  return { title, size, voices, theme: themeTokens, mode: themeMode, chrome, themeCss, timing, scenes, assetsDir, projectDir: path.resolve(baseDir), platform: platformName, bed, sfx, captions, align, variants, variant, series };
}

/* The narration.json contract for the Python TTS stage. */
function narration(config) {
  return config.scenes.map((s, i) => ({
    n: i + 1,
    id: s.id,
    segments: s.vo,
    ...(s.vo.length === 0 ? { dur: s.dur } : {}),
  }));
}

module.exports = { resolveConfig, narration };
