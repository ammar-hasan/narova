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
 * Scenes use the portable visual vocabulary so the demo renders under the
 * browser profile AND the browserless profile (NAR-000-006). */
const DEMO_CONFIG = `// Narova demo — demonstration material. This file is the demo project that
// \`narova demo\` builds; it is intentionally NOT the neutral \`narova init\`
// scaffold. Keep it if you want a working reference; delete the directory
// anytime. Make your own project with: narova init <dir>
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
      visual: { type: "stack", style: { direction: "column", align: "center", justify: "center", gap: 22, background: "#101014" },
        children: [
          { type: "text", text: "npx narova demo", style: { color: "#f5f5f5", fontSize: 64, weight: 800 }, enter: "rise" },
          { type: "text", text: "scene-scripted video, synthesized locally", style: { color: "#a0a0a8", fontSize: 22 }, enter: "fade" },
        ] },
    },
    {
      id: "yours",
      vo: [
        { who: "a", text: "Your story goes here. Edit this file and build again." },
      ],
      visual: { type: "stack", style: { direction: "column", align: "center", justify: "center", gap: 22, background: "#101014" },
        children: [
          { type: "text", text: "What would you like to make?", style: { color: "#f5f5f5", fontSize: 56, weight: 800 }, enter: "rise" },
          { type: "text", text: "narova-demo/reel.config.mjs — this text, this voice, this render", style: { color: "#a0a0a8", fontSize: 20 }, enter: "fade" },
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
