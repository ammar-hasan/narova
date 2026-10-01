'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mixExternalAudio } = require('../src/pipeline');
const { audioLevelFacts } = require('../src/review-evidence');

function fixture(file, source) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source,
    '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '1', file,
  ], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(String(result.stderr || 'ffmpeg fixture failed'));
}

test('external narration mixer resolves scene-anchored SFX on the global timeline', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-external-mix-'));
  const audioDir = path.join(root, 'audio');
  fs.mkdirSync(audioDir);
  const narration = path.join(root, 'narration.wav');
  const hit = path.join(root, 'hit.wav');
  fixture(narration, 'anullsrc=r=48000:cl=mono:d=5');
  fixture(hit, 'sine=frequency=880:duration=0.5');

  mixExternalAudio({
    scenes: [{ id: 'intro', dur: 2 }, { id: 'main', dur: 3 }],
    narrationSource: null, bed: null,
    sfx: [{ file: hit, scene: 'main', at: 1, volume: 1 }],
  }, narration, audioDir, () => {});

  const before = await audioLevelFacts(audioDir, { audio: 'mix.wav', interval: '0.3,0.8' });
  const atAnchor = await audioLevelFacts(audioDir, { audio: 'mix.wav', interval: '3.1,3.4' });
  assert.equal(before.facts.samplePeak, -Infinity);
  assert.ok(atAnchor.facts.samplePeak > -30, `anchored peak=${atAnchor.facts.samplePeak}`);
});

test('both real mixers consume shared anchor fixtures and retain their output profiles', async t => {
  const cases = require('./fixtures/audio-anchors.json');
  for (const sample of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-mix-parity-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const ext = path.join(root, 'external');
    const synth = path.join(root, 'synth');
    fs.mkdirSync(ext);
    fs.mkdirSync(synth);
    const total = Object.values(sample.timings).reduce((n, scene) => n + scene.dur, 0);
    const narration = path.join(root, 'full.wav');
    const hit = path.join(root, 'hit.wav');
    fixture(narration, `anullsrc=r=48000:cl=mono:d=${total}`);
    fixture(hit, 'sine=frequency=880:duration=0.4');
    fs.copyFileSync(narration, path.join(synth, 'full.wav'));
    const effect = sample.effects[0];
    const config = { scenes: sample.scenes.map(scene => ({ ...scene, dur: sample.timings[scene.id].dur })),
      sfx: [{ file: hit, scene: effect.scene, at: effect.at, volume: 1 }] };
    mixExternalAudio(config, narration, ext, () => {});
    const child = spawnSync('python3', ['-c',
      'import json,sys; from pathlib import Path; from narova_tts.pipeline import mix_audio; ' +
      'p=json.load(sys.stdin); mix_audio(p["scenes"],p["timings"],p["config"],Path(p["out"]))'],
    { encoding: 'utf8', timeout: 30000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: path.join(__dirname, '..', 'py') },
      input: JSON.stringify({ scenes: sample.scenes, timings: sample.timings, config, out: synth }) });
    assert.equal(child.status, 0, child.stderr);
    for (const [dir, rate, channels] of [[ext, '48000', 2], [synth, '48000', 2]]) {
      const before = await audioLevelFacts(dir, { audio: 'mix.wav', interval: `${effect.expected - 0.5},${effect.expected - 0.2}` });
      const inside = await audioLevelFacts(dir, { audio: 'mix.wav', interval: `${effect.expected + 0.1},${effect.expected + 0.3}` });
      assert.equal(before.facts.samplePeak, -Infinity);
      assert.ok(inside.facts.samplePeak > -30);
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path.join(dir, 'mix.wav')], { encoding: 'utf8' });
      const stream = JSON.parse(probe.stdout).streams[0];
      assert.equal(stream.sample_rate, rate);
      assert.equal(stream.channels, channels);
    }
  }
});


test('external route removes obsolete mix with no layers and on failed replacement', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-mix-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'full.wav');
  fixture(source, 'sine=frequency=330:duration=1');
  const original = fs.readFileSync(source);
  const mix = path.join(root, 'mix.wav');
  for (const bed of [null, { file: path.join(root, 'missing.wav') }]) {
    fs.writeFileSync(mix, 'obsolete');
    const logs = [];
    mixExternalAudio({ scenes: [{ id: 'one', dur: 1 }], bed }, source, root, line => logs.push(line));
    assert.ok(!fs.existsSync(mix));
    assert.ok(!fs.existsSync(path.join(root, 'mix.pending.wav')));
    assert.deepEqual(fs.readFileSync(source), original);
    if (bed) assert.match(logs.join('\n'), /audio mixing failed[\s\S]*raw narration/);
  }
});

test('external stereo source retains both channels when a layer is added', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-mix-stereo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'full.wav');
  const silence = path.join(root, 'silence.wav');
  const result = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
    'aevalsrc=0.1*sin(2*PI*440*t)|0.2*sin(2*PI*880*t):s=48000:d=1', '-c:a', 'pcm_s16le', source]);
  assert.equal(result.status, 0);
  fixture(silence, 'anullsrc=r=48000:cl=mono:d=1');
  mixExternalAudio({ scenes: [{ id: 'one', dur: 1 }], sfx: [{ file: silence, at: 0, volume: 1 }] }, source, root, () => {});
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'mix.wav'), '-f', 'f32le', '-'], { maxBuffer: 2e6 });
  assert.equal(decoded.status, 0);
  let left = 0, right = 0;
  for (let i = 4800*8; i < 40000*8; i += 8) {
    left += decoded.stdout.readFloatLE(i) ** 2;
    right += decoded.stdout.readFloatLE(i+4) ** 2;
  }
  assert.ok(right / left > 3.9 && right / left < 4.1, `right/left energy=${right/left}`);
});

test('external encode and processing failures never publish partial or obsolete audio', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-mix-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'full.wav');
  const bed = path.join(root, 'bed.wav');
  fixture(source, 'sine=frequency=220:duration=1');
  fixture(bed, 'sine=frequency=440:duration=1');
  const util = require('../src/util');
  const originalSh = util.sh;
  for (const processing of [false, true]) {
    fs.writeFileSync(path.join(root, 'mix.wav'), 'obsolete');
    const logs = [];
    util.sh = (_command, args) => {
      fs.writeFileSync(args.at(-1), 'partial');
      throw new Error('injected encoder failure after partial output');
    };
    try {
      mixExternalAudio({ scenes: [{ id: 'one', dur: 1 }], bed: { file: bed },
        narrationSource: processing ? { process: { highpass: 75 } } : null }, source, root, line => logs.push(line));
    } finally { util.sh = originalSh; }
    assert.ok(!fs.existsSync(path.join(root, 'mix.wav')));
    assert.ok(!fs.existsSync(path.join(root, 'mix.pending.wav')));
    assert.match(logs.join('\n'), /failed.*raw narration/);
  }
});


test('both mixers follow retimed indexed cues and trim/fade the selected source interval', async t => {
  const { audioMixMap } = require('../src/review-evidence');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-indexed-sfx-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const full = path.join(root, 'full.wav'), hit = path.join(root, 'hit.wav');
  fixture(full, 'anullsrc=r=48000:cl=mono:d=5');
  // First second is silent: successful trimming is independently visible in the mix.
  fixture(hit, String.raw`aevalsrc=0.2*gte(t\,1):s=48000:d=2`);
  for (const cueStart of [0.3, 0.8]) {
    for (const wordAnchor of [true, false]) {
      const synth = path.join(root, `synth-${cueStart}-${wordAnchor}`), ext = path.join(root, `external-${cueStart}-${wordAnchor}`);
      fs.mkdirSync(synth); fs.mkdirSync(ext); fs.copyFileSync(full, path.join(synth, 'full.wav'));
      const words = [{ w: 'open', si: 0, who: 'a', t0: cueStart, t1: cueStart }];
      const timings = { intro: { dur: 2, words: [], turns: [] }, main: { dur: 3, words, turns: [cueStart] } };
      const config = { scenes: [{ id: 'intro', n: 1, dur: 2 }, { id: 'main', n: 2, dur: 3, vo: [{ who: 'a', text: 'open' }] }],
        narrationSource: { wordTimings: [{ start: 2 + cueStart, end: 3.5, words: [{ text: 'open', start: 2 + cueStart, end: 2 + cueStart }] }] },
        sfx: [{ file: hit, scene: 'main', at: { sentence: 0, ...(wordAnchor ? { word: 0 } : {}), offset: -0.1 }, volume: 1, start: 1, duration: .6, fadeIn: .2, fadeOut: .2 }] };
      const logs = [];
      mixExternalAudio(config, full, ext, s => logs.push(s));
      assert.ok(fs.existsSync(path.join(ext, 'mix.wav')), logs.join('\n'));
      const child = spawnSync('python3', ['-c',
        'import json,sys; from pathlib import Path; from narova_tts.pipeline import mix_audio; p=json.load(sys.stdin); mix_audio(p["config"]["scenes"],p["timings"],p["config"],Path(p["out"]))'],
        { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: path.join(__dirname, '..', 'py') }, input: JSON.stringify({ config, timings, out: synth }) });
      assert.equal(child.status, 0, child.stderr);
      const start = 2 + cueStart - .1;
      for (const dir of [synth, ext]) {
        const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, 'mix.wav'), '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { maxBuffer: 4000000 });
        assert.equal(decoded.status, 0, String(decoded.stderr));
        const mean = (a, b) => { let sum = 0, count = 0; for (let i = Math.floor(a*48000); i < Math.floor(b*48000); i++) { sum += Math.abs(decoded.stdout.readFloatLE(i*4)); count++; } return sum/count; };
        assert.equal(mean(start - .15, start - .05), 0);
        const middle = mean(start + .25, start + .35);
        assert.ok(middle > .15, `source trim did not select signal: ${middle}`);
        assert.ok(mean(start + .02, start + .06) < middle*.5, 'fade-in');
        assert.ok(mean(start + .55, start + .59) < middle*.5, 'fade-out');
        assert.equal(mean(start + .7, start + .8), 0, 'authored duration trims the tail');
      }
      fs.writeFileSync(path.join(ext, 'timings.json'), JSON.stringify(timings));
      fs.mkdirSync(path.join(ext, 'audio'));
      fs.copyFileSync(path.join(ext, 'mix.wav'), path.join(ext, 'audio', 'mix.wav'));
      const map = await audioMixMap(config, ext, timings);
      const row = map.declarations[0];
      assert.ok(Math.abs(row.window.start - start) < 1e-6);
      assert.ok(Math.abs(row.window.end - (start + .6)) < 1e-6);
      assert.deepEqual(row.sourceTrim, { start: 1, duration: .6 });
      assert.equal(row.fadeIn, .2); assert.equal(row.fadeOut, .2);
      assert.equal(row.unavailable, null);
    }
  }
});

test('missing indexed SFX and exhausted source fail explicitly without stale mixes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-invalid-cue-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const full = path.join(root, 'full.wav'), hit = path.join(root, 'hit.wav');
  fixture(full, 'anullsrc=r=48000:cl=mono:d=2'); fixture(hit, 'sine=frequency=440:duration=1');
  for (const effect of [{ file: hit, scene: 'main', at: { sentence: 9 } }, { file: hit, at: 0, start: 2 }]) {
    fs.writeFileSync(path.join(root, 'mix.wav'), 'obsolete');
    const logs = [];
    const config = { scenes: [{ id: 'main', n: 1, dur: 2 }], sfx: [effect] };
    mixExternalAudio(config, full, root, line => logs.push(line));
    assert.equal(fs.existsSync(path.join(root, 'mix.wav')), false);
    assert.match(logs.join('\n'), /cue unavailable|source.*end/);
    const child = spawnSync('python3', ['-c', 'import json,sys; from pathlib import Path; from narova_tts.pipeline import mix_audio; p=json.load(sys.stdin); mix_audio(p["scenes"], {"main":{"dur":2,"words":[]}}, p, Path(sys.argv[1]))', root],
      { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: path.join(__dirname, '..', 'py') }, input: JSON.stringify(config) });
    assert.notEqual(child.status, 0); assert.match(child.stderr, /cue unavailable|source end/);
    assert.equal(fs.existsSync(path.join(root, 'mix.wav')), false);
  }
});
