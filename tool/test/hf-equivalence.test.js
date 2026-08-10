'use strict';
/* The real HyperFrames full-vs-selective decoded-frame equivalence test.
 *
 * This is the test that should have existed first. It renders the SAME scene
 * two ways and compares actual decoded pixels:
 *   1. a clean full project render (global timeline)
 *   2. an isolated per-scene render of scene 2 (timeline rebased to t=0)
 * and asserts the frame for scene 2 at the same RELATIVE offset matches.
 *
 * Before the v0.26 fixes, the isolated render of a non-first scene produced a
 * WRONG frame: the Three.js canvas never animated (its driver tween was
 * scheduled at the global scene start, beyond the isolated project duration),
 * the marker-triggered element never appeared (markers were not rebased), and
 * scene-local turns were corrupted. This test guards all three at the pixel
 * level — the unit tests in selective-render.test.js prove the timeline
 * coordinates; this one proves the rendered output.
 *
 * Slow + requires HyperFrames + ffmpeg + a canvas implementation. Skipped
 * automatically when any are unavailable so CI without a browser still passes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { resolveConfig } = require('../src/schema');
const { compose, composeSceneProject } = require('../src/compose');

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
let HAS_CANVAS = false;
try { require.resolve('@napi-rs/canvas'); HAS_CANVAS = true; } catch {}

// HyperFrames is invoked through npx and needs network for the first browser
// download. Probe once; skip the whole file if it is unavailable.
function hfAvailable() {
  const r = spawnSync('npx', ['--yes', 'hyperframes@0.7.96', '--version'], {
    encoding: 'utf8', timeout: 60000,
  });
  return r.status === 0 && /0\.7\.96/.test(r.stdout || '');
}
const HAS_HF = HAS_FFMPEG && HAS_CANVAS && hfAvailable();

function silentWav(file, secs) {
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(secs), file]);
}

/* Opaque full-bleed background per scene so a later scene fully covers an
 * earlier one in the full render (no bleed-through at the comparison frame). */
function opaqueBg(color) {
  return `<div style="position:absolute;inset:0;background:${color}"></div>`;
}

function buildProject(outDir) {
  fs.mkdirSync(path.join(outDir, 'audio'), { recursive: true });
  silentWav(path.join(outDir, 'audio', 'full.wav'), 6);
  fs.writeFileSync(path.join(outDir, 'timings.json'), JSON.stringify({
    total: 5,
    s1: { dur: 2, turns: [0.2], words: [{ w: 'One.', t0: 0.2, t1: 0.6, si: 0 }] },
    s2: { dur: 3, turns: [0.2], words: [{ w: 'Two.', t0: 0.2, t1: 0.6, si: 0 }] },
  }));
  return resolveConfig({
    title: 'HFEquiv', size: '16:9', markers: { reveal: 3.5 }, captions: false,
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [
      { id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }],
        body: `${opaqueBg('#1a2030')}<h1 style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:90px;margin:0">ONE</h1>` },
      { id: 's2', dur: 3, vo: [{ who: 'a', text: 'Two.' }],
        body: `${opaqueBg('#241030')}<p class="cue" data-cue="marker:reveal" style="position:absolute;top:12%;left:0;right:0;text-align:center;color:#fff;font-size:64px;font-weight:800;margin:0">REVEALED</p>`,
        three: { camera: { position: [0, 0, 5] }, lights: [{ type: 'ambient', intensity: 1.2 }],
          objects: [{ type: 'cube', size: 1.4, color: '#ffcc33', animate: [
            { property: 'rotation.y', from: 0, to: 6.28, duration: 2, at: 0.5 }] }] } },
    ],
  }, {}, outDir);
}

function hfRender(projectDir, outFile, fps) {
  const r = spawnSync('npx', ['--yes', 'hyperframes@0.7.96', 'render',
    '--output', path.resolve(outFile), '--fps', String(fps), '--quality', 'standard'],
  { cwd: projectDir, encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0 || !fs.existsSync(outFile)) {
    throw new Error(`HF render failed: ${(r.stderr || r.stdout || '').slice(0, 500)}`);
  }
}

function extractFrame(mp4, atSec, pngOut) {
  // -ss before -i for speed; input seek is accurate enough at whole seconds.
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(atSec),
    '-i', mp4, '-frames:v', '1', '-vf', 'scale=1280:720', pngOut]);
  if (!fs.existsSync(pngOut)) throw new Error('frame extract failed');
}

async function pixelStats(aPng, bPng) {
  const { loadImage, createCanvas } = require('@napi-rs/canvas');
  const load = async (f) => {
    const img = await loadImage(fs.readFileSync(f));
    const c = createCanvas(1280, 720);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 1280, 720);
    return ctx.getImageData(0, 0, 1280, 720).data;
  };
  const a = await load(aPng), b = await load(bPng);
  let sum = 0, mismatches = 0;
  const px = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    sum += d / 3;
    if (d / 3 > 8) mismatches++; // per-pixel tolerance for aa/encoding
  }
  return { meanDiff: sum / px, mismatchRatio: mismatches / px };
}

test('HyperFrames: isolated scene-2 frame matches full render at the same relative time', { timeout: 300000 }, async () => {
  if (!HAS_HF) { test.skip('HyperFrames + ffmpeg + @napi-rs/canvas required'); return; }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-hfeq-'));
  try {
    const cfg = buildProject(out);
    const fps = 12;

    // 1) clean full render
    const full = compose(cfg, out);
    const fullMp4 = path.join(out, 'full.mp4');
    hfRender(full.dir, fullMp4, fps);

    // 2) isolated scene-2 render
    const span = composeSceneProject(cfg, out, 1);
    const spanMp4 = path.join(out, 'span.mp4');
    hfRender(span.dir, spanMp4, fps);

    // Duration sanity: full is the whole project (5s), span is scene 2 only (3s).
    const probe = (f) => +spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=nk=1:nw=1', f], { encoding: 'utf8' }).stdout.trim();
    assert.ok(Math.abs(probe(fullMp4) - 5) < 0.2, 'full render ~5s');
    assert.ok(Math.abs(probe(spanMp4) - 3) < 0.2, 'span render ~3s (scene 2)');

    // Compare the frame at 2.0s INTO scene 2 (= global 4.0s in the full render).
    // By then: the entrance transition has settled, the marker element has
    // revealed (marker fires at local 1.5 / global 3.5), and the cube is mid-
    // rotation at the SAME angle in both (0.75 through its 2s tween).
    const localT = 2.0, globalT = 4.0;
    const fullPng = path.join(out, 'full.png'), spanPng = path.join(out, 'span.png');
    extractFrame(fullMp4, globalT, fullPng);
    extractFrame(spanMp4, localT, spanPng);

    const stats = await pixelStats(fullPng, spanPng);
    // Tolerance: HF is deterministic, but two separate encodes of two projects
    // differ slightly in anti-aliasing / text raster. Require a low mean diff
    // AND that almost no pixel exceeds the per-pixel threshold.
    assert.ok(stats.meanDiff < 2.0,
      `mean pixel diff too high: ${stats.meanDiff.toFixed(3)} (full vs isolated should match)`);
    assert.ok(stats.mismatchRatio < 0.01,
      `too many mismatched pixels: ${(stats.mismatchRatio * 100).toFixed(2)}% (marker/three may not have fired)`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
