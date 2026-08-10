#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listStockProviders, resolveStock, searchStock } = require('./stock-providers');

const ESSENTIAL = new Set(['wikimedia', 'openverse', 'nasa', 'internet-archive', 'iconify', 'poly-haven']);
const KIND_EXTENSIONS = Object.freeze({
  image: new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']),
  video: new Set(['.mp4', '.webm', '.mov', '.mkv']),
  audio: new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']),
  model: new Set(['.gltf', '.glb', '.obj', '.fbx', '.usdz']),
});

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const name = value.slice(2);
    if (name === 'json' || name === 'help') { flags[name] = true; continue; }
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`);
    flags[name] = argv[++i];
  }
  return { positionals, flags };
}

function coreCommand() {
  const explicit = process.env.NAROVA_CLI;
  const repositoryCli = path.resolve(__dirname, '../../../tool/bin/narova.js');
  if (explicit) return { command: process.execPath, prefix: [path.resolve(explicit)] };
  if (fs.existsSync(repositoryCli)) return { command: process.execPath, prefix: [repositoryCli] };
  return { command: 'narova', prefix: [] };
}

function runCore(args, { capture = false } = {}) {
  const { command, prefix } = coreCommand();
  const result = spawnSync(command, [...prefix, ...args], {
    encoding: 'utf8', env: process.env, stdio: capture ? 'pipe' : 'inherit', maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw new Error(`could not run Narova core: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = capture ? String(result.stderr || result.stdout || '').trim() : '';
    throw new Error(`Narova core exited with status ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return capture ? result.stdout : '';
}

function printResults(results, json) {
  if (json) { console.log(JSON.stringify(results, null, 2)); return; }
  if (!results.length) { console.log('no stock assets found'); return; }
  for (const result of results) {
    const license = result.rights?.license || result.rights?.status || 'unknown';
    console.log(`${result.provider}\t${result.id}\t${result.kind}\t${license}\t${result.title}`);
    console.log(`  ${result.sourcePage}`);
  }
}

function metadataArgs(item) {
  const args = [
    '--origin', 'stock', '--provider', item.provider, '--item-id', String(item.id),
    '--source-page', item.sourcePage,
  ];
  const declared = item.rights && item.rights.status === 'declared';
  if (!declared) return args;
  for (const [flag, field] of [
    ['--license', 'license'], ['--license-url', 'licenseUrl'], ['--creator', 'creator'], ['--attribution', 'attribution'],
  ]) if (item.rights[field]) args.push(flag, item.rights[field]);
  return args;
}

function assertOutputKind(output, kind) {
  const allowed = KIND_EXTENSIONS[kind];
  const extension = path.extname(output || '').toLowerCase();
  if (!allowed || !allowed.has(extension)) {
    throw new Error(`--output extension ${extension || '(missing)'} is not a supported ${kind} asset`);
  }
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const action = positionals[0];
  if (!action || flags.help) {
    console.log('usage: narova-stock providers | search <query> --provider <id> --kind <kind> [--limit N] [--json] | acquire <id> --provider <id> --kind <kind> --output <path> [--project <dir>]');
    return;
  }
  if (action === 'providers') {
    process.stdout.write(runCore(['assets', 'providers', '--pack', 'essential'], { capture: true }));
    for (const provider of listStockProviders(process.env)) {
      console.log(`${provider.id}\t${provider.kinds.join(',')}\t${provider.ready ? 'ready' : `optional: needs ${provider.envKey}`}`);
    }
    return;
  }
  if (!flags.provider || !flags.kind) throw new Error(`narova-stock ${action} requires --provider and --kind`);
  if (action === 'search') {
    const query = positionals.slice(1).join(' ');
    if (!query) throw new Error('narova-stock search requires a query');
    if (ESSENTIAL.has(flags.provider)) {
      const args = ['assets', 'search', query, '--provider', flags.provider, '--kind', flags.kind];
      if (flags.limit) args.push('--limit', flags.limit);
      if (flags.json) args.push('--json');
      process.stdout.write(runCore(args, { capture: true }));
      return;
    }
    printResults(await searchStock(flags.provider, query, { kind: flags.kind, limit: flags.limit }), flags.json);
    return;
  }
  if (action === 'acquire') {
    const id = positionals.slice(1).join(' ');
    if (!id || !flags.output) throw new Error('narova-stock acquire requires an id and --output');
    assertOutputKind(flags.output, flags.kind);
    if (ESSENTIAL.has(flags.provider)) {
      const args = ['assets', 'acquire', id, '--provider', flags.provider, '--kind', flags.kind, '--output', flags.output];
      if (flags.project) args.push('--project', flags.project);
      runCore(args);
      return;
    }
    const item = await resolveStock(flags.provider, id, { kind: flags.kind });
    const args = ['assets', 'download', item.download.url, '--output', flags.output, ...metadataArgs(item)];
    if (flags.project) args.push('--project', flags.project);
    runCore(args);
    return;
  }
  throw new Error(`unknown narova-stock command ${JSON.stringify(action)}`);
}

main().catch(error => {
  console.error(`narova-stock: ${error.message}`);
  process.exit(1);
});

