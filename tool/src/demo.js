'use strict';
/* `narova demo` — the activation event (NAR-SPEC-021, NAR-021-004/005).
 *
 * One command, zero decisions: readiness reconciliation with visible
 * progress, then the ORDINARY build pipeline (real piper synthesis, real
 * measured timing, real render, real encode) over a built-in demo project
 * that stays behind as the first learning material. Never a pre-rendered
 * shortcut; never a release build; never a question. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ProgressView, readinessMatrix, formatBytes, formatSeconds } = require('./readiness');
const { provisionDemoVoice, provisionMedia, mediaPinFor, mediaGuidance } = require('./acquisition');
const { HYPERFRAMES_VERSION } = require('./hf');
const { loadProjectConfig } = require('./config');
const { resolveConfig } = require('./schema');
const { build, ensureVenv } = require('./pipeline');

const DEMO_DIR_NAME = 'narova-demo';

/* The demo project — demonstration material, deliberately NOT the neutral
 * init scaffold (NAR-021-004). Voice matches the pinned acquisition
 * (en_US-ryan-medium) so first run needs exactly one voice download.
 *
 * Portability discipline (the demo must look right under BOTH renderer
 * profiles, NAR-000-006): every stack child carries an explicit height so
 * layout is identical top-packed geometry in the canvas engine (which has
 * no justify) and the CSS engine; every text centers via textAlign; the
 * only animations used are `enter` (staggered pop/rise/fade) and `drift`,
 * the two mechanisms both engines animate. Flex-distributed or
 * animate-array motion is avoided because the browser projection does not
 * emit it. */
const DEMO_CONFIG = `// Narova demo — demonstration material. This file is the demo project that
// \`narova demo\` builds; it is intentionally NOT the neutral \`narova init\`
// scaffold. Keep it if you want a working reference; delete the directory
// anytime. Make your own project with: narova init <dir>
const BG = { type: "linear", angle: 160, stops: [{ color: "#0e0e13", at: 0 }, { color: "#17171f", at: 1 }] };
export default {
  title: "Made with Narova",
  size: "16:9",
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-medium", label: "Narrator" },
  },
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58 },
  scenes: [
    {
      id: "hello",
      vo: [
        { who: "a", text: "This video was made by Narova, on this machine, from one command." },
      ],
      visual: { type: "stack", style: { direction: "column", align: "center", background: BG },
        children: [
          { type: "rect", style: { height: 116, background: "transparent" } },
          { type: "text", text: "npx narova demo",
            style: { height: 54, fontSize: 44, fontWeight: 800, color: "#f5f5f5", textAlign: "center" },
            enter: { type: "rise", duration: 0.6 } },
          { type: "rect", style: { height: 30, background: "transparent" } },
          { type: "group", style: { width: 180, height: 180 }, enter: { type: "pop", duration: 0.55 }, drift: "in",
            children: [
              { type: "circle", style: { width: 180, height: 180, fill: "transparent", borderWidth: 3, borderColor: "#2ee6d6" } },
              { type: "circle", style: { position: "absolute", x: 84, y: -6, width: 12, height: 12, fill: "#2ee6d6" } },
              { type: "circle", style: { position: "absolute", x: 156, y: 120, width: 12, height: 12, fill: "#a0a0a8" } },
              { type: "circle", style: { position: "absolute", x: 12, y: 120, width: 12, height: 12, fill: "#a0a0a8" } },
              { type: "path", d: "M38 30 L74 50 L38 70 Z", viewBox: "0 0 100 100",
                style: { position: "absolute", x: 48, y: 48, width: 84, height: 84, fill: "#f5f5f5" } },
            ] },
          { type: "rect", style: { height: 30, background: "transparent" } },
          { type: "text", text: "scene-scripted video, synthesized locally",
            style: { height: 30, fontSize: 20, color: "#a0a0a8", textAlign: "center" },
            enter: { type: "fade", at: 0.5, duration: 0.5 } },
        ] },
    },
    {
      id: "yours",
      vo: [
        { who: "a", text: "Your story goes here. Edit this file and build again." },
      ],
      visual: { type: "stack", style: { direction: "column", align: "center", background: BG },
        children: [
          { type: "rect", style: { height: 140, background: "transparent" } },
          { type: "text", text: "What would you like to make?",
            style: { height: 50, fontSize: 38, fontWeight: 800, color: "#f5f5f5", textAlign: "center" },
            enter: { type: "rise", duration: 0.6 } },
          { type: "rect", style: { height: 44, background: "transparent" } },
          { type: "stack", style: { direction: "row", width: 120, height: 24, align: "center", gap: 24 },
            children: [
              { type: "circle", style: { width: 14, height: 14, fill: "#a0a0a8" }, enter: { type: "pop", at: 0.15, duration: 0.4 } },
              { type: "circle", style: { width: 18, height: 18, fill: "#2ee6d6" }, enter: { type: "pop", at: 0.4, duration: 0.4 } },
              { type: "circle", style: { width: 14, height: 14, fill: "#a0a0a8" }, enter: { type: "pop", at: 0.65, duration: 0.4 } },
            ] },
          { type: "rect", style: { height: 44, background: "transparent" } },
          { type: "text", text: "narova-demo/reel.config.mjs — this text, this voice, this render",
            style: { height: 30, fontSize: 19, color: "#a0a0a8", textAlign: "center" },
            enter: { type: "fade", at: 0.6, duration: 0.5 } },
        ] },
    },
  ],
};
`;

function writeDemoProject(dir) {
  if (fs.existsSync(path.join(dir, 'reel.config.mjs'))) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'reel.config.mjs'), DEMO_CONFIG);
  return true;
}

/* Prewarm the pinned renderer toolchain with visible activity (the npx
 * fetch is the classic "is it hung?" gap — NAR-021-008). --prefer-offline
 * keeps a warm cache offline so reruns acquire nothing. */
function prewarmEngine(view, label) {
  return new Promise((resolve) => {
    view.itemStart(label, 1, 1);
    const child = spawn('npx', ['--yes', '--prefer-offline', `hyperframes@${HYPERFRAMES_VERSION}`, '--version'],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let errTail = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => {
      // Keep the last ~600 chars of npx/npm noise for failure attribution;
      // normal progress is covered by our own liveness line.
      errTail = (errTail + c).slice(-600);
    });
    child.on('error', (err) => { view.itemFail(label, err.message, 'ensure Node/npm are installed and reachable'); resolve(false); });
    child.on('close', (code) => {
      if (code === 0) {
        view.itemOk(label, `hyperframes@${HYPERFRAMES_VERSION} ready (${(out || '').trim().split('\n').pop() || 'pin ok'})`);
        resolve(true);
      } else {
        const why = errTail.trim().split('\n').filter(Boolean).slice(-3).join(' | ') || 'no diagnostics';
        view.itemFail(label, `npx hyperframes@${HYPERFRAMES_VERSION} exited ${code}: ${why}`,
          'check the network, then run `narova demo` again — finished items are kept');
        resolve(false);
      }
    });
  });
}

/* Full demo flow. `report` receives the completion lines so tests can
 * capture them without owning stdout. `renderer` overrides the project's
 * renderer exactly like the ordinary build flag. */
async function demo({ cwd = process.cwd(), out = process.stdout, renderer } = {}) {
  const startedAt = Date.now();
  const view = new ProgressView(out);
  const dir = path.join(cwd, DEMO_DIR_NAME);
  const created = writeDemoProject(dir);

  // --- Readiness (NAR-021-002): find-first, then plan, then provision. ---
  const matrix = readinessMatrix();
  const blockers = [];
  for (const item of matrix) {
    if (item.status === 'satisfied') { view.ok(item.label, item.detail || item.resolved); continue; }
    if (item.id === 'voice') continue; // provisioned below
    if (item.id === 'renderer') continue; // prewarmed below
    if (item.id === 'media' && item.status === 'auto-provisionable') continue; // provisioned below
    blockers.push({ item, next: item.id === 'media' ? mediaGuidance() : item.next });
  }
  if (blockers.length) {
    for (const b of blockers) view.itemFail(b.item.label, b.item.reason || 'not available on this machine', b.next);
    const err = new Error('demo prerequisites need one manual step (see above)');
    err.code = 'NAROVA_DEMO_BLOCKED';
    throw err;
  }

  // Pending acquisitions: plan first (NAR-021-008).
  const voice = matrix.find((i) => i.id === 'voice');
  const media = matrix.find((i) => i.id === 'media');
  const pending = [];
  if (media.status === 'auto-provisionable') {
    pending.push({ label: 'media tool (ffmpeg + ffprobe)', bytes: mediaPinFor().bytes });
  }
  if (voice.status !== 'satisfied') {
    pending.push({ label: voice.label, bytes: 63201294 + 4883 });
  }
  if (pending.length) view.plan(pending);

  let networkBytes = 0;
  if (media.status === 'auto-provisionable') {
    const m = await provisionMedia(view);
    networkBytes += m.acquired;
    // Scoped wiring: prepend the provisioned bin dir to THIS process's PATH.
    // Media was missing from the machine (find-first proved it), so nothing
    // is shadowed; no system path, profile, or environment is modified.
    process.env.PATH = `${path.join(m.dir, 'bin')}${path.delimiter}${process.env.PATH}`;
    view.note('media tool', `in scope for this run — ${m.dir} (no system changes)`);
  } else if (media.status === 'satisfied' && media.binDir) {
    // Satisfied by a PROVISIONED install (clean-machine warm runs — CI
    // finding F10): the install lives in user storage, not on PATH, so this
    // run must scope it in the same way. A PATH-found tool needs nothing.
    process.env.PATH = `${media.binDir}${path.delimiter}${process.env.PATH}`;
    view.note('media tool', `in scope for this run — ${media.binDir} (no system changes)`);
  }
  if (voice.status !== 'satisfied') {
    const r = await provisionDemoVoice(view);
    networkBytes += r.acquired;
  } else {
    view.ok(voice.label, voice.detail);
  }

  if (renderer === 'no-browser') {
    // The browserless profile renders in-process — no engine download is
    // needed, and saying so keeps the checklist honest (NAR-021-008).
    view.ok('renderer toolchain', 'no-browser profile — nothing to fetch');
  } else {
    const engineOk = await prewarmEngine(view, 'renderer toolchain (hyperframes)');
    if (!engineOk) { const e = new Error('renderer toolchain failed'); e.code = 'NAROVA_DEMO_BLOCKED'; throw e; }
  }

  // --- Local voice runtime: the venv self-provisions; its own output
  // (setup.sh/pip) passes through as plain visible lines (NAR-021-008). ---
  out.write('local voice runtime: preparing the Python speech environment (one-time)\n');
  ensureVenv(dir, (m) => out.write(String(m)));
  view.ok('local voice runtime', 'speech environment ready');

  // --- The ordinary build pipeline (NAR-021-004): no shortcuts. On failure,
  // attribute the stage and give one next action — never a bare stack dump. ---
  const { raw, dir: projectDir } = await loadProjectConfig(dir);
  const config = resolveConfig(JSON.parse(JSON.stringify(raw)), {}, projectDir);
  view.note('building', `${DEMO_DIR_NAME}/ through synth → compose → render → encode (normal check level)`);
  let built;
  try {
    built = build(config, { out: path.join(projectDir, 'out'), projectDir, renderer });
  } catch (err) {
    view.itemFail('demo build', String(err.message || err),
      'run `narova doctor`; the demo project is ordinary — fix the named issue and run `narova demo` again');
    const e = new Error('demo build failed at a pipeline stage (see above)');
    e.code = 'NAROVA_DEMO_BLOCKED';
    throw e;
  }

  // --- Honest completion report (NAR-021-005). ---
  const elapsed = Date.now() - startedAt;
  const lines = [
    '',
    `✓ ${built.mp4}  (${built.seconds.toFixed(1)}s video)`,
    `  captions: ${path.join(projectDir, 'out', 'captions.srt')} + captions.vtt`,
    `  project:  ${projectDir}${created ? ' (created — open reel.config.mjs and make it yours)' : ''}`,
    '',
    `time to first video: ${formatSeconds(elapsed)} (measured)`,
    `network acquired: ${networkBytes ? formatBytes(networkBytes) : '0 B'} (measured${networkBytes ? '' : ' for provisioned items'};`,
    '  renderer toolchain via npx and pip packages are managed by their own tools and not byte-counted)',
  ];
  for (const line of lines) out.write(`${line}\n`);
  return { mp4: built.mp4, seconds: built.seconds, elapsed, networkBytes, projectDir };
}

module.exports = { demo, writeDemoProject, DEMO_DIR_NAME };
