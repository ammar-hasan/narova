'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { resolveConfig } = require('../src/schema');
const { compile, validate, isValid, mergeTimings, MANIFEST_SCHEMA_VER } = require('../src/manifest');

// ---- minimal config fixture -------------------------------------------------
function makeRaw(overrides = {}) {
  return {
    title: 'Test Reel',
    size: '16:9',
    voices: {
      a: { label: 'Narrator', color: '#00ff00', backend: 'piper', speaker: 'en_US-ryan-high' },
      b: { label: 'Co-host',   color: '#ff00ff', backend: 'piper', speaker: 'en_US-amy-medium' },
    },
    scenes: [
      { id: 'intro', vo: [{ who: 'a', text: 'Hello world.' }], body: '<div class="s-title"><h1>Hi</h1></div>' },
      { id: 'body',  vo: [{ who: 'b', text: 'This is the body.' }, { who: 'a', text: 'Second turn.' }], body: '<div class="s-body"><p>Content</p></div>' },
      { id: 'outro', dur: 2, vo: [], body: '<div class="s-title"><h1>End</h1></div>' },
    ],
    ...overrides,
  };
}

function resolve(raw) {
  return resolveConfig(raw, {}, os.tmpdir());
}

function withAssets(overrides, fn) {
  const dir = path.join(os.tmpdir(), 'narova-tl-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const files = [];
  // Create any file fixtures needed for schema validation.
  const cfg = { ...makeRaw(), ...overrides };
  if (cfg.bed) { const f = path.join(assetsDir, path.basename(cfg.bed.file)); fs.writeFileSync(f, 'fake'); files.push(f); }
  if (cfg.sfx) cfg.sfx.forEach(s => {
    const f = path.join(assetsDir, path.basename(s.file)); fs.writeFileSync(f, 'fake'); files.push(f);
  });
  cfg.scenes = (cfg.scenes || []).map(s => {
    if (s.clip) { const f = path.join(assetsDir, path.basename(s.clip)); fs.writeFileSync(f, 'fake'); files.push(f); }
    return s;
  });
  try { fn(dir, cfg, assetsDir); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ---- compilation ------------------------------------------------------------

test('compile produces versioned document', () => {
  const tl = compile(resolve(makeRaw()));
  assert.equal(tl.version, MANIFEST_SCHEMA_VER);
  assert.equal(typeof tl.narova, 'string');
  assert.ok(tl.narova.length > 0);
});

test('compile includes project metadata', () => {
  const tl = compile(resolve(makeRaw()));
  assert.equal(tl.project.title, 'Test Reel');
  assert.ok(tl.project.created);
  assert.equal(tl.project.platform, null);
});

test('compile includes format with sizing', () => {
  const tl = compile(resolve(makeRaw()));
  assert.equal(tl.format.width, 1280);
  assert.equal(tl.format.height, 720);
  assert.equal(tl.format.fps, 30);
  assert.equal(tl.format.sampleRate, 48000);
  assert.equal(tl.format.colorSpace, 'rec709');
});

test('compile includes voices with correct shape', () => {
  const tl = compile(resolve(makeRaw()));
  assert.equal(Object.keys(tl.voices).length, 2);
  assert.equal(tl.voices.a.label, 'Narrator');
  assert.equal(tl.voices.a.backend, 'piper');
  assert.equal(tl.voices.a.speaker, 'en_US-ryan-high');
  assert.equal(tl.voices.a.color, '#00ff00');
});

test('compile includes theme, chrome, timing', () => {
  const tl = compile(resolve(makeRaw()));
  assert.ok(tl.theme);
  assert.equal(tl.theme.mode, 'dark');
  assert.ok(tl.chrome);
  assert.ok(tl.timing);
  assert.ok(Number.isFinite(tl.timing.gapSentence));
  assert.ok(Number.isFinite(tl.timing.tempo) || tl.timing.tempo === null);
});

test('compile includes captions config', () => {
  const tl = compile(resolve(makeRaw()));
  assert.equal(tl.captions.preset, 'karaoke');
  assert.deepEqual(tl.captions.emphasis, []);
  assert.equal(tl.captions.maxWords, null);
});

test('compile maps captions.maxWords when set', () => {
  const raw = makeRaw({ captions: { preset: 'slam', emphasis: ['hello'], maxWords: 5 } });
  const tl = compile(resolve(raw));
  assert.equal(tl.captions.maxWords, 5);
  assert.equal(tl.captions.preset, 'slam');
});

test('compile maps scenes preserving all turns', () => {
  const tl = compile(resolve(makeRaw()));
  assert.equal(tl.scenes.length, 3);
  assert.equal(tl.scenes[0].id, 'intro');
  assert.equal(tl.scenes[0].index, 0);
  assert.equal(tl.scenes[0].transition, 'fade');
  assert.equal(tl.scenes[0].vo.length, 1);
  assert.equal(tl.scenes[0].vo[0].who, 'a');
  assert.equal(tl.scenes[0].vo[0].text, 'Hello world.');
  assert.deepEqual(tl.scenes[0].vo[0].words, []);
  assert.equal(tl.scenes[1].vo.length, 2);
  assert.equal(tl.scenes[1].vo[1].who, 'a');
  assert.equal(tl.scenes[2].vo.length, 0);
  assert.equal(tl.scenes[2].dur, 2);
});

test('compile preserves per-turn lang', () => {
  const raw = makeRaw({
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Bonjour.', lang: 'fr' }], body: '<div/>' }],
  });
  const tl = compile(resolve(raw));
  assert.equal(tl.scenes[0].vo[0].lang, 'fr');
});

test('compile maps scene bodies', () => {
  const tl = compile(resolve(makeRaw()));
  assert.ok(tl.scenes[0].body.includes('<div class="s-title">'));
  assert.ok(tl.scenes[1].body.includes('<div class="s-body">'));
});

test('compile maps scene clips', () => {
  withAssets({
    scenes: [
      { id: 's1', vo: [{ who: 'a', text: 'x' }], body: '<div/>', clip: 'assets/bg.mp4' },
    ],
  }, (dir, raw) => {
    const tl = compile(resolveConfig(raw, {}, dir));
    assert.equal(tl.scenes[0].clip, 'assets/bg.mp4');
  });
});

test('compile builds deliverables with default + platform', () => {
  const tl = compile(resolve(makeRaw()));
  assert.ok(tl.deliverables.length >= 1);
  const def = tl.deliverables.find(d => d.id === 'default');
  assert.ok(def);
  assert.equal(def.codec, 'h264');
});

test('compile adds platform deliverable when platform is set', () => {
  const raw = makeRaw({ platform: 'tiktok' });
  const tl = compile(resolve(raw));
  const tiktok = tl.deliverables.find(d => d.id === 'tiktok');
  assert.ok(tiktok);
  assert.equal(tiktok.width, 1080);
  assert.equal(tiktok.height, 1920);
});

test('compile includes audio bed when present', () => {
  withAssets({
    bed: { file: 'assets/ambient.mp3', volume: 0.2, fadeIn: 1, fadeOut: 2 },
  }, (dir, raw) => {
    const tl = compile(resolveConfig(raw, {}, dir));
    assert.ok(tl.audio.bed);
    assert.ok(tl.audio.bed.file.includes('ambient.mp3'));
    assert.equal(tl.audio.bed.volume, 0.2);
  });
});

test('compile maps sfx array', () => {
  withAssets({
    sfx: [{ file: 'assets/pop.wav', at: 0.5, volume: 0.8 }],
  }, (dir, raw) => {
    const tl = compile(resolveConfig(raw, {}, dir));
    assert.equal(tl.audio.sfx.length, 1);
    assert.ok(tl.audio.sfx[0].file.includes('pop.wav'));
  });
});

test('compile includes variants with scene data', () => {
  const raw = makeRaw({
    variants: [{ id: 'cold-open', scene: { vo: [{ who: 'a', text: 'Alt.' }], body: '<div/>' } }],
  });
  const tl = compile(resolve(raw));
  assert.equal(tl.variants.length, 1);
  assert.equal(tl.variants[0].id, 'cold-open');
  assert.ok(tl.variants[0].scene);
  assert.ok(tl.variants[0].scene.vo);
  assert.equal(tl.variants[0].scene.vo[0].text, 'Alt.');
  assert.equal(tl.variants[0].scene.body, '<div/>');
});

test('compile collects assets from project', () => {
  const raw = makeRaw({
    bed: { file: 'assets/bed.wav', volume: 0.1 },
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'x' }], body: '<div/>', clip: 'assets/vid.mp4' }],
  });
  const dir = path.join(os.tmpdir(), 'narova-manifest-test-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  const assetsDir = path.join(dir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'bed.wav'), 'fake-audio');
  fs.writeFileSync(path.join(assetsDir, 'vid.mp4'), 'fake-video');
  try {
    const cfg = resolveConfig(raw, {}, dir);
    const tl = compile(cfg);
    assert.ok(tl.assets.length >= 1);
    assert.ok(tl.assets.find(a => a.type === 'audio'));
    assert.ok(tl.assets.find(a => a.type === 'video'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- validation -------------------------------------------------------------

test('validate passes a valid compiled manifest', () => {
  const tl = compile(resolve(makeRaw()));
  assert.equal(validate(tl).length, 0);
  assert.ok(isValid(tl));
});

test('validate catches missing version', () => {
  const tl = compile(resolve(makeRaw()));
  delete tl.version;
  assert.ok(validate(tl).length > 0);
  assert.ok(!isValid(tl));
});

test('validate catches missing narova key', () => {
  const tl = compile(resolve(makeRaw()));
  delete tl.narova;
  assert.ok(validate(tl).length > 0);
  assert.ok(!isValid(tl));
});

test('validate rejects incompatible version', () => {
  const tl = compile(resolve(makeRaw()));
  tl.version = '999.0';
  assert.ok(validate(tl).length > 0);
  assert.ok(!isValid(tl));
});

test('validate catches missing project', () => {
  const tl = compile(resolve(makeRaw()));
  delete tl.project;
  assert.ok(validate(tl).length > 0);
});

test('validate catches missing voices', () => {
  const tl = compile(resolve(makeRaw()));
  delete tl.voices;
  assert.ok(validate(tl).length > 0);
});

test('validate catches empty scenes', () => {
  const tl = compile(resolve(makeRaw()));
  tl.scenes = [];
  assert.ok(validate(tl).length > 0);
});

test('validate catches scene with missing id', () => {
  const tl = compile(resolve(makeRaw()));
  delete tl.scenes[0].id;
  assert.ok(validate(tl).length > 0);
});

test('validate catches turn with missing who', () => {
  const tl = compile(resolve(makeRaw()));
  delete tl.scenes[0].vo[0].who;
  assert.ok(validate(tl).length > 0);
});

test('validate catches missing deliverables', () => {
  const tl = compile(resolve(makeRaw()));
  delete tl.deliverables;
  assert.ok(validate(tl).length > 0);
});

test('validate rejects non-object', () => {
  assert.ok(validate(null).length > 0);
  assert.ok(validate('str').length > 0);
  assert.ok(!isValid(null));
});

// ---- mergeTimings -----------------------------------------------------------

test('mergeTimings integrates word-level data into scenes', () => {
  const tl = compile(resolve(makeRaw()));
  const tmp = path.join(os.tmpdir(), 'narova-mt-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const tp = path.join(tmp, 'timings.json');
  fs.writeFileSync(tp, JSON.stringify({
    intro: {
      dur: 3.5,
      turns: [0.16],
      words: [
        { w: 'Hello', t0: 0.16, t1: 0.45, who: 'a', si: 0 },
        { w: 'world.', t0: 0.45, t1: 0.78, who: 'a', si: 0 },
      ],
    },
    body: {
      dur: 5.2,
      turns: [0.16, 2.8],
      words: [
        { w: 'This',  t0: 0.16, t1: 0.40, who: 'b', si: 0 },
        { w: 'is',    t0: 0.40, t1: 0.52, who: 'b', si: 0 },
        { w: 'the',   t0: 0.52, t1: 0.65, who: 'b', si: 0 },
        { w: 'body.', t0: 0.65, t1: 0.92, who: 'b', si: 0 },
        { w: 'Second', t0: 2.80, t1: 3.10, who: 'a', si: 1 },
        { w: 'turn.',  t0: 3.10, t1: 3.40, who: 'a', si: 1 },
      ],
    },
    outro: { dur: 2, turns: [], words: [] },
  }, null, 2));
  try {
    const merged = mergeTimings(tl, tp);
    assert.ok(merged.totalDuration > 0);
    assert.equal(merged.scenes[0].duration, 3.5);
    assert.equal(merged.scenes[1].duration, 5.2);
    assert.equal(merged.scenes[2].duration, 2);
    assert.equal(merged.scenes[0].vo[0].words.length, 2);
    assert.equal(merged.scenes[0].vo[0].words[0].w, 'Hello');
    assert.equal(merged.scenes[1].vo[0].words.length, 4);
    assert.equal(merged.scenes[1].vo[1].words.length, 2);
    assert.equal(merged.scenes[1].vo[1].words[0].w, 'Second');
    assert.ok(merged.stages);
    assert.ok(merged.stages.synth);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('mergeTimings handles silent scenes gracefully', () => {
  const raw = makeRaw({
    scenes: [
      { id: 's1', vo: [{ who: 'a', text: 'Hi.' }], body: '<div/>' },
      { id: 'pause', dur: 3, vo: [], body: '<div/>' },
    ],
  });
  const tl = compile(resolve(raw));
  const tmp = path.join(os.tmpdir(), 'narova-mt2-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const tp = path.join(tmp, 'timings.json');
  fs.writeFileSync(tp, JSON.stringify({
    s1: { dur: 2.0, turns: [0.16], words: [{ w: 'Hi.', t0: 0.16, t1: 0.5, who: 'a', si: 0 }] },
    pause: { dur: 3, turns: [], words: [] },
  }, null, 2));
  try {
    const merged = mergeTimings(tl, tp);
    assert.equal(merged.scenes[0].duration, 2.0);
    assert.equal(merged.scenes[1].duration, 3);
    assert.equal(merged.scenes[1].start, 2.0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- Urdu sentence splitting -----------------------------------------------

test('mergeTimings splits Urdu . (U+06D4) correctly', () => {
  const raw = makeRaw({
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'یہ ایک جملہ ہے۔ یہ دوسرا جملہ ہے۔' }], body: '<div/>' }],
  });
  const tl = compile(resolve(raw));
  const tmp = path.join(os.tmpdir(), 'narova-urdu-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const tp = path.join(tmp, 'timings.json');
  fs.writeFileSync(tp, JSON.stringify({
    s1: {
      dur: 4.0,
      turns: [0.16],
      words: [
        { w: 'یہ', t0: 0.16, t1: 0.30, who: 'a', si: 0 },
        { w: 'ایک', t0: 0.30, t1: 0.44, who: 'a', si: 0 },
        { w: 'جملہ', t0: 0.44, t1: 0.58, who: 'a', si: 0 },
        { w: 'ہے۔', t0: 0.58, t1: 0.72, who: 'a', si: 0 },
        { w: 'یہ', t0: 0.88, t1: 1.02, who: 'a', si: 1 },
        { w: 'دوسرا', t0: 1.02, t1: 1.30, who: 'a', si: 1 },
        { w: 'جملہ', t0: 1.30, t1: 1.58, who: 'a', si: 1 },
        { w: 'ہے۔', t0: 1.58, t1: 1.84, who: 'a', si: 1 },
      ],
    },
  }, null, 2));
  try {
    const merged = mergeTimings(tl, tp);
    assert.equal(merged.scenes[0].duration, 4.0);
    assert.equal(merged.scenes[0].vo[0].words.length, 8);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('mergeTimings splits Urdu ? (U+061F) correctly', () => {
  const raw = makeRaw({
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'کیا تم نے دیکھا؟ میں نے نہیں دیکھا۔' }], body: '<div/>' }],
  });
  const tl = compile(resolve(raw));
  const tmp = path.join(os.tmpdir(), 'narova-urdu2-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const tp = path.join(tmp, 'timings.json');
  fs.writeFileSync(tp, JSON.stringify({
    s1: {
      dur: 3.0,
      turns: [0.16],
      words: [
        { w: 'کیا', t0: 0.16, t1: 0.30, who: 'a', si: 0 },
        { w: 'تم', t0: 0.30, t1: 0.44, who: 'a', si: 0 },
        { w: 'نے', t0: 0.44, t1: 0.58, who: 'a', si: 0 },
        { w: 'دیکھا؟', t0: 0.58, t1: 0.72, who: 'a', si: 0 },
        { w: 'میں', t0: 0.88, t1: 1.02, who: 'a', si: 1 },
        { w: 'نے', t0: 1.02, t1: 1.16, who: 'a', si: 1 },
        { w: 'نہیں', t0: 1.16, t1: 1.44, who: 'a', si: 1 },
        { w: 'دیکھا۔', t0: 1.44, t1: 1.72, who: 'a', si: 1 },
      ],
    },
  }, null, 2));
  try {
    const merged = mergeTimings(tl, tp);
    assert.equal(merged.scenes[0].duration, 3.0);
    assert.equal(merged.scenes[0].vo[0].words.length, 8);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('mergeTimings handles Urdu ellipsis without broken fragments', () => {
  const raw = makeRaw({
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'اوہ... یعنی تم یہاں تھے؟' }], body: '<div/>' }],
  });
  const tl = compile(resolve(raw));
  const tmp = path.join(os.tmpdir(), 'narova-urdu3-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const tp = path.join(tmp, 'timings.json');
  fs.writeFileSync(tp, JSON.stringify({
    s1: {
      dur: 2.0,
      turns: [0.16],
      words: [
        { w: 'اوہ...', t0: 0.16, t1: 0.40, who: 'a', si: 0 },
        { w: 'یعنی', t0: 0.56, t1: 0.76, who: 'a', si: 1 },
        { w: 'تم', t0: 0.76, t1: 0.92, who: 'a', si: 1 },
        { w: 'یہاں', t0: 0.92, t1: 1.12, who: 'a', si: 1 },
        { w: 'تھے؟', t0: 1.12, t1: 1.32, who: 'a', si: 1 },
      ],
    },
  }, null, 2));
  try {
    const merged = mergeTimings(tl, tp);
    assert.equal(merged.scenes[0].duration, 2.0);
    assert.equal(merged.scenes[0].vo[0].words.length, 5);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('mergeTimings handles mixed English and Urdu sentence splitting', () => {
  const raw = makeRaw({
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Hello world. آپ کیسے ہیں؟ میں ٹھیک ہوں۔' }], body: '<div/>' }],
  });
  const tl = compile(resolve(raw));
  const tmp = path.join(os.tmpdir(), 'narova-urdu4-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const tp = path.join(tmp, 'timings.json');
  fs.writeFileSync(tp, JSON.stringify({
    s1: {
      dur: 5.0,
      turns: [0.16],
      words: [
        { w: 'Hello', t0: 0.16, t1: 0.35, who: 'a', si: 0 },
        { w: 'world.', t0: 0.35, t1: 0.60, who: 'a', si: 0 },
        { w: 'آپ', t0: 0.76, t1: 0.90, who: 'a', si: 1 },
        { w: 'کیسے', t0: 0.90, t1: 1.10, who: 'a', si: 1 },
        { w: 'ہیں؟', t0: 1.10, t1: 1.30, who: 'a', si: 1 },
        { w: 'میں', t0: 1.46, t1: 1.60, who: 'a', si: 2 },
        { w: 'ٹھیک', t0: 1.60, t1: 1.80, who: 'a', si: 2 },
        { w: 'ہوں۔', t0: 1.80, t1: 2.00, who: 'a', si: 2 },
      ],
    },
  }, null, 2));
  try {
    const merged = mergeTimings(tl, tp);
    assert.equal(merged.scenes[0].duration, 5.0);
    assert.equal(merged.scenes[0].vo[0].words.length, 8);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- round-trip -------------------------------------------------------------

// ---- synthesisText ---------------------------------------------------------

test('compile passes synthesisText through when present', () => {
  const raw = makeRaw({
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Clean text.', synthesisText: '[excited] Clean text.' }], body: '<div/>' }],
  });
  const tl = compile(resolve(raw));
  assert.equal(tl.scenes[0].vo[0].text, 'Clean text.');
  assert.equal(tl.scenes[0].vo[0].synthesisText, '[excited] Clean text.');
});

test('compile omits synthesisText when absent', () => {
  const tl = compile(resolve(makeRaw()));
  assert.equal(tl.scenes[0].vo[0].synthesisText, undefined);
});

test('mergeTimings with synthesisText: word assignment uses text, not synthesisText', () => {
  const raw = makeRaw({
    scenes: [{ id: 's1', vo: [{ who: 'a', text: 'Clean text.', synthesisText: '[excited] Clean text.' }], body: '<div/>' }],
  });
  const tl = compile(resolve(raw));
  const tmp = path.join(os.tmpdir(), 'narova-st-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const tp = path.join(tmp, 'timings.json');
  fs.writeFileSync(tp, JSON.stringify({
    s1: {
      dur: 2.0,
      turns: [0.16],
      words: [
        { w: 'Clean', t0: 0.16, t1: 0.50, who: 'a', si: 0 },
        { w: 'text.', t0: 0.50, t1: 0.84, who: 'a', si: 0 },
      ],
    },
  }, null, 2));
  try {
    const merged = mergeTimings(tl, tp);
    assert.equal(merged.scenes[0].vo[0].words.length, 2);
    assert.equal(merged.scenes[0].vo[0].words[0].w, 'Clean');
    assert.equal(merged.scenes[0].vo[0].text, 'Clean text.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- round-trip (continued) ------------------------------------------------

test('compile → validate → read back is stable', () => {
  const tl = compile(resolve(makeRaw()));
  const tmp = path.join(os.tmpdir(), 'narova-rt-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const tp = path.join(tmp, 'manifest.json');
  try {
    fs.writeFileSync(tp, JSON.stringify(tl));
    const back = JSON.parse(fs.readFileSync(tp, 'utf8'));
    assert.deepEqual(back.project, tl.project);
    assert.deepEqual(back.format, tl.format);
    assert.deepEqual(back.voices, tl.voices);
    assert.deepEqual(back.scenes, tl.scenes);
    assert.deepEqual(back.deliverables, tl.deliverables);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- choreography round-trip ------------------------------------------------
// The composition is rebuilt from the manifest, not from the resolved config,
// so choreography that the manifest does not carry renders as nothing at all —
// silently, with check() and the build both reporting success.

const CHOREO = 'tl.to("#scene-intro .x", { y: 10, duration: 1 }, 2);';

test('compile carries choreography contents into the manifest', () => {
  const tl = compile({ ...resolve(makeRaw()), choreography: CHOREO });
  assert.equal(tl.choreography, CHOREO);
});

test('compile defaults choreography to an empty string', () => {
  assert.equal(compile(resolve(makeRaw())).choreography, '');
});

test('choreography survives the manifest round-trip into a composable config', () => {
  const { configFromManifest } = require('../src/pipeline');
  const tl = compile({ ...resolve(makeRaw()), choreography: CHOREO });
  const round = configFromManifest(JSON.parse(JSON.stringify(tl)), null);
  assert.equal(round.choreography, CHOREO,
    'a build driven from the manifest must not drop choreography');
});

test('editing choreography changes the build hashes', () => {
  const { buildHashes } = require('../src/manifest');
  const base = resolve(makeRaw());
  const h1 = buildHashes({ ...base, choreography: CHOREO }, os.tmpdir());
  const h2 = buildHashes({ ...base, choreography: CHOREO + '\n// tweak' }, os.tmpdir());
  assert.ok(h1.choreography, 'choreography must be hashed');
  assert.notEqual(h1.choreography, h2.choreography,
    'an edited choreography file must invalidate the cached build');
});

test('no choreography leaves no choreography hash', () => {
  const { buildHashes } = require('../src/manifest');
  assert.equal(buildHashes(resolve(makeRaw()), os.tmpdir()).choreography, undefined);
});

// --- theme token preservation -----------------------------------------------

test('custom theme tokens survive the manifest round-trip', () => {
  const { configFromManifest } = require('../src/pipeline');
  const raw = makeRaw({
    theme: {
      accent: '#ff0000', bg: '#111111', mode: 'dark',
      stage: '#222222', deep: '#000033', halo: '#330066',
      panel: '#333344', line: '#444455', ink: '#eeeeff',
      muted: '#777788', faint: '#555566', gold: '#ffd700',
      pink: '#ff69b4', green: '#00ff00', colw: '1180px',
      chip: '#111122', capidle: '#888899', onaccent: '#000000',
      track: 'rgba(255,255,255,.04)', 'accent-dim': '#cc0000',
      red: '#ff4444', amber: '#ffaa00',
      // arbitrary user-defined token
      'brand-primary': '#0f172a', 'brand-muted': '#64748b',
    },
  });
  const resolved = resolve(raw);
  const tl = compile(resolved);
  const round = configFromManifest(JSON.parse(JSON.stringify(tl)), resolved);

  // Standard tokens
  assert.equal(round.theme.accent, '#ff0000');
  assert.equal(round.theme.bg, '#111111');
  assert.equal(round.mode, 'dark');

  // Custom tokens must survive
  assert.equal(round.theme.stage, '#222222');
  assert.equal(round.theme.deep, '#000033');
  assert.equal(round.theme.halo, '#330066');
  assert.equal(round.theme.panel, '#333344');
  assert.equal(round.theme.line, '#444455');
  assert.equal(round.theme.ink, '#eeeeff');
  assert.equal(round.theme.muted, '#777788');
  assert.equal(round.theme.faint, '#555566');
  assert.equal(round.theme.gold, '#ffd700');
  assert.equal(round.theme.pink, '#ff69b4');
  assert.equal(round.theme.green, '#00ff00');
  assert.equal(round.theme.colw, '1180px');
  assert.equal(round.theme['accent-dim'], '#cc0000');
  assert.equal(round.theme.chip, '#111122');
  assert.equal(round.theme.capidle, '#888899');
  assert.equal(round.theme.onaccent, '#000000');
  assert.equal(round.theme.track, 'rgba(255,255,255,.04)');
  assert.equal(round.theme.red, '#ff4444');
  assert.equal(round.theme.amber, '#ffaa00');

  // User-defined tokens survive
  assert.equal(round.theme['brand-primary'], '#0f172a');
  assert.equal(round.theme['brand-muted'], '#64748b');
});

test('custom theme tokens appear in the CSS output', () => {
  const { composeCss } = require('../src/compose/css');
  const theme = {
    accent: '#ff0000', bg: '#111', stage: '#222', deep: '#333',
    gold: '#ffd700', colw: '1180px', ink: '#eee', 'brand-primary': '#0f172a',
  };
  const css = composeCss(theme, {}, { w: 1280, h: 720 }, '', 'dark');
  assert.ok(css.includes('--accent:#ff0000;'), 'accent token must appear in :root');
  assert.ok(css.includes('--bg:#111;'), 'bg token must appear in :root');
  assert.ok(css.includes('--stage:#222;'), 'custom stage token must appear in :root');
  assert.ok(css.includes('--deep:#333;'), 'custom deep token must appear in :root');
  assert.ok(css.includes('--gold:#ffd700;'), 'gold token must appear in :root');
  assert.ok(css.includes('--colw:1180px;'), 'colw token must appear in :root');
  assert.ok(css.includes('--brand-primary:#0f172a;'), 'brand-primary user token must appear in :root');
  assert.ok(!css.includes('--mode:'), 'mode is not a color token');
  assert.ok(!css.includes('--css:'), 'css file ref must not leak as a token');
});

// --- revision guarantee: audio fingerprint stability ------------------------

const { audioFingerprint } = require('../src/audio-fingerprint');

function baseConfig(overrides = {}) {
  return {
    title: 'R', size: '16:9',
    voices: { a: { label: 'A', backend: 'piper', speaker: 'en_US-ryan-high' } },
    theme: { accent: '#ff0000', bg: '#111111' },
    scenes: [
      { id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<p>Hi</p>' },
    ],
    ...overrides,
  };
}

test('revision: visual-only edit (body change) does not change audio fingerprint', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig());
  b.scenes[0].body = '<p>Different body</p>';
  assert.equal(audioFingerprint(a), audioFingerprint(b),
    'changing scene body must not invalidate audio fingerprint — visual-only edits avoid TTS');
});

test('revision: visual-only edit (theme change) does not change audio fingerprint', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig());
  b.theme.accent = '#00ff00';
  assert.equal(audioFingerprint(a), audioFingerprint(b),
    'changing theme must not invalidate audio fingerprint — theme edits avoid TTS');
});

test('revision: visual-only edit (captions preset change) does not change audio fingerprint', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig());
  b.captions.preset = 'slam';
  assert.equal(audioFingerprint(a), audioFingerprint(b),
    'changing captions preset must not invalidate audio fingerprint');
});

test('revision: visual-only edit (choreography change) does not change audio fingerprint', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig());
  b.choreography = 'tl.set(".x", { opacity: 1 }, 2);';
  assert.equal(audioFingerprint(a), audioFingerprint(b),
    'adding choreography must not invalidate audio fingerprint');
});

test('revision: narration edit (text change) DOES change audio fingerprint', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig());
  b.scenes[0].vo[0].text = 'Different text.';
  assert.notEqual(audioFingerprint(a), audioFingerprint(b),
    'changing narration text MUST invalidate audio fingerprint — text edits need re-synth');
});

test('revision: voice change (speaker swap) DOES change audio fingerprint', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig());
  b.voices.a.speaker = 'en_US-amy-medium';
  assert.notEqual(audioFingerprint(a), audioFingerprint(b),
    'changing voice speaker MUST invalidate audio fingerprint');
});

test('revision: tempo change DOES change audio fingerprint', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig());
  b.timing.tempo = 1.5;
  assert.notEqual(audioFingerprint(a), audioFingerprint(b),
    'changing tempo MUST invalidate audio fingerprint');
});

test('revision: adding bed audio does NOT change audio fingerprint (re-mix only)', () => {
  const dir = os.tmpdir();
  const bedFile = path.join(dir, 'bed.mp3');
  fs.writeFileSync(bedFile, 'fake');
  const a = resolve(baseConfig());
  const b = resolve(baseConfig({ bed: { file: bedFile, volume: 0.2 } }));
  try {
    assert.equal(audioFingerprint(a), audioFingerprint(b),
      'adding a bed must not invalidate audio fingerprint — bed/SFX are re-mixed on reuse path');
  } finally {
    try { fs.unlinkSync(bedFile); } catch {}
  }
});

test('revision: adding SFX does NOT change audio fingerprint (re-mix only)', () => {
  const dir = os.tmpdir();
  const sfxFile = path.join(dir, 'bang.mp3');
  fs.writeFileSync(sfxFile, 'fake');
  const a = resolve(baseConfig());
  const b = resolve(baseConfig({ sfx: [{ file: sfxFile, scene: 's1', at: 0.5  }] }));
  try {
    assert.equal(audioFingerprint(a), audioFingerprint(b),
      'adding SFX must not invalidate audio fingerprint — SFX are re-mixed on reuse path');
  } finally {
    try { fs.unlinkSync(sfxFile); } catch {}
  }
});

test('revision: identical configs produce identical audio fingerprints', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig());
  assert.equal(audioFingerprint(a), audioFingerprint(b),
    'identical configs must produce byte-identical audio fingerprints');
  // Run twice — fingerprint must be stable across calls
  assert.equal(audioFingerprint(a), audioFingerprint(b),
    'audio fingerprint must be stable across repeated calls');
});

test('revision: scene count change DOES change audio fingerprint (structure change)', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig({
    scenes: [
      { id: 's1', vo: [{ who: 'a', text: 'Hello.' }], body: '<p>1</p>' },
      { id: 's2', vo: [{ who: 'a', text: 'World.' }], body: '<p>2</p>' },
    ],
  }));
  assert.notEqual(audioFingerprint(a), audioFingerprint(b),
    'adding a scene MUST change the audio fingerprint (more turns to synthesize)');
});

test('revision: synthesisText change DOES change audio fingerprint (different TTS input)', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig());
  b.scenes[0].vo[0].synthesisText = '[whispering] Hello world.';
  assert.notEqual(audioFingerprint(a), audioFingerprint(b),
    'changing synthesisText MUST invalidate audio fingerprint — TTS receives different input');
});

test('revision: scene id rename does NOT change audio fingerprint (same turns, same order)', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig({ scenes: [
    { id: 'renamed', vo: [{ who: 'a', text: 'Hello world.' }], body: '<p>Hi</p>' },
  ] }));
  // scene id changes don't affect audio fingerprint — only turn who/text matter
  assert.equal(audioFingerprint(a), audioFingerprint(b),
    'renaming a scene id while keeping turns identical must not change audio fingerprint');
});

test('revision: visual-only edit (add scene with same vo text) SHOULD change fingerprint (new turn added)', () => {
  const a = resolve(baseConfig());
  const b = resolve(baseConfig({ scenes: [
    { id: 's1', vo: [{ who: 'a', text: 'Hello world.' }], body: '<p>Hi</p>' },
    { id: 's2', vo: [{ who: 'a', text: 'Hello world.' }], body: '<p>Extra scene</p>' },
  ] }));
  assert.notEqual(audioFingerprint(a), audioFingerprint(b),
    'adding a scene with the same text still changes fingerprint — additional turn to synthesize');
});
