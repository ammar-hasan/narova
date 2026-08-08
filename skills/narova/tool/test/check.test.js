'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check, critique, internalShotCount, needsCreativeBrief } = require('../src/check');
const { resolveConfig } = require('../src/schema');
const { timingsFingerprint } = require('../src/audio-fingerprint');
const { hashFile, buildHashes } = require('../src/manifest');
const { writeProofReceipt, verifyProofReceipt, writeProofBundle } = require('../src/proof-receipt');
const { projectIdentity } = require('../src/releases');

/* check() prints via console.log; capture it. */
function run(config, opts = {}) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let ok;
  try { ok = check(config, opts); } finally { console.log = orig; }
  return { ok, lines };
}

/* critique() also prints via console.log. */
function runCritique(config, opts = {}) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let results;
  try { results = critique(config, opts); } finally { console.log = orig; }
  return { results, lines };
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

test('check: platform band is not in default check output', () => {
  const { lines } = run({ ...base(wordy(400)), platform: 'tiktok' });
  assert.ok(!lines.some(l => l.includes('platform tiktok targets') || l.includes('platform x allows')), lines.join('\n'));
});

test('critique: platform band in social-short profile', () => {
  const long = runCritique({ ...base(wordy(400)), platform: 'tiktok' }, { profile: 'social-short' });
  assert.ok(long.results.some(r => /platform tiktok targets 21–34s; estimated narration is \d+s — tighten the script/.test(r)), long.results.join('\n'));
  const short = runCritique({ ...base(wordy(8)), platform: 'tiktok' }, { profile: 'social-short' });
  assert.ok(short.results.some(r => /platform tiktok targets 21–34s.*add material/.test(r)), short.results.join('\n'));
  const ok = runCritique({ ...base(wordy(80)), platform: 'tiktok' }, { profile: 'social-short' });
  assert.ok(!ok.results.some(r => r.includes('platform')), ok.results.join('\n'));
});

test('critique: platform x has no lower bound in social-short profile', () => {
  const short = runCritique({ ...base(wordy(5)), platform: 'x' }, { profile: 'social-short' }).results;
  assert.ok(!short.some(r => r.includes('platform')), short.join('\n'));
  const long = runCritique({ ...base(wordy(600)), platform: 'x' }, { profile: 'social-short' });
  assert.ok(long.results.some(r => /platform x allows up to 140s.*tighten the script/.test(r)), long.results.join('\n'));
});

// -- craft checks moved to critique (not check) --

test('check: hook/saveable checks are not in default check output', () => {
  const cfg = { ...base(wordy(20)), timing: { lead: 0.38 } };
  const { lines } = run(cfg);
  assert.ok(!lines.some(l => l.includes('timing.lead is 0.38s') || l.includes('lead-in')), lines.join('\n'));
  assert.ok(!lines.some(l => l.includes('visible text') || l.includes('muted')), lines.join('\n'));
  assert.ok(!lines.some(l => l.includes('saveable') || l.includes('end-card')), lines.join('\n'));
});

// -- critique: social-short profile --

test('critique: lead-in silence >200ms advises on social-short', () => {
  const cfg = { ...base(wordy(20)), timing: { lead: 0.38 } };
  const { results } = runCritique(cfg, { profile: 'social-short' });
  assert.ok(results.some(r => r.includes('timing.lead is 0.38s') && r.includes('200ms')), results.join('\n'));
  assert.equal(results.length, 1); // social-short: only the lead warning (hook scene has text)
});

test('critique: scene 1 with no visible text advises on social-short', () => {
  const cfg = base([
    { id: 'hook', body: '<div class="bg"></div>', vo: [{ who: 'a', text: 'hello' }] },
  ]);
  const { results } = runCritique(cfg, { profile: 'social-short' });
  assert.ok(results.some(r => r.includes('no visible text') && r.includes('muted')), results.join('\n'));
  assert.ok(results.some(r => r.includes('end-card')), results.join('\n')); // also no saveable
});

test('critique: silent/disabled-captions projects skip social-short advice', () => {
  // Silent project (no voices)
  const cfgSilent = base([{ id: 's', body: '<div></div>', vo: [] }]);
  cfgSilent.voices = {};
  const { results: r1 } = runCritique(cfgSilent, { profile: 'social-short' });
  assert.ok(!r1.some(l => l.includes('visible text') || l.includes('muted')), r1.join('\n'));

  // captions disabled
  const cfgNoCaps = { ...base(wordy(20)), captionsEnabled: false };
  const cfgNoCapsResolved = { ...cfgNoCaps, captions: { preset: 'karaoke', emphasis: [], maxWords: null } };
  const { results: r2 } = runCritique(cfgNoCapsResolved, { profile: 'social-short' });
  assert.ok(!r2.some(l => l.includes('visible text') || l.includes('muted')), r2.join('\n'));
});

test('critique: saveable last scene with no text advises on social-short', () => {
  const cfg = base([
    { id: 'hook', body: '<h1>Start</h1>', vo: [{ who: 'a', text: 'hello' }] },
    { id: 'end', body: '<div class="empty"></div>', vo: [{ who: 'a', text: 'bye' }] },
  ]);
  const { results } = runCritique(cfg, { profile: 'social-short' });
  assert.ok(results.some(r => r.includes('social-short') && r.includes('end-card')), results.join('\n'));
});

test('critique: all profile includes social-short, presentation advice', () => {
  const cfg = base([
    { id: 's1', body: '<div class="bg"></div>', vo: [{ who: 'a', text: 'hello' }] },
  ]);
  const { results } = runCritique(cfg, { profile: 'all' });
  assert.ok(results.some(r => r.includes('social-short') || r.includes('no visible text')), results.join('\n'));
});

test('critique: presentation profile checks 3D quality', () => {
  const cfg = base([
    { id: 's', body: '<h1>3D</h1>', vo: [{ who: 'a', text: 'one' }],
      three: { camera: { position: [0, 0, 5] }, lights: [{ type: 'directional', shadow: true }],
        objects: [{ type: 'cube', roughness: 0.4 }] } },
  ]);
  const { results } = runCritique(cfg, { profile: 'presentation' });
  assert.ok(results.some(r => r.includes('receiveShadow')), results.join('\n'));
  assert.ok(results.some(r => r.includes('envMap')), results.join('\n'));
});

test('critique: no results when config passes all heuristics', () => {
  const cfg = base([
    { id: 'hook', body: '<h1>Text</h1>', vo: [{ who: 'a', text: 'hello' }] },
    { id: 'end', body: '<h2>Subscribe</h2>', vo: [{ who: 'a', text: 'bye' }] },
  ]);
  const { results } = runCritique(cfg, { profile: 'social-short' });
  assert.equal(results.length, 0, results.join('\n'));
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
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-release-brief-'));
  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'), 'Status: approved\n');
  const longBody = Array(400).fill('word').join(' ');
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '', platform: 'tiktok',
    projectDir,
    voices: { a: { backend: 'piper' } },
    scenes: [{ id: 's', body: '<p>x</p>', vo: [{ who: 'a', text: longBody }] }],
  };
  const { ok, lines } = run(config, { release: true });
  // Should still pass — duration band is a warning, not a release error.
  const durWarn = lines.filter(l => l.includes('platform tiktok'));
  assert.ok(durWarn.every(l => l.startsWith('warn:')), 'duration bands must be warnings in release mode: ' + durWarn.join('\n'));
  assert.equal(ok, true, 'release should pass despite out-of-band duration');
});

test('release: non-trivial projects require an approved creative pilot', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-release-pilot-'));
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '', projectDir,
    voices: {},
    scenes: [{ id: 's', body: '<p>x</p>', dur: 31, vo: [] }],
  };
  const missing = run(config, { release: true });
  assert.equal(missing.ok, false);
  assert.ok(missing.lines.some(l => l.includes('needs creative-brief.md')), missing.lines.join('\n'));

  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'), 'Status: draft\n');
  const draft = run(config, { release: true });
  assert.equal(draft.ok, false);
  assert.ok(draft.lines.some(l => l.includes('is not approved')), draft.lines.join('\n'));

  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'), 'Status: approved\n');
  assert.equal(run(config, { release: true }).ok, true);
});

test('release: ambitious briefs require a selected proof and concrete rejection criteria', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-release-ambitious-'));
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-branch-'));
  const metadataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-metadata-'));
  const proofOut = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-out-'));
  const releaseDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-a-branch-'));
  const metadataDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-a-metadata-'));
  const proofOutA = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-a-out-'));
  let proofARelease = releaseDirA;
  let proofAMetadata = metadataDirA;
  let branch = null;
  let branchA = null;
  const branchStore = {
    readBranch: name => name === 'proof-a' ? branchA : (name === 'proof-b' ? branch : null),
    branchDir: name => name === 'proof-a' ? proofAMetadata : metadataDir,
    releasePath: name => name === 'proof-a' ? proofARelease : releaseDir,
  };
  const config = { title: 'R', size: { w: 100, h: 100 }, themeCss: '', projectDir,
    voices: {}, scenes: [{ id: 's', body: '<p>x</p>', dur: 12, vo: [] }],
  };
  const manifest = JSON.stringify({ snapshot: 'proof-b', hashes: buildHashes(config, projectDir) }) + '\n';
  const timings = '{"total":12}\n';
  fs.writeFileSync(path.join(proofOut, 'manifest.json'), manifest);
  fs.writeFileSync(path.join(proofOut, 'timings.json'), timings);
  const { assetsDir: _assetsDir, ...serializableConfig } = config;
  fs.writeFileSync(path.join(proofOut, 'config.resolved.json'), JSON.stringify(serializableConfig, null, 2));
  fs.writeFileSync(path.join(proofOut, 'contact-sheet.jpg'), 'rendered proof');
  fs.writeFileSync(path.join(proofOut, 'frame.jpg'), 'audited frame');
  fs.writeFileSync(path.join(releaseDir, 'manifest.json'), manifest);
  fs.writeFileSync(path.join(releaseDir, 'timings.json'), timings);
  fs.writeFileSync(path.join(releaseDir, 'reel.config.json'), '{"title":"R"}\n');
  writeProofReceipt(config, proofOut, [path.join(proofOut, 'contact-sheet.jpg')], [path.join(proofOut, 'frame.jpg')]);
  const bundle = writeProofBundle(proofOut, verifyProofReceipt(config, proofOut), metadataDir, releaseDir);
  const snapshotManifest = path.join(releaseDir, 'manifest.json');
  const snapshotManifestSha256 = hashFile(snapshotManifest);
  const manifestA = JSON.stringify({ snapshot: 'proof-a', hashes: buildHashes(config, projectDir) }) + '\n';
  fs.writeFileSync(path.join(proofOutA, 'manifest.json'), manifestA);
  fs.writeFileSync(path.join(proofOutA, 'timings.json'), timings);
  fs.writeFileSync(path.join(proofOutA, 'config.resolved.json'), JSON.stringify(serializableConfig, null, 2));
  fs.writeFileSync(path.join(proofOutA, 'contact-sheet.jpg'), 'rendered proof a');
  fs.writeFileSync(path.join(proofOutA, 'frame.jpg'), 'audited frame a');
  fs.writeFileSync(path.join(releaseDirA, 'manifest.json'), manifestA);
  fs.writeFileSync(path.join(releaseDirA, 'timings.json'), timings);
  fs.writeFileSync(path.join(releaseDirA, 'reel.config.json'), '{"title":"R","direction":"a"}\n');
  writeProofReceipt(config, proofOutA, [path.join(proofOutA, 'contact-sheet.jpg')], [path.join(proofOutA, 'frame.jpg')]);
  const bundleA = writeProofBundle(proofOutA, verifyProofReceipt(config, proofOutA), metadataDirA, releaseDirA);
  const brief = (selected = '', criteria = 'Reject a proof whose decisive transformation is not visible.', rows = ['proof-a', 'proof-b'], lineageIdentity = null, lineageBranch = selected) => {
    const selectedBranch = selected === 'proof-a' ? branchA : (selected === 'proof-b' ? branch : null);
    const identity = lineageIdentity == null ? (selectedBranch && selectedBranch.proofIdentity || '') : lineageIdentity;
    return `Status: approved\nAmbition: ambitious\n\n## Proof branches\n\n| Branch | Rationale | Smallest decisive proof | Status |\n|---|---|---|---|\n${rows.map(name => `| ${name} | distinct direction | decisive state | candidate |`).join('\n')}\n\nSelected proof branch: ${selected}\nExpanded from proof branch: ${lineageBranch}\nExpanded proof identity: ${identity}\n\n## Rejection criteria\n${criteria}\n`;
  };
  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'),
    brief('', 'Template-like result must be rebuilt.'));
  const noSelection = run(config, { release: true, branchStore });
  assert.equal(noSelection.ok, false);
  assert.ok(noSelection.lines.some(l => l.includes('2–3 existing')), noSelection.lines.join('\n'));

  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'),
    brief('does-not-exist'));
  const nonexistent = run(config, { release: true, branchStore });
  assert.equal(nonexistent.ok, false);
  assert.ok(nonexistent.lines.some(l => l.includes('2–3 existing')), nonexistent.lines.join('\n'));

  branch = {
    status: 'candidate',
    rationale: 'A distinct procedural direction.',
    projectIdentity: projectIdentity(projectDir),
    ...bundle,
    snapshotManifestSha256,
  };
  branchA = {
    status: 'candidate',
    rationale: 'A contrasting typographic direction.',
    projectIdentity: projectIdentity(projectDir),
    ...bundleA,
    snapshotManifestSha256: hashFile(path.join(releaseDirA, 'manifest.json')),
  };
  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'),
    brief('proof-b'));
  assert.equal(run(config, { release: true, branchStore }).ok, false, 'candidate proof must not release');

  branch = { ...branch, status: 'approved' };
  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'), brief('proof-b', undefined, ['proof-b']));
  assert.equal(run(config, { release: true, branchStore }).ok, false,
    'one approved branch must not bypass the 2–3 proof divergence workflow');
  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'),
    brief('proof-b', '<!-- Long scaffold instructions are not authored criteria. -->'));
  const weakCriteria = run(config, { release: true, branchStore });
  assert.equal(weakCriteria.ok, false);
  assert.ok(weakCriteria.lines.some(l => l.includes('rejection criteria')), weakCriteria.lines.join('\n'));

  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'),
    brief('proof-b', 'Reject if the procedural transformation reads as a familiar title card.', undefined, ''));
  const missingLineage = run(config, { release: true, branchStore });
  assert.equal(missingLineage.ok, false);
  assert.ok(missingLineage.lines.some(l => l.includes('exact proof identity')), missingLineage.lines.join('\n'));

  fs.writeFileSync(path.join(projectDir, 'creative-brief.md'),
    brief('proof-b', 'Reject if the procedural transformation reads as a familiar title card.'));
  assert.equal(run(config, { release: true, branchStore }).ok, true);

  const originalBranchA = branchA;
  const duplicateRelease = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-duplicate-branch-'));
  const duplicateMetadata = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-proof-duplicate-metadata-'));
  fs.cpSync(releaseDir, duplicateRelease, { recursive: true });
  fs.cpSync(metadataDir, duplicateMetadata, { recursive: true });
  proofARelease = duplicateRelease;
  proofAMetadata = duplicateMetadata;
  branchA = branch;
  assert.equal(run(config, { release: true, branchStore }).ok, false,
    'the same reviewed proof saved under two names must not satisfy divergence');
  branchA = originalBranchA;
  proofARelease = releaseDirA;
  proofAMetadata = metadataDirA;
  assert.equal(run(config, { release: true, branchStore }).ok, true);

  const otherProject = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-other-project-'));
  branch = { ...branch, projectIdentity: projectIdentity(otherProject) };
  assert.equal(run(config, { release: true, branchStore }).ok, false,
    'an intact approved proof from another project must not release this project');
  fs.rmSync(otherProject, { recursive: true, force: true });
  branch = { ...branch, projectIdentity: projectIdentity(projectDir) };
  assert.equal(run(config, { release: true, branchStore }).ok, true);

  const bundledFrame = path.join(metadataDir, 'proof', 'frames', 'frame-01.jpg');
  fs.writeFileSync(bundledFrame, 'tampered frame');
  assert.equal(run(config, { release: true, branchStore }).ok, false, 'audited frame tampering must invalidate proof');
  fs.writeFileSync(bundledFrame, 'audited frame');
  assert.equal(run(config, { release: true, branchStore }).ok, true);

  const bundledResolvedConfig = path.join(metadataDir, 'proof', 'config.resolved.json');
  const resolvedConfigBytes = fs.readFileSync(bundledResolvedConfig, 'utf8');
  const resolvedConfigData = JSON.parse(resolvedConfigBytes);
  fs.writeFileSync(bundledResolvedConfig, JSON.stringify({ ...resolvedConfigData, projectDir: '/tampered/path' }));
  assert.equal(run(config, { release: true, branchStore }).ok, false,
    'portable semantic equality must not hide byte-level resolved-config tampering');
  fs.writeFileSync(bundledResolvedConfig, resolvedConfigBytes);
  assert.equal(run(config, { release: true, branchStore }).ok, true);

  fs.writeFileSync(path.join(releaseDir, 'reel.config.json'), '{"title":"tampered"}\n');
  assert.equal(run(config, { release: true, branchStore }).ok, false, 'editable snapshot tampering must invalidate proof');
  fs.writeFileSync(path.join(releaseDir, 'reel.config.json'), '{"title":"R"}\n');
  assert.equal(run(config, { release: true, branchStore }).ok, true);

  fs.writeFileSync(path.join(releaseDir, 'timings.json'), '{"total":99}\n');
  assert.equal(run(config, { release: true, branchStore }).ok, false, 'saved timing tampering must invalidate proof');
  fs.writeFileSync(path.join(releaseDir, 'timings.json'), timings);
  assert.equal(run(config, { release: true, branchStore }).ok, true);

  fs.writeFileSync(path.join(releaseDir, 'injected-after-proof.json'), '{}');
  assert.equal(run(config, { release: true, branchStore }).ok, false,
    'an added restorable file outside the recorded snapshot set must invalidate proof');
  fs.unlinkSync(path.join(releaseDir, 'injected-after-proof.json'));
  assert.equal(run(config, { release: true, branchStore }).ok, true);

  const unrecordedProofArtifact = path.join(metadataDir, 'proof', 'unrecorded.txt');
  fs.writeFileSync(unrecordedProofArtifact, 'not part of the reviewed proof');
  assert.equal(run(config, { release: true, branchStore }).ok, false,
    'an added file outside the durable proof inventory must invalidate proof');
  fs.unlinkSync(unrecordedProofArtifact);
  assert.equal(run(config, { release: true, branchStore }).ok, true);

  fs.rmSync(snapshotManifest);
  const orphaned = run(config, { release: true, branchStore });
  assert.equal(orphaned.ok, false, 'proof metadata without its restorable snapshot must not release');
  assert.ok(orphaned.lines.some(l => l.includes('2–3 existing')), orphaned.lines.join('\n'));
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.rmSync(releaseDir, { recursive: true, force: true });
  fs.rmSync(metadataDir, { recursive: true, force: true });
  fs.rmSync(proofOut, { recursive: true, force: true });
});

test('creative gate ignores narrated fallback durations but counts silent runtime', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-duration-provenance-'));
  const raw = { title: 'Quick', voices: { a: { speaker: 'en_US-ryan-high' } },
    scenes: [{ id: 'quick', body: '<p>x</p>',
      vo: Array.from({ length: 6 }, () => ({ who: 'a', text: 'Hi' })) }],
  };
  const shortNarration = resolveConfig(raw, {}, projectDir);
  assert.equal(shortNarration.scenes[0].dur, 30, 'schema fixture exercises the synthetic fallback');
  assert.equal(needsCreativeBrief(shortNarration), false,
    'resolved vo.length*5 planning duration is not real runtime');
  const nullDuration = resolveConfig({
    ...raw, scenes: [{ ...raw.scenes[0], dur: null }],
  }, {}, projectDir);
  assert.equal(needsCreativeBrief(nullDuration), false,
    'dur:null is absence, not authored production intent');
  const authoredLong = resolveConfig({
    ...raw, scenes: [{ ...raw.scenes[0], dur: 40 }],
  }, {}, projectDir);
  assert.equal(needsCreativeBrief(authoredLong), true, 'explicit narrated duration remains production intent');

  const outDir = path.join(projectDir, 'out');
  fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, '.timings-fingerprint'), timingsFingerprint(shortNarration));
  fs.writeFileSync(path.join(outDir, 'timings.json'), JSON.stringify({ quick: { dur: 31 } }));
  assert.equal(needsCreativeBrief(shortNarration, { outDir }), true, 'current measured narration wins over estimate');

  assert.equal(needsCreativeBrief({ ...base([{ id: 'silent', body: '<p>x</p>', dur: 30, vo: [] }]), voices: {} }), true,
    'silent duration is explicitly authored runtime');

  const silentNow = resolveConfig({ title: 'Silent', voices: {},
    scenes: [{ id: 'silent', body: '<p>x</p>', dur: 10, vo: [] }] }, {}, projectDir);
  fs.writeFileSync(path.join(outDir, '.timings-fingerprint'), timingsFingerprint(silentNow));
  fs.writeFileSync(path.join(outDir, 'timings.json'), JSON.stringify({ silent: { dur: 40 } }));
  assert.equal(needsCreativeBrief(silentNow, { outDir }), false,
    'silent runtime comes from the current config, not fingerprint-blind stale timings');
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

test('raw Three modules reject unanchored composition-global timeline positions in release mode', () => {
  const cfg = base([{ id: 's', vo: [{ who: 'a', text: 'one' }], dur: 6,
    _threeModuleContents: 'tl.to(camera.position,{x:2,duration:1},0);' }]);
  const { ok, lines } = run(cfg, { release: true });
  assert.equal(ok, false);
  assert.ok(lines.some(l => l.includes('composition-global tl without at()')), lines.join('\n'));
  const safe = base([{ id: 's', vo: [{ who: 'a', text: 'one' }], dur: 6,
    _threeModuleContents: 'sceneTl.to(camera.position,{x:2,duration:1},0);' }]);
  assert.ok(!run(safe).lines.some(l => l.includes('composition-global tl without at()')));
});

test('check reports WebGL-heavy full previews while isolated build remains supported', () => {
  const scenes = Array.from({ length: 13 }, (_, i) => ({ id: `s${i}`, vo: [], dur: 1,
    _threeModuleContents: 'scene.add(new THREE.Group());' }));
  const lines = run({ ...base(scenes), voices: {} }).lines;
  assert.ok(lines.some(l => l.includes('safe eager-preview context budget')), lines.join('\n'));
});

test('critique: cinematic profile detects long tableaux and sparse raw action', () => {
  const longText = Array(35).fill('deliberate').join(' ');
  const scenes = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, dur: 12,
    vo: [{ who: 'a', text: longText }],
    _threeModuleContents: 'scene.add(new THREE.Group());' }));
  const { results } = runCritique(base(scenes), { profile: 'cinematic' });
  assert.ok(results.some(r => r.includes('average') && r.includes('tableaux')), results.join('\n'));
  assert.ok(results.some(r => r.includes('fewer than three timeline actions')), results.join('\n'));
});

test('critique: cinematic profile recognizes internal camera cuts in one raw scene', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cinematic-brief-'));
  fs.writeFileSync(path.join(dir, 'creative-brief.md'), '# Creative brief\n\nStatus: approved\n');
  const cuts = Array.from({ length: 10 }, (_, i) => `shot(${i});`).join('');
  const scene = { id: 'film', dur: 60,
    vo: [{ who: 'a', text: 'A continuous film can contain many deliberately directed internal shots.' }],
    _threeModuleContents: `function shot(i){sceneTl.set(camera.position,{x:i},i);} ${cuts}` };
  const { results } = runCritique({ ...base([scene]), projectDir: dir }, { profile: 'cinematic' });
  assert.ok(!results.some(r => r.includes('long tableaux') || r.includes('creative-brief')), results.join('\n'));
});

test('cinematic shot count recognizes direct timeline and callback camera cuts', () => {
  const direct = Array.from({ length: 9 }, (_, i) =>
    `sceneTl.to(camera.position,{x:${i},duration:0},${i});`).join('');
  const callbacks = Array.from({ length: 8 }, (_, i) =>
    `sceneTl.call(() => camera.position.set(${i},0,5),[],${i});`).join('');
  const namedCallbacks = `function setCamera(x){camera.position.set(x,0,5);}`
    + Array.from({ length: 7 }, (_, i) => `sceneTl.call(setCamera,[${i}],${i});`).join('');
  const namedExpression = 'const setCamera = function(x){camera.position.set(x,0,5);}; sceneTl.call(setCamera,[1],0);';
  const unrelatedAfterCallback = 'sceneTl.call(() => noop(),[],0); camera.position.set(1,0,5);';
  const nestedUnused = 'function callback(){ function helper(){ camera.position.set(1,0,5); } } sceneTl.call(callback,[],0);';
  const nestedArrowUnused = 'const callback=()=>{ const helper=()=>camera.position.set(1,0,5); }; sceneTl.call(callback,[],0);';
  const nestedExpressionUnused = 'const callback=function(){ const helper=function(){camera.position.set(1,0,5);} }; sceneTl.call(callback,[],0);';
  const directNamedTwice = 'function callback(){ sceneTl.to(camera.position,{x:1},0); } sceneTl.call(callback); sceneTl.call(callback);';
  const asyncNamed = 'const callback = async () => camera.position.set(1,0,5); sceneTl.call(callback);';
  const helperNamedCallback = 'function cameraCut(){ sceneTl.to(camera.position,{x:1},0); } sceneTl.call(cameraCut);';
  const helperNamedArrow = 'const shot = () => camera.position.set(1,0,5); sceneTl.call(shot);';
  const helperNamedExpression = 'const cameraMove = function(){ sceneTl.set(camera.position,{x:1},0); }; timeline.call(cameraMove);';
  const mixed = `function shot(i){sceneTl.set(camera.position,{x:i},i);}`
    + Array.from({ length: 6 }, (_, i) => `shot(${i});`).join('')
    + Array.from({ length: 6 }, (_, i) => `sceneTl.to(camera.position,{x:${i},duration:0},${i + 6});`).join('');
  const arrowHelper = 'const shot = (i) => { sceneTl.set(camera.position,{x:i},i); }; shot(0);';
  const expressionHelper = 'const cameraCut = function(i) { sceneTl.set(camera.position,{x:i},i); }; cameraCut(0);';
  const nestedHelper = 'function cameraMove(i){ if(i){noop();} sceneTl.set(camera.position,{x:i},i); } cameraMove(0);';
  assert.equal(internalShotCount(direct), 9);
  assert.equal(internalShotCount(callbacks), 8);
  assert.equal(internalShotCount(namedCallbacks), 7);
  assert.equal(internalShotCount(namedExpression), 1);
  assert.equal(internalShotCount(unrelatedAfterCallback), 0);
  assert.equal(internalShotCount(nestedUnused), 0);
  assert.equal(internalShotCount(nestedArrowUnused), 0);
  assert.equal(internalShotCount(nestedExpressionUnused), 0);
  assert.equal(internalShotCount(directNamedTwice), 2);
  assert.equal(internalShotCount(asyncNamed), 1);
  assert.equal(internalShotCount(helperNamedCallback), 1);
  assert.equal(internalShotCount(helperNamedArrow), 1);
  assert.equal(internalShotCount(helperNamedExpression), 1);
  assert.equal(internalShotCount(mixed), 12);
  assert.equal(internalShotCount(arrowHelper), 1);
  assert.equal(internalShotCount(expressionHelper), 1);
  assert.equal(internalShotCount(nestedHelper), 1);

  const longWords = Array(120).fill('world').join(' ');
  for (const code of [direct, callbacks, namedCallbacks, mixed]) {
    const scene = { id: 'film', vo: [{ who: 'a', text: longWords }], _threeModuleContents: code };
    const { results } = runCritique(base([scene]), { profile: 'cinematic' });
    assert.ok(!results.some(r => r.includes('long tableaux')), results.join('\n'));
  }
});

test('critique: ambitious 3D requires an approved creative brief', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cinematic-draft-'));
  const scene = { id: 'film', dur: 40,
    vo: [{ who: 'a', text: Array(110).fill('A long film needs a visual contract before production.').join(' ') }],
    _threeModuleContents: 'sceneTl.to(camera.position,{x:2,duration:40},0);' };
  const missing = runCritique({ ...base([scene]), projectDir: dir }, { profile: 'cinematic' }).results;
  assert.ok(missing.some(r => r.includes('no creative-brief.md')), missing.join('\n'));
  fs.writeFileSync(path.join(dir, 'creative-brief.md'), '# Creative brief\n\nStatus: draft\n');
  const draft = runCritique({ ...base([scene]), projectDir: dir }, { profile: 'cinematic' }).results;
  assert.ok(draft.some(r => r.includes('still draft')), draft.join('\n'));
});

test('critique: creative profile applies the pilot gate beyond 3D', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-creative-brief-'));
  const scenes = [{ id: 'essay', dur: 35, body: '<div>Designed film</div>',
    vo: [{ who: 'a', text: Array(110).fill('A substantial designed film proves its visual direction before scaling.').join(' ') }] }];
  const missing = runCritique({ ...base(scenes), projectDir: dir }, { profile: 'creative' }).results;
  assert.ok(missing.some(r => r.startsWith('creative:') && r.includes('no creative-brief.md')), missing.join('\n'));
  fs.writeFileSync(path.join(dir, 'creative-brief.md'), 'Status: approved\n');
  const approved = runCritique({ ...base(scenes), projectDir: dir }, { profile: 'creative' }).results;
  assert.ok(!approved.some(r => r.includes('creative-brief')), approved.join('\n'));
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
