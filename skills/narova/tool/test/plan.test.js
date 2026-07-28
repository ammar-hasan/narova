'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { plan, CHANGE_LEVELS, formatPlan } = require('../src/plan');
const { compile, write } = require('../src/manifest');
const { resolveConfig } = require('../src/schema');

function makeConfig(overrides = {}) {
  return resolveConfig({
    title: 'Test',
    size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div><h1>Hi</h1></div>' }],
    ...overrides,
  }, {}, '.');
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
  assert.equal(result.level, CHANGE_LEVELS.NONE);
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
  assert.equal(result.level, CHANGE_LEVELS.FULL);
  assert.ok(result.changes.includes('voices'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan detects full rebuild on format change', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({ size: '1:1' });
  const result = plan(mp, cfg2);
  assert.equal(result.level, CHANGE_LEVELS.FULL);
  assert.ok(result.changes.includes('format'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('plan detects full rebuild on timing change', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({ timing: { gapSentence: 0.5, gapTurn: 0.5, lead: 0.2, tail: 1.0, tempo: 1.2 } });
  const result = plan(mp, cfg2);
  assert.equal(result.level, CHANGE_LEVELS.FULL);
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
  assert.equal(result.level, CHANGE_LEVELS.VISUAL);
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
  assert.equal(result.level, CHANGE_LEVELS.AUDIO);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- config-only change ------------------------------------------------------

test('plan detects config-only change (platform, theme, captions)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-plan-'));
  const cfg1 = makeConfig();
  const mp = writeManifest(cfg1, tmp);
  const cfg2 = makeConfig({ platform: 'tiktok' });
  const result = plan(mp, cfg2);
  assert.equal(result.level, CHANGE_LEVELS.CONFIG);
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
  assert.equal(result.level, CHANGE_LEVELS.FULL);
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

// ---- formatPlan output -------------------------------------------------------

test('formatPlan produces readable output for each change level', () => {
  for (const level of Object.values(CHANGE_LEVELS)) {
    const result = { level, changes: [], detail: {}, fromHash: 'abc123', toHash: 'def456' };
    const out = formatPlan(result);
    assert.ok(out.includes(level.icon), `missing icon for ${level.label}`);
    assert.ok(out.includes(level.label), `missing label for ${level.label}`);
    if (level.synth) assert.ok(out.includes('synth'));
    if (level.compose) assert.ok(out.includes('compose'));
    if (level.render) assert.ok(out.includes('render'));
  }
});

test('formatPlan with scene changes includes scene details', () => {
  const result = {
    level: CHANGE_LEVELS.AUDIO,
    changes: [{ scene: 's1', voChanged: true }],
    detail: {}, fromHash: 'abc', toHash: 'def',
  };
  const out = formatPlan(result);
  assert.ok(out.includes('s1'));
  assert.ok(out.includes('vo'));
});
