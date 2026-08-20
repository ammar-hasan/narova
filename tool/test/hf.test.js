'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {
  previewUrl, startHfPreview, stopHfPreview, livePreviewPid, previewPort, previewPortIntent,
} = require('../src/hf');

function installFakeNpx(dir, {
  mode = 'ready', shutdownDelayMs = 0, readyDelayMs = 0, bindHost = '127.0.0.1',
} = {}) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const npx = path.join(bin, 'npx');
  const settings = JSON.stringify({ mode, shutdownDelayMs, readyDelayMs, bindHost });
  fs.writeFileSync(npx, [
    '#!/usr/bin/env node',
    "const net = require('node:net');",
    `const settings = ${settings};`,
    "if (settings.mode === 'exit') { process.stderr.write('fake startup failed\\n'); process.exit(23); }",
    "if (settings.mode === 'silent') { setInterval(() => {}, 1000); } else {",
    "  const flag = process.argv.indexOf('--port');",
    '  const requested = Number(process.argv[flag + 1]);',
    '  let server;',
    '  const bind = (port, attempts = 0) => {',
    '    server = net.createServer();',
    "    server.once('error', error => {",
    "      if (error.code === 'EADDRINUSE' && attempts < 50) return bind(port + 1, attempts + 1);",
    '      throw error;',
    '    });',
    '    server.listen(port, settings.bindHost, () => {',
    "      setTimeout(() => process.stdout.write(`Studio running\\n  http://localhost:${port}\\n`), settings.readyDelayMs);",
    '    });',
    '  };',
    '  bind(requested);',
    "  process.on('SIGTERM', () => setTimeout(() => server.close(() => process.exit(0)), settings.shutdownDelayMs));",
    '  setInterval(() => {}, 1000);',
    '}',
  ].join('\n'));
  fs.chmodSync(npx, 0o755);
  return bin;
}

async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

test('previewUrl reports the exact Studio project route', () => {
  const dir = path.join('/tmp', 'my narrated reel');
  assert.equal(previewUrl(dir, 4317), 'http://localhost:4317/#project/my%20narrated%20reel');
});

test('detached preview refuses to overwrite a live pid', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-'));
  const pidFile = path.join(dir, 'preview.pid');
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  await assert.rejects(
    () => startHfPreview(dir, { pidFile, logFile: path.join(dir, 'preview.log') }),
    /preview already running/,
  );
});

(process.platform === 'win32' ? test.skip : test)('detached preview returns its persisted port state file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-port-'));
  const bin = installFakeNpx(dir);
  const pidFile = path.join(dir, 'preview.pid');
  const port = await unusedPort();
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const preview = await startHfPreview(dir, {
      port, pidFile, logFile: path.join(dir, 'preview.log'),
    });
    assert.equal(preview.portFile, path.join(dir, 'preview.port'));
    assert.equal(preview.stateFile, path.join(dir, 'preview.state.json'));
    assert.equal(fs.readFileSync(preview.portFile, 'utf8').trim(), String(port));
    assert.equal(JSON.parse(fs.readFileSync(preview.stateFile)).status, 'ready');
    assert.equal(previewPortIntent(pidFile), 'explicit');
    await stopHfPreview(pidFile);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('startup publishes recoverable process identity before readiness', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-provisional-'));
  const bin = installFakeNpx(dir, { mode: 'silent' });
  const pidFile = path.join(dir, 'preview.pid');
  const stateFile = path.join(dir, 'preview.state.json');
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const starting = startHfPreview(dir, {
      pidFile, logFile: path.join(dir, 'preview.log'), startupTimeoutMs: 250,
    });
    const deadline = Date.now() + 200;
    let state = null;
    while (Date.now() < deadline) {
      if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile));
      if (state?.status === 'starting') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(state?.status, 'starting');
    assert.equal(state.pid, Number(fs.readFileSync(pidFile, 'utf8')));
    assert.match(state.started, /^(?:proc|ps):/);
    fs.writeFileSync(path.join(dir, 'preview.port'), '65530\n');
    assert.equal(previewPort(pidFile), null);
    await assert.rejects(() => starting, /readiness timed out/);
    assert.equal(fs.existsSync(stateFile), false);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('external stale-state observation is read-only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-readonly-'));
  const pidFile = path.join(dir, 'preview.pid');
  const stateFile = path.join(dir, 'preview.state.json');
  const state = {
    schema: 'narova.preview-state/1', nonce: 'stale-observation', status: 'ready',
    pid: 99_999_999, started: 'proc:1', portIntent: 'auto', requestedPort: 3002, actualPort: 3002,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  fs.writeFileSync(pidFile, `${state.pid}\n`);
  fs.writeFileSync(path.join(dir, 'preview.port'), '3002\n');
  fs.writeFileSync(path.join(dir, 'preview.port.intent'), 'auto\n');
  assert.equal(livePreviewPid(pidFile), null);
  assert.equal(fs.existsSync(stateFile), true);
  assert.equal(fs.existsSync(pidFile), true);
  assert.equal(fs.existsSync(path.join(dir, 'preview.port')), true);
});

test('invalid requested and legacy ports are rejected before authoritative state is published', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-invalid-port-'));
  const pidFile = path.join(dir, 'preview.pid');
  fs.writeFileSync(pidFile, '99999999\n');
  fs.writeFileSync(path.join(dir, 'preview.port'), '70000\n');
  assert.equal(previewPort(pidFile), null);
  await assert.rejects(
    () => startHfPreview(dir, { startPort: 70000, pidFile, logFile: path.join(dir, 'preview.log') }),
    /preview port must be an integer from 1 to 65535/,
  );
  assert.equal(fs.existsSync(path.join(dir, 'preview.state.json')), false);
});

test('orphan compatibility sidecars do not influence a fresh preview', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-orphan-sidecars-'));
  const pidFile = path.join(dir, 'preview.pid');
  fs.writeFileSync(path.join(dir, 'preview.port'), '4317\n');
  fs.writeFileSync(path.join(dir, 'preview.port.intent'), 'explicit\n');
  assert.equal(previewPort(pidFile), null);
  assert.equal(previewPortIntent(pidFile), 'auto');
});

test('stop retains legacy state when process identity cannot be verified', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-legacy-stop-'));
  const pidFile = path.join(dir, 'preview.pid');
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  await assert.rejects(() => stopHfPreview(pidFile), /cannot be verified.*state retained/);
  assert.equal(fs.existsSync(pidFile), true);
});

test('an unverified recovery tombstone is retained instead of being signaled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-unverified-recovery-'));
  const pidFile = path.join(dir, 'preview.pid');
  fs.writeFileSync(path.join(dir, 'preview.state.json'), JSON.stringify({
    schema: 'narova.preview-state/1', nonce: 'unverified-recovery', status: 'recovery',
    pid: process.pid, started: null, portIntent: 'auto', requestedPort: 3002, actualPort: null,
  }));
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  await assert.rejects(() => stopHfPreview(pidFile), /cannot be verified.*state retained/);
  assert.equal(fs.existsSync(path.join(dir, 'preview.state.json')), true);
});

test('explicit recovery preserves the requested port rather than accepting a fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-explicit-recovery-'));
  const pidFile = path.join(dir, 'preview.pid');
  fs.writeFileSync(path.join(dir, 'preview.state.json'), JSON.stringify({
    schema: 'narova.preview-state/1', nonce: 'explicit-recovery', status: 'recovery',
    pid: process.pid, started: 'unverified', portIntent: 'explicit', requestedPort: 4317, actualPort: 4318,
  }));
  assert.equal(previewPort(pidFile), 4317);
});

(process.platform === 'darwin' ? test : test.skip)('Darwin process identity does not depend on PATH containing ps', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-sanitized-path-'));
  const bin = installFakeNpx(dir);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const pidFile = path.join(dir, 'preview.pid');
  const previousPath = process.env.PATH;
  process.env.PATH = bin;
  try {
    const preview = await startHfPreview(dir, {
      port: await unusedPort(), pidFile, logFile: path.join(dir, 'preview.log'),
    });
    assert.equal(preview.pid, livePreviewPid(pidFile));
    await stopHfPreview(pidFile);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('stop refuses a preview pid whose process identity was reused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-state-reused-pid-'));
  const pidFile = path.join(dir, 'preview.pid');
  fs.writeFileSync(path.join(dir, 'preview.state.json'), JSON.stringify({
    schema: 'narova.preview-state/1', nonce: 'reused-preview-pid', status: 'ready',
    pid: process.pid, started: 'not-this-process', portIntent: 'explicit', requestedPort: 3002, actualPort: 3002,
  }));
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  assert.equal(await stopHfPreview(pidFile), false);
  assert.equal(fs.existsSync(pidFile), false);
});

(process.platform === 'win32' ? test.skip : test)('automatic preview records the service-selected bound port', async (t) => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => occupied.close());
  const requested = occupied.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-auto-port-'));
  const bin = installFakeNpx(dir);
  const pidFile = path.join(dir, 'preview.pid');
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const preview = await startHfPreview(dir, {
      startPort: requested, pidFile, logFile: path.join(dir, 'preview.log'),
    });
    assert.notEqual(preview.port, requested);
    assert.equal(Number(fs.readFileSync(preview.portFile, 'utf8')), preview.port);
    assert.equal(previewPortIntent(pidFile), 'auto');
    await stopHfPreview(pidFile);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('explicit preview rejects a substituted bound port without writing state', async (t) => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => occupied.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-explicit-port-'));
  const bin = installFakeNpx(dir);
  const pidFile = path.join(dir, 'preview.pid');
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    await assert.rejects(
      () => startHfPreview(dir, {
        port: occupied.address().port,
        pidFile,
        logFile: path.join(dir, 'preview.log'),
      }),
      /port .* is in use .* bound port .* instead/,
    );
    assert.equal(fs.existsSync(pidFile), false);
    assert.equal(fs.existsSync(path.join(dir, 'preview.port')), false);
    assert.equal(fs.existsSync(path.join(dir, 'preview.port.intent')), false);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('startup exit before readiness leaves no preview state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-exit-'));
  const bin = installFakeNpx(dir, { mode: 'exit' });
  const pidFile = path.join(dir, 'preview.pid');
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    await assert.rejects(
      () => startHfPreview(dir, {
        pidFile, logFile: path.join(dir, 'preview.log'), startupTimeoutMs: 1000,
      }),
      /exited before readiness.*fake startup failed/,
    );
    assert.equal(fs.existsSync(pidFile), false);
    assert.equal(fs.existsSync(path.join(dir, 'preview.port')), false);
    assert.equal(fs.existsSync(path.join(dir, 'preview.port.intent')), false);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('detached preview waits for delayed process exit before restarting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-restart-'));
  const bin = installFakeNpx(dir, { shutdownDelayMs: 200 });
  const port = await unusedPort();
  const pidFile = path.join(dir, 'preview.pid');
  const options = { port, pidFile, logFile: path.join(dir, 'preview.log') };
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  let preview;
  try {
    preview = await startHfPreview(dir, options);
    await stopHfPreview(pidFile);
    preview = await startHfPreview(dir, options);
    assert.equal(preview.port, port);
    await stopHfPreview(pidFile);
  } finally {
    if (preview) {
      try { process.kill(-preview.pid, 'SIGKILL'); } catch {}
    }
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('overlapping starts have one state owner and one tracked preview', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-concurrent-'));
  const bin = installFakeNpx(dir);
  const pidFile = path.join(dir, 'preview.pid');
  const options = { port: await unusedPort(), pidFile, logFile: path.join(dir, 'preview.log') };
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const results = await Promise.allSettled([
      startHfPreview(dir, options), startHfPreview(dir, options),
    ]);
    const started = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    assert.equal(started.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason.message, /state change already in progress|preview already running/);
    assert.equal(Number(fs.readFileSync(pidFile, 'utf8')), started[0].value.pid);
    assert.equal(Number(fs.readFileSync(started[0].value.portFile, 'utf8')), started[0].value.port);
    await stopHfPreview(pidFile);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('stop cannot report success or absence while startup owns preview state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-start-stop-'));
  const bin = installFakeNpx(dir, { readyDelayMs: 250 });
  const pidFile = path.join(dir, 'preview.pid');
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  let preview;
  try {
    const starting = startHfPreview(dir, {
      port: await unusedPort(), pidFile, logFile: path.join(dir, 'preview.log'),
    });
    await new Promise(resolve => setTimeout(resolve, 40));
    await assert.rejects(() => stopHfPreview(pidFile), /state change already in progress/);
    preview = await starting;
    assert.equal(Number(fs.readFileSync(pidFile, 'utf8')), preview.pid);
    await stopHfPreview(pidFile);
  } finally {
    if (preview) {
      try { process.kill(-preview.pid, 'SIGKILL'); } catch {}
    }
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('stale preview ownership is reclaimed without admitting two starters', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-stale-lock-'));
  const bin = installFakeNpx(dir, { readyDelayMs: 100 });
  const pidFile = path.join(dir, 'preview.pid');
  const lockDir = `${pidFile}.lock`;
  fs.mkdirSync(lockDir);
  fs.writeFileSync(
    path.join(lockDir, 'intent-99999999-11111111-1111-4111-8111-111111111111.json'),
    JSON.stringify({ pid: 99_999_999, nonce: '11111111-1111-4111-8111-111111111111', started: 'dead' }),
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const options = { port: await unusedPort(), pidFile, logFile: path.join(dir, 'preview.log') };
    const results = await Promise.allSettled([startHfPreview(dir, options), startHfPreview(dir, options)]);
    let started = results.filter(result => result.status === 'fulfilled');
    assert.ok(started.length <= 1);
    // Two exactly overlapping unique intents may both fail safely. Once they
    // release ownership, a retry must succeed and become the sole state owner.
    if (!started.length) started = [{ value: await startHfPreview(dir, options) }];
    assert.equal(Number(fs.readFileSync(pidFile, 'utf8')), started[0].value.pid);
    await stopHfPreview(pidFile);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('a reused owner pid does not make stale preview ownership permanent', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-reused-pid-'));
  const bin = installFakeNpx(dir);
  const pidFile = path.join(dir, 'preview.pid');
  const lockDir = `${pidFile}.lock`;
  fs.mkdirSync(lockDir);
  fs.writeFileSync(
    path.join(lockDir, `intent-${process.pid}-22222222-2222-4222-8222-222222222222.json`),
    JSON.stringify({ pid: process.pid, nonce: '22222222-2222-4222-8222-222222222222', started: 'not-this-process' }),
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    await startHfPreview(dir, {
      port: await unusedPort(), pidFile, logFile: path.join(dir, 'preview.log'),
    });
    await stopHfPreview(pidFile);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('an aged malformed transaction intent cannot wedge preview management', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-malformed-lock-'));
  const bin = installFakeNpx(dir);
  const pidFile = path.join(dir, 'preview.pid');
  const lockDir = `${pidFile}.lock`;
  fs.mkdirSync(lockDir);
  const malformed = path.join(lockDir, 'intent-99999999-33333333-3333-4333-8333-333333333333.json');
  fs.writeFileSync(malformed, '{}');
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(malformed, old, old);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    await startHfPreview(dir, {
      port: await unusedPort(), pidFile, logFile: path.join(dir, 'preview.log'),
    });
    assert.equal(fs.existsSync(malformed), false);
    await stopHfPreview(pidFile);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('shutdown waits for the tracked group when only IPv6 held the port', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-ipv6-stop-'));
  const bin = installFakeNpx(dir, { shutdownDelayMs: 200, bindHost: '::1' });
  const pidFile = path.join(dir, 'preview.pid');
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    await startHfPreview(dir, {
      port: await unusedPort(), pidFile, logFile: path.join(dir, 'preview.log'),
    });
    const startedAt = Date.now();
    await stopHfPreview(pidFile);
    assert.ok(Date.now() - startedAt >= 150);
    assert.equal(fs.existsSync(pidFile), false);
  } finally {
    process.env.PATH = previousPath;
  }
});

(process.platform === 'win32' ? test.skip : test)('shutdown timeout retains preview state until recovery', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-stop-timeout-'));
  const bin = installFakeNpx(dir, { shutdownDelayMs: 250 });
  const pidFile = path.join(dir, 'preview.pid');
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    await startHfPreview(dir, {
      port: await unusedPort(), pidFile, logFile: path.join(dir, 'preview.log'),
    });
    await assert.rejects(() => stopHfPreview(pidFile, { timeoutMs: 30 }), /shutdown timed out/);
    assert.equal(fs.existsSync(pidFile), true);
    assert.equal(fs.existsSync(path.join(dir, 'preview.port')), true);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(await stopHfPreview(pidFile), false);
    assert.equal(fs.existsSync(pidFile), false);
    assert.equal(fs.existsSync(path.join(dir, 'preview.port')), false);
  } finally {
    process.env.PATH = previousPath;
  }
});
