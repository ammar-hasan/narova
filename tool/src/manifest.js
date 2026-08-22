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
  // Authored provenance and creative assertions are advisory report inputs. They do not
  // affect synthesis, composition, rendering, creative-proof validity, or
  // revision identity, so they must not enter the execution fingerprint.
  const { assetsDir: _a, provenance: _provenance, assertions: _assertions, projectDir = '.', ...serializable } = config;
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
  // Theme CSS (string contents) and the asset files it references. Theme assets
  // are GLOBAL visual inputs: every scene renders under them, so a change
  // invalidates all spans (scene-cache keeps only `globalasset:*` keys in the
  // shared context). The composed global stylesheet merges CSS imports and
  // inlines local @import rules recursively; url() references resolve against
  // the renderer project's `assets/` mount (the configured assets directory's
  // contents). An unresolved reference or unclosable import makes the whole
  // asset tree global (any asset edit invalidates all scenes).
  const pd = projectDir || '.';
  const adCss = config.assetsDir ? path.resolve(pd, config.assetsDir) : path.join(pd, 'assets');
  let globalCss = [config.themeCss || '', ...(config.imports
    ? Object.values(config.imports).map(i => (i && /\.css$/i.test(i.file || '') ? i.contents || '' : ''))
    : [])].filter(Boolean).join('\n');
  let unresolvedCssRef = false;
  const cssImportRe = /@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?/gi;
  for (let depth = 0; depth < 8; depth++) {
    cssImportRe.lastIndex = 0;
    const imp = cssImportRe.exec(globalCss);
    if (!imp) break;
    const ref = imp[1].trim();
    if (/^(data:|https?:|\/\/)/i.test(ref)) break; // external import: not hashable here
    let impFile = null;
    for (const c of [path.resolve(adCss, ref.startsWith('assets/') ? ref.slice('assets/'.length) : ref), path.resolve(pd, ref)]) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) { impFile = c; break; }
    }
    if (!impFile) { unresolvedCssRef = true; break; } // cannot close the import → conservative
    globalCss = globalCss.replace(imp[0], fs.readFileSync(impFile, 'utf8'));
  }
  if (globalCss) {
    h.themeCss = sha256(globalCss);
    const urlRe = /url\(\s*("([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;
    let mm;
    while ((mm = urlRe.exec(globalCss))) {
      const u = (mm[2] || mm[3] || mm[4] || '').trim();
      if (!u || /^(data:|https?:|\/\/|#)/i.test(u)) continue;
      let resolved = null;
      for (const c of [path.resolve(adCss, u.startsWith('assets/') ? u.slice('assets/'.length) : u), path.resolve(pd, u)]) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) { resolved = c; break; }
      }
      if (resolved == null) { unresolvedCssRef = true; continue; }
      const rel = path.relative(pd, resolved) || u;
      h[`globalasset:${rel}`] = hashFile(resolved);
    }
    if (unresolvedCssRef) h['globalasset:__all__'] = assetTreeHash(config, projectDir);
  }
  // Project choreography: inlined into the composition like theme.css, so an
  // edit to it has to invalidate the build the same way.
  if (config.choreography) h.choreography = sha256(config.choreography);
  // Imported modules: hash each imported file's contents for invalidation.
  if (config.imports) {
    for (const [name, imported] of Object.entries(config.imports)) {
      if (imported && imported.contents) {
        h[`import:${name}`] = sha256(imported.contents);
      }
    }
  }
  // Scene file refs: hash each referenced file path for invalidation.
  if (config.sceneFileRefs) {
    for (const ref of config.sceneFileRefs) {
      const resolved = path.resolve(projectDir, ref.file);
      h[`scenefile:${ref.sceneIndex}:${ref.key}`] = hashFile(resolved);
    }
  }
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
  // Bed / sfx / clip files — hash by relative path (portable). Bed/SFX are
  // audio-only inputs: they never enter the per-scene pixel context, but they
  // MUST enter the whole-video cache identity because a whole-video cache entry
  // is an MP4 with audio already muxed in (scene-cache wholeVideoKey).
  if (config.bed && config.bed.file) {
    const rel = path.relative(pd, config.bed.file) || config.bed.file;
    h[`bed:${rel}`] = hashFile(config.bed.file);
  }
  if (config.sfx) config.sfx.forEach((s, i) => {
    const rel = path.relative(pd, s.file) || s.file;
    h[`sfx:${i}:${rel}`] = hashFile(s.file);
  });
  config.scenes.forEach(s => {
    if (s.clip) {
      const absClip = path.resolve(pd, s.clip);
      h[s.clip] = hashFile(absClip);
    }
    if (s.three) {
      const refs = [];
      const env = typeof s.three.envMap === 'string' ? s.three.envMap : s.three.envMap?.src;
      if (env) refs.push(env);
      function visit(obj) {
        if (obj.type === 'model' && obj.src) refs.push(obj.src);
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'texture']) {
          if (typeof obj[key] === 'string') refs.push(obj[key]);
        }
        for (const child of (obj.children || [])) visit(child);
      }
      for (const obj of (s.three.objects || [])) visit(obj);
      for (const ref of refs) h[`three:${ref}`] = hashFile(path.resolve(pd, ref));
    }
  });
  return h;
}

/* ---- compilation ---------------------------------------------------------- */

function compile(config, opts = {}) {
  const { title, size, renderer = 'hyperframes', voices, theme = {}, mode = 'dark', chrome = {},
    themeCss = '', choreography = '', timing = {}, scenes, platform = null, bed = null, sfx = [],
    captions = {}, align = false, variants = [], variant = null, series = null,
    walkthroughs = {}, projectDir = '.', includePatterns = false, safeLayout = false, markers = {} } = config;


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
      // Additive compile-time evidence only. Consumers must accept null/missing
      // values and must not use this as a freshness or execution gate.
      providerVersion: opts.rendererVersion || null,
    },
    format: {
      width:  (size && size.w) || 1280,
      height: (size && size.h) || 720,
      fps:    30,
      sampleRate: 48000,
      colorSpace: 'rec709',
    },
    theme: {
      // Preserve every validated theme token from the resolved config.
      // Custom tokens (stage, deep, halo, panel, line, ink, muted, faint,
      // gold, pink, colw, user-defined tokens, etc.) survive the round-trip
      // through the manifest so downstream consumers (compose, no-browser,
      // exports) reconstruct the full authored palette.
      ...(theme || {}),
      // Defaults MUST match compose/css.js DEFAULT_TOKENS so the canonical
      // project representation agrees with the rendered output. The runtime
      // palette is monochrome gray by design (zero-style default); the legacy
      // teal/navy values were a stale contradiction. Keep these in sync with
      // DEFAULT_TOKENS in src/compose/css.js.
      accent: (theme && theme.accent) || '#888888',
      bg:     (theme && theme.bg)     || '#101010',
      mode,
      css:    themeCss || '',
    },
    chrome: { ...(chrome || {}) },
    // Carried as contents, not a path: the manifest has to be able to rebuild
    // the composition on its own, exactly as it does for theme.css.
    choreography: choreography || '',
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
      // `enabled` distinguishes `captions:false` (band off) from the default
      // subtitle preset. Without it, both serialize to the same object and the
      // per-scene render cache cannot tell them apart — serving captioned
      // pixels for a captions-off build (or vice versa). renderContextHash
      // already hashes this whole object, so the enabled flag flows in for free.
      enabled:   config.captionsEnabled !== false,
      preset:   (captions && captions.preset)   || 'subtitle',
      emphasis: (captions && captions.emphasis) || [],
      maxWords: (captions && captions.maxWords) || null,
      plate:    captions && captions.plate === true,
      size:     captions && captions.size != null ? captions.size : null,
    },
    align: align === false ? null : (typeof align === 'object' ? align : { engine: 'auto' }),
    assets,
    walkthroughs: compileWalkthroughs(walkthroughs, projectDir),
    scenes: compileScenes(scenes || [], projectDir, config.assetsDir),
    // Whole non-audio asset tree hash: the conservative dependency cover for
    // scenes that embed executable JavaScript or carry an unresolved local
    // asset reference, and for whole-video cache mode (project JS can load any
    // asset dynamically) (CHANGE-2026-041 / NAR-007-044).
    assetTreeHash: assetTreeHash(config, projectDir),
    variants: compileVariants(variants || []),
    series: series || null,
    variant: variant || null,
    includePatterns: includePatterns !== false,
    safeLayout: safeLayout === true,
    markers: markers || {},
    // Import name → project-relative file. The render cache's selective-render
    // safety gate reads this to detect project-global JS imports (.js files are
    // inlined into the composition's choreography and can reference the global
    // DATA/timeline, so they disable per-scene isolation — see scene-cache.js).
    imports: Object.fromEntries(
      Object.entries(config.imports || {}).map(([n, imp]) => [n, imp && imp.file]),
    ),
    // Keep the manifest independently composable. `imports` above remains the
    // stable path-only cache/safety representation; this companion carries the
    // already validated source bytes needed when no resolved config is present.
    importSources: Object.fromEntries(
      Object.entries(config.imports || {}).map(([n, imp]) => [n, imp && {
        file: imp.file,
        contents: imp.contents,
      }]),
    ),
    environment: {
      narova:    opts.toolVersion || '0.8.0',
      backend:   opts.backend || config.voices && Object.values(config.voices)[0]?.backend || 'piper',
      backendVersion: opts.backendVersion || null,
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
  config.scenes.forEach(s => {
    if (s.clip) add('video', s.clip);
    if (!s.three) return;
    const env = typeof s.three.envMap === 'string' ? s.three.envMap : s.three.envMap?.src;
    if (env) add('image', env);
    function visit(obj) {
      if (obj.type === 'model' && obj.src) add('model', obj.src);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'texture']) {
        if (typeof obj[key] === 'string') add('image', obj[key]);
      }
      for (const child of (obj.children || [])) visit(child);
    }
    for (const obj of (s.three.objects || [])) visit(obj);
  });
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
      ...(v.vary ? { vary: true } : {}),
      ...(v.exaggeration != null ? { exaggeration: v.exaggeration } : {}),
      ...(v.cfg_weight != null ? { cfg_weight: v.cfg_weight } : {}),
      ...(v.providerProtocol ? { providerProtocol: v.providerProtocol } : {}),
      ...(v.providerVersion ? { providerVersion: v.providerVersion } : {}),
      ...(v.providerOptions ? { providerOptions: v.providerOptions } : {}),
    };
  }
  return out;
}

function compileScenes(scenes, projectDir, assetsDir) {
  return (scenes || []).map((s, i) => {
    const assetRefs = sceneAssetRefs(s, projectDir, assetsDir);
    return {
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
      ...(turn.take != null ? { take: turn.take } : {}),
      start: 0,            // filled after synth
      words: [],           // filled after synth
    })),
    body: s.body || '',
    visual: s.visual || null,
    three: s.three || null,
    clip: s.clip || null,
    clipAudio: s.clipAudio ? {
      authority: s.clipAudio.authority,
      role: s.clipAudio.role,
      rationale: s.clipAudio.rationale,
      ...(s.clipAudio.wordTimingsPath
        ? { wordTimings: path.relative(projectDir, s.clipAudio.wordTimingsPath) }
        : {}),
    } : null,
    walkthrough: s.walkthrough || null,
    dur:  s.dur || null,   // silent scene fixed duration
    minDur: s.minDur != null ? s.minDur : null,
    // Inlined modular author sources are render inputs, not merely hash inputs.
    // Persist them so manifest -> compose is lossless.
    _choreographyFileContents: s._choreographyFileContents || '',
    _scriptFileContents: s._scriptFileContents || '',
    _threeModuleContents: s._threeModuleContents || '',
    _cssFileContents: s._cssFileContents || '',
    sfx:  [],              // per-scene SFX anchors (filled by audio.sfx resolution)
    // Per-scene asset references: project-relative path -> content hash for
    // every asset this scene can cause to load during its render. The scene
    // span cache keys on these so one asset edit invalidates only the scenes
    // that reference it (CHANGE-2026-041 / NAR-007-044). An unresolved local
    // reference makes the scene conservatively depend on the whole asset tree.
    assets: assetRefs.refs,
    _unresolvedAssetRefs: assetRefs.unresolved,
    hash: sceneHash(s),    // scene-level content fingerprint for selective rebuild
    };
  });
}

/* Extract the asset files a single scene can cause to load: its clip, image
 * references in the scene body and scene CSS (both url(...) and <img src=...>),
 * Three.js model/texture/environment files, and portable-visual image/font
 * files. Remote/data/hash references are ignored (they do not participate in
 * local cache identity). A scene whose authored content embeds executable
 * JavaScript is handled conservatively by the scene cache (it may reference
 * any asset dynamically), so this extraction only needs to be exact for
 * declarative scenes.
 *
 * References are resolved against the configured assets directory (scene HTML
 * uses the renderer project's `assets/` mount, which holds the contents of
 * that directory) and against the project root. Explicit fields (clip, Three.js
 * files) are validated and rendered relative to the project root, so they
 * resolve project-root-first; body/CSS/portable-visual references resolve
 * mount-first. Any local reference that cannot be resolved to an existing file
 * marks the scene as having an unresolved asset dependency, so the scene cache
 * falls back conservatively to the whole asset tree instead of silently
 * tracking a null hash (an edit would otherwise never invalidate it). */
function sceneAssetRefs(scene, projectDir, assetsDir) {
  const refs = {};
  let unresolved = false;
  let htmlMountResolved = 0; // resolved refs that came from an `assets/` mention
  const pd = projectDir || '.';
  const ad = assetsDir ? path.resolve(projectDir, assetsDir) : null;
  // mountFirst=false → explicit authored fields (project-root-relative).
  // mountFirst=true → scene HTML/CSS/visual refs (assets/ mount first).
  const add = (p, mountFirst, fromHtml) => {
    if (!p || typeof p !== 'string') return;
    const t = p.trim();
    if (!t || /^(data:|https?:|\/\/|#|blob:)/i.test(t)) return;
    const candidates = [];
    if (ad && mountFirst) {
      const mountRel = t.startsWith('assets/') ? t.slice('assets/'.length) : t;
      candidates.push(path.resolve(ad, mountRel));
    }
    candidates.push(path.resolve(pd, t));
    if (ad && !mountFirst) candidates.push(path.resolve(ad, t.startsWith('assets/') ? t.slice('assets/'.length) : t));
    let resolved = null;
    for (const c of candidates) {
      try {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) { resolved = c; break; }
      } catch {}
    }
    if (resolved == null) {
      // Unresolved local reference: can't prove which file this scene uses, so
      // the whole asset tree becomes the conservative dependency cover.
      unresolved = true;
      return;
    }
    refs[path.relative(pd, resolved) || t] = hashFile(resolved);
    if (fromHtml && t.includes('assets/')) htmlMountResolved++;
  };
  if (scene && scene.clip) add(scene.clip, false);
  const html = [scene && scene.body, scene && scene._cssFileContents].filter(Boolean).join('\n');
  const urlRe = /url\(\s*("([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;
  let mm;
  while ((mm = urlRe.exec(html))) add(mm[2] || mm[3] || mm[4], true, true);
  // src, poster, href, and data attribute values (quoted or unquoted) on any
  // element, plus srcset candidate URLs.
  const attrRe = /\b(?:src|poster|href|data)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  while ((mm = attrRe.exec(html))) add(mm[2] || mm[3] || mm[4], true, true);
  const srcsetRe = /\bsrcset\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  while ((mm = srcsetRe.exec(html))) {
    for (const cand of (mm[2] || mm[3] || mm[4] || '').split(',')) {
      add(cand.trim().split(/\s+/)[0], true, true);
    }
  }
  // Conservative closure (NAR-007-044): if the scene HTML mentions the renderer
  // `assets/` mount in ANY form the analyzer did not resolve to a file — an
  // unrecognized attribute name, a dynamically-built path, a data-*/bind
  // surface — the dependency set is not provably closed, so the scene falls
  // back to the whole asset tree instead of risking stale reuse on an edit.
  // This bounds the open class of HTML resource-reference forms without
  // enumerating attribute names forever.
  const mountMentions = (html.match(/assets\//g) || []).length;
  if (mountMentions > htmlMountResolved) unresolved = true;
  if (scene && scene.three) {
    const visit = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      if (typeof obj.src === 'string' && ['model', 'texture', 'particleTexture'].includes(obj.type)) add(obj.src, false);
      for (const key of ['envMap', 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'texture']) {
        if (typeof obj[key] === 'string') add(obj[key], false);
      }
      for (const c of (obj.children || [])) visit(c);
    };
    if (typeof scene.three.envMap === 'string') add(scene.three.envMap, false);
    else if (scene.three.envMap && typeof scene.three.envMap.src === 'string') add(scene.three.envMap.src, false);
    else visit(scene.three.envMap);
    for (const o of (scene.three.objects || [])) visit(o);
  }
  const visitVisual = (node) => {
    if (!node || typeof node !== 'object') return;
    // Both image and svg visual nodes load their pixels from `src` (svg with
    // an external file; inline markup is not a file reference).
    if ((node.type === 'image' || node.type === 'svg') && typeof node.src === 'string') add(node.src, true);
    if (node.style && typeof node.style.fontFile === 'string') add(node.style.fontFile, true);
    for (const c of (node.children || [])) visitVisual(c);
  };
  visitVisual(scene && scene.visual);
  return { refs, unresolved };
}

/* Conservative dependency cover for scenes that embed executable JavaScript or
 * carry an unresolved asset reference, and for whole-video cache mode: the span
 * may reference any asset dynamically, so its identity covers the whole
 * non-audio asset tree (excluding bed/SFX, which only affect the mix).
 * Collected asset entries carry either project-relative or assets-root-relative
 * paths, so each file is resolved against both bases and keyed by its ABSOLUTE
 * source path — a root file and a mounted file with the same relative name stay
 * distinct (an edit to either must change the hash). */
function assetTreeHash(config, projectDir) {
  const entries = collectAssets(config, projectDir).filter(a => a.type !== 'audio');
  const pd = projectDir || '.';
  const ad = config.assetsDir ? path.resolve(pd, config.assetsDir) : path.join(pd, 'assets');
  const map = {};
  for (const a of entries) {
    for (const c of [path.resolve(pd, a.file), path.resolve(ad, a.file)]) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) map[c] = hashFile(c);
    }
  }
  return sha256(JSON.stringify(map, Object.keys(map).sort()));
}

/* Per-scene content hash: covers every datum that would change the rendered
 * output of a single scene. Changing scene 3's body should not invalidate the
 * render cache for scene 1.
 *
 * The set mirrors the per-scene author-content sources scanned by check.js
 * (the determinism scan): scene body/visual/three/clip/walkthrough/transition/
 * duration/vo, PLUS the inlined author-JS blobs that compose folds into the
 * project — `_choreographyFileContents`, `_scriptFileContents`, and the raw
 * Three.js escape hatch `_threeModuleContents`. These are part of the scene's
 * rendered output (they drive GSAP timelines / WebGL), so a cache span is only
 * valid if they are unchanged. Measured word/turn timings are NOT part of this
 * content fingerprint — they are not available at compile time and are added
 * to the scene-level cache key separately (see src/scene-cache.js). */
function sceneHash(s) {
  const payload = JSON.stringify({
    id: s.id,
    vo: s.vo, body: s.body, visual: s.visual, three: s.three,
    clip: s.clip, walkthrough: s.walkthrough, transition: s.transition,
    dur: s.dur, minDur: s.minDur, clipAudio: s.clipAudio,
    choreographyFile: s._choreographyFileContents || null,
    scriptFile: s._scriptFileContents || null,
    threeModule: s._threeModuleContents || null,
    cssFile: s._cssFileContents || null,
  });
  return sha256(payload);
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
    kind: v.kind || 'hook',
    scene: v.scene ? {
      body:       v.scene.body || '',
      visual:     v.scene.visual || null,
      three:      v.scene.three || null,
      vo:         (v.scene.vo || []).map(turn => ({
        who: turn.who,
        text: turn.text,
        ...(turn.lang ? { lang: turn.lang } : {}),
        ...(turn.synthesisText ? { synthesisText: turn.synthesisText } : {}),
      })),
      ...(v.scene.transition ? { transition: v.scene.transition } : {}),
    } : null,
    sceneOverrides: v.sceneOverrides || null,
    theme: v.theme || null,
    captions: v.captions || null,
    timing: v.timing || null,
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
      if (!['hyperframes', 'no-browser'].includes(tl.renderer.provider)) {
        errs.push('manifest.renderer.provider: expected hyperframes|no-browser');
      }
      if (tl.renderer.protocol !== 'narova-renderer-provider/v1') {
        errs.push('manifest.renderer.protocol: expected narova-renderer-provider/v1');
      }
      if (tl.renderer.providerVersion != null
          && (typeof tl.renderer.providerVersion !== 'string' || !tl.renderer.providerVersion.trim())) {
        errs.push('manifest.renderer.providerVersion: expected a non-empty string or null');
      }
    }
  }
  if (tl.environment != null) {
    if (!tl.environment || typeof tl.environment !== 'object' || Array.isArray(tl.environment)) {
      errs.push('manifest.environment: expected an object');
    } else {
      if (tl.environment.backend != null
          && (typeof tl.environment.backend !== 'string' || !tl.environment.backend.trim())) {
        errs.push('manifest.environment.backend: expected a non-empty string');
      }
      if (tl.environment.backendVersion != null
          && (typeof tl.environment.backendVersion !== 'string' || !tl.environment.backendVersion.trim())) {
        errs.push('manifest.environment.backendVersion: expected a non-empty string or null');
      }
    }
  }
  if (!tl.format || typeof tl.format !== 'object') errs.push('manifest.format: required (object)');
  else {
    if (!Number.isFinite(tl.format.width)) errs.push('manifest.format.width: required (number)');
    if (!Number.isFinite(tl.format.height)) errs.push('manifest.format.height: required (number)');
  }
  if (!tl.voices || typeof tl.voices !== 'object' || Array.isArray(tl.voices)) {
    errs.push('manifest.voices: required (object; may be empty for silent projects)');
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
      if (ts.words.length > 0 && ts.words.every(word => Number.isInteger(word.ti))) {
        for (let ti = 0; ti < s.vo.length; ti++) {
          s.vo[ti].words = ts.words.filter(word => word.ti === ti)
            .map(word => ({ w: word.w, t0: word.t0, t1: word.t1 }));
          s.vo[ti].start = globalStart + (ts.turns ? ts.turns[ti] || 0 : 0);
        }
      } else {
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

/* Toolchain versions are recorded evidence, not execution or identity inputs
 * (NAR-014-048). Return a detached projection for consumers that calculate
 * freshness, proof, revision, or plan identities. */
function withoutToolchainVersionEvidence(manifest) {
  const projected = JSON.parse(JSON.stringify(manifest));
  if (projected.renderer && typeof projected.renderer === 'object') {
    delete projected.renderer.providerVersion;
  }
  if (projected.environment && typeof projected.environment === 'object') {
    delete projected.environment.backendVersion;
  }
  return projected;
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
  sceneAssetRefs,
  assetTreeHash,
  withoutToolchainVersionEvidence,
  read,
  write,
};
