'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

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
for (const required of ['LICENSE', 'README.md', 'AGENT_PROTOCOL.md', 'bin/narova.js', 'setup.sh', 'uninstall.sh', 'src/pipeline.js', 'py/narova_tts/pipeline.py']) {
  if (!names.includes(required)) throw new Error(`npm package is missing required standalone tool file: ${required}`);
}
const rootProtocol = fs.readFileSync(path.join(root, 'AGENT_PROTOCOL.md'), 'utf8');
const packagedProtocol = fs.readFileSync(path.join(tool, 'AGENT_PROTOCOL.md'), 'utf8');
if (packagedProtocol !== rootProtocol) {
  throw new Error('tool/AGENT_PROTOCOL.md must stay byte-identical to the repository protocol guide');
}
if (names.includes('install.sh')) throw new Error('npm package must not reintroduce a remote shell installer');
if (report.name !== '@narova/narova') throw new Error(`unexpected standalone package name: ${report.name}`);

const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const toolPackage = JSON.parse(fs.readFileSync(path.join(tool, 'package.json'), 'utf8'));
if (toolPackage.version !== rootPackage.version) {
  throw new Error(`package version ${toolPackage.version} does not match repository version ${rootPackage.version}`);
}
if (toolPackage.repository?.url !== 'git+https://github.com/ammar-hasan/narova.git'
    || toolPackage.repository?.directory !== 'tool') {
  throw new Error('npm repository metadata must identify ammar-hasan/narova and the tool/ package directory');
}
const expectedDescription = 'Local-first prompt-to-video CLI for AI agents, with deterministic scene scripts, TTS, word-synced captions, product walkthroughs, and 2D/3D rendering.';
if (toolPackage.description !== expectedDescription) {
  throw new Error('npm description must preserve Narova\'s clear prompt-to-video positioning');
}
const expectedKeywords = [
  'video',
  'video-generation',
  'prompt-to-video',
  'text-to-video',
  'programmatic-video',
  'video-cli',
  'agent-skills',
  'motion-graphics',
  'text-to-speech',
  'tts',
  'captions',
  'subtitles',
  'ffmpeg',
  'threejs',
  'local-first',
];
const keywords = toolPackage.keywords || [];
if (keywords.length !== expectedKeywords.length
    || keywords.some((keyword, index) => keyword !== expectedKeywords[index])) {
  throw new Error(`npm keywords must equal the focused approved list: ${expectedKeywords.join(', ')}`);
}
if (toolPackage.publishConfig?.access !== 'public'
    || toolPackage.publishConfig?.registry !== 'https://registry.npmjs.org/'
    || toolPackage.publishConfig?.provenance !== true) {
  throw new Error('npm publishConfig must require the public npm registry with provenance');
}
for (const lifecycle of ['preinstall', 'install', 'postinstall']) {
  if (toolPackage.scripts?.[lifecycle]) {
    throw new Error(`npm package must not execute a ${lifecycle} lifecycle script`);
  }
}
process.stdout.write(`package audit ok: ${report.entryCount} files, ${report.size} compressed bytes, ${report.unpackedSize} unpacked bytes\n`);
