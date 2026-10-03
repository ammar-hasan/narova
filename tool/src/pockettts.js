'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const worker = path.join(__dirname, '..', 'py', 'narova_tts', 'pockettts_worker.py');
const rawCatalog = require('../py/narova_tts/pockettts_catalog.json');
const FILE_OPTIONS = Object.freeze(['referenceAudio', 'voiceState', 'config', 'weights', 'tokenizer', 'flowWeights', 'codecWeights', 'nonCloningWeights']);
const catalog = {
  ...rawCatalog,
  languages: { en: 'english_2026-09', fr: 'french', de: 'german', es: 'spanish', it: 'italian', pt: 'portuguese', nl: 'dutch' },
  models: Object.fromEntries(Object.entries(rawCatalog.models).map(([id, model]) => [id, { ...model, preview: model.layers === 24 }])),
};

function pocketPython(env = process.env) {
  return path.join(env.NAROVA_POCKETTTS_VENV || path.join(env.NAROVA_HOME || path.join(os.homedir(), '.narova'), 'venv-pockettts'), 'bin', 'python');
}
function pocketRuntime(env = process.env) {
  const python = pocketPython(env);
  const guidance = 'run narova-setup --pockettts (Python 3.12)';
  if (!fs.existsSync(python)) return { ok: false, providerVersion: 'pockettts:runtime-missing', detail: `not installed — ${guidance}` };
  const result = spawnSync(python, [worker, 'version'], { env, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer: 16384 });
  try {
    if (result.error || result.status !== 0) throw new Error('unavailable');
    const profile = JSON.parse(result.stdout);
    if (typeof profile.providerVersion !== 'string' || !profile.providerVersion) throw new Error('invalid profile');
    return { ok: true, ...profile, detail: `${profile.providerVersion} (${python}); model/cloning readiness untested` };
  } catch {
    return { ok: false, providerVersion: 'pockettts:runtime-unavailable', detail: `incompatible or incomplete runtime at ${python} — ${guidance}` };
  }
}
function helperTimeoutMs(env) {
  const seconds = Number(env.NAROVA_POCKETTTS_TIMEOUT ?? env.NAROVA_PROVIDER_TIMEOUT ?? '120');
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) throw new Error('NAROVA_POCKETTTS_TIMEOUT (or NAROVA_PROVIDER_TIMEOUT) must be positive finite seconds up to 86400');
  return Math.max(1, Math.ceil(seconds * 1000));
}

/* Explicit model helpers use a separate lifecycle from utterance workers.
 * Bound both output channels, keep machine diagnostics redacted as complete
 * text, and enforce cleanup even when the child ignores graceful termination. */
function runPocketHelper(sub, args, { env = process.env, diagnostic = text => process.stderr.write(text), heartbeatMs = 5000 } = {}) {
  const timeout = helperTimeoutMs(env);
  const selection = name => { const index = args.indexOf(`--${name}`); return index < 0 ? null : args[index + 1]; };
  diagnostic(`Pocket ${sub}: model ${selection('model') || 'english_2026-09'}, voice ${selection('speaker') || 'alba'}${selection('reference') ? ' with reference audio' : ''}; resources may be acquired (size unknown); deadline ${timeout / 1000}s.\n`);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(pocketPython(env), [worker, sub, ...args], {
      env: { ...env, ...(env.NAROVA_POCKETTTS_OFFLINE === '1' ? { HF_HUB_OFFLINE: '1' } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true,
    });
    let failure = null, killTimer = null, stdoutBytes = 0, stderrBytes = 0;
    const stdout = [], stderr = [];
    const signal = name => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, name);
        else child.kill(name);
      } catch (error) { if (error.code !== 'ESRCH') child.kill(name); }
    };
    const abort = error => {
      if (failure) return;
      failure = error;
      signal('SIGTERM');
      killTimer = setTimeout(() => signal('SIGKILL'), 250);
    };
    const interrupt = () => abort(new Error(`Pocket ${sub} interrupted; retry when ready`));
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    const heartbeat = setInterval(() => diagnostic(`Pocket ${sub}: still working (${((Date.now() - started) / 1000).toFixed(1)}s elapsed).\n`), heartbeatMs);
    const deadline = setTimeout(() => abort(new Error(`Pocket ${sub} timed out after ${timeout / 1000}s; retry with acquired resources offline or increase NAROVA_POCKETTTS_TIMEOUT`)), timeout);
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 1024 * 1024) abort(new Error(`Pocket ${sub} failed: stdout exceeds 1 MiB`));
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > 1024 * 1024) {
        // A truncated credential cannot be redacted by its complete known
        // value. Withhold the entire over-limit stream rather than replaying
        // its retained prefix into human or machine diagnostics.
        stderr.length = 0;
        abort(new Error(`Pocket ${sub} failed: stderr exceeds 1 MiB`));
      }
      else stderr.push(chunk);
    });
    // A helper can exit before its descendants. Terminate its owned group at
    // exit, even if graceful shutdown already closed our pipes; cancelling the
    // escalation timer alone would leave TERM-resistant descendants running.
    child.on('exit', () => signal('SIGKILL'));
    child.on('error', error => { failure = new Error(`Pocket ${sub} failed to start: ${error.message}`); });
    child.on('close', async status => {
      clearInterval(heartbeat); clearTimeout(deadline); clearTimeout(killTimer);
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
      if (process.platform !== 'win32' && child.pid) {
        // Give the OS a bounded interval to reap killed group members before
        // publishing the completion result. Never signal a reused PID here.
        for (let attempts = 0; attempts < 12; attempts++) {
          try { process.kill(-child.pid, 0); } catch { break; }
          await new Promise(done => setTimeout(done, 20));
        }
      }
      const detail = stderrBytes > 1024 * 1024 ? '' : Buffer.concat(stderr).toString('utf8');
      if (detail) diagnostic(detail);
      if (failure) reject(failure);
      else if (status !== 0) reject(new Error(`Pocket ${sub} failed; see diagnostics above; for missing runtime packages run narova-setup --pockettts`));
      else {
        try {
          const result = JSON.parse(Buffer.concat(stdout).toString('utf8'));
          if (!result || typeof result !== 'object' || Array.isArray(result) || result.ok !== true) throw new Error('expected successful result');
          if (sub !== 'export-voice') diagnostic(`Pocket ${sub}: completed.\n`);
          resolve(result);
        } catch { reject(new Error(`Pocket ${sub} failed: invalid helper result`)); }
      }
    });
  });
}

function exportDestination(output) {
  const dest = path.resolve(output);
  if (!fs.statSync(path.dirname(dest)).isDirectory()) throw new Error('Pocket export output: parent directory is missing');
  let stat;
  try { stat = fs.lstatSync(dest); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Pocket export output: refuse symbolic link or nonregular destination');
  }
  return dest;
}

async function exportPocketVoice(output, args, options) {
  const dest = exportDestination(output);
  const stage = fs.mkdtempSync(path.join(path.dirname(dest), '.narova-pocket-export-'));
  const pending = path.join(stage, 'voice.safetensors');
  let published = false;
  try {
    const result = await runPocketHelper('export-voice', [...args, '--output', pending], options);
    const stat = fs.lstatSync(pending);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 256 * 1024 * 1024 || result.output !== pending
        || !/^[a-f0-9]{64}$/.test(result.sha256 || '')) throw new Error('Pocket export failed: invalid staged state');
    // Hash in chunks; exported conditioning can be hundreds of MiB.
    const hash = crypto.createHash('sha256'), fd = fs.openSync(pending, 'r');
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      let count;
      while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    } finally { fs.closeSync(fd); }
    if (hash.digest('hex') !== result.sha256) throw new Error('Pocket export failed: staged state digest mismatch');
    exportDestination(dest);
    fs.renameSync(pending, dest);
    published = true;
    if (options?.diagnostic) options.diagnostic('Pocket export-voice: completed.\n');
    return { ...result, output: dest };
  } finally {
    try { fs.rmSync(stage, { recursive: true, force: true }); }
    catch (error) {
      if (!published) throw error;
      if (options?.diagnostic) options.diagnostic(`Pocket export-voice: state committed; could not remove private stage (${error.message}).\n`);
    }
  }
}

module.exports = { pocketPython, pocketRuntime, worker, catalog, FILE_OPTIONS, helperTimeoutMs, runPocketHelper, exportPocketVoice };
