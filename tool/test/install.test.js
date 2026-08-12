'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOL = path.resolve(__dirname, '..');
const UNINSTALLER = path.join(TOOL, 'uninstall.sh');

function entryExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...options.env },
  });
}

function packAndInstall(source, tmp, prefix) {
  const packDir = path.join(tmp, 'pack');
  const cache = path.join(tmp, 'npm-cache');
  fs.mkdirSync(packDir, { recursive: true });
  const packed = run('npm', [
    'pack', source, '--json', '--ignore-scripts', '--dry-run=false',
    '--pack-destination', packDir,
  ], { env: { npm_config_cache: cache } });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  const report = JSON.parse(packed.stdout)[0];
  const archive = path.join(packDir, report.filename);
  assert.ok(fs.existsSync(archive), `npm pack must create ${archive}`);

  const installed = run('npm', [
    'install', '--global', '--prefix', prefix, '--omit=optional',
    '--ignore-scripts', '--no-audit', '--no-fund', '--dry-run=false', archive,
  ], { env: { npm_config_cache: cache } });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  return cache;
}

test('scoped npm package uninstalls itself and preserves projects and user data', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-uninstall-test-'));
  const prefix = path.join(tmp, 'prefix');
  const home = path.join(tmp, 'home');
  const userData = path.join(home, '.narova', 'keep-me', 'state.json');
  const project = path.join(tmp, 'project', 'reel.config.mjs');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const cache = packAndInstall(TOOL, tmp, prefix);
  const cli = path.join(prefix, 'bin', 'narova');
  const setup = path.join(prefix, 'bin', 'narova-setup');
  const uninstall = path.join(prefix, 'bin', 'narova-uninstall');
  const installedPackage = path.join(prefix, 'lib', 'node_modules', '@narova', 'narova');
  for (const command of [cli, setup, uninstall]) assert.ok(entryExists(command), command);
  assert.ok(fs.existsSync(path.join(installedPackage, 'src', 'pipeline.js')));

  fs.mkdirSync(path.dirname(userData), { recursive: true });
  fs.writeFileSync(userData, '{}\n');
  fs.mkdirSync(path.dirname(project), { recursive: true });
  fs.writeFileSync(project, 'export default {};\n');

  const removed = run(uninstall, [], {
    env: {
      HOME: home,
      npm_config_cache: cache,
    },
  });
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  assert.match(removed.stdout, /Uninstalled Narova/);
  assert.equal(fs.existsSync(installedPackage), false);
  for (const command of [cli, setup, uninstall]) assert.equal(entryExists(command), false, command);
  assert.ok(fs.existsSync(userData), 'uninstall must preserve Narova user data');
  assert.ok(fs.existsSync(project), 'uninstall must preserve projects');

  const removedAgain = run('bash', [UNINSTALLER, '--prefix', prefix]);
  assert.equal(removedAgain.status, 0, removedAgain.stderr || removedAgain.stdout);
  assert.match(removedAgain.stdout, /nothing to remove/);
});
