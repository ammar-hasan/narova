'use strict';
/* Tests for the scene-level render cache.
 *
 * Unit tests cover the cache-key logic (no ffmpeg). Integration tests build a
 * real multi-scene no-browser project twice with external narration and assert:
 *   - an unchanged second build reuses 100% of spans (renders nothing),
 *   - a single-scene change re-renders only that scene,
 *   - a missing/corrupt span falls back without failing the build,
 *   - the final concatenated MP4 is duration-correct. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { compile, mergeTimings } = require('../src/manifest');
const { resolveConfig } = require('../src/schema');
const sc = require('../src/scene-cache');
const { build } = require('../src/pipeline');
const { getRenderer } = require('../src/renderers');
const hyperframes = require('../src/renderers/hyperframes');

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
let HAS_CANVAS = false;
try { require.resolve('@napi-rs/canvas'); HAS_CANVAS = true; } catch {}
const CAN_RENDER = HAS_FFMPEG && HAS_CANVAS;

// ---- unit: cache-key inputs --------------------------------------------------

function makeManifest(sceneBodies) {
  const bodies = sceneBodies || ['<p>1</p>', '<p>2</p>'];
  const cfg = resolveConfig({
    title: 'Cache', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [
      { id: 's1', vo: [{ who: 'a', text: 'One.' }], body: bodies[0] },
      { id: 's2', vo: [{ who: 'a', text: 'Two.' }], body: bodies[1] },
    ],
  }, {}, os.tmpdir());
  const m = compile(cfg, { toolVersion: '0.23.0' });
  // Simulate post-synth enrichment so measured timings are present (the cache
  // key includes them). mergeTimings reads from a file, so write one. Both
  // scenes get identical timings so a body-only change isolates the
  // content-hash component.
  const timingsFile = path.join(os.tmpdir(), `narova-cache-timings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(timingsFile, JSON.stringify({
    total: 4,
    s1: { dur: 2, turns: [0.2], words: [{ w: 'One.', t0: 0.2, t1: 0.6, si: 0 }] },
    s2: { dur: 2, turns: [0.2], words: [{ w: 'Two.', t0: 0.2, t1: 0.6, si: 0 }] },
  }));
  const enriched = mergeTimings(m, timingsFile);
  fs.rmSync(timingsFile, { force: true });
  return enriched;
}

test('sceneCacheKey is stable for identical input', () => {
  const m = makeManifest();
  const ctx = sc.renderContextHash(m, { fps: 30 });
  const k1 = sc.sceneCacheKey(m.scenes[0], ctx);
  const k2 = sc.sceneCacheKey(m.scenes[0], ctx);
  assert.equal(k1, k2);
});

test('sceneCacheKey changes when scene body content changes', () => {
  const m = makeManifest(['<p>1</p>', '<p>2</p>']);
  const changed = makeManifest(['<p>1</p>', '<p>changed</p>']);
  const ctx = sc.renderContextHash(m, { fps: 30 });
  const ctx2 = sc.renderContextHash(changed, { fps: 30 });
  // Render context is unchanged by a scene-body edit (it's project-level)…
  assert.equal(ctx, ctx2);
  // …but scene 2's cache key flips, while scene 1's stays the same.
  assert.notEqual(sc.sceneCacheKey(changed.scenes[1], ctx), sc.sceneCacheKey(m.scenes[1], ctx));
  assert.equal(sc.sceneCacheKey(changed.scenes[0], ctx), sc.sceneCacheKey(m.scenes[0], ctx));
});

test('sceneCacheKey changes when measured timings change (re-synth drift)', () => {
  const m = makeManifest();
  const ctx = sc.renderContextHash(m, { fps: 30 });
  // Same text + body, but timings drift on scene 2 (e.g. a non-deterministic
  // re-synth). The span must invalidate even though content hash is identical.
  const drifted = { ...m, scenes: m.scenes.map((s, i) => i === 1
    ? { ...s, vo: [{ ...s.vo[0], words: [{ w: 'Two.', t0: 0.25, t1: 0.7, si: 0 }] }] }
    : s) };
  assert.equal(drifted.scenes[1].hash, m.scenes[1].hash, 'precondition: content hash identical');
  assert.notEqual(sc.sceneCacheKey(drifted.scenes[1], ctx), sc.sceneCacheKey(m.scenes[1], ctx));
  assert.equal(sc.sceneCacheKey(drifted.scenes[0], ctx), sc.sceneCacheKey(m.scenes[0], ctx));
});

test('sceneCacheKey changes when shared render context changes (theme/quality/fps)', () => {
  const m = makeManifest();
  const base = sc.renderContextHash(m, { fps: 30, quality: 'standard' });
  const themeChanged = sc.renderContextHash({ ...m, theme: { ...m.theme, accent: '#ff0000' } }, { fps: 30, quality: 'standard' });
  const qualityChanged = sc.renderContextHash(m, { fps: 30, quality: 'high' });
  const fpsChanged = sc.renderContextHash(m, { fps: 60, quality: 'standard' });
  assert.notEqual(base, themeChanged);
  assert.notEqual(base, qualityChanged);
  assert.notEqual(base, fpsChanged);
  // And the per-scene key inherits the context change → every span invalidates.
  assert.notEqual(sc.sceneCacheKey(m.scenes[0], themeChanged), sc.sceneCacheKey(m.scenes[0], base));
});

test('legacy missing safeLayout hashes as historical safe geometry, not raw', () => {
  const m = makeManifest();
  delete m.safeLayout;
  const legacy = sc.renderContextHash(m, { fps: 30 });
  const explicitSafe = sc.renderContextHash({ ...m, safeLayout: true }, { fps: 30 });
  const explicitRaw = sc.renderContextHash({ ...m, safeLayout: false }, { fps: 30 });
  assert.equal(legacy, explicitSafe);
  assert.notEqual(legacy, explicitRaw);
});

test('wholeVideoKey changes when any single scene changes', () => {
  const m = makeManifest();
  const ctx = sc.renderContextHash(m, { fps: 30 });
  // Flip scene 0's content hash (as a real body edit would) without touching
  // anything else. wholeVideoKey aggregates every scene's hash + timings, so a
  // single scene's change must flip the whole-video key → full re-render.
  const changed = { ...m, scenes: m.scenes.map((s, i) => i === 0 ? { ...s, hash: s.hash + '-changed' } : s) };
  const ctx2 = sc.renderContextHash(changed, { fps: 30 });
  assert.equal(ctx, ctx2, 'a content-only edit does not change shared context');
  assert.notEqual(sc.wholeVideoKey(changed, ctx2), sc.wholeVideoKey(m, ctx));
});

// CHANGE-2026-041 / NAR-007-043: voice audio identity (backend/speaker/
// options) must not invalidate pixels; only presentation (label/color) does.
test('audio-only voice change leaves the visual context unchanged', () => {
  const m = makeManifest();
  const base = sc.renderContextHash(m, { fps: 30 });
  // Same speaker label/color, different audio identity (backend/speaker/gain).
  const audioOnly = { ...m, voices: { ...m.voices, a: { ...m.voices.a, backend: 'elevenlabs', speaker: 'other', gainDb: 2, providerOptions: { model: 'x' } } } };
  assert.equal(sc.renderContextHash(audioOnly, { fps: 30 }), base, 'audio-only voice change does not invalidate visuals');
  // A presentation change (label or color) does.
  const visual = { ...m, voices: { ...m.voices, a: { ...m.voices.a, color: '#ff0000' } } };
  assert.notEqual(sc.renderContextHash(visual, { fps: 30 }), base, 'voice presentation change invalidates visuals');
});

// CHANGE-2026-041 / NAR-007-045: absolute placement is assembly metadata, not
// a pixel input. Shifting every later scene's start (as an earlier duration
// change does) must leave the scene's cache key stable.
test('sceneCacheKey is placement-independent (start is not a pixel input)', () => {
  const m = makeManifest();
  const ctx = sc.renderContextHash(m, { fps: 30 });
  const delta = 3.7;
  // Simulate a real placement shift: mergeTimings recomputes both the absolute
  // scene start AND each turn's absolute start, so both must move together.
  const moved = {
    ...m,
    scenes: m.scenes.map(s => ({
      ...s,
      start: s.start + delta,
      vo: (s.vo || []).map(t => t.start == null ? t : { ...t, start: t.start + delta }),
    })),
  };
  assert.equal(sc.sceneCacheKey(m.scenes[1], ctx), sc.sceneCacheKey(moved.scenes[1], ctx));
  // And the timing fingerprint itself is placement-independent but still
  // sensitive to the scene's own measured duration.
  assert.equal(sc.sceneTimingsFingerprint(m.scenes[1]), sc.sceneTimingsFingerprint(moved.scenes[1]));
  const longer = { ...moved, scenes: moved.scenes.map((s, i) => i === 1 ? { ...s, duration: s.duration + 1 } : s) };
  assert.notEqual(sc.sceneTimingsFingerprint(m.scenes[1]), sc.sceneTimingsFingerprint(longer.scenes[1]));
});

// CHANGE-2026-041 / NAR-007-044: an asset edit invalidates only the scenes that
// reference it; an unreferenced asset edit invalidates none.
test('scene-scoped asset identity: only referencing scenes invalidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-assets-'));
  try {
    const assetsDir = path.join(root, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'a.png'), 'aaa');
    fs.writeFileSync(path.join(assetsDir, 'b.png'), 'bbb');
    fs.writeFileSync(path.join(assetsDir, 'unused.png'), 'zzz');
    const make = (over = {}) => resolveConfig({
      title: 'Assets', size: '16:9',
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      assets: 'assets',
      scenes: [
        { id: 's1', vo: [{ who: 'a', text: 'One.' }], body: `<div style="background:url('assets/a.png')"></div>` },
        { id: 's2', vo: [{ who: 'a', text: 'Two.' }], body: `<div style="background:url('assets/b.png')"></div>` },
      ],
      ...over,
    }, {}, root);
    const m = compile(make(), { toolVersion: '0.23.0' });
    const ctx = sc.renderContextHash(m, { fps: 30 });
    const k2 = sc.sceneCacheKey(m.scenes[1], ctx, sc.sceneAssetIdentity(m, 1));

    // Edit a.png (referenced only by s1).
    fs.writeFileSync(path.join(assetsDir, 'a.png'), 'aaa-edited');
    const m2 = compile(make(), { toolVersion: '0.23.0' });
    const ctx2 = sc.renderContextHash(m2, { fps: 30 });
    assert.equal(ctx, ctx2, 'asset edits do not change shared render context');
    const k1Edited = sc.sceneCacheKey(m2.scenes[0], ctx, sc.sceneAssetIdentity(m2, 0));
    assert.notEqual(k1Edited, sc.sceneCacheKey(m.scenes[0], ctx, sc.sceneAssetIdentity(m, 0)), 'referencing scene invalidates');
    assert.equal(sc.sceneCacheKey(m2.scenes[1], ctx, sc.sceneAssetIdentity(m2, 1)), k2, 'unrelated scene reuses');

    // Edit an unreferenced asset → nothing invalidates (baseline: post-edit m2).
    fs.writeFileSync(path.join(assetsDir, 'unused.png'), 'zzz-edited');
    const m3 = compile(make(), { toolVersion: '0.23.0' });
    assert.equal(sc.sceneCacheKey(m3.scenes[0], ctx, sc.sceneAssetIdentity(m3, 0)), k1Edited, 'unreferenced asset invalidates nothing');
    assert.equal(sc.sceneCacheKey(m3.scenes[1], ctx, sc.sceneAssetIdentity(m3, 1)), k2, 'unreferenced asset invalidates nothing');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / NAR-007-046 + NAR-004-023: placement sensitivity is driven
// by whether the scene's pixels can depend on absolute placement. The chrome
// progress bar is drawn from global time for every renderer, so enabling it
// makes every scene placement-sensitive; marker-consuming scenes (executable JS
// in a project with markers) are also placement-sensitive. Without those, a
// local-time scene is placement-independent.
test('placementSensitive follows the scene pixel dependencies', () => {
  const m = makeManifest(); // chrome normalized to all-off, no markers
  assert.equal(sc.placementSensitive(m, m.scenes[0]), false, 'no progress bar, no markers → placement-independent');
  const withProgress = { ...m, chrome: { ...(m.chrome || {}), progress: true } };
  assert.equal(sc.placementSensitive(withProgress, withProgress.scenes[0]), true, 'global progress bar → placement-sensitive for every renderer');
  const withMarkers = { ...m, markers: { m1: 1.5 } };
  assert.equal(sc.placementSensitive(withMarkers, withMarkers.scenes[0]), true,
    'any marker-bearing project is placement-sensitive (declarative data-cue="marker:name" consumers included)');
});

// CHANGE-2026-041 / NAR-007-044: a portable-visual SVG node loads pixels from
// its `src`; editing it must invalidate the scene. (Adversarial review finding.)
test('svg visual src is tracked as a scene asset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-svg-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'x.svg'), '<svg/>');
    const make = () => compile(resolveConfig({
      title: 'SVG', size: '16:9',
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      scenes: [{ id: 's', vo: [{ who: 'a', text: 'Hi.' }], visual: { type: 'svg', src: 'assets/x.svg' } }],
    }, {}, root), { toolVersion: '0.23.0' });
    const a = make();
    const ia = sc.sceneAssetIdentity(a, 0);
    assert.ok(Object.keys(a.scenes[0].assets).length > 0, 'svg src is a tracked asset');
    fs.writeFileSync(path.join(root, 'assets', 'x.svg'), '<svg><circle/></svg>');
    const b = make();
    assert.notEqual(sc.sceneAssetIdentity(b, 0), ia, 'editing the svg invalidates the scene');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / NAR-007-044: with a custom assets directory, body
// references use the `assets/` mount (the configured directory's contents), so
// an edit to the underlying file must invalidate the referencing scene.
// (Adversarial review finding.)
test('custom assets directory resolves body references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-customassets-'));
  try {
    fs.mkdirSync(path.join(root, 'media'), { recursive: true });
    fs.writeFileSync(path.join(root, 'media', 'x.png'), 'one');
    const make = () => compile(resolveConfig({
      title: 'CA', size: '16:9', assets: 'media',
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      scenes: [{ id: 's', vo: [{ who: 'a', text: 'Hi.' }], body: '<img src="assets/x.png">' }],
    }, {}, root), { toolVersion: '0.23.0' });
    const a = make();
    const ia = sc.sceneAssetIdentity(a, 0);
    const refs = a.scenes[0].assets;
    assert.ok(Object.keys(refs).length > 0, 'the mount reference resolves to a tracked asset');
    assert.ok(Object.values(refs)[0] != null, 'the resolved hash is non-null');
    fs.writeFileSync(path.join(root, 'media', 'x.png'), 'two');
    const b = make();
    assert.notEqual(sc.sceneAssetIdentity(b, 0), ia, 'editing the underlying file invalidates the scene');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / NAR-007-044: an unresolved local reference (an asset the
// scanner cannot map to a file) must fall back conservatively to the whole
// asset tree, never to a null hash that silently never invalidates.
test('unresolved asset references fall back to the whole asset tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-unres-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'a.png'), 'one');
    // Body references a file that does not exist anywhere the scanner resolves.
    const make = () => compile(resolveConfig({
      title: 'UR', size: '16:9',
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      scenes: [{ id: 's', vo: [{ who: 'a', text: 'Hi.' }], body: '<img src="missing/ghost.png">' }],
    }, {}, root), { toolVersion: '0.23.0' });
    const a = make();
    assert.equal(a.scenes[0]._unresolvedAssetRefs, true, 'the scene is flagged unresolved');
    assert.equal(sc.sceneAssetIdentity(a, 0), a.assetTreeHash,
      'unresolved refs make the scene depend on the whole asset tree');
    // An edit anywhere in the tree now invalidates it (conservative).
    fs.writeFileSync(path.join(root, 'assets', 'a.png'), 'two');
    const b = make();
    assert.notEqual(sc.sceneAssetIdentity(b, 0), sc.sceneAssetIdentity(a, 0));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / NAR-007-044: whole-video mode (project choreography / JS
// imports can load any asset dynamically) must invalidate on ANY asset edit.
// (Adversarial review finding.)
test('whole-video key covers the full asset tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-wv-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'x.png'), 'one');
    fs.writeFileSync(path.join(root, 'choreo.js'),
      "document.querySelector('.hero').style.backgroundImage='url(assets/x.png)'");
    const make = () => compile(resolveConfig({
      title: 'WV', size: '16:9', assets: 'assets', choreography: 'choreo.js',
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      scenes: [{ id: 's', vo: [{ who: 'a', text: 'Hi.' }], body: '<div class="hero">x</div>' }],
    }, {}, root), { toolVersion: '0.23.0' });
    const a = make();
    const ca = sc.renderContextHash(a, { fps: 30 });
    const ka = sc.wholeVideoKey(a, ca);
    fs.writeFileSync(path.join(root, 'assets', 'x.png'), 'two');
    const b = make();
    const cb = sc.renderContextHash(b, { fps: 30 });
    assert.equal(ca, cb, 'context is unchanged by an asset edit');
    assert.notEqual(sc.wholeVideoKey(b, cb), ka, 'the whole-video key flips on any asset edit');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / NAR-007-042: whole-video cache entries are MP4s with audio
// muxed in, so a bed/SFX change must invalidate the whole-video key even though
// it never enters per-scene pixel identity. (Adversarial review finding.)
test('whole-video key includes audio (bed/sfx) identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-wvaudio-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'bed.wav'), 'one');
    const make = () => compile(resolveConfig({
      title: 'WV', size: '16:9',
      bed: { file: 'bed.wav' },
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      scenes: [{ id: 's', vo: [{ who: 'a', text: 'Hi.' }], body: 'x' }],
    }, {}, root), { toolVersion: '0.23.0' });
    const a = make();
    const ka = sc.wholeVideoKey(a, sc.renderContextHash(a, { fps: 30 }));
    fs.writeFileSync(path.join(root, 'bed.wav'), 'two');
    const b = make();
    assert.notEqual(sc.wholeVideoKey(b, sc.renderContextHash(b, { fps: 30 })), ka, 'bed change invalidates the whole-video key');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / NAR-007-046: any project defining markers is
// placement-sensitive for every scene (declarative data-cue="marker:name"
// consumers, Three at.marker), because isolated renders rebase markers against
// the scene start. (Adversarial review finding.)
test('marker-bearing projects are placement-sensitive without executable JS', () => {
  const m = makeManifest();
  const withMarkers = { ...m, markers: { reveal: 1.5 } };
  assert.equal(sc.placementSensitive(withMarkers, withMarkers.scenes[0]), true);
});

// CHANGE-2026-041 / NAR-007-044: an asset reference in an UNRECOGNIZED HTML
// attribute form must fall back conservatively (whole asset tree), not silently
// escape the dependency set. This bounds the open class of reference forms
// without enumerating attribute names. (Adversarial review residual class.)
test('unrecognized mount-path references fall back conservatively', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-closure-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'x.png'), 'one');
    const make = (body) => compile(resolveConfig({
      title: 'C', size: '16:9',
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      scenes: [{ id: 's', vo: [{ who: 'a', text: 'Hi.' }], body }],
    }, {}, root), { toolVersion: '0.23.0' });
    const closed = make('<img src="assets/x.png">');
    assert.equal(closed.scenes[0]._unresolvedAssetRefs, false, 'recognized ref is provably closed');
    const unknown = make('<div data-asset-path="assets/x.png">');
    assert.equal(unknown.scenes[0]._unresolvedAssetRefs, true, 'unrecognized ref form is conservative');
    assert.equal(sc.sceneAssetIdentity(unknown, 0), unknown.assetTreeHash, 'conservative cover is the whole asset tree');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / NAR-007-042: a global-time renderer samples the full
// project at absolute frame times, so a non-frame-aligned placement shift
// changes the frame-sampling PHASE and the required frame count by ±1 — reuse
// would drift the concat vs a clean build. (Adversarial review finding.)
test('global-time reuse rejects a non-frame-aligned placement shift', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-frames-'));
  try {
    const ctx = 'ctx';
    const mk = (d1) => ({
      totalDuration: d1 + 1.02 + 1,
      scenes: [
        { id: 'a', hash: 'a', index: 0, start: 0, duration: d1, vo: [] },
        { id: 'b', hash: 'b', index: 1, start: d1, duration: 1.02, vo: [] },
        { id: 'c', hash: 'c', index: 2, start: d1 + 1.02, duration: 1, vo: [] },
      ],
    });
    const old = mk(1), neu = mk(1.02);
    const ids = sc.identitySnapshot(old, ctx, false);
    const oldSpans = sc.planSpans(old, ctx, 30, out, { placementSensitive: false, globalTime: false, identities: ids });
    const b = oldSpans[1]; // duration unchanged (key identical), placement shifts
    fs.mkdirSync(path.dirname(b.spanFile), { recursive: true });
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16',
      '-frames:v', String(b.frameCount), '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b.spanFile]);
    sc.writeSpanSidecar(b, old.scenes[1]);
    // Isolated/local-time renderer: placement-independent → reuses.
    const isolated = sc.planSpans(neu, ctx, 30, out, { placementSensitive: false, globalTime: false, ordinalSensitive: true, identities: ids });
    assert.equal(isolated[1].reusable, true, 'local-time renderer reuses across a phase-shifting placement');
    // Global-time renderer: sampling phase changed → re-renders.
    const globalTime = sc.planSpans(neu, ctx, 30, out, { placementSensitive: false, globalTime: true, ordinalSensitive: true, identities: ids });
    assert.equal(globalTime[1].reusable, false, 'global-time renderer re-renders on a phase shift');
    assert.match(globalTime[1].reason, /placement changed \(sampling phase\)/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / NAR-007-048: reuse reasons are attributed from the last
// identity snapshot, while the reuse DECISION is driven by the key-matched span
// and its sidecar (so a revert A→B→A reuses the still-valid A span).
test('planSpans attributes reuse reasons from the identity snapshot', () => {
  const m = makeManifest();
  const ctx = sc.renderContextHash(m, { fps: 30 });
  const delta = 3.7;
  const moved = {
    ...m,
    totalDuration: (m.totalDuration || 4) + delta, // every scene shifted by delta
    scenes: m.scenes.map(s => ({
      ...s,
      start: s.start + delta,
      vo: (s.vo || []).map(t => t.start == null ? t : { ...t, start: t.start + delta }),
    })),
  };
  const identities = sc.identitySnapshot(moved, ctx, false);
  // No span file + no sidecar → conservative miss with an attributable reason.
  const noPrior = sc.planSpans(m, ctx, 30, os.tmpdir(), { placementSensitive: false, globalTime: false, identities });
  assert.equal(noPrior[0].reusable, false);
  assert.match(noPrior[0].reason, /missing or invalid cached span/);
  // No identity snapshot at all → no prior cached identity.
  const cold = sc.planSpans(m, ctx, 30, os.tmpdir(), { placementSensitive: false, globalTime: false, identities: null });
  assert.equal(cold[0].reason, 'no prior cached identity');
  // Placement-sensitive + moved → re-render with the placement reason.
  if (HAS_FFMPEG) {
    const base = sc.planSpans(m, ctx, 30, os.tmpdir(), { placementSensitive: false, globalTime: false, identities });
    const cacheDir = path.join(os.tmpdir(), sc.CACHE_DIR);
    fs.mkdirSync(cacheDir, { recursive: true });
    try {
      for (const s of base) {
        spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=2',
          '-frames:v', String(s.frameCount), '-framerate', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', s.spanFile]);
        sc.writeSpanSidecar(s, m.scenes[s.sceneIndex]);
      }
      // Moved placement, placement-insensitive (isolated): reuses.
      const reused = sc.planSpans(moved, ctx, 30, os.tmpdir(), { placementSensitive: false, globalTime: false, identities });
      assert.equal(reused[1].reusable, true);
      assert.match(reused[1].reason, /placement changed; local visuals unchanged/);
      // Moved placement, placement-sensitive: re-renders with the placement reason.
      const sensitive = sc.planSpans(moved, ctx, 30, os.tmpdir(), { placementSensitive: true, globalTime: false, identities });
      assert.equal(sensitive[1].reusable, false);
      assert.match(sensitive[1].reason, /placement changed \(global-time scene\)/);
      // Moved ordinal, ordinal dependency (all current renderers): re-renders.
      // Reorder with recomputed starts/turns so the timeline is consistent.
      const reorderScene = (scene, newStart, turnStart) => ({
        ...scene,
        start: newStart,
        vo: (scene.vo || []).map(t => ({ ...t, start: turnStart })),
      });
      const reordered = {
        ...m,
        scenes: [
          reorderScene(m.scenes[1], 0, 0.2),
          reorderScene(m.scenes[0], 2, 2.2),
        ],
      };
      const ord = sc.planSpans(reordered, ctx, 30, os.tmpdir(), { placementSensitive: false, globalTime: false, ordinalSensitive: true, identities });
      assert.equal(ord[0].reusable, false);
      assert.match(ord[0].reason, /scene position changed \(global-time scene\)/);
    } finally { fs.rmSync(cacheDir, { recursive: true, force: true }); }
  }
});

test('planSpans tiles the timeline with no gaps or overlaps', () => {
  const m = makeManifest(); // 2 scenes, 2s each, total 4s
  const ctx = sc.renderContextHash(m, { fps: 30 });
  const spans = sc.planSpans(m, ctx, 30, os.tmpdir());
  assert.equal(spans.length, 2);
  assert.equal(spans[0].frameStart, 0);
  assert.equal(spans[0].frameEnd, spans[1].frameStart, 'boundary shared');
  assert.equal(spans[1].frameEnd, 120, 'last span ends at ceil(total*fps)');
  assert.equal(spans[0].frameEnd + (spans[1].frameEnd - spans[1].frameStart), 120);
});

test('spanIsValid rejects missing, empty, and wrong-duration files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cache-'));
  try {
    const good = path.join(tmp, 'good.mp4');
    const empty = path.join(tmp, 'empty.mp4');
    fs.writeFileSync(empty, '');
    assert.equal(sc.spanIsValid(path.join(tmp, 'nope.mp4'), 1), false, 'missing');
    assert.equal(sc.spanIsValid(empty, 1), false, 'empty');
    // A real (probed) span only when ffmpeg is available.
    if (HAS_FFMPEG) {
      spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=2',
        '-frames:v', '60', '-framerate', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', good]);
      assert.equal(sc.spanIsValid(good, 2), true, '2s file valid');
      assert.equal(sc.spanIsValid(good, 5), false, 'wrong expected duration invalid');
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('formatCacheStatus reports per-scene honestly for both renderers', () => {
  const m = makeManifest();
  const perScene = sc.plan({ outDir: os.tmpdir(), manifest: m, renderer: getRenderer('no-browser'), fps: 30 });
  const hf = sc.plan({ outDir: os.tmpdir(), manifest: m, renderer: getRenderer('hyperframes'), fps: 30 });
  assert.match(sc.formatCacheStatus(perScene), /per-scene/);
  assert.match(sc.formatCacheStatus(hf), /per-scene/);
  assert.equal(sc.formatCacheStatus({ mode: 'none' }), 'cache: not supported for this renderer');
});

test('HyperFrames span output is relative to the isolated scene project', () => {
  const project = path.join('/tmp', 'out', 'hf-film', 'spans', 'scene-intro');
  const output = path.join('/tmp', 'out', 'hf-film', '_span-deadbeef.mp4');
  assert.equal(hyperframes._internals.spanRenderOutput(project, output), path.join('..', '..', '_span-deadbeef.mp4'));
});

// ---- integration: real no-browser builds through the cache ------------------

function setupProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cache-e2e-'));
  const out = path.join(root, 'out');
  fs.mkdirSync(out, { recursive: true });
  const audio = path.join(root, 'narration.wav');
  const words = path.join(root, 'words.json');
  // A short 1.2s narration tone per scene; scenes are 1.2s each.
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=330:duration=2.4', '-ar', '48000', '-ac', '1', audio]);
  fs.writeFileSync(words, JSON.stringify([
    { start: 0.1, end: 1.1, text: 'Scene one.', words: [
      { text: 'Scene', start: 0.1, end: 0.5 }, { text: 'one.', start: 0.55, end: 1.1 }] },
    { start: 1.2, end: 2.3, text: 'Scene two.', words: [
      { text: 'Scene', start: 1.2, end: 1.6 }, { text: 'two.', start: 1.65, end: 2.3 }] },
  ]));
  return { root, out, audio, words };
}

function buildConfig(root, sceneBodyOverride) {
  return resolveConfig({
    title: 'Cache E2E', renderer: 'no-browser', size: { w: 160, h: 90 },
    narration: { file: 'narration.wav', wordTimings: 'words.json' },
    voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } }, chrome: false,
    scenes: [
      { id: 'one', visual: { type: 'stack', style: { background: '#080d16' }, children: [
        { type: 'text', text: sceneBodyOverride || 'ONE', style: { color: '#fff', fontSize: 24 } }] }, vo: [{ who: 'a', text: 'Scene one.' }], dur: 1.2 },
      { id: 'two', visual: { type: 'stack', style: { background: '#080d16' }, children: [
        { type: 'text', text: 'TWO', style: { color: '#fff', fontSize: 24 } }] }, vo: [{ who: 'a', text: 'Scene two.' }], dur: 1.2 },
    ],
  }, {}, root);
}

test('unchanged second build reuses 100% of spans (renders nothing)', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return; // skip when ffmpeg/canvas absent
  const { root, out } = setupProject();
  try {
    const cfg = buildConfig(root);
    const logs1 = [];
    build(cfg, { out, projectDir: root, fps: 10, quality: 'draft', log: m => logs1.push(m) });
    const mp4 = path.join(out, 'video.mp4');
    assert.ok(fs.existsSync(mp4), 'first build produced video.mp4');
    // Cache dir is populated with per-scene spans.
    const cacheDir = path.join(out, '.scene-cache');
    assert.ok(fs.existsSync(cacheDir), 'cache dir created');
    const spans1 = fs.readdirSync(cacheDir).filter(f => f.endsWith('.mp4'));
    assert.ok(spans1.length >= 2, 'at least two spans cached');

    // Second build, nothing changed.
    const logs2 = [];
    build(cfg, { out, projectDir: root, fps: 10, quality: 'draft', log: m => logs2.push(m) });
    const joined = logs2.join('\n');
    assert.match(joined, /all 2 scene span\(s\) reused.*rendering nothing/i,
      'second build must report 100% reuse');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a single-scene change re-renders only that scene', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return;
  const { root, out } = setupProject();
  try {
    const cfgA = buildConfig(root);
    build(cfgA, { out, projectDir: root, fps: 10, quality: 'draft', log: () => {} });
    const cacheDir = path.join(out, '.scene-cache');
    const before = new Set(fs.readdirSync(cacheDir).filter(f => f.endsWith('.mp4')));

    // Change ONLY scene one's visual content.
    const cfgB = buildConfig(root, 'ONE-CHANGED');
    const logs = [];
    build(cfgB, { out, projectDir: root, fps: 10, quality: 'draft', log: m => logs.push(m) });
    const joined = logs.join('\n');
    assert.match(joined, /rendering 1 of 2 scene span/i, 'only one scene re-renders');
    // Scene two's span is still cached (unchanged key); one new span exists.
    const after = new Set(fs.readdirSync(cacheDir).filter(f => f.endsWith('.mp4')));
    const kept = [...before].filter(f => after.has(f));
    assert.ok(kept.length >= 1, 'unchanged scene span was reused');
    assert.ok(fs.existsSync(path.join(out, 'video.mp4')), 'final video produced');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / NAR-007-045: an earlier scene's duration change shifts the
// later scene's absolute placement. A local-time visual must remain reusable —
// only the changed scene re-renders. External narration without word timings
// gives each scene ordinal local timing, so scene two's local timing is a pure
// function of its own (unchanged) duration, isolating the placement effect.
test('an earlier duration change reuses the placement-shifted later scene', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return;
  const { root, out } = setupProject();
  try {
    const makeCfg = (oneDur) => resolveConfig({
      title: 'Cache E2E', renderer: 'no-browser', size: { w: 160, h: 90 },
      narration: { file: 'narration.wav' },
      voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } }, chrome: false,
      scenes: [
        { id: 'one', visual: { type: 'stack', style: { background: '#080d16' }, children: [
          { type: 'text', text: 'ONE', style: { color: '#fff', fontSize: 24 } }] }, vo: [{ who: 'a', text: 'Scene one.' }], dur: oneDur },
        { id: 'two', visual: { type: 'stack', style: { background: '#080d16' }, children: [
          { type: 'text', text: 'TWO', style: { color: '#fff', fontSize: 24 } }] }, vo: [{ who: 'a', text: 'Scene two.' }], dur: 1.2 },
      ],
    }, {}, root);

    build(makeCfg(1.2), { out, projectDir: root, fps: 10, quality: 'draft', log: () => {} });

    // Lengthen ONLY scene one's duration; scene two's absolute start shifts by
    // 0.5s but its local visual identity is unchanged.
    const logs = [];
    build(makeCfg(1.7), { out, projectDir: root, fps: 10, quality: 'draft', log: m => logs.push(m) });
    const joined = logs.join('\n');
    assert.match(joined, /rendering 1 of 2 scene span/i,
      'only the duration-changed scene re-renders; the shifted scene reuses');
    assert.match(joined, /reused with re-placement — two \(placement changed; local visuals unchanged\)/i,
      'the shifted scene attributes its reuse to placement independence');
    assert.ok(fs.existsSync(path.join(out, 'video.mp4')), 'final video produced');
    // The mux is bounded by the authoritative external narration audio
    // (NAR-003-011), so the output duration follows the 2.4s narration file.
    const { probe } = require('../src/util');
    const dur = probe(path.join(out, 'video.mp4'));
    assert.ok(Math.abs(dur - 2.4) < 0.25, `expected ~2.4s (audio-bounded), got ${dur}s`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / structural revisions: deleting a middle scene shifts the
// later scene's ORDINAL, which is a pixel dependency for a global-time renderer
// (no-browser spans are slices of the full project: entrance transition and
// chrome counter follow the scene index). The shifted scene must re-render;
// the unchanged-ordinal scene reuses.
test('deleting a scene re-renders the ordinal-shifted later scene (no-browser)', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return;
  const { root, out } = setupProject();
  try {
    const make = (ids) => resolveConfig({
      title: 'Cache E2E', renderer: 'no-browser', size: { w: 160, h: 90 },
      narration: { file: 'narration.wav' },
      voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } }, chrome: false,
      scenes: ids.map(id => ({
        id,
        visual: { type: 'stack', style: { background: '#080d16' }, children: [
          { type: 'text', text: id.toUpperCase(), style: { color: '#fff', fontSize: 24 } }] },
        vo: [{ who: 'a', text: `Scene ${id}.` }],
        dur: 1.2,
      })),
    }, {}, root);
    build(make(['one', 'two', 'three']), { out, projectDir: root, fps: 10, quality: 'draft', log: () => {} });
    const logs = [];
    build(make(['one', 'three']), { out, projectDir: root, fps: 10, quality: 'draft', log: m => logs.push(m) });
    const joined = logs.join('\n');
    assert.match(joined, /rendering 1 of 2 scene span/i,
      'the ordinal-shifted later scene re-renders; the unchanged scene reuses');
    assert.match(joined, /three: scene position changed \(global-time scene\)/i,
      'the shifted scene attributes its re-render to the ordinal dependency');
    assert.ok(fs.existsSync(path.join(out, 'video.mp4')), 'final video produced');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / structural revisions: appending a scene re-renders only the
// new scene; existing scenes keep their ordinals and reuse.
test('adding a scene re-renders only the new scene', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return;
  const { root, out } = setupProject();
  try {
    const make = (ids) => resolveConfig({
      title: 'Cache E2E', renderer: 'no-browser', size: { w: 160, h: 90 },
      narration: { file: 'narration.wav' },
      voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } }, chrome: false,
      scenes: ids.map(id => ({
        id,
        visual: { type: 'stack', style: { background: '#080d16' }, children: [
          { type: 'text', text: id.toUpperCase(), style: { color: '#fff', fontSize: 24 } }] },
        vo: [{ who: 'a', text: `Scene ${id}.` }],
        dur: 1.2,
      })),
    }, {}, root);
    build(make(['one', 'two']), { out, projectDir: root, fps: 10, quality: 'draft', log: () => {} });
    const logs = [];
    build(make(['one', 'two', 'three']), { out, projectDir: root, fps: 10, quality: 'draft', log: m => logs.push(m) });
    const joined = logs.join('\n');
    assert.match(joined, /rendering 1 of 3 scene span/i, 'only the new scene re-renders');
    assert.match(joined, /three: no prior cached identity/i, 'the new scene attributes its fresh render');
    assert.ok(fs.existsSync(path.join(out, 'video.mp4')), 'final video produced');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / structural revisions: reordering changes every scene's
// ordinal, which is a pixel dependency for a global-time renderer — so no-browser
// re-renders the reordered spans instead of serving stale transition/counter
// pixels. (Isolated renderers rebase and may reuse; covered by the unit test.)
test('reordering scenes re-renders ordinal-shifted spans (no-browser)', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return;
  const { root, out } = setupProject();
  try {
    const make = (ids) => resolveConfig({
      title: 'Cache E2E', renderer: 'no-browser', size: { w: 160, h: 90 },
      narration: { file: 'narration.wav' },
      voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } }, chrome: false,
      scenes: ids.map(id => ({
        id,
        visual: { type: 'stack', style: { background: '#080d16' }, children: [
          { type: 'text', text: id.toUpperCase(), style: { color: '#fff', fontSize: 24 } }] },
        vo: [{ who: 'a', text: `Scene ${id}.` }],
        dur: 1.2,
      })),
    }, {}, root);
    build(make(['one', 'two']), { out, projectDir: root, fps: 10, quality: 'draft', log: () => {} });
    const logs = [];
    build(make(['two', 'one']), { out, projectDir: root, fps: 10, quality: 'draft', log: m => logs.push(m) });
    const joined = logs.join('\n');
    assert.match(joined, /rendering 2 of 2 scene span/i,
      'both reordered scenes re-render for the global-time renderer');
    assert.match(joined, /scene position changed \(global-time scene\)/g,
      'the re-renders are attributed to the ordinal dependency');
    assert.ok(fs.existsSync(path.join(out, 'video.mp4')), 'final video produced');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// CHANGE-2026-041 / structural revisions: every current renderer embeds the
// scene's ordinal (HyperFrames isolated spans carry `_firstScene`/chrome; no-
// browser slices render transition+counter by index), so a reorder re-renders.
// The placement-independence win is for ORDINAL-PRESERVING placement shifts
// (an earlier scene's duration change), verified at the plan level.
test('ordinal-preserving placement shifts reuse for local-time scenes', () => {
  const m = makeManifest(); // scenes s1 (start 0), s2 (start 2), turns +0.2 each
  const ctx = sc.renderContextHash(m, { fps: 30 });
  const identities = sc.identitySnapshot(m, ctx, false);
  // Ordinal-preserving placement shift (earlier scene duration change): the
  // scene reuses (placement-independent) when a valid key-matched span exists.
  if (HAS_FFMPEG) {
    const spans = sc.planSpans(m, ctx, 30, os.tmpdir(), { placementSensitive: false, globalTime: false, ordinalSensitive: true, identities });
    const cacheDir = path.join(os.tmpdir(), sc.CACHE_DIR);
    fs.mkdirSync(cacheDir, { recursive: true });
    try {
      for (const s of spans) {
        spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=2',
          '-frames:v', String(s.frameCount), '-framerate', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', s.spanFile]);
        sc.writeSpanSidecar(s, m.scenes[s.sceneIndex]);
      }
      const moved = {
        ...m,
        totalDuration: (m.totalDuration || 4) + 3.7,
        scenes: m.scenes.map(s => ({
          ...s,
          start: s.start + 3.7,
          vo: (s.vo || []).map(t => t.start == null ? t : { ...t, start: t.start + 3.7 }),
        })),
      };
      const again = sc.planSpans(moved, ctx, 30, os.tmpdir(), { placementSensitive: false, globalTime: false, ordinalSensitive: true, identities });
      assert.equal(again[1].reusable, true, 'local-time scene reuses across an ordinal-preserving placement shift');
      assert.match(again[1].reason, /placement changed; local visuals unchanged/);
      // A reorder changes every scene's ordinal → ordinal dependency re-renders.
      const reorderScene = (scene, newStart, turnStart) => ({
        ...scene,
        start: newStart,
        vo: (scene.vo || []).map(t => ({ ...t, start: turnStart })),
      });
      const reordered = {
        ...m,
        scenes: [
          reorderScene(m.scenes[1], 0, 0.2),
          reorderScene(m.scenes[0], 2, 2.2),
        ],
      };
      const ord = sc.planSpans(reordered, ctx, 30, os.tmpdir(), {
        placementSensitive: false, globalTime: false, ordinalSensitive: true, identities });
      assert.equal(ord[0].reusable, false);
      assert.match(ord[0].reason, /scene position changed \(global-time scene\)/);
    } finally { fs.rmSync(cacheDir, { recursive: true, force: true }); }
  }
});

// CHANGE-2026-041 / structural revisions: splitting one scene into two.
// For a global-time renderer the downstream scene's ordinal shifts, so it
// re-renders; for an isolated renderer it would reuse (unit-tested above).
test('splitting a scene re-renders ordinal-shifted spans (no-browser)', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return;
  const { root, out } = setupProject();
  try {
    const make = (spec) => resolveConfig({
      title: 'Cache E2E', renderer: 'no-browser', size: { w: 160, h: 90 },
      narration: { file: 'narration.wav' },
      voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } }, chrome: false,
      scenes: spec.map(([id, dur]) => ({
        id,
        visual: { type: 'stack', style: { background: '#080d16' }, children: [
          { type: 'text', text: id.toUpperCase(), style: { color: '#fff', fontSize: 24 } }] },
        vo: [{ who: 'a', text: `Scene ${id}.` }],
        dur,
      })),
    }, {}, root);
    build(make([['one', 1.2], ['two', 1.2]]), { out, projectDir: root, fps: 10, quality: 'draft', log: () => {} });
    const logs = [];
    build(make([['onea', 0.6], ['oneb', 0.6], ['two', 1.2]]), { out, projectDir: root, fps: 10, quality: 'draft', log: m => logs.push(m) });
    const joined = logs.join('\n');
    assert.match(joined, /rendering 3 of 3 scene span/i,
      'the two new halves render and the ordinal-shifted downstream scene re-renders');
    assert.match(joined, /two: scene position changed \(global-time scene\)/i,
      'the downstream scene attributes its re-render to the ordinal dependency');
    assert.ok(fs.existsSync(path.join(out, 'video.mp4')), 'final video produced');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a corrupt cached span falls back without failing the build', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return;
  const { root, out } = setupProject();
  try {
    const cfg = buildConfig(root);
    build(cfg, { out, projectDir: root, fps: 10, quality: 'draft', log: () => {} });
    const cacheDir = path.join(out, '.scene-cache');
    const spans = fs.readdirSync(cacheDir).filter(f => f.endsWith('.mp4'));
    assert.ok(spans.length, 'spans cached before corruption');
    // Truncate one cached span so spanIsValid rejects it (probed duration wrong).
    const victim = path.join(cacheDir, spans[0]);
    fs.writeFileSync(victim, 'not an mp4');
    const logs = [];
    // Must not throw — the corrupt span is detected and re-rendered.
    assert.doesNotThrow(() =>
      build(cfg, { out, projectDir: root, fps: 10, quality: 'draft', log: m => logs.push(m) }));
    assert.ok(fs.existsSync(path.join(out, 'video.mp4')), 'video still produced after corruption');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('concatenated cache output is duration-correct', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return;
  const { root, out } = setupProject();
  try {
    const cfg = buildConfig(root);
    build(cfg, { out, projectDir: root, fps: 10, quality: 'draft', log: () => {} });
    // Second (cache-hit) build — duration must still match the timeline total.
    build(cfg, { out, projectDir: root, fps: 10, quality: 'draft', log: () => {} });
    const { probe } = require('../src/util');
    const dur = probe(path.join(out, 'video.mp4'));
    // Two 1.2s scenes = 2.4s; allow encoder/frame rounding slack.
    assert.ok(Math.abs(dur - 2.4) < 0.25, `expected ~2.4s, got ${dur}s`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
