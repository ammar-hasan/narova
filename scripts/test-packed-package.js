'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tool = path.join(root, 'tool');
const expectedVersion = require(path.join(tool, 'package.json')).version;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-packed-package-'));
const prefix = path.join(scratch, 'prefix');
const npmEnv = { npm_config_cache: path.join(scratch, 'npm-cache') };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, ...options.env },
  });
  if (result.error || result.status !== 0) {
    const detail = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return result;
}

try {
  const packed = run('npm', [
    'pack', '--json', '--ignore-scripts', '--dry-run=false', '--pack-destination', scratch,
  ], { cwd: tool, env: npmEnv });
  const report = JSON.parse(packed.stdout)[0];
  const archive = path.join(scratch, report.filename);
  if (!fs.existsSync(archive)) throw new Error(`npm pack did not create ${archive}`);

  run('npm', [
    'install', '--global', '--prefix', prefix, '--omit=optional', '--ignore-scripts',
    '--no-audit', '--no-fund', '--dry-run=false', archive,
  ], { env: npmEnv });

  const bin = name => path.join(prefix, 'bin', name);
  const version = run(bin('narova'), ['--version']).stdout.trim();
  if (version !== expectedVersion) {
    throw new Error(`packed CLI reported ${version}; expected ${expectedVersion}`);
  }
  if (!run(bin('narova'), ['--help']).stdout.includes('narova <command>')) {
    throw new Error('packed CLI help is missing its command heading');
  }
  run(bin('narova-setup'), ['--help']);
  run(bin('narova-uninstall'), ['--help']);

  const project = path.join(scratch, 'project');
  run(bin('narova'), ['init', project]);
  const checked = run(bin('narova'), ['check', '--project', project]);
  if (!/^ok: /m.test(checked.stdout)) {
    throw new Error(`packed CLI scaffold did not check cleanly:\n${checked.stdout}`);
  }

  process.stdout.write(
    `packed package smoke test ok: ${report.name}@${report.version}, ` +
    `${report.size} compressed bytes\n`,
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
