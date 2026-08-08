'use strict';
/* Resolve + validate a project config into the shape the renderer/synth expect. */
const fs = require('fs');
const path = require('path');
const { resolveSize, PLATFORMS, resolveVoiceSample } = require('./util');
const { isBuiltinBackend, backendHint } = require('./tts-backends');
const {
  getProvider, jsonCompatibilityError, containsRequiredEnvironmentValue,
} = require('./providers');
const { resolveWalkthroughs } = require('./walkthrough');
const { validateVisual, validateThreeConfig } = require('./renderers/visual');
const { validateElements, resolveElementsScene } = require('./compose/elements');

const DEFAULT_VOICE_COLORS = ['#2ee6d6', '#ff7eb6', '#ffd27a', '#46d98a'];
const DEFAULT_TIMING = { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: null };
const CAPTION_PRESETS = new Set(['subtitle', 'karaoke', 'slam', 'pop', 'rise']);
const ALIGN_ENGINES = new Set(['auto', 'faster-whisper', 'whisper-cpp']);

/* Resolve a raw config (from reel.config.*) applying defaults + CLI overrides.
 * Returns { title, size:{w,h}, voices, theme, mode, chrome, themeCss, choreography,
 * choreographyPath, timing, scenes, walkthroughs, assetsDir, projectDir, platform,
 * bed, sfx, captions, align, variants, variant } and throws on anything the
 * pipeline can't render. */
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

  // Rendering is a separate provider axis from TTS. Both bundled providers
  // are local; HyperFrames remains the default for unrestricted HTML/CSS,
  // while no-browser consumes the browserless scene.visual contract.
  let renderer = overrides.renderer ?? raw.renderer ?? 'hyperframes';
  if (renderer && typeof renderer === 'object' && !Array.isArray(renderer)) renderer = renderer.provider;
  if (renderer !== 'hyperframes' && renderer !== 'no-browser') {
    errs.push(`config.renderer: unknown renderer ${JSON.stringify(renderer)} (hyperframes|no-browser)`);
  }

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

  // patterns: include the built-in Narova layout pattern classes (.s-title,
  // .pane, .stat, .flow, .verdicts, .s-close, etc.) in the default CSS.
  // Defaults to false — Narova is zero-style by default. Set to true to
  // opt into the built-in layout vocabulary as a deliberate creative choice.
  let includePatterns = false;
  if (raw.patterns != null) {
    if (typeof raw.patterns !== 'boolean') {
      errs.push('config.patterns: expected a boolean (true to include built-in layout classes)');
    } else includePatterns = raw.patterns;
  }

  // choreography is a FILE reference too — project timeline code, inlined into
  // the composition after the built-in animators (compose/html.js). Resolved
  // exactly like theme.css: local path, read here, no remote fetch introduced.
  // The path is carried alongside the contents so `check` can report what it
  // could not read on a config that was not built by this function.
  let choreography = '';
  let choreographyPath = null;
  if (raw.choreography != null) {
    if (typeof raw.choreography !== 'string') {
      errs.push(`config.choreography: expected a file path relative to the config, got ${JSON.stringify(raw.choreography)}`);
    } else {
      choreographyPath = path.resolve(baseDir, raw.choreography);
      if (!fs.existsSync(choreographyPath)) errs.push(`config.choreography: file not found: ${choreographyPath}`);
      else choreography = fs.readFileSync(choreographyPath, 'utf8');
    }
  }

  // --- file-reference resolution helper -----------------------------------
  // Resolve a local relative-path file reference into inlined contents.
  // Returns { contents, resolvedPath } or null on failure (pushes to errs).
  // Used for scene bodyFile, cssFile, choreographyFile, threeFile,
  // elementsFile, visualFile; also for config.imports entries.
  function resolveFileRef(label, ref, extHint) {
    if (typeof ref !== 'string' || !ref.trim()) {
      errs.push(`${label}: expected a project-relative file path`);
      return null;
    }
    // Disallow absolute and parent-traversal paths.
    if (path.isAbsolute(ref) || ref.startsWith(`..${path.sep}`) || ref.includes(`..${path.sep}`)) {
      errs.push(`${label}: "${ref}" — path must be inside the project`);
      return null;
    }
    // Disallow remote URLs.
    if (/^(?:https?:)?\/\//i.test(ref)) {
      errs.push(`${label}: "${ref}" — remote URLs are not allowed, use a local file`);
      return null;
    }
    const resolved = path.resolve(baseDir, ref);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      errs.push(`${label}: file not found: ${resolved}`);
      return null;
    }
    try {
      const contents = fs.readFileSync(resolved, 'utf8');
      return { contents, resolvedPath: resolved };
    } catch (e) {
      errs.push(`${label}: cannot read file: ${e.message}`);
      return null;
    }
  }

  // --- imports: reusable local module references --------------------------
  // `config.imports` is a map of name → project-relative file. Each entry is
  // resolved to inlined contents and stored in config.imports. Consumed by
  // scene resolution and compose. Hashed for build invalidation.
  const imports = {};
  if (raw.imports != null) {
    if (typeof raw.imports !== 'object' || Array.isArray(raw.imports)) {
      errs.push('config.imports: expected an object of { name: relative-path }');
    } else {
      for (const [name, ref] of Object.entries(raw.imports)) {
        if (!ID_RE.test(name)) {
          errs.push(`config.imports.${name}: import name must match ${ID_RE}`);
          continue;
        }
        const resolved = resolveFileRef(`config.imports.${name}`, ref);
        if (resolved) imports[name] = { file: ref, contents: resolved.contents };
      }
    }
  }

  // Chrome (topbar/counter/progress bar) — off by default. Chrome is page
  // furniture, a creative/aesthetic choice, not production infrastructure.
  // Set `chrome: true` or `chrome: { topbar: true, ... }` to opt in.
  let chrome = { topbar: false, counter: false, progress: false };
  if (raw.chrome === true) chrome = { topbar: true, counter: true, progress: true };
  else if (raw.chrome === false) chrome = { topbar: false, counter: false, progress: false };
  else if (raw.chrome != null) {
    if (typeof raw.chrome !== 'object' || Array.isArray(raw.chrome)) {
      errs.push('config.chrome: expected false, true, or an object like { topbar: true, counter: true, progress: true }');
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
  // Voices are optional when every scene is silent; turn.who references will
  // still be validated against voices when the scene has any vo turns.
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
    const optionsError = v.providerOptions == null
      ? null
      : (typeof v.providerOptions !== 'object' || Array.isArray(v.providerOptions)
        ? `${at}.providerOptions: expected a JSON-compatible object`
        : jsonCompatibilityError(v.providerOptions, `${at}.providerOptions`));
    if (optionsError) errs.push(optionsError);

    if (!isBuiltinBackend(v.backend)) {
      let provider = null;
      try { provider = getProvider(v.backend); }
      catch (e) { errs.push(`${at}.backend: registered provider is invalid: ${e.message}`); }
      if (!provider) {
        errs.push(`${at}.backend: unknown backend ${JSON.stringify(v.backend)} (unregistered external provider; built-ins: ${backendHint()}; register with "narova providers add <manifest>")`);
      } else {
        if (v.providerOptions != null
            && containsRequiredEnvironmentValue(v.providerOptions, provider)) {
          errs.push(`${at}.providerOptions: must not contain a value from the provider's required environment; keep secrets out of reel.config.mjs`);
        }
        // Generic provider metadata travels with the resolved config so the
        // Python sentence cache and manifest can include implementation
        // version changes without importing provider code.
        v.providerProtocol = provider.protocol;
        v.providerVersion = provider.providerVersion || '';
        if (v.providerOptions == null) v.providerOptions = {};
      }
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

  const characters = { ...(raw.characters || {}) };
  Object.keys(characters).forEach(id => {
    if (!ID_RE.test(id)) errs.push(`config.characters.${id}: character id must match ${ID_RE}`);
    const c = characters[id];
    if (!c || typeof c !== 'object') { errs.push(`config.characters.${id}: expected an object`); return; }
    if (!Array.isArray(c.parts) && !c.model && !c.src) {
      errs.push(`config.characters.${id}: needs a model/src file or a parts array`);
    }
    if (c.parts != null && !Array.isArray(c.parts)) {
      errs.push(`config.characters.${id}.parts: expected an array`);
    }
    if (c.model) {
      const mp = path.resolve(baseDir, c.model);
      if (!fs.existsSync(mp) || !fs.statSync(mp).isFile()) errs.push(`config.characters.${id}.model: file not found: ${mp}`);
    }
    if (c.src) {
      const sp = path.resolve(baseDir, c.src);
      if (!fs.existsSync(sp) || !fs.statSync(sp).isFile()) errs.push(`config.characters.${id}.src: file not found: ${sp}`);
    }
    if (c.voice && !voices[c.voice]) errs.push(`config.characters.${id}.voice: "${c.voice}" not in config.voices`);
  });

  const timing = { ...DEFAULT_TIMING, ...(raw.timing || {}) };
  if (overrides.tempo != null) timing.tempo = Number(overrides.tempo);

  // Copy the scenes array: the variant swap below replaces scenes[0], and the
  // caller's raw config must never be mutated (the CLI re-resolves one raw
  // config for base + each variant in a --variants build).
  const scenes = Array.isArray(raw.scenes) ? raw.scenes.map(s => ({
    ...s,
    // Preserve duration provenance before narrated scenes receive the schema's
    // pre-synth planning fallback. Release readiness must not confuse the two.
    _durAuthored: typeof s.dur === 'number' && Number.isFinite(s.dur) && s.dur > 0,
  })) : [];
  if (scenes.length === 0) errs.push('config.scenes: at least one scene required');

  // Resolve scene file references (bodyFile, threeFile, etc.) BEFORE validation
  // so the resolved contents satisfy the body/three/elements requirement check.
  const sceneFileRefs = []; // [{ sceneIndex, key, file }]
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const sat = `config.scenes[${i}]`;

    if (s.bodyFile != null) {
      if (typeof s.bodyFile !== 'string') {
        errs.push(`${sat}.bodyFile: expected a project-relative file path`);
      } else {
        const r = resolveFileRef(`${sat}.bodyFile`, s.bodyFile);
        if (r) { s.body = r.contents; sceneFileRefs.push({ sceneIndex: i, key: 'bodyFile', file: s.bodyFile }); delete s.bodyFile; }
      }
    }
    if (s.threeFile != null) {
      if (typeof s.threeFile !== 'string') {
        errs.push(`${sat}.threeFile: expected a project-relative JSON file path`);
      } else {
        const r = resolveFileRef(`${sat}.threeFile`, s.threeFile);
        if (r) { try { s.three = JSON.parse(r.contents); sceneFileRefs.push({ sceneIndex: i, key: 'threeFile', file: s.threeFile }); delete s.threeFile; } catch (e) { errs.push(`${sat}.threeFile: invalid JSON: ${e.message}`); } }
      }
    }
    // scene.threeModule: the raw Three.js escape hatch. A project-relative JS
    // file whose body is inlined into the deterministic 3D bootstrap with
    // THREE, scene, camera, renderer, tl (GSAP timeline), seed, size, duration,
    // assets(), onRender(), and narova helpers in scope. Same determinism
    // contract as choreography (no Date/Math.random/rAF/setTimeout/fetch).
    // Use this for custom shaders, procedural geometry, post-processing, and
    // any 3D that the declarative scene.three vocabulary cannot express.
    if (s.threeModule != null) {
      if (typeof s.threeModule !== 'string') {
        errs.push(`${sat}.threeModule: expected a project-relative JS file path`);
      } else {
        const r = resolveFileRef(`${sat}.threeModule`, s.threeModule);
        if (r) { s._threeModuleContents = r.contents; sceneFileRefs.push({ sceneIndex: i, key: 'threeModule', file: s.threeModule }); delete s.threeModule; }
      }
    }
    if (s.elementsFile != null) {
      if (typeof s.elementsFile !== 'string') {
        errs.push(`${sat}.elementsFile: expected a project-relative JSON file path`);
      } else {
        const r = resolveFileRef(`${sat}.elementsFile`, s.elementsFile);
        if (r) { try { s.elements = JSON.parse(r.contents); sceneFileRefs.push({ sceneIndex: i, key: 'elementsFile', file: s.elementsFile }); delete s.elementsFile; } catch (e) { errs.push(`${sat}.elementsFile: invalid JSON: ${e.message}`); } }
      }
    }
    if (s.visualFile != null) {
      if (typeof s.visualFile !== 'string') {
        errs.push(`${sat}.visualFile: expected a project-relative JSON file path`);
      } else {
        const r = resolveFileRef(`${sat}.visualFile`, s.visualFile);
        if (r) { try { s.visual = JSON.parse(r.contents); sceneFileRefs.push({ sceneIndex: i, key: 'visualFile', file: s.visualFile }); delete s.visualFile; } catch (e) { errs.push(`${sat}.visualFile: invalid JSON: ${e.message}`); } }
      }
    }
    if (s.cssFile != null) {
      if (typeof s.cssFile !== 'string') {
        errs.push(`${sat}.cssFile: expected a project-relative file path`);
      } else {
        const r = resolveFileRef(`${sat}.cssFile`, s.cssFile);
        if (r) { s._cssFileContents = r.contents; sceneFileRefs.push({ sceneIndex: i, key: 'cssFile', file: s.cssFile }); delete s.cssFile; }
      }
    }
    if (s.choreographyFile != null) {
      if (typeof s.choreographyFile !== 'string') {
        errs.push(`${sat}.choreographyFile: expected a project-relative file path`);
      } else {
        const r = resolveFileRef(`${sat}.choreographyFile`, s.choreographyFile);
        if (r) { s._choreographyFileContents = r.contents; sceneFileRefs.push({ sceneIndex: i, key: 'choreographyFile', file: s.choreographyFile }); delete s.choreographyFile; }
      }
    }
    if (s.scriptFile != null) {
      if (typeof s.scriptFile !== 'string') {
        errs.push(`${sat}.scriptFile: expected a project-relative JS file path`);
      } else {
        const r = resolveFileRef(`${sat}.scriptFile`, s.scriptFile);
        if (r) { s._scriptFileContents = r.contents; sceneFileRefs.push({ sceneIndex: i, key: 'scriptFile', file: s.scriptFile }); delete s.scriptFile; }
      }
    }
  }

  const seen = new Set();
  scenes.forEach((s, i) => {
    const at = `config.scenes[${i}]`;
    if (!s || typeof s !== 'object') { errs.push(`${at}: not an object`); return; }
    if (!s.id) errs.push(`${at}.id: required`);
    else if (!ID_RE.test(s.id)) errs.push(`${at}.id: "${s.id}" must match ${ID_RE}`);
    else if (seen.has(s.id)) errs.push(`${at}.id: duplicate "${s.id}"`);
    else seen.add(s.id);
    if (typeof s.body !== 'string' && (!s.visual || typeof s.visual !== 'object' || Array.isArray(s.visual))
        && (!s.three || typeof s.three !== 'object' || Array.isArray(s.three))
        && (!s.elements || !Array.isArray(s.elements))
        && !s._threeModuleContents) {
      errs.push(`${at}.body: HTML string required unless a visual, three, threeModule, or elements object is provided. Drop to a lower-level surface: use elements for common 3D, scene.three for explicit Three.js, scene.threeModule for raw WebGL/Three.js, or scene.visual for the portable renderer contract.`);
    }
    if (s.body != null && typeof s.body !== 'string' && s.visual && typeof s.visual === 'object' && !Array.isArray(s.visual)) {
      errs.push(`${at}.body: must be an HTML string when provided`);
    }
    if (s.visual != null) errs.push(...validateVisual(s.visual, `${at}.visual`));
    if (!Array.isArray(s.vo)) {
      errs.push(`${at}.vo: turn list required`);
    } else if (s.vo.length === 0 && !(typeof s.dur === 'number' && Number.isFinite(s.dur) && s.dur > 0)) {
      errs.push(`${at}.vo: empty turn list requires a positive explicit dur for a silent scene`);
    } else s.vo.forEach((turn, j) => {
      if (!turn || !turn.who) errs.push(`${at}.vo[${j}].who: required`);
      else if (!voices[turn.who]) errs.push(`${at}.vo[${j}].who: "${turn.who}" not in config.voices`);
      if (typeof turn.text !== 'string' || !turn.text.trim()) errs.push(`${at}.vo[${j}].text: required`);
      // Optional synthesis text: sent to TTS instead of text when present.
      // Used by external providers for performance tags that must not appear in captions.
      if (turn.synthesisText != null && (typeof turn.synthesisText !== 'string' || !turn.synthesisText.trim())) {
        errs.push(`${at}.vo[${j}].synthesisText: must be a non-empty string`);
      }
      // Per-turn language override for multilingual TTS (chatterbox/qwen/xtts).
      // Accepted but not validated against a list — the backend decides.
      if (turn.lang != null && typeof turn.lang !== 'string') {
        errs.push(`${at}.vo[${j}].lang: must be a language code string (e.g. "en", "ar", "ur")`);
      }
    });
    if (s.dur != null && !(typeof s.dur === 'number' && Number.isFinite(s.dur) && s.dur > 0)) {
      errs.push(`${at}.dur: when provided, must be a positive finite number`);
    }
    if (s.elements != null) {
      validateElements(s.elements, `${at}`, errs);
    }
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
    if (s.three != null) {
      if (typeof s.three !== 'object' || Array.isArray(s.three)) {
        errs.push(`${at}.three: expected an object with 3D scene config`);
      } else {
        validateThreeConfig(s.three, `${at}.three`, errs);
        function validateThreeAsset(ref, where) {
          if (typeof ref !== 'string' || !ref) return;
          if (/^(?:https?:)?\/\//i.test(ref) || path.isAbsolute(ref)) {
            errs.push(`${where}: expected a project-relative asset path`);
            return;
          }
          const assetPath = path.resolve(baseDir, ref);
          if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
            errs.push(`${where}: file not found: ${assetPath}`);
          }
        }
        const env = typeof s.three.envMap === 'string' ? s.three.envMap : s.three.envMap?.src;
        if (env) validateThreeAsset(env, `${at}.three.envMap.src`);
        function validateObjectAssets(obj, where) {
          if (obj.type === 'model' && obj.src) validateThreeAsset(obj.src, `${where}.src`);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'texture']) {
            if (obj[key]) validateThreeAsset(obj[key], `${where}.${key}`);
          }
          (obj.children || []).forEach((child, ci) => validateObjectAssets(child, `${where}.children[${ci}]`));
        }
        (s.three.objects || []).forEach((obj, oi) => validateObjectAssets(obj, `${at}.three.objects[${oi}]`));
      }
    }
  });

  // External narration: use a pre-recorded audio file instead of TTS synthesis.
  // When set, synth copies this file as the narration track (no TTS run).
  // Optional wordTimings: a project-relative JSON file with per-word start/end
  // times for karaoke captions (generates in-story caption overlays during compose).
  // Format: [{ start, end, text, words: [{ text, start, end }] }].
  // Optional process: voice cleanup settings applied to the external audio before mixing.
  let narrationSource = null;
  if (raw.narration != null) {
    const n = raw.narration;
    if (typeof n !== 'object' || Array.isArray(n)) {
      errs.push('config.narration: expected an object like { file, wordTimings?, process? }');
    } else if (typeof n.file !== 'string' || !n.file.trim()) {
      errs.push('config.narration.file: required (a project-relative audio file)');
    } else {
      const np = path.resolve(baseDir, n.file);
      if (!fs.existsSync(np) || !fs.statSync(np).isFile()) {
        errs.push(`config.narration.file: not found: ${np}`);
      } else {
        narrationSource = { file: np };
        if (n.wordTimings != null) {
          if (typeof n.wordTimings !== 'string' || !n.wordTimings.trim()) {
            errs.push('config.narration.wordTimings: must be a project-relative JSON file path');
          } else {
            const wp = path.resolve(baseDir, n.wordTimings);
            if (!fs.existsSync(wp) || !fs.statSync(wp).isFile()) {
              errs.push(`config.narration.wordTimings: not found: ${wp}`);
            } else {
              try {
                const karaokeData = JSON.parse(fs.readFileSync(wp, 'utf8'));
                if (!Array.isArray(karaokeData)) {
                  errs.push('config.narration.wordTimings: JSON must be an array of cues');
                } else {
                  for (let ci = 0; ci < karaokeData.length; ci++) {
                    const cue = karaokeData[ci];
                    if (!cue || typeof cue !== 'object') {
                      errs.push(`config.narration.wordTimings[${ci}]: not an object`);
                    } else {
                      if (typeof cue.start !== 'number' || typeof cue.end !== 'number'
                          || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start) {
                        errs.push(`config.narration.wordTimings[${ci}]: start/end must be finite and end must be after start`);
                      }
                      if (typeof cue.text !== 'string' || !cue.text.trim()) {
                        errs.push(`config.narration.wordTimings[${ci}].text: non-empty transcript text required`);
                      }
                      if (!Array.isArray(cue.words)) {
                        errs.push(`config.narration.wordTimings[${ci}]: words must be an array`);
                      } else {
                        cue.words.forEach((word, wi) => {
                          const wat = `config.narration.wordTimings[${ci}].words[${wi}]`;
                          if (!word || typeof word !== 'object' || Array.isArray(word)) {
                            errs.push(`${wat}: expected an object`); return;
                          }
                          if (typeof (word.text || word.w) !== 'string' || !(word.text || word.w).trim()) {
                            errs.push(`${wat}.text: non-empty word required`);
                          }
                          if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) {
                            errs.push(`${wat}: start/end must be finite and end must be after start`);
                          }
                        });
                      }
                    }
                  }
                  const normalized = value => String(value || '').normalize('NFKC')
                    .toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
                  const scriptText = normalized(scenes.flatMap(scene => scene.vo.map(turn => turn.text)).join(' '));
                  const transcriptText = normalized(karaokeData.map(cue => cue && cue.text).join(' '));
                  if (scriptText && transcriptText && scriptText !== transcriptText) {
                    errs.push('config.narration.wordTimings: transcript text does not match scene voiceover — captions would not match the declared narration');
                  }
                  narrationSource.wordTimingsPath = wp;
                  narrationSource.wordTimings = karaokeData;
                }
              } catch (e) {
                errs.push(`config.narration.wordTimings: invalid JSON: ${e.message}`);
              }
            }
          }
        }
        // Audio processing: optional voice cleanup chain applied to external narration.
        if (n.process != null) {
          if (typeof n.process !== 'object' || Array.isArray(n.process)) {
            errs.push('config.narration.process: expected an object with optional filter settings');
          } else {
            const proc = {};
            if (n.process.loudness != null) {
              if (typeof n.process.loudness !== 'object' || Array.isArray(n.process.loudness)) {
                errs.push('config.narration.process.loudness: expected { target, peak, lra }');
              } else {
                const t = +n.process.loudness.target || -16;
                const p = +n.process.loudness.peak || -1.5;
                const l = +n.process.loudness.lra || 11;
                if (!Number.isFinite(t) || t > 0) errs.push('config.narration.process.loudness.target: must be ≤ 0');
                if (!Number.isFinite(p) || p > 0) errs.push('config.narration.process.loudness.peak: must be ≤ 0');
                if (!Number.isFinite(l) || l < 1 || l > 50) errs.push('config.narration.process.loudness.lra: must be 1–50');
                proc.loudness = { target: t, peak: p, lra: l };
              }
            }
            if (n.process.highpass != null) {
              const v = +n.process.highpass;
              if (!Number.isFinite(v) || v < 20 || v > 500) errs.push('config.narration.process.highpass: must be 20–500 Hz');
              else proc.highpass = v;
            }
            if (n.process.lowpass != null) {
              const v = +n.process.lowpass;
              if (!Number.isFinite(v) || v < 1000 || v > 20000) errs.push('config.narration.process.lowpass: must be 1000–20000 Hz');
              else proc.lowpass = v;
            }
            if (n.process.compressor != null) {
              if (typeof n.process.compressor !== 'object' || Array.isArray(n.process.compressor)) {
                errs.push('config.narration.process.compressor: expected { threshold, ratio }');
              } else {
                const th = +n.process.compressor.threshold || 0.14;
                const ra = +n.process.compressor.ratio || 2;
                if (!Number.isFinite(th) || th < 0.01 || th > 1) errs.push('config.narration.process.compressor.threshold: must be 0.01–1');
                if (!Number.isFinite(ra) || ra < 1 || ra > 20) errs.push('config.narration.process.compressor.ratio: must be 1–20');
                proc.compressor = { threshold: th, ratio: ra };
              }
            }
            narrationSource.process = Object.keys(proc).length ? proc : null;
          }
        }
      }
    }
  }

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
  // Set `captions: false` to disable the visual caption band entirely —
  // SRT/VTT sidecars are still exported for accessibility and embed use.
  let captions = { preset: 'subtitle', emphasis: [], maxWords: null };
  let captionsEnabled = true;
  if (raw.captions === false) {
    captionsEnabled = false;
  } else if (raw.captions != null) {
    const c = raw.captions;
    if (typeof c !== 'object' || Array.isArray(c)) {
      errs.push('config.captions: expected an object like { preset, emphasis, maxWords } or false to disable');
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

  // Hook variants: experimental directions derived from the base project.
  // Each variant inherits everything from the base and selectively overrides
  // specific surfaces. Supported kinds:
  //   "hook"     — alternative opening scene (default)
  //   "visual"   — different theme tokens or chrome
  //   "narration" — different voiceover text or casting
  //   "pacing"   — different timing (tempo, gaps)
  //   "captions" — different caption preset or emphasis
  //   "opening"  — legacy alias for "hook"
  // A variant may combine multiple overrides. Scene overrides target specific
  // scenes by id and support body, vo, visual, elements, three, and transition.
  // `narova build --variant <id>` selects one; `--variants` builds all.
  const VARIANT_KINDS = new Set(['hook', 'visual', 'narration', 'pacing', 'captions', 'opening']);
  const variants = [];
  if (raw.variants != null) {
    if (!Array.isArray(raw.variants)) {
      errs.push('config.variants: expected an array like [{ id, kind?, scene?, theme?, captions?, timing?, sceneOverrides? }]');
    } else raw.variants.forEach((v, i) => {
      const at = `config.variants[${i}]`;
      if (!v || typeof v !== 'object') { errs.push(`${at}: not an object`); return; }
      if (typeof v.id !== 'string' || !ID_RE.test(v.id)) { errs.push(`${at}.id: must match ${ID_RE}`); return; }
      if (variants.some(x => x.id === v.id)) { errs.push(`${at}.id: duplicate "${v.id}"`); return; }

      const kind = v.kind || 'hook';
      if (!VARIANT_KINDS.has(kind)) {
        errs.push(`${at}.kind: expected ${[...VARIANT_KINDS].join('|')}, got "${kind}"`);
        return;
      }

      // Legacy scene shorthand: { scene: { body, vo, ... } } replaces scene-1.
      // New sceneOverrides: { [sceneId]: { body?, vo?, visual?, elements?, three?, transition? } }
      const hasLegacyScene = !!(v.scene && typeof v.scene === 'object');
      const hasSceneOverrides = !!(v.sceneOverrides && typeof v.sceneOverrides === 'object' && !Array.isArray(v.sceneOverrides));

      if (hasLegacyScene) {
        const sc = v.scene;
        if (typeof sc.body !== 'string' && (!sc.visual || typeof sc.visual !== 'object' || Array.isArray(sc.visual)) && !sc.three) {
          errs.push(`${at}.scene: body HTML string, visual object, or three config required`); return;
        }
        if (sc.visual != null) errs.push(...validateVisual(sc.visual, `${at}.scene.visual`));
        if (!Array.isArray(sc.vo) || sc.vo.length === 0) { errs.push(`${at}.scene.vo: non-empty turn list required`); return; }
        let ok = true;
        sc.vo.forEach((turn, j) => {
          if (!turn || !turn.who || !voices[turn.who]) { errs.push(`${at}.scene.vo[${j}].who: ${turn && turn.who ? `"${turn.who}" not in config.voices` : 'required'}`); ok = false; }
          if (!turn || typeof turn.text !== 'string' || !turn.text.trim()) { errs.push(`${at}.scene.vo[${j}].text: required`); ok = false; }
          if (turn && turn.synthesisText != null && (typeof turn.synthesisText !== 'string' || !turn.synthesisText.trim())) {
            errs.push(`${at}.scene.vo[${j}].synthesisText: must be a non-empty string`); ok = false;
          }
        });
        if (!ok) return;
      }

      let sceneOverrides = null;
      if (hasSceneOverrides) {
        sceneOverrides = {};
        for (const [sid, so] of Object.entries(v.sceneOverrides)) {
          if (!so || typeof so !== 'object') {
            errs.push(`${at}.sceneOverrides.${sid}: expected an object `); continue;
          }
          const entry = {};
          if (so.body != null) {
            if (typeof so.body !== 'string') { errs.push(`${at}.sceneOverrides.${sid}.body: must be an HTML string`); continue; }
            entry.body = so.body;
          }
          if (so.visual != null) {
            if (typeof so.visual !== 'object' || Array.isArray(so.visual)) { errs.push(`${at}.sceneOverrides.${sid}.visual: must be a visual tree object`); continue; }
            entry.visual = so.visual;
          }
          if (so.vo != null) {
            if (!Array.isArray(so.vo)) { errs.push(`${at}.sceneOverrides.${sid}.vo: expected a turn array`); continue; }
            entry.vo = so.vo;
          }
          if (so.three != null) {
            if (typeof so.three !== 'object' || Array.isArray(so.three)) { errs.push(`${at}.sceneOverrides.${sid}.three: must be a three config object`); continue; }
            entry.three = so.three;
          }
          if (so.elements != null) {
            if (!Array.isArray(so.elements)) { errs.push(`${at}.sceneOverrides.${sid}.elements: expected an array`); continue; }
            entry.elements = so.elements;
          }
          if (so.transition != null) entry.transition = so.transition;
          sceneOverrides[sid] = entry;
        }
      }

      // Validate theme overrides
      let themeOverride = null;
      if (v.theme != null) {
        if (typeof v.theme !== 'object' || Array.isArray(v.theme)) {
          errs.push(`${at}.theme: expected an object of token overrides`);
        } else {
          themeOverride = {};
          for (const [tk, tv] of Object.entries(v.theme)) {
            if (!ID_RE.test(tk)) errs.push(`${at}.theme.${tk}: token name must match ${ID_RE}`);
            if (/[;{}<]/.test(String(tv))) errs.push(`${at}.theme.${tk}: value must not contain ; { } <`);
            themeOverride[tk] = tv;
          }
        }
      }

      // Validate captions override
      let captionsOverride = null;
      if (v.captions != null) {
        if (typeof v.captions !== 'object' || Array.isArray(v.captions)) {
          errs.push(`${at}.captions: expected an object like { preset, emphasis }`);
        } else {
          captionsOverride = {};
          if (v.captions.preset != null) {
            if (!CAPTION_PRESETS.has(v.captions.preset)) {
              errs.push(`${at}.captions.preset: unknown preset "${v.captions.preset}"`);
            } else captionsOverride.preset = v.captions.preset;
          }
          if (v.captions.emphasis != null) {
            if (!Array.isArray(v.captions.emphasis)) {
              errs.push(`${at}.captions.emphasis: expected an array of words`);
            } else captionsOverride.emphasis = v.captions.emphasis;
          }
        }
      }

      // Validate timing override
      let timingOverride = null;
      if (v.timing != null) {
        if (typeof v.timing !== 'object' || Array.isArray(v.timing)) {
          errs.push(`${at}.timing: expected an object like { tempo, gapSentence, gapTurn, lead, tail }`);
        } else {
          timingOverride = {};
          const timingKeys = ['gapSentence', 'gapTurn', 'lead', 'tail', 'tempo'];
          for (const tk of timingKeys) {
            if (v.timing[tk] != null) timingOverride[tk] = v.timing[tk];
          }
        }
      }

      variants.push({
        id: v.id, kind,
        ...(hasLegacyScene ? { scene: {
          ...(typeof v.scene.body === 'string' ? { body: v.scene.body } : {}),
          ...(v.scene.visual ? { visual: v.scene.visual } : {}),
          ...(v.scene.three ? { three: v.scene.three } : {}),
          vo: v.scene.vo,
          ...(v.scene.transition ? { transition: v.scene.transition } : {}),
        } } : {}),
        ...(sceneOverrides ? { sceneOverrides } : {}),
        ...(themeOverride ? { theme: themeOverride } : {}),
        ...(captionsOverride ? { captions: captionsOverride } : {}),
        ...(timingOverride ? { timing: timingOverride } : {}),
      });
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

  // --variant <id>: apply the selected variant's overrides to the base config.
  // sceneOverrides replace specific scenes; scene (legacy) replaces scene-1.
  // theme, captions, and timing overrides merge into the base config.
  let variant = null;
  if (overrides.variant != null) {
    const v = variants.find(x => x.id === overrides.variant);
    if (!v) {
      const ids = variants.map(x => x.id).join(', ') || '(none declared)';
      errs.push(`unknown variant "${overrides.variant}" — declared variants: ${ids}`);
    } else {
      variant = v.id;

      // Merge theme overrides into themeTokens
      if (v.theme) {
        for (const [tk, tv] of Object.entries(v.theme)) {
          themeTokens[tk] = tv;
        }
      }
      // Merge captions overrides
      if (v.captions) {
        if (v.captions.preset != null) captions.preset = v.captions.preset;
        if (v.captions.emphasis != null) captions.emphasis = v.captions.emphasis;
      }
      // Merge timing overrides
      if (v.timing) {
        for (const [tk, tv] of Object.entries(v.timing)) {
          if (tv != null) timing[tk] = tv;
        }
      }

      // Apply scene overrides
      if (v.sceneOverrides) {
        for (const [sid, so] of Object.entries(v.sceneOverrides)) {
          const sceneIdx = scenes.findIndex(s => s.id === sid);
          if (sceneIdx < 0) {
            errs.push(`variant "${v.id}": sceneOverrides.${sid}: scene "${sid}" not found`);
            continue;
          }
          const base = scenes[sceneIdx];
          scenes[sceneIdx] = {
            ...base,
            ...(so.body != null ? { body: so.body } : {}),
            ...(so.visual != null ? { visual: so.visual } : {}),
            ...(so.three != null ? { three: so.three } : {}),
            ...(so.vo != null ? { vo: so.vo } : {}),
            ...(so.elements != null ? { elements: so.elements } : {}),
            ...(so.transition != null ? { transition: so.transition } : {}),
          };
        }
      }
      // Legacy scene-1 override (backward compat)
      if (v.scene) {
        scenes[0] = {
          ...scenes[0],
          ...(typeof v.scene.body === 'string' ? { body: v.scene.body } : {}),
          ...(v.scene.visual ? { visual: v.scene.visual } : {}),
          ...(v.scene.three ? { three: v.scene.three } : {}),
          vo: v.scene.vo,
          ...(v.scene.transition ? { transition: v.scene.transition } : {}),
        };
      }
    }
  }

  const walkthroughs = resolveWalkthroughs(raw.walkthroughs, scenes, baseDir, ID_RE, errs);

  // Named time markers: author-defined anchors on the global project timeline,
  // resolvable as `data-cue="marker:<name>"` and `at: { marker: "<name>" }`.
  // Markers decouple timing from narration turns, enabling music-driven edits,
  // silent montage, and any non-speech-anchored event to drive the timeline.
  // Each marker is a non-negative second offset from the start of the video.
  const markers = {};
  if (raw.markers != null) {
    if (typeof raw.markers !== 'object' || Array.isArray(raw.markers)) {
      errs.push('config.markers: expected an object like { name: seconds }');
    } else {
      for (const [name, sec] of Object.entries(raw.markers)) {
        if (!ID_RE.test(name)) {
          errs.push(`config.markers.${name}: name must match ${ID_RE}`);
        } else if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) {
          errs.push(`config.markers.${name}: expected a non-negative number of seconds`);
        } else {
          markers[name] = sec;
        }
      }
    }
  }

  // Marker references are validated after the global marker table is known.
  // The lower-level visual validator checks the shape of `at`; this pass
  // catches well-formed references to names that do not exist.
  function checkAnimationMarkers(anims, at) {
    const list = anims ? (Array.isArray(anims) ? anims : [anims]) : [];
    list.forEach((anim, i) => {
      const name = anim && anim.at && anim.at.marker;
      if (typeof name === 'string' && !(name in markers)) {
        errs.push(`${at}[${i}].at.marker: "${name}" not found in config.markers`);
      }
    });
  }
  function checkObjectMarkers(obj, at) {
    checkAnimationMarkers(obj && (obj.animate || obj.keyframes), `${at}.animate`);
    (obj && obj.children || []).forEach((child, i) => checkObjectMarkers(child, `${at}.children[${i}]`));
  }
  scenes.forEach((scene, si) => {
    if (!scene.three) return;
    checkAnimationMarkers(scene.three.cameraAnimate, `config.scenes[${si}].three.cameraAnimate`);
    (scene.three.objects || []).forEach((obj, oi) => checkObjectMarkers(obj, `config.scenes[${si}].three.objects[${oi}]`));
  });

  if (errs.length) throw new Error('Invalid config:\n  - ' + errs.join('\n  - '));

  // Fill a fallback duration for any scene missing one (player uses audio dur once synthed).
  scenes.forEach(s => { if (s.dur == null) s.dur = Math.max(6, (s.vo.length || 1) * 5); });

  const resolved = { title, size, renderer, voices, characters, theme: themeTokens, mode: themeMode, chrome, themeCss, choreography, choreographyPath, timing, scenes, walkthroughs, assetsDir, projectDir: path.resolve(baseDir), platform: platformName, bed, sfx, captions, captionsEnabled, align, variants, variant, series, narrationSource, imports, sceneFileRefs, includePatterns, markers };

  // Compile semantic elements into concrete render configs (three + body/visual).
  for (let i = 0; i < resolved.scenes.length; i++) {
    if (resolved.scenes[i].elements) {
      resolved.scenes[i] = resolveElementsScene(resolved.scenes[i], resolved);
    }
  }

  // Bump a scene's duration to fit the longest 3D animation, so the render
  // loop never stops before an animation finishes. The initial fallback
  // (max(6, vo*5)) knows nothing about 3D timing — it can cut tweens short
  // and freeze the scene mid-playback.
  let plannedSceneStart = 0;
  for (const s of resolved.scenes) {
    const minDur = min3dSceneDuration(s, markers, plannedSceneStart);
    if (minDur > 0 && minDur > (s.dur || 0)) s.dur = minDur;
    plannedSceneStart += s.dur || 0;
  }

  return resolved;
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

/* Compute the minimum scene duration needed to fit all 3D animations.
 * The initial fallback (max(6, vo*5)) knows nothing about 3D timing.
 * Returns 0 when there are no animations to account for. */
function min3dSceneDuration(scene, markers = {}, sceneStart = 0) {
  if (!scene.three) return 0;

  let maxEnd = 0;

  // Animate specs on objects: { property, from?, to, duration, at? }
  const collected = [];
  for (const obj of (scene.three.objects || [])) {
    const anims = obj.animate
      ? (Array.isArray(obj.animate) ? obj.animate : [obj.animate])
      : [];
    for (const a of anims) if (a) collected.push(a);
  }

  // Camera animate (if camera supports it — added in a later release).
  const camAnims = scene.three.cameraAnimate
    ? (Array.isArray(scene.three.cameraAnimate) ? scene.three.cameraAnimate : [scene.three.cameraAnimate])
    : [];
  for (const a of camAnims) if (a) collected.push(a);

  for (const anim of collected) {
    const duration = anim.duration || 0;
    if (duration <= 0) continue;

    // Offset from scene start — same resolution that animationTweens() uses.
    let offset = 0;
    if (anim.at != null) {
      if (typeof anim.at === 'number') {
        offset = anim.at;
      } else if (typeof anim.at === 'object' && anim.at.cue != null) {
        // PLANNING ESTIMATE: approximate ~2s per narration turn.
        // Before synthesis, exact turn durations are unknown. Final rendering
        // uses measured turn timings from timings.json (see compose/three.js
        // animationTweens). This estimate only determines the minimum scene
        // duration needed for the pre-build fallback.
        offset = anim.at.cue * 2 + (anim.at.offset || 0);
      } else if (typeof anim.at === 'object' && typeof anim.at.marker === 'string'
          && Number.isFinite(markers[anim.at.marker])) {
        offset = Math.max(0, markers[anim.at.marker] - sceneStart) + (anim.at.offset || 0);
      }
    }
    offset += Number.isFinite(anim.wait) ? anim.wait : 0;

    const end = offset + duration;
    if (end > maxEnd) maxEnd = end;
  }

  return maxEnd;
}

module.exports = { resolveConfig, narration };
