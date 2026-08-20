'use strict';
/* Environment checks for the toolchain: ffmpeg/ffprobe (Python audio chain),
 * the python venv + narova_tts module, and the HyperFrames CLI via npx.
 * Chrome is no longer checked — HyperFrames provisions its own browser.
 * Optional features (align engines, chatterbox venv) are reported with ○ when
 * missing and never fail the check. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { which } = require('./util');
const { findPython } = require('./pipeline');
const { HYPERFRAMES_VERSION, npxSync } = require('./hf');

// narova_tts is provided from the repo's py/ dir via PYTHONPATH (not pip-installed
// into the venv) — mirror exactly what pipeline.synth sets, or the check false-negatives.
const PY_ENV = { ...process.env, PYTHONPATH: path.join(__dirname, '..', 'py') };

const NAROVA_HOME = process.env.NAROVA_HOME || path.join(os.homedir(), '.narova');
const TOOL_DIR = path.resolve(__dirname, '..');
const { readinessMatrix } = require('./readiness');

function sourceFingerprint(toolDir) {
  const files = ['bin/narova.js', 'src/compose/three.js', 'src/pipeline.js'];
  const hash = crypto.createHash('sha256');
  for (const rel of files) {
    const file = path.join(toolDir, rel);
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex').slice(0, 12);
}

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

function versionAtLeast(found, required) {
  const value = String(found || '').match(/\d+\.\d+\.\d+/);
  if (!value) return false;
  const have = value[0].split('.').map(Number);
  const want = required.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (have[i] !== want[i]) return have[i] > want[i];
  }
  return true;
}

function doctor(projectDir, opts = {}) {
  const rows = [];
  const add = (name, ok, detail, optional = false) => rows.push({ name, ok, detail, optional });

  const version = require('../package.json').version;
  const fingerprint = sourceFingerprint(TOOL_DIR);
  add('narova source', true, `${TOOL_DIR} (${version}+${fingerprint})`);

  const ffmpeg = which('ffmpeg');
  add('ffmpeg', !!ffmpeg, ffmpeg || 'not found — install via `brew install ffmpeg`');
  add('ffprobe', !!which('ffprobe'), which('ffprobe') || 'not found');

  const py = findPython(projectDir);
  const ver = pyOk(py);
  add('python', !!ver, ver ? `${py} (${ver})` : `${py} — not runnable`);
  if (ver) {
    const hasMod = pyHasModule(py);
    add('narova_tts module', hasMod, hasMod ? 'importable' : 'not importable — run `narova-setup` (or just `narova synth` — it self-provisions)');

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
    add('chatterbox venv', false, 'not installed — only needed for the chatterbox backend: `narova-setup --chatterbox`', true);
  }

  // Optional: agent-browser is the walkthrough capture adapter. It remains
  // optional so narration-only projects keep Narova's Node 18 baseline.
  const ab = which('agent-browser');
  if (ab) {
    const abv = spawnSync(ab, ['--version'], { encoding: 'utf8' });
    const detail = abv.status === 0 ? abv.stdout.trim() : ab;
    const supported = abv.status === 0 && versionAtLeast(detail, '0.33.0');
    add('agent-browser', supported,
      supported ? detail : `${detail} — walkthroughs require >=0.33.0`,
      true);
  } else {
    add('agent-browser', false, 'not installed — optional; required only for walkthrough capture: `npm install -g agent-browser && agent-browser install`', true);
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

  // First-run readiness matrix parity (NAR-021-007): the same matrix the
  // first-run surface evaluates, printable here without interaction or
  // mutation. Pure probe — no network, no provisioning.
  try {
    const { formatMatrix } = require('./readiness');
    console.log(formatMatrix(readinessMatrix()));
    console.log('');
  } catch { /* advisory parity — never fails doctor */ }

  if (allOk) {
    console.log('All required tools present.');
  } else {
    console.log(`Missing required: ${missing.join(', ')}`);
  }
  // Machine channel (opt-in): the same rows the prose table prints.
  if (opts.collect) for (const r of rows) opts.collect.push(r);
  return allOk;
}

module.exports = { doctor, sourceFingerprint };
