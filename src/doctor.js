'use strict';
/* Environment checks for the toolchain: ffmpeg/ffprobe (Python audio chain),
 * the python venv + narova_tts module, and the HyperFrames CLI via npx.
 * Chrome is no longer checked — HyperFrames provisions its own browser. */
const path = require('path');
const { spawnSync } = require('child_process');
const { which } = require('./util');
const { findPython } = require('./pipeline');
const { HYPERFRAMES_VERSION } = require('./hf');

// narova_tts is provided from the repo's py/ dir via PYTHONPATH (not pip-installed
// into the venv) — mirror exactly what pipeline.synth sets, or the check false-negatives.
const PY_ENV = { ...process.env, PYTHONPATH: path.join(__dirname, '..', 'py') };

function pyOk(py) {
  const r = spawnSync(py, ['-c', 'import sys;print(sys.version.split()[0])'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
function pyHasModule(py) {
  const r = spawnSync(py, ['-c', 'import importlib.util,sys;sys.exit(0 if importlib.util.find_spec("narova_tts") else 1)'], { env: PY_ENV });
  return r.status === 0;
}
function hfOk() {
  const r = spawnSync('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, '--version'],
    { encoding: 'utf8', timeout: 300000 });
  return r.status === 0 ? (r.stdout || '').trim().split('\n').pop() : null;
}

function doctor(projectDir) {
  const rows = [];
  const add = (name, ok, detail) => rows.push({ name, ok, detail });

  const ffmpeg = which('ffmpeg');
  add('ffmpeg', !!ffmpeg, ffmpeg || 'not found — install via `brew install ffmpeg`');
  add('ffprobe', !!which('ffprobe'), which('ffprobe') || 'not found');

  const py = findPython(projectDir);
  const ver = pyOk(py);
  add('python', !!ver, ver ? `${py} (${ver})` : `${py} — not runnable`);
  if (ver) add('narova_tts module', pyHasModule(py), pyHasModule(py) ? 'importable' : 'not importable — run scripts/setup.sh');

  const npx = which('npx');
  add('npx', !!npx, npx || 'not found — install Node.js >= 18');
  if (npx) {
    console.log('checking npx hyperframes (first run downloads the CLI — may take a minute)...');
    const hv = hfOk();
    add('hyperframes CLI', !!hv, hv ? `hyperframes@${HYPERFRAMES_VERSION} (${hv})` : `npx hyperframes@${HYPERFRAMES_VERSION} failed`);
  }

  console.log('narova doctor\n');
  let allOk = true;
  for (const r of rows) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(20)} ${r.detail}`);
    if (!r.ok) allOk = false;
  }
  console.log('');
  console.log(allOk ? 'All required tools present.' : 'Some required tools are missing (see ✗ above).');
  return allOk;
}

module.exports = { doctor };
