'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check } = require('../src/check');

/* check() prints via console.log; capture it. */
function run(config) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { check(config); } finally { console.log = orig; }
  return lines;
}

const base = (scenes, themeCss = '', assetsDir = null) => ({
  title: 'T', size: { w: 100, h: 100 }, themeCss,
  assetsDir,
  voices: { a: { backend: 'piper' } },
  scenes,
});

test('valid cues produce no warnings', () => {
  const lines = run(base([{ id: 's', body: '<p data-cue="0">x</p><p data-cue="1">y</p>', vo: [{ who: 'a', text: 'one' }, { who: 'a', text: 'two' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
  assert.ok(lines.some(l => l.startsWith('ok:')));
});

test('out-of-range and junk cues warn', () => {
  const lines = run(base([{ id: 's', body: '<p data-cue="5">x</p><p data-cue="nope">y</p>', vo: [{ who: 'a', text: 'one' }] }]));
  const warns = lines.filter(l => l.startsWith('warn:'));
  assert.equal(warns.length, 2);
  assert.match(warns[0], /data-cue="5"/);
  assert.match(warns[1], /data-cue="nope"/);
});

test('duplicate element ids across scenes warn', () => {
  const lines = run(base([
    { id: 'one', body: '<p id="hero">x</p>', vo: [{ who: 'a', text: 'a' }] },
    { id: 'two', body: '<div id="hero">y</div>', vo: [{ who: 'a', text: 'b' }] },
  ]));
  assert.ok(lines.some(l => l.includes('duplicate element id "hero"')), lines.join('\n'));
});

test('infinite CSS animation in theme.css warns', () => {
  const lines = run(base(
    [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'a' }] }],
    '.spin{animation:spin 2s linear infinite}',
  ));
  assert.ok(lines.some(l => l.includes('infinite')), lines.join('\n'));
});

test('cue-like text in prose does not warn', () => {
  const lines = run(base([{ id: 's', body: '<p>write data-cue="9" on an element</p>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
});

test('cue spellings the runtime resolves do not warn', () => {
  // +"1.0" === 1 (integer) — the runtime syncs it to turn 1, so no warning.
  const lines = run(base([{ id: 's', body: '<p data-cue="1.0">x</p>', vo: [{ who: 'a', text: 'a' }, { who: 'a', text: 'b' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
});

test('class="cue" without data-cue warns', () => {
  const lines = run(base([{ id: 's', body: '<p class="lede cue">x</p>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(lines.some(l => l.includes('without data-cue')), lines.join('\n'));
});

test('reserved generated ids warn', () => {
  const lines = run(base([{ id: 's', body: '<div id="cap-stage">x</div><div id="scene-intro">y</div>', vo: [{ who: 'a', text: 'a' }] }]));
  const warns = lines.filter(l => l.includes('collides with a generated composition id'));
  assert.equal(warns.length, 2);
});

test('cues inside HTML comments are ignored', () => {
  const lines = run(base([{ id: 's', body: '<!-- <p data-cue="9">x</p> --><p>y</p>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
});

test('remote scene and theme assets warn', () => {
  const lines = run(base(
    [{ id: 's', body: '<img src="https://example.com/hero.jpg">', vo: [{ who: 'a', text: 'a' }] }],
    '.brand{background:url(https://example.com/font.woff2)}',
  ));
  assert.ok(lines.some(l => l.includes('scene "s" src: remote asset')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('theme.css: remote asset')), lines.join('\n'));
});

test('named fallback fonts warn about extra HyperFrames downloads', () => {
  const lines = run(base(
    [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'a' }] }],
    ':root{--serif:"Brand Serif",Georgia,"Times New Roman",serif}',
  ));
  assert.ok(lines.some(l => l.includes('named fallback font')), lines.join('\n'));
});

test('missing, misplaced, and escaping project assets warn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-assets-'));
  fs.writeFileSync(path.join(dir, 'ok.svg'), '<svg/>');
  const lines = run(base([{
    id: 's',
    body: '<img src="logo.svg"><img src="assets/missing.svg"><div style="background:url(assets/../secret.png)"></div><img src="assets/ok.svg">',
    vo: [{ who: 'a', text: 'a' }],
  }], '', dir));
  assert.ok(lines.some(l => l.includes('must live under project assets/')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('asset not found: assets/missing.svg')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('escapes project assets/')), lines.join('\n'));
  assert.ok(!lines.some(l => l.includes('asset not found: assets/ok.svg')), lines.join('\n'));
});
