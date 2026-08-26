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
