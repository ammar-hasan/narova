'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { resolveConfig } = require('../src/schema');
const { build } = require('../src/pipeline');
const { compile, validate: validateManifest } = require('../src/manifest');
const { listRenderers, getRenderer } = require('../src/renderers');
const { validateVisual, visualToHtml, materializeVisualBodies } = require('../src/renderers/visual');
const { findLatinFont } = require('../src/renderers/system-font');
const { threeSetupJs, threeSceneBody, hasThreeScenes, hasThreeModels, collectModelAssets, THREE_CDN, GLTF_LOADER_CDN } = require('../src/compose/three');
const { resolveElementsScene, validateElements, hasElements } = require('../src/compose/elements');

const VISUAL = {
  type: 'stack',
  style: { direction: 'column', padding: 20, gap: 10, background: '#080d16' },
  children: [
    { type: 'text', text: 'Browserless — براؤزر کے بغیر', style: { height: 70, color: '#ffffff', fontSize: 30 }, enter: 'rise' },
    { type: 'progress', value: 0.72, fill: '#2ee6d6', style: { height: 12, background: '#203044', radius: 6 } },
  ],
};

test('renderer registry exposes exactly the two bundled local providers', () => {
  const entries = listRenderers();
  assert.deepEqual(entries.map(entry => entry.name), ['hyperframes', 'no-browser']);
  assert.ok(entries.every(entry => entry.local));
  assert.equal(getRenderer('hyperframes').browserless, false);
  assert.equal(getRenderer('no-browser').browserless, true);
});

test('portable visuals validate and compile to a HyperFrames body', () => {
  assert.deepEqual(validateVisual(VISUAL), []);
  const html = visualToHtml(VISUAL);
  assert.match(html, /display:flex/);
  assert.match(html, /Browserless — براؤزر کے بغیر/);
  assert.match(html, /class="cue"/);
  assert.match(visualToHtml({
    type: 'rect',
    style: { background: { type: 'linear', angle: 90, stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }] } },
  }), /linear-gradient\(90deg,#000 0%,#fff 100%\)/);
  assert.match(visualToHtml({
    type: 'rect',
    style: { background: { type: 'linear', from: [0, 0], to: ['100%', '100%'], stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }] } },
  }), /linear-gradient\(135deg,#000 0%,#fff 100%\)/);
  assert.match(visualToHtml({
    type: 'rect',
    style: { shadowColor: 'rgba(0,0,0,0.4)', shadowX: 2, shadowBlur: 10 },
  }), /box-shadow:2px 8px 10px rgba\(0,0,0,0.4\)/);
  assert.match(visualToHtml({
    type: 'stack', style: { direction: 'column' },
    children: [{ type: 'rect', style: { alignSelf: 'center' } }],
  }), /align-self:center/);
  assert.match(visualToHtml({ type: 'text', text: 'X', style: { verticalAlign: 'center' } }),
    /display:flex.*align-items:center/);
  assert.match(visualToHtml({ type: 'text', text: 'X', style: { maxLines: 3 } }), /-webkit-line-clamp/);
  assert.match(visualToHtml({ type: 'line', style: { stroke: '#f00', strokeWidth: 4 } }), /<svg[^>]*><line[^>]*stroke="#f00"[^>]*\/>/);
  assert.match(visualToHtml({ type: 'circle', style: { fill: '#f2418a' } }), /<svg[^>]*><circle[^>]*fill="#f2418a"[^>]*\/>/);
  assert.equal(materializeVisualBodies({ scenes: [{ body: '' }] }).scenes[0].body, '');
  // Existing body means visual is ignored — the original HyperFrames path is untouched.
  const untouched = materializeVisualBodies({ scenes: [{ body: '<h1>Original HTML</h1>' }] });
  assert.equal(untouched.scenes[0].body, '<h1>Original HTML</h1>');
  // HyperFrames-native animators mapped from visual tree.
  assert.match(visualToHtml({ type: 'rect', drift: 'in' }), /data-drift="in"/);
  assert.match(visualToHtml({ type: 'rect', style: { grow: true } }), /data-grow/);
  assert.match(visualToHtml({ type: 'rect', style: { mark: 'underline' } }), /data-mark="underline"/);
  assert.match(visualToHtml({ type: 'path', d: 'M0 0L10 10' }), /data-draw/);
  assert.match(visualToHtml({ type: 'line' }), /data-draw/);
  assert.match(visualToHtml({ type: 'progress' }), /data-grow/);
  assert.match(visualToHtml({ type: 'counter', target: 42 }), /data-count="42"/);
  assert.match(visualToHtml({ type: 'counter', target: 99, suffix: '%', decimals: 1 }), /data-count="99".*data-count-suffix="%"/);
  assert.ok(validateVisual({ type: 'counter', target: 42 }).length === 0);
  assert.ok(validateVisual({ type: 'counter' }).some(e => /target/.test(e)));
  assert.ok(validateVisual({ type: 'rect', style: { mark: 'circle' } }).length === 0);
  assert.ok(validateVisual({ type: 'rect', style: { mark: 'bad' } }).some(e => /mark/.test(e)));
});

test('visual validation rejects unknown nodes and non-deterministic animations', () => {
  const errors = validateVisual({
    type: 'widget',
    animate: [{ property: 'random', from: 0, to: 1, duration: 0 }],
  });
  assert.ok(errors.some(error => /type/.test(error)));
  assert.ok(errors.some(error => /property/.test(error)));
  assert.ok(errors.some(error => /duration/.test(error)));
});

test('linear gradient angle matches the CSS angle compiled for HyperFrames', () => {
  const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  const frame = { x: 0, y: 0, w: 200, h: 100 };
  const noBrowser = getRenderer('no-browser');
  // 90deg in CSS points right: the gradient line must be horizontal left->right.
  const horizontal = noBrowser._internals.gradientLine(frame, 90);
  approx(horizontal.y0, horizontal.y1);
  approx(horizontal.x0, 0);
  approx(horizontal.x1, 200);
  // 0deg points up: a vertical line bottom->top.
  const vertical = noBrowser._internals.gradientLine(frame, 0);
  approx(vertical.x0, vertical.x1);
  approx(vertical.y0, 100);
  approx(vertical.y1, 0);
  // Default angle in visualToHtml is 135deg (bottom-right).
  const diagonal = noBrowser._internals.gradientLine(frame, 135);
  assert.ok(diagonal.x1 > diagonal.x0 && diagonal.y1 > diagonal.y0);
});

test('renderer selection and visual tree survive config -> manifest', () => {
  const config = resolveConfig({
    title: 'Portable', renderer: 'no-browser', voices: { a: { speaker: 'v1' } },
    scenes: [{ id: 'one', visual: VISUAL, vo: [], dur: 1 }],
  });
  assert.equal(config.renderer, 'no-browser');
  const manifest = compile(config);
  assert.equal(manifest.renderer.provider, 'no-browser');
  assert.deepEqual(manifest.scenes[0].visual, VISUAL);
  assert.deepEqual(validateManifest(manifest), []);
  manifest.renderer.provider = 'remote';
  assert.ok(validateManifest(manifest).some(error => /renderer\.provider/.test(error)));
});

test('no-browser rejects HTML-only scenes instead of silently degrading them', () => {
  const config = resolveConfig({
    title: 'HTML only', renderer: 'no-browser', voices: {},
    scenes: [{ id: 'one', body: '<h1>Only HTML</h1>', vo: [], dur: 1 }],
  });
  assert.throws(() => getRenderer('no-browser').validate(config), /visual: required.*HTML body is HyperFrames-only/);
});

test('no-browser accepts explicit fallbacks beside HyperFrames-only metadata', () => {
  const config = {
    title: 'Dual authored', renderer: 'no-browser', themeCss: '.hero { filter: blur(2px); }',
    scenes: [{
      id: 'one', body: '<h1 class="hero">Browser art</h1>', visual: VISUAL,
      walkthrough: { id: 'demo' }, clip: 'capture.webm', vo: [], dur: 1,
    }],
  };
  assert.doesNotThrow(() => getRenderer('no-browser').validate(config));
});

test('no-browser shapes Urdu through OpenType and falls back from an incomplete font', t => {
  try { require.resolve('fontkit'); require.resolve('@fontsource/noto-sans-arabic'); }
  catch { t.skip('no-browser shaping dependencies not installed'); return; }
  const fontkit = require('fontkit');
  const latinFont = findLatinFont();
  if (!latinFont) { t.skip('no Latin system font available for the fallback fixture'); return; }
  const text = 'ہر کہانی، اپنی زبان میں';
  const latin = fontkit.openSync(latinFont);
  const supported = [...text].filter(character => !/\s/.test(character))
    .every(character => latin.hasGlyphForCodePoint(character.codePointAt(0)));
  if (supported) { t.skip(`system font ${latinFont} already covers Arabic; cannot exercise the fallback`); return; }
  const noBrowser = getRenderer('no-browser');
  const node = {
    text,
    style: { direction: 'rtl', language: 'urd', fontFile: latinFont },
  };
  const font = noBrowser._internals.shapingFont(node, { baseDir: '/', fonts: new Map() });
  assert.match(font.familyName, /Noto Sans Arabic/i);
  const run = noBrowser._internals.shapeRun(font, text, node.style);
  assert.equal(run.direction, 'rtl');
  assert.ok(run.glyphs.length > 0);
  assert.ok(run.glyphs.every(glyph => glyph.id !== 0), 'shaped run must not contain .notdef/tofu glyphs');
});

test('external caption transcript must match the declared voiceover', () => {
  const tempRoot = path.join(process.cwd(), 'out', 'test-tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const project = fs.mkdtempSync(path.join(tempRoot, 'narova-transcript-'));
  fs.writeFileSync(path.join(project, 'narration.wav'), 'RIFFfake');
  fs.writeFileSync(path.join(project, 'words.json'), JSON.stringify([{
    start: 0, end: 1, text: 'Unrelated subtitle.',
    words: [{ text: 'Unrelated', start: 0, end: 0.5 }, { text: 'subtitle.', start: 0.5, end: 1 }],
  }]));
  assert.throws(() => resolveConfig({
    title: 'Transcript guard', renderer: 'no-browser',
    narration: { file: 'narration.wav', wordTimings: 'words.json' },
    voices: { a: { speaker: 'custom-file' } },
    scenes: [{ id: 'one', visual: VISUAL, vo: [{ who: 'a', text: 'What the narrator says.' }], dur: 1 }],
  }, {}, project), /transcript text does not match scene voiceover/);
});

test('no-browser reserves one caption-safe band without shrinking the scene background', () => {
  const noBrowser = getRenderer('no-browser');
  const child = { type: 'rect', style: {} };
  const root = { type: 'stack', style: { direction: 'column' }, children: [child] };
  const project = { size: { w: 640, h: 360 }, timeline: { groups: [{ words: [{ w: 'caption' }] }] } };
  const reserve = noBrowser._internals.captionSafeInset(project);
  const frames = noBrowser._internals.layoutTree(root, 640, 360, { b: reserve });
  assert.deepEqual(frames.get(root), { x: 0, y: 0, w: 640, h: 360 });
  assert.equal(reserve, 93.6);
  assert.deepEqual(frames.get(child), { x: 0, y: 0, w: 640, h: 266.4 });
});

test('mixed-script RTL shaping falls back to canvas text instead of throwing', t => {
  try { require.resolve('@napi-rs/canvas'); require.resolve('fontkit'); }
  catch { t.skip('no-browser deps not installed'); return; }
  const noBrowser = getRenderer('no-browser');
  // The arabic subset lacks '!' and Latin letters; the latin subset lacks Arabic.
  // No single font in the chain covers both, so shapingFont returns null
  // signalling "use canvas text fallback" instead of throwing.
  const mixed = { text: 'واہ!', style: { direction: 'rtl' } };
  const env = { baseDir: '/', fonts: new Map() };
  assert.equal(noBrowser._internals.shapingFont(mixed, env), null);
  // drawText sees null and renders via canvas fillText (Skia bidi + font fallback).
  const { createCanvas } = require('@napi-rs/canvas');
  const c = createCanvas(300, 80);
  const ctx = c.getContext('2d');
  assert.doesNotThrow(() => {
    ctx.font = '22px sans-serif';
    ctx.direction = 'rtl';
    ctx.fillText(mixed.text, 150, 30);
  });
});

test('no-browser provider renders a real browserless MP4 with local audio', { timeout: 30000 }, t => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  try { require.resolve('@napi-rs/canvas'); }
  catch { t.skip('@napi-rs/canvas not installed'); return; }
  if (ffmpeg.status !== 0) { t.skip('ffmpeg not installed'); return; }

  const tempRoot = path.join(process.cwd(), 'out', 'test-tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const project = fs.mkdtempSync(path.join(tempRoot, 'narova-no-browser-e2e-'));
  const audio = path.join(project, 'narration.wav');
  fs.writeFileSync(path.join(project, 'words.json'), JSON.stringify([{
    start: 0.1, end: 1.0, text: 'No-browser captions work.',
    words: [
      { text: 'No-browser', start: 0.1, end: 0.35 },
      { text: 'captions', start: 0.4, end: 0.7 },
      { text: 'work.', start: 0.75, end: 1.0 },
    ],
  }]));
  const generated = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.2',
    '-ar', '48000', '-ac', '1', audio,
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const config = resolveConfig({
    title: 'No-browser E2E', renderer: 'no-browser', size: { w: 320, h: 180 },
    narration: { file: 'narration.wav', wordTimings: 'words.json' },
    voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } }, chrome: false,
    scenes: [{ id: 'one', visual: VISUAL, vo: [{ who: 'a', text: 'No-browser captions work.' }], dur: 1.2 }],
  }, {}, project);
  const result = build(config, { out: path.join(project, 'out'), projectDir: project, fps: 10, quality: 'draft', log: () => {} });
  assert.ok(fs.existsSync(result.mp4));
  assert.equal(result.renderer, 'no-browser');
  assert.match(fs.readFileSync(path.join(project, 'out', 'captions.srt'), 'utf8'), /No-browser captions work\./);
  const dimensions = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0', result.mp4,
  ], { encoding: 'utf8' });
  assert.equal(dimensions.status, 0, dimensions.stderr);
  assert.equal(dimensions.stdout.trim(), '320x180');
});

// --- canvas3d node type ---

test('canvas3d in visual tree validates cleanly and renders a canvas+script', () => {
  const vis = {
    type: 'canvas3d',
    three: {
      camera: { position: [0, 0, 5] },
      lights: [{ type: 'ambient', color: '#404060', intensity: 0.5 }],
      objects: [{ type: 'cube', color: '#2ee6d6' }],
    },
  };
  assert.deepEqual(validateVisual(vis), []);
  const html = visualToHtml(vis);
  assert.match(html, /<canvas/);
  assert.match(html, /narova-three-canvas/);
  assert.match(html, /data-three=/);
});

test('canvas3d rejects missing three config', () => {
  const vis = { type: 'canvas3d' };
  const errs = validateVisual(vis);
  assert.ok(errs.length > 0);
  assert.match(errs[0], /3D scene config required/);
});

test('canvas3d validates nested three config', () => {
  const vis = {
    type: 'canvas3d',
    three: {
      camera: { fov: 200 },
      lights: [{ type: 'sun' }],
    },
  };
  const errs = validateVisual(vis);
  assert.ok(errs.length > 0);
  assert.match(errs.join(' '), /fov/);
  assert.match(errs.join(' '), /ambient\|directional/);
});

test('model3d requires src', () => {
  const errs = validateVisual({ type: 'model3d' });
  assert.ok(errs.length > 0);
  assert.match(errs[0], /src/);
});

// --- scene.three schema ---

test('scene.three with valid config passes schema', () => {
  const { resolveConfig } = require('../src/schema');
  const c = resolveConfig({
    title: '3D Test',
    size: '16:9',
    voices: { a: { speaker: 'v1' } },
    scenes: [{
      id: 's1',
      vo: [{ who: 'a', text: 'Hello.' }],
      three: {
        camera: { position: [0, 0, 5], fov: 45 },
        lights: [{ type: 'ambient', color: '#404060' }, { type: 'directional', position: [5, 5, 5] }],
        objects: [{ type: 'cube', color: '#2ee6d6', size: 1.5, animate: { property: 'rotation.y', from: 0, to: Math.PI * 2, duration: 3 } }],
        background: '#0a0a1a',
      },
    }],
  }, {}, '.');
  assert.ok(c.scenes[0].three);
  assert.equal(c.scenes[0].three.objects[0].type, 'cube');
});

test('scene.three with invalid camera fov fails', () => {
  const { resolveConfig } = require('../src/schema');
  assert.throws(() => resolveConfig({
    title: '3D', size: '16:9', voices: { a: { speaker: 'v1' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hi.' }], three: { camera: { fov: 200 } } }],
  }, {}, '.'), /fov/);
});

// --- Elements compiler ---

test('elements: 3D cube scene compiles to three config', () => {
  const scene = {
    id: 'intro',
    vo: [{ who: 'a', text: 'Watch this.' }],
    elements: [
      { type: 'camera', position: [0, 0, 5] },
      { type: 'light', kind: 'ambient', color: '#404060', intensity: 0.5 },
      { type: 'light', kind: 'directional', position: [5, 5, 5] },
      { type: '3d-object', kind: 'cube', color: '#2ee6d6', size: 1.5,
        actions: [{ type: 'rotate', axis: 'y', to: Math.PI * 2, duration: 4 }] },
    ],
  };
  const result = resolveElementsScene(scene, {});
  assert.ok(result.three);
  assert.ok(result.three.objects);
  assert.equal(result.three.objects.length, 1);
  assert.equal(result.three.objects[0].animate.length, 1);
  assert.equal(result.three.objects[0].animate[0].property, 'rotation.y');
  assert.ok(!result.elements);
});

test('elements: 2D text only scene compiles to body HTML', () => {
  const scene = {
    id: 'title',
    vo: [{ who: 'a', text: 'Simple.' }],
    elements: [
      { type: 'text', content: 'Hello World', style: { fontSize: 48, color: '#ffffff' },
        actions: [{ type: 'appear', at: { cue: 0 } }] },
    ],
  };
  const result = resolveElementsScene(scene, {});
  assert.ok(!result.three);
  assert.match(result.body, /Hello World/);
  assert.match(result.body, /class="cue"/);
  assert.match(result.body, /data-cue="0"/);
});

test('elements: mixed 2D/3D compiles to three + HTML overlay', () => {
  const scene = {
    id: 'mixed',
    vo: [{ who: 'a', text: 'Look.' }],
    elements: [
      { type: 'camera', position: [0, 0, 5] },
      { type: 'light', kind: 'ambient', intensity: 0.5 },
      { type: '3d-object', kind: 'sphere', color: '#ff7eb6' },
      { type: 'text', content: '3D + Text', style: { fontSize: 36 } },
    ],
  };
  const result = resolveElementsScene(scene, {});
  assert.ok(result.three);
  assert.match(result.body, /3D \+ Text/);
});

test('elements validation rejects unknown element type', () => {
  const errs = [];
  validateElements([{ type: 'unknown' }], 'test', errs);
  assert.ok(errs.length > 0);
  assert.match(errs[0], /expected/);
});

test('elements validation rejects unknown action', () => {
  const errs = [];
  validateElements([{ type: 'text', content: 'x', actions: [{ type: 'fly' }] }], 'test', errs);
  assert.ok(errs.length > 0);
  assert.match(errs[0], /expected/);
});

// --- Three.js composition ---

test('threeSetupJs generates valid JS with canvas, renderer, scene, objects', () => {
  const js = threeSetupJs('test', {
    camera: { position: [0, 0, 5] },
    lights: [{ type: 'ambient', color: '#404060', intensity: 0.5 }],
    objects: [{ type: 'cube', color: '#2ee6d6', position: [0, 0, 0], animate: { property: 'rotation.y', from: 0, to: Math.PI * 2, duration: 4 } }],
  }, 0, 5, 1280, 720);
  assert.match(js, /WebGLRenderer/);
  assert.match(js, /AmbientLight/);
  assert.match(js, /BoxGeometry/);
  assert.match(js, /window\.__timelines\['main'\]/);
  assert.match(js, /R\.render/);
});

test('threeSetupJs handles model type with GLTFLoader fallback', () => {
  const js = threeSetupJs('test', {
    camera: { position: [0, 0, 5] },
    lights: [],
    objects: [{ type: 'model', src: 'assets/rocket.glb', position: [0, 0, 0] }],
  }, 0, 3, 800, 600);
  assert.match(js, /GLTFLoader/);
  assert.match(js, /assets\/rocket\.glb/);
});

test('hasThreeScenes detects three config', () => {
  assert.ok(hasThreeScenes({ scenes: [{ three: {} }] }));
  assert.ok(!hasThreeScenes({ scenes: [{ body: '<p>hi</p>' }] }));
});

test('hasThreeModels detects model references', () => {
  assert.ok(hasThreeModels({ scenes: [{ three: { objects: [{ type: 'model' }] } }] }));
  assert.ok(!hasThreeModels({ scenes: [{ three: { objects: [{ type: 'cube' }] } }] }));
});

test('collectModelAssets gathers all model src paths', () => {
  const paths = collectModelAssets({
    scenes: [
      { three: { objects: [{ type: 'model', src: 'models/a.glb' }, { type: 'model', src: 'models/b.gltf' }] } },
      { body: '<p>no models</p>' },
    ],
  });
  assert.deepEqual(paths, ['models/a.glb', 'models/b.gltf']);
});

test('threeSceneBody generates full HTML with canvas and script', () => {
  const html = threeSceneBody(
    { id: 's1', three: { camera: {}, lights: [], objects: [] } },
    { start: 0, dur: 5 },
    1280, 720,
  );
  assert.match(html, /<canvas id="three-s1"/);
  assert.match(html, /narova-three-canvas/);
  assert.match(html, /<script>/);
  assert.match(html, /<\/script>/);
});
