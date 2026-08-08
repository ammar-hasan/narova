'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseIntervals(log, prefix) {
  const starts = [...String(log).matchAll(new RegExp(`${prefix}_start:([0-9.]+)`, 'g'))].map(m => Number(m[1]));
  const ends = [...String(log).matchAll(new RegExp(`${prefix}_end:([0-9.]+)`, 'g'))].map(m => Number(m[1]));
  return starts.map((start, i) => ({ start, end: ends[i] == null ? null : ends[i], duration: ends[i] == null ? null : ends[i] - start }));
}

function auditMotion(file, opts = {}) {
  const freezeSeconds = Number(opts.freezeSeconds || 2);
  const blackSeconds = Number(opts.blackSeconds || 0.5);
  const filter = `freezedetect=n=-50dB:d=${freezeSeconds},blackdetect=d=${blackSeconds}:pix_th=0.02`;
  const result = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', filter, '-an', '-f', 'null', '-'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg motion audit exited ${result.status}: ${(result.stderr || '').trim().split('\n').pop()}`);
  const log = result.stderr || '';
  const freezes = parseIntervals(log, 'freeze');
  const black = parseIntervals(log, 'black');
  return { ok: freezes.length === 0 && black.length === 0, freezes, black, freezeSeconds, blackSeconds };
}

function formatMotionAudit(report) {
  if (report.ok) return `motion audit: pass — no ${report.freezeSeconds}s frozen or ${report.blackSeconds}s black segments`;
  const parts = [];
  if (report.freezes.length) parts.push(`${report.freezes.length} frozen segment(s)`);
  if (report.black.length) parts.push(`${report.black.length} black segment(s)`);
  return `motion audit: FAIL — ${parts.join(', ')}`;
}

function imageFiles(dir) {
  const found = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(?:png|jpe?g)$/i.test(entry.name) && !/contact-sheet/i.test(entry.name)) found.push(full);
    }
  }
  if (fs.existsSync(dir)) visit(dir);
  return found.sort();
}

/* A pilot can be technically valid yet visually empty. Sample-frame luma is
 * deliberately a narrow check: it catches an entire proof rendered near-black
 * while allowing a deliberate black opening if later evidence is visible. */
function auditProofFrames(dir, opts = {}) {
  const threshold = Number(opts.lumaThreshold || 24);
  const failRatio = Number(opts.failRatio || 0.75);
  const frames = imageFiles(dir).map(file => {
    const result = spawnSync('ffmpeg', [
      '-v', 'error', '-i', file, '-vf', 'signalstats,metadata=print:file=-',
      '-frames:v', '1', '-f', 'null', '-',
    ], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`ffmpeg frame audit exited ${result.status}`);
    const match = String(result.stdout || '').match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
    return { file, yavg: match ? Number(match[1]) : null };
  });
  const dark = frames.filter(frame => frame.yavg != null && frame.yavg <= threshold);
  const ratio = frames.length ? dark.length / frames.length : 0;
  return { ok: frames.length > 0 && ratio < failRatio, frames, dark, ratio, threshold, failRatio };
}

function formatProofAudit(report) {
  if (!report.frames.length) return 'proof audit: FAIL — no rendered pilot frames found';
  if (report.ok) return `proof audit: pass — ${report.frames.length - report.dark.length}/${report.frames.length} sampled frames visibly clear the near-black threshold`;
  return `proof audit: FAIL — ${report.dark.length}/${report.frames.length} sampled frames are near-black; the pilot has not provided visible evidence`;
}

module.exports = { auditMotion, formatMotionAudit, auditProofFrames, formatProofAudit, parseIntervals };
