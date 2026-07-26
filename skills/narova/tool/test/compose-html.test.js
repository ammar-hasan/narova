'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { composeDoc, escapeHtml, namespaceIds } = require('../src/compose/html');
const { composeData } = require('../src/compose/data');

const config = {
  title: 'A <"quoted"> & Title',
  voices: { a: { label: 'A' } },
  scenes: [
    { id: 's1', body: '<p class="cue" data-cue="0">x</p>' },
    { id: 's2', body: '<p>y</p>' },
  ],
};
const timings = {
  s1: { dur: 5, turns: [0.1], words: [{ w: 'Hi.', t0: 0.1, t1: 0.5, who: 'a', si: 0 }] },
  s2: { dur: 4, turns: [0.1], words: [{ w: '</script>', t0: 0.1, t1: 0.5, who: 'a', si: 0 }] },
};
const size = { w: 640, h: 360 };

function doc() {
  return composeDoc(config, size, composeData(config, timings), '/*css*/');
}

test('document starts with the doctype (hyperframes lint requirement)', () => {
  assert.ok(doc().startsWith('<!doctype html>'));
});

test('root carries the composition contract attributes', () => {
  const h = doc();
  assert.match(h, /data-composition-id="main"/);
  assert.match(h, /data-width="640"/);
  assert.match(h, /data-duration="9"/);          // 5 + 4, trailing zeros trimmed
});

test('scene clips chain and carry class="clip"', () => {
  const h = doc();
  assert.match(h, /<section id="scene-s1" class="clip scene" data-start="0" data-duration="5" data-track-index="1">/);
  assert.match(h, /<section id="scene-s2" class="clip scene" data-start="5" data-duration="4" data-track-index="1">/);
});

test('audio is a direct root child without clip class', () => {
  const h = doc();
  assert.match(h, /<audio id="vo" src="assets\/narration.wav" data-start="0" data-track-index="1001">/);
  assert.ok(!/<audio[^>]*data-duration=/.test(h), 'HyperFrames infers the intrinsic WAV duration');
  assert.ok(!/<audio[^>]*class=/.test(h));
});

test('long reels split scene clips across sparse editable tracks', () => {
  const manyConfig = {
    ...config,
    scenes: Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, body: '<p>x</p>' })),
  };
  const manyTimings = Object.fromEntries(manyConfig.scenes.map(s => [s.id, {
    dur: 1, turns: [0], words: [],
  }]));
  const h = composeDoc(manyConfig, size, composeData(manyConfig, manyTimings), '');
  assert.match(h, /id="scene-s2"[^>]*data-track-index="1"/);
  assert.match(h, /id="scene-s3"[^>]*data-track-index="2"/);
  assert.match(h, /id="scene-s5"[^>]*data-track-index="2"/);
  assert.match(h, /id="overlay"[^>]*data-track-index="1000"/);
});

test('a </script> inside spoken words cannot break the DATA block', () => {
  const h = doc();
  const script = h.slice(h.indexOf('var DATA'));
  assert.ok(!script.slice(0, script.indexOf('window.__timelines')).includes('</script>'));
});

test('the title is HTML-escaped', () => {
  assert.ok(doc().includes('<title>A &lt;"quoted"&gt; &amp; Title</title>'));
  assert.equal(escapeHtml('<&>'), '&lt;&amp;&gt;');
});

test('scene bodies are embedded verbatim', () => {
  assert.ok(doc().includes('<p class="cue" data-cue="0">x</p>'));
});

test('body ids are namespaced per scene so SVG defs can repeat across scenes', () => {
  const svg = '<svg><defs><linearGradient id="grad"><stop offset="0"/></linearGradient></defs>' +
    '<rect fill="url(#grad)"/></svg>';
  const dup = {
    ...config,
    scenes: [
      { id: 'one', body: svg },
      { id: 'two', body: svg },
    ],
  };
  const dupTimings = Object.fromEntries(dup.scenes.map(s => [s.id, timings.s1]));
  const h = composeDoc(dup, size, composeData(dup, dupTimings), '');
  assert.match(h, /id="one--grad"/);
  assert.match(h, /id="two--grad"/);
  assert.match(h, /url\(#one--grad\)/);
  assert.match(h, /url\(#two--grad\)/);
  assert.ok(!/(?<!-)id="grad"/.test(h), 'the bare id must not survive');
});

test('namespacing rewrites href, for, and aria token-list references', () => {
  const body = '<svg><defs><symbol id="ic"></symbol></defs><use href="#ic" xlink:href="#ic"/></svg>' +
    '<label for="fld">L</label><input id="fld" aria-describedby="fld note">' +
    '<p id="note">n</p>';
  const h = composeDoc({ ...config, scenes: [{ id: 'sc', body }] }, size,
    composeData({ ...config, scenes: [{ id: 'sc', body }] }, { sc: timings.s1 }), '');
  assert.match(h, /href="#sc--ic"/);
  assert.match(h, /xlink:href="#sc--ic"/);
  assert.match(h, /for="sc--fld"/);
  assert.match(h, /aria-describedby="sc--fld sc--note"/);
});

test('a body without ids passes through byte-identical', () => {
  assert.equal(namespaceIds('<p class="x">no ids here</p>', 's1'), '<p class="x">no ids here</p>');
});

test('chrome is on by default: topbar, counter, progress bar', () => {
  const h = doc();
  assert.match(h, /class="topbar"/);
  assert.match(h, /class="counter"/);
  assert.match(h, /<div class="progress"><i id="progress-bar"><\/i><\/div>/);
});

test('chrome:false strips topbar, counter, and progress bar', () => {
  // resolveConfig turns `chrome:false` into this explicit all-off object.
  const off = { topbar: false, counter: false, progress: false };
  const h = composeDoc({ ...config, chrome: off }, size, composeData(config, timings), '');
  assert.ok(!/class="topbar"/.test(h));
  assert.ok(!/class="counter"/.test(h));
  assert.ok(!/id="progress-bar"/.test(h));
});

test('chrome.counter:false keeps a wordmark-only topbar', () => {
  const schema = { topbar: true, counter: false, progress: true };
  const h = composeDoc({ ...config, chrome: schema }, size, composeData(config, timings), '');
  assert.match(h, /class="topbar"/);
  assert.match(h, /class="wordmark"/);
  assert.ok(!/class="counter"/.test(h));
  assert.match(h, /id="progress-bar"/);
});

test('the caption stage carries the preset class (karaoke by default)', () => {
  assert.match(doc(), /id="cap-stage" class="cap-preset-karaoke"/);
});

test('a configured caption preset lands on the caption stage', () => {
  const cfg = { ...config, captions: { preset: 'slam', emphasis: [] } };
  const h = composeDoc(cfg, size, composeData(cfg, timings), '');
  assert.match(h, /id="cap-stage" class="cap-preset-slam"/);
  assert.match(h, /"preset":"slam"/, 'DATA carries the same preset for the runtime');
});

// -- b-roll clips --

test('scene without clip has no video element', () => {
  const h = doc();
  assert.ok(!h.includes('<video class="broll"'), 'no broll when clip is absent');
});

test('scene with clip renders a muted, looping video behind chrome', () => {
  const clipCfg = {
    ...config,
    scenes: [
      { id: 's1', body: '<p>x</p>', clip: 'assets/intro.mp4' },
      { id: 's2', body: '<p>y</p>' },
    ],
  };
  const cliptimings = Object.fromEntries(clipCfg.scenes.map(s => [s.id, timings[s.id] || timings.s1]));
  const h = composeDoc(clipCfg, size, composeData(clipCfg, cliptimings), '');
  // s1 has a clip; s2 doesn't.
  assert.match(h, /<video class="broll" src="assets\/clip-s1\.mp4" autoplay loop muted playsinline>/);
  assert.ok(!h.includes('clip-s2'), 'scene 2 has no clip');
  // video appears before chrome div inside the scene section.
  const s1Chunk = h.slice(h.indexOf('id="scene-s1"'));
  const s1End = s1Chunk.indexOf('</section>');
  const vidIdx = s1Chunk.slice(0, s1End).indexOf('<video class="broll"');
  const chromeIdx = s1Chunk.slice(0, s1End).indexOf('<div class="chrome">');
  assert.ok(vidIdx < chromeIdx, 'broll video must be before chrome div');
});

// -- series badge --

test('series badge renders when series config is present', () => {
  const h = composeDoc({ ...config, series: { part: 2, total: 5 } }, size, composeData(config, timings), '');
  assert.match(h, /<div class="series-badge">Part 2 \/ 5<\/div>/);
});

test('series badge with unknown total omits the denominator', () => {
  const h = composeDoc({ ...config, series: { part: 1 } }, size, composeData(config, timings), '');
  assert.match(h, /<div class="series-badge">Part 1<\/div>/);
});

test('no series badge when series is not configured', () => {
  const h = doc();
  assert.ok(!h.includes('series-badge'));
});
