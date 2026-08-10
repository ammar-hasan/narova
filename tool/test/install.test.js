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
});

test('GitHub installer URL-encodes refs before downloading', t => {
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

  const installed = spawnSync('bash', [
    INSTALLER,
    '--ref', 'feature/setup#candidate',
    '--prefix', path.join(tmp, 'prefix'),
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
  const curlArgs = fs.readFileSync(curlLog, 'utf8');
  assert.match(curlArgs, /tar\.gz\/feature%2Fsetup%23candidate/);
  assert.doesNotMatch(curlArgs, /tar\.gz\/feature\/setup#candidate/);
});
