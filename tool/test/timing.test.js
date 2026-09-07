'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sceneAnchors, effectAnchor, externalTimings } = require('../src/timing');
const { composeData } = require('../src/compose/data');
const fixtures = require('./fixtures/audio-anchors.json');

test('measured and external scene anchors satisfy the shared audio fixtures', () => {
  for (const fixture of fixtures) {
    const config = {
      voices: { a: { label: 'A' } },
      scenes: fixture.scenes.map(scene => ({ ...scene, dur: fixture.timings[scene.id].dur, vo: [] })),
      narrationSource: { file: 'external.wav', wordTimings: [] },
    };
    const external = externalTimings(config);
    for (const timings of [fixture.timings, external]) {
      const { starts } = sceneAnchors(config.scenes, scene => timings[scene.id].dur);
      assert.deepEqual(Object.fromEntries(starts), fixture.starts);
      const data = composeData(config, timings);
      assert.deepEqual(Object.fromEntries(data.scenes.map(scene => [scene.id, scene.start])), fixture.starts);
      for (const effect of fixture.effects) {
        assert.equal(effectAnchor(starts, effect.scene, effect.at).time, effect.expected);
      }
      assert.equal(effectAnchor(starts, 'missing', 0).time, null);
    }
  }
});

test('external profiles preserve overlap edges, raw captions, normalized words and ordinal turns', () => {
  const raw = { text: 'لفظ', start: 1.9999995, end: 2 };
  const config = {
    voices: { a: {} },
    scenes: [
      { id: 'one', dur: 2, vo: [{ who: 'a' }] },
      { id: 'two', dur: 3, vo: [{ who: 'a' }, { who: 'a' }] },
    ],
    narrationSource: { file: 'external.wav', wordTimings: [
      { start: 1.9999995, end: 2, words: [raw] },
      { start: 2.75, end: 3.2, words: [{ text: 'Again', start: 2.75, end: 3.2 }] },
    ] },
  };
  const artifact = externalTimings(config);
  const browser = externalTimings(config, { browser: true });
  assert.deepEqual(artifact.one, { dur: 2, turns: [0], words: [] });
  assert.deepEqual(artifact.two.turns, [0.75, 1.5]);
  assert.deepEqual(artifact.two.words, [{ w: 'Again', t0: 0.75, t1: 1.2000000000000002, who: 'a', si: 0 }]);
  assert.deepEqual(browser.one.words, [raw]);
  assert.equal(Object.hasOwn(browser.one, 'turns'), false);
  assert.deepEqual(browser.two.cueWords, artifact.two.words);
  const hidden = composeData(config, artifact, false);
  assert.equal(hidden.scenes[1].sentences[0].words[0].start, 2.75);
  assert.equal(externalTimings({ ...config, narrationSource: { file: 'external.wav' } }, { browser: true }), null);
  assert.deepEqual(externalTimings({ ...config, narrationSource: { file: 'external.wav' } }).two,
    { dur: 3, turns: [0, 1.5], words: [] });
});

test('legacy mix and composition precision remain explicit profiles', () => {
  const scenes = [{ id: 'a', dur: 0.3334 }, { id: 'b', dur: 0.3334 }, { id: 'c', dur: 1 }];
  assert.equal(sceneAnchors(scenes, scene => scene.dur).starts.get('c'), 0.667);
  assert.equal(sceneAnchors(scenes, scene => scene.dur, { roundEach: true }).starts.get('c'), 0.666);
});
