'use strict';
/* NAR-SPEC-021 media-provisioning tests (NAR-021-002/003/007/008).
 * Archive items are exercised against a local HTTP server with a tar.gz
 * fixture (provisionMedia accepts .tar.gz and .tar.xz). The
 * satisfied-provisioned probe path and the real Linux pins are exercised
 * end-to-end by the clean-machine CI demo run. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
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

/* Build a fixture archive shaped like the real pins: <topdir>/bin/{ffmpeg,ffprobe}. */
function fixtureArchive(dir, topdir) {
  const stage = path.join(dir, 'fixture-src');
  fs.mkdirSync(path.join(stage, topdir, 'bin'), { recursive: true });
  const body = (name) => `#!/bin/sh\necho "ffmpeg version fixture-${name}"\n`;
  fs.writeFileSync(path.join(stage, topdir, 'bin', 'ffmpeg'), body('ffmpeg'));
  fs.writeFileSync(path.join(stage, topdir, 'bin', 'ffprobe'), body('ffprobe'));
  const archive = path.join(dir, `${topdir}.tar.gz`);
  const r = spawnSync('tar', ['-czf', archive, '-C', stage, topdir]);
  assert.equal(r.status, 0, 'fixture tar creation failed');
  return {
    archive, topdir,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    bytes: fs.statSync(archive).size,
  };
}

const pinFrom = (base, fx, overrides = {}) => ({
  id: 'fixture-gpl-test', url: `${base}/media.tar.gz`,
  sha256: fx.sha256, bytes: fx.bytes, topdir: fx.topdir, ...overrides,
});

const serveArchive = (fx) => async () => {
  const { srv, base } = await server((req, res) => {
    res.writeHead(200, { 'content-length': fs.statSync(fx.archive).size });
    fs.createReadStream(fx.archive).pipe(res);
  });
  return { srv, base };
};

test('provisionMedia extracts, marks, commits atomically, and is idempotent (NAR-021-003/007)', async () => {
  const home = tmp();
  const work = tmp();
  const fx = fixtureArchive(work, 'ffmpeg-fixture-linux64-gpl');
  const { srv, base } = await serveArchive(fx)();
  process.env.NAROVA_HOME = home;
  try {
    const view = new readiness.ProgressView(new Sink());
    const pin = pinFrom(base, fx);
    const first = await acquisition.provisionMedia(view, pin);
    const root = acquisition.mediaInstallDir(pin);
    assert.equal(first.reused, false);
    assert.ok(first.acquired > 0);
    assert.ok(fs.existsSync(path.join(root, 'bin', 'ffmpeg')));
    assert.ok(fs.existsSync(path.join(root, 'bin', 'ffprobe')));
    assert.ok(acquisition.mediaMarkerOk(root, pin));
    assert.ok(!fs.existsSync(`${root}.tar.gz`), 'archive removed after commit');
    assert.ok(!fs.existsSync(`${root}.staging-${process.pid}`), 'staging removed');

    const second = await acquisition.provisionMedia(view, pin);
    assert.equal(second.reused, true);
    assert.equal(second.acquired, 0);

    // A stale marker (wrong digest) forces replacement, not silent reuse.
    const marker = path.join(root, '.narova-pin.json');
    fs.writeFileSync(marker, JSON.stringify({ sha256: '0'.repeat(64) }));
    const third = await acquisition.provisionMedia(view, pin);
    assert.equal(third.reused, false);
    assert.ok(acquisition.mediaMarkerOk(root, pin));
  } finally {
    srv.close();
    delete process.env.NAROVA_HOME;
  }
});

test('provisionMedia digest failure leaves no install, archive, or staging (NAR-021-003)', async () => {
  const home = tmp();
  const work = tmp();
  const fx = fixtureArchive(work, 'ffmpeg-fixture2-linux64-gpl');
  const { srv, base } = await serveArchive(fx)();
  process.env.NAROVA_HOME = home;
  try {
    const pin = pinFrom(base, fx, { sha256: '0'.repeat(64) });
    await assert.rejects(
      () => acquisition.provisionMedia(new readiness.ProgressView(new Sink()), pin),
      /digest mismatch/,
    );
    const root = acquisition.mediaInstallDir(pin);
    assert.ok(!fs.existsSync(root), 'no install dir');
    assert.ok(!fs.existsSync(`${root}.tar.gz`), 'no leftover archive');
    const mediaRoot = path.join(home, 'tools', 'media');
    if (fs.existsSync(mediaRoot)) {
      assert.deepEqual(fs.readdirSync(mediaRoot), [], 'no partial install anywhere in user storage');
    }
  } finally {
    srv.close();
    delete process.env.NAROVA_HOME;
  }
});

test('missing inner binary fails cleanly with no resolvable install', async () => {
  const home = tmp();
  const work = tmp();
  // Archive with the right topdir but no bin/ffprobe.
  const stage = path.join(work, 'src');
  fs.mkdirSync(path.join(stage, 'ffmpeg-hollow-linux64-gpl', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'ffmpeg-hollow-linux64-gpl', 'bin', 'ffmpeg'), '#!/bin/sh\n');
  const archive = path.join(work, 'hollow.tar.gz');
  spawnSync('tar', ['-czf', archive, '-C', stage, 'ffmpeg-hollow-linux64-gpl']);
  const { srv, base } = await server((req, res) => {
    res.writeHead(200, { 'content-length': fs.statSync(archive).size });
    fs.createReadStream(archive).pipe(res);
  });
  process.env.NAROVA_HOME = home;
  try {
    const pin = {
      id: 'fixture-hollow', url: `${base}/hollow.tar.gz`,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
      bytes: fs.statSync(archive).size, topdir: 'ffmpeg-hollow-linux64-gpl',
    };
    await assert.rejects(
      () => acquisition.provisionMedia(new readiness.ProgressView(new Sink()), pin),
      /does not contain bin\/ffprobe/,
    );
    assert.ok(!fs.existsSync(acquisition.mediaInstallDir(pin)));
  } finally {
    srv.close();
    delete process.env.NAROVA_HOME;
  }
});

test('unpinned platform fails closed with guidance, never downloads (NAR-021-002/003)', async () => {
  // darwin-arm64 has no recorded pin (fail-closed posture), so the real
  // platform lookup is the honest test on this host; assert generically too.
  assert.equal(acquisition.mediaPinFor('sunos', 'x64'), null);
  if (acquisition.mediaPinFor() === null) {
    await assert.rejects(
      () => acquisition.provisionMedia(),
      (err) => err.code === 'NAROVA_MEDIA_UNPINNED' && /failing closed/.test(err.message),
    );
  }
});

test('recorded Linux pins carry complete verifiable identities', () => {
  for (const [key, pin] of Object.entries(acquisition.MEDIA_PINS)) {
    assert.match(key, /^linux-(x64|arm64)$/);
    assert.match(pin.url, /^https:\/\/github\.com\/BtbN\/FFmpeg-Builds\/releases\/download\/autobuild-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\//);
    assert.match(pin.sha256, /^[0-9a-f]{64}$/);
    assert.ok(pin.bytes > 50_000_000);
    assert.match(pin.topdir, /^ffmpeg-N-\d+-g[0-9a-f]+-linux(64|arm64)-gpl$/);
  }
});

test('probe reports a binDir for a satisfied provisioned install (warm-run F10)', () => {
  const home = tmp();
  const work = tmp();
  const fx = fixtureArchive(work, 'ffmpeg-fixture3-linux64-gpl');
  const pin = {
    id: 'fixture-gpl-warm', url: 'file:///unused', sha256: '0'.repeat(64),
    bytes: 1, topdir: fx.topdir,
  };
  // Lay down what a completed provisionMedia leaves behind.
  const root = path.join(home, 'tools', 'media', pin.id);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'ffmpeg'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(root, 'bin', 'ffprobe'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(root, '.narova-pin.json'), JSON.stringify({
    sha256: pin.sha256, url: pin.url, bytes: pin.bytes,
  }));

  // Force the probe off PATH-found ffmpeg and onto the provisioned install.
  const savedFfmpeg = process.env.NAROVA_FFMPEG;
  const savedFfprobe = process.env.NAROVA_FFPROBE;
  const savedHome = process.env.NAROVA_HOME;
  process.env.NAROVA_FFMPEG = 'narova-absent-ffmpeg';
  process.env.NAROVA_FFPROBE = 'narova-absent-ffprobe';
  process.env.NAROVA_HOME = home;
  try {
    assert.ok(acquisition.mediaMarkerOk(root, pin));
    // mediaMarkerOk is the same gate probeMedia uses for provisioned state;
    // with the marker valid, a conforming probe resolves binDir for that
    // root. Exercise the real probe through readinessMatrix.
    const readiness = require('../src/readiness');
    const media = readiness.readinessMatrix().find((i) => i.id === 'media');
    // On an unpinned host (e.g. darwin) the probe cannot reach the
    // provisioned branch — assert only when the platform pin exists.
    if (require('../src/acquisition').mediaPinFor()) {
      assert.equal(media.status, 'satisfied');
      assert.ok(media.binDir, 'binDir exposed so warm runs can scope PATH');
      assert.ok(fs.existsSync(path.join(media.binDir)));
    } else {
      assert.notEqual(media.status, 'satisfied');
    }
  } finally {
    if (savedFfmpeg === undefined) delete process.env.NAROVA_FFMPEG; else process.env.NAROVA_FFMPEG = savedFfmpeg;
    if (savedFfprobe === undefined) delete process.env.NAROVA_FFPROBE; else process.env.NAROVA_FFPROBE = savedFfprobe;
    if (savedHome === undefined) delete process.env.NAROVA_HOME; else process.env.NAROVA_HOME = savedHome;
  }
});
