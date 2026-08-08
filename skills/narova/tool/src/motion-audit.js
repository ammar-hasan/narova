'use strict';

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

module.exports = { auditMotion, formatMotionAudit, parseIntervals };
