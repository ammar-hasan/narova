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
const { writeCaptions } = require('./captions');
const { runHf } = require('./hf');
const { compile, read, write, mergeTimings } = require('./timeline');
const { buildDeliverables } = require('./exports');

/* ---- Python (synth) handoff -------------------------------------------------
 * Contract: <venv-python> -m narova_tts --narration <out>/narration.json
 *   --config <out>/config.resolved.json --out <out> [--backend piper|xtts|qwen|chatterbox] [--reuse]
 * It writes <out>/audio/NN.{wav,mp3}, <out>/audio/full.wav and <out>/timings.json. */

// The tool root: <skill>/tool (bin/, src/, py/, setup.sh) — wherever the skill is installed.
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

/* Write the two Python stage inputs (narration.json + config.resolved.json)
 * plus the versioned timeline.json intermediate representation. */
function writeStageInputs(config, outDir) {
  ensureDir(outDir);
  fs.writeFileSync(path.join(outDir, 'narration.json'), JSON.stringify(narration(config), null, 2));
  // assetsDir is an absolute Node-side compose path. Python neither needs it
  // nor should a generated manifest embed a machine-specific path.
  const { assetsDir: _assetsDir, ...serializableConfig } = config;
  fs.writeFileSync(path.join(outDir, 'config.resolved.json'), JSON.stringify(serializableConfig, null, 2));
  // timeline.json — versioned intermediate representation that supersedes
  // narration.json + config.resolved.json for downstream consumers.
  const tl = compile(config, { toolVersion: require('../package.json').version });
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(tl, null, 2));
}

/* `--reuse` replays the previous synth's audio + timings. If the spoken text
 * changed since that synth, replaying would silently ship stale audio — so
 * compare the current narration against the one the last synth consumed
 * (narration.json, written before the Python stage runs) and force a full
 * synth on any difference. Voice/backend/tempo changes with unchanged text
 * still replay old audio by design — run a full build to re-voice. */
function resolveReuse(config, outDir, requested, log = console.log) {
  if (!requested) return false;
  const prev = path.join(outDir, 'narration.json');
  if (!fs.existsSync(prev)) {
    log('note: --reuse but no previous synth found — running a full synth');
    return false;
  }
  try {
    const before = JSON.parse(fs.readFileSync(prev, 'utf8'));
    if (JSON.stringify(before) === JSON.stringify(narration(config))) return true;
  } catch { /* unreadable manifest — safest is a full synth */ }
  log('note: the spoken text changed since the last synth — ignoring --reuse and re-synthesizing');
  return false;
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

  const reuse = resolveReuse(config, outDir, opts.reuse, log);
  log(`[1/3] synth${reuse ? ' (--reuse)' : ''}`);
  writeStageInputs(config, outDir);
  synth(outDir, {
    backend: opts.backend, reuse,
    projectDir: opts.projectDir, python: opts.python, log,
  });
  enrichTimeline(outDir);   // merge measured timings into timeline.json

  log('[2/3] compose');
  const c = compose(config, outDir);
  const caps = writeCaptions(config, outDir);
  log(`captions -> ${caps.srt} (+ captions.vtt, ${caps.cues} cues)`);

  log('[3/3] hyperframes render (first run downloads the CLI — not a hang)');
  const name = opts.name || 'video.mp4';
  const args = ['render', '--output', path.join('..', name)];
  if (opts.fps) args.push('--fps', String(opts.fps));
  if (opts.quality) args.push('--quality', String(opts.quality));

  if (opts.deliverables) {
    // Multi-deliverable render: one mp4 per export profile.
    log(`  (${opts.deliverables === true ? 'all presets' : opts.deliverables})`);
    const results = buildDeliverables(config, c.dir, outDir, { ...opts, log });
    const mp4 = path.join(outDir, name);
    const seconds = probe(mp4);
    log(`done -> ${results.map(r => r.mp4).join(', ')}  (${seconds.toFixed(1)}s base)`);
    return { mp4, seconds, hf: c.dir, deliverables: results };
  }

  runHf(args, c.dir);
  const mp4 = path.join(outDir, name);
  const seconds = probe(mp4);
  log(`done -> ${mp4}  (${seconds.toFixed(1)}s)`);
  return { mp4, seconds, hf: c.dir };
}

/* ---- compile: reel.config → timeline.json --------------------------------- */

function compileTimeline(config, opts = {}) {
  const outDir = path.resolve(opts.out || 'out');
  ensureDir(outDir);
  writeStageInputs(config, outDir);
  const tl = JSON.parse(fs.readFileSync(path.join(outDir, 'timeline.json'), 'utf8'));
  return { timeline: tl, outDir };
}

/* ---- enrich timeline with timings post-synth ------------------------------ */

function enrichTimeline(outDir) {
  const tp = path.join(outDir, 'timeline.json');
  const tlp = path.join(outDir, 'timings.json');
  if (!fs.existsSync(tp)) return null;
  if (!fs.existsSync(tlp)) return JSON.parse(fs.readFileSync(tp, 'utf8'));
  const tl = read(tp);
  const enriched = mergeTimings(tl, tlp);
  fs.writeFileSync(tp, JSON.stringify(enriched, null, 2));
  return enriched;
}

module.exports = { build, synth, writeStageInputs, resolveReuse, findPython, ensureVenv, TOOL_ROOT, compileTimeline, enrichTimeline };
