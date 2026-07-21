'use strict';
/* CLI smoke tests: spawn the real binary, assert exit codes + output shape.
 * Only cheap commands — nothing that synthesizes or renders. */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'narova.js');
const run = (args, opts = {}) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', ...opts });

test('--version prints a semver', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('help shows on no command, help, and -h', () => {
  for (const args of [[], ['help'], ['-h']]) {
    const r = run(args);
    assert.equal(r.status, 0, args.join(' '));
    assert.match(r.stdout, /Usage: narova/);
  }
});

test('render is gone with a pointer to compose/build', () => {
  const r = run(['render']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /removed in 0\.3\.0/);
});

test('unknown command exits 1', () => {
  const r = run(['frobnicate']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command/);
});

test('init scaffolds a project that passes check; init never overwrites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  assert.equal(run(['init', proj]).status, 0);
  const c = run(['check', '--project', proj]);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /^ok: /m);
  assert.ok(!/^warn:/m.test(c.stdout), 'scaffold must check clean');
  const again = run(['init', proj]);
  assert.match(again.stdout, /skip\s+reel\.config\.mjs \(exists\)/);
});

test('check exits 1 with the full error list on an invalid config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  fs.writeFileSync(path.join(dir, 'reel.config.json'),
    JSON.stringify({ voices: {}, scenes: [{ id: 'x', body: 1, vo: [] }] }));
  const r = run(['check', '--project', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /at least one voice required/);
  assert.match(r.stderr, /body: HTML string required/);
});

test('bare --out errors instead of resolving "true"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['compose', '--project', proj, '--out']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--out needs a value/);
});
