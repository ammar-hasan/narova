'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'narova');
const TOOL_DIR = path.join(ROOT, 'tool');

function filesBelow(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(full));
    else found.push(path.relative(dir, full));
  }
  return found;
}

test('Narova skill is instructions-only and bootstraps the standalone CLI', t => {
  const topLevel = fs.readdirSync(SKILL_DIR).sort();
  assert.deepEqual(topLevel, ['SKILL.md', 'references']);

  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(skill, /command -v narova/);
  assert.match(skill, /raw\.githubusercontent\.com\/ammar-hasan\/narova\/main\/tool\/install\.sh/);
  assert.match(skill, /narova <command>/);
  assert.doesNotMatch(skill, /<this-skill-dir>\/tool|<skill-dir>\/tool|skills\/narova\/tool/);

  for (const file of filesBelow(path.join(SKILL_DIR, 'references'))) {
    const source = fs.readFileSync(path.join(SKILL_DIR, 'references', file), 'utf8');
    assert.doesNotMatch(source, /<skill-dir>\/tool|<narova-skill-dir>\/tool|skills\/narova\/tool/, file);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-skill-integration-'));
  const prefix = path.join(tmp, 'prefix');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const installed = spawnSync('bash', [
    path.join(TOOL_DIR, 'install.sh'),
    '--source', TOOL_DIR,
    '--prefix', prefix,
    '--skip-optional',
  ], {
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: path.join(tmp, 'npm-cache') },
  });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);

  const result = spawnSync('narova', ['--version'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${path.join(prefix, 'bin')}${path.delimiter}${process.env.PATH || ''}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), require(path.join(TOOL_DIR, 'package.json')).version);
});

test('repository eval runners resolve the top-level tool layout', () => {
  for (const name of ['complex-animated-proof.js', 'no-browser-complex-eval.js']) {
    const source = fs.readFileSync(path.join(TOOL_DIR, 'evals', name), 'utf8');
    assert.match(source, /path\.resolve\(__dirname, '\.\.\/\.\.'\)/, name);
    assert.doesNotMatch(source, /skills['"], ['"]narova['"], ['"]tool/, name);
  }

  const live = fs.readFileSync(path.join(TOOL_DIR, 'evals', 'live-creativity-ab.js'), 'utf8');
  assert.match(live, /path\.join\(root, 'tool', 'bin', 'narova\.js'\)/);
  assert.doesNotMatch(live, /skills['"], ['"]narova['"], ['"]tool/);
});
