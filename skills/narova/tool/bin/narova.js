#!/usr/bin/env node
'use strict';
/* narova CLI — a scene script becomes a narrated, captioned video.
 * narova writes the words and the voice; HyperFrames draws the pictures.
 * Zero runtime deps: a tiny arg parser drives check / synth / compose / build /
 * preview / voices / doctor / init. */
const path = require('path');
const { spawnSync } = require('child_process');
const { loadProjectConfig } = require('../src/config');
const { resolveConfig } = require('../src/schema');
const { synth, writeStageInputs, build, findPython } = require('../src/pipeline');
const { compose } = require('../src/compose');
const { runHf } = require('../src/hf');
const { initProject } = require('../src/init');
const { doctor } = require('../src/doctor');
const { check } = require('../src/check');

const BOOL_FLAGS = new Set(['reuse', 'help', 'h', 'version']);

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
      const nxt = argv[i + 1];
      if (nxt != null && !nxt.startsWith('--')) { flags[key] = nxt; i++; } else { flags[key] = true; }
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

const outDirOf = (flags, projectDir) => {
  if (flags.out === true) { console.error('--out needs a value'); process.exit(1); }
  return path.resolve(flags.out || path.join(projectDir || '.', 'out'));
};

const HELP = `narova — a scene script becomes a narrated, captioned video
(narova writes the words and the voice; HyperFrames draws the pictures)

Usage: narova <command> [options]

Commands:
  init <dir>            scaffold a project (config + one example scene)
  check                validate config fast — no TTS, no browser, no writes
  synth                Python TTS -> out/audio/*, out/timings.json
  compose              timings + audio -> out/hf/ (HyperFrames project)
  build                synth + compose + hyperframes render -> out/video.mp4
  preview              compose, then open HyperFrames Studio on out/hf
  voices list|get      list / download TTS voices (delegates to narova_tts)
  doctor               check ffmpeg, ffprobe, python venv, npx hyperframes

Options:
  --backend piper|xtts|qwen   TTS backend
  --reuse                  skip synth, reuse out/audio + out/timings.json
  --tempo N                narration tempo (atempo)
  --size 16:9|1:1|9:16     frame aspect
  --fps N                  render fps (hyperframes; default 30)
  --quality draft|standard|high   render quality (hyperframes)
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
      writeStageInputs(config, out);
      synth(out, { backend: flags.backend, reuse: flags.reuse, projectDir });
      console.log(`synth complete -> ${out}/audio (incl. full.wav), ${out}/timings.json`);
      return;
    }

    case 'compose': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const r = compose(config, out);
      console.log(`composed ${r.scenes} scenes (${r.total}s) -> ${r.dir}`);
      console.log(`  preview: narova preview   ·   render: narova build --reuse`);
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
      return;
    }

    case 'preview': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const r = compose(config, out);
      console.log(`composed -> ${r.dir}; opening HyperFrames Studio (Ctrl-C to stop)`);
      runHf(['preview'], r.dir);
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
