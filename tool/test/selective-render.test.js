'use strict';
/* Tests for HyperFrames per-scene (selective) rendering correctness.
 *
 * Narova's determinism contract: a frame is reproducible from its time value
 * via the inlined DATA + the GSAP timeline. So full-vs-isolated equivalence is
 * provable at the composition level WITHOUT a browser: the two projects must
 * schedule every animator at the same RELATIVE offset into the scene. These
 * tests compose a real multi-scene project both ways (compose() vs
 * composeSceneProject()) and assert the rebased coordinates match.
 *
 * Bug proven here (all previously broken for non-first scenes):
 *   - named markers were not rebased (fired at a global time beyond the span)
 *   - the Three.js render-driver tween was scheduled at the global scene start
 *     (beyond the isolated project's duration -> a static canvas)
 *   - scene-local turns were re-rebased a second time (corrupted to 0)
 *   - external karaoke overlays kept global data-start values
 *   - scene-script _scStart was the global start instead of 0
 *   - scene.cssFile was resolved by the schema but never applied to output
 *   - captions:false did not change the render-cache context (stale pixels)
 *   - project-global choreography / .js imports must force a whole-video render
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { resolveConfig } = require('../src/schema');
const { compose, composeSceneProject } = require('../src/compose');
const { compile, mergeTimings } = require('../src/manifest');
const sc = require('../src/scene-cache');
const { getRenderer } = require('../src/renderers');

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;

function silentWav(file, secs) {
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`, '-t', String(secs), file]);
}

/* Build a two-scene project out dir with timings + audio, then return the
 * resolved config. Scene 2 is the one we isolate. */
function setupProject(outDir, extra = {}) {
  fs.mkdirSync(path.join(outDir, 'audio'), { recursive: true });
  silentWav(path.join(outDir, 'audio', 'full.wav'), 6);
  fs.writeFileSync(path.join(outDir, 'timings.json'), JSON.stringify({
    total: 5,
    s1: { dur: 2, turns: [0.2], words: [{ w: 'One.', t0: 0.2, t1: 0.6, si: 0 }] },
    // turns here are SCENE-LOCAL (manifest.mergeTimings adds scene.start to
    // make them global). 0.2s into scene 2.
    s2: { dur: 3, turns: [0.2], words: [
      { w: 'Two', t0: 0.2, t1: 0.5, si: 0 },
      { w: 'three', t0: 0.5, t1: 0.8, si: 0 },
      { w: 'four.', t0: 0.8, t1: 1.1, si: 0 },
    ] },
  }));
  const base = {
    title: 'Repro', size: '16:9', markers: { reveal: 3.5 },
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [
      { id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }], body: '<p>scene one</p>' },
      { id: 's2', dur: 3, vo: [{ who: 'a', text: 'Two three four.' }],
        body: '<p class="cue" data-cue="marker:reveal">marker reveal</p>',
        three: { camera: { position: [0, 0, 5] }, objects: [
          { type: 'cube', size: 1, color: '#ff0', animate: [
            { property: 'rotation.y', from: 0, to: 6.28, duration: 2, at: 0.5 }] } ] } },
    ],
  };
  return resolveConfig({ ...base, ...extra }, {}, outDir);
}

function readHtml(dir) { return fs.readFileSync(path.join(dir, 'index.html'), 'utf8'); }
function firstMatch(html, re) { const m = html.match(re); return m ? m[1] : null; }

test('isolated scene project rebases named markers to scene-local time', () => {
  if (!HAS_FFMPEG) { test.skip('ffmpeg required'); return; }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-sr-'));
  try {
    const cfg = setupProject(out);
    const full = compose(cfg, out);
    const span = composeSceneProject(cfg, out, 1);
    const fullM = firstMatch(readHtml(full.dir), /"markers":\{"reveal":([0-9.]+)\}/);
    const spanM = firstMatch(readHtml(span.dir), /"markers":\{"reveal":([0-9.]+)\}/);
    // Full: global 3.5. Span: 3.5 - scene2Start(2) = 1.5 local.
    assert.equal(fullM, '3.5');
    assert.equal(spanM, '1.5');
    // The span project only lasts sceneDur (3s), so 1.5 is in range; 3.5 is not.
    assert.ok(Number(spanM) <= 3, 'rebased marker must fall inside the span timeline');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('isolated Three.js schedules its render driver + animations at local t=0', () => {
  if (!HAS_FFMPEG) { test.skip('ffmpeg required'); return; }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-sr-'));
  try {
    const cfg = setupProject(out);
    const full = compose(cfg, out);
    const span = composeSceneProject(cfg, out, 1);
    const fullDrv = firstMatch(readHtml(full.dir), /tl\.to\(T,\{n:[^}]*\},([0-9.]+)\)/);
    const spanDrv = firstMatch(readHtml(span.dir), /tl\.to\(T,\{n:[^}]*\},([0-9.]+)\)/);
    // Full driver at the scene's GLOBAL start (2). Span driver at LOCAL start (0).
    assert.equal(fullDrv, '2', 'full render driver at global scene start');
    assert.equal(spanDrv, '0', 'isolated driver must start at local 0, not the global start');

    // Object animation: at:0.5 -> full "2+0.5", span "0+0.5" (same relative offset).
    const fullAnim = firstMatch(readHtml(full.dir), /fromTo\(O0\.rotation,\{y:[^}]*\},\{y:[^}]*duration:2[^}]*\},([^)]+)\)/);
    const spanAnim = firstMatch(readHtml(span.dir), /fromTo\(O0\.rotation,\{y:[^}]*\},\{y:[^}]*duration:2[^}]*\},([^)]+)\)/);
    assert.equal(fullAnim, '2+0.5');
    assert.equal(spanAnim, '0+0.5');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('isolated scene-local turns are NOT re-rebased (they are already local)', () => {
  if (!HAS_FFMPEG) { test.skip('ffmpeg required'); return; }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-sr-'));
  try {
    const cfg = setupProject(out);
    const full = compose(cfg, out);
    const span = composeSceneProject(cfg, out, 1);
    const fullTurns = firstMatch(readHtml(full.dir), /"id":"s2"[^}]*"turns":\[([^\]]*)\]/);
    const spanTurns = firstMatch(readHtml(span.dir), /"id":"s2"[^}]*"turns":\[([^\]]*)\]/);
    // Both carry the same scene-local turn (0.2). The old code subtracted the
    // global start a second time and clamped the negative result to 0.
    assert.equal(fullTurns, '0.2');
    assert.equal(spanTurns, '0.2');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('isolated external karaoke overlays are rebased to scene-local data-start', () => {
  if (!HAS_FFMPEG) { test.skip('ffmpeg required'); return; }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-sr-'));
  // External narration: a project-relative audio file + a wordTimings JSON file.
  // Transcript must match the scene vo text ("one two three four").
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  const audioRel = 'audio/narration.wav';
  silentWav(path.join(out, audioRel), 6);
  const timingsRel = 'words.json';
  fs.writeFileSync(path.join(out, timingsRel), JSON.stringify([
    { start: 0.2, end: 0.6, text: 'One.', words: [{ text: 'One', start: 0.2, end: 0.6 }] },
    { start: 2.5, end: 4.0, text: 'Two three four.', words: [
      { text: 'Two', start: 2.5, end: 2.8 },
      { text: 'three', start: 2.8, end: 3.2 },
      { text: 'four.', start: 3.2, end: 4.0 }] },
  ]));
  try {
    const cfg = resolveConfig({
      title: 'K', size: '16:9',
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      narration: { file: audioRel, wordTimings: timingsRel },
      scenes: [
        { id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }], body: '<p>1</p>' },
        { id: 's2', dur: 3, vo: [{ who: 'a', text: 'Two three four.' }], body: '<p>2</p>' },
      ],
    }, {}, out);
    const full = compose(cfg, out);
    const span = composeSceneProject(cfg, out, 1);
    const fullHtml = readHtml(full.dir);
    const spanHtml = readHtml(span.dir);
    // The full document contains ALL scenes' overlays; scene 2's pill carries
    // the GLOBAL cue start (2.5). The isolated span contains only scene 2's
    // pill, rebased to LOCAL time (2.5 - scene2Start 2 = 0.5).
    assert.match(fullHtml, /narration-karaoke-pill"[^>]*data-start="2\.5"/,
      'full overlay for scene 2 uses the GLOBAL cue start');
    const spanPill = firstMatch(spanHtml, /narration-karaoke-pill"[^>]*data-start="([0-9.]+)"/);
    assert.equal(spanPill, '0.5', 'isolated overlay rebased to LOCAL time');
    // And the isolated span must NOT carry scene 1's global-time pill.
    assert.doesNotMatch(spanHtml, /narration-karaoke-pill"[^>]*data-start="0\.2"/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('isolated scene-script _scStart is 0 (local anchor), not the global start', () => {
  if (!HAS_FFMPEG) { test.skip('ffmpeg required'); return; }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-sr-'));
  fs.writeFileSync(path.join(out, 'scene2.js'), 'tl.to("#x",{duration:1},_scStart+0.5);');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  silentWav(path.join(out, 'audio', 'full.wav'), 6);
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
    total: 5, s1: { dur: 2, turns: [0.2], words: [{ w: 'One.', t0: 0.2, t1: 0.6, si: 0 }] },
    s2: { dur: 3, turns: [0.2], words: [{ w: 'Two.', t0: 0.2, t1: 0.6, si: 0 }] },
  }));
  try {
    const cfg = resolveConfig({
      title: 'Sc', size: '16:9', markers: { reveal: 3.5 },
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      scenes: [
        { id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }], body: '<p>one</p>' },
        { id: 's2', dur: 3, vo: [{ who: 'a', text: 'Two.' }], body: '<p>two</p>',
          scriptFile: 'scene2.js' },
      ],
    }, {}, out);
    const full = compose(cfg, out);
    const span = composeSceneProject(cfg, out, 1);
    const fullSc = firstMatch(readHtml(full.dir), /var _scStart=([0-9.]+)/);
    const spanSc = firstMatch(readHtml(span.dir), /var _scStart=([0-9.]+)/);
    assert.equal(fullSc, '2', 'full render: _scStart is the global scene start');
    assert.equal(spanSc, '0', 'isolated: _scStart=0 so _scStart+offset is scene-local');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('scene.cssFile is applied to composed output (full + isolated) and hashed', () => {
  if (!HAS_FFMPEG) { test.skip('ffmpeg required'); return; }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-sr-'));
  const cssFile = path.join(out, 'scene2.css');
  fs.writeFileSync(cssFile, '#scene-s2 .marker{color:#ff00aa}');
  try {
    const cfg = resolveConfig({
      title: 'CssFile', size: '16:9',
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      scenes: [
        { id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }], body: '<p>one</p>' },
        { id: 's2', dur: 3, vo: [{ who: 'a', text: 'Two.' }], body: '<p>two</p>',
          cssFile: 'scene2.css' },
      ],
    }, {}, out);
    fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
    silentWav(path.join(out, 'audio', 'full.wav'), 5);
    fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
      total: 5,
      s1: { dur: 2, turns: [0.2], words: [{ w: 'One.', t0: 0.2, t1: 0.6, si: 0 }] },
      s2: { dur: 3, turns: [0.2], words: [{ w: 'Two.', t0: 0.2, t1: 0.6, si: 0 }] },
    }));

    const full = compose(cfg, out);
    const fullCss = fs.readFileSync(path.join(full.dir, 'style.css'), 'utf8');
    assert.match(fullCss, /#ff00aa/, 'scene cssFile contents land in the composed stylesheet');

    const span = composeSceneProject(cfg, out, 1);
    const spanCss = fs.readFileSync(path.join(span.dir, 'style.css'), 'utf8');
    assert.match(spanCss, /#ff00aa/, 'isolated span also sees its scene cssFile');

    // The scene hash must include cssFile contents (so an edit invalidates it).
    const m1 = compile(cfg, { toolVersion: '0.26.0' });
    const h1 = m1.scenes[1].hash;
    fs.writeFileSync(cssFile, '#scene-s2 .marker{color:#00aaff}');
    delete require.cache[require.resolve('../src/schema')];
    const cfg2 = resolveConfig({
      title: 'CssFile', size: '16:9',
      voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
      scenes: [
        { id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }], body: '<p>one</p>' },
        { id: 's2', dur: 3, vo: [{ who: 'a', text: 'Two.' }], body: '<p>two</p>',
          cssFile: 'scene2.css' },
      ],
    }, {}, out);
    const m2 = compile(cfg2, { toolVersion: '0.26.0' });
    assert.notEqual(h1, m2.scenes[1].hash, 'cssFile edit changes the scene hash');
    assert.equal(m1.scenes[0].hash, m2.scenes[0].hash, 'other scenes unaffected');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('captions:false changes the render-cache context hash (no stale captioned pixels)', () => {
  const voices = { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } };
  const base = {
    title: 'Cap', size: '16:9', voices,
    scenes: [
      { id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }], body: '<p>1</p>' },
      { id: 's2', dur: 2, vo: [{ who: 'a', text: 'Two.' }], body: '<p>2</p>' },
    ],
  };
  const onCfg = resolveConfig({ ...base }, {}, os.tmpdir());
  const offCfg = resolveConfig({ ...base, captions: false }, {}, os.tmpdir());
  const mOn = compile(onCfg, { toolVersion: '0.26.0' });
  const mOff = compile(offCfg, { toolVersion: '0.26.0' });
  // The manifest records the enabled state...
  assert.equal(mOn.captions.enabled, true);
  assert.equal(mOff.captions.enabled, false);
  // ...and the render context hash (which feeds the per-scene cache key) must
  // differ, so a captions toggle cannot reuse stale pixels.
  const ctxOn = sc.renderContextHash(mOn, { fps: 30 });
  const ctxOff = sc.renderContextHash(mOff, { fps: 30 });
  assert.notEqual(ctxOn, ctxOff, 'captions on/off must produce different cache context');
});

test('selective render safety gate downgrades project-global JS to whole-video', () => {
  const voices = { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } };
  const base = {
    title: 'Gate', size: '16:9', voices,
    scenes: [{ id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }], body: '<p>1</p>' }],
  };
  const tf = path.join(os.tmpdir(), `t-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tf, JSON.stringify({ total: 2, s1: { dur: 2, turns: [0.2], words: [] } }));
  const hf = getRenderer('hyperframes');

  // Plain project: per-scene is safe.
  const plain = mergeTimings(compile(resolveConfig(base, {}, os.tmpdir()), { toolVersion: '0.26.0' }), tf);
  const p = sc.plan({ outDir: os.tmpdir(), manifest: plain, renderer: hf, fps: 30 });
  assert.equal(p.mode, 'per-scene', 'plain project renders per-scene');

  // Project choreography is authored in global time and can read the whole
  // DATA object (see references/choreography.md), so it cannot be isolated.
  // selectiveRenderSafe reads the RESOLVED choreography contents the manifest
  // carries — simulate a project that has it.
  const withChoreo = JSON.parse(JSON.stringify(plain));
  withChoreo.choreography = 'tl.to("#x",{duration:1},DATA.scenes[0].start);';
  const pc = sc.plan({ outDir: os.tmpdir(), manifest: withChoreo, renderer: hf, fps: 30 });
  assert.equal(pc.mode, 'whole-video', 'project choreography forces whole-video fallback');
  assert.ok(pc.selectiveSkipped, 'skip reason is recorded for the user/agent');
  assert.match(sc.formatCacheStatus(pc), /selective skipped/);

  // A .js import is inlined into the same global choreography blob -> unsafe.
  const withJsImport = JSON.parse(JSON.stringify(plain));
  withJsImport.imports = { shared: 'shared.js' };
  const pi = sc.plan({ outDir: os.tmpdir(), manifest: withJsImport, renderer: hf, fps: 30 });
  assert.equal(pi.mode, 'whole-video', 'a .js import forces whole-video fallback');

  // A .css import is fine (CSS is not project-global JS).
  const withCssImport = JSON.parse(JSON.stringify(plain));
  withCssImport.imports = { theme: 'theme.css' };
  const pcss = sc.plan({ outDir: os.tmpdir(), manifest: withCssImport, renderer: hf, fps: 30 });
  assert.equal(pcss.mode, 'per-scene', 'a .css import stays per-scene');
});

test('safety gate does NOT downgrade no-browser (its spans render the full project, no isolation)', () => {
  const voices = { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } };
  const cfg = resolveConfig({
    title: 'NB', size: '16:9', voices,
    scenes: [{ id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }], body: '<p>1</p>' }],
  }, {}, os.tmpdir());
  const tf = path.join(os.tmpdir(), `t-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tf, JSON.stringify({ total: 2, s1: { dur: 2, turns: [0.2], words: [] } }));
  const nb = getRenderer('no-browser');
  const m = mergeTimings(compile(cfg, { toolVersion: '0.26.0' }), tf);
  // Even WITH project choreography, no-browser must stay per-scene: its spans
  // render the full project timeline at absolute frame times, so choreography
  // is handled correctly without any rebasing.
  m.choreography = 'tl.to("#x",{duration:1},DATA.scenes[0].start);';
  const p = sc.plan({ outDir: os.tmpdir(), manifest: m, renderer: nb, fps: 30 });
  assert.equal(p.mode, 'per-scene', 'no-browser is never downgraded by the gate');
  assert.ok(!p.selectiveSkipped, 'no downgrade reason recorded for no-browser');
});

test('LRU cache pruning meets the count budget even when kept files are oldest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-lru-'));
  try {
    // 200 tiny cache files. The oldest 100 are the "current build" (kept);
    // the newest 100 are stale. Over the 100-span budget -> must prune 100
    // stale ones, leaving exactly 100. This is the case the old
    // mutate-array-during-iteration implementation got wrong (it left 150).
    const files = [];
    for (let i = 0; i < 200; i++) {
      const p = path.join(dir, `span-${String(i).padStart(3, '0')}.mp4`);
      fs.writeFileSync(p, 'x');
      const old = i < 100;
      const t = old ? (Date.now() / 1000 - 1000 + i) : (Date.now() / 1000 + i);
      fs.utimesSync(p, t, t);
      files.push(p);
    }
    const keep = files.slice(0, 100); // oldest 100 protected
    sc.pruneCache(dir, keep);
    const remaining = fs.readdirSync(dir).filter(f => f.endsWith('.mp4'));
    assert.ok(remaining.length <= 100, `pruned to budget (got ${remaining.length}); old impl left 150`);
    // All kept (current-build) files must survive.
    for (const k of keep) assert.ok(fs.existsSync(k), 'current-build span retained');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
