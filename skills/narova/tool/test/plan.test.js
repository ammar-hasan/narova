'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { plan, CHANGE_LEVELS, STAGE, formatPlan } = require('../src/plan');
const { compile, write } = require('../src/manifest');
const { resolveConfig } = require('../src/schema');

function makeConfig(overrides = {}) {
  return resolveConfig({
    title: 'Test',
    size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Hi</h1></div>' }],
    ...overrides,
  }, {}, os.tmpdir());
}

function writeManifest(config, dir, name) {
  const m = compile(config, { toolVersion: '0.8.2' });
  const p = path.join(dir, name || 'manifest.json');
  write(m, p);
  return p;
}

// ---- no-change ----------------------------------------------------------------

test('plan detects no change when config is identical', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg = makeConfig();
  const mp = writeManifest(cfg, tmp);
  const result = plan(mp, cfg);
  assert.equal(result.level, STAGE.NONE);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- full rebuild — voice change ---------------------------------------------

test('plan detects full rebuild on voice change', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({
    voices: { a: { label: 'A', color: '#0ff', backend: 'xtts', speaker: 'Damien Black' } },
  });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.FULL);
  assert.ok(result.changes.includes('voices'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan detects full rebuild on format change', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({ size: '1:1' });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.FULL);
  assert.ok(result.changes.includes('format'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan detects full rebuild on timing change', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({ timing: { gapSentence: 0.5, gapTurn: 0.5, lead: 0.2, tail: 1.0, tempo: 1.2 } });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.FULL);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- visual-only change ------------------------------------------------------

test('plan detects visual-only change (body edit, no vo change)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Changed body</h1></div>' }],
  });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.VISUAL);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- script change (audio) ---------------------------------------------------

test('plan detects script change when vo text differs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Totally different vo text here.' }], body: '<div><h1>Hi</h1></div>' }],
  });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.AUDIO);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- config-only change (captions/chrome/theme) --------------------------------

test('plan detects config-only change (platform)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({ platform: 'tiktok' });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.CONFIG);
  assert.equal(result.level.mix, false, 'config-only should not require audio mix');
  if (result.detail.configDiff) {
    assert.ok(result.detail.configDiff.some(d => d.key === 'platform'));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- structure change (scene added/removed) ----------------------------------

test('plan detects full rebuild when scene is added', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({
    scenes: [
      { id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Hi</h1></div>' },
      { id: 's2', vo: [{ who: 'a', text: 'New scene.' }], body: '<div><h1>New</h1></div>' },
    ],
  });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.FULL);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- no previous manifest ---------------------------------------------------

test('plan when no manifest exists returns no-change reference', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg = makeConfig();
  const mp = path.join(tmp, 'nonexistent.json');
  assert.throws(() => plan(mp, cfg));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- new: asset/sfx/bed/clip/align/captions tests ----------------------------

test('plan detects bed-only change as MIX', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const assetsDir = path.join(tmp, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'test.mp3'), 'fake');
  const cfg1 = resolveConfig({
    title: 'Test', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Hi</h1></div>' }],
  }, {}, tmp);
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = resolveConfig({
    title: 'Test', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Hi</h1></div>' }],
    bed: { file: 'assets/test.mp3', volume: 0.3 },
  }, {}, tmp);
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.MIX, 'adding bed should be MIX');
  assert.equal(result.level.mix, true);
  assert.equal(result.level.tts, false);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan detects MIX level when bed is added to existing manifest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const assetsDir = path.join(tmp, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'bed.mp3'), 'fake-bed');
  const cfg1 = resolveConfig({
    title: 'Test', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Hi</h1></div>' }],
  }, {}, tmp);
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = resolveConfig({
    title: 'Test', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Hi</h1></div>' }],
    bed: { file: 'assets/bed.mp3', volume: 0.2 },
  }, {}, tmp);
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.MIX);
  assert.equal(result.level.mix, true);
  assert.equal(result.level.tts, false, 'bed change should NOT trigger TTS');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan preserves a required mix when visual and bed changes coincide', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const assetsDir = path.join(tmp, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'bed.mp3'), 'fake-bed');
  const cfg1 = resolveConfig({
    title: 'Test', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Before</h1></div>' }],
  }, {}, tmp);
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = resolveConfig({
    title: 'Test', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    bed: { file: 'assets/bed.mp3', volume: 0.2 },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>After</h1></div>' }],
  }, {}, tmp);
  const result = plan(mp, cfg2);
  assert.equal(result.level.label, STAGE.VISUAL.label);
  assert.equal(result.level.mix, true, 'a visual edit must not hide a changed audio bed');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan detects ALIGN level when align changes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig({ align: false });
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({ align: true });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.ALIGN);
  assert.equal(result.level.align, true);
  assert.equal(result.level.tts, false, 'align change should NOT trigger TTS');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan detects VISUAL level when clip path changes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const assetsDir = path.join(tmp, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'bg1.mp4'), 'fake1');
  fs.writeFileSync(path.join(assetsDir, 'bg2.mp4'), 'fake2');
  const cfg1 = resolveConfig({
    title: 'Test', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Hi</h1></div>', clip: 'assets/bg1.mp4' }],
  }, {}, tmp);
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = resolveConfig({
    title: 'Test', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Hi</h1></div>', clip: 'assets/bg2.mp4' }],
  }, {}, tmp);
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.VISUAL, 'clip path change should be visual');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan detects CONFIG level for captions-only change', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig({ captions: { preset: 'karaoke' } });
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({ captions: { preset: 'slam' } });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.CONFIG);
  assert.equal(result.level.mix, false, 'captions change should NOT require audio mix');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan detects CONFIG level for theme change', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig({ theme: { accent: '#2ee6d6', bg: '#080d16' } });
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({ theme: { accent: '#ff0000', bg: '#080d16' } });
  const result = plan(mp, cfg2);
  assert.equal(result.level, STAGE.CONFIG);
  assert.equal(result.level.mix, false, 'theme change should NOT require audio mix');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- formatPlan output ---------------------------------------------------

test('formatPlan produces readable output for each change level', () => {
  for (const level of Object.values(CHANGE_LEVELS)) {
    const result = { level, changes: [], detail: {}, fromHash: 'abc123', toHash: 'def456' };
    const out = formatPlan(result);
    assert.ok(out.includes(level.icon), `missing icon for ${level.label}`);
    assert.ok(out.includes(level.label), `missing label for ${level.label}`);
    if (level.tts) assert.ok(out.includes('tts'), `${level.label} should show tts`);
    if (level.compose) assert.ok(out.includes('compose'), `${level.label} should show compose`);
    if (level.render) assert.ok(out.includes('render'), `${level.label} should show render`);
  }
});

test('formatPlan with scene changes includes scene details', () => {
  const result = {
    level: STAGE.AUDIO,
    changes: [{ scene: 's1', voChanged: true }],
    detail: {}, fromHash: 'abc', toHash: 'def',
  };
  const out = formatPlan(result);
  assert.ok(out.includes('s1'));
  assert.ok(out.includes('vo'));
});

test('formatPlan shows new stage fields (tts, align, mix, compose, render)', () => {
  const result = {
    level: STAGE.MIX,
    changes: [],
    detail: { assetDiffs: [{ file: 'assets/bed.mp3', from: 'abc12345', to: 'def67890' }] },
    fromHash: 'abc', toHash: 'def',
  };
  const out = formatPlan(result);
  assert.ok(out.includes('mix'), 'should show mix step');
  assert.ok(out.includes('compose'), 'should show compose step');
  assert.ok(out.includes('render'), 'should show render step');
  assert.ok(!out.includes('tts'), 'mix should NOT show tts');
  assert.ok(out.includes('assets/bed.mp3'), 'should show asset diff');
});
