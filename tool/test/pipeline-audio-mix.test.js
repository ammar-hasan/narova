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
