'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveConfig, narration } = require('../src/schema');

const validRaw = () => ({
  title: 'T',
  size: '1:1',
  voices: { a: { speaker: 'v1' }, b: { speaker: 'v2' } },
  scenes: [
    { id: 's1', body: '<p>one</p>', vo: [{ who: 'a', text: 'Hello there.' }] },
    { id: 's2', body: '<p>two</p>', vo: [{ who: 'a', text: 'Hi.' }, { who: 'b', text: 'Yo.' }] },
  ],
});

test('resolveConfig fills voice defaults', () => {
  const c = resolveConfig(validRaw(), {}, '.');
  assert.equal(c.voices.a.backend, 'piper');
  assert.ok(c.voices.a.color);
  assert.ok(c.voices.b.label.includes('B'));
  assert.notEqual(c.voices.a.color, c.voices.b.color);
});

test('resolveConfig resolves size presets', () => {
  assert.deepEqual(resolveConfig(validRaw(), {}, '.').size, { w: 1080, h: 1080 });
  assert.deepEqual(resolveConfig({ ...validRaw(), size: '9:16' }, {}, '.').size, { w: 720, h: 1280 });
  assert.deepEqual(resolveConfig(validRaw(), { size: '16:9' }, '.').size, { w: 1280, h: 720 });
});

test('resolveConfig applies CLI overrides', () => {
  const c = resolveConfig(validRaw(), { backend: 'xtts', voiceA: 'X', voiceB: 'Y', tempo: '1.3' }, '.');
  assert.equal(c.voices.a.backend, 'xtts');
  assert.equal(c.voices.a.speaker, 'X');
  assert.equal(c.voices.b.speaker, 'Y');
  assert.equal(c.timing.tempo, 1.3);
});

test('resolveConfig aggregates every error', () => {
  const bad = {
    voices: {},
    scenes: [
      { id: 'x', body: 42, vo: [] },
      { id: 'x', body: '<p></p>', vo: [{ who: 'ghost', text: 'hi' }] },
    ],
  };
  assert.throws(() => resolveConfig(bad, {}, '.'), err => {
    assert.match(err.message, /voices: at least one voice required/);
    assert.match(err.message, /body: HTML string required/);
    assert.match(err.message, /duplicate "x"/);
    assert.match(err.message, /"ghost" not in config.voices/);
    return true;
  });
});

test('resolveConfig rejects unsafe scene/voice ids and theme values', () => {
  const bad = validRaw();
  bad.voices['bad id'] = { speaker: 'v3' };
  bad.scenes[0].id = 'has"quote';
  bad.theme = { accent: 'red;}</style>' };
  assert.throws(() => resolveConfig(bad, {}, '.'), err => {
    assert.match(err.message, /voice id must match/);
    assert.match(err.message, /"has"quote" must match/);
    assert.match(err.message, /must not contain/);
    return true;
  });
});

test('resolveConfig reports an unknown size as a config error', () => {
  assert.throws(() => resolveConfig({ ...validRaw(), size: '4:3' }, {}, '.'), /config\.size: unknown size/);
});

test('resolveConfig rejects a missing theme.css file', () => {
  const raw = { ...validRaw(), theme: { css: 'no-such-file.css' } };
  assert.throws(() => resolveConfig(raw, {}, '.'), /theme\.css: file not found/);
});

test('resolveConfig discovers project assets and rejects unsafe asset paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-assets-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  assert.equal(resolveConfig(validRaw(), {}, dir).assetsDir, path.join(dir, 'assets'));
  assert.throws(() => resolveConfig({ ...validRaw(), assets: '../shared' }, {}, dir), /must be inside the project/);
  assert.throws(() => resolveConfig({ ...validRaw(), assets: 'missing' }, {}, dir), /directory not found/);
});

test('legacy caption/dur fields are accepted', () => {
  const raw = validRaw();
  raw.scenes[0].caption = 'legacy';
  raw.scenes[0].dur = 12;
  assert.doesNotThrow(() => resolveConfig(raw, {}, '.'));
});

test('narration produces the Python contract', () => {
  const c = resolveConfig(validRaw(), {}, '.');
  const n = narration(c);
  assert.deepEqual(n.map(s => [s.n, s.id]), [[1, 's1'], [2, 's2']]);
  assert.deepEqual(n[1].segments, c.scenes[1].vo);
});
