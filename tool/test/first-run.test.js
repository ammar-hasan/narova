'use strict';
/* NAR-SPEC-021 first-run and demo surface tests (NAR-021-001, 002, 004,
 * 005, 006, 007). CLI-level: spawned against the real bin with isolated
 * NAROVA_HOME. The full networked demo path is exercised by the sandbox
 * evidence run, not here. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOL = path.resolve(__dirname, '..');
const BIN = path.join(TOOL, 'bin', 'narova.js');

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-firstrun-'));
  return { dir, env: { ...process.env, NAROVA_HOME: dir, NAROVA_FIRST_RUN: '1' } };
}

const run = (args, env) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', env });

test('bare invocation prints the quiet checklist then help, and is idempotent', () => {
  const { dir, env } = tmpHome();
  const first = run([], env);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /Narova first run — checking this machine/);
  assert.match(first.stdout, /substrate|Node/);
  assert.match(first.stdout, /narova demo/);
  assert.match(first.stdout, /Usage: narova/);
  assert.ok(fs.existsSync(path.join(dir, 'first-run-complete')), 'marker written');

  const second = run([], { ...env, NAROVA_FIRST_RUN: '1' });
  assert.doesNotMatch(second.stdout, /Narova first run — checking/);
  assert.match(second.stdout, /Usage: narova/);
});

test('bare invocation stays plain help without NAROVA_FIRST_RUN (deterministic scripts/tests)', () => {
  const { dir, env } = tmpHome();
  delete env.NAROVA_FIRST_RUN;
  const r = run([], { ...env });
  assert.doesNotMatch(r.stdout, /Narova first run — checking/);
  assert.match(r.stdout, /Usage: narova/);
  assert.ok(!fs.existsSync(path.join(dir, 'first-run-complete')));
});

test('demo --help documents the one-command activation', () => {
  const r = run(['demo', '--help'], { ...process.env });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /narova demo/);
  assert.match(r.stdout, /video\.mp4/);
});

test('demo project scaffold is created once and never overwritten (NAR-021-004/007)', () => {
  const demoMod = require('../src/demo');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-demoproj-'));
  const dir = path.join(root, 'narova-demo');
  const first = demoMod.writeDemoProject(dir);
  const file = path.join(dir, 'reel.config.mjs');
  assert.equal(first, true);
  assert.ok(fs.existsSync(file));
  const before = fs.readFileSync(file, 'utf8');
  const second = demoMod.writeDemoProject(dir);
  assert.equal(second, false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  // Distinct from the neutral init scaffold and labeled as demo material.
  assert.match(before, /demonstration material/);
  assert.match(before, /en_US-ryan-medium/); // matches the pinned acquisition
});

test('wizard records intent as draft-brief material only (NAR-021-006)', async () => {
  const { welcomeWizard } = require('../src/first-run');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-wizard-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-wizhome-'));
  process.env.NAROVA_HOME = home;
  delete require.cache[require.resolve('../src/first-run')];
  const fresh = require('../src/first-run');

  // Non-interactive: no question asked, skill command shown, marker set.
  const sink = { lines: [], write(s) { this.lines.push(s); }, isTTY: false };
  process.stdin.isTTY = undefined;
  await fresh.welcomeWizard({ cwd, out: sink });
  const text = sink.lines.join('');
  assert.match(text, /What would you like to make|Start anytime/);
  assert.match(text, /npx skills add ammar-hasan\/narova --skill narova -g/);
  assert.doesNotMatch(text, /Install the agent skill now\?/); // no consent prompt when non-interactive
  assert.ok(fs.existsSync(path.join(home, 'first-run-complete')));
  // No project was implicitly created or built.
  assert.ok(!fs.existsSync(path.join(cwd, 'my-first-video')));
  delete process.env.NAROVA_HOME;
});

test('uninstall help documents provisioned-tool purge (NAR-021-007)', () => {
  const r = spawnSync('bash', [path.join(TOOL, 'uninstall.sh'), '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--purge-tools/);
  assert.match(r.stdout, /samples are always kept/);
});
