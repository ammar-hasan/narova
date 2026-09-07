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
    for (const [dir, rate, channels] of [[ext, '48000', 2], [synth, '22050', 1]]) {
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
