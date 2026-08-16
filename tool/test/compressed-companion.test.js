'use strict';
/* CHANGE-2026-019 — optional compressed companion conformance tests.
 *   NAR-017-058 optional creation, primary untouched, distinct naming
 *   NAR-017-059 deterministic derivation, clamped, defaults, no retries
 *   NAR-017-060 aim/achieved/bitrate evidence; misses never fail
 * All capability + disclosure; zero gates anywhere. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { deriveCompanionParams, parseSizeAim, buildCompanion, COMPANION_DEFAULTS } = require('../src/exports');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'narova-comp-'));
const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/* ---- NAR-017-058 — parsing + naming --------------------------------------- */

test('size aim parses byte and megabyte forms; junk throws with guidance', () => {
  assert.equal(parseSizeAim('60MB'), 60 * 1024 * 1024);
  assert.equal(parseSizeAim('16mb'), 16 * 1024 * 1024);
  assert.equal(parseSizeAim('250000000'), 250000000);
  assert.equal(parseSizeAim('1.5GB'), Math.round(1.5 * 1024 ** 3));
  assert.equal(parseSizeAim(null), null);
  assert.equal(parseSizeAim(true), null); // bare --companion
  assert.throws(() => parseSizeAim('huge'), /must be a size like 60MB/);
});

/* ---- NAR-017-059 — derivation ---------------------------------------------- */

test('derived bitrate is a deterministic pure function and clamped by ceilings', () => {
  const inputs = { aimBytes: 60 * 1024 * 1024, seconds: 444, audioBitrateKbps: 80, maxVideoBitrateKbps: 12000 };
  const a = deriveCompanionParams(inputs);
  const b = deriveCompanionParams({ ...inputs });
  assert.deepEqual(a, b, 'identical inputs derive identical parameters');
  // 60MB over 444s with 80k mono audio → roughly (60M - overhead - 4.4M)/444*8
  const expected = Math.floor(((60 * 1024 * 1024) - (256 * 1024 + Math.round(444 * 2048)) - 10000 * 444) * 8 / 1000 / 444);
  assert.ok(Math.abs(a.videoBitrateKbps - expected) <= 1, `derived ≈ ${expected} (got ${a.videoBitrateKbps})`);
  assert.equal(a.derived, true);
  // A larger aim derives a larger bitrate, still clamped.
  const bigger = deriveCompanionParams({ ...inputs, aimBytes: 80 * 1024 * 1024 });
  assert.ok(bigger.videoBitrateKbps > a.videoBitrateKbps);
  const clamped = deriveCompanionParams({ ...inputs, aimBytes: 10 * 1024 ** 3, maxVideoBitrateKbps: 2000 });
  assert.equal(clamped.videoBitrateKbps, 2000, 'ceiling wins over a huge aim');
});

test('no aim applies the documented quick-review default band', () => {
  const d = deriveCompanionParams({ aimBytes: null, seconds: 100, audioBitrateKbps: 80, maxVideoBitrateKbps: 12000 });
  assert.equal(d.videoBitrateKbps, COMPANION_DEFAULTS.videoBitrate);
  assert.equal(d.derived, false);
});

/* ---- NAR-017-058/060 — creation, naming, evidence -------------------------- */

test('companion is created beside the primary, untouched primary, distinct name, evidence line', { skip: !haveFfmpeg }, () => {
  const dir = tmp();
  const primary = path.join(dir, 'video.mp4');
  // 4s test source at 1280x720.
  const made = spawnSync('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', primary]);
  assert.equal(made.status, 0, 'fixture must encode');
  const primaryBytes = fs.statSync(primary).size;

  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let result;
  try {
    result = buildCompanion(primary, dir, { aim: '1MB' }, { log: (...a) => lines.push(a.join(' ')) });
  } finally { console.log = orig; }

  const companionPath = path.join(dir, 'video-companion.mp4');
  assert.ok(fs.existsSync(companionPath), 'companion exists with the derived name');
  assert.equal(fs.statSync(primary).size, primaryBytes, 'primary untouched');
  assert.equal(result.mp4, companionPath);
  assert.equal(result.aimBytes, 1024 * 1024);
  assert.equal(result.achievedBytes, fs.statSync(companionPath).size);
  const evidence = lines.find(l => l.startsWith('companion ->'));
  assert.ok(evidence, 'evidence line present');
  assert.match(evidence, /aim=1\.0MB/);
  assert.match(evidence, /achieved=\d+(\.\d+)?MB/);
  assert.match(evidence, /video=\d+k/);
  // The evidence reports reality; whatever the achieved size, nothing failed.
  assert.ok(typeof result.achievedBytes === 'number');
});
