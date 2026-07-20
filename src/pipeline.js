'use strict';
/* Orchestration: synth (Python TTS) -> compose -> hyperframes render.
 * Language boundary (SPEC): Node owns config, composition, and the HyperFrames
 * handoff; Python owns TTS + timings only. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureDir, probe } = require('./util');
const { narration } = require('./schema');
const { compose } = require('./compose');
const { runHf } = require('./hf');

/* ---- Python (synth) handoff -------------------------------------------------
 * Contract: <venv-python> -m narova_tts --narration <out>/narration.json
 *   --config <out>/config.resolved.json --out <out> [--backend piper|xtts] [--reuse]
 * It writes <out>/audio/NN.{wav,mp3}, <out>/audio/full.wav and <out>/timings.json. */

const REPO_ROOT = path.resolve(__dirname, '..');

/* Locate the managed venv python: $NAROVA_PYTHON, then .venv in the project,
 * then .venv in the narova repo, then bare python3. */
function findPython(projectDir) {
  const cands = [
    process.env.NAROVA_PYTHON,
    projectDir && path.join(projectDir, '.venv', 'bin', 'python'),
    path.join(REPO_ROOT, '.venv', 'bin', 'python'),
    'python3',
  ].filter(Boolean);
  for (const c of cands) {
    if (c === 'python3') return c;
    if (fs.existsSync(c)) return c;
  }
  return 'python3';
}

/* Write the two Python stage inputs (narration.json + config.resolved.json). */
function writeStageInputs(config, outDir) {
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, 'narration.json'), JSON.stringify(narration(config), null, 2));
  fs.writeFileSync(path.join(outDir, 'config.resolved.json'), JSON.stringify(config, null, 2));
}

function synth(outDir, opts = {}) {
  const py = opts.python || findPython(opts.projectDir);
  const args = ['-m', 'narova_tts',
    '--narration', path.join(outDir, 'narration.json'),
    '--config', path.join(outDir, 'config.resolved.json'),
    '--out', outDir];
  if (opts.backend) args.push('--backend', opts.backend);
  if (opts.reuse) args.push('--reuse');
  (opts.log || console.log)(`synth: ${py} ${args.join(' ')}`);
  const pyPath = path.join(REPO_ROOT, 'py') +
    (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '');
  const r = spawnSync(py, args, { stdio: 'inherit', cwd: REPO_ROOT, env: { ...process.env, PYTHONPATH: pyPath } });
  if (r.error) throw new Error(`synth failed to launch (${py}): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`synth (narova_tts) exited ${r.status}`);
  const timings = path.join(outDir, 'timings.json');
  if (!fs.existsSync(timings)) throw new Error(`synth produced no timings.json in ${outDir}`);
  return { timings };
}

/* ---- full build: synth -> compose -> hyperframes render --------------------- */

function build(config, opts = {}) {
  const outDir = path.resolve(opts.out || 'out');
  ensureDir(outDir);
  const log = opts.log || console.log;

  log(`[1/3] synth${opts.reuse ? ' (--reuse)' : ''}`);
  writeStageInputs(config, outDir);
  synth(outDir, { backend: opts.backend, reuse: opts.reuse, projectDir: opts.projectDir, python: opts.python, log });

  log('[2/3] compose');
  const c = compose(config, outDir);

  log('[3/3] hyperframes render (first run downloads the CLI — not a hang)');
  const name = opts.name || 'video.mp4';
  const args = ['render', '--output', path.join('..', name)];
  if (opts.fps) args.push('--fps', String(opts.fps));
  if (opts.quality) args.push('--quality', String(opts.quality));
  runHf(args, c.dir);

  const mp4 = path.join(outDir, name);
  const seconds = probe(mp4);
  log(`done -> ${mp4}  (${seconds.toFixed(1)}s)`);
  return { mp4, seconds, hf: c.dir };
}

module.exports = { build, synth, writeStageInputs, findPython };
