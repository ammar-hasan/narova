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
const { threeSetupJs, threeSceneBody, threeModuleSetupJs, threeModuleSceneBody, hasThreeScenes, hasThreeModels, hasThreeModules, collectModelAssets, collectTextureAssets, threeHeadScripts, THREE_IMPORT } = require('../src/compose/three');
const { resolveElementsScene, validateElements, hasElements } = require('../src/compose/elements');
const { composeDoc } = require('../src/compose/html');
const { orbitCamera, panCamera } = require('../src/compose/camera-dsl');

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

test('no-browser keeps the raw frame unreserved and adds a caption band only with safeLayout', () => {
  const noBrowser = getRenderer('no-browser');
  const child = { type: 'rect', style: {} };
  const root = { type: 'stack', style: { direction: 'column' }, children: [child] };
  const project = { size: { w: 640, h: 360 }, timeline: { groups: [{ words: [{ w: 'caption' }] }] } };
  assert.equal(noBrowser._internals.captionSafeInset(project), 0);
  project.safeLayout = true;
  const reserve = noBrowser._internals.captionSafeInset(project);
  const frames = noBrowser._internals.layoutTree(root, 640, 360, { b: reserve });
  assert.deepEqual(frames.get(root), { x: 0, y: 0, w: 640, h: 360 });
  assert.equal(reserve, 93.6);
  assert.deepEqual(frames.get(child), { x: 0, y: 0, w: 640, h: 266.4 });
});

test('no-browser honors disabled, subtitle, pop, rise, and slam caption behavior', () => {
  const noBrowser = getRenderer('no-browser');
  const { captionSafeInset, captionWordStyle } = noBrowser._internals;
  const off = { captionsEnabled: false, size: { h: 360 }, timeline: { preset: false, groups: [{ words: [{}] }] } };
  assert.equal(captionSafeInset(off), 0);
  assert.deepEqual(captionWordStyle('subtitle', true, false, '#f00'), { color: '#ffffff', alpha: 0.92, y: 0 });
  assert.equal(captionWordStyle('pop', false, false, '#f00').alpha, 0.35);
  assert.equal(captionWordStyle('rise', true, false, '#f00').y, -5);
  assert.equal(captionWordStyle('slam', true, false, '#f00').y, -7);
});

test('no-browser compose carries captions:false into its project timeline', () => {
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'narova-no-cap-'));
  const out = path.join(temp, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(out, 'audio', 'full.wav'), 'placeholder');
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({ one: { dur: 1, turns: [], words: [] } }));
  try {
    const composed = getRenderer('no-browser').compose({
      title: 'No captions', size: { w: 320, h: 180 }, projectDir: temp,
      captionsEnabled: false, captions: {}, voices: {}, chrome: {},
      scenes: [{ id: 'one', dur: 1, vo: [], visual: { type: 'rect', style: {} }, transition: 'fade' }],
    }, out);
    const project = JSON.parse(fs.readFileSync(path.join(composed.dir, 'project.json'), 'utf8'));
    assert.equal(project.captionsEnabled, false);
    assert.equal(project.timeline.preset, false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
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
  assert.ok(fs.existsSync(result.videoCiEvidence));
  const videoCiEvidence = JSON.parse(fs.readFileSync(result.videoCiEvidence, 'utf8'));
  assert.equal(videoCiEvidence.schema, 'narova.video-ci-evidence/1');
  assert.equal(videoCiEvidence.artifact.path, path.basename(result.mp4));
  assert.match(videoCiEvidence.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(videoCiEvidence.context.manifest.available, true);
  assert.ok(Array.isArray(videoCiEvidence.context.manifest.content.scenes));
  assert.equal(Object.hasOwn(videoCiEvidence.context.manifest, 'value'), false);
  assert.equal(Object.hasOwn(videoCiEvidence.context.manifest, 'scenes'), false);
  assert.equal(videoCiEvidence.context.captions.every(item => typeof item.content === 'string'), true);
  assert.equal(result.renderer, 'no-browser');
  assert.match(fs.readFileSync(path.join(project, 'out', 'captions.srt'), 'utf8'), /No-browser captions work\./);
  const dimensions = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0', result.mp4,
  ], { encoding: 'utf8' });
  assert.equal(dimensions.status, 0, dimensions.stderr);
  assert.equal(dimensions.stdout.trim(), '320x180');
  const proof = getRenderer('no-browser').shots(config, path.join(project, 'out'), [0.2, 0.8]);
  assert.ok(fs.existsSync(path.join(proof.dir, 'contact-sheet.jpg')),
    'browserless proof review must include a discoverable contact sheet');
  assert.equal(fs.readdirSync(proof.dir).filter(file => file.endsWith('.png')).length, 2);
});

test('no-browser selective spans create clip extraction storage before ffmpeg writes', { timeout: 30000 }, t => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  try { require.resolve('@napi-rs/canvas'); }
  catch { t.skip('@napi-rs/canvas not installed'); return; }
  if (ffmpeg.status !== 0) { t.skip('ffmpeg not installed'); return; }

  const tempRoot = path.join(process.cwd(), 'out', 'test-tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const project = fs.mkdtempSync(path.join(tempRoot, 'narova-no-browser-clip-span-'));
  const out = path.join(project, 'out');
  fs.mkdirSync(out, { recursive: true });
  const audio = path.join(project, 'narration.wav');
  const clip = path.join(project, 'clip.mp4');
  const madeAudio = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.6',
    '-ar', '48000', '-ac', '1', audio,
  ], { encoding: 'utf8' });
  assert.equal(madeAudio.status, 0, madeAudio.stderr);
  const madeClip = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#2468a0:s=160x90:d=0.6:r=5',
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip,
  ], { encoding: 'utf8' });
  assert.equal(madeClip.status, 0, madeClip.stderr);

  try {
    const config = resolveConfig({
      title: 'Clip span', renderer: 'no-browser', size: { w: 160, h: 90 },
      narration: { file: 'narration.wav' }, voices: {}, chrome: false,
      scenes: [{
        id: 'one', clip: 'clip.mp4', dur: 0.6, vo: [],
        visual: { type: 'group', style: { width: '100%', height: '100%' } },
      }],
    }, {}, project);
    fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
      total: 0.6, one: { dur: 0.6, turns: [], words: [] },
    }));
    const spanFile = path.join(out, '.scene-cache', 'one.mp4');
    const result = getRenderer('no-browser').renderSpans(config, out, [{
      sceneIndex: 0, frameStart: 0, frameEnd: 3, frameCount: 3, spanFile,
    }], { fps: 5, quality: 'draft' });
    assert.equal(result.spans.length, 1);
    assert.ok(fs.existsSync(spanFile), 'selective clip span must render without a missing .frames directory');
    assert.ok(fs.statSync(spanFile).size > 0);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

// --- canvas3d node type ---

test('legacy canvas3d placeholder is rejected in favor of working scene.three', () => {
  const vis = {
    type: 'canvas3d',
    three: {
      camera: { position: [0, 0, 5] },
      lights: [{ type: 'ambient', color: '#404060', intensity: 0.5 }],
      objects: [{ type: 'cube', color: '#2ee6d6' }],
    },
  };
  assert.match(validateVisual(vis).join(' '), /use scene\.three/);
  // Direct materialization is deterministic for backwards-compatible tooling.
  assert.equal(visualToHtml(vis), visualToHtml(vis));
});

test('canvas3d rejects missing three config', () => {
  const vis = { type: 'canvas3d' };
  const errs = validateVisual(vis);
  assert.ok(errs.length > 0);
  assert.match(errs.join(' '), /3D scene config required/);
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

test('elements: image/video sources and cue classes compile as valid HTML', () => {
  const result = resolveElementsScene({
    id: 'media', vo: [], dur: 2,
    elements: [
      { type: 'image', src: 'assets/pic.png' },
      { type: 'video', src: 'assets/clip.mp4' },
      { type: 'text', content: 'Hello', class: 'hero', actions: [{ type: 'appear', at: { marker: 'hit' } }] },
    ],
  }, {});
  assert.match(result.body, /src="assets\/pic\.png"/);
  assert.match(result.body, /src="assets\/clip\.mp4"/);
  assert.doesNotMatch(result.body, /src=""/);
  assert.match(result.body, /class="hero cue" data-cue="marker:hit"/);
  assert.equal((result.body.match(/class="hero cue"/g) || []).length, 1);
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

// --- character / group abstraction ---

test('elements: built-in character kind expands to a group', () => {
  const scene = {
    id: 'char',
    vo: [{ who: 'a', text: 'Hi.' }],
    elements: [
      { type: 'camera', position: [0, 0, 5] },
      { type: 'light', kind: 'ambient' },
      { type: 'character', kind: 'cat', position: [0, 0, 0],
        actions: [{ type: 'move', to: [2, 0, 0], duration: 2 }] },
    ],
  };
  const result = resolveElementsScene(scene, {});
  assert.ok(result.three);
  const cat = result.three.objects.find(o => o.type === 'group');
  assert.ok(cat, 'character compiles to a group');
  assert.ok(cat.children.length > 5, `cat has ${cat.children.length} parts`);
  assert.deepEqual(cat.position, [0, 0, 0]);
  assert.ok(cat.animate.some(a => a.property === 'position.x'), 'move action on the whole group');
});

test('elements: config character with parts overrides preset', () => {
  const scene = {
    id: 'char2',
    vo: [{ who: 'a', text: 'Yo.' }],
    elements: [
      { type: 'camera' },
      { type: 'light', kind: 'ambient' },
      { type: 'character', ref: 'hero', position: [1, 0, 0] },
    ],
  };
  const result = resolveElementsScene(scene, {
    characters: { hero: { parts: [{ type: 'cube', size: 0.5, color: '#ff0000' }] } },
  });
  const group = result.three.objects.find(o => o.type === 'group');
  assert.ok(group);
  assert.equal(group.children.length, 1);
  assert.deepEqual(group.position, [1, 0, 0]);
});

test('elements: ground element compiles to a plane', () => {
  const scene = {
    id: 'g',
    vo: [{ who: 'a', text: 'x' }],
    elements: [{ type: 'camera' }, { type: 'ground', color: '#123456' }],
  };
  const result = resolveElementsScene(scene, {});
  const plane = result.three.objects.find(o => o.type === 'plane');
  assert.ok(plane);
  assert.equal(plane.color, '#123456');
  assert.deepEqual(plane.rotation, [-Math.PI / 2, 0, 0]);
});

test('elements: primitive shorthand type works like 3d-object', () => {
  const scene = {
    id: 'p',
    vo: [{ who: 'a', text: 'x' }],
    elements: [
      { type: 'camera' },
      { type: 'cube', size: 1, color: '#00ff00', position: [0, 0.5, 0],
        actions: [{ type: 'rotate', axis: 'y', to: 6.28, duration: 3 }] },
    ],
  };
  const result = resolveElementsScene(scene, {});
  const cube = result.three.objects.find(o => o.type === 'cube');
  assert.ok(cube);
  assert.equal(cube.animate.length, 1);
  assert.equal(cube.animate[0].property, 'rotation.y');
});

test('threeSetupJs emits valid group JS (no stray syntax)', () => {
  const js = threeSetupJs('g1', {
    camera: { position: [0, 0, 5] },
    lights: [],
    objects: [{
      type: 'group', position: [0, 0, 0], scale: [1, 1, 1],
      children: [{ type: 'sphere', size: 0.5, color: '#f08c2e', position: [0, 0.5, 0] }],
      animate: { property: 'position.x', from: 0, to: 2, duration: 2 },
    }],
  }, 0, 3, 800, 600);
  // The generated code must not contain a bare `.scale.set` (previous bug).
  assert.doesNotMatch(js, /;\s*\.scale/);
  assert.match(js, /new THREE\.Group/);
  assert.match(js, /\.scale\.set\(1,1,1\)/);
  assert.match(js, /O0\.add\(O0_p0\)/);
});

test('threeSetupJs shares geometry/material through the cache', () => {
  const js = threeSetupJs('g2', {
    camera: { position: [0, 0, 5] },
    lights: [],
    objects: [
      { type: 'cube', size: 1, color: '#ff0000' },
      { type: 'cube', size: 1, color: '#ff0000' },
      { type: 'sphere', size: 0.5, color: '#00ff00' },
    ],
  }, 0, 3, 800, 600);
  // Both cubes resolve through _g/_m with the same cache key.
  assert.match(js, /_g\("cube1"/);
  assert.match(js, /_m\("#ff0000\|0\|1"/);
  // Only one _geo/_mat helper definition each, not one per mesh.
  assert.equal((js.match(/function _g\(/g) || []).length, 1);
  assert.equal((js.match(/function _m\(/g) || []).length, 1);
});

test('threeSetupJs compiles instances to a single InstancedMesh', () => {
  const js = threeSetupJs('g3', {
    camera: { position: [0, 0, 5] },
    lights: [],
    objects: [{
      type: 'sphere', size: 0.3, color: '#c9cfd6',
      instances: [
        { position: [0, 0.3, 0] },
        { position: [1, 0.3, 0] },
        { position: [2, 0.3, 0], scale: [1.5, 1.5, 1.5] },
      ],
    }],
  }, 0, 3, 800, 600);
  assert.match(js, /new THREE\.InstancedMesh/);
  assert.match(js, /setMatrixAt\(0/);
  assert.match(js, /setMatrixAt\(2/);
  assert.match(js, /instanceMatrix\.needsUpdate=true/);
  // Three instance transforms, one InstancedMesh, no per-instance Mesh.
  assert.equal((js.match(/new THREE\.Mesh\(/g) || []).length, 0);
});

test('legacy canvas3d still validates nested instance data before migration', () => {
  const valid = validateVisual({
    type: 'canvas3d',
    three: {
      objects: [{ type: 'sphere', instances: [{ position: [0, 0, 0] }, { position: [1, 0, 0] }] }],
    },
  });
  assert.equal(valid.length, 1);
  assert.match(valid[0], /use scene\.three/);
  const bad = validateVisual({
    type: 'canvas3d',
    three: { objects: [{ type: 'sphere', instances: [{ position: [0, 0] }] }] },
  });
  assert.ok(bad.length > 0);
  assert.match(bad.join(' '), /position: expected \[x, y, z\]/);
});

// --- adversarial-review fixes ---

test('fix: group opacity uses traverse, never .material on a Group', () => {
  const scene = {
    id: 'g',
    vo: [{ who: 'a', text: 'x' }],
    elements: [
      { type: 'camera' }, { type: 'light', kind: 'ambient' },
      { type: 'character', kind: 'cat', actions: [{ type: 'appear', duration: 0.5 }] },
    ],
  };
  const result = resolveElementsScene(scene, {});
  const group = result.three.objects.find(o => o.type === 'group');
  assert.ok(group, 'character compiles to a group');
  assert.ok(group.animate.some(a => a.property === 'opacity'));
  const js = threeSetupJs('g', result.three, 0, 5, 800, 600);
  // The old code emitted `O0.material.opacity=...` on a Group (throws). Now it
  // must traverse descendants instead.
  assert.doesNotMatch(js, /O0\.material\.opacity=/);
  assert.match(js, /traverse\(function/);
});

test('fix: opacity-animated mesh gets an isolated material, not the shared cache', () => {
  const js = threeSetupJs('b', { camera: {}, lights: [],
    objects: [
      { type: 'sphere', size: 0.5, color: '#ff0000', animate: { property: 'opacity', from: 0, to: 1, duration: 0.5 } },
      { type: 'sphere', size: 0.5, color: '#ff0000' },
    ]}, 0, 3, 800, 600);
  // The opacity-animated mesh must NOT resolve through the shared _m cache
  // (tweening it would fade the other same-colored mesh too).
  assert.match(js, /new THREE\.MeshStandardMaterial\(\{color:"#ff0000",wireframe:false,opacity:1,transparent:true\}\)/);
  // The static mesh still shares the cache.
  assert.match(js, /_m\("#ff0000\|0\|1"/);
  assert.equal((js.match(/_m\("#ff0000\|0\|1"/g) || []).length, 1);
  assert.match(js, /this\.targets\(\)\[0\]\.t/);
});

test('full composition drives 3D from measured scene starts, durations, and turns', () => {
  const config = {
    title: 'Measured', size: { w: 800, h: 600 }, voices: {}, chrome: {}, captionsEnabled: false,
    scenes: [
      { id: 'a', dur: 6, vo: [], three: { objects: [{ type: 'cube' }] } },
      { id: 'b', dur: 6, vo: [], three: { objects: [{ type: 'sphere', animate: { property: 'scale', from: 0, to: 1, duration: 1, at: { cue: 0 } } }] } },
    ],
  };
  const html = composeDoc(config, config.size, {
    total: 5, groups: [], preset: false, markers: {},
    scenes: [
      { id: 'a', start: 0, dur: 2, turns: [] },
      { id: 'b', start: 2, dur: 3, turns: [1.4] },
    ],
  }, '');
  assert.match(html, /duration:3,ease:'none',onUpdate:_render\},2\)/);
  assert.match(html, /duration:1,ease:"power2\.inOut"\},3\.4\)/);
  assert.doesNotMatch(html, /onUpdate:_render\},6\)/);
});

test('3D markers, camera helpers, and camera wait offsets resolve deterministically', () => {
  const cameraAnimate = orbitCamera({ marker: 'orbit' }, 8, { segments: 2 });
  assert.deepEqual(cameraAnimate.map(a => a.at), Array(4).fill({ marker: 'orbit' }));
  assert.deepEqual(cameraAnimate.map(a => a.wait), [0, 0, 4, 4]);
  assert.equal(panCamera(1, { amount: 3 })[0].by, 3);
  const js = threeSetupJs('cam', {
    camera: {}, cameraAnimate,
    objects: [{ type: 'cube', animate: { property: 'scale', from: 0, to: 1, duration: 1, at: { marker: 'reveal', offset: 0.25 } } }],
  }, 0, 12, 800, 600, [], { orbit: 2, reveal: 5 });
  assert.match(js, /duration:4,ease:"power2\.inOut"\},2\)/);
  assert.match(js, /duration:4,ease:"none"\},6\)/);
  assert.match(js, /duration:1,ease:"power2\.inOut"\},5\.25\)/);
});

test('texture collection is recursive, includes particles, and material keys isolate maps', () => {
  const config = { scenes: [{ three: { objects: [
    { type: 'cube', map: 'a/color.png' },
    { type: 'group', children: [{ type: 'sphere', normalMap: 'b/normal.png' }] },
    { type: 'particles', texture: 'p/dot.png' },
  ] } }] };
  assert.deepEqual(collectTextureAssets(config).sort(), ['a/color.png', 'b/normal.png', 'p/dot.png']);
  const js = threeSetupJs('maps', { objects: [
    { type: 'cube', color: '#fff', map: 'a.png' },
    { type: 'cube', color: '#fff', map: 'b.png' },
  ] }, 0, 2, 320, 180);
  assert.match(js, /map=a\.png/);
  assert.match(js, /map=b\.png/);
});

test('HDR environments use the bundled HDRLoader and raw modules escape script ends', () => {
  const js = threeSetupJs('hdr', { envMap: { src: 'assets/sky.hdr' }, objects: [] }, 0, 2, 320, 180);
  assert.match(js, /new THREE\.HDRLoader\(\)/);
  const html = threeModuleSceneBody({ id: 'raw', _threeModuleContents: 'const x="<\/script><img>";' }, { start: 0, dur: 1 }, 320, 180);
  assert.doesNotMatch(html, /<\/script><img>/);
  assert.match(html, /<\\\/script><img>/);
});

test('fix: animationTweens honors authored `from` via fromTo', () => {
  const js = threeSetupJs('f', { camera: {}, lights: [],
    objects: [{ type: 'cube', color: '#fff', position: [2, 0, 0],
      animate: { property: 'position.x', from: 5, to: -1, duration: 2 } }]}, 0, 3, 800, 600);
  assert.match(js, /fromTo\(O0\.position,\{x:5\},\{x:-1/);
});

test('fix: boot poll is bounded with an error surface', () => {
  const js = threeSetupJs('boot', { camera: {}, lights: [], objects: [] }, 0, 3, 800, 600);
  assert.match(js, /_try>200/);
  assert.match(js, /THREE or GSAP timeline never became ready/);
});

test('fix: GLTF loads deterministically via prefetch + parseAsync, gated before frame 0', () => {
  const js = threeSetupJs('m', { camera: {}, lights: [],
    objects: [{ type: 'model', src: 'assets/rocket.glb', position: [0, 0, 0] }]}, 0, 3, 800, 600);
  assert.match(js, /fetch\(/);
  assert.match(js, /parseAsync/);
  assert.match(js, /_pending\.push/);
  assert.match(js, /Promise\.all\(_pending\)/);
  // No legacy async load() + wireframe fallback path.
  assert.doesNotMatch(js, /GLTFLoader\(\)\.load\(/);
});

test('fix: tone mapping / color space defaults are set on the renderer', () => {
  const js = threeSetupJs('tm', { camera: {}, lights: [], objects: [] }, 0, 3, 800, 600);
  assert.match(js, /outputColorSpace=THREE\.SRGBColorSpace/);
  assert.match(js, /toneMapping=THREE\.ACESFilmicToneMapping/);
  assert.match(js, /toneMappingExposure=1/);
  // linear is configurable (AgX/Neutral need r155+, which has no UMD core).
  const linear = threeSetupJs('tm2', { camera: {}, lights: [], objects: [], toneMapping: 'linear', exposure: 1.2 }, 0, 3, 800, 600);
  assert.match(linear, /toneMapping=THREE\.NoToneMapping/);
  assert.match(linear, /toneMappingExposure=1\.2/);
});

// --- ESM migration (r185) ---

test('esm: threeHeadScripts emits a classic global script (not ESM)', () => {
  const js = threeHeadScripts();
  // Classic <script src> loading the vendored global bundle at the canonical
  // path HyperFrames probes. No import map, no module script — opaque to the
  // compiler's esbuild, so it can't tree-shake three.
  assert.match(js, /<script src="\.\/assets\/three\.core\.js"><\/script>/);
  assert.doesNotMatch(js, /importmap|type="module"/);
});

test('esm: scene setup polls for window.THREE and uses THREE.GLTFLoader', () => {
  const js = threeSetupJs('m', { camera: {}, lights: [],
    objects: [{ type: 'model', src: 'assets/rocket.glb', position: [0, 0, 0] }]}, 0, 3, 800, 600);
  assert.match(js, /window\.THREE/);
  assert.match(js, /var THREE=window\.THREE/);
  assert.match(js, /new THREE\.GLTFLoader\(\)\.parseAsync/);
});

test('esm: r185 tone mapping supports AgX and Neutral', () => {
  const agx = threeSetupJs('agx', { camera: {}, lights: [], objects: [], toneMapping: 'agx' }, 0, 3, 800, 600);
  assert.match(agx, /toneMapping=THREE\.AgXToneMapping/);
  const neutral = threeSetupJs('neu', { camera: {}, lights: [], objects: [], toneMapping: 'neutral' }, 0, 3, 800, 600);
  assert.match(neutral, /toneMapping=THREE\.NeutralToneMapping/);
});

// --- particle seed determinism -----------------------------------------------

test('particles use seeded PRNG, not Math.random', () => {
  const js = threeSetupJs('p', { camera: {}, lights: [],
    objects: [{ type: 'particles', count: 50, spread: [4, 3, 2], color: '#ffaa00' }],
  }, 0, 5, 800, 600);
  // Must NOT contain bare Math.random
  assert.ok(!/\bMath\.random\b/.test(js), 'particle positions must not use unseeded Math.random');
  // Must contain the seeded PRNG function
  assert.match(js, /function\(\)\{var s=\d+/);
  // Must use _rng() instead of Math.random
  assert.match(js, /_rng\(\)/);
});

test('particles with same seed produce identical JS', () => {
  const cfg = { camera: {}, lights: [],
    objects: [{ type: 'particles', count: 10, spread: [2, 2, 2], color: '#ffffff', prngSeed: 12345 }],
  };
  const js1 = threeSetupJs('p', cfg, 0, 5, 800, 600);
  const js2 = threeSetupJs('p', cfg, 0, 5, 800, 600);
  assert.equal(js1, js2, 'same seed must produce identical generated JS');
});

test('particles with different seeds produce different JS', () => {
  const cfg1 = { camera: {}, lights: [],
    objects: [{ type: 'particles', count: 10, spread: [2, 2, 2], color: '#ffffff', prngSeed: 12345 }],
  };
  const cfg2 = { camera: {}, lights: [],
    objects: [{ type: 'particles', count: 10, spread: [2, 2, 2], color: '#ffffff', prngSeed: 54321 }],
  };
  const js1 = threeSetupJs('p', cfg1, 0, 5, 800, 600);
  const js2 = threeSetupJs('p', cfg2, 0, 5, 800, 600);
  assert.notEqual(js1, js2, 'different seeds must produce different generated JS');
});

test('particles derive deterministic seed from scene id + object index when no explicit seed', () => {
  const cfg = { camera: {}, lights: [],
    objects: [{ type: 'particles', count: 10, spread: [2, 2, 2], color: '#ffffff' }],
  };
  // Same scene id = same seed = same JS
  const js1 = threeSetupJs('my-scene', cfg, 0, 5, 800, 600);
  const js2 = threeSetupJs('my-scene', cfg, 0, 5, 800, 600);
  assert.equal(js1, js2, 'same scene id must produce identical JS');

  // Different scene id = different seed = different JS
  const js3 = threeSetupJs('other-scene', cfg, 0, 5, 800, 600);
  assert.notEqual(js1, js3, 'different scene id must produce different JS');
});

// ---- scene.threeModule: raw Three.js escape hatch ---------------------------

test('threeModuleSetupJs builds the deterministic shell and inlines author code', () => {
  const body = 'var g = new THREE.IcosahedronGeometry(1); scene.add(new THREE.Mesh(g));';
  const js = threeModuleSetupJs('shader-scene', null, body, 0, 6, 1280, 720, [0, 2, 4]);
  // Shell: renderer, scene, camera (capture-safe flags).
  assert.match(js, /new THREE\.WebGLRenderer/);
  assert.match(js, /preserveDrawingBuffer:true/);
  assert.match(js, /setPixelRatio\(1\)/);
  assert.match(js, /SRGBColorSpace/);
  assert.match(js, /new THREE\.Scene/);
  assert.match(js, /new THREE\.PerspectiveCamera/);
  // Context the author relies on.
  assert.match(js, /var size=\{w:1280,h:720\}/);
  assert.match(js, /var duration=6/);
  assert.match(js, /var start=0/);
  assert.match(js, /var sceneTl=window\.gsap\.timeline\(\)/);
  assert.match(js, /tl\.add\(sceneTl,start\)/);
  assert.match(js, /function at\(t\)/);
  assert.match(js, /function assets\(name\)/);
  assert.match(js, /function onRender\(fn\)/);
  assert.match(js, /function onBeforeRender\(fn\)/);
  assert.match(js, /function onAfterRender\(fn\)/);
  assert.match(js, /narova=\{prng:/);
  // The author's body is inlined verbatim.
  assert.match(js, /IcosahedronGeometry/);
  // Frame driver on the shared GSAP timeline.
  assert.match(js, /window\.__timelines\['main'\]/);
  assert.match(js, /tl\.to\(T,/);
  // Default per-frame render paints scene+camera.
  assert.match(js, /renderer\.render\(scene,camera\)/);
  assert.ok(js.indexOf('_renderFns[i]()') < js.indexOf('renderer.render(scene,camera)'), 'before-render callbacks must run before WebGL paints');
});

test('raw Three modules expose measured local word, sentence, marker, and turn anchors', () => {
  const html = threeModuleSceneBody(
    { id: 'cues', _threeModuleContents: 'sceneTl.set(camera.position,{x:1},narova.cueWord("Yet"));' },
    { start: 10, dur: 5, turns: [0.2], markers: { reveal: 12.5 }, groups: [
      { si: 0, start: 0.2, end: 2, words: [{ w: 'Hello', t0: 0.2, t1: 0.8 }] },
      { si: 1, start: 2.1, end: 5, words: [{ w: 'Yet', t0: 2.1, t1: 2.5 }] },
    ] }, 320, 180,
  );
  assert.match(html, /var _sentences=\[0\.2,2\.1\]/);
  assert.match(html, /"w":"Yet","t0":2\.1/);
  assert.match(html, /cueMarker:function\(name\)\{return Number\.isFinite\(_markers\[name\]\)\?_markers\[name\]-start:0/);
  assert.match(html, /atSentence:function/);
  assert.match(html, /atWord:function/);
  assert.match(html, /atMarker:function/);
});

test('threeModuleSetupJs inlines author code safely (try/catch) and seeds deterministically', () => {
  const body = 'throw new Error("boom");';
  const js1 = threeModuleSetupJs('s1', null, body, 0, 3, 800, 600, []);
  const js2 = threeModuleSetupJs('s1', null, body, 0, 3, 800, 600, []);
  // A throw is contained, never silently blank — and the same scene reproduces.
  assert.match(js1, /try\{/);
  assert.match(js1, /catch\(e\)/);
  assert.equal(js1, js2, 'same scene id + body must produce identical bootstrap');
});

test('threeModuleSetupJs honors declarative camera/shell when scene.three is also present', () => {
  const body = 'scene.add(new THREE.Mesh());';
  const js = threeModuleSetupJs('mix', {
    camera: { fov: 70, position: [1, 2, 3] },
    fog: { color: '#101010', near: 2, far: 20 },
    envMap: { src: 'studio.hdr', intensity: 1.5 },
  }, body, 0, 3, 800, 600, []);
  assert.match(js, /PerspectiveCamera\(70,/);
  assert.match(js, /camera\.position\.set\(1,2,3\)/);
  assert.match(js, /THREE\.Fog\("#101010",2,20\)/);
  assert.match(js, /new THREE\.HDRLoader\(\)/);
  assert.match(js, /scene\.environmentIntensity=1\.5/);
});

test('threeModuleSceneBody emits the managed canvas + inlined bootstrap', () => {
  const html = threeModuleSceneBody(
    { id: 'sh', _threeModuleContents: 'scene.add(new THREE.Mesh());' },
    { start: 4, dur: 6, turns: [0, 2] }, 1280, 720,
  );
  assert.match(html, /<canvas id="three-sh"/);
  assert.match(html, /<script>/);
  assert.match(html, /narova-three-scene/);
});

test('hasThreeModules and hasThreeScenes recognize escape-hatch and declarative scenes', () => {
  const declarative = { scenes: [{ three: { objects: [{ type: 'cube' }] } }] };
  const moduleCfg = { scenes: [{ _threeModuleContents: 'scene.add();' }] };
  const empty = { scenes: [{ body: '<p>x</p>' }] };
  assert.equal(hasThreeScenes(declarative), true);
  assert.equal(hasThreeScenes(moduleCfg), true);
  assert.equal(hasThreeScenes(empty), false);
  assert.equal(hasThreeModules(moduleCfg), true);
  assert.equal(hasThreeModules(declarative), false);
});
