#!/usr/bin/env node
'use strict';
/* narova CLI — scenes -> narrated, captioned, kinetic explainer video.
 * Zero runtime deps: a tiny arg parser drives render / synth / build / serve /
 * voices / doctor / init. */
const path = require('path');
const { spawnSync } = require('child_process');
const { loadProjectConfig } = require('../src/config');
const { resolveConfig } = require('../src/render/schema');
const { render } = require('../src/render');
const { synth, inject, build, findPython } = require('../src/pipeline');
const { serve } = require('../src/serve');
const { initProject } = require('../src/init');
const { doctor } = require('../src/doctor');
const { check } = require('../src/check');
const fs = require('fs');

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

const outDirOf = (flags, projectDir) => path.resolve(flags.out || path.join(projectDir || '.', 'out'));

const HELP = `narova — a scene script becomes a narrated, captioned, kinetic explainer video

Usage: narova <command> [options]

Commands:
  init <dir>            scaffold a project (config + one example scene + theme)
  check                validate config fast — no TTS, no Chrome, no writes
  render               scenes -> out/player.html, out/record.html, out/narration.json
  synth                narration.json -> out/audio/*, out/timings.json   (Python)
  build                full pipeline -> out/video.mp4 + out/player.html
  preview | serve      range server for out/ (player + mp4 + landing page)
  voices list|get      list / download TTS voices (delegates to narova_tts)
  doctor               check ffmpeg, ffprobe, chrome, python venv, libass note

Options:
  --backend piper|xtts     TTS backend
  --reuse                  skip synth, reuse out/audio + out/timings.json
  --workers N              capture parallelism (default 10)
  --tempo N                narration tempo (atempo)
  --size 16:9|1:1|9:16     frame aspect
  --out <dir>              output dir (default <project>/out)
  --project <dir>          project dir (default .)
  --config <file>          explicit config path
  --voice-a <s> --voice-b <s>   override voices
  --port N                 serve port (default 8080)
`;

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const cmd = positionals[0];

  if (flags.version) { console.log(require('../package.json').version); return; }
  if (!cmd || flags.help || flags.h || cmd === 'help') { console.log(HELP); return; }

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

    case 'render': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const r = render(config, out);
      console.log(`rendered ${r.scenes} scenes -> ${out}`);
      console.log(`  player.html · record.html · narration.json · config.resolved.json`);
      return;
    }

    case 'synth': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      // render first if narration.json / config.resolved.json are missing.
      if (!fs.existsSync(path.join(out, 'narration.json'))) render(config, out);
      synth(out, { backend: flags.backend, reuse: flags.reuse, projectDir });
      // Inject so player.html/record.html become playable immediately.
      const narration = JSON.parse(fs.readFileSync(path.join(out, 'narration.json'), 'utf8'));
      if (!fs.existsSync(path.join(out, 'player.html'))) render(config, out);
      inject(out, narration);
      console.log(`synth complete -> ${out}/audio, ${out}/timings.json (injected into player.html)`);
      return;
    }

    case 'build': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      await build(config, {
        out, projectDir,
        backend: flags.backend, reuse: flags.reuse,
        workers: flags.workers ? parseInt(flags.workers, 10) : undefined,
      });
      return;
    }

    case 'preview':
    case 'serve': {
      const projectDir = flags.project || '.';
      const out = outDirOf(flags, projectDir);
      let title = 'narova';
      try { const { raw } = await loadProjectConfig(projectDir, flags.config); title = raw.title || title; } catch { /* no config */ }
      serve(out, { port: flags.port ? parseInt(flags.port, 10) : 8080, title });
      return; // keep process alive
    }

    case 'voices': {
      const sub = positionals[1] || 'list';
      const py = findPython(flags.project || '.');
      const args = ['-m', 'narova_tts', 'voices', sub, ...positionals.slice(2)];
      if (flags.backend) args.push('--backend', flags.backend);
      const r = spawnSync(py, args, { stdio: 'inherit', env: { ...process.env, PYTHONPATH: path.join(__dirname, '..', 'py') } });
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
