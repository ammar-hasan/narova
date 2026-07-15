'use strict';
/* Orchestration: render -> synth (Python) -> inject -> capture -> assemble.
 * Keeps the two language boundaries clean (SPEC): Node owns everything except
 * synth, which shells out to the narova_tts Python module. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureDir } = require('./util');
const { render } = require('./render');
const { capture } = require('./capture');
const { assemble } = require('./assemble');

/* ---- Python (synth) handoff -------------------------------------------------
 * Contract: <venv-python> -m narova_tts --narration <out>/narration.json
 *   --config <out>/config.resolved.json --out <out> [--backend piper|xtts] [--reuse]
 * It writes <out>/audio/NN.{wav,mp3} and <out>/timings.json. */

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

function synth(outDir, opts = {}) {
  const py = opts.python || findPython(opts.projectDir);
  const args = ['-m', 'narova_tts',
    '--narration', path.join(outDir, 'narration.json'),
    '--config', path.join(outDir, 'config.resolved.json'),
    '--out', outDir];
  if (opts.backend) args.push('--backend', opts.backend);
  if (opts.reuse) args.push('--reuse');
  (opts.log || console.log)(`synth: ${py} ${args.join(' ')}`);
  const r = spawnSync(py, args, { stdio: 'inherit', cwd: REPO_ROOT, env: { ...process.env, PYTHONPATH: path.join(REPO_ROOT, 'py') } });
  if (r.error) throw new Error(`synth failed to launch (${py}): ${r.error.message}`);
  if (r.status !== 0) throw new Error(`synth (narova_tts) exited ${r.status}`);
  const timings = path.join(outDir, 'timings.json');
  if (!fs.existsSync(timings)) throw new Error(`synth produced no timings.json in ${outDir}`);
  return { timings };
}

/* ---- token injection -------------------------------------------------------- */

/* Replace __AUDIO_DATA__ / __TIMINGS_DATA__ in player.html (real audio) and
 * record.html (empty audio) — exactly as reference/pipeline.build_video.py does. */
function inject(outDir, narration) {
  const timings = JSON.parse(fs.readFileSync(path.join(outDir, 'timings.json'), 'utf8'));
  const audioDir = path.join(outDir, 'audio');
  const audioMap = {};
  for (const s of narration) {
    const mp3 = path.join(audioDir, `${String(s.n).padStart(2, '0')}.mp3`);
    if (fs.existsSync(mp3)) {
      audioMap[s.id] = 'data:audio/mpeg;base64,' + fs.readFileSync(mp3).toString('base64');
    }
  }
  const tj = JSON.stringify(timings);

  const playerPath = path.join(outDir, 'player.html');
  const player = fs.readFileSync(playerPath, 'utf8')
    .replace('__AUDIO_DATA__', JSON.stringify(audioMap))
    .replace('__TIMINGS_DATA__', tj);
  fs.writeFileSync(playerPath, player);

  const recordPath = path.join(outDir, 'record.html');
  const record = fs.readFileSync(recordPath, 'utf8')
    .replace('__AUDIO_DATA__', '{}')
    .replace('__TIMINGS_DATA__', tj);
  fs.writeFileSync(recordPath, record);

  return { timings, audioMap };
}

/* ---- full build ------------------------------------------------------------- */

function build(config, opts = {}) {
  const outDir = path.resolve(opts.out || 'out');
  ensureDir(outDir);
  const log = opts.log || console.log;

  log('[1/5] render');
  const r = render(config, outDir);
  const narration = JSON.parse(fs.readFileSync(r.narration, 'utf8'));

  log(`[2/5] synth${opts.reuse ? ' (--reuse)' : ''}`);
  synth(outDir, { backend: opts.backend, reuse: opts.reuse, projectDir: opts.projectDir, python: opts.python, log });

  log('[3/5] inject audio + timings');
  const { timings } = inject(outDir, narration);

  log('[4/5] capture');
  const sceneIds = config.scenes.map(s => s.id);
  const framesDir = path.join(outDir, 'frames');
  return capture(path.join(outDir, 'record.html'), timings, sceneIds, config.size, framesDir,
    { workers: opts.workers, chrome: opts.chrome, log }).then(({ times, total }) => {
    log('[5/5] assemble');
    const sceneNums = narration.map(s => s.n);
    const res = assemble({
      framesDir, times, total,
      audioDir: path.join(outDir, 'audio'), sceneNums, outDir,
      name: opts.name || 'video.mp4', log,
    });
    log(`done -> ${res.mp4}  (${res.seconds.toFixed(1)}s)`);
    return { ...r, mp4: res.mp4, seconds: res.seconds };
  });
}

module.exports = { build, synth, inject, findPython };
