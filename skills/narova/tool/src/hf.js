'use strict';
/* HyperFrames CLI access. narova stays zero-dep: every call goes through
 * `npx --yes hyperframes@<PIN>` so the engine version is reproducible. The same
 * pin is written into the generated out/hf/package.json. */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HYPERFRAMES_VERSION = '0.7.64';

/* Run a hyperframes CLI command in `cwd` (normally out/hf). Inherits stdio so
 * progress is visible. Throws on non-zero exit. */
function runHf(args, cwd, opts = {}) {
  const r = spawnSync('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], {
    cwd, stdio: 'inherit', ...opts,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`hyperframes ${args[0]} exited ${r.status}`);
  return r;
}

function previewUrl(cwd, port = 3002) {
  return `http://localhost:${port}/#project/${encodeURIComponent(path.basename(cwd))}`;
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
    fs.rmSync(pidFile, { force: true });
    return null;
  }
}

/* Start Studio in its own process group so an agent shell can return without
 * reaping the preview server. Logs and the process id live outside out/hf,
 * which compose replaces on every run. */
function startHfPreview(cwd, { port = 3002, logFile, pidFile } = {}) {
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const log = logFile || path.join(path.dirname(cwd), 'preview.log');
  const pid = pidFile || path.join(path.dirname(cwd), 'preview.pid');
  const existing = livePreviewPid(pid);
  if (existing) throw new Error(`preview already running (pid ${existing}); stop it before starting another`);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'a');
  const child = spawn(npx, ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, 'preview', '--port', String(port)], {
    cwd, detached: true, stdio: ['ignore', fd, fd],
  });
  fs.closeSync(fd);
  child.unref();
  fs.writeFileSync(pid, `${child.pid}\n`);
  // The port travels with the pid so a later `preview --detach` restart reuses
  // it without the caller passing --port again.
  fs.writeFileSync(portFileFor(pid), `${port}\n`);
  return { pid: child.pid, pidFile: pid, logFile: log, url: previewUrl(cwd, port) };
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

module.exports = { HYPERFRAMES_VERSION, runHf, previewUrl, startHfPreview, stopHfPreview, livePreviewPid, previewPort };
