'use strict';
/* NAR-SPEC-021 progress + provisioning tests (NAR-021-003, NAR-021-007,
 * NAR-021-008). All network fixtures are a local http server — no real
 * acquisition, reproducible timing via short stall windows. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { PassThrough } = require('node:stream');
const {
  ProgressView, acquireFile, provisionFile, readinessMatrix, formatMatrix,
  StallError, STALL_TIMEOUT_MS,
} = require('../src/readiness');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'narova-ready-')); }

function server(routes) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => routes(req, res));
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const BODY = Buffer.alloc(256 * 1024, crypto.randomBytes(256).toString('hex'));
const SHA = crypto.createHash('sha256').update(BODY).digest('hex');

function serveBody(res, { chunks = 8, delay = 5 } = {}) {
  res.writeHead(200, { 'content-length': BODY.length });
  let i = 0;
  const timer = setInterval(() => {
    const from = Math.floor((BODY.length / chunks) * i);
    const to = Math.floor((BODY.length / chunks) * (i + 1));
    res.write(BODY.subarray(from, to));
    i += 1;
    if (i >= chunks) { clearInterval(timer); res.end(); }
  }, delay);
}

/* A writable double that records output. isTTY controls the render mode. */
class Sink extends PassThrough {
  constructor(tty) {
    super();
    this.tty = tty;
    this.chunks = [];
    this.on('data', (c) => this.chunks.push(c.toString()));
  }
  get isTTY() { return this.tty; }
  text() { return this.chunks.join(''); }
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

test('acquireFile streams a known-size body, verifies digest, commits atomically', async () => {
  const dir = tmp();
  const { srv, base } = await server((req, res) => serveBody(res));
  const dest = path.join(dir, 'item.bin');
  const sink = new Sink(false);
  const view = new ProgressView(sink, { livenessMs: 30 });
  view.itemStart('media tool', 1, 2);
  const r = await acquireFile(`${base}/big`, dest, { sha256: SHA, bytes: BODY.length, view });
  view.itemOk('media tool');
  srv.close();

  assert.equal(r.bytes, BODY.length);
  assert.equal(r.totalBytes, BODY.length);
  assert.deepEqual(fs.readFileSync(dest), BODY);
  assert.ok(!fs.existsSync(`${dest}.part`));
  // Non-TTY liveness: progress produced visible lines before completion.
  assert.match(sink.text(), /\.\.\].*media tool/);
});

test('acquireFile follows redirects, including relative Location (sandbox F8)', async () => {
  const dir = tmp();
  const { srv, base } = await server((req, res) => {
    if (req.url === '/hop') { res.writeHead(302, { location: '/big' }); return res.end(); } // relative
    if (req.url === '/hop2') { res.writeHead(302, { location: `${base}/hop` }); return res.end(); } // absolute
    serveBody(res);
  });
  const dest = path.join(dir, 'redirected.bin');
  const r = await acquireFile(`${base}/hop2`, dest, { sha256: SHA });
  srv.close();
  assert.equal(r.bytes, BODY.length);
});

test('digest mismatch fails and leaves no partial artifact (NAR-021-003)', async () => {
  const dir = tmp();
  const { srv, base } = await server((req, res) => serveBody(res));
  const dest = path.join(dir, 'corrupt.bin');
  await assert.rejects(
    acquireFile(`${base}/big`, dest, { sha256: '0'.repeat(64) }),
    /digest mismatch/,
  );
  srv.close();
  assert.ok(!fs.existsSync(dest));
  assert.ok(!fs.existsSync(`${dest}.part`));
});

test('acquisition without a recorded digest fails closed (adversarial F1)', async () => {
  const dir = tmp();
  const { srv, base } = await server((req, res) => serveBody(res));
  const dest = path.join(dir, 'nodigest.bin');
  for (const bad of [undefined, 'not-a-digest', 'ab']) {
    await assert.rejects(
      acquireFile(`${base}/big`, dest, { sha256: bad }),
      /refusing to acquire .* without a recorded sha256/,
    );
  }
  srv.close();
  assert.ok(!fs.existsSync(dest));
  assert.ok(!fs.existsSync(`${dest}.part`));
});

test('voice probe agrees with the pinned acquisition (adversarial F2)', () => {
  const { DEMO_VOICE } = require('../src/readiness');
  const home = tmp();
  const cache = tmp();
  process.env.NAROVA_HOME = home;
  process.env.NAROVA_PIPER_DIR = cache;
  delete require.cache[require.resolve('../src/readiness')];
  const fresh = require('../src/readiness');

  const voice = () => fresh.readinessMatrix().find((i) => i.id === 'voice');
  assert.equal(voice().status, 'auto-provisionable'); // nothing cached

  // Wrong bytes at the pinned paths must NOT satisfy the probe — the digest
  // is checked, not existence (a satisfied assertion needs the real pinned
  // bytes and is proven by the sandbox demo run).
  const fsx = require('node:fs');
  const pathx = require('node:path');
  for (const f of DEMO_VOICE.files) fsx.writeFileSync(pathx.join(cache, f.name), Buffer.alloc(1024, 1));
  assert.equal(voice().status, 'auto-provisionable');

  fsx.rmSync(cache, { recursive: true, force: true });
  delete process.env.NAROVA_PIPER_DIR;
  delete process.env.NAROVA_HOME;
});

test('stalled transfer aborts with item context and no residue (NAR-021-008)', async () => {
  const dir = tmp();
  const { srv, base } = await server((req, res) => {
    res.writeHead(200, { 'content-length': BODY.length });
    res.write(BODY.subarray(0, 4096));
    // then silence — never end, never more data
  });
  const dest = path.join(dir, 'stalled.bin');
  const sink = new Sink(false);
  const view = new ProgressView(sink, { livenessMs: 30 });
  view.itemStart('media tool', 1, 1);
  const t0 = Date.now();
  await assert.rejects(
    acquireFile(`${base}/stall`, dest, { sha256: SHA, view }),
    (err) => err instanceof StallError && /no data for over/.test(err.message),
  );
  view.itemFail('media tool', 'no data', 'run the same command again — finished items are kept');
  srv.close();
  assert.ok(!fs.existsSync(dest));
  assert.ok(!fs.existsSync(`${dest}.part`));
  // Bounded, not indefinite: aborted within ~1.5x the stall window.
  assert.ok(Date.now() - t0 < STALL_TIMEOUT_MS * 1.5 + 1000);
  assert.match(sink.text(), /next: run the same command again/);
});

test('unknown-size transfer reports activity without inventing a total', async () => {
  const dir = tmp();
  const { srv, base } = await server((req, res) => {
    res.writeHead(200); // no content-length -> chunked
    res.write(BODY.subarray(0, BODY.length / 2));
    setTimeout(() => { res.write(BODY.subarray(BODY.length / 2)); res.end(); }, 60);
  });
  const dest = path.join(dir, 'unknown.bin');
  const sink = new Sink(true);
  const view = new ProgressView(sink, { heartbeatMs: 10 });
  view.itemStart('voice model', 1, 1);
  const r = await acquireFile(`${base}/unknown`, dest, { sha256: SHA, view });
  view.itemOk('voice model');
  srv.close();
  assert.equal(r.bytes, BODY.length);
  assert.equal(r.totalBytes, null);
  assert.match(sink.text(), /size unknown/);
  assert.doesNotMatch(sink.text(), /\/ \? B left/);
});

test('provisionFile is idempotent: a matching artifact is never re-acquired (NAR-021-007)', async () => {
  const dir = tmp();
  const { srv, base } = await server((req, res) => serveBody(res));
  const item = { label: 'media tool', url: `${base}/big`, sha256: SHA, bytes: BODY.length,
    relativePath: `test-${path.basename(dir)}/item.bin` };
  process.env.NAROVA_HOME = dir; // TOOLS_DIR is derived at load — patch via re-require below
  delete require.cache[require.resolve('../src/readiness')];
  const fresh = require('../src/readiness');
  const first = await fresh.provisionFile({ ...item, relativePath: 'demo/item.bin' });
  srv.close();
  assert.equal(first.reused, false);
  assert.ok(fs.existsSync(first.path));
  const sink = new Sink(false);
  const view = new ProgressView(sink);
  const second = await fresh.provisionFile({ ...item, relativePath: 'demo/item.bin' }, view);
  assert.equal(second.reused, true);
  assert.equal(second.bytes, 0);
  assert.match(sink.text(), /already provisioned/);
  delete process.env.NAROVA_HOME;
});

test('TTY view prints the plan first and confirms each item (NAR-021-008)', async () => {
  // Hermetic TTY: CI and NO_COLOR correctly alter production rendering, but
  // this test is specifically about the colored TTY path, so clear both.
  const savedCI = process.env.CI;
  const savedNoColor = process.env.NO_COLOR;
  delete process.env.CI;
  delete process.env.NO_COLOR;
  try {
    const sink = new Sink(true);
    const view = new ProgressView(sink, { heartbeatMs: 10 });
    view.plan([{ label: 'media tool (ffmpeg)', bytes: 81_000_000 }, { label: 'voice model', bytes: 6_100_000 }]);
    view.ok('Node 20.11.0', 'found on PATH');
    view.itemStart('media tool (ffmpeg)', 1, 2);
    view.itemProgress({ bytes: 35_000_000, totalBytes: 81_000_000 });
    await sleep(25); // let the throttled TTY redraw fire
    view.itemOk('media tool (ffmpeg)', '/tools/ffmpeg');
    view.itemOk('voice model', '/tools/voice.onnx');
    const text = sink.text();
    assert.match(text, /2 items to set up \(about 83\.1 MB\)/);
    assert.match(text, /1\. media tool \(ffmpeg\)  ~77\.2 MB/);
    assert.match(text, /✓ Node 20\.11\.0 — found on PATH/);
    assert.match(text, /33\.4 MB \/ 77\.2 MB/);
    assert.match(text, /left/); // estimate present
    assert.match(text, /✓ media tool \(ffmpeg\) — \/tools\/ffmpeg \(/);
  } finally {
    if (savedCI === undefined) delete process.env.CI; else process.env.CI = savedCI;
    if (savedNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNoColor;
  }
});

test('non-TTY view emits liveness lines on a bounded interval, not silence', async () => {
  const sink = new Sink(false);
  const view = new ProgressView(sink, { livenessMs: 40 });
  view.itemStart('media tool', 1, 1);
  view.itemProgress({ bytes: 1000, totalBytes: 2000 });
  await sleep(140); // forced heartbeat lines appear even with zero new bytes
  view.itemProgress({ bytes: 1500, totalBytes: 2000 });
  view.itemOk('media tool');
  const lines = sink.text().trim().split('\n');
  const live = lines.filter((l) => l.includes('media tool'));
  assert.ok(live.length >= 3, `expected repeated liveness lines, got: ${lines.join('|')}`);
});

test('readiness matrix classifies every item with a stable shape', () => {
  const items = readinessMatrix();
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, ['substrate', 'media', 'speech', 'voice', 'renderer']);
  for (const i of items) {
    assert.ok(['satisfied', 'auto-provisionable', 'needs-user-action'].includes(i.status));
    if (i.status === 'needs-user-action') { assert.ok(i.reason); assert.ok(i.next); }
  }
  const text = formatMatrix(items);
  assert.match(text, /Readiness:/);
  assert.equal(text.split('\n').length, items.length + 1);
});

test('auto-provisionable rows name a provisioning surface, never "set up automatically" (NAR-021-002)', () => {
  const items = readinessMatrix();
  for (const i of items) {
    const line = formatMatrix([i]);
    if (i.status === 'auto-provisionable') {
      assert.ok(!line.includes('will be set up automatically'), i.label);
      assert.ok(!line.includes('doctor'), 'readiness wording must not imply doctor provisions');
      // A concrete provisioning surface is named: either the generic first-run
      // wording or the item's own specific trigger.
      assert.match(line, /provisioned on first run \/ `narova demo`|provisioned|fetched on first build/, i.label);
    }
  }
});

test('environment overrides are honored: a wrong binary never satisfies media', () => {
  // Point overrides at node: runnable, exits 0 for `-version` — but it is
  // not ffmpeg, so the probe must never report satisfied. The recovery
  // classification is platform-dependent (pinned -> auto-provisionable,
  // unpinned -> needs-user-action), so assert the invariant, not the value.
  process.env.NAROVA_FFMPEG = process.execPath;
  process.env.NAROVA_FFPROBE = process.execPath;
  const media = readinessMatrix().find((i) => i.id === 'media');
  assert.notEqual(media.status, 'satisfied');
  if (media.status === 'needs-user-action') assert.ok(media.next, 'guidance present');
  delete process.env.NAROVA_FFMPEG;
  delete process.env.NAROVA_FFPROBE;
});
