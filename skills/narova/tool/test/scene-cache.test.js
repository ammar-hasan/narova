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

test('formatCacheStatus reports per-scene vs whole-video honestly', () => {
  const m = makeManifest();
  const perScene = sc.plan({ outDir: os.tmpdir(), manifest: m, renderer: getRenderer('no-browser'), fps: 30 });
  const whole = sc.plan({ outDir: os.tmpdir(), manifest: m, renderer: getRenderer('hyperframes'), fps: 30 });
  assert.match(sc.formatCacheStatus(perScene), /per-scene/);
  assert.match(sc.formatCacheStatus(whole), /whole-video/);
  assert.equal(sc.formatCacheStatus({ mode: 'none' }), 'cache: not supported for this renderer');
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
