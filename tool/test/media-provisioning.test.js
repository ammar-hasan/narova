'use strict';
/* NAR-SPEC-021 media-provisioning tests (NAR-021-002/003/007/008).
 * Multi-asset pins are exercised against a local HTTP server. The real
 * Linux assets are exercised end-to-end by the clean-machine CI demo run. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { PassThrough } = require('node:stream');
const readiness = require('../src/readiness');
const acquisition = require('../src/acquisition');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'narova-media-')); }

function server(routes) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => routes(req, res));
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

class Sink extends PassThrough {
  constructor() { super(); this.chunks = []; this.on('data', (c) => this.chunks.push(c.toString())); }
  get isTTY() { return false; }
  text() { return this.chunks.join(''); }
}

function fixtureAssets() {
  const raw = {
    ffmpeg: Buffer.from('#!/bin/sh\necho "ffmpeg version fixture"\n'),
    ffprobe: Buffer.from('#!/bin/sh\necho "ffprobe version fixture"\n'),
    LICENSE: Buffer.from('fixture license\n'),
  };
  return Object.fromEntries(Object.entries(raw).map(([name, bytes]) => {
    const compressed = gzipSync(bytes);
    return [name, {
      compressed,
      sha256: crypto.createHash('sha256').update(compressed).digest('hex'),
      bytes: compressed.length,
    }];
  }));
}

function pinFrom(base, assets, overrides = {}) {
  const files = Object.entries(assets).map(([name, asset]) => ({
    name,
    url: `${base}/${name}.gz`,
    sha256: asset.sha256,
    bytes: asset.bytes,
  }));
  return { id: 'ffmpeg-static-fixture', bytes: files.reduce((n, file) => n + file.bytes, 0), files, ...overrides };
}

async function serveAssets(assets) {
  return server((req, res) => {
    const name = decodeURIComponent(req.url.slice(1)).replace(/\.gz$/, '');
    const asset = assets[name];
    if (!asset) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-length': asset.compressed.length });
    res.end(asset.compressed);
  });
}

test('provisionMedia verifies members, validates binaries, commits atomically, and is idempotent (NAR-021-003/007)', async () => {
  const home = tmp();
  const assets = fixtureAssets();
  const { srv, base } = await serveAssets(assets);
  process.env.NAROVA_HOME = home;
  try {
    const view = new readiness.ProgressView(new Sink());
    const pin = pinFrom(base, assets);
    const first = await acquisition.provisionMedia(view, pin);
    const root = acquisition.mediaInstallDir(pin);
    assert.equal(first.reused, false);
    assert.equal(first.acquired, pin.bytes);
    assert.ok(fs.existsSync(path.join(root, 'bin', 'ffmpeg')));
    assert.ok(fs.existsSync(path.join(root, 'bin', 'ffprobe')));
    assert.equal(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), 'fixture license\n');
    assert.ok(acquisition.mediaMarkerOk(root, pin));
    assert.ok(!fs.existsSync(`${root}.staging-${process.pid}`), 'staging removed');

    const second = await acquisition.provisionMedia(view, pin);
    assert.equal(second.reused, true);
    assert.equal(second.acquired, 0);

    fs.writeFileSync(path.join(root, 'LICENSE'), '');
    assert.equal(acquisition.mediaMarkerOk(root, pin), false, 'missing license bytes invalidate the install');
    fs.writeFileSync(path.join(root, '.narova-pin.json'), JSON.stringify({ schema: 2, id: pin.id, files: [] }));
    const third = await acquisition.provisionMedia(view, pin);
    assert.equal(third.reused, false);
    assert.ok(acquisition.mediaMarkerOk(root, pin));
  } finally {
    srv.close();
    delete process.env.NAROVA_HOME;
  }
});

test('digest failure leaves no new install or staging (NAR-021-003)', async () => {
  const home = tmp();
  const assets = fixtureAssets();
  const { srv, base } = await serveAssets(assets);
  process.env.NAROVA_HOME = home;
  try {
    const pin = pinFrom(base, assets);
    pin.files[0].sha256 = '0'.repeat(64);
    await assert.rejects(
      () => acquisition.provisionMedia(new readiness.ProgressView(new Sink()), pin),
      /digest mismatch/,
    );
    const root = acquisition.mediaInstallDir(pin);
    assert.ok(!fs.existsSync(root), 'no install dir');
    assert.ok(!fs.existsSync(`${root}.staging-${process.pid}`), 'no staging dir');
  } finally {
    srv.close();
    delete process.env.NAROVA_HOME;
  }
});

test('failed refresh preserves the prior verified install (NAR-021-003)', async () => {
  const home = tmp();
  const assets = fixtureAssets();
  const { srv, base } = await serveAssets(assets);
  process.env.NAROVA_HOME = home;
  try {
    const good = pinFrom(base, assets);
    await acquisition.provisionMedia(new readiness.ProgressView(new Sink()), good);
    const broken = structuredClone(good);
    broken.files[1].sha256 = '0'.repeat(64);
    await assert.rejects(
      () => acquisition.provisionMedia(new readiness.ProgressView(new Sink()), broken),
      /digest mismatch/,
    );
    assert.ok(acquisition.mediaMarkerOk(acquisition.mediaInstallDir(good), good));
  } finally {
    srv.close();
    delete process.env.NAROVA_HOME;
  }
});

test('missing or invalid binary fails cleanly with no resolvable install', async () => {
  const home = tmp();
  const assets = fixtureAssets();
  delete assets.ffprobe;
  const { srv, base } = await serveAssets(assets);
  process.env.NAROVA_HOME = home;
  try {
    const pin = pinFrom(base, assets);
    await assert.rejects(
      () => acquisition.provisionMedia(new readiness.ProgressView(new Sink()), pin),
      /must contain exactly ffmpeg, ffprobe, and LICENSE/,
    );
    assert.ok(!fs.existsSync(acquisition.mediaInstallDir(pin)));
  } finally {
    srv.close();
    delete process.env.NAROVA_HOME;
  }
});

test('unpinned platform fails closed with guidance, never downloads (NAR-021-002/003)', async () => {
  assert.equal(acquisition.mediaPinFor('sunos', 'x64'), null);
  if (acquisition.mediaPinFor() === null) {
    await assert.rejects(
      () => acquisition.provisionMedia(),
      (err) => err.code === 'NAROVA_MEDIA_UNPINNED' && /failing closed/.test(err.message),
    );
  }
});

test('recorded Linux pins carry complete retained release identities', () => {
  for (const [key, pin] of Object.entries(acquisition.MEDIA_PINS)) {
    assert.match(key, /^linux-(x64|arm64)$/);
    assert.match(pin.id, /^ffmpeg-static-b6\.1\.1-linux-(x64|arm64)$/);
    assert.deepEqual(pin.files.map((file) => file.name), ['ffmpeg', 'ffprobe', 'LICENSE']);
    assert.equal(pin.bytes, pin.files.reduce((n, file) => n + file.bytes, 0));
    for (const file of pin.files) {
      assert.match(file.url, /^https:\/\/github\.com\/eugeneware\/ffmpeg-static\/releases\/download\/b6\.1\.1\//);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.ok(file.bytes > 10_000);
    }
  }
});

test('probe reports a binDir for a satisfied provisioned install (warm-run F10)', () => {
  const realPin = acquisition.mediaPinFor();
  if (!realPin) return;
  const home = tmp();
  const saved = {};
  for (const k of ['NAROVA_FFMPEG', 'NAROVA_FFPROBE', 'NAROVA_HOME']) saved[k] = process.env[k];
  process.env.NAROVA_FFMPEG = 'narova-absent-ffmpeg';
  process.env.NAROVA_FFPROBE = 'narova-absent-ffprobe';
  process.env.NAROVA_HOME = home;
  try {
    const root = acquisition.mediaInstallDir(realPin);
    fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(root, 'bin', 'ffmpeg'), '#!/bin/sh\necho "ffmpeg version fixture"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'bin', 'ffprobe'), '#!/bin/sh\necho "ffprobe version fixture"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(root, '.narova-pin.json'), JSON.stringify({
      schema: 2,
      id: realPin.id,
      files: realPin.files.map(({ name, url, sha256, bytes }) => ({ name, url, sha256, bytes })),
    }));
    assert.ok(acquisition.mediaMarkerOk(root, realPin));

    const media = readiness.readinessMatrix().find((item) => item.id === 'media');
    assert.equal(media.status, 'satisfied');
    assert.equal(media.binDir, path.join(root, 'bin'));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
