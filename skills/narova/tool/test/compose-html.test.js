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

test('stylesheet is an external link, not inlined (keeps HTML under composition_file_too_large threshold)', () => {
  const h = doc();
  assert.match(h, /<link rel="stylesheet" href="style\.css">/);
  assert.ok(!h.includes('<style>'), 'CSS must not be inlined');
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

test('scene with clip renders a b-roll video as a root-level clip before the scene', () => {
  const clipCfg = {
    ...config,
    scenes: [
      { id: 's1', body: '<p>x</p>', clip: 'assets/intro.mp4' },
      { id: 's2', body: '<p>y</p>' },
    ],
  };
  const cliptimings = Object.fromEntries(clipCfg.scenes.map(s => [s.id, timings[s.id] || timings.s1]));
  const h = composeDoc(clipCfg, size, composeData(clipCfg, cliptimings), '');
  assert.match(h, /<video id="broll-s1" class="broll" src="assets\/clip-s1\.mp4" data-start="0" data-duration="5" data-track-index="100" muted loop playsinline preload="auto">/);
  assert.ok(!h.includes('broll-s2'), 'scene 2 has no clip');
  // b-roll appears before scene-s1 in the root div.
  const brollIdx = h.indexOf('broll-s1');
  const sceneIdx = h.indexOf('id="scene-s1"');
  assert.ok(brollIdx < sceneIdx, 'broll must be before the scene section in the root');
});

test('b-roll data-duration matches its scene duration (scene-bounded, no bleed)', () => {
  const clipCfg = {
    ...config,
    scenes: [
      { id: 's1', body: '<p>x</p>', clip: 'assets/intro.mp4' },
      { id: 's2', body: '<p>y</p>' },
    ],
  };
  const cliptimings = Object.fromEntries(clipCfg.scenes.map(s => [s.id, timings[s.id] || timings.s1]));
  const h = composeDoc(clipCfg, size, composeData(clipCfg, cliptimings), '');
  // s1 dur is 5, s2 has no clip.
  assert.match(h, /broll-s1.*data-duration="5"/);
  assert.ok(!h.includes('broll-s2'));
  // Verify the data-start of scene-s2 equals the end of s1's broll (start+dur=0+5=5)
  assert.match(h, /id="scene-s2"[^>]*data-start="5"/);
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

// -- project choreography --

const CHOREO = 'tl.to("#scene-s1 .evict", { y: 1050, duration: 1.7 }, 2.4);';

test('choreography is inlined after the runtime, in the same script block', () => {
  const h = composeDoc({ ...config, choreography: CHOREO }, size, composeData(config, timings), '');
  const block = h.slice(h.indexOf('<script>\nvar DATA'), h.indexOf('</script>\n</body>'));
  assert.ok(block.includes(CHOREO), 'choreography must be inlined');
  // Must land after the timeline is registered, so the built-in animators are
  // already on `tl` when project code adds to it.
  assert.ok(block.indexOf(CHOREO) > block.indexOf("window.__timelines['main'] = tl;"),
    'choreography must follow runtimeScript(), not precede it');
});

test('no choreography leaves the script block untouched', () => {
  const h = doc();
  assert.ok(!h.includes('project choreography'));
});

test('a </script> inside choreography cannot break out of the block', () => {
  const nasty = 'var s = "</script><img onerror=x>";';
  const h = composeDoc({ ...config, choreography: nasty }, size, composeData(config, timings), '');
  const tail = h.slice(h.indexOf('var DATA'));
  // The payload stays in the block — inert inside a JS string literal. What
  // matters is that it did not terminate the block early, so exactly one
  // closing tag remains: the real one.
  assert.equal((tail.match(/<\/script>/g) || []).length, 1,
    'the injected closing tag must not become a second, real one');
  assert.ok(tail.includes('<\\/script><img onerror=x>'),
    'the closing tag must be backslash-escaped, not stripped');
});

test('choreography keeps "<" comparisons intact (unlike the DATA block)', () => {
  const cmp = 'if (sc.start < 3 && i <= 2) tl.set(".x", { opacity: 1 }, 0);';
  const h = composeDoc({ ...config, choreography: cmp }, size, composeData(config, timings), '');
  assert.ok(h.includes(cmp), 'comparison operators must survive verbatim');
  assert.ok(!h.includes('sc.start \\u003c 3'), '"<" must not be entity-escaped in choreography');
});

test('GSAP is loaded from local vendored asset, never a CDN', () => {
  const h = doc();
  assert.ok(!h.includes('cdn.jsdelivr.net'), 'generated HTML must not reference jsdelivr CDN');
  assert.ok(!h.includes('unpkg.com'), 'generated HTML must not reference unpkg CDN');
  assert.ok(h.includes('src="assets/gsap.min.js"'), 'GSAP must be loaded from local vendored assets');
});

test('generated HTML contains no remote script dependencies', () => {
  const h = doc();
  const scriptSrcs = [...h.matchAll(/<script\s[^>]*src="([^"]+)"/g)].map(m => m[1]);
  for (const src of scriptSrcs) {
    assert.ok(!src.startsWith('http://') && !src.startsWith('https://'),
      'script src must be local, not remote: ' + src);
  }
});
