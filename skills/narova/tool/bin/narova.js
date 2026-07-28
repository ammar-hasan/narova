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
const { synth, writeStageInputs, build, findPython, resolveReuse, compileTimeline, enrichTimeline } = require('../src/pipeline');
const { compose } = require('../src/compose');
const { composeData } = require('../src/compose/data');
const { writeCaptions } = require('../src/captions');
const { runHf, previewUrl, startHfPreview, stopHfPreview, livePreviewPid, previewPort } = require('../src/hf');
const { initProject } = require('../src/init');
const { doctor } = require('../src/doctor');
const { check } = require('../src/check');
const { ingest } = require('../src/ingest');
const { addSample, removeSample, listSamples } = require('../src/samples');
const { plan, loadCurrent, lastManifest, formatPlan } = require('../src/plan');
const { save: saveRelease, list: listReleases, restore: restoreRelease, remove: removeRelease } = require('../src/releases');

const BOOL_FLAGS = new Set(['reuse', 'detach', 'stop', 'help', 'h', 'version', 'variants', 'safe-area-guides', 'overwrite']);

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  // Flags that can be either boolean OR take a value (bare = true, with value = string).
  const BOOL_OR_VALUE = new Set(['deliverables']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { flags[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      if (BOOL_OR_VALUE.has(key)) {
        const nxt = argv[i + 1];
        if (nxt != null && !nxt.startsWith('--')) {
          flags[key] = nxt; i++;
        } else {
          flags[key] = true;
        }
        continue;
      }
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
  if (flags.platform) o.platform = flags.platform;
  if (flags.variant) o.variant = flags.variant;
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

/* Studio serves out/hf-<slug> from disk and does not hot-reload; compose deletes and
 * recreates that directory, so a detached preview left running would keep
 * showing the OLD build (or an empty 00:00 canvas). Instead of just warning,
 * restart it on the new build — the review URL the user has open starts
 * serving fresh frames. */
function findHfDir(out) {
  if (!fs.existsSync(out)) return path.join(out, 'hf');
  try {
    const entries = fs.readdirSync(out, { withFileTypes: true });
    const match = entries.find(e => e.isDirectory() && e.name.startsWith('hf-'));
    if (match) return path.join(out, match.name);
  } catch (_) { /* out doesn't exist yet — fall through to legacy */ }
  return path.join(out, 'hf');
}

function refreshPreviewIfLive(out) {
  const hfDir = findHfDir(out);
  const pidFile = path.join(out, 'preview.pid');
  const pid = livePreviewPid(pidFile);
  if (!pid) return;
  const port = previewPort(pidFile) || 3002;
  try {
    stopHfPreview(pidFile);
    const p = startHfPreview(hfDir, {
      port, logFile: path.join(out, 'preview.log'), pidFile,
    });
    console.log(`Studio restarted on the new build -> ${p.url}  (pid ${p.pid}; stop: narova preview --stop)`);
  } catch (e) {
    console.error(`note: could not restart the detached preview (${e.message}) — restart it yourself: narova preview --detach`);
  }
}

const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function projectSlug(config) {
  return String(config.title || 'narova').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'narova';
}

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
  ingest <url>          fetch a source page: download images into assets/,
                           screenshot it (if Chrome), append sources.md,
                           seed claims.md — the mechanical pass of url-to-source
  compile               compile reel.config -> out/manifest.json
                           (versioned intermediate representation; also written
                           automatically by synth, compose, and build)
  check                validate config fast — no TTS, no browser, no writes
  plan                 compare current config against the last manifest;
                           classify what changed and which stages will rebuild
  release save <name>  save out/manifest.json as a named release
  release list         list all saved releases
  release restore <n>  restore a saved release to out/manifest.json
  release remove <n>   delete a saved release
  synth                Python TTS -> out/audio/*, out/timings.json
  compose              timings + audio -> out/hf/ (HyperFrames project) + captions
  captions             (re)write out/captions.srt + out/captions.vtt from out/timings.json
  shots                snapshot one QA frame per scene into out/hf/snapshots/
  build                synth + compose + hyperframes render -> out/video.mp4
  preview              compose, then open HyperFrames Studio on out/hf
  voices list|get      list / download TTS voices (delegates to narova_tts)
  voice sample add <file> <name>   save a clone sample for chatterbox
  voice sample list                list saved clone samples
  voice sample remove <name>       remove a saved clone sample
  doctor               check ffmpeg, ffprobe, python venv, npx hyperframes

Commands find the project from the current folder OR any parent folder, so
they work from inside out/ and out/hf too. A detached Studio preview is
restarted automatically whenever compose/build replaces out/hf.

Options:
  --backend piper|xtts|qwen|chatterbox   TTS backend (chatterbox = voice cloning)
  --reuse                  skip synth, reuse out/audio + out/timings.json
                           (ignored automatically if the spoken text changed)
  --tempo N                narration tempo (atempo)
  --size 16:9|1:1|9:16     frame aspect
  --platform tiktok|reels|shorts|linkedin|x   frame preset + target duration band
                           (--size wins over the platform preset)
  --variant <id>           apply a declared hook variant as scene 1 (check/synth/
                           compose/build; build renders out/video-<id>.mp4)
  --variants               build the base video.mp4 AND one out/video-<id>.mp4
                            per declared variant (shared sentences are cache-free)
  --deliverables           build: render per-platform deliverables (one mp4 per
                            export profile + thumbnails, ffmpeg post-processed)
  --deliverables ids      build: comma-separated export preset ids or "true"
                            for all profiles (e.g. --deliverables youtube-1080p,reels-1080p)
  --fps N                  render fps (hyperframes; default 30)
  --quality draft|standard|high   render quality (hyperframes)
  --safe-area-guides       build: overlay TikTok safe-area zones on the output
                            (authoring/QA only — not burned in by default)
  --at t1,t2,...           shots: explicit frame times (default: mid-scene)
  --port N                 Studio port (default 3002)
  --detach                 keep Studio running and return its URL + pid
  --stop                   stop a detached Studio preview
  --out <dir>              output dir (default <project>/out)
  --project <dir>          project dir (default .)
  --config <file>          explicit config path
  --voice-a <s> --voice-b <s>   override the first two voices (add more in config)
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

    case 'ingest': {
      const url = positionals[1];
      if (!url) { console.error('usage: narova ingest <url> [--project <dir>]'); process.exit(1); }
      await ingest(url, { projectDir: path.resolve(flags.project || '.') });
      return;
    }

    case 'compile': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      compileTimeline(config, { out });
      console.log(`manifest -> ${path.join(out, 'manifest.json')}`);
      return;
    }

    case 'check': {
      let config;
      try { ({ config } = await loadResolved(flags)); }
      catch (e) { console.error(e.message); process.exit(1); }
      check(config);
      return;
    }

    case 'plan': {
      const { config, dir } = await loadCurrent(flags.project || '.');
      const out = outDirOf(flags, dir);
      const prev = lastManifest(out);
      if (!prev) {
        console.log('no previous manifest found in', out);
        console.log('run `narova compile` or `narova build` first to generate one');
        process.exit(1);
      }
      const result = plan(prev, config, { toolVersion: require('../package.json').version });
      console.log(formatPlan(result));
      return;
    }

    case 'release': {
      const sub = positionals[1];
      const projectDir = flags.project || '.';
      const out = outDirOf(flags, projectDir);
      const mp = path.join(out, 'manifest.json');
      // restore and list don't require an existing manifest
      // save and restore need a project context, but list/remove work globally
      const needsManifest = sub === 'save';
      if (needsManifest && !fs.existsSync(mp)) {
        console.error(`no manifest found in ${out} — run narova compile or build first`);
        process.exit(1);
      }
      if (!sub || sub === 'list') {
        const entries = listReleases();
        if (entries.length === 0) {
          console.log('no releases saved yet — narova release save <name>');
        } else {
          for (const e of entries) {
            const kb = (e.size / 1024).toFixed(1);
            const dur = e.duration ? `  ${e.duration.toFixed(1)}s` : '';
            console.log(`  ${e.name.padEnd(24)} ${kb.padStart(6)}KB${dur}  ${new Date(e.created).toISOString().slice(0,16).replace('T',' ')}  ${e.title || ''}`);
          }
          console.log(`\n${entries.length} release(s) in ${require('../src/releases').RELEASES_DIR}`);
        }
        return;
      }
      if (sub === 'save') {
        const name = positionals[2];
        if (!name) { console.error('usage: narova release save <name>'); process.exit(1); }
        const projectDir = path.resolve(flags.project || '.');
        const r = saveRelease(mp, name, { projectDir });
        console.log(`release "${r.name}" saved -> ${r.dir}  (${r.files.length} files: ${r.files.join(', ')})`);
        return;
      }
      if (sub === 'restore') {
        const name = positionals[2];
        if (!name) { console.error('usage: narova release restore <name>'); process.exit(1); }
        const result = restoreRelease(name, out, {
          projectDir: path.resolve(flags.project || '.'),
          overwrite: flags.overwrite,
          newProject: flags['new-project'],
        });
        console.log(`release "${name}" restored -> ${result.manifest}`);
        if (result.restored.length) console.log(`  restored: ${result.restored.join(', ')}`);
        if (result.conflicts.length) console.log(`  skipped (existing): ${result.conflicts.join(', ')}`);
        return;
      }
      if (sub === 'remove') {
        const name = positionals[2];
        if (!name) { console.error('usage: narova release remove <name>'); process.exit(1); }
        removeRelease(name);
        console.log(`release "${name}" removed`);
        return;
      }
      console.error('usage: narova release save|list|restore|remove [name]');
      process.exit(1);
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
      synth(out, { backend: flags.backend, reuse, projectDir, config });
      enrichTimeline(out);   // merge measured timings into manifest.json
      console.log(`synth complete -> ${out}/audio (incl. full.wav), ${out}/timings.json`);
      return;
    }

    case 'compose': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const r = compose(config, out);
      console.log(`composed ${r.scenes} scenes (${r.total}s) -> ${r.dir}`);
      const caps = writeCaptions(config, out);
      console.log(`captions -> ${caps.srt} (+ captions.vtt, ${caps.cues} cues)`);
      printSceneTable(config, out);
      console.log(`  qa: narova shots   ·   preview: narova preview --detach   ·   render: narova build --reuse`);
      refreshPreviewIfLive(out);
      return;
    }

    case 'captions': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      if (!fs.existsSync(path.join(out, 'timings.json'))) {
        console.error('captions needs out/timings.json — run `narova synth` first');
        process.exit(1);
      }
      const caps = writeCaptions(config, out);
      console.log(`captions -> ${caps.srt} (+ captions.vtt, ${caps.cues} cues)`);
      return;
    }

    case 'shots': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const timingsPath = path.join(out, 'timings.json');
      const hfDir = findHfDir(out);
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
      if (flags.variant && flags.variants) {
        console.error('--variant and --variants are mutually exclusive — pick one');
        process.exit(1);
      }
      const buildOpts = {
        backend: flags.backend, reuse: flags.reuse,
        fps: flags.fps, quality: flags.quality,
        deliverables: flags.deliverables
          ? (flags.deliverables === true ? true : String(flags.deliverables).split(',').map(s => s.trim()).filter(Boolean))
          : undefined,
        safeAreaGuides: flags['safe-area-guides'],
      };
      if (flags.variants) {
        // One resolved config per pass: base first, then each declared variant.
        // The sentence-level TTS cache makes shared sentences free, so each
        // extra pass only pays for the variant's scene-1 lines.
        const { raw, dir } = await loadProjectConfig(flags.project || '.', flags.config);
        const out = outDirOf(flags, dir);
        // resolveConfig no longer mutates the raw config (scenes are copied),
        // but keep the fresh-copy discipline cheap and explicit per pass.
        const fresh = () => JSON.parse(JSON.stringify(raw));
        const base = resolveConfig(fresh(), overridesFrom(flags), dir);
        if (base.variants.length === 0) {
          console.log('no variants declared in config — building the base video only');
          build(base, { ...buildOpts, out, projectDir: dir });
        } else {
          build(base, { ...buildOpts, out, projectDir: dir });
          for (const v of base.variants) {
            console.log(`\nvariant "${v.id}": only its scene-1 sentences re-synthesize — the sentence cache covers the rest`);
            const vc = resolveConfig(fresh(), { ...overridesFrom(flags), variant: v.id }, dir);
            build(vc, { ...buildOpts, out, projectDir: dir, name: `video-${v.id}.mp4` });
          }
        }
        refreshPreviewIfLive(out);
        return;
      }
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      build(config, {
        ...buildOpts, out, projectDir,
        name: config.variant ? `video-${config.variant}.mp4` : undefined,
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
          logFile: path.join(out, 'preview.log'), pidFile,
          projectName: projectSlug(config),
        });
        console.log(`Studio running -> ${p.url}`);
        console.log(`  pid ${p.pid} · log ${p.logFile} · stop: narova preview --stop --project ${projectDir}`);
      } else {
        const port = Number(flags.port || 3002);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535');
        console.log(`composed -> ${r.dir}`);
        console.log(`Studio -> ${previewUrl(r.dir, port, projectSlug(config))} (Ctrl-C to stop)`);
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

    case 'voice': {
      const sub = positionals[1];
      if (!sub || sub === 'help') {
        console.log('narova voice sample — manage clone recordings for the chatterbox backend\n');
        console.log('  voice sample add <file> <name>     save <file> as a named clone sample');
        console.log('  voice sample list                  list saved clone samples');
        console.log('  voice sample remove <name>         remove a saved clone sample\n');
        console.log('After adding a sample, use chatterbox by name in reel.config:');
        console.log('  voices: { a: { backend: "chatterbox", speaker: "my-voice" } }\n');
        console.log(`Samples live in ~/.narova/samples/`);
        return;
      }
      if (sub !== 'sample') { console.error('unknown voice subcommand — use "voice sample"'); process.exit(1); }
      const action = positionals[2];
      try {
        switch (action) {
          case 'add': {
            const file = positionals[3];
            const name = positionals[4];
            if (!file) { console.error('usage: narova voice sample add <file> <name>'); process.exit(1); }
            const dest = addSample(file, name || path.basename(file, path.extname(file)));
            console.log(`sample "${path.basename(dest, path.extname(dest))}" saved -> ${dest}`);
            console.log('\nUse it in reel.config:');
            console.log(`  voices: { a: { backend: "chatterbox", speaker: "${path.basename(dest, path.extname(dest))}" } }`);
            return;
          }
          case 'list': {
            const samples = listSamples();
            if (samples.length === 0) {
              console.log('No voice samples saved yet.\n');
              console.log('Add one: narova voice sample add <path-to-audio> my-voice');
              console.log('(chatterbox needs 10–20s of clean speech — .wav, .mp3, .flac, or .m4a)');
            } else {
              console.log(`Voice samples (${samples.length}):\n`);
              for (const s of samples) {
                console.log(`  ${s.name.padEnd(20)} ${(s.size / 1024).toFixed(0).padStart(5)} KB  ${s.ext}`);
              }
              console.log(`\nUse by name: speaker: "${samples[0].name}"`);
            }
            return;
          }
          case 'remove': {
            const name = positionals[3];
            if (!name) { console.error('usage: narova voice sample remove <name>'); process.exit(1); }
            const removed = removeSample(name);
            console.log(`removed sample "${path.basename(removed, path.extname(removed))}"`);
            return;
          }
          default:
            console.error('unknown action — use add, list, or remove');
            process.exit(1);
        }
      } catch (e) {
        console.error(`error: ${e.message}`);
        process.exit(1);
      }
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
