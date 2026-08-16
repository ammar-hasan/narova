'use strict';
/* CHANGE-2026-018 — narration take observability conformance tests.
 *
 *   NAR-018-070  take-identity recording (module-level: the Python pipeline
 *                owns synthesis; here we verify the JS-visible surfaces and
 *                the derived-seed/identity invariants it depends on)
 *   NAR-018-071  deterministic takes with authored variation
 *   NAR-018-072  seed-stabilization disclosure
 *   NAR-007-025  silence-gap review
 *   NAR-007-026  narration take index
 *   NAR-007-027  unused-delivery-control critique hint (see check.test.js)
 * All advisory; none reject a project. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { silenceGaps, formatSilences, takeIndex, formatTakes } = require('../src/review-evidence');
const { DELIVERY_CAPABILITIES, deliveryCapabilitiesFor } = require('../src/tts-backends');
const { validateManifest } = require('../src/providers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'narova-takes-'));

/* ---- NAR-018-072 — seed-stabilization disclosure --------------------------- */

test('built-ins declare seed stabilization honestly', () => {
  assert.equal(DELIVERY_CAPABILITIES.piper['seed-stabilization'], 'honored');
  assert.equal(DELIVERY_CAPABILITIES.xtts['seed-stabilization'], 'honored');
  assert.equal(DELIVERY_CAPABILITIES.qwen['seed-stabilization'], 'unknown');
  assert.equal(DELIVERY_CAPABILITIES.chatterbox['seed-stabilization'], 'unknown');
});

test('provider manifests accept a seed-stabilization declaration', () => {
  const worker = path.join(tmp(), 'worker.sh');
  fs.writeFileSync(worker, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(worker, 0o755);
  const base = {
    name: 'seedprov', protocol: 'narova-tts-provider/v1',
    command: [worker],
    requiredEnvironment: [],
    capabilities: { synthesis: true },
  };
  const withSeed = validateManifest({ ...base, deliveryCapabilities: { 'seed-stabilization': 'honored' } });
  assert.equal(withSeed.deliveryCapabilities['seed-stabilization'], 'honored');
  // closed status vocabulary
  assert.throws(() => validateManifest({ ...base, deliveryCapabilities: { 'seed-stabilization': 'maybe' } }));
  // undeclared stays absent -> surfaces read unknown, never inferred
  const bare = validateManifest(base);
  assert.equal(bare.deliveryCapabilities, undefined);
  assert.equal(deliveryCapabilitiesFor('seedprov', () => bare), null);
});

/* ---- NAR-018-071 — derived seed identity invariants ------------------------ */

test('derived seeds are a pure function of sentence identity (mirror of pipeline.derived_seed)', () => {
  const crypto = require('node:crypto');
  const derived = key => parseInt(crypto.createHash('sha1').update(`seed|${key}`).digest('hex').slice(0, 8), 16);
  const a = derived('v1|piper|spk|1.18|22050|0.012|Hello world');
  const b = derived('v1|piper|spk|1.18|22050|0.012|Hello world');
  const c = derived('v1|piper|spk|1.18|22050|0.012|Hello world|take=2');
  assert.equal(a, b, 'same identity must derive the same seed');
  assert.notEqual(a, c, 'a take nonce must change the derived seed');
  assert.ok(Number.isInteger(a) && a >= 0 && a <= 0xffffffff);
});

/* ---- NAR-007-025 — silence-gap review --------------------------------------- */

test('silence report lists only above-threshold gaps and stays advisory', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  const dir = tmp();
  const audio = path.join(dir, 'audio');
  fs.mkdirSync(audio, { recursive: true });
  // 5s tone with a 2.7s mute region (1.0s–3.7s): one lavfi input, one
  // filter — robust across ffmpeg builds (multi-input concat is not).
  const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000:duration=5',
    '-af', "volume=0:enable='between(t,1,3.7)'", '-c:a', 'pcm_s16le',
    path.join(audio, 'full.wav')]);
  assert.equal(made.status, 0, 'fixture synthesis must succeed');
  const report = silenceGaps(dir, { threshold: 1.0 });
  assert.equal(report.reason, undefined, 'audio exists, no reason');
  assert.equal(report.gaps.length, 1);
  const gap = report.gaps[0];
  assert.ok(Math.abs(gap.start - 1.0) < 0.15, `start ~1.0 (got ${gap.start})`);
  assert.ok(Math.abs(gap.duration - 2.7) < 0.2, `duration ~2.7 (got ${gap.duration})`);
  // threshold filters shorter gaps out
  const none = silenceGaps(dir, { threshold: 5.0 });
  assert.equal(none.gaps.length, 0);
  assert.match(formatSilences(none), /no gap above 5s/);
  assert.match(formatSilences(report), /deliberate dramatic beat/);
});

test('silence report states the no-build reason', () => {
  const report = silenceGaps(tmp());
  assert.match(report.reason, /run a build first/);
});

/* ---- NAR-007-026 — narration take index ------------------------------------- */

test('take index joins timings, sentence files, and identities; absent evidence marked unavailable', () => {
  const dir = tmp();
  const sentencesDir = path.join(dir, 'audio', 'sentences');
  fs.mkdirSync(sentencesDir, { recursive: true });
  fs.writeFileSync(path.join(sentencesDir, '01_000.wav'), 'x');
  const timings = {
    s1: { dur: 2, words: [
      { w: 'Marjaiyyah', t0: 0.2, t1: 0.8, si: 0, who: 'a' },
      { w: 'guides', t0: 0.9, t1: 1.2, si: 1, who: 'a' },
    ] },
  };
  const config = { scenes: [{ id: 's1', body: '<p>x</p>' }] };
  // No takes.json -> identities unavailable, never inferred.
  const bare = takeIndex(config, dir, timings);
  assert.equal(bare.sentences.length, 2);
  assert.equal(bare.sentences[0].take, 'unavailable');
  assert.ok(bare.sentences[0].file && bare.sentences[0].file.endsWith('01_000.wav'));
  assert.equal(bare.sentences[1].file, null); // no file for si=1
  assert.match(formatTakes(bare), /identity unavailable/);
  // With takes.json -> joined identities.
  fs.writeFileSync(path.join(dir, 'audio', 'takes.json'), JSON.stringify([
    { scene: 1, sceneId: 's1', si: 0, who: 'a', backend: 'piper', speaker: 'x',
      mode: 'pinned', seed: 12345, cacheHit: false,
      file: 'audio/sentences/01_000.wav', text: 'Marjaiyyah' },
  ]));
  const joined = takeIndex(config, dir, timings);
  assert.equal(joined.sentences[0].take.backend, 'piper');
  assert.equal(joined.sentences[0].take.mode, 'pinned');
  assert.equal(joined.sentences[0].take.seed, 12345);
  assert.equal(joined.sentences[1].take, 'unavailable');
  assert.match(formatTakes(joined), /backend=piper mode=pinned seed=12345/);
});
