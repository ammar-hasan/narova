'use strict';
/* First-run surface (NAR-SPEC-021, NAR-021-001/002/006/007).
 *
 * Bare `narova` on a fresh machine: substrate guard → welcome → readiness
 * checklist that fixes what it can → one creation-intent question (TTY
 * only) recorded as draft-brief material in a scaffolded ordinary project
 * → exact next commands. Agent-skill installation is reported always and
 * mutated only on explicit consent. Non-interactive contexts get the
 * checklist and the commands, never a question. Re-runs are idempotent. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('node:readline/promises');
const { ProgressView, readinessMatrix, MIN_NODE_MAJOR } = require('./readiness');
const { mediaGuidance } = require('./acquisition');
const { initProject } = require('./init');

const NAROVA_HOME = process.env.NAROVA_HOME || path.join(os.homedir(), '.narova');
const MARKER = path.join(NAROVA_HOME, 'first-run-complete');

/* NAR-021-001: the substrate is checked, never installed. Below minimum:
 * fail before any other work with the minimum named. */
function substrateGuard() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE_MAJOR) {
    console.error(`Narova needs Node ${MIN_NODE_MAJOR} or newer; this is Node ${process.versions.node}.`);
    console.error(`Get Node ${MIN_NODE_MAJOR}+ from https://nodejs.org, then run this again.`);
    process.exit(1);
  }
}

function firstRunDone() { return fs.existsSync(MARKER); }
function markFirstRunDone() {
  fs.mkdirSync(NAROVA_HOME, { recursive: true });
  fs.writeFileSync(MARKER, new Date().toISOString());
}

function isInteractive() {
  return Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY) && !process.env.CI;
}

/* The five-line activation checklist (NAR-021-002) without side effects. */
function printChecklist(view) {
  const matrix = readinessMatrix();
  for (const item of matrix) {
    if (item.status === 'satisfied') view.ok(item.label, item.detail || item.resolved);
    else if (item.id === 'media') {
      view.note(item.label, item.status === 'auto-provisionable'
        ? 'downloaded automatically by `narova demo` (digest-verified)'
        : `needed — ${mediaGuidance()}`);
    }
    else if (item.id === 'renderer') view.note(item.label, 'fetched automatically on first build');
    else if (item.id === 'voice') view.note(item.label, 'downloaded automatically by `narova demo`');
    else view.note(item.label, item.reason || 'needs one manual step');
  }
  return matrix;
}

const SKILL_CMD = 'npx skills add ammar-hasan/narova --skill narova -g';

/* Interactive wizard. Resolves true when first run completed (or was
 * already complete). Never throws for a declined question. */
async function welcomeWizard({ cwd = process.cwd(), out = process.stdout } = {}) {
  if (firstRunDone()) return true;
  const view = new ProgressView(out);

  out.write('\nWelcome to Narova — scene-scripted video, made locally.\n\n');
  out.write('Checking this machine:\n');
  printChecklist(view);
  out.write('\nFirst video in one command:\n\n  narova demo\n\n');

  let intent = null;
  if (isInteractive()) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      intent = (await rl.question('What would you like to make? (one line, or Enter to skip) ')).trim();
    } finally { rl.close(); }
  }

  // NAR-021-006: the answer becomes draft-brief material only — an ordinary
  // scaffolded project, no implicit synthesis or build.
  if (intent) {
    const dir = path.join(cwd, 'my-first-video');
    if (!fs.existsSync(path.join(dir, 'reel.config.mjs'))) initProject(dir);
    const brief = path.join(dir, 'creative-brief.md');
    const section = `\n## First-run intent\n\n${intent}\n`;
    if (fs.existsSync(brief)) fs.appendFileSync(brief, section);
    else fs.writeFileSync(brief, `# Creative brief\n${section}`);
    out.write(`\nNoted in ${brief} — nothing has been built yet. Continue with:\n`);
    out.write(`  cd ${path.relative(cwd, dir) || '.'} && narova check\n`);
    out.write('  narova demo   # see the full pipeline on a built-in project first\n');
  } else {
    out.write('\nStart anytime:\n  narova demo       # one command to a finished MP4\n');
    out.write('  narova init <dir> # empty neutral project\n');
  }

  // Agent-skill integration: status always; mutation only on consent.
  out.write(`\nAgent integration (optional): ${SKILL_CMD}\n`);
  if (isInteractive()) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let install = false;
    try {
      install = /^y(es)?$/i.test(await rl.question('Install the agent skill now? [y/N] '));
    } finally { rl.close(); }
    if (install) {
      out.write('Installing the skill (this runs npx and changes your global skill directory)…\n');
      const { spawnSync } = require('child_process');
      const r = spawnSync('npx', ['skills', 'add', 'ammar-hasan/narova', '--skill', 'narova', '-g'],
        { stdio: 'inherit' });
      out.write(r.status === 0 ? 'Skill installed.\n' : 'Skill install failed — you can retry later with the command above.\n');
    } else {
      out.write('Skipped — first run is complete without it.\n');
    }
  }

  markFirstRunDone();
  out.write('\nReady. `narova demo` makes the first video.\n');
  return true;
}

/* Non-interactive first-run surface: checklist + commands, no questions,
 * marks completion so subsequent runs are quiet (NAR-021-007). */
function firstRunQuiet({ out = process.stdout } = {}) {
  if (firstRunDone()) return false;
  const view = new ProgressView(out);
  out.write('Narova first run — checking this machine:\n');
  printChecklist(view);
  out.write('\n  narova demo   # first video in one command\n');
  markFirstRunDone();
  return true;
}

module.exports = {
  substrateGuard, welcomeWizard, firstRunQuiet, firstRunDone, markFirstRunDone,
  MARKER, SKILL_CMD, printChecklist, isInteractive,
};
