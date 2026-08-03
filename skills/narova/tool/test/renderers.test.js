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
  assert.deepEqual(entries.map(entry => entry.name), ['hyperframes', 'native']);
  assert.ok(entries.every(entry => entry.local));
  assert.equal(getRenderer('hyperframes').browserless, false);
  assert.equal(getRenderer('native').browserless, true);
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
  assert.equal(materializeVisualBodies({ scenes: [{ body: '' }] }).scenes[0].body, '');
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

test('renderer selection and visual tree survive config -> manifest', () => {
  const config = resolveConfig({
    title: 'Portable', renderer: 'native', voices: { a: { speaker: 'v1' } },
    scenes: [{ id: 'one', visual: VISUAL, vo: [], dur: 1 }],
  });
  assert.equal(config.renderer, 'native');
  const manifest = compile(config);
  assert.equal(manifest.renderer.provider, 'native');
  assert.deepEqual(manifest.scenes[0].visual, VISUAL);
  assert.deepEqual(validateManifest(manifest), []);
  manifest.renderer.provider = 'remote';
  assert.ok(validateManifest(manifest).some(error => /renderer\.provider/.test(error)));
});

test('native rejects HTML-only scenes instead of silently degrading them', () => {
  const config = resolveConfig({
    title: 'HTML only', renderer: 'native', voices: {},
    scenes: [{ id: 'one', body: '<h1>Only HTML</h1>', vo: [], dur: 1 }],
  });
  assert.throws(() => getRenderer('native').validate(config), /visual: required.*HTML body is HyperFrames-only/);
});

test('native accepts explicit fallbacks beside HyperFrames-only metadata', () => {
  const config = {
    title: 'Dual authored', renderer: 'native', themeCss: '.hero { filter: blur(2px); }',
    scenes: [{
      id: 'one', body: '<h1 class="hero">Browser art</h1>', visual: VISUAL,
      walkthrough: { id: 'demo' }, clip: 'capture.webm', vo: [], dur: 1,
    }],
  };
  assert.doesNotThrow(() => getRenderer('native').validate(config));
});

test('native shapes Urdu through OpenType and falls back from an incomplete font', t => {
  try { require.resolve('fontkit'); require.resolve('@fontsource/noto-sans-arabic'); }
  catch { t.skip('native shaping dependencies not installed'); return; }
  const native = getRenderer('native');
  const text = 'ہر کہانی، اپنی زبان میں';
  const node = {
    text,
    style: {
      direction: 'rtl', language: 'urd',
      fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    },
  };
  const font = native._internals.shapingFont(node, { baseDir: '/', fonts: new Map() });
  assert.match(font.familyName, /Noto Sans Arabic/i);
  const run = native._internals.shapeRun(font, text, node.style);
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
    title: 'Transcript guard', renderer: 'native',
    narration: { file: 'narration.wav', wordTimings: 'words.json' },
    voices: { a: { speaker: 'custom-file' } },
    scenes: [{ id: 'one', visual: VISUAL, vo: [{ who: 'a', text: 'What the narrator says.' }], dur: 1 }],
  }, {}, project), /transcript text does not match scene voiceover/);
});

test('native reserves one caption-safe band without shrinking the scene background', () => {
  const native = getRenderer('native');
  const child = { type: 'rect', style: {} };
  const root = { type: 'stack', style: { direction: 'column' }, children: [child] };
  const project = { size: { w: 640, h: 360 }, timeline: { groups: [{ words: [{ w: 'caption' }] }] } };
  const reserve = native._internals.captionSafeInset(project);
  const frames = native._internals.layoutTree(root, 640, 360, { b: reserve });
  assert.deepEqual(frames.get(root), { x: 0, y: 0, w: 640, h: 360 });
  assert.equal(reserve, 93.6);
  assert.deepEqual(frames.get(child), { x: 0, y: 0, w: 640, h: 266.4 });
});

test('native provider renders a real browserless MP4 with local audio', { timeout: 30000 }, t => {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  try { require.resolve('@napi-rs/canvas'); }
  catch { t.skip('@napi-rs/canvas not installed'); return; }
  if (ffmpeg.status !== 0) { t.skip('ffmpeg not installed'); return; }

  const tempRoot = path.join(process.cwd(), 'out', 'test-tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const project = fs.mkdtempSync(path.join(tempRoot, 'narova-native-e2e-'));
  const audio = path.join(project, 'narration.wav');
  fs.writeFileSync(path.join(project, 'words.json'), JSON.stringify([{
    start: 0.1, end: 1.0, text: 'Native captions work.',
    words: [
      { text: 'Native', start: 0.1, end: 0.35 },
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
    title: 'Native E2E', renderer: 'native', size: { w: 320, h: 180 },
    narration: { file: 'narration.wav', wordTimings: 'words.json' },
    voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } }, chrome: false,
    scenes: [{ id: 'one', visual: VISUAL, vo: [{ who: 'a', text: 'Native captions work.' }], dur: 1.2 }],
  }, {}, project);
  const result = build(config, { out: path.join(project, 'out'), projectDir: project, fps: 10, quality: 'draft', log: () => {} });
  assert.ok(fs.existsSync(result.mp4));
  assert.equal(result.renderer, 'native');
  assert.match(fs.readFileSync(path.join(project, 'out', 'captions.srt'), 'utf8'), /Native captions work\./);
  const dimensions = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0', result.mp4,
  ], { encoding: 'utf8' });
  assert.equal(dimensions.status, 0, dimensions.stderr);
  assert.equal(dimensions.stdout.trim(), '320x180');
});
