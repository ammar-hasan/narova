'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOL = path.resolve(__dirname, '..');
const INSTALLER = path.join(TOOL, 'install.sh');
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

test('standalone installer packages only the CLI and exposes lifecycle commands', t => {
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
  const uninstall = path.join(prefix, 'bin', 'narova-uninstall');
  assert.ok(fs.existsSync(cli), 'narova executable must be installed');
  assert.ok(fs.existsSync(setup), 'narova-setup executable must be installed');
  assert.ok(fs.existsSync(uninstall), 'narova-uninstall executable must be installed');

  const version = spawnSync(cli, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), require('../package.json').version);

  const setupHelp = spawnSync(setup, ['--help'], { encoding: 'utf8' });
  assert.equal(setupHelp.status, 0, setupHelp.stderr);
  assert.match(setupHelp.stdout, /usage: narova-setup/);

  const uninstallHelp = spawnSync(uninstall, ['--help'], { encoding: 'utf8' });
  assert.equal(uninstallHelp.status, 0, uninstallHelp.stderr);
  assert.match(uninstallHelp.stdout, /usage: narova-uninstall/);

  const fakeBin = path.join(tmp, 'fake-bin');
  const fakeVenv = path.join(tmp, 'venv');
  fs.mkdirSync(fakeBin);
  fs.mkdirSync(path.join(fakeVenv, 'bin'), { recursive: true });
  const fakePython = path.join(fakeBin, 'python');
  fs.writeFileSync(fakePython, `#!/bin/sh
if [ "$1" = "-c" ]; then echo 3.12; exit 0; fi
if [ "$1" = "-m" ] && [ "$2" = "pip" ] && [ "$3" = "--version" ]; then
  echo "pip 25.0 from test"
  exit 0
fi
previous=
for argument in "$@"; do
  if [ "$previous" = "-r" ] && [ ! -f "$argument" ]; then
    echo "missing packaged requirements: $argument" >&2
    exit 42
  fi
  previous="$argument"
done
exit 0
`);
  fs.chmodSync(fakePython, 0o755);
  for (const command of ['ffmpeg', 'ffprobe', 'npx']) {
    const executable = path.join(fakeBin, command);
    fs.writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(executable, 0o755);
  }
  fs.writeFileSync(path.join(fakeVenv, 'bin', 'activate'), `export PATH="${fakeBin}:$PATH"\n`);

  const setupCheck = spawnSync(setup, [], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
      NAROVA_SETUP_PYTHON: fakePython,
      NAROVA_VENV: fakeVenv,
    },
  });
  assert.equal(setupCheck.status, 0, setupCheck.stderr || setupCheck.stdout);
  assert.match(setupCheck.stdout, /piper deps installed/);

  const installedPackage = path.join(prefix, 'lib', 'node_modules', 'narova');
  assert.ok(fs.existsSync(path.join(installedPackage, 'src', 'pipeline.js')));
  assert.equal(fs.existsSync(path.join(installedPackage, 'test')), false);
  assert.equal(fs.existsSync(path.join(installedPackage, 'evals')), false);
  assert.equal(fs.existsSync(path.join(installedPackage, 'skills')), false);

  const home = path.join(tmp, 'home');
  const userData = path.join(home, '.narova', 'keep-me');
  const ambientPackage = path.join(tmp, 'ambient-prefix', 'lib', 'node_modules', 'narova');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'state.json'), '{}\n');
  fs.mkdirSync(ambientPackage, { recursive: true });
  fs.writeFileSync(path.join(ambientPackage, 'keep-me'), '{}\n');
  const removed = spawnSync(uninstall, [], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      NAROVA_PREFIX: path.join(tmp, 'ambient-prefix'),
      npm_config_cache: cache,
    },
  });
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  assert.match(removed.stdout, /Uninstalled Narova/);
  assert.equal(fs.existsSync(installedPackage), false);
  assert.equal(entryExists(cli), false);
  assert.equal(entryExists(setup), false);
  assert.equal(entryExists(uninstall), false);
  assert.ok(fs.existsSync(path.join(userData, 'state.json')), 'uninstall must preserve user data');
  assert.ok(fs.existsSync(path.join(ambientPackage, 'keep-me')), 'ambient prefix state must not redirect self-uninstall');

  const removedAgain = spawnSync('bash', [UNINSTALLER, '--prefix', prefix], { encoding: 'utf8' });
  assert.equal(removedAgain.status, 0, removedAgain.stderr || removedAgain.stdout);
  assert.match(removedAgain.stdout, /nothing to remove/);
});

test('re-running the installer upgrades the CLI in place and preserves user data', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-upgrade-test-'));
  const prefix = path.join(tmp, 'prefix');
  const cache = path.join(tmp, 'npm-cache');
  const home = path.join(tmp, 'home');
  const oldTool = path.join(tmp, 'old-tool');
  const marker = path.join(home, '.narova', 'keep-me', 'state.json');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  fs.cpSync(TOOL, oldTool, {
    recursive: true,
    filter: source => !['node_modules', 'out', 'uninstall.sh'].includes(path.basename(source)),
  });
  const oldPackageFile = path.join(oldTool, 'package.json');
  const oldPackage = JSON.parse(fs.readFileSync(oldPackageFile, 'utf8'));
  oldPackage.version = '0.0.1';
  delete oldPackage.bin['narova-uninstall'];
  oldPackage.files = oldPackage.files.filter(file => file !== 'uninstall.sh');
  oldPackage.files.push('legacy-only.txt');
  fs.writeFileSync(oldPackageFile, `${JSON.stringify(oldPackage, null, 2)}\n`);
  fs.writeFileSync(path.join(oldTool, 'legacy-only.txt'), 'legacy package artifact\n');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, '{}\n');

  const env = { ...process.env, HOME: home, npm_config_cache: cache };
  const installFrom = source => spawnSync('bash', [
    INSTALLER,
    '--source', source,
    '--prefix', prefix,
    '--skip-optional',
  ], { encoding: 'utf8', env });
  const cli = path.join(prefix, 'bin', 'narova');
  const uninstall = path.join(prefix, 'bin', 'narova-uninstall');
  const legacyArtifact = path.join(prefix, 'lib', 'node_modules', 'narova', 'legacy-only.txt');

  const installedOld = installFrom(oldTool);
  assert.equal(installedOld.status, 0, installedOld.stderr || installedOld.stdout);
  const oldVersion = spawnSync(cli, ['--version'], { encoding: 'utf8' });
  assert.equal(oldVersion.status, 0, oldVersion.stderr);
  assert.equal(oldVersion.stdout.trim(), '0.0.1');
  assert.equal(entryExists(uninstall), false, 'old fixture must predate narova-uninstall');
  assert.ok(fs.existsSync(legacyArtifact), 'old fixture must include a legacy-only package file');

  const upgraded = installFrom(TOOL);
  assert.equal(upgraded.status, 0, upgraded.stderr || upgraded.stdout);
  const newVersion = spawnSync(cli, ['--version'], { encoding: 'utf8' });
  assert.equal(newVersion.status, 0, newVersion.stderr);
  assert.equal(newVersion.stdout.trim(), require('../package.json').version);
  assert.ok(entryExists(uninstall), 'upgrade must add narova-uninstall');
  assert.equal(fs.existsSync(legacyArtifact), false, 'upgrade must remove stale package files');
  assert.ok(fs.existsSync(marker), 'upgrade must preserve user data');
});

test('GitHub installer URL-encodes refs without treating them as Node options', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-remote-install-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const archiveRoot = path.join(tmp, 'archive-root');
  const archiveRepo = path.join(archiveRoot, 'narova-fixture');
  const archive = path.join(tmp, 'source.tar.gz');
  const fakeBin = path.join(tmp, 'fake-bin');
  const curlLog = path.join(tmp, 'curl-args.txt');
  fs.mkdirSync(archiveRepo, { recursive: true });
  fs.cpSync(TOOL, path.join(archiveRepo, 'tool'), {
    recursive: true,
    filter: source => !['node_modules', 'out'].includes(path.basename(source)),
  });
  const packed = spawnSync('tar', ['-czf', archive, '-C', archiveRoot, 'narova-fixture'], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);

  fs.mkdirSync(fakeBin);
  const fakeCurl = path.join(fakeBin, 'curl');
  fs.writeFileSync(fakeCurl, `#!/bin/sh
printf '%s\\n' "$@" > "$NAROVA_TEST_CURL_LOG"
output=
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; output="$1"; fi
  shift
done
cp "$NAROVA_TEST_ARCHIVE" "$output"
`);
  fs.chmodSync(fakeCurl, 0o755);

  const installRef = (ref, name) => {
    const installed = spawnSync('bash', [
      INSTALLER,
      '--ref', ref,
      '--prefix', path.join(tmp, `prefix-${name}`),
      '--skip-optional',
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
        npm_config_cache: path.join(tmp, 'npm-cache'),
        NAROVA_TEST_ARCHIVE: archive,
        NAROVA_TEST_CURL_LOG: curlLog,
      },
    });
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    return fs.readFileSync(curlLog, 'utf8');
  };

  const complexRefArgs = installRef('feature/setup#candidate', 'complex');
  assert.match(complexRefArgs, /tar\.gz\/feature%2Fsetup%23candidate/);
  assert.doesNotMatch(complexRefArgs, /tar\.gz\/feature\/setup#candidate/);

  const leadingDashArgs = installRef('-candidate', 'leading-dash');
  assert.match(leadingDashArgs, /tar\.gz\/-candidate/);
});
