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
 *   --config <out>/config.resolved.json --out <out> [--backend piper|xtts|qwen] [--reuse]
 * It writes <out>/audio/NN.{wav,mp3}, <out>/audio/full.wav and <out>/timings.json. */

// The tool root: .claude/skills/narova/tool (bin/, src/, py/, setup.sh).
const TOOL_ROOT = path.resolve(__dirname, '..');
// Default venv home. Lives OUTSIDE the skill folder — skill dirs get replaced
// on updates, a venv must survive that.
const VENV_HOME = process.env.NAROVA_VENV
  || path.join(process.env.NAROVA_HOME || path.join(require('os').homedir(), '.narova'), 'venv');

/* Venv candidates, in order. Returns the first that exists, else null. */
function findVenvPython(projectDir) {
  const cands = [
    process.env.NAROVA_PYTHON,
    projectDir && path.join(projectDir, '.venv', 'bin', 'python'),
    path.join(VENV_HOME, 'bin', 'python'),
    path.join(TOOL_ROOT, '..', '..', '..', '.venv', 'bin', 'python'),  // dev checkout root (repo/skills/narova/tool)
    path.join(TOOL_ROOT, '.venv', 'bin', 'python'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

function findPython(projectDir) {
  return findVenvPython(projectDir) || 'python3';
}

/* First-run self-provisioning: no venv anywhere -> run the bundled setup.sh
 * (creates the venv at VENV_HOME and installs the piper deps). */
function ensureVenv(projectDir, log = console.log) {
  if (findVenvPython(projectDir)) return;
  log(`no TTS venv found — creating one at ${VENV_HOME} (one-time, piper backend)`);
  const r = spawnSync('bash', [path.join(TOOL_ROOT, 'setup.sh')], {
    stdio: 'inherit', env: { ...process.env, NAROVA_VENV: VENV_HOME },
  });
  if (r.error || r.status !== 0) {
    throw new Error(`setup.sh failed — run it manually: bash ${path.join(TOOL_ROOT, 'setup.sh')}`);
  }
}

/* Write the two Python stage inputs (narration.json + config.resolved.json). */
function writeStageInputs(config, outDir) {
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, 'narration.json'), JSON.stringify(narration(config), null, 2));
  fs.writeFileSync(path.join(outDir, 'config.resolved.json'), JSON.stringify(config, null, 2));
}

function synth(outDir, opts = {}) {
  if (!opts.python) ensureVenv(opts.projectDir, opts.log);
  const py = opts.python || findPython(opts.projectDir);
  const args = ['-m', 'narova_tts',
    '--narration', path.join(outDir, 'narration.json'),
    '--config', path.join(outDir, 'config.resolved.json'),
    '--out', outDir];
  if (opts.backend) args.push('--backend', opts.backend);
  if (opts.reuse) args.push('--reuse');
  (opts.log || console.log)(`synth: ${py} ${args.join(' ')}`);
  const pyPath = path.join(TOOL_ROOT, 'py') +
    (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '');
  const r = spawnSync(py, args, { stdio: 'inherit', cwd: TOOL_ROOT, env: { ...process.env, PYTHONPATH: pyPath } });
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

module.exports = { build, synth, writeStageInputs, findPython, ensureVenv, TOOL_ROOT };
