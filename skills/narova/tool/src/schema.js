'use strict';
/* Resolve + validate a project config into the shape the renderer/synth expect. */
const fs = require('fs');
const path = require('path');
const { resolveSize } = require('./util');

const DEFAULT_VOICE_COLORS = ['#2ee6d6', '#ff7eb6', '#ffd27a', '#46d98a'];
const DEFAULT_TIMING = { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: null };

/* Resolve a raw config (from reel.config.*) applying defaults + CLI overrides.
 * Returns { title, size:{w,h}, voices, theme, timing, scenes, assetsDir } and throws on
 * anything the pipeline can't render. */
function resolveConfig(raw, overrides = {}, baseDir = '.') {
  if (!raw || typeof raw !== 'object') throw new Error('config: expected an object');
  const errs = [];

  const title = raw.title || 'narova';
  let size = { w: 1280, h: 720 };
  try { size = resolveSize(overrides.size || raw.size); }
  catch (e) { errs.push(`config.size: ${e.message}`); }

  // Scene/voice ids land in element ids, CSS selectors, and getElementById —
  // anything outside this set breaks the composition silently (or worse,
  // escapes an attribute).
  const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

  // theme.css is a FILE reference (scene-layout classes), not a token — pull it out
  // of the token block (else it leaks as `--css:...`) and load its contents.
  const { css: cssRef, ...themeTokens } = raw.theme || {};
  let themeCss = '';
  if (cssRef) {
    const cssPath = path.resolve(baseDir, cssRef);
    if (!fs.existsSync(cssPath)) errs.push(`config.theme.css: file not found: ${cssPath}`);
    else themeCss = fs.readFileSync(cssPath, 'utf8');
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

  const timing = { ...DEFAULT_TIMING, ...(raw.timing || {}) };
  if (overrides.tempo != null) timing.tempo = Number(overrides.tempo);

  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
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
    if (!Array.isArray(s.vo) || s.vo.length === 0) errs.push(`${at}.vo: non-empty turn list required`);
    else s.vo.forEach((turn, j) => {
      if (!turn || !turn.who) errs.push(`${at}.vo[${j}].who: required`);
      else if (!voices[turn.who]) errs.push(`${at}.vo[${j}].who: "${turn.who}" not in config.voices`);
      if (typeof turn.text !== 'string' || !turn.text.trim()) errs.push(`${at}.vo[${j}].text: required`);
    });
    if (s.dur != null && typeof s.dur !== 'number') errs.push(`${at}.dur: must be a number`);
  });

  if (errs.length) throw new Error('Invalid config:\n  - ' + errs.join('\n  - '));

  // Fill a fallback duration for any scene missing one (player uses audio dur once synthed).
  scenes.forEach(s => { if (s.dur == null) s.dur = Math.max(6, (s.vo.length || 1) * 5); });

  return { title, size, voices, theme: themeTokens, themeCss, timing, scenes, assetsDir };
}

/* The narration.json contract for the Python TTS stage. */
function narration(config) {
  return config.scenes.map((s, i) => ({ n: i + 1, id: s.id, segments: s.vo }));
}

module.exports = { resolveConfig, narration };
