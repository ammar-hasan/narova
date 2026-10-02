'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const worker = path.join(__dirname, '..', 'py', 'narova_tts', 'pockettts_worker.py');
const catalog = require('../py/narova_tts/pockettts_catalog.json');

function pocketPython(env = process.env) {
  return path.join(env.NAROVA_POCKETTTS_VENV || path.join(env.NAROVA_HOME || path.join(os.homedir(), '.narova'), 'venv-pockettts'), 'bin', 'python');
}
function pocketRuntime(env = process.env) {
  const python = pocketPython(env);
  const guidance = 'run narova-setup --pockettts (Python 3.12)';
  if (!fs.existsSync(python)) return { ok: false, providerVersion: 'pockettts:runtime-missing', detail: `not installed — ${guidance}` };
  const result = spawnSync(python, [worker, 'version'], { env, encoding: 'utf8', timeout: 10000, maxBuffer: 16384 });
  try {
    if (result.error || result.status !== 0) throw new Error('unavailable');
    const profile = JSON.parse(result.stdout);
    if (typeof profile.providerVersion !== 'string' || !profile.providerVersion) throw new Error('invalid profile');
    return { ok: true, ...profile, detail: `${profile.providerVersion} (${python}); model/cloning readiness untested` };
  } catch {
    return { ok: false, providerVersion: 'pockettts:runtime-unavailable', detail: `incompatible or incomplete runtime at ${python} — ${guidance}` };
  }
}
module.exports = { pocketPython, pocketRuntime, worker, catalog };
