'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  PRESETS, PLATFORM_TO_PRESET, presetFor, presetsFor,
  buildFfmpegArgs, generateThumbnail,
} = require('../src/exports');

// ---- preset catalog ---------------------------------------------------------

test('PRESETS includes all documented platforms', () => {
  const ids = Object.keys(PRESETS);
  assert.ok(ids.includes('youtube-1080p'));
  assert.ok(ids.includes('tiktok-1080p'));
  assert.ok(ids.includes('reels-1080p'));
  assert.ok(ids.includes('shorts-1080p'));
  assert.ok(ids.includes('linkedin-1080p'));
  assert.ok(ids.includes('x-1080p'));
  assert.ok(ids.includes('narova-standard'));
});

test('PRESETS carry required fields', () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    assert.ok(typeof p.label === 'string', `preset ${id} missing label`);
    assert.ok(Number.isFinite(p.width), `preset ${id} missing width`);
    assert.ok(Number.isFinite(p.height), `preset ${id} missing height`);
    assert.ok(Number.isFinite(p.fps), `preset ${id} missing fps`);
    assert.ok(p.enc && typeof p.enc === 'object', `preset ${id} missing enc`);
    assert.ok(p.enc.codec, `preset ${id} missing enc.codec`);
    assert.ok(p.enc.videoBitrate, `preset ${id} missing enc.videoBitrate`);
  }
});

test('PLATFORM_TO_PRESET maps all legacy platforms', () => {
  assert.equal(PLATFORM_TO_PRESET.tiktok, 'tiktok-1080p');
  assert.equal(PLATFORM_TO_PRESET.shorts, 'shorts-1080p');
  assert.equal(PLATFORM_TO_PRESET.reels, 'reels-1080p');
  assert.equal(PLATFORM_TO_PRESET.linkedin, 'linkedin-1080p');
  assert.equal(PLATFORM_TO_PRESET.x, 'x-1080p');
  assert.equal(PLATFORM_TO_PRESET.youtube, 'youtube-1080p');
});

test('presetFor returns a valid preset for known ids', () => {
  const p = presetFor('tiktok-1080p');
  assert.equal(p.label, 'TikTok 1080p');
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1920);
});

test('presetFor falls back to narova-standard for unknown ids', () => {
  const p = presetFor('unknown-preset');
  assert.equal(p.label, 'Narova Standard 720p');
});

test('presetsFor includes narova-standard always', () => {
  const list = presetsFor({});
  assert.ok(list.some(d => d.id === 'narova-standard'));
});

test('presetsFor adds platform preset when config.platform is set', () => {
  const list = presetsFor({ platform: 'tiktok' });
  assert.ok(list.some(d => d.id === 'tiktok-1080p'));
  assert.ok(list.some(d => d.id === 'narova-standard'));
});

test('presetsFor with no platform returns only standard', () => {
  const list = presetsFor({ platform: null });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'narova-standard');
});

// ---- ffmpeg argument-level assertions ------------------------------------

test('buildFfmpegArgs youtube-1080p: h264, bitrate, loudnorm, faststart', () => {
  const a = buildFfmpegArgs('/tmp/in.mp4', '/tmp/out.mp4', PRESETS['youtube-1080p']);
  assert.ok(a.includes('-y'), 'should have -y');
  assert.ok(a.includes('-i'), 'should have -i');
  assert.ok(a.includes('/tmp/in.mp4'), 'should include input path');
  assert.ok(a.includes('-c:v'), 'should have video codec flag');
  assert.ok(a.includes('libx264'), 'should use libx264');
  assert.ok(a.includes('-b:v'), 'should have bitrate flag');
  assert.ok(a.includes('8M'), 'should have 8M bitrate');
  assert.ok(a.includes('-af'), 'should have audio filter');
  const afIdx = a.indexOf('-af');
  assert.ok(a[afIdx + 1].includes('loudnorm'), `loudnorm not found: ${a[afIdx + 1]}`);
  assert.ok(a[afIdx + 1].includes('I=-14'), 'should target -14 LUFS');
  assert.ok(a.includes('-movflags'));
  assert.ok(a.includes('+faststart'));
  assert.ok(a[a.length - 1] === '/tmp/out.mp4', 'output path should be last');
});

test('buildFfmpegArgs narova-standard: no loudnorm, no CRF', () => {
  const a = buildFfmpegArgs('/tmp/in.mp4', '/tmp/out.mp4', PRESETS['narova-standard']);
  assert.ok(a.includes('-b:v'), 'should have bitrate flag');
  assert.ok(!a.includes('-crf'), 'should NOT use CRF');
  assert.ok(!a.some(x => x.includes('loudnorm')), 'narova-standard should NOT have loudnorm');
});

test('buildFfmpegArgs tiktok-1080p: safeArea drawbox', () => {
  const a = buildFfmpegArgs('/tmp/in.mp4', '/tmp/out.mp4', PRESETS['tiktok-1080p']);
  assert.ok(a.includes('-vf'), 'should have video filter for safe area');
  const vfIdx = a.indexOf('-vf');
  assert.ok(a[vfIdx + 1].includes('drawbox'), `drawbox not found: ${a[vfIdx + 1]}`);
});

test('buildFfmpegArgs linkedin-1080p: louder loudness target', () => {
  const a = buildFfmpegArgs('/tmp/in.mp4', '/tmp/out.mp4', PRESETS['linkedin-1080p']);
  const afIdx = a.indexOf('-af');
  assert.ok(a[afIdx + 1].includes('loudnorm'), 'linkedin should have loudnorm');
  assert.ok(a[afIdx + 1].includes('I=-16'), 'linkedin should target -16 LUFS');
});

test('buildFfmpegArgs handles missing enc gracefully', () => {
  const minimal = { enc: {}, hf: { format: 'mp4' }, width: 640, height: 480, fps: 30, label: 'test' };
  const a = buildFfmpegArgs('/tmp/in.mp4', '/tmp/out.mp4', minimal);
  assert.ok(a.includes('-c:v'), 'should have codec fallback');
  assert.ok(a.includes('-c:a'), 'should have audio codec');
});

test('thumbnail presets have valid dimensions', () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    if (!p.thumbnail) continue;
    assert.ok(Number.isFinite(p.thumbnail.width), `${id} thumbnail missing width`);
    assert.ok(p.thumbnail.width > 0, `${id} thumbnail width must be positive`);
    assert.ok(Number.isFinite(p.thumbnail.at), `${id} thumbnail missing at`);
  }
});

// ---- deliverable dimensions -------------------------------------------------

test('vertical presets have height > width', () => {
  const verticals = ['tiktok-1080p', 'reels-1080p', 'shorts-1080p', 'x-1080p'];
  for (const id of verticals) {
    const p = PRESETS[id];
    assert.ok(p.height > p.width, `${id} should be vertical`);
  }
});

test('square preset has equal dimensions', () => {
  const p = PRESETS['linkedin-1080p'];
  assert.equal(p.width, p.height);
});

test('landscape presets have width > height', () => {
  const p = PRESETS['youtube-1080p'];
  assert.ok(p.width > p.height, 'youtube-1080p should be landscape');
});

test('safe-area presets have safeArea configured', () => {
  const p = PRESETS['tiktok-1080p'];
  assert.ok(p.enc.safeArea, 'tiktok should have safeArea');
  assert.ok(p.enc.safeArea.top > 0);
  assert.ok(p.enc.safeArea.bottom > 0);
});

// ---- round-trip -------------------------------------------------------------

test('every preset produces a valid id round-trip', () => {
  for (const id of Object.keys(PRESETS)) {
    const p = presetFor(id);
    assert.equal(typeof p.label, 'string');
    assert.equal(typeof p.width, 'number');
  }
});
