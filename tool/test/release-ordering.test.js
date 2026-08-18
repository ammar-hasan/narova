'use strict';
/* Release-build sequencing (NAR-009-008, CHANGE-2026-023): captions must
 * publish before the post-synth release gate, so a first-ever release build
 * in a fresh directory satisfies the caption presence rule (narova#25).
 * Real no-browser build with external narration — no python, no network.
 * On the pre-fix ordering this test fails at the post-synth gate. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('child_process');
const { build } = require('../src/pipeline');
const { resolveConfig } = require('../src/schema');

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
let HAS_CANVAS = false;
try { require.resolve('@napi-rs/canvas'); HAS_CANVAS = true; } catch {}
const CAN_RENDER = HAS_FFMPEG && HAS_CANVAS;

test('fresh-directory release build publishes captions before the post-synth gate', { timeout: 60000 }, () => {
  if (!CAN_RENDER) return; // skip when ffmpeg/canvas absent

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-release-ordering-'));
  try {
    // External narration: a 1.2s tone, so no speech backend runs at all.
    const audio = path.join(root, 'narration.wav');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'sine=frequency=330:duration=1.2', '-ar', '48000', '-ac', '1', audio]);
    fs.writeFileSync(path.join(root, 'words.json'), JSON.stringify([
      { start: 0.1, end: 1.1, text: 'Scene one.', words: [
        { text: 'Scene', start: 0.1, end: 0.5 }, { text: 'one.', start: 0.55, end: 1.1 }] },
    ]));

    const cfg = resolveConfig({
      title: 'Release Ordering', renderer: 'no-browser', size: { w: 160, h: 90 },
      narration: { file: 'narration.wav', wordTimings: 'words.json' },
      voices: { a: { speaker: 'custom-file', color: '#2ee6d6' } }, chrome: false,
      scenes: [
        { id: 'one', visual: { type: 'stack', style: { background: '#080d16' }, children: [
          { type: 'text', text: 'ONE', style: { color: '#fff', fontSize: 24 } }] },
          vo: [{ who: 'a', text: 'Scene one.' }], dur: 1.2 },
      ],
    }, {}, root);

    // Fresh output directory: no captions.srt has ever existed here. The
    // post-synth gate requires it, so a non-throwing build that reaches the
    // encoded video proves captions published before the gate ran (the
    // pre-fix ordering throws 'release check failed after measured narration
    // timing' instead — check() prints its own gate lines to stdout).
    const out = path.join(root, 'out');
    const logs = [];
    build(cfg, { out, projectDir: root, release: true, fps: 10, quality: 'draft', log: m => logs.push(m) });

    assert.ok(fs.existsSync(path.join(out, 'captions.srt')), 'captions.srt published');
    assert.ok(fs.existsSync(path.join(out, 'video.mp4')), 'video.mp4 encoded');
    assert.match(logs.join('\n'), /captions -> .*captions\.srt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
