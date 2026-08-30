'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  PRESETS, PLATFORM_TO_PRESET, presetFor, presetsFor,
  buildFfmpegArgs, generateThumbnail,
  deliverySourceIdentity, deliveryEncodeIdentity, deliveryThumbnailIdentity,
  buildDeliverables, buildDeliverablesFromSource,
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

test('buildFfmpegArgs tiktok-1080p: safeArea drawbox (when guides enabled)', () => {
  const a = buildFfmpegArgs('/tmp/in.mp4', '/tmp/out.mp4', PRESETS['tiktok-1080p'], { safeAreaGuides: true });
  assert.ok(a.includes('-vf'), 'should have video filter for safe area');
  const vfIdx = a.indexOf('-vf');
  assert.ok(a[vfIdx + 1].includes('drawbox'), `drawbox not found: ${a[vfIdx + 1]}`);
});

test('buildFfmpegArgs tiktok-1080p: no drawbox when guides not requested', () => {
  const a = buildFfmpegArgs('/tmp/in.mp4', '/tmp/out.mp4', PRESETS['tiktok-1080p']);
  const hasDrawbox = a.some(x => x.includes('drawbox'));
  assert.ok(!hasDrawbox, 'safe area guides should NOT be burned in by default');
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

test('safe-area presets have safeArea configured (authoring hint, not default burn-in)', () => {
  const p = PRESETS['tiktok-1080p'];
  assert.ok(p.safeArea, 'tiktok should have safeArea as top-level preset property');
  assert.ok(p.safeArea.top > 0);
  assert.ok(p.safeArea.bottom > 0);
});

// ---- round-trip -------------------------------------------------------------

test('every preset produces a valid id round-trip', () => {
  for (const id of Object.keys(PRESETS)) {
    const p = presetFor(id);
    assert.equal(typeof p.label, 'string');
    assert.equal(typeof p.width, 'number');
  }
});

// ---- execution identity and reuse (NAR-017-061) ---------------------------

test('delivery source identity groups exact render work and separates FPS/resolution', () => {
  const opts = { renderer: 'hyperframes', videoFrameFormat: null };
  const reels = deliverySourceIdentity(PRESETS['reels-1080p'], opts);
  const shorts = deliverySourceIdentity(PRESETS['shorts-1080p'], opts);
  const whatsapp = deliverySourceIdentity(PRESETS['whatsapp-compressed'], opts);
  const fourK = deliverySourceIdentity(PRESETS['youtube-4k'], opts);
  assert.equal(reels, shorts, 'equal 30fps standard natural-resolution sources should group');
  assert.notEqual(reels, whatsapp, '24fps source must remain separate');
  assert.notEqual(reels, fourK, 'high-quality explicit 4K source must remain separate');
  assert.notEqual(reels, deliverySourceIdentity(PRESETS['reels-1080p'], {
    ...opts, videoFrameFormat: 'png',
  }), 'frame extraction format must remain a source dependency');
  assert.notEqual(
    deliverySourceIdentity(PRESETS['reels-1080p'], { ...opts, compositionIdentity: 'A' }),
    deliverySourceIdentity(PRESETS['reels-1080p'], { ...opts, compositionIdentity: 'B' }),
    'resolved composition identity must invalidate cross-build delivery reuse',
  );
});

test('delivery encode identity ignores names but separates active guide treatment', () => {
  const source = deliverySourceIdentity(PRESETS['reels-1080p']);
  const reels = deliveryEncodeIdentity(PRESETS['reels-1080p'], source);
  const shorts = deliveryEncodeIdentity(PRESETS['shorts-1080p'], source);
  const tiktokClean = deliveryEncodeIdentity(PRESETS['tiktok-1080p'], source);
  const tiktokGuides = deliveryEncodeIdentity(PRESETS['tiktok-1080p'], source, { safeAreaGuides: true });
  assert.equal(reels, shorts);
  assert.equal(reels, tiktokClean, 'unused safe-area metadata does not change pixels');
  assert.notEqual(reels, tiktokGuides, 'enabled guides change pixels and must encode separately');
  assert.equal(
    deliveryThumbnailIdentity(PRESETS['reels-1080p'], reels),
    deliveryThumbnailIdentity(PRESETS['shorts-1080p'], shorts),
  );
});

test('multi-member delivery keeps one immutable source and copies exact encodes', () => {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-delivery-reuse-'));
  const source = path.join(dir, 'video.mp4');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=1:r=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source,
  ]);
  const master = path.join(dir, 'master.mp4');
  fs.copyFileSync(source, master);

  const enc = { videoBitrate: '180k', audioBitrate: '48k', sampleRate: 44100,
    loudness: null, codec: 'h264', pixelFormat: 'yuv420p' };
  const hf = { format: 'mp4', quality: 'standard' };
  const presets = [
    { id: 'narova-standard', label: 'standard', hf, width: 160, height: 90, fps: 10, enc, thumbnail: null },
    { id: 'reels-1080p', label: 'reels', hf, width: 90, height: 160, fps: 10, enc, thumbnail: { width: 60, at: 0.1 } },
    { id: 'shorts-1080p', label: 'shorts', hf, width: 90, height: 160, fps: 10, enc, thumbnail: { width: 60, at: 0.1 } },
  ];
  const logs = [];
  const artifacts = [];
  const results = buildDeliverablesFromSource({}, source, dir, {
    name: 'video.mp4', presets, renderer: 'no-browser', sourceIdentity: 'composition-A',
    log: line => logs.push(line), artifact: (file, role) => artifacts.push({ file, role }),
  });

  assert.equal(results.length, 3);
  assert.deepEqual(results.map(r => r.execution.source.status), ['performed', 'reused', 'reused']);
  assert.deepEqual(results.map(r => r.execution.encode.status), ['performed', 'performed', 'reused']);
  assert.equal(results[2].execution.encode.from, 'reels-1080p');
  assert.equal(results[2].execution.source.from, 'narova-standard',
    'encode copying must retain the actual render origin, not name the encode donor');
  assert.equal(results[2].execution.thumbnail.status, 'reused');
  assert.deepEqual(
    fs.readFileSync(results[1].mp4), fs.readFileSync(results[2].mp4),
    'equivalent named members must be byte-identical independent files',
  );
  assert.deepEqual(fs.readFileSync(results[1].thumbnail), fs.readFileSync(results[2].thumbnail));
  assert.ok(results.every(r => fs.statSync(r.mp4).size > 0));
  assert.equal(fs.readdirSync(dir).some(name => name.includes('delivery-source-')), false,
    'immutable internal source staging must be cleaned');
  assert.ok(logs.some(line => line.includes('encode reused')));
  assert.equal(artifacts.filter(item => item.role === 'video').length, 1,
    'the Standard member retains the canonical machine-artifact role');

  const warm = buildDeliverablesFromSource({}, master, dir, {
    name: 'video.mp4', presets, renderer: 'no-browser', sourceIdentity: 'composition-A',
    log: () => {},
  });
  assert.deepEqual(warm.map(r => r.execution.encode), [
    { status: 'reused', from: 'narova-standard', attempt: 'previous-build' },
    { status: 'reused', from: 'reels-1080p', attempt: 'previous-build' },
    { status: 'reused', from: 'reels-1080p' },
  ]);

  fs.appendFileSync(warm[2].mp4, 'tamper');
  const repaired = buildDeliverablesFromSource({}, master, dir, {
    name: 'video.mp4', presets, renderer: 'no-browser', sourceIdentity: 'composition-A',
    log: () => {},
  });
  assert.equal(repaired[2].execution.encode.status, 'reused');
  assert.equal(repaired[2].execution.encode.from, 'reels-1080p',
    'a digest-invalid prior member is replaced from a valid equal member');
  assert.deepEqual(fs.readFileSync(repaired[1].mp4), fs.readFileSync(repaired[2].mp4));

  fs.appendFileSync(repaired[1].mp4, 'tamper-earlier-member');
  const repairedEarlier = buildDeliverablesFromSource({}, master, dir, {
    name: 'video.mp4', presets, renderer: 'no-browser', sourceIdentity: 'composition-A',
    log: () => {},
  });
  assert.equal(repairedEarlier[1].execution.encode.status, 'performed');
  assert.deepEqual(repairedEarlier[2].execution.encode, {
    status: 'reused', from: 'reels-1080p',
  }, 'a later equal member must copy the current-attempt repair, not retain independently encoded prior bytes');
  assert.deepEqual(
    fs.readFileSync(repairedEarlier[1].mp4), fs.readFileSync(repairedEarlier[2].mp4),
    'repairing an earlier equal member must restore byte-identical membership',
  );
});

test('unchanged direct-render presets validate named output before invoking renderer', () => {
  const { execFileSync } = require('child_process');
  const hf = require('../src/hf');
  const originalRunHf = hf.runHf;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-delivery-lazy-source-'));
  const projectDir = path.join(dir, 'hf-project');
  fs.mkdirSync(projectDir);
  const fixture = path.join(dir, 'fixture.mp4');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1:r=10',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=1',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fixture,
  ]);
  let renders = 0;
  hf.runHf = args => {
    renders += 1;
    const output = args[args.indexOf('--output') + 1];
    fs.copyFileSync(fixture, path.resolve(projectDir, output));
  };

  const preset = {
    id: 'whatsapp-compressed', label: 'WhatsApp',
    hf: { format: 'mp4', quality: 'standard' },
    width: 90, height: 160, fps: 24,
    enc: { videoBitrate: '180k', audioBitrate: '48k', sampleRate: 44100,
      loudness: null, codec: 'h264', pixelFormat: 'yuv420p' },
    thumbnail: null,
  };
  try {
    const first = buildDeliverables({}, projectDir, dir, {
      name: 'video.mp4', presets: [preset], compositionIdentity: 'composition-A', log: () => {},
    });
    assert.equal(renders, 1);
    assert.equal(first[0].execution.source.status, 'performed');

    const warm = buildDeliverables({}, projectDir, dir, {
      name: 'video.mp4', presets: [preset], compositionIdentity: 'composition-A', log: () => {},
    });
    assert.equal(renders, 1, 'validated unchanged member must avoid a second renderer call');
    assert.deepEqual(warm[0].execution.source, {
      status: 'reused', from: 'whatsapp-compressed', attempt: 'previous-build',
    });
    assert.deepEqual(warm[0].execution.encode, {
      status: 'reused', from: 'whatsapp-compressed', attempt: 'previous-build',
    });

    buildDeliverables({}, projectDir, dir, {
      name: 'unidentified.mp4', presets: [preset], log: () => {},
    });
    buildDeliverables({}, projectDir, dir, {
      name: 'unidentified.mp4', presets: [preset], log: () => {},
    });
    assert.equal(renders, 3,
      'missing composition identity must remain a safe miss across builds');

    hf.runHf = args => {
      const output = args[args.indexOf('--output') + 1];
      fs.writeFileSync(path.resolve(projectDir, output), 'partial');
      throw new Error('renderer failed');
    };
    assert.throws(() => buildDeliverables({}, projectDir, dir, {
      name: 'failed.mp4', presets: [preset], compositionIdentity: 'composition-B', log: () => {},
    }), /renderer failed/);
    assert.equal(fs.readdirSync(dir).some(name => name.startsWith('.narova-delivery-source-')), false,
      'failed internal source render must be cleaned');
  } finally {
    hf.runHf = originalRunHf;
  }
});
