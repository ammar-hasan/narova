'use strict';
/* Scene-level render cache: re-render only the scenes whose content changed
 * since the last successful build, and reuse cached rendered spans for the rest.

 * Per-scene content hashes already live on the manifest
 * (`manifest.scenes[i].hash`, computed by manifest.sceneHash). This module is
 * the consumer that was missing: on `narova build` it decides, per scene,
 * whether a previously rendered span is still valid and reuses it, otherwise
 * renders just that scene's frame span and stores the result keyed by a hash
 * that captures every input the span's pixels depend on.

 * Cache modes are declared per renderer (provider.cache.mode):
 *   - 'per-scene' (both bundled renderers): render only scenes whose key
 *     changed, concatenate concat-safe spans (setsar=1), and mux the single
 *     authoritative full audio track so splice points cannot drift.
 *     HyperFrames composes an isolated t=0 project for each dirty scene;
 *     no-browser renders the corresponding full-project frame span directly.
 *   - 'whole-video' remains available to external providers that cannot render
 *     isolated spans: reuse the MP4 only when every visual input is unchanged.

 * CHANGE-2026-041 — automatic dependency-aware revision (NAR-007-042..048,
 * NAR-004-023):
 *   - Placement independence: the span key covers a scene's LOCAL visual
 *     identity (content, per-scene assets, scene-local measured timings) and
 *     the shared render context, but NOT the scene's absolute global start.
 *     A scene whose pixels are a pure function of scene-local time stays
 *     reusable when an earlier scene's duration changes; placement is applied
 *     at assembly (concatenation order). The per-scene reason "why" is
 *     attributed by comparing against the last recorded identity snapshot
 *     (`.scene-cache/identities.json`).
 *   - Scene-scoped assets: only assets a scene references enter its key;
 *     theme-CSS assets are global; unreferenced assets invalidate nothing.
 *   - Start-sensitive safety: a renderer that evaluates scenes at global time
 *     (no-browser) draws the chrome progress bar as an absolute-time visual
 *     unless progress is disabled, so placement remains a dependency there and
 *     a moved span re-renders conservatively.
 *   - Conservative fallback: an unproven reuse (missing identity, corrupt span,
 *     unknown executable-JS asset dependency) rebuilds with an attributed
 *     reason; it is never a silent stale reuse.

 * Determinism contract: a cached span is reused ONLY if reproducing it would
 * yield the same pixels. The cache key is sha256(renderContextHash +
 * sceneHash + sceneAssets + sceneTimingsFingerprint) — content, per-scene
 * assets, shared render context, and measured scene-local word/turn timings.
 * If anything differs, the span is re-rendered. If a cached file is missing,
 * empty, or its probed duration is wrong, it is treated as invalid and
 * re-rendered. Cache failures normally fall back to a full renderer.render().
 * WebGL-heavy HyperFrames films refuse that fallback: eagerly creating many
 * contexts can silently blank early scenes, so a clear failure is safer than
 * publishing corrupt pixels. */

const fs = require('fs');
const path = require('path');
const { ensureDir, sh, probe } = require('./util');
const { sha256 } = require('./manifest');

const CACHE_DIR = '.scene-cache';
const TOLERANCE = 0.08; // seconds: probed-vs-expected span duration slack
const IDENTITIES_FILE = 'identities.json';
const START_EPS = 0.001; // seconds: ms-rounded starts are exact to 1e-3

function cacheDir(outDir) { return path.join(outDir, CACHE_DIR); }
function identitiesPath(outDir) { return path.join(cacheDir(outDir), IDENTITIES_FILE); }

function round3(n) {
  return n == null ? null : Math.round(n * 1000) / 1000;
}

/* Shared render context: every project-level input that influences ALL scenes'
 * rendered pixels. A change here invalidates every span (correct — these are
 * shared inputs). Drawn from the enriched manifest so audio/timing/asset
 * content hashes are included.
 *
 * Which hashes stay GLOBAL (invalidate every span) vs scene-local:
 *   GLOBAL: theme CSS contents + `globalasset:*` files it references, project
 *           choreography, and `import:*` sources. These appear in every frame.
 *   SCENE-LOCAL: `config` (flips on any scene edit — defeating per-scene
 *           caching), per-scene `scenefile:*` (already folded into each
 *           scene's hash), asset files, clips, three refs — these enter the
 *           per-scene key via `manifest.scenes[i].assets` (NAR-007-044).
 *   AUDIO-LOCAL: bed/sfx file hashes affect the mix, never pixels, so they
 *           must not invalidate spans (an audio-only change re-muxes the new
 *           track over reused spans).
 * The monolithic `hashes.config` is deliberately excluded for the same reason
 * as before. An unreferenced asset edit therefore invalidates nothing, and a
 * scene-referenced asset edit invalidates exactly that scene.
 *
 * Dependency model (CHANGE-2026-041):
 *   GLOBAL (in contextHash) — change invalidates all scenes
 *     theme (tokens + css string) + theme-referenced assets, chrome, captions
 *     config, markers, series, project choreography, imports, voices,
 *     renderer version, fps, quality, format
 *   LOCAL (in sceneHash + sceneAssets + scene timings) — change invalidates
 *     only that scene
 *     scene body, visual, three, threeModule, clip, walkthrough ref,
 *     transition, vo text, scene choreo/script file contents, the asset files
 *     the scene references, measured scene-local word/turn timings
 *   PLACEMENT (assembly metadata) — never a pixel input except for global-time
 *     renderers drawing absolute-time visuals (see placementSensitive()) */
const GLOBAL_HASH_PREFIXES = ['import:', 'globalasset:'];
function renderContextHash(manifest, opts = {}) {
  const m = manifest || {};
  const sharedHashes = {};
  for (const [k, v] of Object.entries(m.hashes || {})) {
    if (k === 'config') continue;
    if (k === 'themeCss' || k === 'choreography') { sharedHashes[k] = v; continue; }
    if (GLOBAL_HASH_PREFIXES.some(p => k.startsWith(p))) { sharedHashes[k] = v; continue; }
    // Everything else (scenefile:*, asset walk entries, clip/three/bed/sfx
    // refs) is scene-local or audio-local and must not invalidate every span.
  }
  const payload = {
    toolVersion: m.narova,
    renderer: m.renderer && m.renderer.provider,
    format: m.format,
    theme: m.theme,
    chrome: m.chrome,
    captions: m.captions,
    choreography: m.choreography,
    timing: m.timing,
    // Voices affect AUDIO identity (backend/speaker/options); only their
    // presentation metadata (label/color) reaches pixels via caption speaker
    // labels. Per NAR-007-043, an audio-only voice change with unchanged
    // measured timing must not invalidate spans.
    voices: Object.fromEntries(Object.entries(m.voices || {}).map(([id, v]) => [
      id, { label: v && v.label, color: v && v.color },
    ])),
    markers: m.markers,
    series: m.series,
    platform: (m.project && m.project.platform) || null,
    includePatterns: m.includePatterns,
    // Missing means a pre-0.28 manifest with historical safe geometry.
    safeLayout: m.safeLayout == null ? true : m.safeLayout,
    hashes: sharedHashes,
    quality: opts.quality || 'standard',
    fps: opts.fps || (m.format && m.format.fps) || 30,
  };
  return sha256(JSON.stringify(payload));
}

/* Whether a scene embeds executable JavaScript that could reference any asset
 * dynamically. Such a scene cannot be proven to depend only on its static
 * references, so its asset identity conservatively covers the whole asset tree
 * (NAR-007-044 fallback). */
function hasExecutableJs(scene) {
  const s = scene || {};
  return !!(s._scriptFileContents || s._threeModuleContents || s._choreographyFileContents);
}

/* Per-scene asset identity: hash of the scene's referenced asset content
 * (project-relative path -> content hash). For scenes with executable JS or an
 * unresolved local asset reference, the dependency is unknowable, so it covers
 * the whole non-audio asset tree (conservative). */
function sceneAssetIdentity(manifest, sceneIndex) {
  const scene = (manifest.scenes || [])[sceneIndex];
  if (scene && scene._unresolvedAssetRefs) return manifest.assetTreeHash || sha256('{}');
  if (hasExecutableJs(scene)) return manifest.assetTreeHash || sha256('{}');
  const assets = (scene && scene.assets) || {};
  return sha256(JSON.stringify(assets, Object.keys(assets).sort()));
}

/* Measured word/turn timings for ONE scene (post-synth), expressed scene-locally.
 * Caption reveals, data-cue motion, and per-turn animations are driven by these,
 * so a re-synth that shifts timings (even with identical text) must invalidate
 * the span. Absolute global start is deliberately EXCLUDED: it is placement
 * metadata, not a pixel input for a scene whose visuals are local-time.
 *
 * Turn starts are stored as GLOBAL times in the enriched manifest only when the
 * turn has words (mergeTimings adds the scene start); word-less turns keep the
 * compile-time local placeholder 0. Normalize both back to scene-local. */
function sceneTimingsFingerprint(scene) {
  const sceneStart = scene.start || 0;
  const payload = {
    id: scene.id,
    duration: scene.duration,
    vo: (scene.vo || []).map(t => ({
      start: (t.start == null || !(t.words && t.words.length))
        ? 0
        : round3(t.start - sceneStart),
      words: (t.words || []).map(w => [w.w, w.t0, w.t1]),
    })),
  };
  return sha256(JSON.stringify(payload));
}

/* The full cache key for one scene span: content + per-scene assets + measured
 * scene-local timings + shared render context. A span is reusable iff this key
 * is stable. Absolute placement is not part of it (NAR-007-045). */
function sceneCacheKey(scene, contextHash, assetIdentity) {
  return sha256([contextHash, scene.hash || '', assetIdentity || '', sceneTimingsFingerprint(scene)].join('\n'));
}

/* Whole-video cache key: render context + the whole asset tree (project-level
 * JS or whole-video mode can load any asset dynamically, so every asset edit
 * must invalidate it — NAR-007-044) + AUDIO identity (a whole-video cache entry
 * is the rendered MP4 with audio muxed in, so a bed/SFX change must invalidate
 * it) + every scene's content, assets & timings. Any single-scene, asset, or
 * audio change flips this key, forcing a full renderer.render(). */
function wholeVideoKey(manifest, contextHash) {
  const m = manifest || {};
  const audioEntries = Object.entries(m.hashes || {})
    .filter(([k]) => k.startsWith('bed:') || k.startsWith('sfx:'))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const audioIdentity = sha256(JSON.stringify(audioEntries));
  const sceneKeys = (m.scenes || [])
    .map((s, i) => (s.hash || '') + '\n' + sceneAssetIdentity(m, i) + '\n' + sceneTimingsFingerprint(s))
    .join('\n');
  return sha256(contextHash + '\n' + audioIdentity + '\n' + (m.assetTreeHash || '') + '\n' + sceneKeys);
}

/* True if a cached file is a non-empty MP4 whose duration matches the expected
 * span duration within TOLERANCE. Missing/corrupt/short files are invalid and
 * get re-rendered — never silently served. */
function spanIsValid(file, expectedSeconds) {
  if (!fs.existsSync(file)) return false;
  const st = fs.statSync(file);
  if (!st.size) return false;
  if (expectedSeconds == null) return true;
  try {
    const dur = probe(file);
    return Number.isFinite(dur) && Math.abs(dur - expectedSeconds) <= TOLERANCE;
  } catch {
    return false;
  }
}

/* Partition the timeline into per-scene frame spans. Boundaries are rounded to
 * the nearest frame so the spans tile [0, totalFrames) exactly — no gap, no
 * overlap — which is what keeps the concatenated video frame-count-identical
 * to a full render (ceil(total*fps)). */
function planSpans(manifest, contextHash, fps, outDir, opts = {}) {
  const scenes = manifest.scenes || [];
  const pSensitive = !!opts.placementSensitive;   // chrome progress / markers
  const globalTime = !!opts.globalTime;            // non-isolated: sampling phase
  const ordinalDep = !!opts.ordinalSensitive;
  const prior = (opts.identities && opts.identities.scenes) || null;
  const priorContext = opts.identities && opts.identities.contextHash;
  const contextChanged = priorContext != null && priorContext !== contextHash;
  const total = manifest.totalDuration || scenes.reduce((n, s) => n + (s.duration || 0), 0);
  const totalFrames = Math.max(1, Math.ceil(total * fps));
  const starts = scenes.map(s => (s.start || 0));
  return scenes.map((s, i) => {
    const frameStart = i === 0 ? 0 : Math.round(starts[i] * fps);
    const frameEnd = i === scenes.length - 1 ? totalFrames : Math.round(starts[i + 1] * fps);
    const frameCount = Math.max(0, frameEnd - frameStart);
    const expectedSeconds = frameCount / fps;
    const assetIdentity = sceneAssetIdentity(manifest, i);
    const timingFingerprint = sceneTimingsFingerprint(s);
    const cacheKey = sceneCacheKey(s, contextHash, assetIdentity);
    const spanFile = path.join(cacheDir(outDir), `${cacheKey}.mp4`);
    const sidecar = readSpanSidecar(spanFile);
    // Any project defining markers is placement-sensitive for every scene:
    // markers are consumed declaratively (`data-cue="marker:name"`) and by JS,
    // and isolated renders rebase markers against the scene start.
    const markerSensitive = manifest.markers && Object.keys(manifest.markers).length > 0;

    // Attribution only: compare against the last recorded identity snapshot.
    // The REUSE DECISION below is driven by the key-matched span + sidecar, so
    // a revert A→B→A reuses the still-valid A span even though the snapshot
    // records B.
    const prev = prior && prior[s.id];
    let reason;
    if (prev == null) reason = 'no prior cached identity';
    else if (contextChanged) reason = 'render context changed';
    else if (prev.content !== (s.hash || '')) reason = 'visual content changed';
    else if (prev.assets !== assetIdentity) reason = 'referenced asset changed';
    else if (prev.timing !== timingFingerprint) reason = 'measured timing changed';
    else reason = 'unchanged';

    // Reuse decision (key-first):
    const fileValid = spanIsValid(spanFile, expectedSeconds)
      && sidecar != null && sidecar.sceneId === s.id;
    const sidecarStartMoved = sidecar == null
      ? true : Math.round((sidecar.start || 0) * 1000) !== Math.round((s.start || 0) * 1000);
    const sidecarIndexMoved = sidecar != null && sidecar.index !== i;
    // Global-time renderers sample the full project at absolute frame times, so
    // reuse is exact only when the frame-sampling PHASE is preserved: the
    // fractional frame offset of the scene start (start*fps mod 1) must match.
    // This also subsumes frame-count drift: a phase shift changes the required
    // frame count by ±1, which a duration tolerance alone would accept.
    const phaseChanged = globalTime && Math.abs(((s.start || 0) * fps % 1) - ((sidecar && sidecar.start || 0) * fps % 1)) > 1e-6;

    let reusable = fileValid;
    if (reusable && ordinalDep && sidecarIndexMoved) {
      reusable = false; reason = 'scene position changed (global-time scene)';
    } else if (reusable && sidecarStartMoved && markerSensitive) {
      reusable = false; reason = 'marker-dependent scene placement changed';
    } else if (reusable && sidecarStartMoved && pSensitive) {
      reusable = false; reason = 'placement changed (global-time scene)';
    } else if (reusable && sidecarStartMoved && phaseChanged) {
      reusable = false; reason = 'placement changed (sampling phase)';
    }
    if (!reusable && prev != null && !fileValid) {
      // The key/span is absent or corrupt: prefer the attributable cause.
      if (reason === 'unchanged') reason = 'missing or invalid cached span';
    }
    if (reusable) {
      reason = (sidecarStartMoved || sidecarIndexMoved)
        ? 'placement changed; local visuals unchanged'
        : 'unchanged';
    }

    return {
      sceneIndex: i,
      sceneId: s.id,
      cacheKey,
      frameStart,
      frameEnd,
      frameCount,
      expectedSeconds,
      tStart: frameStart / fps,
      tDur: expectedSeconds,
      spanFile,
      reusable,
      reason,
    };
  });
}

/* Whether a scene's pixels can depend on its ORDINAL (position in the scene
 * list). Both bundled renderers embed ordinal-derived state: isolated
 * HyperFrames spans carry `_firstScene` (entrance transition) and the chrome
 * counter; no-browser slices render the entrance transition and counter by
 * index. A scene whose ordinal changed therefore must re-render (NAR-007-046).
 * This is conservative for all current renderers; a future renderer that is
 * provably ordinal-independent could opt out. */
function ordinalSensitive() {
  return true;
}

/* Whether a scene's pixels can depend on its ABSOLUTE placement. The chrome
 * progress bar is drawn from global time for every renderer, so enabling it
 * makes every scene placement-sensitive. Any project that defines markers is
 * placement-sensitive for every scene: markers are consumed both by executable
 * JS and declaratively (`data-cue="marker:name"`, Three animations), and
 * isolated renders rebase markers against the scene start. Global-time
 * renderers additionally depend on the frame-sampling phase, handled per scene
 * in planSpans. */
function placementSensitive(manifest, scene) {
  const m = manifest || {};
  const chrome = m.chrome || {};
  if (chrome.progress !== false) return true;
  if (m.markers && Object.keys(m.markers).length > 0) return true;
  return false;
}

/* ---- identity snapshot for reuse attribution (NAR-007-048) ------------------
 * Written after every successful per-scene build so the NEXT build can say WHY
 * each scene is being rebuilt or reused. Advisory; loss/missing is a plain
 * "no prior cached identity" miss. */

/* Per-span sidecar: records the placement/ordinal under which a span was
 * rendered so reuse can validate them independently of the latest identity
 * snapshot (which only attributes reasons). A revert A→B→A must reuse the
 * still-valid A-keyed span. */
function sidecarPath(spanFile) { return spanFile.replace(/\.mp4$/, '.json'); }
function writeSpanSidecar(span, scene) {
  try {
    fs.writeFileSync(sidecarPath(span.spanFile), JSON.stringify({
      sceneId: scene && scene.id,
      index: scene && scene.index,
      start: round3((scene && scene.start) || 0),
    }));
  } catch {}
}
function readSpanSidecar(spanFile) {
  try { return JSON.parse(fs.readFileSync(sidecarPath(spanFile), 'utf8')); } catch { return null; }
}

function identitySnapshot(manifest, contextHash, placementSensitiveFlag) {
  const scenes = {};
  (manifest.scenes || []).forEach((s, i) => {
    scenes[s.id] = {
      index: i,
      content: s.hash || '',
      assets: sceneAssetIdentity(manifest, i),
      timing: sceneTimingsFingerprint(s),
      start: round3(s.start || 0),
    };
  });
  return { version: 1, contextHash, placementSensitive: !!placementSensitiveFlag, scenes };
}

function readIdentities(outDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(identitiesPath(outDir), 'utf8'));
    if (!raw || raw.version !== 1 || !raw.scenes) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeIdentities(outDir, snapshot) {
  try {
    ensureDir(cacheDir(outDir));
    const tmp = identitiesPath(outDir) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, identitiesPath(outDir));
  } catch {
    // Advisory only: a lost snapshot means a conservative re-render next time.
  }
}

/* Per-scene isolation safety gate. A project feature is "unsafe" to render
 * scene-by-scene when its authored behavior can depend on the FULL project
 * timeline (global DATA, multiple scenes, or absolute global times). Isolating
 * such a feature into a t=0 scene-local project would silently change what the
 * author wrote, so we fall back to a whole-video render instead.
 *
 * Unsafe (-> whole-video fallback):
 *   - project choreography (config.choreography): by contract it can read the
 *     global DATA object and address any scene via sc.start (see
 *     references/choreography.md). It is authored in global time.
 *   - .js imports: inlined into the same global choreography blob, so they
 *     carry the same risk.
 *
 * Safe (kept per-scene): ordinary scene bodies, scene-local CSS, captions,
 * transitions, declarative Three.js, scene.threeModule, scene scriptFile /
 * choreographyFile — these are scene-scoped and are rebased to scene-local
 * coordinates by composeSceneDoc (markers, turns, the Three.js driver, etc.).
 *
 * This is deliberately a small allow/deny list, NOT a dependency analyzer. If a
 * future feature's locality is not provable, add it here as unsafe. */
function selectiveRenderSafe(manifest) {
  const m = manifest || {};
  if (m.choreography && String(m.choreography).trim()) {
    return { safe: false, reason: 'project choreography can reference global DATA and multiple scenes — performing a full render to preserve authored behavior' };
  }
  const imports = m.imports || {};
  const jsImport = Object.entries(imports).find(([, file]) => typeof file === 'string' && file.toLowerCase().endsWith('.js'));
  if (jsImport) {
    return { safe: false, reason: `project import "${jsImport[0]}" is JavaScript inlined into the global timeline — performing a full render to preserve authored behavior` };
  }
  return { safe: true };
}

/* Decide what to reuse vs render. Returns { mode, contextHash, spans?,
 * wholeKey?, wholeFile?, reused, renderCount }.
 *
 * For per-scene renderers we first ask selectiveRenderSafe(): if the project
 * uses a feature whose per-scene isolation is not provably safe, we silently
 * downgrade THIS build to the whole-video path (full render, cached as one
 * MP4). That is the documented escape hatch — "fast when safe, full render
 * when uncertain, never creatively wrong." The downgrade does not change the
 * renderer; it only changes how the cache layers this build. */
function plan({ outDir, manifest, renderer, fps, quality, log }) {
  const mode = (renderer && renderer.cache && renderer.cache.mode) || 'none';
  const isolated = !!(renderer && renderer.cache && renderer.cache.isolated);
  const contextHash = renderContextHash(manifest, { fps, quality });
  const pSensitive = placementSensitive(manifest);
  const identities = readIdentities(outDir);
  const downgrade = (reason) => {
    if (log) log(`scene cache: selective render skipped — ${reason}`);
    const key = wholeVideoKey(manifest, contextHash);
    const wholeFile = path.join(cacheDir(outDir), `${key}.mp4`);
    const total = manifest.totalDuration || (manifest.scenes || []).reduce((n, s) => n + (s.duration || 0), 0);
    const reusable = spanIsValid(wholeFile, total);
    return {
      mode: 'whole-video', contextHash, wholeKey: key, wholeFile,
      reused: reusable ? 1 : 0, renderCount: reusable ? 0 : 1,
      selectiveSkipped: reason, placementSensitive: pSensitive,
    };
  };
  if (mode === 'per-scene') {
    // Only renderers that ISOLATE a scene into its own t=0 project (HyperFrames)
    // need the safety gate: they must rebase authored behavior, and project-
    // global JS (choreography / .js imports) cannot be rebased safely. no-browser
    // renders the full project at absolute frame times, so its per-scene spans
    // are correct by construction and are never downgraded.
    if (isolated) {
      const safety = selectiveRenderSafe(manifest);
      if (!safety.safe) return downgrade(safety.reason);
    }
    const spans = planSpans(manifest, contextHash, fps, outDir, {
      placementSensitive: placementSensitive(manifest),
      // Global-time renderers embed the scene's ordinal, sample at absolute
      // frame times (placement/phase), and trim spans to the planned frame
      // count — all reuse dependencies. Isolated renderers rebase placement
      // and do not trim, but still embed the ordinal.
      globalTime: !isolated,
      ordinalSensitive: ordinalSensitive(),
      identities,
    });
    return {
      mode, contextHash, spans, placementSensitive: placementSensitive(manifest),
      ordinalSensitive: ordinalSensitive(),
      reused: spans.filter(s => s.reusable).length,
      renderCount: spans.filter(s => !s.reusable).length,
    };
  }
  if (mode === 'whole-video') {
    const key = wholeVideoKey(manifest, contextHash);
    const wholeFile = path.join(cacheDir(outDir), `${key}.mp4`);
    const total = manifest.totalDuration || (manifest.scenes || []).reduce((n, s) => n + (s.duration || 0), 0);
    const reusable = spanIsValid(wholeFile, total);
    return {
      mode, contextHash, wholeKey: key, wholeFile, reused: reusable ? 1 : 0,
      renderCount: reusable ? 0 : 1, placementSensitive: pSensitive,
    };
  }
  return { mode: 'none', contextHash, reused: 0, renderCount: 1, placementSensitive: pSensitive };
}

/* Mux-only path for the per-scene renderer: concatenate already-valid spans
 * (video-only) and lay the single authoritative full audio under them. Audio
 * is never spliced per-scene, so there is no drift at splice points. */
function assembleFromSpans(spans, audioPath, outMp4, log) {
  const cdir = ensureDir(path.dirname(spans[0].spanFile));
  const listFile = path.join(cdir, 'concat.txt');
  fs.writeFileSync(listFile, spans.map(s => `file '${s.spanFile.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const concatOut = path.join(cdir, 'concat.mp4');
  // Spans were encoded with setsar=1 and identical codec params, so stream
  // copy preserves sar and keeps the concat lossless.
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-i', listFile, '-c', 'copy', concatOut]);
  sh('ffmpeg', ['-y', '-loglevel', 'error',
    '-i', concatOut, '-i', audioPath,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-shortest', outMp4]);
  if (log) log(`scene cache: assembled ${spans.length} spans + full audio -> ${path.basename(outMp4)}`);
  return outMp4;
}

/* The authoritative full narration track (mixed bed/SFX when present). Same
 * resolution order as the no-browser renderer's copyAudio(). */
function fullAudioPath(outDir, config) {
  const mix = path.join(outDir, 'audio', 'mix.wav');
  if (fs.existsSync(mix)) return mix;
  const external = config && config.narrationSource && config.narrationSource.file;
  if (external && fs.existsSync(external)) return external;
  return path.join(outDir, 'audio', 'full.wav');
}

function fullFallback(renderer, config, outDir, manifest, opts, outMp4, log, reason) {
  const webglScenes = (config.scenes || []).filter(s => s.three || s._threeModuleContents).length;
  if (renderer.name === 'hyperframes' && webglScenes > 12) {
    throw new Error(`isolated render failed and a full fallback would eagerly create ${webglScenes} WebGL contexts (${reason}); refusing a potentially blank render`);
  }
  if (opts._invocations && typeof opts._invocations === 'object') opts._invocations.full = (opts._invocations.full || 0) + 1;
  return fullRenderAndCache(renderer, config, outDir, manifest, opts, outMp4, log);
}

/* Render through the cache. Returns the same shape the renderer's render()
 * returns ({ mp4, seconds, dir, project, renderer }) so it is a drop-in.
 *
 * - per-scene renderer: reuse valid spans, render only the rest via
 *   renderer.renderSpans(), assemble with ffmpeg concat, then normally fall
 *   back to a full renderer.render(). WebGL-heavy films fail clearly instead
 *   of taking an unsafe eager-context fallback.
 * - whole-video renderer: reuse the whole MP4 if valid, else full render and
 *   store the result.
 * - none: delegate straight to renderer.render(). */
/* Build the measured reuse summary (CHANGE-2026-026 / NAR-007-036) attached
 * to every renderToMp4 result. `fallback` and `selectiveSkipped` name causes
 * plainly; a fallback re-render is never counted as reuse. CHANGE-2026-041
 * adds the per-scene reuse reason (NAR-007-048), dirty-unit elapsed seconds,
 * and renderer/provider invocation counts. */
function reuseSummary(cachePlan, spans, fallback = null, extra = {}) {
  const reasons = new Set();
  return {
    mode: cachePlan.mode,
    fallback,
    selectiveSkipped: cachePlan.selectiveSkipped || null,
    placementSensitive: cachePlan.placementSensitive || null,
    dirtySeconds: extra.dirtySeconds != null ? Math.round(extra.dirtySeconds * 1000) / 1000 : null,
    invocations: extra.invocations || null,
    spans: (spans || []).map(s => {
      const status = fallback ? 'fallback' : (s.reusable ? 'reused' : 'rendered');
      if (s.reason) reasons.add(s.reason);
      return {
        sceneId: s.sceneId,
        status,
        reason: fallback ? null : s.reason || null,
        seconds: s.expectedSeconds,
      };
    }),
    reasons: reasons.size ? [...reasons] : null,
  };
}

/* One-line per-scene reuse reason, for the build log (NAR-007-048). */
function logSpanReasons(spans, log) {
  const reused = spans.filter(s => s.reusable);
  const rendered = spans.filter(s => !s.reusable);
  if (rendered.length) {
    log('scene cache: re-render reasons — ' + rendered.map(s => `${s.sceneId}: ${s.reason}`).join(' · '));
  }
  const moved = reused.filter(s => s.reason && /placement/.test(s.reason));
  if (moved.length) {
    log('scene cache: reused with re-placement — ' + moved.map(s => `${s.sceneId} (${s.reason})`).join(', '));
  }
}

function renderToMp4(renderer, config, outDir, manifest, opts = {}) {
  const log = opts.log || (() => {});
  const name = opts.name || 'video.mp4';
  const outMp4 = path.join(outDir, name);
  const fps = Number(opts.fps || (manifest.format && manifest.format.fps) || 30);
  const quality = opts.quality || 'standard';
  const cachePlan = plan({ outDir, manifest, renderer, fps, quality, log });
  const mode = cachePlan.mode;
  const invocations = { spans: 0, full: 0 };
  let dirtySeconds = 0;
  // Thread the invocation counter through fallbacks so the reuse report
  // reflects every real renderer/provider call (NAR-007-048).
  opts._invocations = invocations;

  if (mode === 'per-scene' && typeof renderer.renderSpans === 'function') {
    const spans = cachePlan.spans;
    const needRender = spans.filter(s => !s.reusable);
    if (needRender.length === 0) {
      log(`scene cache: all ${spans.length} scene span(s) reused — rendering nothing`);
      logSpanReasons(spans, log);
    } else {
      log(`scene cache: rendering ${needRender.length} of ${spans.length} scene span(s) (${spans.length - needRender.length} reused)`);
      logSpanReasons(spans, log);
      const t0 = process.hrtime.bigint();
      try {
        invocations.spans = 1;
        renderer.renderSpans(config, outDir, needRender, {
          fps, quality, keepFrames: opts.keepFrames, artifact: opts.artifact,
        });
      } catch (e) {
        // Never fail the build over the cache: discard any half-written span
        // (atomic temp+rename in the renderer means none should exist, but be
        // safe) and fall through to a full render below.
        dirtySeconds = Number(process.hrtime.bigint() - t0) / 1e9;
        log(`scene cache: per-scene render failed (${e.message}) — falling back to full render`);
        for (const s of needRender) { try { fs.rmSync(s.spanFile, { force: true }); } catch {} }
        const fb = fullFallback(renderer, config, outDir, manifest, opts, outMp4, log, e.message);
        fb.reuse = reuseSummary(cachePlan, spans, `per-scene render failed: ${e.message}`, { dirtySeconds, invocations });
        return fb;
      }
      dirtySeconds += Number(process.hrtime.bigint() - t0) / 1e9;
    }
    // Re-validate after rendering (a freshly written span that came up short
    // would otherwise produce a broken concat). Any invalid span -> full fallback.
    const broken = spans.filter(s => !spanIsValid(s.spanFile, s.expectedSeconds));
    if (broken.length) {
      log(`scene cache: ${broken.length} span(s) invalid after render — falling back to full render`);
      const fb = fullFallback(renderer, config, outDir, manifest, opts, outMp4, log, `${broken.length} invalid span(s)`);
      fb.reuse = reuseSummary(cachePlan, spans, `${broken.length} invalid span(s) after render`, { dirtySeconds, invocations });
      return fb;
    }
    const audio = fullAudioPath(outDir, config);
    if (!fs.existsSync(audio)) {
      log('scene cache: full narration audio missing — falling back to full render');
      const fb = fullFallback(renderer, config, outDir, manifest, opts, outMp4, log, 'full narration audio missing');
      fb.reuse = reuseSummary(cachePlan, spans, 'full narration audio missing', { dirtySeconds, invocations });
      return fb;
    }
    try {
      assembleFromSpans(spans, audio, outMp4, log);
    } catch (e) {
      log(`scene cache: concat failed (${e.message}) — falling back to full render`);
      const fb = fullFallback(renderer, config, outDir, manifest, opts, outMp4, log, `concat failed: ${e.message}`);
      fb.reuse = reuseSummary(cachePlan, spans, `concat failed: ${e.message}`, { dirtySeconds, invocations });
      return fb;
    }
    // Persist the identity snapshot so the NEXT build can attribute reuse
    // reasons and honor start-sensitive placement. Written after success only.
    writeIdentities(outDir, identitySnapshot(manifest, cachePlan.contextHash, cachePlan.placementSensitive));
    // Record each span's placement/ordinal sidecar (reused and fresh alike) so
    // a later revert or placement shift can validate reuse independently of the
    // latest snapshot.
    for (const span of spans) writeSpanSidecar(span, manifest.scenes[span.sceneIndex]);
    pruneCache(cacheDir(outDir), spans.map(s => s.spanFile));
    return {
      mp4: outMp4, seconds: probe(outMp4), dir: outDir, project: outDir, renderer: renderer.name,
      reuse: reuseSummary(cachePlan, spans, null, { dirtySeconds, invocations }),
    };
  }

  if (mode === 'whole-video') {
    // Always refresh the composition dir (out/hf-*) even on a cache hit so
    // preview / shots / studio see a fresh project — the cache only skips the
    // expensive render, never the cheap compose. A compose failure must not
    // block serving a valid cached video, so it is best-effort.
    let composed = {};
    try {
      if (typeof renderer.compose === 'function') composed = renderer.compose(config, outDir) || {};
      if (composed.dir && typeof opts.artifact === 'function') opts.artifact(composed.dir, 'renderer-project');
    } catch (e) {
      log(`scene cache: compose refresh skipped (${e.message})`);
    }
    if (cachePlan.reused) {
      fs.copyFileSync(cachePlan.wholeFile, outMp4);
      if (typeof opts.artifact === 'function') opts.artifact(outMp4, 'video');
      log(`scene cache: whole-video reuse (${renderer.displayName}) — render skipped`);
      return {
        ...composed, mp4: outMp4, seconds: probe(outMp4), project: composed.dir || outDir,
        reuse: { mode: 'whole-video', fallback: null, selectiveSkipped: cachePlan.selectiveSkipped || null, spans: null, wholeVideoReused: true, invocations },
      };
    }
    log(`scene cache: whole-video miss (${renderer.displayName}) — full render, then cached`);
    invocations.full += 1;
    const rendered = renderer.render(config, outDir, opts);
    // Store atomically so a crash mid-copy never leaves a corrupt cached MP4.
    try {
      ensureDir(path.dirname(cachePlan.wholeFile));
      const tmp = cachePlan.wholeFile + '.tmp';
      fs.copyFileSync(rendered.mp4, tmp);
      fs.renameSync(tmp, cachePlan.wholeFile);
      pruneCache(cacheDir(outDir), [cachePlan.wholeFile]);
    } catch (e) {
      log(`scene cache: could not store whole-video cache (${e.message}) — build result is unaffected`);
    }
    rendered.reuse = { mode: 'whole-video', fallback: null, selectiveSkipped: cachePlan.selectiveSkipped || null, spans: null, wholeVideoReused: false, invocations };
    return rendered;
  }

  // mode === 'none' — no caching for this renderer.
  invocations.full += 1;
  const direct = renderer.render(config, outDir, opts);
  direct.reuse = direct.reuse || { mode: 'none', fallback: null, selectiveSkipped: null, spans: null };
  return direct;
}

/* Full render via the renderer, then (for per-scene renderers) split the
 * result into spans so the NEXT build can reuse them. This is the fallback for
 * any cache failure: produces a correct video and opportunistically repopulates
 * the cache so recovery is automatic. */
function fullRenderAndCache(renderer, config, outDir, manifest, opts, outMp4, log) {
  const rendered = renderer.render(config, outDir, opts);
  // Only per-scene renderers carry a span concept worth repopulating here.
  if (renderer.cache && renderer.cache.mode === 'per-scene' && typeof renderer.splitSpans === 'function') {
    try {
      if (manifest) {
        const fps = Number(opts.fps || (manifest.format && manifest.format.fps) || 30);
        const contextHash = renderContextHash(manifest, { fps, quality: opts.quality });
        const spans = planSpans(manifest, contextHash, fps, outDir, {
          placementSensitive: placementSensitive(manifest),
          globalTime: !(renderer && renderer.cache && renderer.cache.isolated),
          ordinalSensitive: ordinalSensitive(),
          identities: readIdentities(outDir),
        });
        renderer.splitSpans(rendered.mp4, spans, fps, outDir);
        for (const span of spans) writeSpanSidecar(span, manifest.scenes[span.sceneIndex]);
        writeIdentities(outDir, identitySnapshot(manifest, contextHash, placementSensitive(manifest)));
        pruneCache(cacheDir(outDir), spans.map(s => s.spanFile));
        log('scene cache: repopulated spans from full render');
      }
    } catch (e) {
      log(`scene cache: could not repopulate spans (${e.message})`);
    }
  }
  return rendered;
}

/* Retain cache entries beyond the current build within a bounded budget.
 * The goal: "returning to a recently explored visual treatment should often
 * be effectively free." Current-build spans are always protected. Older
 * entries are pruned when the cache exceeds a size limit (500 MB default)
 * or a count limit (100 spans default), using LRU (oldest access time first).
 * This enables A→B→C→"actually B was better" workflows. */
const CACHE_MAX_SIZE = 500 * 1024 * 1024; // 500 MB
const CACHE_MAX_SPANS = 100;

function pruneCache(dir, keepFiles) {
  const keep = new Set(keepFiles.map(f => path.resolve(f)));
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }

  // Compute total size and count. Only MP4 span files participate in the
  // budget; metadata (identities.json, per-span sidecars) is never pruned.
  let totalSize = 0;
  const files = [];
  for (const name of entries) {
    if (!name.endsWith('.mp4')) continue;
    if (name.startsWith('.') || name.endsWith('.tmp') || name.endsWith('.tmp.mp4')) continue;
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      totalSize += st.size;
      files.push({ path: full, name, size: st.size, mtime: st.mtimeMs });
    } catch {}
  }

  // Always keep current-build spans.
  const protectedPaths = new Set(keep);

  // Prune only if over budget.
  const overSize = totalSize > CACHE_MAX_SIZE;
  const overCount = files.length > CACHE_MAX_SPANS;
  if (!overSize && !overCount) return;

  // LRU: oldest access (mtime) first. Walk the sorted array and delete
  // non-protected entries until BOTH budgets are satisfied.
  //
  // IMPORTANT: do NOT mutate `files.length` during the for..of loop. The prior
  // implementation did `files.length--` after each delete, which desynchronizes
  // the array iterator whenever a protected entry is skipped with `continue`
  // (the index advances but the length only shrinks on deletes). With enough
  // old protected entries the iterator then terminates early and the cache is
  // left OVER budget (proven: 200 entries with the oldest 100 protected left
  // 150 survivors, 50 over the count budget). Track survivors in plain counters
  // instead — the array stays intact for the whole iteration.
  files.sort((a, b) => a.mtime - b.mtime);
  let survivorCount = files.length;
  let survivorSize = totalSize;
  for (const f of files) {
    if (protectedPaths.has(f.path)) continue; // current-build span: always retained
    if (survivorCount <= CACHE_MAX_SPANS && survivorSize <= CACHE_MAX_SIZE) break;
    try { fs.rmSync(f.path, { force: true }); } catch {}
    survivorCount--;
    survivorSize -= f.size;
  }
}

/* One-line, human-readable cache status for `build --plan`. Reflects the same
 * plan() the real build uses, so it is an accurate prediction of what the
 * cache will do for the manifest given the current renderer/options. */
function formatCacheStatus(cachePlan) {
  if (!cachePlan || cachePlan.mode === 'none') {
    return 'cache: not supported for this renderer';
  }
  if (cachePlan.selectiveSkipped) {
    const reuse = cachePlan.reused
      ? 'previous MP4 reusable — render would be skipped'
      : 'miss — full render required';
    return `cache (whole-video, selective skipped): ${reuse} — ${cachePlan.selectiveSkipped}`;
  }
  if (cachePlan.mode === 'per-scene') {
    const total = cachePlan.spans.length;
    return `cache (per-scene): ${cachePlan.reused}/${total} span(s) reusable — ${cachePlan.renderCount} scene(s) would re-render`;
  }
  return cachePlan.reused
    ? `cache (whole-video): previous MP4 reusable — render would be skipped`
    : `cache (whole-video): miss — full render required`;
}

module.exports = {
  CACHE_DIR, cacheDir,
  renderContextHash, sceneTimingsFingerprint, sceneCacheKey, wholeVideoKey,
  sceneAssetIdentity, hasExecutableJs, placementSensitive,
  identitySnapshot, readIdentities, writeIdentities,
  spanIsValid, planSpans, plan, assembleFromSpans, renderToMp4, fullAudioPath,
  formatCacheStatus, selectiveRenderSafe, pruneCache, reuseSummary, writeSpanSidecar, readSpanSidecar,
};
