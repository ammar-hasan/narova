'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { composeDoc, escapeHtml } = require('../skills/narova/tool/src/compose/html');
const { composeData } = require('../skills/narova/tool/src/compose/data');

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
  assert.match(h, /<audio id="vo" src="assets\/narration.wav" data-start="0" data-duration="9" data-track-index="10">/);
  assert.ok(!/<audio[^>]*class=/.test(h));
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
