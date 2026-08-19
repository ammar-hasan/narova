'use strict';
/* First-run readiness and provisioning (NAR-SPEC-021).
 *
 * Owns the visible-progress contract (NAR-021-008): a plan line before any
 * byte moves, heartbeat activity during every wait, labeled estimates, a
 * documented inactivity timeout, and liveness lines when stdout is not a
 * terminal — never an unexplained silent gap.
 *
 * Owns provisioning integrity (NAR-021-003): pinned sources, streamed
 * digest verification, staged `.part` files with atomic commit, rollback
 * to prior state on any failure, and idempotent re-runs (NAR-021-007).
 *
 * Owns the readiness matrix probe (NAR-021-002): find-first — environment
 * overrides, then PATH/known locations, then user storage. Never shadows a
 * working user installation.
 *
 * Zero external dependencies: transfers use node https with redirect
 * following; hashes stream through crypto. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const NAROVA_HOME = process.env.NAROVA_HOME || path.join(os.homedir(), '.narova');
const TOOLS_DIR = path.join(NAROVA_HOME, 'tools');

/* Documented pacing knobs (NAR-021-008 acceptance cites these). */
const HEARTBEAT_MS = 250;      // TTY redraw interval while a wait is active
const LIVENESS_MS = 3000;      // non-TTY line interval so logs show life
const STALL_TIMEOUT_MS = 20000;// no bytes for this long -> abort + report
const MAX_REDIRECTS = 5;
const MIN_NODE_MAJOR = 18;     // substrate minimum (NAR-021-001)

function formatBytes(n) {
  if (!Number.isFinite(n)) return '? B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSeconds(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/* ------------------------------------------------------------------ *
 * ProgressView — NAR-021-008 renderer.                                *
 * ------------------------------------------------------------------ */

class ProgressView {
  /* out: a writable stream (process.stdout or a test double). */
  constructor(out = process.stdout, opts = {}) {
    this.out = out;
    this.tty = Boolean(out.isTTY) && !process.env.CI;
    this.color = this.tty && !process.env.NO_COLOR;
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    this.livenessMs = opts.livenessMs ?? LIVENESS_MS;
    this.spin = ['◐', '◓', '◑', '◒'];
    this._spinIdx = 0;
    this._lineOpen = false;     // a status line occupies the current row
    this._lastLiveAt = 0;       // last non-TTY liveness emission
    this._lastDrawAt = 0;       // last TTY throttled redraw
    this._timer = null;
    this._active = null;        // { label, index, total, bytes, totalBytes, startedAt }
  }

  _write(s) { this.out.write(s); }

  _mark(sym, text) {
    const mark = this.color ? sym : { '✓': '[ok]', '◐': '[..]', '✗': '[FAIL]', '…': '[..]' }[sym] || sym;
    return `${mark} ${text}`;
  }

  /* Close any open status line so a fresh full line can start. */
  _closeLine() {
    if (this._lineOpen && this.tty) this._write('\r\x1b[2K');
    else if (this._lineOpen) this._write('\n');
    this._lineOpen = false;
  }

  _fullLine(text) {
    this._closeLine();
    this._write(`${text}\n`);
  }

  /* NAR-021-008: the pending plan before any acquisition begins. */
  plan(items) {
    const total = items.reduce((a, i) => a + (i.bytes || 0), 0);
    const anyUnknown = items.some((i) => !i.bytes);
    this._fullLine(`Narova first-run setup — ${items.length} item${items.length === 1 ? '' : 's'} to set up`
      + `${items.length ? ` (about ${formatBytes(total)}${anyUnknown ? ' + unknown-size items' : ''})` : ''}`);
    items.forEach((item, i) => {
      this._fullLine(`  ${i + 1}. ${item.label}  ${item.bytes ? `~${formatBytes(item.bytes)}` : 'size unknown'}`);
    });
  }

  /* A found item: credited immediately with its resolution (NAR-021-002). */
  ok(label, detail) { this._fullLine(this._mark('✓', detail ? `${label} — ${detail}` : label)); }

  /* A neutral informational line — never a success mark on a missing item
   * (adversarial-review F3). */
  note(label, detail) { this._fullLine(`› ${label}${detail ? ` — ${detail}` : ''}`); }

  itemStart(label, index, total) {
    this._closeLine();
    this._active = { label, index, total, bytes: 0, totalBytes: null, startedAt: Date.now() };
    this._draw();
    this._startClock();
  }

  /* Feed transfer state; totalBytes may be null (unknown size — never invented). */
  itemProgress(p) {
    if (!this._active) return;
    if (Number.isFinite(p.bytes)) this._active.bytes = p.bytes;
    if (p.totalBytes !== undefined) this._active.totalBytes = p.totalBytes;
    if (this.tty) this._drawThrottled();
    else this._liveness();
  }

  itemOk(label, detail) {
    this._stopClock();
    const a = this._active;
    const took = a ? formatSeconds(Date.now() - a.startedAt) : null;
    this._active = null;
    this._fullLine(this._mark('✓', `${label}${detail ? ` — ${detail}` : ''}${took ? ` (${took})` : ''}`));
  }

  /* NAR-021-008 failure shape: item named, context, single next action. */
  itemFail(label, message, next) {
    this._stopClock();
    this._active = null;
    this._fullLine(this._mark('✗', `${label} — ${message}`));
    if (next) this._fullLine(`  next: ${next}`);
  }

  _startClock() {
    this._stopClock();
    this._timer = setInterval(() => {
      if (this.tty) this._draw();
      else this._liveness(true);
    }, this.tty ? this.heartbeatMs : this.livenessMs);
    if (this._timer.unref) this._timer.unref();
  }

  _stopClock() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _liveness(force = false) {
    const now = Date.now();
    if (!force && now - this._lastLiveAt < this.livenessMs) return;
    this._lastLiveAt = now;
    this._write(`${this._mark('…', this._statusText())}\n`);
  }

  _drawThrottled() {
    const now = Date.now();
    if (now - this._lastDrawAt < this.heartbeatMs) return;
    this._lastDrawAt = now;
    this._draw();
  }

  _draw() {
    if (!this._active) return;
    const line = this._statusText();
    if (this.tty) {
      this._write(`\r\x1b[2K${this._mark('◐', line)}`);
      this._lineOpen = true;
    }
  }

  _statusText() {
    const a = this._active;
    const pos = a.total > 1 ? `${a.index}/${a.total} ` : '';
    const elapsed = Date.now() - a.startedAt;
    if (a.totalBytes) {
      const rate = elapsed > 0 ? a.bytes / (elapsed / 1000) : 0;
      const left = rate > 0 ? (a.totalBytes - a.bytes) / rate : Infinity;
      return `${pos}${a.label}   ${formatBytes(a.bytes)} / ${formatBytes(a.totalBytes)}   `
        + `${formatBytes(rate)}/s   ~${Number.isFinite(left) ? formatSeconds(left * 1000) : '?'} left`;
    }
    const spin = this.spin[this._spinIdx++ % this.spin.length];
    return `${pos}${a.label}   ${spin} ${formatSeconds(elapsed)} elapsed   ${formatBytes(a.bytes)} received (size unknown)`;
  }
}

/* ------------------------------------------------------------------ *
 * Acquire — pinned source, streamed digest, staged commit (NAR-021-003).*
 * ------------------------------------------------------------------ */

class StallError extends Error {
  constructor(url, bytes) {
    super(`no data for over ${Math.round(STALL_TIMEOUT_MS / 1000)}s from ${url} (${formatBytes(bytes)} received)`);
    this.code = 'NAROVA_STALL';
    this.bytes = bytes;
  }
}

/* GET url following redirects; stream to dest.part while hashing; verify
 * the REQUIRED digest and optional size; atomically rename to dest. Deletes
 * the staged file on every failure path so no partial is ever resolvable
 * (NAR-021-003). The digest is mandatory (adversarial-review F1): an
 * acquisition without a recorded digest fails closed rather than skipping
 * verification. Progress is reported through the view's active item. */
function acquireFile(url, dest, { sha256, bytes: expectedBytes, view } = {}) {
  return new Promise((resolve, reject) => {
    if (!sha256 || !/^[0-9a-f]{64}$/i.test(sha256)) {
      return reject(new Error(`refusing to acquire ${url} without a recorded sha256 digest (fail closed)`));
    }
    const part = `${dest}.part`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const hash = crypto.createHash('sha256');
    let received = 0;
    let totalBytes = null;
    let lastDataAt = Date.now();
    let closed = false;

    const fail = (err) => {
      if (closed) return;
      closed = true;
      clearInterval(stallTimer);
      try { currentReq.destroy(); } catch { /* already gone */ }
      fs.unlink(part, () => reject(err));
    };

    const stallTimer = setInterval(() => {
      if (Date.now() - lastDataAt > STALL_TIMEOUT_MS) fail(new StallError(url, received));
    }, 500);
    if (stallTimer.unref) stallTimer.unref();

    const onResponse = (res) => {
      try {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return fail(new Error(`too many redirects from ${url}`));
          redirects += 1;
          // Location may be relative (HF uses this) — resolve against the
          // current request URL (sandbox finding F8).
          const next = new URL(res.headers.location, targetRef.url).href;
          return get(next);
        }
        if (res.statusCode !== 200) {
          return fail(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
        const len = parseInt(res.headers['content-length'] || '', 10);
        totalBytes = Number.isFinite(len) && len > 0 ? len : expectedBytes || null;
        res.on('data', (chunk) => {
          lastDataAt = Date.now();
          received += chunk.length;
          hash.update(chunk);
          if (view) view.itemProgress({ bytes: received, totalBytes });
        });
        res.on('error', fail);
        // Commit hangs off the WRITE stream's finish, never the response's
        // 'end': 'end' fires before piped data is flushed, so renaming there
        // races the file's own contents (test-suite finding F9).
        const ws = fs.createWriteStream(part);
        ws.on('error', fail);
        ws.on('finish', () => {
          if (closed) return;
          clearInterval(stallTimer);
          try {
            const digest = hash.digest('hex');
            if (sha256 && digest !== sha256) {
              return fail(new Error(`digest mismatch for ${url}: expected ${sha256}, got ${digest}`));
            }
            if (expectedBytes && received !== expectedBytes) {
              return fail(new Error(`size mismatch for ${url}: expected ${expectedBytes}, got ${received}`));
            }
            fs.renameSync(part, dest);
            closed = true;
            resolve({ bytes: received, sha256: digest, totalBytes });
          } catch (err) {
            fail(err);
          }
        });
        res.pipe(ws);
      } catch (err) {
        fail(err); // unexpected throw inside a stream callback must not crash the process
      }
    };

    let redirects = 0;
    let currentReq = null;
    const targetRef = { url };
    const get = (target) => {
      targetRef.url = target;
      const mod = String(target).startsWith('http:') ? http : https;
      currentReq = mod.get(target, (res) => onResponse(res));
      currentReq.on('error', fail);
      return currentReq;
    };
    const req = get(url);
  });
}

/* Idempotent user-storage file item (NAR-021-007): an existing artifact
 * whose digest matches is never re-acquired. The tools directory is
 * resolved per call so NAROVA_HOME is always honored. */
async function provisionFile(item, view) {
  const toolsDir = process.env.NAROVA_HOME || path.join(os.homedir(), '.narova');
  const dest = path.join(toolsDir, 'tools', item.relativePath);
  if (fs.existsSync(dest)) {
    const cur = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
    if (!item.sha256 || cur === item.sha256) {
      if (view) view.ok(item.label, `already provisioned (${formatBytes(fs.statSync(dest).size)})`);
      return { bytes: 0, reused: true, path: dest };
    }
    fs.unlinkSync(dest); // stale pin — replace through the staged path
  }
  const r = await acquireFile(item.url, dest, { sha256: item.sha256, bytes: item.bytes, view });
  return { bytes: r.bytes, reused: false, path: dest };
}

/* ------------------------------------------------------------------ *
 * Readiness matrix — find-first probes (NAR-021-002).                 *
 * ------------------------------------------------------------------ */

function probeSubstrate() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE_MAJOR) {
    return { id: 'substrate', label: `Node ${MIN_NODE_MAJOR}+`, status: 'needs-user-action',
      reason: `Node ${process.versions.node} is below the minimum`,
      next: `install Node ${MIN_NODE_MAJOR} or newer from https://nodejs.org and run this again` };
  }
  return { id: 'substrate', label: `Node ${MIN_NODE_MAJOR}+`, status: 'satisfied', resolved: process.execPath, detail: process.version };
}

function probeMedia() {
  const ffmpeg = process.env.NAROVA_FFMPEG || 'ffmpeg';
  const ffprobe = process.env.NAROVA_FFPROBE || 'ffprobe';
  /* A working tool is identified by its own version banner — a merely
   * runnable binary (any exit-0 program) MUST NOT satisfy the item. */
  const probe = (bin, banner) => {
    const r = spawnSync(bin, ['-version'], { encoding: 'utf8', timeout: 10000 });
    if (r.status !== 0 || !r.stdout) return null;
    const first = (r.stdout.split('\n')[0] || '').trim();
    return first.toLowerCase().startsWith(banner) ? first : null;
  };
  const fv = probe(ffmpeg, 'ffmpeg version');
  const pv = probe(ffprobe, 'ffprobe version');
  if (fv && pv) {
    const overridden = Boolean(process.env.NAROVA_FFMPEG || process.env.NAROVA_FFPROBE);
    return { id: 'media', label: 'media tool (ffmpeg + ffprobe)', status: 'satisfied',
      resolved: ffmpeg, detail: `${fv.split(' ')[2] || ''}${overridden ? ' (environment override)' : ''}`.trim() };
  }
  /* Find-first continues into Narova user storage: a previously provisioned
   * pin with a matching marker is used before any provisioning (NAR-021-002,
   * NAR-021-007). Lazy require avoids a cycle: acquisition imports readiness. */
  const { mediaPinFor, mediaInstallDir, mediaMarkerOk } = require('./acquisition');
  const pin = mediaPinFor();
  const root = mediaInstallDir(pin);
  if (pin && root && mediaMarkerOk(root, pin)) {
    const binDir = path.join(root, 'bin');
    return { id: 'media', label: 'media tool (ffmpeg + ffprobe)', status: 'satisfied',
      resolved: binDir, binDir, detail: `provisioned (${pin.id})` };
  }
  if (pin) return { id: 'media', label: 'media tool (ffmpeg + ffprobe)', status: 'auto-provisionable' };
  const { mediaGuidance } = require('./acquisition');
  return { id: 'media', label: 'media tool (ffmpeg + ffprobe)', status: 'needs-user-action',
    reason: 'no digest-verified ffmpeg source is recorded for this platform',
    next: mediaGuidance() };
}

function probeSpeechRuntime() {
  const python = process.env.NAROVA_PYTHON
    || ['python3', 'python'].map((c) => spawnSync(c, ['-c', 'import sys;print(1)']).status === 0 ? c : null).find(Boolean);
  if (!python) {
    return { id: 'speech', label: 'local voice backend', status: 'needs-user-action',
      reason: 'no Python 3.10+ interpreter found',
      next: 'install Python 3.10+ (e.g. from https://python.org) and run this again' };
  }
  return { id: 'speech', label: 'local voice backend', status: 'satisfied', resolved: python, detail: 'piper runtime host' };
}

/* The pinned demo voice (single source of truth — the readiness probe and
 * the acquisition manifest MUST agree, adversarial-review F2). piper en_US
 * voices are all ~60 MB; medium keeps the familiar README voice at the
 * smallest reliable quality. Digests computed at pin time. */
const PIPER_VOICE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/ryan/medium';
const DEMO_VOICE = {
  id: 'voice',
  label: 'local voice (en_US-ryan-medium)',
  dataDir: () => process.env.NAROVA_PIPER_DIR || path.join(os.homedir(), '.cache', 'narova', 'piper'),
  files: [
    { name: 'en_US-ryan-medium.onnx', url: `${PIPER_VOICE_BASE}/en_US-ryan-medium.onnx`,
      sha256: 'abf4c274862564ed647ba0d2c47f8ee7c9b717d27bdad9219100eb310db4047a', bytes: 63201294 },
    { name: 'en_US-ryan-medium.onnx.json', url: `${PIPER_VOICE_BASE}/en_US-ryan-medium.onnx.json`,
      sha256: '44034c056cb15681b2ad494307c7f3f2e4499d1253c700c711fa0a4607ffe78d', bytes: 4883 },
  ],
};

function probeVoice() {
  const dir = DEMO_VOICE.dataDir();
  /* Satisfied only when BOTH pinned files exist with matching digests —
   * a stale or truncated cache entry must not suppress provisioning. */
  const complete = DEMO_VOICE.files.every((f) => {
    const p = path.join(dir, f.name);
    if (!fs.existsSync(p)) return false;
    const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    return h === f.sha256;
  });
  return { id: 'voice', label: DEMO_VOICE.label, status: complete ? 'satisfied' : 'auto-provisionable',
    resolved: complete ? dir : undefined, detail: complete ? dir : undefined };
}

function probeRenderer() {
  // The pinned engine is fetched by npx on demand at build time; an existing
  // cache is credited but never trusted as the pin itself — the pin is
  // verified when the build resolves it (NAR-021-002: find-first, report).
  const label = 'renderer toolchain (hyperframes)';
  const npxCache = process.env.npm_config_cache || path.join(os.homedir(), '.npm', '_npx');
  let cached = false;
  try { fs.readdirSync(npxCache); cached = true; } catch { /* absent — normal on a clean machine */ }
  return { id: 'renderer', label, status: 'auto-provisionable',
    detail: cached ? `npx cache present — engine pin fetched on first build` : undefined };
}

/* Evaluate the full matrix. Pure probe — no network, no mutation. */
function readinessMatrix() {
  return [probeSubstrate(), probeMedia(), probeSpeechRuntime(), probeVoice(), probeRenderer()];
}

/* Neat human rendering of the matrix (doctor parity, NAR-021-007). */
function formatMatrix(items) {
  const rows = items.map((i) => {
    const mark = i.status === 'satisfied' ? '✓' : i.status === 'auto-provisionable' ? '◐' : '✗';
    const where = i.detail || i.resolved || (i.status === 'needs-user-action' ? i.reason : 'will be set up automatically');
    return `  ${mark} ${i.label} — ${where}`;
  });
  return ['Readiness:', ...rows].join('\n');
}

module.exports = {
  ProgressView, acquireFile, provisionFile, readinessMatrix, formatMatrix,
  formatBytes, formatSeconds, StallError, DEMO_VOICE,
  HEARTBEAT_MS, LIVENESS_MS, STALL_TIMEOUT_MS, MIN_NODE_MAJOR, TOOLS_DIR,
};
