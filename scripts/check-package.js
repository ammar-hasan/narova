'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tool = path.join(root, 'tool');
const cache = path.join(require('node:os').tmpdir(), 'narova-npm-pack-cache');
const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--cache', cache], {
  cwd: tool,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});
if (packed.status !== 0) {
  process.stderr.write(packed.stderr || packed.stdout);
  process.exit(packed.status || 1);
}
const report = JSON.parse(packed.stdout)[0];
const names = (report.files || []).map(file => file.path);
const forbidden = names.filter(name =>
  /(^|\/)(node_modules|out|__pycache__)(\/|$)/.test(name)
  || /(^|\/)test(s)?\//.test(name)
  || /(^|\/)skills?\//.test(name)
  || /(^|\/)SKILL\.md$/.test(name)
  || /\.pyc$/.test(name));
if (forbidden.length) {
  throw new Error(`npm package contains development/generated files:\n${forbidden.slice(0, 50).join('\n')}`);
}
if (report.unpackedSize > 10 * 1024 * 1024) {
  throw new Error(`npm package is unexpectedly large: ${report.unpackedSize} unpacked bytes`);
}
for (const required of ['LICENSE', 'bin/narova.js', 'install.sh', 'setup.sh', 'uninstall.sh', 'src/pipeline.js', 'py/narova_tts/pipeline.py']) {
  if (!names.includes(required)) throw new Error(`npm package is missing required standalone tool file: ${required}`);
}
if (report.name !== 'narova') throw new Error(`unexpected standalone package name: ${report.name}`);
process.stdout.write(`package audit ok: ${report.entryCount} files, ${report.size} compressed bytes, ${report.unpackedSize} unpacked bytes\n`);
