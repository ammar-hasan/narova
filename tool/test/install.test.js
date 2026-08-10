'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOL = path.resolve(__dirname, '..');
const INSTALLER = path.join(TOOL, 'install.sh');

test('standalone installer packages only the CLI and exposes both commands', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-install-test-'));
  const prefix = path.join(tmp, 'prefix');
  const cache = path.join(tmp, 'npm-cache');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const installed = spawnSync('bash', [
    INSTALLER,
    '--source', TOOL,
    '--prefix', prefix,
    '--skip-optional',
  ], {
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache },
  });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  assert.match(installed.stdout, /Installed Narova \d+\.\d+\.\d+/);

  const cli = path.join(prefix, 'bin', 'narova');
  const setup = path.join(prefix, 'bin', 'narova-setup');
  assert.ok(fs.existsSync(cli), 'narova executable must be installed');
  assert.ok(fs.existsSync(setup), 'narova-setup executable must be installed');

  const version = spawnSync(cli, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), require('../package.json').version);

  const setupHelp = spawnSync(setup, ['--help'], { encoding: 'utf8' });
  assert.equal(setupHelp.status, 0, setupHelp.stderr);
  assert.match(setupHelp.stdout, /usage: narova-setup/);

  const installedPackage = path.join(prefix, 'lib', 'node_modules', 'narova');
  assert.ok(fs.existsSync(path.join(installedPackage, 'src', 'pipeline.js')));
  assert.equal(fs.existsSync(path.join(installedPackage, 'test')), false);
  assert.equal(fs.existsSync(path.join(installedPackage, 'evals')), false);
  assert.equal(fs.existsSync(path.join(installedPackage, 'skills')), false);
});
