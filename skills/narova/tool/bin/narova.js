#!/usr/bin/env node
'use strict';
/* narova CLI — a scene script becomes a narrated, captioned video.
 * narova writes the words and the voice; HyperFrames draws the pictures.
 * Zero runtime deps: a tiny arg parser drives check / synth / compose / build /
 * preview / voices / doctor / init. */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { loadProjectConfig } = require('../src/config');
const { resolveConfig } = require('../src/schema');
const { synth, writeStageInputs, build, findPython, resolveReuse } = require('../src/pipeline');
const { compose } = require('../src/compose');
const { composeData } = require('../src/compose/data');
const { runHf, previewUrl, startHfPreview, stopHfPreview, livePreviewPid, previewPort } = require('../src/hf');
const { initProject } = require('../src/init');
const { doctor } = require('../src/doctor');
const { check } = require('../src/check');

const BOOL_FLAGS = new Set(['reuse', 'detach', 'stop', 'help', 'h', 'version']);

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      if (BOOL_FLAGS.has(key)) { flags[key] = true; continue; }
      // Every remaining flag expects a value; a bare `--tempo` must error, not
      // silently resolve to `true` (Number(true)===1, "true" -> hyperframes).
      const nxt = argv[i + 1];
      if (nxt != null && !nxt.startsWith('--')) { flags[key] = nxt; i++; }
      else { console.error(`--${key} needs a value`); process.exit(1); }
    } else positionals.push(a);
  }
  return { positionals, flags };
}

function overridesFrom(flags) {
  const o = {};
  if (flags.backend) o.backend = flags.backend;
  if (flags.size) o.size = flags.size;
  if (flags.tempo != null) o.tempo = flags.tempo;
  if (flags['voice-a']) o.voiceA = flags['voice-a'];
  if (flags['voice-b']) o.voiceB = flags['voice-b'];
  return o;
}

async function loadResolved(flags) {
  const projectDir = flags.project || '.';
  const { raw, dir } = await loadProjectConfig(projectDir, flags.config);
  const config = resolveConfig(raw, overridesFrom(flags), dir);
  return { config, projectDir: dir };
}

const outDirOf = (flags, projectDir) =>
  path.resolve(flags.out || path.join(projectDir || '.', 'out'));

/* Studio serves out/hf from disk and does not hot-reload; compose deletes and
 * recreates that directory, so a detached preview left running would keep
 * showing the OLD build (or an empty 00:00 canvas). Instead of just warning,
 * restart it on the new build — the review URL the user has open starts
 * serving fresh frames. */
function refreshPreviewIfLive(out) {
  const pidFile = path.join(out, 'preview.pid');
  const pid = livePreviewPid(pidFile);
  if (!pid) return;
  const port = previewPort(pidFile) || 3002;
  try {
    stopHfPreview(pidFile);
    const p = startHfPreview(path.join(out, 'hf'), {
      port, logFile: path.join(out, 'preview.log'), pidFile,
    });
    console.log(`Studio restarted on the new build -> ${p.url}  (pid ${p.pid}; stop: narova preview --stop)`);
  } catch (e) {
    console.error(`note: could not restart the detached preview (${e.message}) — restart it yourself: narova preview --detach`);
  }
}

const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/* Print when each scene starts — the QA timeline for snapshots and review. */
function printSceneTable(config, out) {
  const timings = JSON.parse(fs.readFileSync(path.join(out, 'timings.json'), 'utf8'));
  const data = composeData(config, timings);
  console.log('scene starts:');
  for (const sc of data.scenes) {
    console.log(`  ${fmtTime(sc.start)}  ${sc.id}  (${sc.dur.toFixed(1)}s)`);
  }
  console.log(`  ${fmtTime(data.total)}  end`);
}

const HELP = `narova — a scene script becomes a narrated, captioned video
(narova writes the words and the voice; HyperFrames draws the pictures)

Usage: narova <command> [options]

Commands:
  init <dir>            scaffold a project (config + one example scene)
  check                validate config fast — no TTS, no browser, no writes
  synth                Python TTS -> out/audio/*, out/timings.json
  compose              timings + audio -> out/hf/ (HyperFrames project)
  shots                snapshot one QA frame per scene into out/hf/snapshots/
  build                synth + compose + hyperframes render -> out/video.mp4
  preview              compose, then open HyperFrames Studio on out/hf
  voices list|get      list / download TTS voices (delegates to narova_tts)
  doctor               check ffmpeg, ffprobe, python venv, npx hyperframes

Commands find the project from the current folder OR any parent folder, so
they work from inside out/ and out/hf too. A detached Studio preview is
restarted automatically whenever compose/build replaces out/hf.

Options:
  --backend piper|xtts|qwen   TTS backend
  --reuse                  skip synth, reuse out/audio + out/timings.json
                           (ignored automatically if the spoken text changed)
  --tempo N                narration tempo (atempo)
  --size 16:9|1:1|9:16     frame aspect
  --fps N                  render fps (hyperframes; default 30)
  --quality draft|standard|high   render quality (hyperframes)
  --at t1,t2,...           shots: explicit frame times (default: mid-scene)
  --port N                 Studio port (default 3002)
  --detach                 keep Studio running and return its URL + pid
  --stop                   stop a detached Studio preview
  --out <dir>              output dir (default <project>/out)
  --project <dir>          project dir (default .)
  --config <file>          explicit config path
  --voice-a <s> --voice-b <s>   override voices
`;

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const cmd = positionals[0];

  if (flags.version) { console.log(require('../package.json').version); return; }
  if (!cmd || flags.help || flags.h || cmd === 'help' || cmd === '-h') { console.log(HELP); return; }

  switch (cmd) {
    case 'init': {
      const dir = positionals[1];
      if (!dir) { console.error('usage: narova init <dir>'); process.exit(1); }
      initProject(dir);
      return;
    }

    case 'check': {
      let config;
      try { ({ config } = await loadResolved(flags)); }
      catch (e) { console.error(e.message); process.exit(1); }
      check(config);
      return;
    }

    case 'render':
      console.error('narova render was removed in 0.3.0 — use "narova compose" (generate the HyperFrames project) or "narova build" (full mp4)');
      process.exit(1);
      break;

    case 'synth': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const reuse = resolveReuse(config, out, flags.reuse);
      writeStageInputs(config, out);
      synth(out, { backend: flags.backend, reuse, projectDir });
      console.log(`synth complete -> ${out}/audio (incl. full.wav), ${out}/timings.json`);
      return;
    }

    case 'compose': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const r = compose(config, out);
      console.log(`composed ${r.scenes} scenes (${r.total}s) -> ${r.dir}`);
      printSceneTable(config, out);
      console.log(`  qa: narova shots   ·   preview: narova preview --detach   ·   render: narova build --reuse`);
      refreshPreviewIfLive(out);
      return;
    }

    case 'shots': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const timingsPath = path.join(out, 'timings.json');
      const hfDir = path.join(out, 'hf');
      if (!fs.existsSync(timingsPath)) {
        console.error('shots needs out/timings.json — run `narova synth` first');
        process.exit(1);
      }
      if (!fs.existsSync(path.join(hfDir, 'index.html'))) {
        console.error('shots needs out/hf/index.html — run `narova compose` first');
        process.exit(1);
      }
      const data = composeData(config, JSON.parse(fs.readFileSync(timingsPath, 'utf8')));
      // One QA frame per scene, mid-scene by default; --at t1,t2 overrides.
      const times = flags.at
        ? String(flags.at).split(',').map(Number)
        : data.scenes.map(sc => Math.round((sc.start + sc.dur / 2) * 10) / 10);
      if (times.some(t => !Number.isFinite(t))) {
        console.error('--at needs comma-separated seconds, e.g. --at 0.8,6.2,14');
        process.exit(1);
      }
      runHf(['snapshot', '--at', times.join(','), '-o', 'snapshots/review'], hfDir);
      console.log(`frames -> ${path.join(hfDir, 'snapshots', 'review')}  (${times.length} @ ${times.join(', ')})`);
      console.log('look at every frame — lint misses glyph bleed and chrome collisions; your eyes are the check');
      return;
    }

    case 'build': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      build(config, {
        out, projectDir,
        backend: flags.backend, reuse: flags.reuse,
        fps: flags.fps, quality: flags.quality,
      });
      refreshPreviewIfLive(out);
      return;
    }

    case 'preview': {
      const project = path.resolve(flags.project || '.');
      const previewOut = outDirOf(flags, project);
      const pidFile = path.join(previewOut, 'preview.pid');
      if (flags.stop) {
        console.log(stopHfPreview(pidFile) ? `preview stopped (${pidFile})` : 'no detached preview is running');
        return;
      }
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const r = compose(config, out);
      if (flags.detach) {
        // A live Studio keeps serving the directory compose just replaced, so
        // re-running preview --detach means "show me the new build": stop the
        // stale server and start fresh on its port (compose already ran above).
        const stale = livePreviewPid(pidFile);
        const rememberedPort = previewPort(pidFile);
        if (stale) {
          console.log(`restarting Studio (was pid ${stale}) — detached previews do not hot-reload`);
          stopHfPreview(pidFile);
        }
        const port = Number(flags.port || rememberedPort || 3002);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535');
        const p = startHfPreview(r.dir, {
          port,
          logFile: path.join(out, 'preview.log'),
          pidFile,
        });
        console.log(`Studio running -> ${p.url}`);
        console.log(`  pid ${p.pid} · log ${p.logFile} · stop: narova preview --stop --project ${projectDir}`);
      } else {
        const port = Number(flags.port || 3002);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535');
        console.log(`composed -> ${r.dir}`);
        console.log(`Studio -> ${previewUrl(r.dir, port)} (Ctrl-C to stop)`);
        runHf(['preview', '--port', String(port)], r.dir);
      }
      return;
    }

    case 'voices': {
      const sub = positionals[1] || 'list';
      const py = findPython(flags.project || '.');
      const args = ['-m', 'narova_tts', 'voices', sub, ...positionals.slice(2)];
      if (flags.backend) args.push('--backend', flags.backend);
      const r = spawnSync(py, args, { stdio: 'inherit', env: { ...process.env, PYTHONPATH: path.join(__dirname, '..', 'py') } });
      if (r.error) { console.error(`voices failed to launch (${py}): ${r.error.message}`); process.exit(1); }
      process.exitCode = r.status || 0;
      return;
    }

    case 'doctor': {
      const ok = doctor(flags.project || '.');
      process.exitCode = ok ? 0 : 1;
      return;
    }

    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch(err => { console.error('error:', err.message); process.exit(1); });
