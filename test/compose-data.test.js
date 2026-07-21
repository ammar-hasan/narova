'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { composeData, r3 } = require('../skills/narova/tool/src/compose/data');

const config = {
  voices: { a: { label: 'host A' }, b: { label: 'host B' } },
  scenes: [{ id: 's1', body: '' }, { id: 's2', body: '' }],
};

const timings = {
  s1: {
    dur: 10.101,
    turns: [0.16, 5.2],
    words: [
      { w: 'Hello', t0: 0.16, t1: 0.5, who: 'a', si: 0 },
      { w: 'world.', t0: 0.5, t1: 1.0, who: 'a', si: 0 },
      { w: 'Reply.', t0: 5.2, t1: 5.9, who: 'b', si: 1 },
    ],
  },
  s2: {
    dur: 7.503,
    turns: [0.16],
    words: [{ w: 'Bye.', t0: 0.16, t1: 0.7, who: 'a', si: 0 }],
  },
};

test('scene starts chain exactly (rounded cumulative sum)', () => {
  const d = composeData(config, timings);
  assert.equal(d.scenes[0].start, 0);
  assert.equal(d.scenes[1].start, r3(0 + 10.101));
  // the invariant HyperFrames overlap-lint depends on:
  assert.equal(d.scenes[1].start, r3(d.scenes[0].start + d.scenes[0].dur));
  assert.equal(d.total, r3(d.scenes[1].start + d.scenes[1].dur));
});

test('turns stay scene-local; group/word times go global', () => {
  const d = composeData(config, timings);
  assert.deepEqual(d.scenes[0].turns, [0.16, 5.2]);      // scene-local
  const g3 = d.groups[2];                                 // s2's sentence
  assert.equal(g3.start, r3(10.101 + 0.16));              // global
  assert.equal(g3.words[0].t1, r3(10.101 + 0.7));
});

test('words group by sentence with speaker + label', () => {
  const d = composeData(config, timings);
  assert.equal(d.groups.length, 3);
  assert.deepEqual(d.groups.map(g => g.who), ['a', 'b', 'a']);
  assert.equal(d.groups[0].label, 'host A');
  assert.equal(d.groups[0].words.length, 2);
});

test('each group ends when the next starts; last ends at total', () => {
  const d = composeData(config, timings);
  for (let i = 0; i < d.groups.length - 1; i++) {
    assert.equal(d.groups[i].end, d.groups[i + 1].start);
  }
  assert.equal(d.groups.at(-1).end, d.total);
});

test('a scene missing from timings.json throws a helpful error', () => {
  assert.throws(() => composeData({ ...config, scenes: [{ id: 'ghost' }] }, timings),
    /no entry for scene "ghost".*narova synth/);
});
