'use strict';
/* Environment checks for the toolchain: ffmpeg, ffprobe, chrome, python venv,
 * and the libass warning (LEARNINGS #11). */
const path = require('path');
const { spawnSync } = require('child_process');
const { which, ffmpegHasLibass } = require('./util');
const { detectChrome } = require('./capture/chrome');
const { findPython } = require('./pipeline');

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

function doctor(projectDir) {
  const rows = [];
  const add = (name, ok, detail) => rows.push({ name, ok, detail });

  const ffmpeg = which('ffmpeg');
  add('ffmpeg', !!ffmpeg, ffmpeg || 'not found — install via `brew install ffmpeg`');
  add('ffprobe', !!which('ffprobe'), which('ffprobe') || 'not found');

  const chrome = detectChrome();
  add('chrome', !!chrome, chrome || 'not found — set $CHROME or install Google Chrome');

  const py = findPython(projectDir);
  const ver = pyOk(py);
  add('python', !!ver, ver ? `${py} (${ver})` : `${py} — not runnable`);
  if (ver) add('narova_tts module', pyHasModule(py), pyHasModule(py) ? 'importable' : 'not importable — run scripts/setup.sh');

  // libass note (warning, not a failure — captures don't use it, but flag it).
  let libass = null;
  if (ffmpeg) libass = ffmpegHasLibass();

  console.log('narova doctor\n');
  let allOk = true;
  for (const r of rows) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(20)} ${r.detail}`);
    if (!r.ok) allOk = false;
  }
  if (ffmpeg) {
    console.log(`  ${libass ? 'ℹ' : '⚠'} ${'ffmpeg libass'.padEnd(20)} ` +
      (libass ? 'present (unused — captures are baked into frames)'
        : 'absent — fine: narova bakes captions into captured frames (LEARNINGS #11)'));
  }
  console.log('');
  console.log(allOk ? 'All required tools present.' : 'Some required tools are missing (see ✗ above).');
  return allOk;
}

module.exports = { doctor };
