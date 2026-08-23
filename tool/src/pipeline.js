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
const { spawnSync } = require('child_process');
const { ensureDir, probe } = require('./util');
const { narration } = require('./schema');
const { writeCaptions } = require('./captions');
const { getRenderer } = require('./renderers');
const { compile, read, mergeTimings, hashFile } = require('./manifest');
const { buildDeliverables } = require('./exports');
const { audioFingerprint, timingsFingerprint } = require('./audio-fingerprint');
const { renderToMp4 } = require('./scene-cache');
const revisions = require('./revisions');
const machine = require('./machine');
const { writeVideoCiBinding } = require('./video-ci-binding');
const machineActive = machine.isActive;

/* ---- Python (synth) handoff -------------------------------------------------
 * Contract: <venv-python> -m narova_tts --narration <out>/narration.json
 *   --config <out>/config.resolved.json --out <out> [--backend <built-in-or-registered>] [--reuse]
 * It writes <out>/audio/NN.{wav,mp3}, <out>/audio/full.wav and <out>/timings.json. */

const TOOL_ROOT = path.resolve(__dirname, '..');
const VENV_HOME = process.env.NAROVA_VENV
  || path.join(process.env.NAROVA_HOME || path.join(require('os').homedir(), '.narova'), 'venv');

function findVenvPython(projectDir) {
  const cands = [
    process.env.NAROVA_PYTHON,
    projectDir && path.join(projectDir, '.venv', 'bin', 'python'),
    path.join(VENV_HOME, 'bin', 'python'),
    path.join(TOOL_ROOT, '..', '.venv', 'bin', 'python'),
    path.join(TOOL_ROOT, '.venv', 'bin', 'python'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

function findPython(projectDir) {
  return findVenvPython(projectDir) || 'python3';
}

/* Under --json, capture child progress and replay it through the redactor.
 * Connecting a child directly to fd 2 bypasses JavaScript's stderr wrapper. */
const MACHINE_CHILD_STDIO = ['ignore', 'pipe', 'pipe'];

function replayMachineChild(result) {
  if (!machineActive()) return;
  if (result.stdout) process.stderr.write(machine.redact(String(result.stdout)));
  if (result.stderr) process.stderr.write(machine.redact(String(result.stderr)));
}

function ensureVenv(projectDir, log = console.log) {
  if (findVenvPython(projectDir)) return;
  log(`no TTS venv found — creating one at ${VENV_HOME} (one-time, piper backend)`);
  const r = spawnSync('bash', [path.join(TOOL_ROOT, 'setup.sh')], {
    ...(machineActive()
      ? { encoding: 'utf8', stdio: MACHINE_CHILD_STDIO, maxBuffer: 64 * 1024 * 1024 }
      : { stdio: 'inherit' }),
    env: { ...process.env, NAROVA_VENV: VENV_HOME },
  });
  replayMachineChild(r);
  if (r.error || r.status !== 0) {
    throw new Error(`setup.sh failed — run it manually: bash ${path.join(TOOL_ROOT, 'setup.sh')}`);
  }
}

/* ---- audio fingerprint for --reuse ------------------------------------------

 * An audio fingerprint captures every input that affects the produced speech
 * audio. --reuse replays previous synth output only when the full fingerprint
 * matches. This covers:
 *   backend, speaker, text, language, tempo, gain, instruct,
 *   exaggeration, cfg_weight, gapSentence, gapTurn, lead, tail,
 *   clone-sample contents (XTTS and chatterbox), and pipeline version. */
/* Toolchain implementation versions recorded into the manifest
 * (NAR-014-048). Local sources only — the renderer provider's pinned version
 * constant, and the speech backend's installed package version read from an
 * EXISTING venv via importlib.metadata (the same mechanism doctor uses).
 * Never provisions a venv, never runs a provider or synthesis, never touches
 * the network. A version that cannot be determined locally records as null. */
const BACKEND_PACKAGE = { piper: 'piper-tts', xtts: 'coqui-tts', qwen: 'qwen-tts', chatterbox: 'chatterbox-tts' };

function installedPackageVersion(py, pkg) {
  const r = spawnSync(py, ['-c', `import importlib.metadata as m;print(m.version("${pkg}"))`], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function speechBackendVersion(config) {
  const voices = Object.values(config.voices || {});
  const backend = (voices[0] && voices[0].backend) || 'piper';
  // External provider backends carry the version recorded at registration.
  const voice = voices.find(v => v.backend === backend);
  if (voice && voice.providerVersion) return voice.providerVersion;
  const pkg = BACKEND_PACKAGE[backend];
  if (!pkg) return null;
  let py;
  if (backend === 'chatterbox') {
    // Mirrors doctor: chatterbox runs from its own isolated venv.
    const home = process.env.NAROVA_HOME || path.join(require('os').homedir(), '.narova');
    py = path.join(process.env.NAROVA_CHATTERBOX_VENV || path.join(home, 'venv-chatterbox'), 'bin', 'python');
    if (!fs.existsSync(py)) return null;
  } else {
    py = findVenvPython(config.projectDir);
    if (!py) return null;
  }
  return installedPackageVersion(py, pkg);
}

function rendererVersion(config) {
  try { return getRenderer(config.renderer).providerVersion || null; }
  catch { return null; }
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
  const tl = compile(config, {
    toolVersion: require('../package.json').version,
    rendererVersion: rendererVersion(config),
    backendVersion: speechBackendVersion(config),
  });
  const manifestFile = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(tl, null, 2));
  // A restored pre-0.28 project keeps its historical safe geometry across
  // repeated commands. Rebind the provenance marker to every regenerated
  // manifest; an explicitly authored safeLayout:false retires it permanently.
  const restoreMarker = path.join(outDir, '.restored-manifest.json');
  let restoreMarkerWritten = false;
  if (config._retireLegacySafeLayout) {
    fs.rmSync(restoreMarker, { force: true });
  } else if (config._legacySafeLayout) {
    fs.writeFileSync(restoreMarker, JSON.stringify({
      manifestSha256: hashFile(manifestFile),
      legacySafeLayout: true,
    }, null, 2));
    restoreMarkerWritten = true;
  }
  // narration.json — Python TTS contract (compatibility projection)
  fs.writeFileSync(path.join(outDir, 'narration.json'), JSON.stringify(narration(config), null, 2));
  // config.resolved.json — resolved config for Python (compatibility projection)
  // Provenance declarations and creative assertions are advisory report inputs,
  // not Python/runtime inputs. Keeping them out also ensures either kind of edit cannot
  // invalidate a previously reviewed creative proof via this projection.
  const {
    assetsDir: _assetsDir, provenance: _provenance, assertions: _assertions,
    sceneState: _sceneState, ...serializableConfig
  } = config;
  fs.writeFileSync(path.join(outDir, 'config.resolved.json'), JSON.stringify(serializableConfig, null, 2));
  return {
    manifest: manifestFile,
    narration: path.join(outDir, 'narration.json'),
    resolvedConfig: path.join(outDir, 'config.resolved.json'),
    ...(restoreMarkerWritten ? { restoreMarker } : {}),
  };
}

/* Commit the audio and timing fingerprints after successful synthesis.
 * Uses a write-to-temp + rename pattern so a crash partway through
 * never leaves a corrupt fingerprint behind. The shared narration-context
 * digest is committed the same way so pre-ledger `narova diff` runs can
 * compare shared narration inputs (CHANGE-2026-026). */
function commitFingerprint(config, outDir) {
  const { narrationContextDigest } = require('./audio-fingerprint');
  for (const [name, fp] of [
    ['.audio-fingerprint', audioFingerprint(config)],
    ['.timings-fingerprint', timingsFingerprint(config)],
    ['.narration-context', narrationContextDigest(config)],
  ]) {
    const tmp = path.join(outDir, `${name}.tmp`);
    const dest = path.join(outDir, name);
    fs.writeFileSync(tmp, fp + '\n');
    fs.renameSync(tmp, dest);
  }
}

/* `--reuse` replays previous audio + timings only when both identities match
 * and the audio files are intact. A text
 * change, voice swap, backend change, tempo change, gain change, clone-sample
 * replacement, language change, or instruct change all force a full synth. */
function resolveReuse(config, outDir, requested, log = console.log) {
  if (!requested) return false;
  const fingerprintPath = path.join(outDir, '.audio-fingerprint');
  const timingsFingerprintPath = path.join(outDir, '.timings-fingerprint');
  const timingsPath = path.join(outDir, 'timings.json');
  const audioDir = path.join(outDir, 'audio');

  if (!fs.existsSync(fingerprintPath) || !fs.existsSync(timingsFingerprintPath)
      || !fs.existsSync(timingsPath)) {
    log('note: --reuse but no previous synth found — running a full synth');
    return false;
  }

  const currentFp = audioFingerprint(config);
  const previousFp = fs.readFileSync(fingerprintPath, 'utf8').trim();

  if (currentFp !== previousFp) {
    // Give a helpful message about what likely changed.
    // The fingerprint captures voice identity, text, tempo, gain, and backend
    // parameters — everything that affects the produced audio waveforms.
    // Visual changes (body, theme, CSS, choreography, captions config) do NOT
    // change the fingerprint, so --reuse safely replays the audio.
    try {
      const prevNarration = JSON.parse(fs.readFileSync(path.join(outDir, 'narration.json'), 'utf8'));
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

  if (fs.readFileSync(timingsFingerprintPath, 'utf8').trim() !== timingsFingerprint(config)) {
    log('note: scene topology or silent duration changed — ignoring --reuse and rebuilding timings');
    return false;
  }

  // Fingerprint matches. Verify that the audio files still exist — the
  // fingerprint is the authority on whether the audio IS correct, but if the
  // files were deleted or corrupted, --reuse cannot help.
  const timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  if (!timings || typeof timings !== 'object') {
    log('note: --reuse fingerprint matches but timings.json is invalid — running a full synth');
    return false;
  }
  // Audio files are numbered by scene index (01.wav, 02.wav, ...).
  // Check that the full mix exists as evidence of prior synthesis.
  const fullWav = path.join(audioDir, 'full.wav');
  if (!fs.existsSync(fullWav)) {
    log('note: --reuse fingerprint matches but audio is missing — running a full synth');
    return false;
  }
  return true;
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
    for (const name of ['.audio-fingerprint', '.timings-fingerprint']) {
      try { fs.unlinkSync(path.join(outDir, name)); } catch {}
    }
  }
  const r = spawnSync(py, args, {
    ...(machineActive()
      ? { encoding: 'utf8', stdio: MACHINE_CHILD_STDIO, maxBuffer: 64 * 1024 * 1024 }
      : { stdio: 'inherit' }),
    cwd: TOOL_ROOT, env: { ...process.env, PYTHONPATH: pyPath },
  });
  replayMachineChild(r);
  if (r.error) throw new Error(`synth failed to launch (${py}): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`synth (narova_tts) exited ${r.status}`);
  const timings = path.join(outDir, 'timings.json');
  if (!fs.existsSync(timings)) throw new Error(`synth produced no timings.json in ${outDir}`);
  // Commit the audio fingerprint only after synthesis succeeds.
  if (opts.config) commitFingerprint(opts.config, outDir);
  return { timings };
}

/* ---- full build: synth -> compose -> selected local renderer ---------------- */

function build(config, opts = {}) {
  const outDir = path.resolve(opts.out || 'out');
  ensureDir(outDir);
  const log = opts.log || console.log;
  const artifact = typeof opts.artifact === 'function' ? opts.artifact : () => {};
  const stageInputs = files => {
    artifact(files.manifest, 'manifest');
    artifact(files.narration, 'stage-input');
    artifact(files.resolvedConfig, 'stage-input');
    if (files.restoreMarker) artifact(files.restoreMarker, 'restore-metadata');
  };

  const hasExternalNarration = !!(config.narrationSource && config.narrationSource.file);

  // Measured per-stage durations for the advisory revision record
  // (CHANGE-2026-026 / NAR-009-025). Stage boundaries follow the logged
  // [1/3]/[2/3]/[3/3] phases; compose and render are measured together.
  const t = { synthStart: process.hrtime.bigint(), synthSeconds: null, renderSeconds: null };
  const markSynthDone = () => {
    t.synthSeconds = Number(process.hrtime.bigint() - t.synthStart) / 1e9;
    t.renderStart = process.hrtime.bigint();
  };
  const stageDurations = () => {
    if (t.synthSeconds != null && t.renderSeconds == null && t.renderStart) {
      t.renderSeconds = Number(process.hrtime.bigint() - t.renderStart) / 1e9;
    }
    const round3 = n => (n == null ? null : Math.round(n * 1000) / 1000);
    return { synth: round3(t.synthSeconds), composeAndRender: round3(t.renderSeconds) };
  };

  if (hasExternalNarration) {
    log('[1/3] synth (skip — external narration)');
    stageInputs(writeStageInputs(config, outDir));
    // Copy external narration into the output.
    const audioDir = ensureDir(path.join(outDir, 'audio'));
    const narrationPath = path.join(audioDir, 'full.wav');
    fs.copyFileSync(config.narrationSource.file, narrationPath);

    // If a bed or SFX is configured, mix it with the external narration using ffmpeg.
    if (config.bed || (config.sfx && config.sfx.length)) {
      mixExternalAudio(config, narrationPath, audioDir, log);
    }

    // Generate timings from scene durations. When the custom narrator ships
    // word timings, normalize them into the same scene-local contract as TTS
    // so captions, manifests, HyperFrames, and no-browser all see identical data.
    const sceneTimings = {};
    let t = 0;
    for (const s of config.scenes) {
      const dur = s.dur || 0;
      const sceneEnd = Math.round((t + dur) * 1e6) / 1e6;
      const cues = (config.narrationSource.wordTimings || [])
        .filter(cue => cue.start < sceneEnd - 1e-6 && cue.end > t + 1e-6);
      const turns = (s.vo || []).map((turn, i) => {
        const cue = cues[i];
        return cue ? Math.max(0, cue.start - t) : (i * dur / Math.max(1, s.vo.length));
      });
      const words = cues.flatMap((cue, si) => (cue.words || []).map(word => ({
        w: word.text || word.w || '',
        t0: Math.max(0, word.start - t),
        t1: Math.max(0, word.end - t),
        who: cue.who || s.vo[si]?.who || s.vo[0]?.who || Object.keys(config.voices)[0] || 'a',
        si,
      })));
      sceneTimings[s.id] = { dur, turns, words };
      t = sceneEnd;
    }
    fs.writeFileSync(path.join(outDir, 'timings.json'),
      JSON.stringify({ total: Math.round(t * 1000) / 1000, ...sceneTimings }, null, 2));
    artifact(audioDir, 'audio');
    artifact(path.join(outDir, 'timings.json'), 'timings');
  } else {
    const reuse = resolveReuse(config, outDir, opts.reuse, log);
    log(`[1/3] synth${reuse ? ' (--reuse)' : ''}`);
    stageInputs(writeStageInputs(config, outDir));
    synth(outDir, {
      backend: opts.backend, reuse,
      projectDir: opts.projectDir, python: opts.python, log, config,
    });
    if (!reuse) {
      artifact(path.join(outDir, 'audio'), 'audio');
      artifact(path.join(outDir, 'timings.json'), 'timings');
    }
  }
  enrichTimeline(outDir);
  artifact(path.join(outDir, 'manifest.json'), 'manifest');
  // Captions publish before the post-synth release gate (NAR-009-008): they
  // depend only on the enriched manifest and measured timing, both ready
  // here, and the caption presence rule must be satisfiable by a first-ever
  // release build in a fresh directory — not only by an earlier plain build.
  const manifest = read(path.join(outDir, 'manifest.json'));
  const cc = configFromManifest(manifest, config) || config;
  // Preserve external narration source through the manifest bridge.
  if (hasExternalNarration && config.narrationSource) cc.narrationSource = config.narrationSource;
  const caps = writeCaptions(cc, outDir);
  if (caps.omitted) artifact(caps.omissionPath, 'caption-omission');
  else {
    artifact(caps.srt, 'captions');
    artifact(caps.vtt, 'captions');
  }
  if (caps.omitted) {
    log(`captions omitted — ${caps.reason} (recorded in out/captions-omitted.json)`);
  } else {
    log(`captions -> ${caps.srt} (+ captions.vtt, ${caps.cues} cues)`);
  }
  // The first preflight deliberately runs before expensive work. Actual voice
  // duration is unknowable until synth, so release builds run the same gate once
  // more here: after timings exist, before compose or rendering writes a video.
  if (opts.release) {
    const { check } = require('./check');
    const diagnostics = [];
    if (!check(config, { release: true, outDir, diagnostics })) {
      const error = new Error('release check failed after measured narration timing');
      error.code = 'NAROVA_SUBJECT_NON_PASS';
      error.diagnostics = diagnostics;
      throw error;
    }
  }
  markSynthDone();

  const selectedRenderer = getRenderer(opts.renderer || config.renderer);
  log(`[2/3] compose (${selectedRenderer.name})`);

  log(`[3/3] ${selectedRenderer.displayName} render${selectedRenderer.name === 'hyperframes' ? ' (first run downloads the CLI — not a hang)' : ' (browserless local Skia + FFmpeg)'}`);
  const name = opts.name || 'video.mp4';
  const hasWalkthroughs = Object.keys(cc.walkthroughs || {}).length > 0;
  // Browser recordings contain fine UI text. PNG frame extraction avoids
  // compounding the recorder's JPEG source frames with another lossy decode.
  if (opts.deliverables) {
    log(`  (${opts.deliverables === true ? 'all presets' : opts.deliverables})`);
    let results;
    let projectDir;
    let renderReuse = null; // span reuse is not applicable on per-preset paths
    if (selectedRenderer.name === 'hyperframes') {
      const composed = selectedRenderer.compose(cc, outDir);
      projectDir = composed.dir;
      artifact(projectDir, 'renderer-project');
      results = buildDeliverables(cc, composed.dir, outDir, {
        ...opts,
        log,
        safeAreaGuides: opts.safeAreaGuides,
        videoFrameFormat: hasWalkthroughs ? 'png' : null,
      });
    } else {
      // The no-browser base render goes through the scene cache (per-scene
      // reuse where possible); hyperframes deliverables render inside
      // buildDeliverables above and are not cached at the base level.
      const rendered = renderToMp4(selectedRenderer, cc, outDir, manifest, { ...opts, name, log });
      projectDir = rendered.dir;
      artifact(projectDir, 'renderer-project');
      artifact(rendered.mp4, 'video');
      renderReuse = rendered.reuse || null;
      const { buildDeliverablesFromSource } = require('./exports');
      results = buildDeliverablesFromSource(cc, rendered.mp4, outDir, { ...opts, log });
    }
    const mp4 = path.join(outDir, name);
    const seconds = probe(mp4);
    log(`done -> ${results.map(r => r.mp4).join(', ')}  (${seconds.toFixed(1)}s base)`);
    // Optional compressed companion (NAR-017-058..060).
    let companion = null;
    if (opts.companion) {
      const { buildCompanion } = require('./exports');
      const standardResult = results.find(r => r.id === 'narova-standard') || results[0];
      companion = buildCompanion(standardResult.mp4, outDir,
        typeof opts.companion === 'string' ? { aim: opts.companion } : {},
        { log });
      artifact(companion.mp4, 'video-companion');
    }
    // CHANGE-2026-026 / NAR-009-025: advisory revision recording. The build
    // has succeeded; a ledger problem is reported and never fails it.
    const revision = revisions.recordRevision({
      config, opts, outDir, manifest, renderReuse,
      deliverableCount: results.length, videoName: name,
      stageDurations: stageDurations(), log,
    });
    const videoCiEvidence = writeVideoCiBinding(mp4, {
      outDir, projectDir: config.projectDir, config,
    });
    artifact(videoCiEvidence, 'video-ci-evidence');
    return {
      mp4, seconds, project: projectDir, renderer: selectedRenderer.name, deliverables: results,
      videoCiEvidence,
      ...(companion ? { companion } : {}),
      ...(revision ? { revisions: revision } : {}),
      ...(selectedRenderer.name === 'hyperframes' ? { hf: projectDir } : {}),
    };
  }

  // The render goes through the scene-level cache (src/scene-cache.js): for
  // both bundled renderers, only scenes whose cache key changed are re-rendered
  // and the rest are reused + concatenated. Cache failures normally fall back to a full render;
  // WebGL-heavy films intentionally refuse that unsafe fallback because an
  // eager full document can exceed Chromium's context budget and blank scenes.
  const rendered = renderToMp4(selectedRenderer, cc, outDir, manifest, {
    ...opts, name, videoFrameFormat: hasWalkthroughs ? 'png' : null, log,
  });
  const mp4 = rendered.mp4;
  artifact(rendered.dir, 'renderer-project');
  artifact(mp4, 'video');
  // Optional compressed companion (NAR-017-058..060): an iteration lever the
  // requester opts into; the primary stays untouched; nothing is enforced.
  let companion = null;
  if (opts.companion) {
    const { buildCompanion } = require('./exports');
    companion = buildCompanion(mp4, outDir,
      typeof opts.companion === 'string' ? { aim: opts.companion } : {},
      { log });
    artifact(companion.mp4, 'video-companion');
  }
  const seconds = rendered.seconds == null ? probe(mp4) : rendered.seconds;
  log(`done -> ${mp4}  (${seconds.toFixed(1)}s)`);
  // CHANGE-2026-026 / NAR-009-025: advisory revision recording. The build has
  // succeeded; a ledger problem is reported and never fails it.
  const revision = revisions.recordRevision({
    config, opts, outDir, manifest,
    renderReuse: rendered.reuse || null,
    deliverableCount: 0, videoName: name,
    stageDurations: stageDurations(), log,
  });
  const videoCiEvidence = writeVideoCiBinding(mp4, {
    outDir, projectDir: config.projectDir, config,
  });
  artifact(videoCiEvidence, 'video-ci-evidence');
  return {
    mp4, seconds, project: rendered.dir, renderer: selectedRenderer.name,
    videoCiEvidence,
    ...(companion ? { companion } : {}),
    ...(revision ? { revisions: revision } : {}),
    ...(selectedRenderer.name === 'hyperframes' ? { hf: rendered.dir } : {}),
  };
}

/* ---- compile: reel.config → manifest.json --------------------------------- */

function compileTimeline(config, opts = {}) {
  const outDir = path.resolve(opts.out || 'out');
  ensureDir(outDir);
  const files = writeStageInputs(config, outDir);
  const tl = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  return { manifest: tl, outDir, files };
}

/* ---- external narration audio mixing --------------------------------------- */

/* When using external narration with a bed or SFX, mix them using ffmpeg.
 * Produces a mix.wav from the narration + bed + sfx sources, same as the
 * Python pipeline would for TTS narration. */
function mixExternalAudio(config, narrationPath, audioDir, log) {
  const { sh, probe } = require('./util');
  const totalDur = config.scenes.reduce((n, s) => n + (s.dur || 0), 0);
  const process = config.narrationSource?.process;

  // Apply voice processing to the narration before mixing with bed/sfx.
  let voicePath = narrationPath;
  if (process) {
    const processed = path.join(audioDir, 'voice-processed.wav');
    const filters = [];
    if (process.highpass) filters.push(`highpass=f=${process.highpass}`);
    if (process.lowpass) filters.push(`lowpass=f=${process.lowpass}`);
    if (process.compressor) {
      // FFmpeg expresses acompressor attack/release in milliseconds and its
      // accepted attack range starts at 0.01. Five/100 ms are voice-safe.
      filters.push(`acompressor=threshold=${process.compressor.threshold}:ratio=${process.compressor.ratio}:attack=5:release=100`);
    }
    if (process.loudness) {
      filters.push(`loudnorm=I=${process.loudness.target}:TP=${process.loudness.peak}:LRA=${process.loudness.lra}:linear=true`);
    }
    if (filters.length) {
      try {
        sh('ffmpeg', [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-i', narrationPath,
          '-af', filters.join(','),
          processed,
        ]);
        voicePath = processed;
        log('  processed: voice cleanup applied');
      } catch (e) {
        log(`  note: voice processing failed (${e.message}) — using raw narration`);
      }
    }
  }

  // Build ffmpeg filter complex for mixing narration + bed + sfx.
  const filters = [];
  const inputs = ['-i', voicePath];
  let inputIdx = 0;
  inputIdx++; // narration is input 0

  // Narration: ensure stereo, pad to total duration.
  filters.push(`[${inputIdx - 1}:a]pan=stereo|c0=c0|c1=c0,apad=whole_dur=${totalDur}[voice]`);

  if (config.bed && config.bed.file) {
    inputs.push('-i', config.bed.file);
    const vol = config.bed.volume ?? 0.14;
    const fadeIn = config.bed.fadeIn ?? 0.5;
    const fadeOut = config.bed.fadeOut ?? 1.5;
    let bedFilter = `[${inputIdx}:a]atrim=start=0:end=${totalDur}`;
    if (fadeIn > 0) bedFilter += `,afade=t=in:d=${fadeIn}`;
    if (fadeOut > 0) bedFilter += `,afade=t=out:st=${totalDur - fadeOut}:d=${fadeOut}`;
    bedFilter += `,volume=${vol}[bed]`;
    filters.push(bedFilter);
    inputIdx++;
  }

  for (const sfx of (config.sfx || [])) {
    inputs.push('-i', sfx.file);
    const vol = sfx.volume ?? 0.8;
    const delay = sfx.at ?? 0;
    filters.push(`[${inputIdx}:a]adelay=${Math.round(delay * 1000)}|${Math.round(delay * 1000)},volume=${vol}[sfx${inputIdx}]`);
    inputIdx++;
  }

  // Amix all sources.
  const mixInputs = ['[voice]'];
  if (config.bed) mixInputs.push('[bed]');
  for (let i = 0; i < (config.sfx || []).length; i++) mixInputs.push(`[sfx${i + (config.bed ? 2 : 1)}]`);
  filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0,alimiter=limit=0.95[a]`);

  try {
    sh('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      ...inputs,
      '-filter_complex', filters.join(';'),
      '-map', '[a]',
      '-ar', '48000', '-ac', '2',
      '-t', String(totalDur),
      path.join(audioDir, 'mix.wav'),
    ]);
    log('  mixed: narration + bed/sfx -> mix.wav');
  } catch (e) {
    log(`  note: audio mixing failed (${e.message}) — using raw narration (no bed/sfx in preview)`);
  }
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
  const original = resolvedConfig || {};
  return {
    // Start from the complete validated authoring surface. The enriched
    // manifest then wins for canonical/timing-bearing fields below. This keeps
    // new config features from silently disappearing at the synth -> compose
    // boundary simply because this compatibility bridge was not updated.
    ...original,
    title: m.project?.title || 'narova',
    renderer: m.renderer?.provider || m.environment?.renderer || 'hyperframes',
    platform: m.project?.platform || null,
    size: m.format ? { w: m.format.width, h: m.format.height } : { w: 1280, h: 720 },
    voices: resolvedConfig ? resolvedConfig.voices : Object.fromEntries(Object.entries(m.voices || {}).map(([id, v]) => [id, {
      label: v.label, color: v.color, backend: v.backend, speaker: v.speaker,
      ...(v.gainDb != null ? { gainDb: v.gainDb } : {}),
      ...(v.lang ? { lang: v.lang } : {}),
      ...(v.instruct ? { instruct: v.instruct } : {}),
      ...(v.exaggeration != null ? { exaggeration: v.exaggeration } : {}),
      ...(v.cfg_weight != null ? { cfg_weight: v.cfg_weight } : {}),
      ...(v.providerProtocol ? { providerProtocol: v.providerProtocol } : {}),
      ...(v.providerVersion ? { providerVersion: v.providerVersion } : {}),
      ...(v.providerOptions ? { providerOptions: v.providerOptions } : {}),
    }])),
    theme: { ...(m.theme || {}), accent: m.theme?.accent, bg: m.theme?.bg },
    mode: m.theme?.mode || 'dark',
    chrome: m.chrome || {},
    themeCss: m.theme?.css || '',
    choreography: m.choreography || '',
    timing: m.timing || {},
    scenes: (m.scenes || []).map((s, i) => ({
      ...((original.scenes || [])[i] || {}),
      id: s.id, body: s.body || '', visual: s.visual || null, clip: s.clip || null, dur: s.dur || null,
      minDur: s.minDur != null ? s.minDur : null,
      clipAudio: s.clipAudio || ((original.scenes || [])[i]?.clipAudio) || null,
      walkthrough: s.walkthrough || null, three: s.three || null,
      transition: s.transition || 'fade',
      vo: (s.vo || []).map(t => ({ who: t.who, text: t.text, ...(t.lang ? { lang: t.lang } : {}), ...(t.synthesisText ? { synthesisText: t.synthesisText } : {}), ...(t.take != null ? { take: t.take } : {}) })),
      _choreographyFileContents: s._choreographyFileContents || ((original.scenes || [])[i]?._choreographyFileContents) || '',
      _scriptFileContents: s._scriptFileContents || ((original.scenes || [])[i]?._scriptFileContents) || '',
      _threeModuleContents: s._threeModuleContents || ((original.scenes || [])[i]?._threeModuleContents) || '',
      _cssFileContents: s._cssFileContents || ((original.scenes || [])[i]?._cssFileContents) || '',
    })),
    captions: m.captions || {},
    captionsEnabled: m.captions?.enabled !== false,
    includePatterns: m.includePatterns !== false,
    // Pre-0.28 manifests predate the flag and used this geometry implicitly.
    // New manifests always serialize false for the genuinely raw default.
    safeLayout: m.safeLayout == null ? true : m.safeLayout === true,
    markers: m.markers || original.markers || {},
    imports: resolvedConfig ? (resolvedConfig.imports || {}) : (m.importSources || {}),
    align: m.align || false,
    bed: m.audio?.bed ? { file: m.audio.bed.file, volume: m.audio.bed.volume } : null,
    sfx: (m.audio?.sfx || []).map(s => ({ file: s.file, scene: s.scene, at: s.at, volume: s.volume })),
    variants: (m.variants || []).map(v => ({
      id: v.id, kind: v.kind || 'hook',
      scene: v.scene ? { body: v.scene.body, visual: v.scene.visual || null, three: v.scene.three || null, vo: v.scene.vo } : null,
      sceneOverrides: v.sceneOverrides || null,
      theme: v.theme || null,
      captions: v.captions || null,
      timing: v.timing || null,
    })),
    variant: m.variant || null,
    series: m.series || null,
    walkthroughs: resolvedConfig ? resolvedConfig.walkthroughs : (m.walkthroughs || {}),
    characters: resolvedConfig ? resolvedConfig.characters : {},
    // Preserve resolved filesystem paths from the original config.
    // These are needed by compose for asset copying and clip resolution.
    assetsDir: resolvedConfig ? resolvedConfig.assetsDir : undefined,
    projectDir: resolvedConfig ? resolvedConfig.projectDir : undefined,
  };
}

module.exports = { build, synth, writeStageInputs, commitFingerprint, resolveReuse, audioFingerprint, findPython, ensureVenv, TOOL_ROOT, compileTimeline, enrichTimeline, configFromManifest };
