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

test('ids may repeat across scenes (compose namespaces them); within-scene duplicates warn', () => {
  const across = run(base([
    { id: 'one', body: '<p id="hero">x</p>', vo: [{ who: 'a', text: 'a' }] },
    { id: 'two', body: '<div id="hero">y</div>', vo: [{ who: 'a', text: 'b' }] },
  ]));
  assert.ok(!across.some(l => l.startsWith('warn:')), across.join('\n'));
  const within = run(base([
    { id: 'one', body: '<p id="hero">x</p><div id="hero">y</div>', vo: [{ who: 'a', text: 'a' }] },
  ]));
  assert.ok(within.some(l => l.includes('duplicate id "hero" within the scene')), within.join('\n'));
});

test('the ok line carries a narration-length estimate', () => {
  const lines = run(base([{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'one two three four five six seven eight nine ten' }] }]));
  assert.match(lines.find(l => l.startsWith('ok:')), /≈\d+s narration \(est\. at tempo 1\.18\)/);
});

test('non-numeric data-delay / data-count warn', () => {
  const lines = run(base([{
    id: 's',
    body: '<p data-delay="soon">x</p><span data-count="lots">0</span>',
    vo: [{ who: 'a', text: 'a' }],
  }]));
  assert.ok(lines.some(l => l.includes('data-delay="soon" is not a number')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('data-count="lots" is not numeric')), lines.join('\n'));
});

test('data-drift on the same element as a reveal/cue warns; on a wrapper it does not', () => {
  const clash = run(base([{
    id: 's',
    body: '<img data-drift="in" class="reveal"><div data-drift="left" data-cue="0">x</div>',
    vo: [{ who: 'a', text: 'a' }],
  }]));
  const warns = clash.filter(l => l.startsWith('warn:') && l.includes('data-drift'));
  assert.equal(warns.length, 2, clash.join('\n'));
  assert.match(warns[0], /data-drift="in".*reveal\/\.cue/);

  const ok = run(base([{
    id: 's',
    body: '<div class="reveal"><img data-drift="in"></div>',
    vo: [{ who: 'a', text: 'a' }],
  }]));
  assert.ok(!ok.some(l => l.startsWith('warn:') && l.includes('data-drift')), ok.join('\n'));
});

test('a theme.css #id selector warns (compose namespaces body ids)', () => {
  const lines = run(base(
    [{ id: 's', body: '<p id="hero">x</p>', vo: [{ who: 'a', text: 'a' }] }],
    '#hero{color:red}',
  ));
  assert.ok(lines.some(l => l.includes('theme.css targets #hero')), lines.join('\n'));
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

test('ids that collide with generated composition ids are safe (namespaced at compose)', () => {
  const lines = run(base([{ id: 's', body: '<div id="cap-stage">x</div><div id="scene-intro">y</div>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
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

test('stats and superlatives in the vo warn without a claims.md ledger', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-claims-'));
  const scenes = [{ id: 's', body: '<p>x</p>', vo: [
    { who: 'a', text: 'Over 2,000+ products, delivered everywhere.' },
    { who: 'a', text: 'It is the leading platform in the region.' },
    { who: 'a', text: 'Just a plain sentence with nothing to check.' },
  ] }];
  const lines = run({ ...base(scenes), projectDir: dir });
  assert.ok(lines.some(l => l.includes('no claims.md ledger')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('2,000+ products')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('leading platform')), lines.join('\n'));
  assert.ok(!lines.some(l => l.includes('plain sentence')), lines.join('\n'));
});

test('a claims.md ledger in the project dir silences the grounding warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-claims-'));
  fs.writeFileSync(path.join(dir, 'claims.md'), '# claims\n- "2,000+ products" — verbatim, https://example.com\n');
  const scenes = [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'Over 2,000+ products.' }] }];
  const lines = run({ ...base(scenes), projectDir: dir });
  assert.ok(!lines.some(l => l.includes('claims.md')), lines.join('\n'));
});

test('unknown scene transitions warn naming the valid set; fade/wipe/slide/zoom/absent do not', () => {
  const bad = run(base([{ id: 's', body: '<p>x</p>', transition: 'spiral', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(bad.some(l => l.includes('unknown transition "spiral"') && l.includes('fade, wipe, slide, zoom')), bad.join('\n'));
  for (const transition of ['fade', 'wipe', 'slide', 'zoom', undefined]) {
    const lines = run(base([{ id: 's', body: '<p>x</p>', transition, vo: [{ who: 'a', text: 'a' }] }]));
    assert.ok(!lines.some(l => l.includes('transition')), `transition ${transition} must not warn`);
  }
});

test('unknown data-mark kinds warn; known kinds do not', () => {
  const bad = run(base([{ id: 's', body: '<p data-mark="scribble">x</p>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(bad.some(l => l.includes('data-mark="scribble"') && l.includes('underline, circle, box, highlight')), bad.join('\n'));
  for (const kind of ['underline', 'circle', 'box', 'highlight']) {
    const lines = run(base([{ id: 's', body: `<p data-mark="${kind}">x</p>`, vo: [{ who: 'a', text: 'a' }] }]));
    assert.ok(!lines.some(l => l.startsWith('warn:')), `data-mark=${kind} must not warn: ` + lines.join('\n'));
  }
});

/* A scene with ~N spoken words for the platform-band tests. */
const wordy = n => [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: Array(n).fill('word').join(' ') }] }];

test('platform band: narration outside the target range warns, inside does not', () => {
  // tiktok band 21–34s ≈ 60–100 words at default tempo.
  const long = run({ ...base(wordy(400)), platform: 'tiktok' });
  assert.ok(long.some(l => /platform tiktok targets 21–34s; estimated narration is \d+s — tighten the script or pick a longer format/.test(l)), long.join('\n'));
  const short = run({ ...base(wordy(8)), platform: 'tiktok' });
  assert.ok(short.some(l => /platform tiktok targets 21–34s.*add material or pick a shorter format/.test(l)), short.join('\n'));
  const ok = run({ ...base(wordy(80)), platform: 'tiktok' });
  assert.ok(!ok.some(l => l.includes('platform')), ok.join('\n'));
});

test('platform x has no lower bound — only warns above 140s', () => {
  const short = run({ ...base(wordy(5)), platform: 'x' });
  assert.ok(!short.some(l => l.includes('platform')), short.join('\n'));
  const long = run({ ...base(wordy(600)), platform: 'x' });
  assert.ok(long.some(l => /platform x allows up to 140s.*tighten the script/.test(l)), long.join('\n'));
});

test('no platform set: no platform lint', () => {
  const lines = run(base(wordy(600)));
  assert.ok(!lines.some(l => l.includes('platform')), lines.join('\n'));
});

// -- hook enforcement --

test('hook: lead-in silence >200ms warns', () => {
  const lines = run({ ...base(wordy(20)), timing: { lead: 0.38 } });
  assert.ok(lines.some(l => l.includes('timing.lead is 0.38s') && l.includes('200ms')), lines.join('\n'));
});

test('hook: lead-in silence ≤200ms is silent', () => {
  const lines = run({ ...base(wordy(20)), timing: { lead: 0.16 } });
  assert.ok(!lines.some(l => l.includes('lead-in')), lines.join('\n'));
});

test('hook: scene 1 with no visible text warns', () => {
  const lines = run(base([
    { id: 'hook', body: '<div class="bg"></div>', vo: [{ who: 'a', text: 'hello' }] },
  ]));
  assert.ok(lines.some(l => l.includes('scene 1 has no visible text') && l.includes('muted')), lines.join('\n'));
});

test('hook: scene 1 with text is silent', () => {
  const lines = run(base([
    { id: 'hook', body: '<div class="bg"></div><h1>Hook Text</h1>', vo: [{ who: 'a', text: 'hello' }] },
  ]));
  assert.ok(!lines.some(l => l.includes('no visible text')), lines.join('\n'));
});

test('saveable: last scene with no text or image warns', () => {
  const lines = run(base([
    { id: 'hook', body: '<h1>Start</h1>', vo: [{ who: 'a', text: 'hello' }] },
    { id: 'end', body: '<div class="empty"></div>', vo: [{ who: 'a', text: 'bye' }] },
  ]));
  assert.ok(lines.some(l => l.includes('saveable') && l.includes('end-card')), lines.join('\n'));
});

test('saveable: last scene with text is silent', () => {
  const lines = run(base([
    { id: 'hook', body: '<h1>Start</h1>', vo: [{ who: 'a', text: 'hello' }] },
    { id: 'end', body: '<h2>Subscribe</h2>', vo: [{ who: 'a', text: 'bye' }] },
  ]));
  assert.ok(!lines.some(l => l.includes('saveable') && l.includes('end-card')), lines.join('\n'));
});

test('saveable: last scene with an image is silent', () => {
  const lines = run(base([
    { id: 'hook', body: '<h1>Start</h1>', vo: [{ who: 'a', text: 'hello' }] },
    { id: 'end', body: '<img src="logo.svg">', vo: [{ who: 'a', text: 'bye' }] },
  ]));
  assert.ok(!lines.some(l => l.includes('saveable') && l.includes('end-card')), lines.join('\n'));
});

// -- HyperFrames reserved class names --

test('body elements using HyperFrames-reserved class names warn', () => {
  const lines = run(base([
    { id: 's', body: '<section class="scene hook"><div class="progress"></div></section>', vo: [{ who: 'a', text: 'a' }] },
  ]));
  assert.ok(lines.some(l => l.includes('reserved name "scene"')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('reserved name "progress"')), lines.join('\n'));
});

test('body elements without reserved class names are silent', () => {
  const lines = run(base([
    { id: 's', body: '<section class="story-scene hook-scene"><div class="bar"></div></section>', vo: [{ who: 'a', text: 'a' }] },
  ]));
  assert.ok(!lines.some(l => l.includes('reserved name')), lines.join('\n'));
});
