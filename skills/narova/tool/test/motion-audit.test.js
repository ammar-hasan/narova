'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { auditMotion, parseIntervals, formatMotionAudit } = require('../src/motion-audit');

test('motion audit parses FFmpeg freeze and black intervals', () => {
  const log = '[freezedetect] freeze_start:2.1\n[freezedetect] freeze_end:4.6\n[blackdetect] black_start:8 black_end:9 black_duration:1';
  const freeze = parseIntervals(log, 'freeze');
  assert.equal(freeze[0].start, 2.1);
  assert.equal(freeze[0].end, 4.6);
  assert.ok(Math.abs(freeze[0].duration - 2.5) < 1e-9);
  assert.deepEqual(parseIntervals(log, 'black'), [{ start: 8, end: 9, duration: 1 }]);
});

test('motion audit formatter distinguishes clean and failed output', () => {
  assert.match(formatMotionAudit({ ok: true, freezes: [], black: [], freezeSeconds: 2, blackSeconds: 0.5 }), /pass/);
  assert.match(formatMotionAudit({ ok: false, freezes: [{}], black: [{}], freezeSeconds: 2, blackSeconds: 0.5 }), /FAIL/);
});

test('motion audit does not classify ordinary colored frames as black', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-motion-'));
  try {
    const red = path.join(dir, 'red.mp4');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', red]);
    const report = auditMotion(red, { freezeSeconds: 2, blackSeconds: 0.2 });
    assert.equal(report.black.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('motion audit detects a genuinely black segment', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-motion-black-'));
  try {
    const black = path.join(dir, 'black.mp4');
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', black]);
    const report = auditMotion(black, { freezeSeconds: 2, blackSeconds: 0.2 });
    assert.ok(report.black.length >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
