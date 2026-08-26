'use strict';
/* Unit tests for advisory review-evidence surfaces (NAR-007-025 / NAR-007-026
 * / NAR-007-053). These tests only exercise read-only fact computation over
 * deterministic synthetic ffmpeg fixtures — no synthesis, no rendering. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { audioLevelFacts, formatAudioLevels } = require('../src/review-evidence');

function fixtureFailure(result) {
  return [
    `status=${result.status}`,
    `signal=${result.signal || 'none'}`,
    `error=${result.error?.message || 'none'}`,
    `stderr=${String(result.stderr || '').trim() || 'none'}`,
  ].join(' ');
}

function makeFixture(dir, name, source) {
  const out = path.join(dir, name);
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-filter_threads', '1', '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', source,
    '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '1', '-threads', '1',
    out,
  ], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`ffmpeg fixture failed: ${fixtureFailure(r)}`);
  return out;
}

test('audioLevelFacts reports declared basis and measured facts for a sine wave', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = makeFixture(dir, 'sine.wav', 'sine=frequency=1000:duration=1');
  const report = await audioLevelFacts(dir, { audio });

  assert.equal(report.reason, undefined);
  assert.ok(report.file.endsWith('sine.wav'));
  assert.equal(typeof report.digest, 'string');
  assert.equal(report.digest.length, 64);

  assert.deepStrictEqual(report.basis.gating, 'BS.1770-4');
  assert.equal(report.basis.truePeakOversampling, 4);
  assert.equal(report.basis.clippingThresholdDb, -1.0);
  assert.equal(report.basis.interval, null);

  // A 1 kHz sine at default lavfi amplitude has true peak around -18 dBTP and
  // integrated loudness around -21 LUFS; tolerances are generous because the
  // exact numbers depend on gating and windowing.
  assert.ok(report.facts.integratedLoudness < -15, `integrated=${report.facts.integratedLoudness}`);
  assert.ok(report.facts.integratedLoudness > -35, `integrated=${report.facts.integratedLoudness}`);
  assert.equal(report.facts.loudnessRange, null, 'one second has no valid LRA short-term block');
  assert.ok(report.facts.truePeak < -10, `truePeak=${report.facts.truePeak}`);
  assert.ok(report.facts.samplePeak <= report.facts.truePeak + 0.1,
    `samplePeak=${report.facts.samplePeak} should not exceed truePeak=${report.facts.truePeak} by much`);
  assert.equal(report.facts.clippingSamples, 0);

  const human = formatAudioLevels(report);
  assert.match(human, /audio-levels \(advisory/);
  assert.match(human, new RegExp(report.digest));
  assert.match(human, /20 log10\(max\(abs\(decoded sample\)\)\)/);
  assert.match(human, /clipping threshold -1 dBFS sample/);
  assert.match(human, /integrated loudness:/);
  assert.match(human, /clipped samples: 0/);
});

test('audioLevelFacts detects clipped samples', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = makeFixture(dir, 'clipped.wav', 'sine=frequency=1000:duration=1,volume=20dB');
  const report = await audioLevelFacts(dir, { audio });

  assert.ok(report.facts.truePeak > -3, `truePeak=${report.facts.truePeak}`);
  assert.ok(report.facts.clippingSamples > 100, `clipping=${report.facts.clippingSamples}`);
});

test('audioLevelFacts scopes facts to a caller-declared interval', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = makeFixture(dir, 'sine2.wav', 'sine=frequency=1000:duration=2');
  const report = await audioLevelFacts(dir, { audio, interval: '0.5,1.5' });

  assert.deepStrictEqual(report.basis.interval, { start: 0.5, end: 1.5 });
  assert.ok(report.facts.integratedLoudness < -15);
  assert.equal(report.facts.clippingSamples, 0);
});

test('audioLevelFacts returns an unavailable reason when no audio exists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const report = await audioLevelFacts(dir, {});

  assert.ok(report.reason);
  assert.equal(report.facts, null);
  assert.equal(report.basis, null);
  assert.equal(formatAudioLevels(report), `audio-levels: ${report.reason}`);
});

test('audioLevelFacts reports a missing explicit audio path', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const report = await audioLevelFacts(dir, { audio: 'does-not-exist.wav' });

  assert.ok(report.reason);
  assert.match(report.reason, /does-not-exist\.wav/);
  assert.equal(report.facts, null);
  assert.equal(report.basis, null);
});

test('audioLevelFacts does not substitute defaults for an empty explicit selector', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  fs.mkdirSync(path.join(dir, 'audio'));
  makeFixture(path.join(dir, 'audio'), 'full.wav', 'sine=frequency=1000:duration=1');
  const report = await audioLevelFacts(dir, { audio: '' });

  assert.match(report.reason, /path is empty/);
  assert.equal(report.file, null);
  assert.equal(report.facts, null);
});

test('audioLevelFacts reports an undecodable artifact plainly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = path.join(dir, 'not-audio.wav');
  fs.writeFileSync(audio, 'not audio');
  const report = await audioLevelFacts(dir, { audio });

  assert.match(report.reason, /could not be decoded/);
  assert.equal(report.facts, null);
  assert.equal(report.basis, null);
});

test('audioLevelFacts rejects malformed intervals', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = makeFixture(dir, 'sine.wav', 'sine=frequency=1000:duration=1');

  for (const bad of ['nope', '1x,2y', '2,1', '-1,2', '1']) {
    const report = await audioLevelFacts(dir, { audio, interval: bad });
    assert.ok(report.reason, `expected rejection for interval "${bad}"`);
    assert.match(report.reason, /invalid interval/);
    assert.equal(report.facts, null);
  }
});

test('audioLevelFacts scopes loudness and peaks to a level-changing interval', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const out = path.join(dir, 'vary.wav');
  // First half is quiet, second half is clipped; interval over first half must
  // not inherit peaks or loudness from the clipped second half.
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-filter_threads', '1', '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2,volume=-20dB',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2,volume=20dB',
    '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', '48000', '-threads', '1', out,
  ], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`ffmpeg fixture failed: ${fixtureFailure(r)}`);

  const first = await audioLevelFacts(dir, { audio: out, interval: '0,1.5' });
  const second = await audioLevelFacts(dir, { audio: out, interval: '2.5,4' });

  assert.ok(first.facts.truePeak < -10, `quiet interval truePeak=${first.facts.truePeak}`);
  assert.equal(first.facts.clippingSamples, 0);
  assert.ok(second.facts.truePeak > -3, `clipped interval truePeak=${second.facts.truePeak}`);
  assert.ok(second.facts.clippingSamples > 100, `clipped interval clips=${second.facts.clippingSamples}`);
});

test('audioLevelFacts parses multichannel peaks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const out = path.join(dir, 'stereo.wav');
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-filter_threads', '1', '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
    '-filter_complex', '[0:a][1:a]amerge=inputs=2[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', '-ar', '48000', '-threads', '1', out,
  ], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`ffmpeg fixture failed: ${fixtureFailure(r)}`);

  const report = await audioLevelFacts(dir, { audio: out });
  assert.equal(typeof report.facts.truePeak, 'number');
  assert.equal(typeof report.facts.samplePeak, 'number');
  assert.ok(Number.isFinite(report.facts.truePeak), `truePeak=${report.facts.truePeak}`);
  assert.ok(Number.isFinite(report.facts.samplePeak), `samplePeak=${report.facts.samplePeak}`);
});

test('audioLevelFacts represents silence peaks explicitly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = makeFixture(dir, 'silence.wav', 'anullsrc=r=48000:cl=mono:d=1');
  const report = await audioLevelFacts(dir, { audio });

  assert.equal(report.facts.truePeak, -Infinity);
  assert.equal(report.facts.samplePeak, -Infinity);
  assert.equal(report.facts.integratedLoudness, -Infinity);
  assert.equal(report.facts.loudnessRange, null);
  assert.match(formatAudioLevels(report), /true peak: -inf/);
});

test('audioLevelFacts marks no-block integrated loudness unavailable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = makeFixture(dir, 'short-loud.wav', 'sine=frequency=1000:duration=0.05,volume=20dB');
  const report = await audioLevelFacts(dir, { audio });

  assert.equal(report.facts.integratedLoudness, null);
  assert.equal(report.facts.loudnessRange, null);
  assert.ok(report.facts.truePeak > -3);
  assert.match(formatAudioLevels(report), /integrated loudness: unavailable LUFS/);
});

test('audioLevelFacts preserves a valid integrated loudness rounded to -70 LUFS', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = path.join(dir, 'near-gate.wav');
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-filter_threads', '1', '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=5,volume=-48.9dB',
    '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '1', '-threads', '1', audio,
  ], { encoding: 'utf8', timeout: 30000 });
  if (generated.status !== 0) throw new Error(`ffmpeg fixture failed: ${fixtureFailure(generated)}`);
  const report = await audioLevelFacts(dir, { audio });

  assert.equal(report.facts.integratedLoudness, -70);
  assert.equal(report.facts.loudnessRange, 0);
});

test('audioLevelFacts preserves a nonzero LRA when printed auxiliaries round to zero', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = makeFixture(dir, 'narrow-range.wav', 'sine=frequency=1000:duration=5');
  const childProcess = require('node:child_process');
  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function narrowRoundedSummary(command, args, options) {
    const result = originalSpawnSync(command, args, options);
    if (command === 'ffmpeg' && args.some(arg => String(arg).includes('ebur128='))) {
      return {
        ...result,
        stderr: String(result.stderr).replace(
          /Loudness range:\s+LRA:\s+[-\d.]+\s+LU\s+Threshold:\s+[-\d.]+\s+LUFS\s+LRA low:\s+[-\d.]+\s+LUFS\s+LRA high:\s+[-\d.]+\s+LUFS/,
          'Loudness range:\n    LRA:         0.1 LU\n    Threshold:  -0.0 LUFS\n    LRA low:     0.0 LUFS\n    LRA high:   -0.0 LUFS',
        ),
      };
    }
    return result;
  };

  const modulePath = require.resolve('../src/review-evidence');
  delete require.cache[modulePath];
  try {
    const fresh = require('../src/review-evidence');
    const report = await fresh.audioLevelFacts(dir, { audio });
    assert.equal(report.facts.loudnessRange, 0.1);
  } finally {
    childProcess.spawnSync = originalSpawnSync;
    delete require.cache[modulePath];
  }
});

test('audioLevelFacts rejects non-finite decoded samples', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = path.join(dir, 'nan.wav');
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-filter_threads', '1', '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', 'aevalsrc=nan:s=48000:d=1',
    '-c:a', 'pcm_f32le', '-threads', '1', audio,
  ], { encoding: 'utf8', timeout: 30000 });
  if (generated.status !== 0) throw new Error(`ffmpeg fixture failed: ${fixtureFailure(generated)}`);
  const report = await audioLevelFacts(dir, { audio });

  assert.match(report.reason, /could not be decoded/);
  assert.equal(report.facts, null);
});

test('audioLevelFacts measures one snapshotted byte identity across path replacement', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const target = makeFixture(dir, 'current.wav', 'sine=frequency=1000:duration=1,volume=-20dB');
  const replacement = makeFixture(dir, 'replacement.wav', 'sine=frequency=1000:duration=1,volume=20dB');
  const before = fs.readFileSync(target);
  const childProcess = require('node:child_process');
  const originalSpawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function replaceDuringLoudness(command, args, options) {
    if (command === 'ffmpeg' && args.some(arg => String(arg).includes('ebur128='))) {
      fs.copyFileSync(replacement, target);
      try { return originalSpawnSync(command, args, options); }
      finally { fs.writeFileSync(target, before); }
    }
    return originalSpawnSync(command, args, options);
  };

  const modulePath = require.resolve('../src/review-evidence');
  delete require.cache[modulePath];
  try {
    const fresh = require('../src/review-evidence');
    const report = await fresh.audioLevelFacts(dir, { audio: target });
    assert.equal(report.digest, require('../src/manifest').hashFile(target));
    assert.ok(report.facts.truePeak < -10, `snapshot truePeak=${report.facts.truePeak}`);
    assert.ok(report.facts.samplePeak < -10, `snapshot samplePeak=${report.facts.samplePeak}`);
  } finally {
    childProcess.spawnSync = originalSpawnSync;
    delete require.cache[modulePath];
  }
});

test('audioLevelFacts reports an interval with no decoded samples plainly', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  const audio = makeFixture(dir, 'short.wav', 'sine=frequency=1000:duration=1');
  const report = await audioLevelFacts(dir, { audio, interval: '2,3' });

  assert.match(report.reason, /interval contains no decoded samples/);
  assert.equal(report.facts, null);
});

test('audioLevelFacts accepts a clipping threshold override', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-review-'));
  // A -6 dBFS sine has no samples above -1 dBFS, so should report 0 clips.
  const audio = makeFixture(dir, 'quiet.wav', 'sine=frequency=1000:duration=1,volume=-6dB');
  const report = await audioLevelFacts(dir, { audio, clippingThresholdDb: -1.0 });
  assert.equal(report.facts.clippingSamples, 0);
  assert.equal(report.basis.clippingThresholdDb, -1.0);
});
