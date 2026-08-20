'use strict';
/* HyperFrames CLI access. narova stays zero-dep: every call goes through
 * `npx --yes hyperframes@<PIN>` so the engine version is reproducible. The same
 * pin is written into the generated out/hf/package.json. */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const net = require('net');
const { isActive: machineActive } = require('./machine');

const HYPERFRAMES_VERSION = '0.7.96';

const RETRY_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

/* Check if a TCP port is available on localhost. Uses a quick connection
 * attempt — if the connection succeeds, the port is in use. */
function isPortAvailable(port) {
  let available = true;
  const server = net.createServer();
  server.once('error', () => {
    available = false;
    server.close();
  });
  server.once('listening', () => server.close());
  server.listen(port, '127.0.0.1');
  server.unref();
  return available;
}

/* Find an available TCP port starting from the given port. */
function findAvailablePort(startPort = 3002, maxAttempts = 10) {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    if (isPortAvailable(port)) return port;
  }
  return startPort; // fallback — let hyperframes report the error
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
  if (!fs.existsSync(pidFile)) return null;
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`invalid preview pid file: ${pidFile}`);
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    if (e.code !== 'ESRCH') return pid;
    // Process is gone: clear both its pid and its remembered-port sidecar.
    fs.rmSync(pidFile, { force: true });
    fs.rmSync(portFileFor(pidFile), { force: true });
    return null;
  }
}

/* Start Studio in its own process group so an agent shell can return without
 * reaping the preview server. Logs and the process id live outside out/hf,
 * which compose replaces on every run. */
function startHfPreview(cwd, { port, logFile, pidFile, projectName } = {}) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const log = logFile || path.join(path.dirname(cwd), 'preview.log');
  const pid = pidFile || path.join(path.dirname(cwd), 'preview.pid');
  const existing = livePreviewPid(pid);
  if (existing) throw new Error(`preview already running (pid ${existing}); stop it before starting another`);
  // Find available port — auto-detect if none specified, or validate the given one.
  const requestedPort = port || 3002;
  const actualPort = port != null
    ? (isPortAvailable(port) ? port : (() => { throw new Error(`port ${port} is in use — stop the conflicting process or choose a different port`); })())
    : findAvailablePort(requestedPort, 50);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'a');
  const child = spawn(npx, ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'preview', '--port', String(actualPort)], {
    cwd, detached: true, stdio: ['ignore', fd, fd],
  });
  fs.closeSync(fd);
  child.unref();
  fs.writeFileSync(pid, `${child.pid}\n`);
  const portFile = portFileFor(pid);
  fs.writeFileSync(portFile, `${actualPort}\n`);
  return { pid: child.pid, pidFile: pid, portFile, logFile: log, port: actualPort, url: previewUrl(cwd, actualPort, projectName) };
}

function portFileFor(pidFile) {
  return pidFile.replace(/\.pid$/, '') + '.port';
}

/* The port a detached preview was started with, or null if unknown. */
function previewPort(pidFile) {
  const f = portFileFor(pidFile);
  if (!fs.existsSync(f)) return null;
  const port = Number(fs.readFileSync(f, 'utf8').trim());
  return Number.isInteger(port) && port > 0 ? port : null;
}

function stopHfPreview(pidFile) {
  if (!fs.existsSync(pidFile)) return false;
  const pid = livePreviewPid(pidFile);
  if (!pid) return false;
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM');
  } catch (e) {
    if (e.code !== 'ESRCH') throw e;
  }
  fs.rmSync(pidFile, { force: true });
  fs.rmSync(portFileFor(pidFile), { force: true });
  return true;
}

module.exports = { HYPERFRAMES_VERSION, runHf, npxSync, previewUrl, startHfPreview, stopHfPreview, livePreviewPid, previewPort };
