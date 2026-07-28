'use strict';
/* Environment checks for the toolchain: ffmpeg/ffprobe (Python audio chain),
 * the python venv + narova_tts module, and the HyperFrames CLI via npx.
 * Chrome is no longer checked — HyperFrames provisions its own browser.
 * Optional features (align engines, chatterbox venv) are reported with ○ when
 * missing and never fail the check. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { which } = require('./util');
const { findPython } = require('./pipeline');
const { HYPERFRAMES_VERSION, npxSync } = require('./hf');

// narova_tts is provided from the repo's py/ dir via PYTHONPATH (not pip-installed
// into the venv) — mirror exactly what pipeline.synth sets, or the check false-negatives.
const PY_ENV = { ...process.env, PYTHONPATH: path.join(__dirname, '..', 'py') };

const NAROVA_HOME = process.env.NAROVA_HOME || path.join(os.homedir(), '.narova');

function pyOk(py) {
  const r = spawnSync(py, ['-c', 'import sys;print(sys.version.split()[0])'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}
function pyHasModule(py) {
  const r = spawnSync(py, ['-c', 'import importlib.util,sys;sys.exit(0 if importlib.util.find_spec("narova_tts") else 1)'], { env: PY_ENV });
  return r.status === 0;
}
function pyHasPackage(py, pkg) {
  const r = spawnSync(py, ['-c', `import importlib.util,sys;sys.exit(0 if importlib.util.find_spec("${pkg}") else 1)`]);
  return r.status === 0;
}
function hfOk() {
  const r = npxSync(['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, '--version'],
    { encoding: 'utf8', timeout: 300000 });
  return r.status === 0 ? (r.stdout || '').trim().split('\n').pop() : null;
}

// Mirrors backends.chatterbox_python(): the isolated chatterbox venv's python.
function chatterboxPython() {
  const venv = process.env.NAROVA_CHATTERBOX_VENV || path.join(NAROVA_HOME, 'venv-chatterbox');
  return path.join(venv, 'bin', 'python');
}
function chatterboxVersion(py) {
  const r = spawnSync(py, ['-c', 'import importlib.metadata as m;print(m.version("chatterbox-tts"))'],
    { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function doctor(projectDir) {
  const rows = [];
  const add = (name, ok, detail, optional = false) => rows.push({ name, ok, detail, optional });

  const ffmpeg = which('ffmpeg');
  add('ffmpeg', !!ffmpeg, ffmpeg || 'not found — install via `brew install ffmpeg`');
  add('ffprobe', !!which('ffprobe'), which('ffprobe') || 'not found');

  const py = findPython(projectDir);
  const ver = pyOk(py);
  add('python', !!ver, ver ? `${py} (${ver})` : `${py} — not runnable`);
  if (ver) {
    const hasMod = pyHasModule(py);
    add('narova_tts module', hasMod, hasMod ? 'importable' : 'not importable — run <skill>/tool/setup.sh (or just `narova synth` — it self-provisions)');

    // Optional: forced word alignment engines (config.align).
    const fw = pyHasPackage(py, 'faster_whisper');
    add('align: faster-whisper', fw,
      fw ? 'available' : 'not installed — optional; `pip install faster-whisper` into the venv', true);
    const wbin = which('whisper-cli') || which('whisper-cpp') || which('main');
    const wmodel = path.join(NAROVA_HOME, 'models', 'ggml-tiny.en.bin');
    add('align: whisper.cpp', !!wbin,
      wbin
        ? `${wbin}${fs.existsSync(wmodel) ? '' : ' (model auto-downloads on first use)'}`
        : 'not found — optional; install whisper.cpp so `whisper-cli` is on PATH', true);
  }

  // Optional: chatterbox backend venv (voice cloning / multilingual v3).
  const cbPy = chatterboxPython();
  if (fs.existsSync(cbPy)) {
    const cbv = chatterboxVersion(cbPy);
    add('chatterbox venv', true, cbv ? `chatterbox-tts ${cbv} (${cbPy})` : cbPy, true);
  } else {
    add('chatterbox venv', false, 'not installed — only needed for the chatterbox backend: <skill>/tool/setup.sh --chatterbox', true);
  }

  // Optional: agent-browser for stock asset sourcing (references/stock-assets.md Tier 2).
  const ab = which('agent-browser');
  if (ab) {
    const abv = spawnSync(ab, ['--version'], { encoding: 'utf8' });
    add('agent-browser', true, abv.status === 0 ? abv.stdout.trim() : ab, true);
  } else {
    add('agent-browser', false, 'not installed — optional; `npm install -g agent-browser` for stock footage download', true);
  }

  const npx = which('npx');
  add('npx', !!npx, npx || 'not found — install Node.js >= 18');
  if (npx) {
    console.log('checking npx hyperframes (first run downloads the CLI — may take a minute)...');
    const hv = hfOk();
    add('hyperframes CLI', !!hv, hv ? `hyperframes@${HYPERFRAMES_VERSION} (${hv})` : `npx hyperframes@${HYPERFRAMES_VERSION} failed`);
  }

  console.log('narova doctor\n');
  let allOk = true;
  const missing = [];
  for (const r of rows) {
    console.log(`  ${r.ok ? '✓' : r.optional ? '○' : '✗'} ${r.name.padEnd(20)} ${r.detail}`);
    if (!r.ok && !r.optional) { allOk = false; missing.push(r.name); }
  }
  console.log('');
  if (allOk) {
    console.log('All required tools present.');
  } else {
    console.log(`Missing required: ${missing.join(', ')}`);
  }
  return allOk;
}

module.exports = { doctor };
