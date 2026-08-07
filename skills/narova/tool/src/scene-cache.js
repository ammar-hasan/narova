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
 *   - 'per-scene' (no-browser): render only the scenes whose key changed;
 *     composite cached + fresh spans with ffmpeg concat (setsar=1, per
 *     AGENTS.md) and mux the single authoritative full audio track so splice
 *     points can never drift.
 *   - 'whole-video' (hyperframes): HyperFrames renders the full timeline as
 *     one MP4 and exposes no frame-range option, so a single-scene change
 *     still needs a full render. The cache reuses the whole MP4 when NOTHING
 *     changed (the common "iterate audio/text, visuals stable" case) and
 *     stores each successful render for the next build. Declared loudly rather
 *     than silently degrading.

 * Determinism contract: a cached span is reused ONLY if reproducing it would
 * yield the same pixels. The cache key is sha256(renderContextHash +
 * sceneHash + sceneTimingsFingerprint) — content, shared render context, and
 * measured word/turn timings. If anything differs, the span is re-rendered. If
 * a cached file is missing, empty, or its probed duration is wrong, it is
 * treated as invalid and re-rendered. Any failure in the cached path falls
 * back to a full renderer.render() so a cache problem can never fail a build. */

const fs = require('fs');
const path = require('path');
const { ensureDir, sh, probe } = require('./util');
const { sha256 } = require('./manifest');

const CACHE_DIR = '.scene-cache';
const TOLERANCE = 0.08; // seconds: probed-vs-expected span duration slack

function cacheDir(outDir) { return path.join(outDir, CACHE_DIR); }

/* Shared render context: every project-level input that influences ALL scenes'
 * rendered pixels. A change here invalidates every span (correct — these are
 * shared inputs). Drawn from the enriched manifest so audio/timing/asset
 * content hashes are included.
 *
 * The monolithic `hashes.config` and per-scene `hashes.scenefile:*` entries are
 * deliberately EXCLUDED: `config` flips on any scene edit (defeating per-scene
 * caching) and per-scene file contents are already captured in each scene's own
 * hash. Only genuinely shared inputs (theme css, project choreography, imports,
 * markers, captions, chrome, series, and project asset / bed / sfx / clip /
 * walkthrough-capture file hashes) are kept. An asset change therefore
 * re-renders every span — conservative but never stale.
 *
 * Dependency model:
 *   GLOBAL (in contextHash) — change invalidates all scenes
 *     theme (tokens + css), chrome, captions config, markers, series,
 *     project choreography, imports, voices, renderer version, fps, quality,
 *     format, asset hashes (bed/sfx/clip/capture files), walkthrough manifests
 *   LOCAL (in sceneHash + timings) — change invalidates only that scene
 *     scene body, visual, three, threeModule, clip path, walkthrough ref,
 *     transition, vo text, scene choreo/script file contents,
 *     measured word/turn timings */
function renderContextHash(manifest, opts = {}) {
  const m = manifest || {};
  const sharedHashes = {};
  for (const [k, v] of Object.entries(m.hashes || {})) {
    if (k === 'config') continue;
    if (k.startsWith('scenefile:')) continue;
    sharedHashes[k] = v;
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
    voices: m.voices,
    markers: m.markers,
    series: m.series,
    platform: (m.project && m.project.platform) || null,
    includePatterns: m.includePatterns,
    hashes: sharedHashes,
    quality: opts.quality || 'standard',
    fps: opts.fps || (m.format && m.format.fps) || 30,
  };
  return sha256(JSON.stringify(payload));
}

/* Measured word/turn timings for ONE scene (post-synth). Caption reveals,
 * data-cue motion, and per-turn animations are driven by these, so a re-synth
 * that shifts timings (even with identical text) must invalidate the span. */
function sceneTimingsFingerprint(scene) {
  const payload = {
    id: scene.id,
    duration: scene.duration,
    start: scene.start,
    vo: (scene.vo || []).map(t => ({
      start: t.start,
      words: (t.words || []).map(w => [w.w, w.t0, w.t1]),
    })),
  };
  return sha256(JSON.stringify(payload));
}

/* The full cache key for one scene span: content + measured timings + shared
 * render context. A span is reusable iff this key is stable. */
function sceneCacheKey(scene, contextHash) {
  return sha256([contextHash, scene.hash || '', sceneTimingsFingerprint(scene)].join('\n'));
}

/* Whole-video cache key: render context + every scene's content & timings.
 * Any single-scene change flips this key, forcing a full renderer.render(). */
function wholeVideoKey(manifest, contextHash) {
  const sceneKeys = (manifest.scenes || [])
    .map(s => (s.hash || '') + '\n' + sceneTimingsFingerprint(s))
    .join('\n');
  return sha256(contextHash + '\n' + sceneKeys);
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
function planSpans(manifest, contextHash, fps, outDir) {
  const scenes = manifest.scenes || [];
  const total = manifest.totalDuration || scenes.reduce((n, s) => n + (s.duration || 0), 0);
  const totalFrames = Math.max(1, Math.ceil(total * fps));
  const starts = scenes.map(s => (s.start || 0));
  return scenes.map((s, i) => {
    const frameStart = i === 0 ? 0 : Math.round(starts[i] * fps);
    const frameEnd = i === scenes.length - 1 ? totalFrames : Math.round(starts[i + 1] * fps);
    const frameCount = Math.max(0, frameEnd - frameStart);
    const expectedSeconds = frameCount / fps;
    const cacheKey = sceneCacheKey(s, contextHash);
    const spanFile = path.join(cacheDir(outDir), `${cacheKey}.mp4`);
    const reusable = spanIsValid(spanFile, expectedSeconds);
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
    };
  });
}

/* Decide what to reuse vs render. Returns { mode, contextHash, spans?,
 * wholeKey?, wholeFile?, reused, renderCount }. */
function plan({ outDir, manifest, renderer, fps, quality }) {
  const mode = (renderer && renderer.cache && renderer.cache.mode) || 'none';
  const contextHash = renderContextHash(manifest, { fps, quality });
  if (mode === 'per-scene') {
    const spans = planSpans(manifest, contextHash, fps, outDir);
    return {
      mode, contextHash, spans,
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
      renderCount: reusable ? 0 : 1,
    };
  }
  return { mode: 'none', contextHash, reused: 0, renderCount: 1 };
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

/* Render through the cache. Returns the same shape the renderer's render()
 * returns ({ mp4, seconds, dir, project, renderer }) so it is a drop-in.
 *
 * - per-scene renderer: reuse valid spans, render only the rest via
 *   renderer.renderSpans(), assemble with ffmpeg concat, then fall back to a
 *   full renderer.render() on any failure.
 * - whole-video renderer: reuse the whole MP4 if valid, else full render and
 *   store the result.
 * - none: delegate straight to renderer.render(). */
function renderToMp4(renderer, config, outDir, manifest, opts = {}) {
  const log = opts.log || (() => {});
  const name = opts.name || 'video.mp4';
  const outMp4 = path.join(outDir, name);
  const fps = Number(opts.fps || (manifest.format && manifest.format.fps) || 30);
  const quality = opts.quality || 'standard';
  const cachePlan = plan({ outDir, manifest, renderer, fps, quality });
  const mode = cachePlan.mode;

  if (mode === 'per-scene' && typeof renderer.renderSpans === 'function') {
    const spans = cachePlan.spans;
    const needRender = spans.filter(s => !s.reusable);
    if (needRender.length === 0) {
      log(`scene cache: all ${spans.length} scene span(s) reused — rendering nothing`);
    } else {
      log(`scene cache: rendering ${needRender.length} of ${spans.length} scene span(s) (${spans.length - needRender.length} reused)`);
      try {
        renderer.renderSpans(config, outDir, needRender, { fps, quality, keepFrames: opts.keepFrames });
      } catch (e) {
        // Never fail the build over the cache: discard any half-written span
        // (atomic temp+rename in the renderer means none should exist, but be
        // safe) and fall through to a full render below.
        log(`scene cache: per-scene render failed (${e.message}) — falling back to full render`);
        for (const s of needRender) { try { fs.rmSync(s.spanFile, { force: true }); } catch {} }
        return fullRenderAndCache(renderer, config, outDir, manifest, opts, outMp4, log);
      }
    }
    // Re-validate after rendering (a freshly written span that came up short
    // would otherwise produce a broken concat). Any invalid span -> full fallback.
    const broken = spans.filter(s => !spanIsValid(s.spanFile, s.expectedSeconds));
    if (broken.length) {
      log(`scene cache: ${broken.length} span(s) invalid after render — falling back to full render`);
      return fullRenderAndCache(renderer, config, outDir, manifest, opts, outMp4, log);
    }
    const audio = fullAudioPath(outDir, config);
    if (!fs.existsSync(audio)) {
      log('scene cache: full narration audio missing — falling back to full render');
      return fullRenderAndCache(renderer, config, outDir, manifest, opts, outMp4, log);
    }
    try {
      assembleFromSpans(spans, audio, outMp4, log);
    } catch (e) {
      log(`scene cache: concat failed (${e.message}) — falling back to full render`);
      return fullRenderAndCache(renderer, config, outDir, manifest, opts, outMp4, log);
    }
    pruneCache(cacheDir(outDir), spans.map(s => s.spanFile));
    return { mp4: outMp4, seconds: probe(outMp4), dir: outDir, project: outDir, renderer: renderer.name };
  }

  if (mode === 'whole-video') {
    // Always refresh the composition dir (out/hf-*) even on a cache hit so
    // preview / shots / studio see a fresh project — the cache only skips the
    // expensive render, never the cheap compose. A compose failure must not
    // block serving a valid cached video, so it is best-effort.
    let composed = {};
    try {
      if (typeof renderer.compose === 'function') composed = renderer.compose(config, outDir) || {};
    } catch (e) {
      log(`scene cache: compose refresh skipped (${e.message})`);
    }
    if (cachePlan.reused) {
      fs.copyFileSync(cachePlan.wholeFile, outMp4);
      log(`scene cache: whole-video reuse (${renderer.displayName}) — render skipped`);
      return { ...composed, mp4: outMp4, seconds: probe(outMp4), project: composed.dir || outDir };
    }
    log(`scene cache: whole-video miss (${renderer.displayName}) — full render, then cached`);
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
    return rendered;
  }

  // mode === 'none' — no caching for this renderer.
  return renderer.render(config, outDir, opts);
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
        const spans = planSpans(manifest, contextHash, fps, outDir);
        renderer.splitSpans(rendered.mp4, spans, fps, outDir);
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

  // Compute total size and count.
  let totalSize = 0;
  const files = [];
  for (const name of entries) {
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

  // Sort by age (oldest first), then prune until within budget.
  files.sort((a, b) => a.mtime - b.mtime);
  for (const f of files) {
    if (protectedPaths.has(f.path)) continue;
    // Stop pruning once within both limits.
    if (!overCount || files.length <= CACHE_MAX_SPANS) {
      if (!overSize || totalSize <= CACHE_MAX_SIZE) break;
    }
    try { fs.rmSync(f.path, { force: true }); } catch {}
    totalSize -= f.size;
    files.length--; // track remaining count
  }
}

/* One-line, human-readable cache status for `build --plan`. Reflects the same
 * plan() the real build uses, so it is an accurate prediction of what the
 * cache will do for the manifest given the current renderer/options. */
function formatCacheStatus(cachePlan) {
  if (!cachePlan || cachePlan.mode === 'none') {
    return 'cache: not supported for this renderer';
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
  spanIsValid, planSpans, plan, assembleFromSpans, renderToMp4, fullAudioPath,
  formatCacheStatus,
};
