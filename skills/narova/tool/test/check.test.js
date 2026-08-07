'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check } = require('../src/check');

/* check() prints via console.log; capture it. */
function run(config, opts = {}) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let ok;
  try { ok = check(config, opts); } finally { console.log = orig; }
  return { ok, lines };
}

const base = (scenes, themeCss = '', assetsDir = null) => ({
  title: 'T', size: { w: 100, h: 100 }, themeCss,
  assetsDir,
  voices: { a: { backend: 'piper' } },
  scenes,
});

test('valid cues produce no warnings', () => {
  const { lines } = run(base([{ id: 's', body: '<p data-cue="0">x</p><p data-cue="1">y</p>', vo: [{ who: 'a', text: 'one' }, { who: 'a', text: 'two' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
  assert.ok(lines.some(l => l.startsWith('ok:')));
});

test('out-of-range and junk cues warn', () => {
  const { lines } = run(base([{ id: 's', body: '<p data-cue="5">x</p><p data-cue="nope">y</p>', vo: [{ who: 'a', text: 'one' }] }]));
  const warns = lines.filter(l => l.startsWith('warn:'));
  assert.equal(warns.length, 2);
  assert.match(warns[0], /data-cue="5"/);
  assert.match(warns[1], /data-cue="nope"/);
});

test('ids may repeat across scenes (compose namespaces them); within-scene duplicates warn', () => {
  const across = run(base([
    { id: 'one', body: '<p id="hero">x</p>', vo: [{ who: 'a', text: 'a' }] },
    { id: 'two', body: '<div id="hero">y</div>', vo: [{ who: 'a', text: 'b' }] },
  ])).lines;
  assert.ok(!across.some(l => l.startsWith('warn:')), across.join('\n'));
  const within = run(base([
    { id: 'one', body: '<p id="hero">x</p><div id="hero">y</div>', vo: [{ who: 'a', text: 'a' }] },
  ])).lines;
  assert.ok(within.some(l => l.includes('duplicate id "hero" within the scene')), within.join('\n'));
});

test('the ok line carries a narration-length estimate', () => {
  const { lines } = run(base([{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'one two three four five six seven eight nine ten' }] }]));
  assert.match(lines.find(l => l.startsWith('ok:')), /≈\d+s narration \(est\. at tempo 1\.18\)/);
});

test('non-numeric data-delay / data-count warn', () => {
  const { lines } = run(base([{
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
  }])).lines;
  const warns = clash.filter(l => l.startsWith('warn:') && l.includes('data-drift'));
  assert.equal(warns.length, 2, clash.join('\n'));
  assert.match(warns[0], /data-drift="in".*reveal\/\.cue/);

  const ok = run(base([{
    id: 's',
    body: '<div class="reveal"><img data-drift="in"></div>',
    vo: [{ who: 'a', text: 'a' }],
  }])).lines;
  assert.ok(!ok.some(l => l.startsWith('warn:') && l.includes('data-drift')), ok.join('\n'));
});

test('a theme.css #id selector warns (compose namespaces body ids)', () => {
  const { lines } = run(base(
    [{ id: 's', body: '<p id="hero">x</p>', vo: [{ who: 'a', text: 'a' }] }],
    '#hero{color:red}',
  ));
  assert.ok(lines.some(l => l.includes('theme.css targets #hero')), lines.join('\n'));
});

test('infinite CSS animation in theme.css warns', () => {
  const { lines } = run(base(
    [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'a' }] }],
    '.spin{animation:spin 2s linear infinite}',
  ));
  assert.ok(lines.some(l => l.includes('infinite')), lines.join('\n'));
});

test('cue-like text in prose does not warn', () => {
  const { lines } = run(base([{ id: 's', body: '<p>write data-cue="9" on an element</p>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
});

test('cue spellings the runtime resolves do not warn', () => {
  // +"1.0" === 1 (integer) — the runtime syncs it to turn 1, so no warning.
  const { lines } = run(base([{ id: 's', body: '<p data-cue="1.0">x</p>', vo: [{ who: 'a', text: 'a' }, { who: 'a', text: 'b' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
});

test('class="cue" without data-cue warns', () => {
  const { lines } = run(base([{ id: 's', body: '<p class="lede cue">x</p>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(lines.some(l => l.includes('without data-cue')), lines.join('\n'));
});

test('ids that collide with generated composition ids are safe (namespaced at compose)', () => {
  const { lines } = run(base([{ id: 's', body: '<div id="cap-stage">x</div><div id="scene-intro">y</div>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
});

test('cues inside HTML comments are ignored', () => {
  const { lines } = run(base([{ id: 's', body: '<!-- <p data-cue="9">x</p> --><p>y</p>', vo: [{ who: 'a', text: 'a' }] }]));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
});

test('remote scene and theme assets warn', () => {
  const { lines } = run(base(
    [{ id: 's', body: '<img src="https://example.com/hero.jpg">', vo: [{ who: 'a', text: 'a' }] }],
    '.brand{background:url(https://example.com/font.woff2)}',
  ));
  assert.ok(lines.some(l => l.includes('scene "s" src: remote asset')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('theme.css: remote asset')), lines.join('\n'));
});

test('named fallback fonts warn about extra HyperFrames downloads', () => {
  const { lines } = run(base(
    [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'a' }] }],
    ':root{--serif:"Brand Serif",Georgia,"Times New Roman",serif}',
  ));
  assert.ok(lines.some(l => l.includes('named fallback font')), lines.join('\n'));
});

test('missing, misplaced, and escaping project assets warn', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-assets-'));
  fs.writeFileSync(path.join(dir, 'ok.svg'), '<svg/>');
  const { lines } = run(base([{
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
  const { lines } = run({ ...base(scenes), projectDir: dir });
  assert.ok(lines.some(l => l.includes('no claims.md ledger')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('2,000+ products')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('leading platform')), lines.join('\n'));
  assert.ok(!lines.some(l => l.includes('plain sentence')), lines.join('\n'));
});

test('a claims.md ledger in the project dir silences the grounding warning', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-claims-'));
  fs.writeFileSync(path.join(dir, 'claims.md'), '# claims\n- "2,000+ products" — verbatim, https://example.com\n');
  const scenes = [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'Over 2,000+ products.' }] }];
  const { lines } = run({ ...base(scenes), projectDir: dir });
  assert.ok(!lines.some(l => l.includes('claims.md')), lines.join('\n'));
});

test('unknown scene transitions warn naming the valid set; fade/wipe/slide/zoom/absent do not', () => {
  const bad = run(base([{ id: 's', body: '<p>x</p>', transition: 'spiral', vo: [{ who: 'a', text: 'a' }] }])).lines;
  assert.ok(bad.some(l => l.includes('unknown transition "spiral"') && l.includes('fade, wipe, slide, zoom')), bad.join('\n'));
  for (const transition of ['fade', 'wipe', 'slide', 'zoom', undefined]) {
    const { lines } = run(base([{ id: 's', body: '<p>x</p>', transition, vo: [{ who: 'a', text: 'a' }] }]));
    assert.ok(!lines.some(l => l.includes('transition')), `transition ${transition} must not warn`);
  }
});

test('unknown data-mark kinds warn; known kinds do not', () => {
  const bad = run(base([{ id: 's', body: '<p data-mark="scribble">x</p>', vo: [{ who: 'a', text: 'a' }] }])).lines;
  assert.ok(bad.some(l => l.includes('data-mark="scribble"') && l.includes('underline, circle, box, highlight')), bad.join('\n'));
  for (const kind of ['underline', 'circle', 'box', 'highlight']) {
    const { lines } = run(base([{ id: 's', body: `<p data-mark="${kind}">x</p>`, vo: [{ who: 'a', text: 'a' }] }]));
    assert.ok(!lines.some(l => l.startsWith('warn:')), `data-mark=${kind} must not warn: ` + lines.join('\n'));
  }
});

/* A scene with ~N spoken words for the platform-band tests. */
const wordy = n => [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: Array(n).fill('word').join(' ') }] }];

test('platform band: narration outside the target range warns, inside does not', () => {
  // tiktok band 21–34s ≈ 60–100 words at default tempo.
  const long = run({ ...base(wordy(400)), platform: 'tiktok' }).lines;
  assert.ok(long.some(l => /platform tiktok targets 21–34s; estimated narration is \d+s — tighten the script or pick a longer format/.test(l)), long.join('\n'));
  const short = run({ ...base(wordy(8)), platform: 'tiktok' }).lines;
  assert.ok(short.some(l => /platform tiktok targets 21–34s.*add material or pick a shorter format/.test(l)), short.join('\n'));
  const ok = run({ ...base(wordy(80)), platform: 'tiktok' }).lines;
  assert.ok(!ok.some(l => l.includes('platform')), ok.join('\n'));
});

test('platform x has no lower bound — only warns above 140s', () => {
  const short = run({ ...base(wordy(5)), platform: 'x' }).lines;
  assert.ok(!short.some(l => l.includes('platform')), short.join('\n'));
  const long = run({ ...base(wordy(600)), platform: 'x' }).lines;
  assert.ok(long.some(l => /platform x allows up to 140s.*tighten the script/.test(l)), long.join('\n'));
});

test('no platform set: no platform lint', () => {
  const { lines } = run(base(wordy(600)));
  assert.ok(!lines.some(l => l.includes('platform')), lines.join('\n'));
});

// -- hook enforcement --

test('hook: lead-in silence >200ms warns', () => {
  const { lines } = run({ ...base(wordy(20)), timing: { lead: 0.38 } });
  assert.ok(lines.some(l => l.includes('timing.lead is 0.38s') && l.includes('200ms')), lines.join('\n'));
});

test('hook: lead-in silence ≤200ms is silent', () => {
  const { lines } = run({ ...base(wordy(20)), timing: { lead: 0.16 } });
  assert.ok(!lines.some(l => l.includes('lead-in')), lines.join('\n'));
});

test('hook: scene 1 with no visible text warns', () => {
  const { lines } = run(base([
    { id: 'hook', body: '<div class="bg"></div>', vo: [{ who: 'a', text: 'hello' }] },
  ]));
  assert.ok(lines.some(l => l.includes('scene 1 has no visible text') && l.includes('muted')), lines.join('\n'));
});

test('hook: scene 1 with text is silent', () => {
  const { lines } = run(base([
    { id: 'hook', body: '<div class="bg"></div><h1>Hook Text</h1>', vo: [{ who: 'a', text: 'hello' }] },
  ]));
  assert.ok(!lines.some(l => l.includes('no visible text')), lines.join('\n'));
});

test('saveable: last scene with no text or image warns', () => {
  const { lines } = run(base([
    { id: 'hook', body: '<h1>Start</h1>', vo: [{ who: 'a', text: 'hello' }] },
    { id: 'end', body: '<div class="empty"></div>', vo: [{ who: 'a', text: 'bye' }] },
  ]));
  assert.ok(lines.some(l => l.includes('saveable') && l.includes('end-card')), lines.join('\n'));
});

test('saveable: last scene with text is silent', () => {
  const { lines } = run(base([
    { id: 'hook', body: '<h1>Start</h1>', vo: [{ who: 'a', text: 'hello' }] },
    { id: 'end', body: '<h2>Subscribe</h2>', vo: [{ who: 'a', text: 'bye' }] },
  ]));
  assert.ok(!lines.some(l => l.includes('saveable') && l.includes('end-card')), lines.join('\n'));
});

test('saveable: last scene with an image is silent', () => {
  const { lines } = run(base([
    { id: 'hook', body: '<h1>Start</h1>', vo: [{ who: 'a', text: 'hello' }] },
    { id: 'end', body: '<img src="logo.svg">', vo: [{ who: 'a', text: 'bye' }] },
  ]));
  assert.ok(!lines.some(l => l.includes('saveable') && l.includes('end-card')), lines.join('\n'));
});

// -- HyperFrames reserved class names --

test('body elements using HyperFrames-reserved class names warn', () => {
  const { lines } = run(base([
    { id: 's', body: '<section class="scene hook"><div class="progress"></div></section>', vo: [{ who: 'a', text: 'a' }] },
  ]));
  assert.ok(lines.some(l => l.includes('reserved name "scene"')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('reserved name "progress"')), lines.join('\n'));
});

test('body elements without reserved class names are silent', () => {
  const { lines } = run(base([
    { id: 's', body: '<section class="story-scene hook-scene"><div class="bar"></div></section>', vo: [{ who: 'a', text: 'a' }] },
  ]));
  assert.ok(!lines.some(l => l.includes('reserved name')), lines.join('\n'));
});

// ---- render-path CSS compatibility ------------------------------------------

function cssConfig(themeCss, body) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-ck-'));
  const cssPath = path.join(tmp, 'theme.css');
  fs.writeFileSync(cssPath, themeCss || '');
  const raw = {
    title: 'test', size: '16:9',
    theme: { css: cssPath },
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Test.' }], body: body || '<div/>' }],
  };
  const { resolveConfig } = require('../src/schema');
  try { return resolveConfig(raw, {}, tmp); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

test('CSS lint warns on backdrop-filter', () => {
  const config = cssConfig('.card { backdrop-filter: blur(4px); }');
  const { lines } = run(config);
  assert.ok(lines.some(l => l.includes('backdrop-filter')), 'should warn on backdrop-filter');
});

test('CSS lint warns on filter: blur', () => {
  const config = cssConfig('.broll { filter: blur(2px); }');
  const { lines } = run(config);
  assert.ok(lines.some(l => l.includes('filter: blur')), 'should warn on filter blur');
});

test('CSS lint warns on filter: drop-shadow', () => {
  const config = cssConfig('path { filter: drop-shadow(0 0 10px #fff); }');
  const { lines } = run(config);
  assert.ok(lines.some(l => l.includes('drop-shadow')), 'should warn on drop-shadow');
});

test('CSS lint warns on mix-blend-mode', () => {
  const config = cssConfig('.overlay { mix-blend-mode: soft-light; }');
  const { lines } = run(config);
  assert.ok(lines.some(l => l.includes('mix-blend-mode')), 'should warn on mix-blend-mode');
});

test('CSS lint warns on filter: brightness/saturate/contrast', () => {
  const config = cssConfig('img { filter: brightness(.9) saturate(.8) contrast(1.1); }');
  const { lines } = run(config);
  assert.ok(lines.some(l => l.includes('brightness/saturate/contrast')));
});

test('CSS lint warns on scene body with slow-path CSS', () => {
  const config = cssConfig('', '<div style="backdrop-filter: blur(2px)">x</div>');
  const { lines } = run(config);
  assert.ok(lines.some(l => l.includes('scene "s1" body')), 'should warn on scene body');
});

test('CSS lint is silent on clean theme.css', () => {
  const config = cssConfig('.card { color: #fff; background: #111; }');
  const { lines } = run(config);
  assert.ok(!lines.some(l => l.includes('forces screenshot')), 'clean CSS should not warn');
});

// ---- wipe transition --------------------------------------------------------

function wordyConfig(n) {
  const raw = {
    title: 'test', size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [{ id: 's1', transition: 'wipe', vo: [{ who: 'a', text: 'A '.repeat(n) }], body: '<div/>' }],
  };
  const { resolveConfig } = require('../src/schema');
  return resolveConfig(raw, {}, '.');
}

test('wipe transition on long video warns', () => {
  const config = wordyConfig(400); // many words = longer duration
  const { lines } = run(config);
  assert.ok(lines.some(l => l.includes('wipe') && l.includes('fade')), 'should suggest fade');
});

test('wipe transition on short video is silent', () => {
  const config = wordyConfig(5);
  const { lines } = run(config);
  assert.ok(!lines.some(l => l.includes('wipe') && l.includes('fade')), 'short video wipe should be silent');
});

// ---- strict / release modes --------------------------------------------------

test('release: remote asset is an error not a warning', () => {
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '',
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<p>visible</p><img src="https://example.com/x.png">', vo: [{ who: 'a', text: 'hello' }] }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.equal(ok, false, 'release should fail on remote assets');
  assert.ok(lines.some(l => l.includes('remote asset')), lines.join('\n'));
  assert.ok(!lines.some(l => l.startsWith('warn:') && l.includes('remote asset')), 'remote asset should be error, not warning');
  assert.ok(lines.some(l => l.startsWith('fail:')), 'should have fail lines');
  assert.ok(lines.some(l => l.includes('FAIL (release):')), 'should show FAIL summary');
});

test('release: missing local asset is an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-release-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '',
    voices: { a: { backend: 'piper' } },
    assetsDir: path.join(dir, 'assets'),
    scenes: [{ id: 's', body: '<img src="assets/missing.svg"><p>x</p>', vo: [{ who: 'a', text: 'hello' }] }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.equal(ok, false);
  assert.ok(lines.some(l => l.includes('asset not found: assets/missing.svg')), lines.join('\n'));
});

test('release: pass when all assets are clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-release-clean-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'ok.svg'), '<svg/>');
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '',
    voices: { a: { backend: 'piper' } },
    assetsDir: path.join(dir, 'assets'),
    scenes: [{ id: 's', body: '<img src="assets/ok.svg"><p>x</p>', vo: [{ who: 'a', text: 'hello' }] }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.equal(ok, true, 'clean release should pass: ' + lines.join('\n'));
  assert.ok(lines.some(l => l.includes('release check passed')), lines.join('\n'));
});

test('release: script/link/iframe in body are errors', () => {
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '',
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<script src="app.js"></script><p>x</p>', vo: [{ who: 'a', text: 'hello' }] }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.equal(ok, false);
  assert.ok(lines.some(l => l.includes('<script>')), lines.join('\n'));
  assert.ok(lines.some(l => l.includes('remote dependencies')), lines.join('\n'));
});

test('release: svg-only scene is NOT a black frame', () => {
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '',
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<svg><circle cx="50" cy="50" r="40"/></svg>', vo: [{ who: 'a', text: 'hello' }] }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.equal(ok, true, 'svg scene should pass release: ' + lines.join('\n'));
  assert.ok(!lines.some(l => l.includes('black frame')), 'svg scene should not be flagged as black frame');
});

test('release: img-only scene is NOT a black frame', () => {
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '',
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<img src="assets/hero.png">', vo: [{ who: 'a', text: 'hello' }] }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.ok(!lines.some(l => l.includes('black frame')), 'img scene should not be flagged as black frame');
});

test('release: truly empty body IS a black frame', () => {
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '',
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<div></div>', vo: [{ who: 'a', text: 'hello' }] }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.equal(ok, false);
  assert.ok(lines.some(l => l.includes('black frame')), lines.join('\n'));
});

test('release: a zero-opacity walkthrough does not hide an empty black frame', () => {
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '',
    voices: { a: { backend: 'piper' } },
    scenes: [{
      id: 's',
      body: '',
      walkthrough: { id: 'demo', opacity: 0 },
      vo: [{ who: 'a', text: 'hello' }],
    }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.equal(ok, false);
  assert.ok(lines.some(l => l.includes('black frame')), lines.join('\n'));
});

test('release: platform duration bands stay as warnings not errors', () => {
  const longBody = Array(400).fill('word').join(' ');
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '', platform: 'tiktok',
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: longBody }] }],
  };
  const { ok, lines } = run(config, { release: true });
  // Should still pass — duration band is a warning, not a release error.
  const durWarn = lines.filter(l => l.includes('platform tiktok'));
  assert.ok(durWarn.every(l => l.startsWith('warn:')), 'duration bands must be warnings in release mode: ' + durWarn.join('\n'));
  assert.equal(ok, true, 'release should pass despite out-of-band duration');
});

test('release: slow-path CSS stays as warnings', () => {
  const config = { title: 'R', size: { w: 100, h: 100 },
    voices: { a: { backend: 'piper' } },
    themeCss: '.card { backdrop-filter: blur(4px); }',
    scenes: [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'hello' }] }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.ok(lines.some(l => l.includes('backdrop-filter') && l.startsWith('warn:')), 'slow CSS should stay as warning');
  assert.equal(ok, true, 'slow CSS should not fail release');
});

test('release: infinite animation still fails (determinism)', () => {
  const config = { title: 'R', size: { w: 100, h: 100 },
    voices: { a: { backend: 'piper' } },
    themeCss: '.spin { animation: spin 2s linear infinite; }',
    scenes: [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'hello' }] }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.equal(ok, false, 'infinite animation should fail release: ' + lines.join('\n'));
  assert.ok(lines.some(l => l.includes('infinite') && l.startsWith('fail:')), lines.join('\n'));
});

test('strict: unledgered claims warn when claims.md exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-strict-'));
  fs.writeFileSync(path.join(dir, 'claims.md'), '## claim: completely different statement\n');
  const config = {
    title: 'S', size: { w: 100, h: 100 }, themeCss: '', projectDir: dir,
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'Over 2,000+ products.' }] }],
  };
  const { lines } = run(config, { strict: true });
  assert.ok(lines.some(l => l.includes('not found in claims.md')), lines.join('\n'));
  assert.ok(lines.some(l => l.startsWith('warn:')), 'strict warnings still say warn:');
});

test('strict: ledgered claims are silent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-strict-ok-'));
  fs.writeFileSync(path.join(dir, 'claims.md'), '## claim: Over 2,000+ products.\n');
  const config = {
    title: 'S', size: { w: 100, h: 100 }, themeCss: '', projectDir: dir,
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'Over 2,000+ products.' }] }],
  };
  const { lines } = run(config, { strict: true });
  assert.ok(!lines.some(l => l.includes('not found in claims')), lines.join('\n'));
});

test('strict: claims table format is parsed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-table-'));
  fs.writeFileSync(path.join(dir, 'claims.md'), [
    '# Claims ledger',
    '',
    '## Claims',
    '',
    '| # | Claim (as spoken in vo) | Tag | Source |',
    '|---|---|---|---|',
    '| 1 | Over 2,000+ products. | verbatim | https://example.com |',
    '| 2 | Leading platform in the region. | paraphrase | https://example.com |',
  ].join('\n'));
  const config = {
    title: 'S', size: { w: 100, h: 100 }, themeCss: '', projectDir: dir,
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<p>x</p>', vo: [
      { who: 'a', text: 'Over 2,000+ products.' },
      { who: 'a', text: 'Leading platform in the region.' },
      { who: 'a', text: '99% of users prefer this.' },
    ] }],
  };
  const { lines } = run(config, { strict: true });
  // Third claim "99% of users prefer this." is not in the ledger table.
  assert.ok(lines.some(l => l.includes('not found in claims.md') && l.includes('1 of 3')), lines.join('\n'));
});

test('release: CLAIMS.md (uppercase) is also found', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-CLAIMS-'));
  fs.writeFileSync(path.join(dir, 'CLAIMS.md'), '## claim: Over 2,000+ products.\n');
  const config = {
    title: 'S', size: { w: 100, h: 100 }, themeCss: '', projectDir: dir,
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'Over 2,000+ products.' }] }],
  };
  const { lines } = run(config, { strict: true });
  assert.ok(!lines.some(l => l.includes('not found in claims')), lines.join('\n'));
});

test('release: default mode gives same output as before', () => {
  const config = { title: 'T', size: { w: 100, h: 100 }, themeCss: '',
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<p data-cue="0">x</p>', vo: [{ who: 'a', text: 'one' }] }],
  };
  const { ok, lines } = run(config);
  assert.equal(ok, true, 'default mode always returns true');
  assert.ok(!lines.some(l => l.startsWith('fail:')), 'default mode has no fail: lines');
  assert.ok(lines.some(l => l.startsWith('ok:') && l.includes('1 scenes')), lines.join('\n'));
});

test('release: empty voices config passes silently', () => {
  const config = { title: 'Silent', size: { w: 100, h: 100 }, themeCss: '',
    voices: {},
    scenes: [{ id: 's', vo: [], dur: 5, body: '<p>silent scene</p>' }],
  };
  const { ok, lines } = run(config, { release: true });
  assert.equal(ok, true, 'silent voice-less project should pass release: ' + lines.join('\n'));
  assert.ok(lines.some(l => l.includes('silent')), 'backends should show silent');
});

// ---- choreography lints -----------------------------------------------------

const choreoConfig = (choreography, extra = {}) => ({
  ...base([{ id: 's', body: '<p data-cue="0">x</p>', vo: [{ who: 'a', text: 'one' }] }]),
  choreography,
  ...extra,
});

test('a clean choreography file produces no warnings', () => {
  const { lines } = run(choreoConfig('var T = function (k) { return sc.start + sc.turns[k]; };'));
  assert.ok(!lines.some(l => l.startsWith('warn:')), lines.join('\n'));
});

test('determinism-breaking references in choreography warn', () => {
  const src = [
    'var t = Date.now();',
    'var j = Math.random();',
    'requestAnimationFrame(step);',
    'setTimeout(step, 16);',
    'fetch("/x");',
  ].join('\n');
  const warns = run(choreoConfig(src)).lines.filter(l => l.startsWith('warn: choreography:'));
  assert.equal(warns.length, 5, warns.join('\n'));
  for (const token of ['Date', 'Math.random()', 'requestAnimationFrame()', 'setTimeout()', 'fetch()']) {
    assert.ok(warns.some(l => l.includes(token)), `expected a warning naming ${token}`);
  }
});

test('determinism sniffs are not stateful across repeated checks', () => {
  const cfg = choreoConfig('var t = Date.now();');
  const first = run(cfg).lines.filter(l => l.startsWith('warn: choreography:'));
  const second = run(cfg).lines.filter(l => l.startsWith('warn: choreography:'));
  assert.deepEqual(second, first, 'the same config must lint identically every time');
});

test('a choreography file over 32KB warns', () => {
  const big = `tl.set(".x", { opacity: 1 }, 0);\n`.repeat(1200);
  assert.ok(Buffer.byteLength(big, 'utf8') > 32 * 1024);
  const warns = run(choreoConfig(big)).lines.filter(l => l.startsWith('warn: choreography:'));
  assert.equal(warns.length, 1, warns.join('\n'));
  assert.match(warns[0], /exceeds the 32KB guideline/);
});

test('a choreography file at or under 32KB does not warn on size', () => {
  const small = `tl.set(".x", { opacity: 1 }, 0);\n`.repeat(100);
  assert.ok(Buffer.byteLength(small, 'utf8') < 32 * 1024);
  assert.ok(!run(choreoConfig(small)).lines.some(l => l.includes('guideline')));
});

test('a declared choreography file that cannot be read fails release', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-choreo-'));
  const missing = path.join(dir, 'gone.js');
  const { ok, lines } = run(choreoConfig('', { choreographyPath: missing }), { release: true });
  assert.equal(ok, false, lines.join('\n'));
  assert.ok(lines.some(l => l.startsWith('fail:') && l.includes('config.choreography: file not found')),
    lines.join('\n'));
});

test('a choreography file that exists on disk does not fail release', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-check-choreo-ok-'));
  const p = path.join(dir, 'choreo.js');
  fs.writeFileSync(p, 'tl.set(".x", { opacity: 1 }, 0);\n');
  const cfg = choreoConfig(fs.readFileSync(p, 'utf8'), { choreographyPath: p, assetsDir: null });
  const { lines } = run(cfg, { release: true });
  assert.ok(!lines.some(l => l.includes('config.choreography')), lines.join('\n'));
});

test('determinism scan covers per-scene choreographyFile contents', () => {
  const cfg = base([{
    id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'one' }],
    _choreographyFileContents: 'var t = Date.now();',
  }]);
  const warns = run(cfg).lines.filter(l => l.startsWith('warn:') && l.includes('Date'));
  assert.equal(warns.length, 1, warns.join('\n'));
  assert.match(warns[0], /scene "s" choreographyFile/);
});

test('determinism scan covers per-scene scriptFile contents', () => {
  const cfg = base([{
    id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'one' }],
    _scriptFileContents: 'fetch("/leak");',
  }]);
  const warns = run(cfg).lines.filter(l => l.startsWith('warn:') && l.includes('fetch'));
  assert.equal(warns.length, 1, warns.join('\n'));
  assert.match(warns[0], /scene "s" scriptFile/);
});

test('determinism scan covers the raw Three.js escape hatch (threeModule)', () => {
  const cfg = base([{
    id: 's', vo: [{ who: 'a', text: 'one' }], dur: 6,
    _threeModuleContents: 'var r = Math.random(); var t = Date.now();',
  }]);
  const warns = run(cfg).lines.filter(l => l.startsWith('warn:') && /threeModule/.test(l));
  assert.equal(warns.length, 2, warns.join('\n'));
  assert.ok(warns.some(l => l.includes('Math.random()') && l.includes('threeModule')));
  assert.ok(warns.some(l => l.includes('Date') && l.includes('threeModule')));
});

test('infinite CSS animation is tagged as a correctness issue, not quality', () => {
  const cfg = base(
    [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: 'one' }] }],
    '.spin { animation: spin 2s linear infinite; }',
  );
  const lines = run(cfg).lines;
  assert.ok(lines.some(l => l.startsWith('warn: correctness:') && l.includes('infinite')),
    lines.join('\n'));
});
