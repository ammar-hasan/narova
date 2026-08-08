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
const { composeData } = require('../src/compose/data');
const { writeCaptions } = require('../src/captions');
const { runHf, previewUrl, startHfPreview, stopHfPreview, livePreviewPid, previewPort } = require('../src/hf');
const { initProject } = require('../src/init');
const { doctor } = require('../src/doctor');
const { check, critique } = require('../src/check');
const { auditMotion, formatMotionAudit, auditProofFrames, formatProofAudit } = require('../src/motion-audit');
const { writeProofReceipt, verifyProofReceipt, clearProofReceipt, writeProofBundle, verifyProofBundle } = require('../src/proof-receipt');
const { hashFile } = require('../src/manifest');
const { beatReviewTimes, motionReviewTimes } = require('../src/review-times');
const { ingest } = require('../src/ingest');
const { generateKaraoke } = require('../src/karaoke');
const { retime } = require('../src/retime');
const { addSample, removeSample, listSamples } = require('../src/samples');
const { plan, loadCurrent, lastManifest, formatPlan } = require('../src/plan');
const { save: saveRelease, list: listReleases, restore: restoreRelease, remove: removeRelease, saveBranch, readBranch, listBranches, setBranchStatus, setBranchRationale, branchDir, validBranchStatus, publishStagedBranch, branchRevision, projectIdentity, RESTORE_MARKER, RESTORE_OVERRIDES } = require('../src/releases');
const { PROVIDERS, providerInfo, generate, readSpec } = require('../src/generate');
const {
  addProvider, listProviders, removeProvider, doctorProvider, providersDir,
} = require('../src/providers');
const { backendHint } = require('../src/tts-backends');
const {
  composeWithRenderer, renderWithRenderer, shotsWithRenderer,
  getRenderer, listRenderers,
} = require('../src/renderers');
const {
  captureWalkthrough, captureStatus, exploreWalkthrough, safeUrl,
} = require('../src/walkthrough');

const BOOL_FLAGS = new Set(['reuse', 'force', 'detach', 'stop', 'help', 'h', 'version', 'variants', 'safe-area-guides', 'overwrite', 'strict', 'release', 'apply', 'plan', 'motion', 'beats', 'proof', 'verify-motion']);
const BOOL_OR_VALUE = new Set(['deliverables', 'critique']);
const VALUE_FLAGS = new Set(['at', 'backend', 'config', 'duration', 'engine', 'fps', 'max-words', 'model', 'new-project', 'out', 'output', 'parent', 'platform', 'port', 'profile', 'project', 'provider', 'quality', 'rationale', 'regenerate', 'renderer', 'scene', 'size', 'status', 'tempo', 'transcript', 'variant', 'voice-a', 'voice-b']);

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const key = a.slice(2, eq);
        if (!BOOL_FLAGS.has(key) && !BOOL_OR_VALUE.has(key) && !VALUE_FLAGS.has(key)) {
          console.error(`unknown option --${key}`); process.exit(1);
        }
        flags[key] = a.slice(eq + 1); continue;
      }
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
      if (!VALUE_FLAGS.has(key)) { console.error(`unknown option --${key}`); process.exit(1); }
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
  if (flags.renderer) o.renderer = flags.renderer;
  if (flags.tempo != null) o.tempo = flags.tempo;
  if (flags['voice-a']) o.voiceA = flags['voice-a'];
  if (flags['voice-b']) o.voiceB = flags['voice-b'];
  return o;
}

async function loadResolved(flags) {
  const projectDir = flags.project || '.';
  const { raw, dir } = await loadProjectConfig(projectDir, flags.config);
  const out = path.resolve(flags.out || path.join(dir, 'out'));
  let restoredOverrides = {};
  const restoredOverridesFile = path.join(out, RESTORE_OVERRIDES);
  if (fs.existsSync(restoredOverridesFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(restoredOverridesFile, 'utf8'));
      const allowed = new Set(['backend', 'size', 'platform', 'variant', 'renderer', 'tempo', 'voiceA', 'voiceB']);
      restoredOverrides = Object.fromEntries(Object.entries(parsed).filter(([key]) => allowed.has(key)));
    } catch { /* malformed restored overrides are ignored; schema still validates CLI input */ }
  }
  const effectiveOverrides = { ...restoredOverrides, ...overridesFrom(flags) };
  const config = resolveConfig(raw, effectiveOverrides, dir);
  const manifestFile = path.join(out, 'manifest.json');
  const markerFile = path.join(out, RESTORE_MARKER);
  if (fs.existsSync(markerFile) && fs.existsSync(manifestFile)) {
    try {
      const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
      const restored = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      const legacySafeLayout = marker.legacySafeLayout === true || restored.safeLayout == null;
      if (marker.manifestSha256 === hashFile(manifestFile) && legacySafeLayout) {
        if (config._safeLayoutAuthored && config.safeLayout === false) {
          config._retireLegacySafeLayout = true;
          fs.rmSync(markerFile, { force: true });
        } else {
          config._legacySafeLayout = true;
          if (!config._safeLayoutAuthored) config.safeLayout = true;
        }
      }
    } catch { /* malformed or stale restore metadata cannot change layout */ }
  }
  return { config, projectDir: dir, effectiveOverrides };
}

const outDirOf = (flags, projectDir) =>
  path.resolve(flags.out || path.join(projectDir || '.', 'out'));

function verifyMotionIfRequested(built, flags) {
  if (!flags['verify-motion'] && !flags.release) return;
  const report = auditMotion(built.mp4);
  console.log(formatMotionAudit(report));
  if (!report.ok) process.exitCode = 1;
}

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

function proofContactSheets(reviewDir) {
  const found = [];
  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/^contact-sheet\.jpe?g$/i.test(entry.name)) found.push(full);
    }
  }
  visit(reviewDir);
  return found.sort();
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
(HyperFrames for full browser rendering; no-browser for local browserless rendering)

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
                            --strict: verify every claim in claims.md ledger
                            --release: strict + fail on remote deps, missing
                              claims, unsupported HTML, black frames, stale
                              walkthrough captures, or an unapproved non-trivial
                              creative brief (exit 1, for build gates)
  critique [profiles]  opt-in craft review; comma-separate creative, cinematic,
                           social-short, explainer, presentation, accessibility
  plan                 compare current config against the last manifest;
                           classify what changed and which stages will rebuild
  release save <name>  save out/manifest.json as a named release
  release list         list all saved releases
  release restore <n>  restore a saved release to out/manifest.json
  release remove <n>   delete a saved release
  branch save <name>   snapshot the current small proof as a candidate branch
                           --rationale "why this direction may serve the brief"
  branch set <name>    approve/reject/archive a proof branch with --status
  branch list|show     compare saved proof directions and their rationale
  synth                Python TTS -> out/audio/*, out/timings.json
  compose              timings + audio -> selected renderer project + captions
  captions             (re)write out/captions.srt + out/captions.vtt from out/timings.json
  walkthrough explore <id>  open source and print agent-readable interactive page state
  walkthrough capture [id]  record narration-timed product actions with agent-browser
  walkthrough status [id]   report missing/stale/fresh captured walkthrough assets
  shots                snapshot QA frames with the selected renderer
  build                synth + compose + selected renderer -> out/video.mp4
  preview              HyperFrames Studio, or a no-browser draft preview MP4
  renderers list       list bundled local renderer providers and capabilities
  renderers doctor <name>  verify a renderer's local requirements
  voices list|get      list / download TTS voices (delegates to narova_tts)
  providers add <manifest>    register an external TTS provider
  providers list              list explicitly registered providers
  providers remove <name>     unregister an external TTS provider
  providers doctor <name>     verify environment + worker handshake
  voice sample add <file> <name>   save a clone sample for chatterbox
  voice sample list                list saved clone samples
  voice sample remove <name>       remove a saved clone sample
  karaoke generate <audio>         transcribe audio + transcript -> word-timed karaoke JSON + SRT
                                     --transcript <file>  map clean text onto Whisper timings
                                     --max-words N        words per karaoke cue (default 8)
                                     --engine faster-whisper|whisper-cpp|auto (default auto)
  retime <config> <karaoke.json>  print scene duration suggestions aligned to word timings
                                      --apply   rewrite the config file in-place
  generate <prompt>       generate a video clip via AI (Sora / Runway)
                              --provider sora|runway   API provider (default: sora)
                              --output <path>           output file (default: assets/gen-<provider>-<slug>.mp4)
                              --model <id>              provider model (e.g. sora-2, gen4.5)
                              --size <WxH>              generation size/ratio
                              --duration <s>            Sora: 4|8|12; Runway: provider-supported seconds
                              --regenerate <mp4>        re-run a previous clip from its .gen.json spec
                                                        (keeps provider/model/prompt; override any of them)
                              A .gen.json spec sidecar is written next to every clip so the
                              generative intent (prompt/model/params) survives as editable source.
  doctor               check ffmpeg, ffprobe, python venv, agent-browser, npx hyperframes

Commands find the project from the current folder OR any parent folder, so
they work from inside out/ and renderer project folders too. A detached
HyperFrames Studio preview is restarted when its composition is replaced.

Options:
  --backend <name>          TTS backend (${backendHint()} or a registered provider)
  --renderer hyperframes|no-browser   local renderer (default: hyperframes)
  --reuse                  skip synth, reuse out/audio + out/timings.json
                           (ignored automatically if the spoken text changed)
  --force                  synth even when reusable audio exists
  --tempo N                narration tempo (atempo)
  --size 16:9|1:1|9:16     frame aspect
  --platform tiktok|reels|shorts|linkedin|x|youtube   frame preset + target duration band
                           (--size wins over the platform preset)
  --variant <id>           apply a declared hook variant as scene 1 (check/synth/
                           compose/build; build renders out/video-<id>.mp4)
   --variants               build the base video.mp4 AND one out/video-<id>.mp4
                            per declared variant (shared sentences are cache-free)
   --plan                   build: print what this revision will rebuild (scope)
                            before doing the work — advisory, never changes behavior
  --deliverables           build: render per-platform deliverables (one mp4 per
                            export profile + thumbnails, ffmpeg post-processed)
  --deliverables ids      build: comma-separated export preset ids or "true"
                            for all profiles (e.g. --deliverables youtube-1080p,reels-1080p)
  --fps N                  render fps (default 30)
  --quality draft|standard|high   renderer quality
  --safe-area-guides       build: overlay TikTok safe-area zones on the
                            TikTok deliverable (requires --deliverables)
  --at t1,t2,...           shots: explicit frame times (default: mid-scene)
  --motion                 shots: capture start/middle/end of every scene
  --beats                  shots: capture arrival/resolved frames for every
                           narration sentence and both sides of named markers
  --proof                  shots: fail when most sampled pilot frames are
                           near-black or no visual evidence was rendered
  --verify-motion          build: fail on >=2s frozen or >=0.5s black segments
  --port N                 Studio port (default 3002)
  --detach                 keep Studio running and return its URL + pid
  --scene <id>             preview one isolated scene (safe for WebGL-heavy films)
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
      let projectDir;
      try { ({ config, projectDir } = await loadResolved(flags)); }
      catch (e) { console.error(e.message); process.exit(1); }
      const ok = check(config, {
        strict: flags.strict,
        release: flags.release,
        outDir: outDirOf(flags, projectDir),
        critiqueProfile: flags.critique || null,
      });
      // Run critique when requested via --critique flag or as a standalone command.
      if (flags.critique) {
        console.log('');
        critique(config, {
          profile: flags.critique === true ? 'all' : flags.critique,
          projectDir,
          outDir: outDirOf(flags, projectDir),
        });
      }
      if (!ok) process.exitCode = 1;
      return;
    }

    case 'critique': {
      let config;
      let projectDir;
      try { ({ config, projectDir } = await loadResolved(flags)); }
      catch (e) { console.error(e.message); process.exit(1); }
      const profile = positionals[1] || flags.profile || 'all';
      critique(config, { profile, projectDir, outDir: outDirOf(flags, projectDir) });
      return;
    }

    case 'walkthrough': {
      const action = positionals[1] || 'status';
      if (!['explore', 'capture', 'status'].includes(action)) {
        console.error('usage: narova walkthrough explore|capture|status [id]');
        process.exit(1);
      }
      const { config, projectDir } = await loadResolved(flags);
      const declared = Object.keys(config.walkthroughs || {});
      const requested = positionals[2];
      if (action === 'explore' && !requested && declared.length > 1) {
        console.error(`walkthrough explore needs an id — declared: ${declared.join(', ')}`);
        process.exit(1);
      }
      const ids = requested && requested !== 'all'
        ? [requested]
        : (action === 'explore' ? declared.slice(0, 1) : declared);
      if (ids.length === 0) {
        console.error('no walkthroughs declared in reel.config');
        process.exit(1);
      }
      for (const id of ids) {
        if (!config.walkthroughs[id]) {
          console.error(`unknown walkthrough "${id}" — declared: ${declared.join(', ') || '(none)'}`);
          process.exit(1);
        }
      }
      const out = outDirOf(flags, projectDir);
      const timingsPath = path.join(out, 'timings.json');
      const timings = fs.existsSync(timingsPath)
        ? JSON.parse(fs.readFileSync(timingsPath, 'utf8'))
        : null;
      if (action === 'explore') {
        const result = exploreWalkthrough(config, ids[0]);
        console.log(result.snapshot || '(no interactive elements found)');
        console.log(`\nsession stays open: agent-browser --session ${result.session} snapshot -i`);
        return;
      }
      if (action === 'status') {
        for (const id of ids) {
          const status = captureStatus(config, id, timings, { outDir: out });
          console.log(`${status.ok ? '✓' : '○'} ${id}: ${status.ok ? 'fresh' : status.reason}${status.ok && status.manifest ? ` (${status.manifest.media.width}x${status.manifest.media.height}, ${status.manifest.media.duration.toFixed(1)}s)` : ''}`);
        }
        return;
      }
      if (!timings) {
        console.error(`walkthrough capture needs ${timingsPath} — run \`narova synth\` first`);
        process.exit(1);
      }
      for (const id of ids) {
        const flow = config.walkthroughs[id];
        console.log(`walkthrough "${id}" -> ${safeUrl(flow.url)}`);
        if (flow.mutates) {
          console.log('  note: this walkthrough declares mutating actions; use a disposable demo account and seeded data');
        }
        const result = captureWalkthrough(config, id, timings, { outDir: out });
        console.log(`captured -> ${result.recording} (${result.manifest.media.width}x${result.manifest.media.height}, ${result.manifest.media.duration.toFixed(1)}s, ${result.manifest.steps.length} actions)`);
      }
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
        const r = await saveRelease(mp, name, { projectDir });
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

    case 'branch': {
      const sub = positionals[1] || 'list';
      if (sub === 'save') {
        const name = positionals[2];
        const rationale = String(flags.rationale || '').trim();
        if (!name || !rationale) {
          console.error('usage: narova branch save <name> --rationale "why this small proof may serve the brief" [--status candidate|exploring] [--parent <name>]');
          process.exit(1);
        }
        const status = validBranchStatus(flags.status || 'candidate');
        const { config, projectDir, effectiveOverrides } = await loadResolved(flags);
        const out = outDirOf(flags, projectDir);
        const mp = path.join(out, 'manifest.json');
        if (!fs.existsSync(mp)) {
          console.error(`no manifest found in ${out} — run narova compile or compose for the small proof first`);
          process.exit(1);
        }
        const proof = verifyProofReceipt(config, out);
        if (!proof.ok) {
          console.error(`${proof.reason} — rerun narova compose && narova shots --motion --proof before saving this branch`);
          process.exit(1);
        }
        // Build the complete snapshot and external proof bundle under a unique
        // stage name. Only a complete pair can replace an existing branch.
        const stagedName = `branch-stage-${process.pid}-${Date.now()}`;
        const expectedRevision = branchRevision(name);
        let staged = null;
        let published;
        try {
          staged = await saveRelease(mp, stagedName, { projectDir, resolvedOverrides: effectiveOverrides });
          const currentProof = verifyProofReceipt(config, out);
          if (!currentProof.ok) throw new Error(currentProof.reason);
          const metadataDir = branchDir(staged.name);
          fs.mkdirSync(metadataDir, { recursive: true });
          const identity = projectIdentity(projectDir);
          const bundle = writeProofBundle(out, currentProof, metadataDir, staged.dir);
          const stagedBranch = saveBranch(staged.name, {
            rationale,
            status,
            parent: flags.parent || undefined,
            ...bundle,
            snapshotManifestSha256: hashFile(path.join(staged.dir, 'manifest.json')),
            projectIdentity: identity,
          });
          if (!verifyProofBundle(metadataDir, staged.dir, stagedBranch, identity)) {
            throw new Error('staged proof bundle failed integrity verification');
          }
          const expectedStagedRevision = branchRevision(staged.name);
          published = publishStagedBranch(staged.name, name, { expectedRevision, expectedStagedRevision });
        } catch (error) {
          if (staged) {
            try { removeRelease(staged.name); } catch { /* already published or cleaned */ }
          }
          throw error;
        }
        const branch = readBranch(published.name);
        console.log(`proof branch "${published.name}" saved: status=${branch.status} evidence=${branch.evidence.length} proof=${branch.proofIdentity} rationale="${branch.rationale}"`);
        console.log('keep this branch small; compare 2–3 proofs, approve one, then expand only the winner');
        return;
      }
      if (sub === 'list') {
        const entries = listBranches();
        if (!entries.length) {
          console.log('no branches saved yet — compose a small proof, then narova branch save <name> --rationale "..."');
        } else {
          for (const e of entries) {
            const status = e.branch ? `[${e.branch.status}]` : '[—]';
            const parent = e.branch && e.branch.parent ? ` ← ${e.branch.parent}` : '';
            console.log(`  ${status} ${e.name.padEnd(24)} ${parent} ${e.title || ''}`);
            if (e.branch && e.branch.rationale) console.log(`       "${e.branch.rationale}"`);
            if (e.branch && e.branch.proofIdentity) console.log(`       proof identity: ${e.branch.proofIdentity}`);
          }
          console.log(`\n${entries.length} branch(es) in ${require('../src/releases').RELEASES_DIR}`);
        }
        return;
      }
      if (sub === 'set') {
        const name = positionals[2];
        if (!name) { console.error('usage: narova branch set <name> [--status approved|rejected|archived|candidate] [--rationale "..."]'); process.exit(1); }
        const status = flags.status;
        const rationale = flags.rationale;
        let branch = readBranch(name);
        if (!branch) {
          // Auto-create branch metadata for an existing release.
          branch = saveBranch(name, { rationale: rationale || '', status: status || 'exploring' });
        } else {
          if (status) { setBranchStatus(name, status); branch.status = status; }
          if (rationale) {
            branch = setBranchRationale(name, rationale);
          }
        }
        console.log(`branch "${name}": status=${branch.status}${branch.rationale ? ' rationale="' + branch.rationale + '"' : ''}`);
        return;
      }
      if (sub === 'show') {
        const name = positionals[2];
        if (!name) { console.error('usage: narova branch show <name>'); process.exit(1); }
        const branch = readBranch(name);
        if (!branch) { console.error(`branch "${name}" not found`); process.exit(1); }
        console.log(JSON.stringify(branch, null, 2));
        return;
      }
      console.error('usage: narova branch save|list|set|show [name]');
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
      const reuse = flags.force ? false : resolveReuse(config, out, flags.reuse);
      writeStageInputs(config, out);
      synth(out, { backend: flags.backend, reuse, projectDir, config });
      enrichTimeline(out);   // merge measured timings into manifest.json
      console.log(`synth complete -> ${out}/audio (incl. full.wav), ${out}/timings.json`);
      return;
    }

    case 'compose': {
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      const renderer = getRenderer(config.renderer);
      const r = composeWithRenderer(config, out);
      console.log(`composed ${r.scenes} scenes (${r.total}s) with ${renderer.name} -> ${r.dir}`);
      const caps = writeCaptions(config, out);
      console.log(`captions -> ${caps.srt} (+ captions.vtt, ${caps.cues} cues)`);
      printSceneTable(config, out);
      console.log(`  qa: narova shots --beats   ·   preview: narova preview --detach   ·   release: narova build --reuse --release`);
      if (renderer.name === 'hyperframes') refreshPreviewIfLive(out);
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
      if (!fs.existsSync(timingsPath)) {
        console.error('shots needs out/timings.json — run `narova synth` first');
        process.exit(1);
      }
      if (flags.proof) {
        // Invalidate any older successful proof before rendering. Recompile the
        // current source into the manifest that a later branch snapshot saves.
        clearProofReceipt(out);
        writeStageInputs(config, out);
        enrichTimeline(out);
      }
      const data = composeData(config, JSON.parse(fs.readFileSync(timingsPath, 'utf8')));
      // One QA frame per scene, mid-scene by default; --at t1,t2 overrides.
      const reviewModes = [flags.at, flags.motion, flags.beats].filter(Boolean).length;
      if (reviewModes > 1) {
        console.error('--at, --motion, and --beats are mutually exclusive');
        process.exit(1);
      }
      const times = flags.at
        ? String(flags.at).split(',').map(Number)
        : flags.beats
          ? beatReviewTimes(data)
        : flags.motion
          ? motionReviewTimes(data)
        : data.scenes.map(sc => Math.round((sc.start + sc.dur / 2) * 10) / 10);
      if (times.some(t => !Number.isFinite(t))) {
        console.error('--at needs comma-separated seconds, e.g. --at 0.8,6.2,14');
        process.exit(1);
      }
      const rendered = shotsWithRenderer(config, out, times);
      console.log(`frames -> ${rendered.dir}  (${times.length} @ ${times.join(', ')})`);
      if (flags.proof) {
        const report = auditProofFrames(rendered.dir);
        console.log(formatProofAudit(report));
        if (!report.ok) {
          process.exitCode = 1;
        } else {
          try {
            writeProofReceipt(config, out, proofContactSheets(rendered.dir), report.frames.map(frame => frame.file));
            console.log('proof receipt: pass — evidence is bound to the current config, manifest, timings, and frames');
          } catch (error) {
            console.error(`proof receipt: FAIL — ${error.message}`);
            process.exitCode = 1;
          }
        }
      }
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
        release: flags.release,
        renderer: flags.renderer,
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
        const variantConfigs = base.variants.map(v => ({
          id: v.id,
          config: resolveConfig(fresh(), { ...overridesFrom(flags), variant: v.id }, dir),
        }));
        // Preflight every deliverable before rendering any of them. A broken
        // variant must not leave a misleading partial "release" on disk.
        if (flags.release) {
          for (const candidate of [base, ...variantConfigs.map(v => v.config)]) {
            if (!check(candidate, { release: true, outDir: out })) {
              process.exitCode = 1;
              return;
            }
          }
        }
        if (base.variants.length === 0) {
          console.log('no variants declared in config — building the base video only');
          verifyMotionIfRequested(build(base, { ...buildOpts, out, projectDir: dir }), flags);
        } else {
          verifyMotionIfRequested(build(base, { ...buildOpts, out, projectDir: dir }), flags);
          for (const variant of variantConfigs) {
            console.log(`\nvariant "${variant.id}": only its scene-1 sentences re-synthesize — the sentence cache covers the rest`);
            verifyMotionIfRequested(build(variant.config, { ...buildOpts, out, projectDir: dir, name: `video-${variant.id}.mp4` }), flags);
          }
        }
        if (base.renderer === 'hyperframes') refreshPreviewIfLive(out);
        return;
      }
      const { config, projectDir } = await loadResolved(flags);
      const out = outDirOf(flags, projectDir);
      if (flags.release) {
        const candidates = [];
        if (flags.variant) {
          const { raw, dir } = await loadProjectConfig(flags.project || '.', flags.config);
          const baseOverrides = overridesFrom(flags);
          delete baseOverrides.variant;
          candidates.push(resolveConfig(JSON.parse(JSON.stringify(raw)), baseOverrides, dir));
        }
        candidates.push(config);
        for (const candidate of candidates) {
          if (!check(candidate, { release: true, outDir: out })) {
            process.exitCode = 1;
            return;
          }
        }
      }
      // --plan: print what this revision will rebuild before doing the work.
      // Advisory only (never changes build behavior). Makes the change scope
      // legible at build time so authors/agents can see which scenes are
      // affected without a separate `narova plan` step — directly serving
      // "fear of disturbing approved work".
      if (flags.plan) {
        const prev = lastManifest(out);
        if (prev) {
          const result = plan(prev, config, { toolVersion: require('../package.json').version });
          console.log(formatPlan(result));
          // Scene-cache preview: the same per-scene reuse decision the real
          // build will make (driven by scene-cache.plan, not just the stage
          // scope above). Read the enriched manifest on disk so timings are
          // available; if it can't be read, skip silently.
          try {
            const { read } = require('../src/manifest');
            const { plan: cachePlan, formatCacheStatus } = require('../src/scene-cache');
            const manifest = read(prev);
            const renderer = getRenderer(config.renderer);
            const cp = cachePlan({
              outDir: out, manifest,
              renderer, fps: flags.fps, quality: flags.quality,
            });
            console.log(formatCacheStatus(cp));
          } catch { /* cache preview is best-effort */ }
        } else {
          console.log('plan: no previous manifest — this is a first build');
        }
      }
      const built = build(config, {
        ...buildOpts, out, projectDir,
        name: config.variant ? `video-${config.variant}.mp4` : undefined,
      });
      verifyMotionIfRequested(built, flags);
      if (config.renderer === 'hyperframes') refreshPreviewIfLive(out);
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
      const renderer = getRenderer(config.renderer);
      if (renderer.name === 'no-browser') {
        if (flags.detach) throw new Error('no-browser preview writes a draft MP4 and does not support --detach');
        const rendered = renderWithRenderer(config, out, {
          name: 'preview-no-browser.mp4', fps: flags.fps || 15, quality: flags.quality || 'draft',
        });
        console.log(`no-browser preview -> ${rendered.mp4}`);
        return;
      }
      const webglScenes = config.scenes.filter(s => s.three || s._threeModuleContents).length;
      if (webglScenes > 12 && !flags.scene) {
        throw new Error(`${webglScenes} WebGL scenes exceed the safe full-preview context budget; use \`narova preview --scene <id>\`, \`narova shots --beats\`, or \`narova shots --motion\``);
      }
      if (flags.scene && flags.detach) {
        throw new Error('isolated --scene preview currently runs in the foreground; omit --detach');
      }
      const r = flags.scene
        ? renderer.composeScene(config, out, String(flags.scene))
        : composeWithRenderer(config, out);
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

    case 'renderers': {
      const sub = positionals[1] || 'list';
      if (sub === 'list') {
        for (const renderer of listRenderers()) {
          const mode = renderer.browserless ? 'browserless' : 'browser';
          console.log(`${renderer.name}\t${renderer.providerVersion}\tlocal · ${mode}`);
        }
        return;
      }
      if (sub === 'doctor') {
        const name = positionals[2];
        if (!name) { console.error('usage: narova renderers doctor <hyperframes|no-browser>'); process.exit(1); }
        const renderer = getRenderer(name);
        const report = renderer.doctor();
        for (const check of report.checks) {
          const mark = check.ok === null ? '·' : (check.ok ? '✓' : '✗');
          console.log(`${mark} ${check.name}: ${check.detail}`);
        }
        if (!report.ok) process.exitCode = 1;
        return;
      }
      console.error('usage: narova renderers list|doctor [name]');
      process.exit(1);
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

    case 'providers': {
      const sub = positionals[1] || 'list';
      if (sub === 'list') {
        const entries = listProviders();
        if (entries.length === 0) {
          console.log(`no external TTS providers registered (${providersDir()})`);
        } else {
          for (const provider of entries) {
            const version = provider.providerVersion ? ` ${provider.providerVersion}` : '';
            const voices = provider.capabilities.voiceListing ? 'voices' : 'no-voice-list';
            console.log(`${provider.name.padEnd(20)} ${provider.displayName}${version}  ${provider.protocol}  ${voices}`);
          }
        }
        return;
      }
      if (sub === 'add') {
        const manifest = positionals[2];
        if (!manifest) { console.error('usage: narova providers add <provider-manifest.json>'); process.exit(1); }
        const added = addProvider(manifest);
        console.log(`provider "${added.name}" registered -> ${path.join(providersDir(), `${added.name}.json`)}`);
        if (added.missingEnvironment.length) {
          console.log(`  set before synthesis: ${added.missingEnvironment.join(', ')}`);
        }
        return;
      }
      if (sub === 'remove') {
        const name = positionals[2];
        if (!name) { console.error('usage: narova providers remove <name>'); process.exit(1); }
        removeProvider(name);
        console.log(`provider "${name}" unregistered`);
        return;
      }
      if (sub === 'doctor') {
        const name = positionals[2];
        if (!name) { console.error('usage: narova providers doctor <name>'); process.exit(1); }
        const result = doctorProvider(name);
        console.log(`worker ok: ${name} ${result.hello.providerVersion} speaks ${result.hello.protocol}`);
        if (result.missingEnvironment.length) {
          console.error(`missing required environment: ${result.missingEnvironment.join(', ')}`);
          process.exitCode = 1;
        }
        return;
      }
      console.error('usage: narova providers add|list|remove|doctor [manifest-or-name]');
      process.exit(1);
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

    case 'karaoke': {
      const sub = positionals[1];
      if (sub !== 'generate') {
        console.error('usage: narova karaoke generate <audio-file> [--transcript <file>]');
        process.exit(1);
      }
      const audioFile = positionals[2];
      if (!audioFile) {
        console.error('usage: narova karaoke generate <audio-file> [--transcript <file>]');
        process.exit(1);
      }
      const audioPath = path.resolve(audioFile);
      if (!fs.existsSync(audioPath)) {
        console.error(`audio file not found: ${audioPath}`);
        process.exit(1);
      }
      try {
        generateKaraoke(audioPath, {
          projectDir: flags.project || '.',
          transcript: flags.transcript,
          engine: flags.engine,
          outDir: flags.out || path.dirname(audioPath),
          maxWords: flags['max-words'] ? Number(flags['max-words']) : undefined,
        });
      } catch (e) {
        console.error(`error: ${e.message}`);
        process.exit(1);
      }
      return;
    }

    case 'retime': {
      const configFile = positionals[1];
      const karaokeFile = positionals[2];
      if (!configFile || !karaokeFile) {
        console.error('usage: narova retime <reel.config.mjs> <captions-karaoke.json> [--apply]');
        process.exit(1);
      }
      try {
        retime(configFile, karaokeFile, {
          log: console.log,
          apply: flags.apply,
        });
      } catch (e) {
        console.error(`error: ${e.message}`);
        process.exit(1);
      }
      return;
    }

    case 'generate': {
      // Minimal early help: only when there is no prompt AND no --regenerate.
      if (!positionals[1] && !flags.regenerate) {
        console.error('usage: narova generate <prompt> --provider sora|runway [--output <path>]');
        console.error('       narova generate --regenerate <existing-clip.mp4> [new prompt] [overrides]');
        console.error('');
        console.error('Providers:');
        for (const [id, p] of Object.entries(PROVIDERS)) {
          console.error(`  ${id.padEnd(8)} ${p.description}`);
        }
        process.exit(1);
      }
      try {
        const projectDir = flags.project ? path.resolve(flags.project) : process.cwd();
        const assetsDir = path.join(projectDir, 'assets');
        if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

        // --regenerate <mp4>: re-run a previous generation from its .gen.json
        // spec sidecar, overriding any of prompt/provider/model/size/duration.
        // Lets an author say "regenerate this shot, same composition, rainy"
        // without losing the original generative intent.
        let baseSpec = null;
        if (flags.regenerate) {
          const regenPath = path.resolve(projectDir, flags.regenerate);
          if (!fs.existsSync(regenPath)) {
            console.error(`--regenerate: asset not found: ${regenPath}`);
            process.exit(1);
          }
          baseSpec = readSpec(regenPath);
          if (!baseSpec) {
            console.error(`--regenerate: no .gen.json spec sidecar found for ${regenPath} (only assets created by \`narova generate\` carry one)`);
            process.exit(1);
          }
          console.log(`regenerating from spec: ${path.basename(regenPath).replace(/\.(mp4|webm|mov)$/i, '')}.gen.json`);
        }

        const provider = flags.provider || (baseSpec && baseSpec.provider) || 'sora';
        const info = providerInfo(provider);
        if (!info) {
          console.error(`unknown provider: ${provider} (valid: ${Object.keys(PROVIDERS).join(', ')})`);
          process.exit(1);
        }
        const prompt = positionals[1] || (baseSpec && baseSpec.prompt);
        if (!prompt) {
          console.error('usage: narova generate <prompt> --provider sora|runway [--output <path>]');
          console.error('       narova generate --regenerate <existing-clip.mp4> [--provider ..] [new prompt]');
          process.exit(1);
        }
        const apiKey = process.env[info.envKey];
        if (!apiKey) {
          console.error(`${info.name} requires ${info.envKey} environment variable`);
          process.exit(1);
        }

        const params = {};
        if (flags.model) params.model = flags.model;
        if (flags.size) params.size = flags.size;
        if (flags.duration) params.duration = Number(flags.duration);
        if (baseSpec && baseSpec.params) {
          // Inherit unspecified params from the source spec so a regeneration
          // reproduces the original composition by default.
          for (const [k, v] of Object.entries(baseSpec.params)) {
            if (params[k] == null) params[k] = v;
          }
        }

        const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        const output = flags.output
          ? path.resolve(projectDir, flags.output)
          : (baseSpec
            ? path.resolve(path.dirname(flags.regenerate
                ? path.resolve(projectDir, flags.regenerate) : projectDir), baseSpec.artifact)
            : path.join(assetsDir, `gen-${provider}-${slug}.mp4`));
        await generate(provider, prompt, apiKey, output, assetsDir, { params });
        console.log(`Add to reel.config.mjs:  clip: "assets/${path.basename(output)}"`);
        if (readSpec(output)) {
          console.log(`Generative spec:        assets/${path.basename(output).replace(/\.(mp4|webm|mov)$/i, '')}.gen.json (edit/regenerate from here)`);
        }
      } catch (e) {
        console.error(`generate failed: ${e.message}`);
        process.exit(1);
      }
      return;
    }

    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch(err => { console.error('error:', err.message); process.exit(1); });
