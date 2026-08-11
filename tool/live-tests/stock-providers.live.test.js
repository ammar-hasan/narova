'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '../bin/narova.js');
const providers = [
  {
    id: 'wikimedia', kind: 'video', query: 'bumblebee lilac',
    acquireId: 'File:Bumblebee on Lilac.webm', output: 'wikimedia.webm',
  },
  {
    id: 'openverse', kind: 'image', query: 'mountain landscape',
    acquireId: '8c85412a-6d6d-4d42-b0d9-2d04867ab31b', output: 'openverse.jpg',
  },
  { id: 'nasa', kind: 'image', query: 'earth', acquireId: 'PIA00342', output: 'nasa.jpg' },
  {
    id: 'internet-archive', kind: 'audio', query: 'bird sound effect',
    acquireId: 'GOLD_TAPE_21_Birds', output: 'archive.mp3',
  },
  { id: 'iconify', kind: 'image', query: 'home', acquireId: 'mdi:home', output: 'iconify.svg' },
  {
    id: 'poly-haven', kind: 'model', query: 'wooden crate',
    acquireId: 'wooden_crate_01', output: 'poly-haven.fbx',
  },
  { id: 'met', kind: 'image', query: 'our lady', acquireId: '764091', output: 'met.jpg' },
  { id: 'cleveland-museum', kind: 'image', query: 'landscape', acquireId: '147016', output: 'cleveland.jpg' },
  { id: 'loc', kind: 'image', query: 'landscape', acquireId: '2004662055', output: 'loc.jpg' },
  { id: 'pexels', kind: 'video', query: 'calm ocean', output: 'pexels.mp4', envKey: 'PEXELS_API_KEY' },
  { id: 'pixabay', kind: 'video', query: 'calm ocean', output: 'pixabay.mp4', envKey: 'PIXABAY_API_KEY' },
  { id: 'freesound', kind: 'audio', query: 'soft gong', output: 'freesound.mp3', envKey: 'FREESOUND_API_KEY' },
];

function cli(args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd,
    env: process.env,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const command = `narova ${args.join(' ')}`;
  assert.equal(result.error, undefined, `${command}: ${result.error && result.error.message}`);
  assert.equal(result.status, 0, `${command}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

test('live core stock: every available adapter searches, downloads, and verifies', { timeout: 20 * 60_000 }, t => {
  const missing = providers.filter(item => item.envKey && !process.env[item.envKey]);
  if (missing.length) t.diagnostic(`optional credentialed providers skipped: ${missing.map(item => item.envKey).join(', ')}`);
  const available = providers.filter(item => !item.envKey || process.env[item.envKey]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-stock-core-'));
  const project = path.join(root, 'project');
  cli(['init', project]);

  for (const provider of available) {
    const raw = cli([
      'assets', 'search', provider.query, '--provider', provider.id, '--kind', provider.kind,
      '--limit', '1', '--json',
    ]);
    const results = JSON.parse(raw);
    assert.ok(results.length > 0, `${provider.id} returned no live search results`);
    assert.equal(results[0].provider, provider.id);
    assert.equal(results[0].kind, provider.kind);

    const id = provider.acquireId || results[0].id;
    cli([
      'assets', 'acquire', String(id), '--provider', provider.id, '--kind', provider.kind,
      '--output', `assets/${provider.output}`, '--project', project,
    ]);
    assert.ok(fs.statSync(path.join(project, 'assets', provider.output)).size > 0);
  }

  const verified = cli(['assets', 'verify', '--project', project]);
  assert.equal((verified.match(/^ok:/gm) || []).length, available.length, verified);
});
