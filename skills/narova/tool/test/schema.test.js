'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveConfig, narration } = require('../src/schema');

const validRaw = () => ({
  title: 'T',
  size: '1:1',
  voices: { a: { speaker: 'v1' }, b: { speaker: 'v2' } },
  scenes: [
    { id: 's1', body: '<p>one</p>', vo: [{ who: 'a', text: 'Hello there.' }] },
    { id: 's2', body: '<p>two</p>', vo: [{ who: 'a', text: 'Hi.' }, { who: 'b', text: 'Yo.' }] },
  ],
});

test('resolveConfig fills voice defaults', () => {
  const c = resolveConfig(validRaw(), {}, '.');
  assert.equal(c.voices.a.backend, 'piper');
  assert.ok(c.voices.a.color);
  assert.ok(c.voices.b.label.includes('B'));
  assert.notEqual(c.voices.a.color, c.voices.b.color);
});

test('resolveConfig resolves size presets', () => {
  assert.deepEqual(resolveConfig(validRaw(), {}, '.').size, { w: 1080, h: 1080 });
  assert.deepEqual(resolveConfig({ ...validRaw(), size: '9:16' }, {}, '.').size, { w: 720, h: 1280 });
  assert.deepEqual(resolveConfig(validRaw(), { size: '16:9' }, '.').size, { w: 1280, h: 720 });
});

test('resolveConfig applies CLI overrides', () => {
  const c = resolveConfig(validRaw(), { backend: 'xtts', voiceA: 'X', voiceB: 'Y', tempo: '1.3' }, '.');
  assert.equal(c.voices.a.backend, 'xtts');
  assert.equal(c.voices.a.speaker, 'X');
  assert.equal(c.voices.b.speaker, 'Y');
  assert.equal(c.timing.tempo, 1.3);
});

test('resolveConfig validates chatterbox clone settings before synth', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-chatterbox-'));
  const sample = path.join(dir, 'voice.wav');
  fs.writeFileSync(sample, 'sample');
  const raw = validRaw();
  raw.voices.a = {
    backend: 'chatterbox',
    speaker: sample,
    exaggeration: 0.7,
    cfg_weight: 0.3,
  };
  assert.doesNotThrow(() => resolveConfig(raw, {}, dir));

  for (const [key, value] of [
    ['exaggeration', 0.1],
    ['exaggeration', 'high'],
    ['cfg_weight', 1.1],
  ]) {
    const bad = validRaw();
    bad.voices.a = { backend: 'chatterbox', speaker: sample, [key]: value };
    assert.throws(() => resolveConfig(bad, {}, dir), new RegExp(`voices\\.a\\.${key}`));
  }
});

test('resolveConfig rejects invalid chatterbox paths and unknown backends', () => {
  const relative = validRaw();
  relative.voices.a = { backend: 'chatterbox', speaker: 'voice.wav' };
  assert.throws(() => resolveConfig(relative, {}, '.'), /not a saved voice sample/);

  const unknown = validRaw();
  unknown.voices.a.backend = 'chatty';
  assert.throws(() => resolveConfig(unknown, {}, '.'), /unknown backend "chatty"/);
});

test('chatterbox speaker resolves named samples from ~/.narova/samples/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-schema-samples-'));
  const samplesDir = path.join(dir, 'samples');
  fs.mkdirSync(samplesDir);
  // Create a fake sample wav.
  const wav = path.join(samplesDir, 'my-voice.wav');
  fs.writeFileSync(wav, Buffer.alloc(44));

  // Override NAROVA_HOME so SAMPLES_DIR points to our temp dir.
  const prev = process.env.NAROVA_HOME;
  process.env.NAROVA_HOME = dir;
  // Clear the require cache so util re-reads SAMPLES_DIR.
  delete require.cache[require.resolve('../src/util')];
  delete require.cache[require.resolve('../src/schema')];
  const { resolveConfig: r2 } = require('../src/schema');

  const raw = validRaw();
  raw.voices.a = { backend: 'chatterbox', speaker: 'my-voice' };
  const c = r2(raw, {}, '.');
  assert.equal(c.voices.a.speaker, wav, 'speaker should resolve to the absolute sample path');

  // Restore
  if (prev != null) process.env.NAROVA_HOME = prev; else delete process.env.NAROVA_HOME;
  delete require.cache[require.resolve('../src/util')];
  delete require.cache[require.resolve('../src/schema')];
  require('../src/util');
  require('../src/schema');
});

test('resolveConfig aggregates every error', () => {
  const bad = {
    voices: {},
    scenes: [
      { id: 'x', body: 42, vo: [] },
      { id: 'x', body: '<p></p>', vo: [{ who: 'ghost', text: 'hi' }] },
    ],
  };
  assert.throws(() => resolveConfig(bad, {}, '.'), err => {
    assert.match(err.message, /body: HTML string required/);
    assert.match(err.message, /duplicate "x"/);
    assert.match(err.message, /"ghost" not in config.voices/);
    assert.match(err.message, /empty turn list requires a positive explicit dur/);
    return true;
  });
});

test('resolveConfig rejects unsafe scene/voice ids and theme values', () => {
  const bad = validRaw();
  bad.voices['bad id'] = { speaker: 'v3' };
  bad.scenes[0].id = 'has"quote';
  bad.theme = { accent: 'red;}</style>' };
  assert.throws(() => resolveConfig(bad, {}, '.'), err => {
    assert.match(err.message, /voice id must match/);
    assert.match(err.message, /"has"quote" must match/);
    assert.match(err.message, /must not contain/);
    return true;
  });
});

test('resolveConfig reports an unknown size as a config error', () => {
  assert.throws(() => resolveConfig({ ...validRaw(), size: '4:3' }, {}, '.'), /config\.size: unknown size/);
});

test('resolveConfig rejects a missing theme.css file', () => {
  const raw = { ...validRaw(), theme: { css: 'no-such-file.css' } };
  assert.throws(() => resolveConfig(raw, {}, '.'), /theme\.css: file not found/);
});

test('resolveConfig discovers project assets and rejects unsafe asset paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-assets-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  assert.equal(resolveConfig(validRaw(), {}, dir).assetsDir, path.join(dir, 'assets'));
  assert.throws(() => resolveConfig({ ...validRaw(), assets: '../shared' }, {}, dir), /must be inside the project/);
  assert.throws(() => resolveConfig({ ...validRaw(), assets: 'missing' }, {}, dir), /directory not found/);
});

test('legacy caption/dur fields are accepted', () => {
  const raw = validRaw();
  raw.scenes[0].caption = 'legacy';
  raw.scenes[0].dur = 12;
  assert.doesNotThrow(() => resolveConfig(raw, {}, '.'));
});

test('theme.mode defaults to dark, accepts light, rejects junk', () => {
  assert.equal(resolveConfig(validRaw(), {}, '.').mode, 'dark');
  assert.equal(resolveConfig({ ...validRaw(), theme: { mode: 'light' } }, {}, '.').mode, 'light');
  assert.throws(
    () => resolveConfig({ ...validRaw(), theme: { mode: 'solarized' } }, {}, '.'),
    /theme\.mode: expected "dark" or "light"/,
  );
});

test('theme.mode is a directive, not a color token', () => {
  const c = resolveConfig({ ...validRaw(), theme: { mode: 'light', accent: '#123456' } }, {}, '.');
  assert.deepEqual(c.theme, { accent: '#123456' });
});

test('chrome defaults on, false strips all, object tunes per piece', () => {
  assert.deepEqual(resolveConfig(validRaw(), {}, '.').chrome, { topbar: true, counter: true, progress: true });
  assert.deepEqual(resolveConfig({ ...validRaw(), chrome: false }, {}, '.').chrome,
    { topbar: false, counter: false, progress: false });
  assert.deepEqual(resolveConfig({ ...validRaw(), chrome: { counter: false } }, {}, '.').chrome,
    { topbar: true, counter: false, progress: true });
  assert.throws(() => resolveConfig({ ...validRaw(), chrome: { sparkle: true } }, {}, '.'),
    /chrome\.sparkle: unknown key/);
  assert.throws(() => resolveConfig({ ...validRaw(), chrome: { topbar: 'yes' } }, {}, '.'),
    /chrome\.topbar: must be a boolean/);
});

test('resolveConfig returns the project dir for downstream checks', () => {
  assert.equal(resolveConfig(validRaw(), {}, '.').projectDir, path.resolve('.'));
});

test('narration produces the Python contract', () => {
  const c = resolveConfig(validRaw(), {}, '.');
  const n = narration(c);
  assert.deepEqual(n.map(s => [s.n, s.id]), [[1, 's1'], [2, 's2']]);
  assert.deepEqual(n[1].segments, c.scenes[1].vo);
});

/* ---- new keys: platform, music, sfx, captions, align, variants ------------- */

const noSize = () => { const raw = validRaw(); delete raw.size; return raw; };

test('platform preset picks the frame size only when no size is set', () => {
  assert.equal(resolveConfig(noSize(), {}, '.').platform, null);
  assert.deepEqual(resolveConfig({ ...noSize(), platform: 'tiktok' }, {}, '.').size, { w: 1080, h: 1920 });
  assert.deepEqual(resolveConfig({ ...noSize(), platform: 'linkedin' }, {}, '.').size, { w: 1080, h: 1080 });
  // --platform override beats config.platform.
  const c = resolveConfig({ ...noSize(), platform: 'linkedin' }, { platform: 'shorts' }, '.');
  assert.equal(c.platform, 'shorts');
  assert.deepEqual(c.size, { w: 1080, h: 1920 });
  // Explicit size wins over the platform preset (config.size and --size alike).
  assert.deepEqual(resolveConfig({ ...validRaw(), platform: 'tiktok' }, {}, '.').size, { w: 1080, h: 1080 });
  assert.deepEqual(resolveConfig({ ...noSize(), platform: 'tiktok' }, { size: '16:9' }, '.').size, { w: 1280, h: 720 });
});

test('unknown platform is a config error', () => {
  assert.throws(() => resolveConfig({ ...validRaw(), platform: 'myspace' }, {}, '.'),
    /config\.platform: unknown platform "myspace"/);
});

test('bed resolves file to absolute with defaults; legacy music key also accepted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-bed-'));
  fs.writeFileSync(path.join(dir, 'bed.mp3'), 'fake');
  const c = resolveConfig({ ...validRaw(), bed: { file: 'bed.mp3' } }, {}, dir);
  assert.deepEqual(c.bed, { file: path.join(dir, 'bed.mp3'), volume: 0.14, fadeIn: 0.5, fadeOut: 1.5 });
  // Legacy music key maps to bed.
  const c2 = resolveConfig({ ...validRaw(), music: { file: 'bed.mp3' } }, {}, dir);
  assert.deepEqual(c2.bed, { file: path.join(dir, 'bed.mp3'), volume: 0.14, fadeIn: 0.5, fadeOut: 1.5 });
  assert.equal(resolveConfig(validRaw(), {}, '.').bed, null);
  assert.throws(() => resolveConfig({ ...validRaw(), bed: 'bed.mp3' }, {}, dir),
    /config\.bed: expected an object/);
  assert.throws(() => resolveConfig({ ...validRaw(), bed: { file: 'missing.mp3' } }, {}, dir),
    /config\.bed\.file: not found/);
  assert.throws(() => resolveConfig({ ...validRaw(), bed: { file: 'bed.mp3', volume: -1 } }, {}, dir),
    /config\.bed\.volume: must be a non-negative number/);
});

test('sfx entries anchor to scenes; bad anchors/files throw', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-sfx-'));
  fs.writeFileSync(path.join(dir, 'whoosh.wav'), 'fake');
  const c = resolveConfig({ ...validRaw(), sfx: [{ file: 'whoosh.wav', scene: 's2', at: 1.5 }] }, {}, dir);
  assert.deepEqual(c.sfx, [{ file: path.join(dir, 'whoosh.wav'), scene: 's2', at: 1.5, volume: 0.8 }]);
  assert.deepEqual(resolveConfig(validRaw(), {}, '.').sfx, []);
  assert.throws(() => resolveConfig({ ...validRaw(), sfx: { file: 'whoosh.wav' } }, {}, dir),
    /config\.sfx: expected an array/);
  assert.throws(() => resolveConfig({ ...validRaw(), sfx: [{ file: 'missing.wav' }] }, {}, dir),
    /config\.sfx\[0\]\.file: not found/);
  assert.throws(() => resolveConfig({ ...validRaw(), sfx: [{ file: 'whoosh.wav', scene: 'nope' }] }, {}, dir),
    /config\.sfx\[0\]\.scene: "nope" is not a scene id/);
  assert.throws(() => resolveConfig({ ...validRaw(), sfx: [{ file: 'whoosh.wav', at: -1 }] }, {}, dir),
    /config\.sfx\[0\]\.at: must be a non-negative number/);
});

test('captions preset/emphasis resolve with defaults; junk throws', () => {
  assert.deepEqual(resolveConfig(validRaw(), {}, '.').captions, { preset: 'karaoke', emphasis: [], maxWords: null });
  const c = resolveConfig({ ...validRaw(), captions: { preset: 'slam', emphasis: ['Free', ' zero '] } }, {}, '.');
  assert.deepEqual(c.captions, { preset: 'slam', emphasis: ['Free', 'zero'], maxWords: null });
  assert.throws(() => resolveConfig({ ...validRaw(), captions: { preset: 'bounce' } }, {}, '.'),
    /config\.captions\.preset: unknown preset "bounce"/);
  assert.throws(() => resolveConfig({ ...validRaw(), captions: { emphasis: 'Free' } }, {}, '.'),
    /config\.captions\.emphasis: expected an array of words/);
  assert.throws(() => resolveConfig({ ...validRaw(), captions: 'slam' }, {}, '.'),
    /config\.captions: expected an object/);
});

test('align is off by default, true means auto, unknown engines throw', () => {
  assert.equal(resolveConfig(validRaw(), {}, '.').align, false);
  assert.deepEqual(resolveConfig({ ...validRaw(), align: true }, {}, '.').align, { engine: 'auto' });
  assert.deepEqual(resolveConfig({ ...validRaw(), align: { engine: 'faster-whisper' } }, {}, '.').align,
    { engine: 'faster-whisper' });
  assert.equal(resolveConfig({ ...validRaw(), align: false }, {}, '.').align, false);
  assert.throws(() => resolveConfig({ ...validRaw(), align: { engine: 'magic' } }, {}, '.'),
    /config\.align\.engine: unknown engine "magic"/);
  assert.throws(() => resolveConfig({ ...validRaw(), align: 'yes' }, {}, '.'),
    /config\.align: expected true\/false or \{ engine \}/);
});

const rawWithVariants = () => ({
  ...validRaw(),
  variants: [
    { id: 'punchy', scene: { body: '<p>alt</p>', vo: [{ who: 'b', text: 'Alt opener.' }] } },
    { id: 'quiet', scene: { body: '<p>soft</p>', vo: [{ who: 'a', text: 'Soft opener.' }], transition: 'fade' } },
  ],
});

test('variants are validated and carried on the config', () => {
  const c = resolveConfig(rawWithVariants(), {}, '.');
  assert.equal(c.variant, null);
  assert.deepEqual(c.variants.map(v => v.id), ['punchy', 'quiet']);
  assert.deepEqual(c.variants[0].scene, { body: '<p>alt</p>', vo: [{ who: 'b', text: 'Alt opener.' }] });
  assert.equal(c.variants[1].scene.transition, 'fade');
  // Base scenes untouched without --variant.
  assert.equal(c.scenes[0].body, '<p>one</p>');
});

test('invalid variants throw: bad id, duplicate, ghost voice, missing vo', () => {
  const badId = rawWithVariants();
  badId.variants[0].id = 'bad id';
  assert.throws(() => resolveConfig(badId, {}, '.'), /config\.variants\[0\]\.id: must match/);
  const dup = rawWithVariants();
  dup.variants[1].id = 'punchy';
  assert.throws(() => resolveConfig(dup, {}, '.'), /config\.variants\[1\]\.id: duplicate "punchy"/);
  const ghost = rawWithVariants();
  ghost.variants[0].scene.vo = [{ who: 'ghost', text: 'hi' }];
  assert.throws(() => resolveConfig(ghost, {}, '.'), /config\.variants\[0\]\.scene\.vo\[0\]\.who: "ghost" not in config\.voices/);
  const noVo = rawWithVariants();
  noVo.variants[0].scene.vo = [];
  assert.throws(() => resolveConfig(noVo, {}, '.'), /config\.variants\[0\]\.scene\.vo: non-empty turn list required/);
  assert.throws(() => resolveConfig({ ...validRaw(), variants: 'punchy' }, {}, '.'),
    /config\.variants: expected an array/);
});

test('overrides.variant swaps scene 1 keeping its id; unknown ids throw', () => {
  const c = resolveConfig(rawWithVariants(), { variant: 'punchy' }, '.');
  assert.equal(c.variant, 'punchy');
  assert.equal(c.scenes[0].id, 's1');
  assert.equal(c.scenes[0].body, '<p>alt</p>');
  assert.deepEqual(c.scenes[0].vo, [{ who: 'b', text: 'Alt opener.' }]);
  assert.equal(c.scenes[1].body, '<p>two</p>');
  assert.throws(() => resolveConfig(rawWithVariants(), { variant: 'nope' }, '.'),
    /unknown variant "nope" — declared variants: punchy, quiet/);
  // Variant scenes join the narration contract (Python sees the swap).
  assert.deepEqual(narration(c)[0].segments, [{ who: 'b', text: 'Alt opener.' }]);
});

// -- per-scene b-roll clip --

test('scene.clip: valid file is accepted and passed through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-schema-clip-'));
  const clipPath = path.join(dir, 'broll.mp4');
  fs.writeFileSync(clipPath, 'fake-mp4');
  const raw = { ...validRaw(), scenes: [{ id: 's1', body: '<p>one</p>', clip: 'broll.mp4', vo: [{ who: 'a', text: 'hi' }] }] };
  const c = resolveConfig(raw, {}, dir);
  assert.equal(c.scenes[0].clip, 'broll.mp4');
});

test('scene.clip: missing file throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-schema-clip-'));
  const raw = { ...validRaw(), scenes: [{ id: 's1', body: '<p>one</p>', clip: 'missing.mp4', vo: [{ who: 'a', text: 'hi' }] }] };
  assert.throws(() => resolveConfig(raw, {}, dir), /config\.scenes\[0\]\.clip: file not found/);
});

test('scene.clip: empty string throws', () => {
  const raw = { ...validRaw(), scenes: [{ id: 's1', body: '<p>one</p>', clip: '', vo: [{ who: 'a', text: 'hi' }] }] };
  assert.throws(() => resolveConfig(raw, {}, '.'), /config\.scenes\[0\]\.clip: must be a project-relative path/);
});

// -- series mode --

test('series: part and total resolve correctly', () => {
  const c = resolveConfig({ ...validRaw(), series: { part: 2, total: 5 } }, {}, '.');
  assert.deepEqual(c.series, { part: 2, total: 5 });
});

test('series: total is optional', () => {
  const c = resolveConfig({ ...validRaw(), series: { part: 3 } }, {}, '.');
  assert.deepEqual(c.series, { part: 3, total: null });
});

test('series: part must be positive integer; invalid values throw', () => {
  assert.throws(() => resolveConfig({ ...validRaw(), series: { part: 0 } }, {}, '.'),
    /config\.series\.part: must be a positive integer/);
  assert.throws(() => resolveConfig({ ...validRaw(), series: { part: -1 } }, {}, '.'),
    /config\.series\.part: must be a positive integer/);
  assert.throws(() => resolveConfig({ ...validRaw(), series: { part: 1.5 } }, {}, '.'),
    /config\.series\.part: must be a positive integer/);
});

test('series: part cannot exceed total', () => {
  assert.throws(() => resolveConfig({ ...validRaw(), series: { part: 4, total: 3 } }, {}, '.'),
    /config\.series\.part: 4 exceeds total 3/);
});

test('series: null when not configured', () => {
  assert.equal(resolveConfig(validRaw(), {}, '.').series, null);
});

// -- silent scenes --

test('silent scene: vo: [] with explicit positive dur is accepted', () => {
  const raw = { ...validRaw(), scenes: [{ id: 'silent', body: '<p>x</p>', vo: [], dur: 2 }] };
  const c = resolveConfig(raw, {}, '.');
  assert.equal(c.scenes[0].vo.length, 0);
  assert.equal(c.scenes[0].dur, 2);
  // narration contract carries dur for silent scenes.
  const n = require('../src/schema').narration(c);
  assert.equal(n[0].segments.length, 0);
  assert.equal(n[0].dur, 2);
});

test('silent scene: vo: [] without dur throws', () => {
  const raw = { ...validRaw(), scenes: [{ id: 'silent', body: '<p>x</p>', vo: [] }] };
  assert.throws(() => resolveConfig(raw, {}, '.'),
    /empty turn list requires a positive explicit dur/);
});

test('silent scene: dur must be positive', () => {
  const raw = { ...validRaw(), scenes: [{ id: 'silent', body: '<p>x</p>', vo: [], dur: 0 }] };
  assert.throws(() => resolveConfig(raw, {}, '.'),
    /empty turn list requires a positive explicit dur/);
});

// -- per-voice gainDb --

test('gainDb: accepted within -24 to 24 dB range', () => {
  const c = resolveConfig({ ...validRaw(), voices: { a: { speaker: 'v1', gainDb: 3 }, b: { speaker: 'v2' } } }, {}, '.');
  assert.equal(c.voices.a.gainDb, 3);
  assert.equal(c.voices.b.gainDb, undefined);
});

test('gainDb: out of range throws', () => {
  const raw = { ...validRaw(), voices: { a: { speaker: 'v1', gainDb: 30 } } };
  assert.throws(() => resolveConfig(raw, {}, '.'), /gainDb: must be a number from -24 to 24/);
  const raw2 = { ...validRaw(), voices: { a: { speaker: 'v1', gainDb: -30 } } };
  assert.throws(() => resolveConfig(raw2, {}, '.'), /gainDb: must be a number from -24 to 24/);
});

// ---- synthesisText validation -----------------------------------------------

test('synthesisText: accepted as optional non-empty string on turn', () => {
  const raw = validRaw();
  raw.scenes[0].vo[0].synthesisText = '[whispering] Hello there.';
  const c = resolveConfig(raw, {}, '.');
  assert.equal(c.scenes[0].vo[0].synthesisText, '[whispering] Hello there.');
});

test('synthesisText: rejected if present but empty', () => {
  const raw = validRaw();
  raw.scenes[0].vo[0].synthesisText = '  ';
  assert.throws(() => resolveConfig(raw, {}, '.'), /synthesisText: must be a non-empty string/);
});

test('synthesisText: rejected if present but not a string', () => {
  const raw = validRaw();
  raw.scenes[0].vo[0].synthesisText = 123;
  assert.throws(() => resolveConfig(raw, {}, '.'), /synthesisText: must be a non-empty string/);
});

test('synthesisText: turn without it is valid (backward compat)', () => {
  const raw = validRaw();
  const c = resolveConfig(raw, {}, '.');
  assert.equal(c.scenes[0].vo[0].synthesisText, undefined);
});

test('synthesisText: passes through narration projection', () => {
  const raw = validRaw();
  raw.scenes[0].vo[0].synthesisText = '[whispering] Hello there.';
  const c = resolveConfig(raw, {}, '.');
  const n = narration(c);
  assert.equal(n[0].segments[0].synthesisText, '[whispering] Hello there.');
});

test('synthesisText: absent from narration when not set', () => {
  const c = resolveConfig(validRaw(), {}, '.');
  const n = narration(c);
  assert.equal(n[0].segments[0].synthesisText, undefined);
});
