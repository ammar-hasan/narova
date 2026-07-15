'use strict';
/* Headless-Chrome keyframe capture. Screenshots record.html at word-onset times
 * (LEARNINGS #12). Hang-proof: per-shot timeout + detached process group kill,
 * then re-shoot missing/zero-byte frames (LEARNINGS #13/#14). */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ensureDir } = require('../util');
const { detectChrome } = require('./chrome');

const SHOT_TIMEOUT_MS = 45000;
const MIN_BYTES = 2000;

/* Global keyframe times: each scene start + every word onset (LEARNINGS #12).
 * sceneIds must be in playback order; timings is {id:{dur,turns,words}}. */
function keyframeTimes(timings, sceneIds) {
  let acc = 0;
  const times = [];
  for (const id of sceneIds) {
    const t = timings[id];
    if (!t) continue;
    times.push(round(acc + 0.01));
    for (const w of t.words) times.push(round(acc + w.t0 + 0.01));
    acc += t.dur;
  }
  const total = acc;
  const uniq = [...new Set(times.filter(x => x < total))].sort((a, b) => a - b);
  return { times: uniq, total };
}

const round = n => Math.round(n * 1000) / 1000;
const frameFile = (dir, i) => path.join(dir, `${String(i).padStart(6, '0')}.png`);
const bad = p => { try { return fs.statSync(p).size < MIN_BYTES; } catch { return true; } };

/* One screenshot. Resolves even if Chrome hangs after writing the PNG. */
function shot(chrome, recordUrl, t, out, size) {
  return new Promise(resolve => {
    const args = [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      '--disable-dev-shm-usage', '--disable-extensions', '--mute-audio',
      '--force-device-scale-factor=1', `--window-size=${size.w},${size.h}`,
      '--virtual-time-budget=340', `--screenshot=${out}`,
      `${recordUrl}?t=${t.toFixed(3)}`,
    ];
    let done = false;
    const child = spawn(chrome, args, { stdio: 'ignore', detached: true });
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* group gone */ }
      finish(); // PNG is written before Chrome hangs
    }, SHOT_TIMEOUT_MS);
    child.on('exit', finish);
    child.on('error', finish);
  });
}

/* Capture all keyframes into framesDir with a worker pool. Returns {times,total}. */
async function capture(recordHtmlPath, timings, sceneIds, size, framesDir, opts = {}) {
  const chrome = opts.chrome || detectChrome();
  if (!chrome) throw new Error('Chrome not found — set $CHROME or install Google Chrome');
  ensureDir(framesDir);
  const { times, total } = keyframeTimes(timings, sceneIds);
  if (times.length === 0) throw new Error('no keyframe times — is timings.json populated?');
  const recordUrl = 'file://' + path.resolve(recordHtmlPath);
  const workers = Math.max(1, opts.workers || 10);

  const log = opts.log || (() => {});
  log(`capturing ${times.length} keyframes across ${total.toFixed(1)}s (workers=${workers})`);

  // Worker pool over the index range.
  let next = 0, doneCount = 0;
  async function worker() {
    while (next < times.length) {
      const i = next++;
      await shot(chrome, recordUrl, times[i], frameFile(framesDir, i), size);
      doneCount++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, times.length) }, worker));

  // Re-shoot missing / zero-byte frames (LEARNINGS #13/#14).
  let retry = times.map((_, i) => i).filter(i => bad(frameFile(framesDir, i)));
  if (retry.length) {
    log(`re-shooting ${retry.length} bad frames`);
    for (const i of retry) await shot(chrome, recordUrl, times[i], frameFile(framesDir, i), size);
  }
  const missing = times.map((_, i) => i).filter(i => bad(frameFile(framesDir, i)));
  log(`captured ${times.length - missing.length}/${times.length} frames` +
    (missing.length ? `  STILL-BAD ${missing.slice(0, 5)}` : ''));
  if (missing.length) throw new Error(`${missing.length} frames could not be captured (would truncate the MP4)`);

  return { times, total };
}

module.exports = { capture, keyframeTimes };
