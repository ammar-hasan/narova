'use strict';
/* CHANGE-2026-017 — agent-observability conformance tests.
 *
 * Every test here asserts one of the accepted requirement scenarios:
 *   NAR-004-021  multi-clip render failure attribution (probe module)
 *   NAR-004-022  selective-render downgrade visibility (see check.test.js)
 *   NAR-007-023  clip coverage summary
 *   NAR-007-024  owner-review evidence artifacts
 *   NAR-017-018  empty-derivation caption guard
 *   NAR-017-057  caption sidecar release check (see check.test.js additions)
 *   NAR-018-068  delivery-control capability disclosure
 *   NAR-018-069  unsupported-markup advisory (see check.test.js additions)
 * All of them advisory except 017-057; none of them reject a project. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeCaptions } = require('../src/captions');
const { clipCoverage, formatCoverage, contactSheet, termExcerpts } = require('../src/review-evidence');
const { DELIVERY_CAPABILITIES, MARKUP_FAMILIES, deliveryCapabilitiesFor } = require('../src/tts-backends');
const { probeProjectClips, attributionDiagnostic } = require('../src/clip-probe');
const { resolveConfig } = require('../src/schema');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'narova-obs-'));

const baseScene = id => ({ id, body: `<p data-cue="0">${id}</p>`, vo: [{ who: 'a', text: `scene ${id}` }] });
const baseConfig = scenes => resolveConfig({
  width: 100, height: 100, fps: 30,
  voices: { a: { backend: 'piper', speaker: 'x' } },
  scenes: scenes.map(baseScene),
});

/* ---- NAR-007-023 — clip coverage summary ---------------------------------- */

/* resolveConfig checks clip existence, so tests create placeholder files. */
const clipProject = (dir, clipsPerScene) => {
  const scenes = [];
  clipsPerScene.forEach((clipName, i) => {
    const file = path.join(dir, clipName);
    fs.writeFileSync(file, 'x');
    scenes.push({ id: `s${i}`, body: `<p data-cue="0">${i}</p>`, vo: [{ who: 'a', text: 'x' }], clip: file });
  });
  return resolveConfig({
    width: 100, height: 100, fps: 30,
    voices: { a: { backend: 'piper', speaker: 'x' } },
    scenes,
    projectDir: dir,
  });
};

test('coverage summary lists every clip with using-scenes and descending reuse', () => {
  const dir = tmp();
  const config = clipProject(dir, ['c0.mp4', 'c1.mp4', 'c2.mp4', 'c0.mp4', 'c1.mp4', 'c2.mp4', 'c0.mp4', 'c1.mp4', 'c2.mp4']);
  const rows = clipCoverage(config);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.beats === 3));
  assert.deepEqual(rows[0].scenes, ['s0', 's3', 's6']);
  const text = formatCoverage(rows);
  assert.match(text, /clip coverage \(advisory/);
  assert.match(text, /reuse is a creative choice/);
});

test('coverage summary is descending by reuse', () => {
  const dir = tmp();
  const config = clipProject(dir, ['one.mp4', 'one.mp4', 'one.mp4', 'two.mp4']);
  const rows = clipCoverage(config);
  assert.ok(rows[0].clip.endsWith('one.mp4'));
  assert.equal(rows[0].beats, 3);
  assert.equal(rows[1].beats, 1);
});

/* ---- NAR-007-024 — evidence artifacts are advisory and render-free --------- */

test('contact sheet reports the no-build reason instead of invoking a renderer', () => {
  const dir = tmp();
  const config = baseConfig(['s1', 's2']);
  const timings = { s1: { dur: 1 }, s2: { dur: 1 } };
  const out = contactSheet(config, dir, timings);
  assert.equal(out.sheet, null);
  assert.ok(/run a build first/.test(out.reason));
});

test('term excerpts report not-found terms and produce the rest', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  // A real 1s WAV so the ffmpeg cut succeeds (fake bytes would fail the cut).
  const full = path.join(dir, 'audio', 'full.wav');
  require('node:child_process').spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:sample_rate=16000:duration=1', '-c:a', 'pcm_s16le', full]);
  const timings = { s1: { dur: 1, words: [{ w: 'Marjaiyyah', t0: 0.1, t1: 0.5, si: 0, who: 'a' }] } };
  const config = baseConfig(['s1']);
  const result = termExcerpts(config, dir, timings, ['Marjaiyyah', 'Sistani']);
  assert.deepEqual(result.notFound, ['Sistani']);
  // ffmpeg cuts from the existing full.wav at existing word times — no synth.
  assert.equal(result.excerpts.length, 1);
  assert.match(result.excerpts[0].file, /Marjaiyyah\.wav$/);
});

/* ---- NAR-017-018 — empty-derivation caption guard -------------------------- */

test('writeCaptions omits sidecars and records the reason on empty derivation with audio', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio', 'full.wav'), 'x');
  fs.writeFileSync(path.join(dir, 'timings.json'), JSON.stringify({ s1: { dur: 1 } }));
  fs.writeFileSync(path.join(dir, 'captions.srt'), ''); // stale empty sidecar from an old build
  const config = baseConfig(['s1']);
  const result = writeCaptions(config, dir);
  assert.equal(result.omitted, true);
  assert.ok(result.reason.includes('empty sentence set'));
  assert.ok(fs.existsSync(path.join(dir, 'captions-omitted.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'captions.srt')), 'empty sidecar must not be published');
  assert.ok(!fs.existsSync(path.join(dir, 'captions.vtt')));
  const marker = JSON.parse(fs.readFileSync(path.join(dir, 'captions-omitted.json'), 'utf8'));
  assert.equal(typeof marker.reason, 'string');
});

test('writeCaptions clears a stale omission marker on a normal derivation', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio', 'full.wav'), 'x');
  fs.writeFileSync(path.join(dir, 'timings.json'), JSON.stringify({
    s1: { dur: 1, words: [{ w: 'hello', t0: 0.1, t1: 0.4, si: 0, who: 'a' }] },
  }));
  fs.writeFileSync(path.join(dir, 'captions-omitted.json'), '{"reason":"stale"}');
  const config = baseConfig(['s1']);
  const result = writeCaptions(config, dir);
  assert.equal(result.omitted, undefined);
  assert.ok(result.cues >= 1);
  assert.ok(!fs.existsSync(path.join(dir, 'captions-omitted.json')), 'stale marker must be cleared');
  assert.ok(fs.statSync(path.join(dir, 'captions.srt')).size > 0);
});

/* ---- NAR-018-068 — capability disclosure ------------------------------------ */

test('built-in backends declare delivery capabilities', () => {
  assert.equal(DELIVERY_CAPABILITIES.qwen['delivery-instruct'], 'honored');
  assert.equal(DELIVERY_CAPABILITIES.piper['delivery-instruct'], 'ignored');
  assert.equal(deliveryCapabilitiesFor('qwen')['non-latin-script'], 'honored');
});

test('an unknown backend reports as unknown, never inferred', () => {
  assert.equal(deliveryCapabilitiesFor('nope'), null);
  assert.equal(deliveryCapabilitiesFor('mystery', () => null), null);
});

test('an external provider declaration is surfaced through the lookup', () => {
  const manifest = { deliveryCapabilities: { 'pronunciation-markup': 'ignored' } };
  const caps = deliveryCapabilitiesFor('elevenlabs', () => manifest);
  assert.equal(caps['pronunciation-markup'], 'ignored');
  assert.equal(caps['delivery-instruct'], undefined); // undeclared family: reads as unknown upstream
});

/* ---- NAR-004-021 — probe attribution (module level; render wiring asserted
 * in renderers.test.js fixtures) --------------------------------------------- */

test('attribution diagnostic names the stage, flagged clip, and retry count', () => {
  const probes = {
    clips: [{ sceneId: 's7', ref: 'assets/bad.mp4', ok: false, detail: 'moov atom not found' }],
    missing: [],
  };
  const text = attributionDiagnostic('render stage: engine video preprocessing', probes, 0, 'hyperframes render exited 1');
  assert.match(text, /engine video preprocessing/);
  assert.match(text, /assets\/bad\.mp4/);
  assert.match(text, /moov atom not found/);
  assert.match(text, /render attempts by narova: 0/);
  assert.match(text, /hyperframes render exited 1/);
});

test('probeProjectClips separates missing files from probe failures', () => {
  const dir = tmp();
  const good = path.join(dir, 'good.mp4');
  fs.writeFileSync(good, 'not really a video');
  const config = { scenes: [
    { id: 'a', clip: good },
    { id: 'b', clip: path.join(dir, 'gone.mp4') },
  ] };
  const probes = probeProjectClips(config, dir);
  assert.equal(probes.missing.length, 1);
  assert.equal(probes.clips.length, 1);
  assert.equal(probes.clips[0].ok, false); // ffprobe rejects the fake bytes
});
