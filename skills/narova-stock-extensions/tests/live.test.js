'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CORE = path.resolve(__dirname, '../../../tool/bin/narova.js');
const STOCK = path.resolve(__dirname, '../tool/narova-stock.js');
const specs = [
  { id: 'wikimedia', kind: 'video', query: 'bumblebee lilac', acquireId: 'File:Bumblebee on Lilac.webm', output: 'wikimedia.webm' },
  { id: 'openverse', kind: 'image', query: 'mountain landscape', acquireId: '8c85412a-6d6d-4d42-b0d9-2d04867ab31b', output: 'openverse.jpg' },
  { id: 'nasa', kind: 'image', query: 'earth', acquireId: 'PIA00342', output: 'nasa.jpg' },
  { id: 'internet-archive', kind: 'audio', query: 'bird sound effect', acquireId: 'GOLD_TAPE_21_Birds', output: 'archive.mp3' },
  { id: 'iconify', kind: 'image', query: 'home', acquireId: 'mdi:home', output: 'iconify.svg' },
  { id: 'poly-haven', kind: 'model', query: 'wooden crate', acquireId: 'wooden_crate_01', output: 'poly-haven.fbx' },
  { id: 'met', kind: 'image', query: 'our lady', acquireId: '764091', output: 'met.jpg' },
  { id: 'cleveland-museum', kind: 'image', query: 'landscape', acquireId: '147016', output: 'cleveland.jpg' },
  { id: 'loc', kind: 'image', query: 'landscape', acquireId: '2004662055', output: 'loc.jpg' },
  { id: 'pexels', kind: 'video', query: 'calm ocean', output: 'pexels.mp4', envKey: 'PEXELS_API_KEY' },
  { id: 'pixabay', kind: 'video', query: 'calm ocean', output: 'pixabay.mp4', envKey: 'PIXABAY_API_KEY' },
  { id: 'freesound', kind: 'audio', query: 'soft gong', output: 'freesound.mp3', envKey: 'FREESOUND_API_KEY' },
];

function run(executable, args, cwd) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd, encoding: 'utf8', timeout: 180_000, maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, NAROVA_CLI: CORE },
  });
  assert.equal(result.error, undefined, result.error && result.error.message);
  assert.equal(result.status, 0, `${path.basename(executable)} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

test('live companion: essentials plus every available extension search, download, and verify', { timeout: 20 * 60_000 }, t => {
  const missing = specs.filter(item => item.envKey && !process.env[item.envKey]);
  if (missing.length) t.diagnostic(`optional credentialed providers skipped: ${missing.map(item => item.envKey).join(', ')}`);
  const available = specs.filter(item => !item.envKey || process.env[item.envKey]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-stock-extensions-'));
  const project = path.join(root, 'project');
  run(CORE, ['init', project], root);

  const listing = run(STOCK, ['providers'], project);
  for (const item of specs) assert.match(listing, new RegExp(`^${item.id}\\t`, 'm'));

  for (const item of available) {
    const results = JSON.parse(run(STOCK, [
      'search', item.query, '--provider', item.id, '--kind', item.kind, '--limit', '1', '--json',
    ], project));
    assert.ok(results.length, `${item.id} returned no live search results`);
    assert.equal(results[0].provider, item.id);
    const id = item.acquireId || results[0].id;
    run(STOCK, [
      'acquire', String(id), '--provider', item.id, '--kind', item.kind,
      '--output', `assets/${item.output}`, '--project', project,
    ], project);
    assert.ok(fs.statSync(path.join(project, 'assets', item.output)).size > 0, `${item.id} download was empty`);
  }

  const verified = run(CORE, ['assets', 'verify', '--project', project], project);
  assert.equal((verified.match(/^ok:/gm) || []).length, available.length, verified);
});
