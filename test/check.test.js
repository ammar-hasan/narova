'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { check } = require('../src/check');

/* check() prints via console.log; capture it. */
function run(config) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { check(config); } finally { console.log = orig; }
  return lines;
}

const base = (scenes, themeCss = '') => ({
  title: 'T', size: { w: 100, h: 100 }, themeCss,
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

test('cues inside HTML comments are ignored', () => {
  const lines = run(base([{ id: 's', body: '<!-- <p data-cue="9">x</p> --><p>y</p>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
});
