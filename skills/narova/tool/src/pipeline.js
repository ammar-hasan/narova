'use strict';
/* Orchestration: synth (Python TTS) -> compose -> hyperframes render.

 * Pipeline contract (canonical flow):
 *   reel.config → compile → manifest.json
 *                                ↓
 *                         synth / compose / export
 *
 * The manifest is the canonical intermediate representation. After
 * compilation, every stage reads the manifest. narration.json and
 * config.resolved.json are temporary compatibility projections
 * generated FROM the manifest for the Python TTS stage only.
 *
 * The full build() pipeline additionally enriches the manifest with
 * measured timings after synthesis, then derives compose and export
 * inputs from that enriched manifest. */

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
 *   exaggeration, cfg_weight, gapSentence, gapTurn, lead, tail,
 *   clone-sample contents (XTTS and chatterbox), and pipeline version. */
function audioFingerprint(config) {
  const voices = config.voices || {};
  const entries = [];

  for (const [id, v] of Object.entries(voices)) {
    const fp = { id };
    fp.backend = v.backend || 'piper';
    fp.speaker = v.speaker || '';
    // Hash clone samples for any backend that supports cloning (chatterbox, XTTS).
    // XTTS also clones from a recording — one path change should invalidate.
    if ((v.backend === 'chatterbox' || v.backend === 'xtts') && v.speaker) {
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
    gapSentence: timing.gapSentence != null ? timing.gapSentence : 0.24,
    gapTurn: timing.gapTurn != null ? timing.gapTurn : 0.44,
    lead: timing.lead != null ? timing.lead : 0.16,
    tail: timing.tail != null ? timing.tail : 0.58,
    backend: Object.values(voices)[0]?.backend || 'piper',
    pipeline: 3, // increment when audio-processing pipeline changes
  }));
}

/* Write the Python stage inputs (narration.json + config.resolved.json)
 * plus the canonical manifest.json.

 * The manifest is compiled FIRST from the resolved config and written.
 * narration.json and config.resolved.json are then derived as
 * compatibility projections from the resolved config (Python still
 * consumes those files). Downstream stages should prefer the manifest.

 * The audio fingerprint is NOT written here; it is committed atomically
 * only after successful synthesis to prevent a failed build from
 * leaving a stale fingerprint that could trick a later --reuse. */
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
}

/* Commit the audio fingerprint atomically after successful synthesis.
 * Uses a write-to-temp + rename pattern so a crash partway through
 * never leaves a corrupt fingerprint behind. */
function commitFingerprint(config, outDir) {
  const fp = audioFingerprint(config);
  const tmp = path.join(outDir, '.audio-fingerprint.tmp');
  const dest = path.join(outDir, '.audio-fingerprint');
  fs.writeFileSync(tmp, fp + '\n');
  fs.renameSync(tmp, dest);
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
  // Invalidate the old fingerprint *before* synthesis runs. If the process
  // crashes partway through writing audio/NN.wav files, the old fingerprint
  // no longer exists, so a later --reuse won't pick up partially overwritten
  // audio by mistake.
  if (!opts.reuse && opts.config) {
    const fp = path.join(outDir, '.audio-fingerprint');
    try { fs.unlinkSync(fp); } catch {}
  }
  const r = spawnSync(py, args, { stdio: 'inherit', cwd: TOOL_ROOT, env: { ...process.env, PYTHONPATH: pyPath } });
  if (r.error) throw new Error(`synth failed to launch (${py}): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`synth (narova_tts) exited ${r.status}`);
  const timings = path.join(outDir, 'timings.json');
  if (!fs.existsSync(timings)) throw new Error(`synth produced no timings.json in ${outDir}`);
  // Commit the audio fingerprint only after synthesis succeeds.
  if (opts.config) commitFingerprint(opts.config, outDir);
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
    projectDir: opts.projectDir, python: opts.python, log, config,
  });
  enrichTimeline(outDir);

  log('[2/3] compose');
  const manifest = read(path.join(outDir, 'manifest.json'));
  const cc = configFromManifest(manifest, config) || config;
  const c = compose(cc, outDir);
  const caps = writeCaptions(cc, outDir);
  log(`captions -> ${caps.srt} (+ captions.vtt, ${caps.cues} cues)`);

  log('[3/3] hyperframes render (first run downloads the CLI — not a hang)');
  const name = opts.name || 'video.mp4';
  const args = ['render', '--output', path.join('..', name)];
  if (opts.fps) args.push('--fps', String(opts.fps));
  if (opts.quality) args.push('--quality', String(opts.quality));

  if (opts.deliverables) {
    log(`  (${opts.deliverables === true ? 'all presets' : opts.deliverables})`);
    const results = buildDeliverables(cc, c.dir, outDir, { ...opts, log, safeAreaGuides: opts.safeAreaGuides });
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

/* Derive a config-like projection from the enriched manifest for downstream
 * consumers that still expect the resolved config shape (compose, captions,
 * exports). This is a compatibility bridge — new code should read the
 * manifest directly. */
function configFromManifest(manifest, resolvedConfig) {
  if (!manifest) return null;
  const m = manifest;
  return {
    title: m.project?.title || 'narova',
    platform: m.project?.platform || null,
    size: m.format ? { w: m.format.width, h: m.format.height } : { w: 1280, h: 720 },
    voices: Object.fromEntries(Object.entries(m.voices || {}).map(([id, v]) => [id, {
      label: v.label, color: v.color, backend: v.backend, speaker: v.speaker,
      ...(v.gainDb != null ? { gainDb: v.gainDb } : {}),
      ...(v.lang ? { lang: v.lang } : {}),
      ...(v.instruct ? { instruct: v.instruct } : {}),
    }])),
    theme: { accent: m.theme?.accent, bg: m.theme?.bg },
    mode: m.theme?.mode || 'dark',
    chrome: m.chrome || {},
    themeCss: m.theme?.css || '',
    timing: m.timing || {},
    scenes: (m.scenes || []).map(s => ({
      id: s.id, body: s.body || '', clip: s.clip || null, dur: s.dur || null,
      transition: s.transition || 'fade',
      vo: (s.vo || []).map(t => ({ who: t.who, text: t.text, ...(t.lang ? { lang: t.lang } : {}) })),
    })),
    captions: m.captions || {},
    align: m.align || false,
    bed: m.audio?.bed ? { file: m.audio.bed.file, volume: m.audio.bed.volume } : null,
    sfx: (m.audio?.sfx || []).map(s => ({ file: s.file, scene: s.scene, at: s.at, volume: s.volume })),
    variants: (m.variants || []).map(v => ({
      id: v.id, scene: v.scene ? { body: v.scene.body, vo: v.scene.vo } : null,
    })),
    variant: m.variant || null,
    series: m.series || null,
    // Preserve resolved filesystem paths from the original config.
    // These are needed by compose for asset copying and clip resolution.
    assetsDir: resolvedConfig ? resolvedConfig.assetsDir : undefined,
    projectDir: resolvedConfig ? resolvedConfig.projectDir : undefined,
  };
}

module.exports = { build, synth, writeStageInputs, commitFingerprint, resolveReuse, audioFingerprint, findPython, ensureVenv, TOOL_ROOT, compileTimeline, enrichTimeline, configFromManifest };
