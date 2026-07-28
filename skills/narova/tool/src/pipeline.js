'use strict';
/* Orchestration: synth (Python TTS) -> compose -> hyperframes render.

 * Pipeline contract (canonical flow):
 *   reel.config → compile → manifest.json
 *                                ↓
 *                         synth / compose / export
 *
 * The manifest is the canonical intermediate representation. Every stage
 * after compilation consumes it. narration.json and config.resolved.json
 * are temporary compatibility projections generated FROM the manifest
 * (Python still consumes those files). */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ensureDir, probe } = require('./util');
const { narration } = require('./schema');
const { compose } = require('./compose');
const { writeCaptions } = require('./captions');
const { runHf } = require('./hf');
const { compile, read, mergeTimings } = require('./manifest');
const { buildDeliverables } = require('./exports');

/* ---- Python (synth) handoff -------------------------------------------------
 * Contract: <venv-python> -m narova_tts --narration <out>/narration.json
 *   --config <out>/config.resolved.json --out <out> [--backend piper|xtts|qwen|chatterbox] [--reuse]
 * It writes <out>/audio/NN.{wav,mp3}, <out>/audio/full.wav and <out>/timings.json. */

const TOOL_ROOT = path.resolve(__dirname, '..');
const VENV_HOME = process.env.NAROVA_VENV
  || path.join(process.env.NAROVA_HOME || path.join(require('os').homedir(), '.narova'), 'venv');

function findVenvPython(projectDir) {
  const cands = [
    process.env.NAROVA_PYTHON,
    projectDir && path.join(projectDir, '.venv', 'bin', 'python'),
    path.join(VENV_HOME, 'bin', 'python'),
    path.join(TOOL_ROOT, '..', '..', '..', '.venv', 'bin', 'python'),
    path.join(TOOL_ROOT, '.venv', 'bin', 'python'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

function findPython(projectDir) {
  return findVenvPython(projectDir) || 'python3';
}

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

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return sha256(fs.readFileSync(filePath));
}

/* ---- audio fingerprint for --reuse ------------------------------------------

 * An audio fingerprint captures every input that affects the produced speech
 * audio. --reuse replays previous synth output only when the full fingerprint
 * matches. This covers:
 *   backend, speaker, text, language, tempo, gain, instruct,
 *   exaggeration, cfg_weight, and the audio-processing pipeline version. */
function audioFingerprint(config) {
  const voices = config.voices || {};
  const entries = [];

  for (const [id, v] of Object.entries(voices)) {
    const fp = { id };
    fp.backend = v.backend || 'piper';
    fp.speaker = v.speaker || '';
    // For chatterbox clones, hash the sample recording so a
    // re-recording invalidates the cache.
    if (v.backend === 'chatterbox' && v.speaker) {
      const resolved = v.speaker; // already absolute from resolveConfig
      if (fs.existsSync(resolved)) {
        fp.sampleHash = hashFile(resolved);
      }
    }
    fp.gainDb = v.gainDb != null ? v.gainDb : 0;
    fp.lang = v.lang || '';
    fp.instruct = v.instruct || '';
    fp.exaggeration = v.exaggeration != null ? v.exaggeration : 1.0;
    fp.cfg_weight = v.cfg_weight != null ? v.cfg_weight : 0.7;
    entries.push(fp);
  }

  // Per-turn language override is part of the text identity.
  const turns = [];
  for (const s of (config.scenes || [])) {
    for (const t of (s.vo || [])) {
      turns.push({ who: t.who, text: t.text, lang: t.lang || '' });
    }
  }

  const timing = config.timing || {};
  const tempo = timing.tempo != null ? timing.tempo : 1.0;

  return sha256(JSON.stringify({
    voices: entries,
    turns,
    tempo,
    backend: Object.values(voices)[0]?.backend || 'piper',
    pipeline: 1, // increment when audio-processing pipeline changes
  }));
}

/* Write the Python stage inputs (narration.json + config.resolved.json)
 * plus the canonical manifest.json.

 * The manifest is compiled FIRST from the resolved config and written.
 * narration.json and config.resolved.json are then derived as
 * compatibility projections from the resolved config (Python still
 * consumes those files). Downstream stages should prefer the manifest. */
function writeStageInputs(config, outDir) {
  ensureDir(outDir);
  // manifest.json — canonical versioned project model
  const tl = compile(config, { toolVersion: require('../package.json').version });
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(tl, null, 2));
  // narration.json — Python TTS contract (compatibility projection)
  fs.writeFileSync(path.join(outDir, 'narration.json'), JSON.stringify(narration(config), null, 2));
  // config.resolved.json — resolved config for Python (compatibility projection)
  const { assetsDir: _assetsDir, ...serializableConfig } = config;
  fs.writeFileSync(path.join(outDir, 'config.resolved.json'), JSON.stringify(serializableConfig, null, 2));
  // audio-fingerprint (used by --reuse to detect voice/backend/tempo changes)
  const fp = audioFingerprint(config);
  fs.writeFileSync(path.join(outDir, '.audio-fingerprint'), fp + '\n');
}

/* `--reuse` replays the previous synth's audio + timings only when the
 * complete audio fingerprint matches. A text change, voice swap, backend
 * change, tempo change, gain change, clone-sample replacement, language
 * change, or instruct change all force a full synth. */
function resolveReuse(config, outDir, requested, log = console.log) {
  if (!requested) return false;
  const fingerprintPath = path.join(outDir, '.audio-fingerprint');
  const narrationPath = path.join(outDir, 'narration.json');
  const timingsPath = path.join(outDir, 'timings.json');

  if (!fs.existsSync(fingerprintPath) || !fs.existsSync(timingsPath)) {
    log('note: --reuse but no previous synth found — running a full synth');
    return false;
  }

  const currentFp = audioFingerprint(config);
  const previousFp = fs.readFileSync(fingerprintPath, 'utf8').trim();

  if (currentFp === previousFp) return true;

  // Give a helpful message about what likely changed.
  try {
    const prevNarration = JSON.parse(fs.readFileSync(narrationPath, 'utf8'));
    const currNarration = narration(config);
    const textChanged = JSON.stringify(prevNarration) !== JSON.stringify(currNarration);
    if (textChanged) {
      log('note: the spoken text changed since the last synth — ignoring --reuse and re-synthesizing');
    } else {
      log('note: voice, backend, tempo, gain, instruction, or clone sample changed — ignoring --reuse and re-synthesizing');
    }
  } catch {
    log('note: audio configuration changed — ignoring --reuse and re-synthesizing');
  }
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
  enrichTimeline(outDir);

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

/* ---- compile: reel.config → manifest.json --------------------------------- */

function compileTimeline(config, opts = {}) {
  const outDir = path.resolve(opts.out || 'out');
  ensureDir(outDir);
  writeStageInputs(config, outDir);
  const tl = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  return { manifest: tl, outDir };
}

/* ---- enrich manifest with timings post-synth ------------------------------ */

function enrichTimeline(outDir) {
  const mp = path.join(outDir, 'manifest.json');
  const tlp = path.join(outDir, 'timings.json');
  if (!fs.existsSync(mp)) return null;
  if (!fs.existsSync(tlp)) return JSON.parse(fs.readFileSync(mp, 'utf8'));
  const tl = read(mp);
  const enriched = mergeTimings(tl, tlp);
  fs.writeFileSync(mp, JSON.stringify(enriched, null, 2));
  return enriched;
}

module.exports = { build, synth, writeStageInputs, resolveReuse, audioFingerprint, findPython, ensureVenv, TOOL_ROOT, compileTimeline, enrichTimeline };
