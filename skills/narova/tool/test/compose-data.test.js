'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { composeData, r3 } = require('../src/compose/data');

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

test('each group ends at the next group start or its scene boundary', () => {
  const d = composeData(config, timings);
  // Groups within the same scene: end when the next starts.
  assert.equal(d.groups[0].end, d.groups[1].start);
  // Last group in a scene: capped at scene end, not the next scene's first word.
  assert.equal(d.groups[1].end, r3(0 + 10.101));  // s1 dur
  assert.equal(d.groups[2].end, r3(d.total));      // s2's last group ends at total
});

test('a scene missing from timings.json throws a helpful error', () => {
  assert.throws(() => composeData({ ...config, scenes: [{ id: 'ghost' }] }, timings),
    /no entry for scene "ghost".*narova synth/);
});

test('preset defaults to subtitle and passes config.captions.preset through', () => {
  assert.equal(composeData(config, timings).preset, 'subtitle');
  const slam = { ...config, captions: { preset: 'slam', emphasis: [] } };
  assert.equal(composeData(slam, timings).preset, 'slam');
});

test('emphasis words get kw=1, matched case-insensitively with punctuation stripped', () => {
  const emph = { ...config, captions: { preset: 'karaoke', emphasis: ['World', 'bye'] } };
  const d = composeData(emph, timings);
  assert.equal(d.groups[0].words[0].kw, undefined);          // Hello
  assert.equal(d.groups[0].words[1].kw, 1);                  // world. -> World
  assert.equal(d.groups[2].words[0].kw, 1);                  // Bye. -> bye
});

test('emphasis entries are punctuation-stripped too; no emphasis means no kw keys', () => {
  const emph = { ...config, captions: { preset: 'karaoke', emphasis: ['"hello,"'] } };
  const d = composeData(emph, timings);
  assert.equal(d.groups[0].words[0].kw, 1);                  // Hello -> "hello,"
  const plain = composeData(config, timings);
  assert.ok(plain.groups.every(g => g.words.every(w => !('kw' in w))),
    'DATA stays lean when nothing is emphasized');
});

test('scene transition passes through; absent leaves no key (fade default)', () => {
  const tr = { ...config, scenes: [{ id: 's1', body: '', transition: 'wipe' }, { id: 's2', body: '' }] };
  const d = composeData(tr, timings);
  assert.equal(d.scenes[0].transition, 'wipe');
  assert.ok(!('transition' in d.scenes[1]));
});

test('DATA stays JSON-serializable with preset, kw, and transition', () => {
  const full = { ...config, captions: { preset: 'pop', emphasis: ['world'] },
    scenes: [{ id: 's1', body: '', transition: 'slide' }, { id: 's2', body: '' }] };
  const d = composeData(full, timings);
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});
