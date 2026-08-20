'use strict';
/* HyperFrames CLI access. narova stays zero-dep: every call goes through
 * `npx --yes hyperframes@<PIN>` so the engine version is reproducible. The same
 * pin is written into the generated out/hf/package.json. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { isActive: machineActive } = require('./machine');

const HYPERFRAMES_VERSION = '0.7.96';

const RETRY_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const PREVIEW_START_TIMEOUT_MS = 60000;
const PREVIEW_STOP_TIMEOUT_MS = 4000;
const PREVIEW_STATE_SCHEMA = 'narova.preview-state/1';

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function readLogRange(logFile, offset) {
  const size = fs.statSync(logFile).size;
  if (size <= offset) return { offset, text: '' };
  const length = size - offset;
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(logFile, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }
  return { offset: size, text: buffer.toString('utf8') };
}

/* HyperFrames owns the bind and prints this summary only after its server is
 * listening. Observe that outcome instead of predicting it with a preflight
 * probe; HyperFrames may legitimately advance from the requested start port. */
async function waitForPreviewReady(child, logFile, startOffset, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let offset = startOffset;
  let output = '';
  let spawnError = null;
  child.once('error', error => { spawnError = error; });
  while (Date.now() < deadline) {
    const appended = readLogRange(logFile, offset);
    offset = appended.offset;
    output += appended.text;
    const clean = stripAnsi(output);
    const ready = clean.match(/Studio running[\s\S]*?http:\/\/localhost:(\d+)/);
    if (ready) return Number(ready[1]);
    if (spawnError) throw spawnError;
    if (child.exitCode != null || child.signalCode != null || (child.pid && !processIsLive(child.pid))) {
      const detail = clean.trim().split('\n').filter(Boolean).at(-1);
      throw new Error(`preview exited before readiness${detail ? `: ${detail.trim()}` : ''}`);
    }
    await delay(25);
  }
  throw new Error(`preview readiness timed out after ${timeoutMs}ms; see ${logFile}`);
}

/* npx `spawnSync` with retry for transient DNS/network errors. macOS sees
 * intermittent ENOTFOUND on npx registry calls (resolved by a brief wait). */
function npxSync(args, opts) {
  let last;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) sleep(RETRY_DELAY_MS);
    const r = spawnSync('npx', args, opts);
    if (!r.error || !RETRY_CODES.has(r.error.code)) return r;
    last = r.error;
  }
  const r = { error: last, status: 1, stdout: '', stderr: '' };
  return r;
}

/* Run a hyperframes CLI command in `cwd` (normally out/hf). Inherits stdio so
 * progress is visible. Throws on non-zero exit. */
function runHf(args, cwd, opts = {}) {
  const { quiet = false, ...spawnOpts } = opts;
  // Machine mode (--json): the engine's progress must not reach stdout, so
  // capture it like quiet mode and replay it on stderr (NAR-015-070).
  const capture = quiet || machineActive();
  const r = npxSync(['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], {
    cwd,
    ...(capture ? { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 } : { stdio: 'inherit' }),
    ...spawnOpts,
  });
  if (capture && !quiet) {
    if (r.stdout) process.stderr.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  if (r.error) throw r.error;
  if (r.status !== 0) {
    const detail = capture ? String(r.stderr || r.stdout || '').trim().split('\n').pop() : '';
    throw new Error(`hyperframes ${args[0]} exited ${r.status}${detail ? `: ${detail}` : ''}`);
  }
  return r;
}

function previewUrl(cwd, port = 3002, projectName) {
  let name = projectName || path.basename(cwd);
  if (!projectName && name.startsWith('hf-')) name = name.slice(3); // strip hf- prefix
  return `http://localhost:${port}/#project/${encodeURIComponent(name)}`;
}

function livePreviewPid(pidFile) {
  const state = readPreviewState(pidFile);
  return state && previewStateIsLive(state) ? state.pid : null;
}

function processIsLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function previewGroupIsLive(pid) {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function processStartIdentity(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
    if (fields[19]) return `proc:${fields[19]}`;
  } catch { /* Darwin uses ps below. */ }
  const ps = process.platform === 'darwin' ? '/bin/ps' : 'ps';
  const result = spawnSync(ps, ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8', timeout: 2000,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
  });
  const started = result.status === 0 ? String(result.stdout || '').trim() : '';
  return started ? `ps:${started}` : null;
}

function stateFileFor(pidFile) {
  return pidFile.replace(/\.pid$/, '') + '.state.json';
}

function atomicWrite(file, contents) {
  const candidate = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(candidate, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(candidate, file);
  } finally {
    fs.rmSync(candidate, { force: true });
  }
}

function readPreviewState(pidFile) {
  const stateFile = stateFileFor(pidFile);
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.schema !== PREVIEW_STATE_SCHEMA
        || typeof state.nonce !== 'string' || !state.nonce
        || !['starting', 'ready', 'recovery'].includes(state.status)
        || !Number.isSafeInteger(state.pid) || state.pid <= 0
        || (state.started != null && (typeof state.started !== 'string' || !state.started))
        || (state.started == null && state.status !== 'recovery')
        || !['auto', 'explicit'].includes(state.portIntent)
        || !Number.isInteger(state.requestedPort) || state.requestedPort < 1 || state.requestedPort > 65535
        || (state.actualPort != null && (!Number.isInteger(state.actualPort) || state.actualPort < 1 || state.actualPort > 65535))) {
      throw new Error(`invalid preview state file: ${stateFile}`);
    }
    return state;
  }
  if (!fs.existsSync(pidFile)) return null;
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid preview pid file: ${pidFile}`);
  return {
    schema: 'legacy', nonce: null, status: 'ready', pid, started: null,
    portIntent: directPortIntent(pidFile), actualPort: directPreviewPort(pidFile),
  };
}

function previewStateLiveness(state) {
  if (!state || !processIsLive(state.pid)) return 'dead';
  if (!state.started) return 'unverified';
  const current = processStartIdentity(state.pid);
  if (!current) return 'unverified';
  return current === state.started ? 'live' : 'mismatch';
}

function previewStateIsLive(state) {
  return previewStateLiveness(state) === 'live';
}

function writePreviewState(pidFile, state) {
  atomicWrite(stateFileFor(pidFile), `${JSON.stringify(state)}\n`);
}

function clearPreviewState(pidFile, expectedNonce = null) {
  if (expectedNonce != null) {
    const current = readPreviewState(pidFile);
    if (!current || current.nonce !== expectedNonce) return false;
  }
  // Compatibility views disappear first; the authoritative JSON record is
  // the commit marker and remains recoverable until cleanup is complete.
  fs.rmSync(pidFile, { force: true });
  fs.rmSync(portFileFor(pidFile), { force: true });
  fs.rmSync(portIntentFileFor(pidFile), { force: true });
  fs.rmSync(stateFileFor(pidFile), { force: true });
  return true;
}

/* Start and stop are one state transaction. Each contender publishes a unique
 * intent, so stale reclamation can never unlink a replacement owner's lock. */
function acquirePreviewStateLock(pidFile) {
  const lockDir = `${pidFile}.lock`;
  fs.mkdirSync(lockDir, { recursive: true });
  const nonce = crypto.randomUUID();
  const ownIntent = path.join(lockDir, `intent-${process.pid}-${nonce}.json`);
  const owner = { pid: process.pid, nonce, started: processStartIdentity(process.pid) };
  // Build the record beside the lock directory, then publish it with one
  // rename. A killed writer can leave no partial or unrelated entry inside the
  // directory that all future state changes must scan.
  const candidate = `${lockDir}.${process.pid}.${nonce}.tmp`;
  try {
    fs.writeFileSync(candidate, `${JSON.stringify(owner)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(candidate, ownIntent);
  } finally {
    fs.rmSync(candidate, { force: true });
  }
  const release = () => { try { fs.rmSync(ownIntent, { force: true }); } catch {} };
  const busy = other => new Error(`preview state change already in progress${other ? ` (owner pid ${other})` : ''}`);
  try {
    for (const entry of fs.readdirSync(lockDir, { withFileTypes: true })) {
      const file = path.join(lockDir, entry.name);
      if (file === ownIntent) continue;
      if (!entry.isFile() || !/^intent-\d+-[0-9a-f-]+\.json$/.test(entry.name)) throw busy();
      let stale = false;
      let other = null;
      try {
        const recorded = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!Number.isSafeInteger(recorded.pid) || recorded.pid <= 0
            || typeof recorded.nonce !== 'string' || !recorded.nonce
            || typeof recorded.started !== 'string' || !recorded.started) {
          throw new Error('invalid preview transaction owner');
        }
        other = recorded.pid;
        stale = !processIsLive(recorded.pid);
        if (!stale && recorded.started) {
          const current = processStartIdentity(recorded.pid);
          stale = Boolean(current && current !== recorded.started);
        }
      } catch {
        try { stale = Date.now() - fs.statSync(file).mtimeMs > 60_000; } catch { continue; }
      }
      if (stale) fs.rmSync(file, { force: true });
      else throw busy(other);
    }
    if (fs.readdirSync(lockDir).some(entry => path.join(lockDir, entry) !== ownIntent)) throw busy();
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

/* Start Studio in its own process group so an agent shell can return without
 * reaping the preview server. Logs and the process id live outside out/hf,
 * which compose replaces on every run. */
async function startHfPreview(cwd, {
  port, startPort = 3002, logFile, pidFile, projectName,
  startupTimeoutMs = PREVIEW_START_TIMEOUT_MS,
} = {}) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const log = logFile || path.join(path.dirname(cwd), 'preview.log');
  const pid = pidFile || path.join(path.dirname(cwd), 'preview.pid');
  fs.mkdirSync(path.dirname(pid), { recursive: true });
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const releaseStateLock = acquirePreviewStateLock(pid);
  try {
    const existingState = readPreviewState(pid);
    const existingLiveness = previewStateLiveness(existingState);
    if (existingLiveness === 'live') {
      throw new Error(`preview already running (pid ${existingState.pid}); stop it before starting another`);
    }
    if (existingLiveness === 'unverified') {
      throw new Error(`preview already running or state for pid ${existingState.pid} cannot be safely verified; retain it for manual recovery`);
    }
    if (existingState) clearPreviewState(pid, existingState.nonce);
    const requestedPort = port ?? startPort;
    if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
      throw new Error('preview port must be an integer from 1 to 65535');
    }
    fs.closeSync(fs.openSync(log, 'a'));
    const logOffset = fs.statSync(log).size;
    const fd = fs.openSync(log, 'a');
    let child;
    try {
      child = spawn(npx, [
        '--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'preview',
        '--port', String(requestedPort), '--force-new',
      ], {
        cwd, detached: true, stdio: ['ignore', fd, fd],
      });
    } finally {
      fs.closeSync(fd);
    }
    let actualPort;
    let previewState;
    try {
      if (!child.pid) throw new Error('preview process did not publish a pid');
      previewState = {
        schema: PREVIEW_STATE_SCHEMA,
        nonce: crypto.randomUUID(),
        status: 'recovery',
        pid: child.pid,
        started: null,
        portIntent: port == null ? 'auto' : 'explicit',
        requestedPort,
        actualPort: null,
      };
      // Even if process identity lookup itself fails, the detached PID remains
      // tracked in a fail-closed recovery tombstone rather than becoming an
      // invisible process that later code might signal unsafely.
      writePreviewState(pid, previewState);
      fs.writeFileSync(pid, `${child.pid}\n`);
      fs.writeFileSync(portIntentFileFor(pid), `${previewState.portIntent}\n`);
      const started = processStartIdentity(child.pid);
      if (!started) throw new Error(`could not establish preview process identity for pid ${child.pid}`);
      previewState = {
        ...previewState,
        status: 'starting',
        started,
      };
      // The authoritative record is visible before readiness. If Narova is
      // interrupted, a later stop can still identify and recover this group.
      writePreviewState(pid, previewState);
      actualPort = await waitForPreviewReady(child, log, logOffset, startupTimeoutMs);
      if (port != null && actualPort !== port) {
        throw new Error(`port ${port} is in use — preview bound port ${actualPort} instead; stop the conflicting process or choose a different port`);
      }
      if (!child.pid || !previewGroupIsLive(child.pid)) throw new Error('preview exited immediately after readiness');
      const portFile = portFileFor(pid);
      const intentFile = portIntentFileFor(pid);
      fs.writeFileSync(portFile, `${actualPort}\n`);
      fs.writeFileSync(pid, `${child.pid}\n`);
      previewState = { ...previewState, status: 'ready', actualPort };
      writePreviewState(pid, previewState);
      if (!previewGroupIsLive(child.pid)) throw new Error('preview exited while committing state');
      child.unref();
      return {
        pid: child.pid, pidFile: pid, portFile, intentFile, stateFile: stateFileFor(pid),
        logFile: log, port: actualPort, url: previewUrl(cwd, actualPort, projectName),
      };
    } catch (error) {
      let cleanupConfirmed = !child.pid || !previewGroupIsLive(child.pid);
      if (child.pid && previewGroupIsLive(child.pid)) {
        const retainRecovery = message => {
          previewState = {
            ...previewState, status: 'recovery',
            actualPort: Number.isInteger(actualPort) ? actualPort : null,
          };
          writePreviewState(pid, previewState);
          if (Number.isInteger(actualPort)) fs.writeFileSync(portFileFor(pid), `${actualPort}\n`);
          fs.writeFileSync(pid, `${child.pid}\n`);
          child.unref();
          throw new Error(message);
        };
        const cleanupIdentity = previewState?.started && processStartIdentity(child.pid);
        if (!cleanupIdentity || cleanupIdentity !== previewState.started) {
          retainRecovery(`${error.message}; preview process identity could not be verified for cleanup — recovery state retained at ${pid}`);
        }
        try {
          process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM');
          await waitForPreviewExit(child.pid, PREVIEW_STOP_TIMEOUT_MS);
          cleanupConfirmed = true;
        } catch (termError) {
          const killIdentity = processStartIdentity(child.pid);
          if (!killIdentity || killIdentity !== previewState.started) {
            retainRecovery(`${error.message}; preview process identity could not be reverified after failed shutdown (${termError.message}) — recovery state retained at ${pid}`);
          }
          try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch {}
          try {
            await waitForPreviewExit(child.pid, 1000);
            cleanupConfirmed = true;
          } catch {
            retainRecovery(`${error.message}; preview cleanup could not be confirmed (${termError.message}) — recovery state retained at ${pid}`);
          }
        }
      }
      if (cleanupConfirmed) clearPreviewState(pid, previewState?.nonce ?? null);
      throw error;
    }
  } finally {
    releaseStateLock();
  }
}

function portFileFor(pidFile) {
  return pidFile.replace(/\.pid$/, '') + '.port';
}

function portIntentFileFor(pidFile) {
  return `${portFileFor(pidFile)}.intent`;
}

function directPreviewPort(pidFile) {
  const f = portFileFor(pidFile);
  if (!fs.existsSync(f)) return null;
  const port = Number(fs.readFileSync(f, 'utf8').trim());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function directPortIntent(pidFile) {
  try {
    return fs.readFileSync(portIntentFileFor(pidFile), 'utf8').trim() === 'explicit' ? 'explicit' : 'auto';
  } catch {
    return 'auto';
  }
}

/* The port a detached preview was started with, or null if unknown. */
function previewPort(pidFile) {
  const state = readPreviewState(pidFile);
  if (!state) return null;
  if (state.schema === 'legacy') return directPreviewPort(pidFile);
  return state.portIntent === 'explicit' ? state.requestedPort : state.actualPort;
}

function previewPortIntent(pidFile) {
  const state = readPreviewState(pidFile);
  if (!state) return 'auto';
  return state.schema === 'legacy' ? directPortIntent(pidFile) : state.portIntent;
}

async function waitForPreviewExit(pid, timeoutMs = PREVIEW_STOP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!previewGroupIsLive(pid)) return;
    await delay(25);
  }
  if (!previewGroupIsLive(pid)) return;
  throw new Error(`preview shutdown timed out waiting for process group ${pid} to exit`);
}

async function stopHfPreview(pidFile, { timeoutMs = PREVIEW_STOP_TIMEOUT_MS } = {}) {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  const releaseStateLock = acquirePreviewStateLock(pidFile);
  try {
    const state = readPreviewState(pidFile);
    if (!state) return false;
    const liveness = previewStateLiveness(state);
    if (liveness === 'dead' || liveness === 'mismatch') {
      clearPreviewState(pidFile, state.nonce);
      return false;
    }
    if (liveness === 'unverified') {
      throw new Error(`preview process identity for pid ${state.pid} cannot be verified; state retained for manual recovery`);
    }
    const pid = state.pid;
    try {
      process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM');
    } catch (e) {
      if (e.code !== 'ESRCH') throw e;
    }
    await waitForPreviewExit(pid, timeoutMs);
    clearPreviewState(pidFile, state.nonce);
    return true;
  } finally {
    releaseStateLock();
  }
}

module.exports = {
  HYPERFRAMES_VERSION, runHf, npxSync, previewUrl,
  startHfPreview, stopHfPreview, livePreviewPid, previewPort, previewPortIntent,
};
