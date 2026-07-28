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

// ---- round-trip -------------------------------------------------------------

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
