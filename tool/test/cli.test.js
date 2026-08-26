'use strict';
/* CLI smoke tests: spawn the real binary, assert exit codes + output shape.
 * Only cheap commands — nothing that synthesizes or renders. */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveConfig } = require('../src/schema');
const { writeProofReceipt } = require('../src/proof-receipt');
const { buildHashes, hashFile } = require('../src/manifest');

const BIN = path.join(__dirname, '..', 'bin', 'narova.js');
const run = (args, opts = {}) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', ...opts });
const ffmpegFixtureFailure = result => [
  `status=${result.status}`,
  `signal=${result.signal || 'none'}`,
  `error=${result.error?.message || 'none'}`,
  `stderr=${String(result.stderr || '').trim() || 'none'}`,
].join(' ');

test('--version prints a semver', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('help shows on no command, help, and -h', () => {
  for (const args of [[], ['help'], ['-h']]) {
    const r = run(args);
    assert.equal(r.status, 0, args.join(' '));
    assert.match(r.stdout, /Usage: narova/);
    assert.match(r.stdout, /walkthrough explore/);
    assert.match(r.stdout, /walkthrough capture/);
    assert.match(r.stdout, /critique \[profiles\]/);
    assert.match(r.stdout, /assets import/);
    assert.match(r.stdout, /assets search/);
  }
});

test('action-scoped help prints the action usage, not global help (NAR-009-036)', () => {
  const cases = [
    { args: ['assets', 'import', '--help'], needle: /usage: narova assets import <file>/ },
    { args: ['assets', 'download', '--help'], needle: /usage: narova assets download <url>/ },
    { args: ['assets', 'providers', '--help'], needle: /usage: narova assets providers/ },
    { args: ['assets', 'search', '--help'], needle: /usage: narova assets search <query>/ },
    { args: ['assets', 'acquire', '--help'], needle: /usage: narova assets acquire <id>/ },
    { args: ['walkthrough', 'explore', '--help'], needle: /usage: narova walkthrough explore <id>/ },
    { args: ['branch', 'save', '--help'], needle: /usage: narova branch save <name>/ },
  ];
  for (const { args, needle } of cases) {
    const r = run(args);
    assert.equal(r.status, 0, args.join(' '));
    assert.match(r.stdout, needle, args.join(' '));
    assert.ok(!r.stdout.includes('Usage: narova'), `global help leaked into ${args.join(' ')}`);
  }
});

test('group help and bare --help still print global help (NAR-009-036)', () => {
  const bare = run(['--help']);
  assert.match(bare.stdout, /Usage: narova/);
  const group = run(['assets', '--help']);
  assert.match(group.stdout, /Usage: narova/);
});

test('core asset provider discovery reports optional credentials without exposing values', () => {
  const env = { ...process.env, PEXELS_API_KEY: 'provider-secret' };
  delete env.PIXABAY_API_KEY;
  delete env.FREESOUND_API_KEY;
  const listed = run(['assets', 'providers'], { env, cwd: os.tmpdir() });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^wikimedia\timage,video,audio\tready$/m);
  assert.match(listed.stdout, /^iconify\timage\tready$/m);
  assert.match(listed.stdout, /^poly-haven\tmodel\tready$/m);
  assert.match(listed.stdout, /^met\timage\tready$/m);
  assert.match(listed.stdout, /^pexels\timage,video\tready$/m);
  assert.match(listed.stdout, /^pixabay\timage,video\toptional: needs PIXABAY_API_KEY$/m);
  assert.doesNotMatch(listed.stdout + listed.stderr, /provider-secret/);

  const unavailable = run([
    'assets', 'search', 'ocean', '--provider', 'pixabay', '--kind', 'video', '--limit', '1',
  ], { env, cwd: os.tmpdir() });
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /pixabay requires PIXABAY_API_KEY/);
});

test('renderers list exposes both bundled local providers', () => {
  const r = run(['renderers', 'list']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^hyperframes\t[^\t]+\tlocal · browser$/m);
  assert.match(r.stdout, /^no-browser\t1\.0\.0\tlocal · browserless$/m);
});

test('walkthrough status reports a missing take; capture requires synth timings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-walkthrough-'));
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({
    title: 'Demo',
    voices: { a: { speaker: 'en_US-ryan-high' } },
    walkthroughs: {
      app: {
        url: 'https://example.com',
        steps: [{ at: 0.5, action: 'click', target: { text: 'More information' } }],
      },
    },
    scenes: [{
      id: 'demo',
      body: '<p>See the product.</p>',
      walkthrough: 'app',
      vo: [{ who: 'a', text: 'See how it works.' }],
    }],
  }));
  const status = run(['walkthrough', 'status', '--project', dir]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /app: recording missing/);

  const capture = run(['walkthrough', 'capture', 'app', '--project', dir]);
  assert.equal(capture.status, 1);
  assert.match(capture.stderr, /narova synth/);
});

test('render is gone with a usage-status pointer to compose/build', () => {
  const r = run(['render']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /removed in 0\.3\.0/);
});

test('unknown command exits with usage status', () => {
  const r = run(['frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command/);
});

test('init scaffolds a project that passes check; init never overwrites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  assert.equal(run(['init', proj]).status, 0);
  const c = run(['check', '--project', proj]);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /^ok: /m);
  assert.ok(!/^warn:/m.test(c.stdout), 'scaffold must check clean');
  const again = run(['init', proj]);
  assert.match(again.stdout, /skip\s+reel\.config\.mjs \(exists\)/);
  assert.ok(fs.statSync(path.join(proj, 'assets')).isDirectory());
  const brief = fs.readFileSync(path.join(proj, 'creative-brief.md'), 'utf8');
  assert.match(brief, /^Status: draft$/m);
  assert.match(brief, /## Pilot gate/);
});

test('assets import, list, verify, and credits use the project asset lock', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-assets-'));
  const proj = path.join(dir, 'p');
  assert.equal(run(['init', proj]).status, 0);
  fs.writeFileSync(path.join(proj, 'assets', 'hero.jpg'), 'hero');

  const imported = run([
    'assets', 'import', 'assets/hero.jpg', '--project', proj,
    '--origin', 'stock', '--provider', 'example', '--item-id', 'hero-1',
    '--source-page', 'https://example.test/hero', '--license', 'CC-BY-4.0',
    '--attribution', 'Example Artist',
  ]);
  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /tracked: assets\/hero\.jpg/);

  const listed = run(['assets', 'list', '--project', proj]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^assets\/hero\.jpg\timage\tstock\tdeclared$/m);

  const verified = run(['assets', 'verify', '--project', proj]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /^ok: assets\/hero\.jpg$/m);

  const credits = run(['assets', 'credits', '--project', proj]);
  assert.equal(credits.status, 0, credits.stderr);
  assert.match(credits.stdout, /Example Artist \(CC-BY-4\.0\).*example\.test\/hero/);

  fs.writeFileSync(path.join(proj, 'assets', 'hero.jpg'), 'refreshed');
  const refreshed = run(['assets', 'import', 'assets/hero.jpg', '--project', proj]);
  assert.equal(refreshed.status, 0, refreshed.stderr);
  const refreshedRecord = JSON.parse(fs.readFileSync(path.join(proj, 'assets.lock.json'), 'utf8')).assets[0];
  assert.equal(refreshedRecord.origin.provider, 'example');
  assert.equal(refreshedRecord.rights.license, 'CC-BY-4.0');
  assert.equal(refreshedRecord.rights.attribution, 'Example Artist');

  const changedPage = 'https://example.test/hero-revised?edition=2';
  const changed = run([
    'assets', 'import', 'assets/hero.jpg', '--project', proj,
    '--source-page', changedPage,
  ]);
  assert.equal(changed.status, 0, changed.stderr);
  const changedRecord = JSON.parse(fs.readFileSync(path.join(proj, 'assets.lock.json'), 'utf8')).assets[0];
  assert.equal(changedRecord.origin.sourcePage, 'https://example.test/hero-revised');
  assert.equal(
    changedRecord.origin.sourcePageHash,
    crypto.createHash('sha256').update(changedPage).digest('hex'),
  );

  const kept = path.join(proj, 'assets', 'kept.bin');
  fs.writeFileSync(kept, 'previous bytes');
  const invalidMetadata = run([
    'assets', 'download', 'https://127.0.0.1:1/unreachable', '--output', 'assets/kept.bin',
    '--source-page', 'file:///not-a-provider-page', '--project', proj,
  ]);
  assert.equal(invalidMetadata.status, 2);
  assert.match(invalidMetadata.stderr, /source URL must use http\(s\)/);
  assert.equal(fs.readFileSync(kept, 'utf8'), 'previous bytes');

  const unsafeOutput = run([
    'assets', 'download', 'https://example.test/asset', '--output', 'reel.config.mjs', '--project', proj,
  ]);
  assert.equal(unsafeOutput.status, 1);
  assert.match(unsafeOutput.stderr, /must be inside the configured asset directory/);

  const forgedStockOrigin = run([
    'assets', 'acquire', 'File:Example.jpg', '--provider', 'wikimedia', '--kind', 'image',
    '--output', 'assets/example.jpg', '--origin', 'manual', '--item-id', 'different-id', '--project', proj,
  ]);
  assert.equal(forgedStockOrigin.status, 2);
  assert.match(forgedStockOrigin.stderr, /derives stock provenance.*--origin.*--item-id/);
  assert.doesNotMatch(forgedStockOrigin.stderr, /stock provider request/);

  fs.writeFileSync(path.join(proj, 'reel.config.json'), JSON.stringify({
    title: 'Unsafe assets root', assets: '.', voices: {},
    scenes: [{ id: 'one', dur: 1, vo: [], body: '<p>one</p>' }],
  }));
  const collapsedRoot = run([
    'assets', 'download', 'https://127.0.0.1:1/unreachable',
    '--output', 'source.jpg', '--project', proj, '--config', path.join(proj, 'reel.config.json'),
  ]);
  assert.equal(collapsedRoot.status, 1);
  assert.match(collapsedRoot.stderr, /not the project itself/);
  assert.doesNotMatch(collapsedRoot.stderr, /fetch failed/);

  fs.writeFileSync(path.join(proj, 'assets', 'hero.jpg'), 'tampered');
  const stale = run(['assets', 'verify', '--project', proj]);
  assert.equal(stale.status, 3);
  assert.match(stale.stdout, /^fail: assets\/hero\.jpg — content hash changed/m);

  const untracked = run(['assets', 'untrack', 'assets/hero.jpg', '--project', proj]);
  assert.equal(untracked.status, 0, untracked.stderr);
  assert.match(untracked.stdout, /untracked: assets\/hero\.jpg \(file kept\)/);
  assert.ok(fs.existsSync(path.join(proj, 'assets', 'hero.jpg')));
  assert.match(run(['assets', 'list', '--project', proj]).stdout, /no tracked creative assets/);
});

test('branch save snapshots a small proof with mandatory rationale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-branch-'));
  const releases = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-branches-'));
  fs.mkdirSync(path.join(dir, 'out'));
  fs.mkdirSync(path.join(dir, 'out', 'hf-proof', 'snapshots', 'review'), { recursive: true });
  const raw = {
    title: 'Proof', size: '16:9', voices: {},
    scenes: [{ id: 'proof', dur: 2, vo: [], body: '<p>proof</p>' }],
  };
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify(raw));
  fs.writeFileSync(path.join(dir, 'out', 'manifest.json'), JSON.stringify({
    narova: '0.28.0', version: '1.0', project: { title: 'Proof' }, scenes: [],
  }));
  fs.writeFileSync(path.join(dir, 'out', 'timings.json'), JSON.stringify({ total: 2, proof: { dur: 2, turns: [], words: [] } }));
  const review = path.join(dir, 'out', 'hf-proof', 'snapshots', 'review');
  const contactSheet = path.join(review, 'contact-sheet.jpg');
  const frame = path.join(review, '0001.jpg');
  fs.writeFileSync(contactSheet, 'proof');
  fs.writeFileSync(frame, 'frame');
  const resolved = resolveConfig(raw, {}, dir);
  const manifestPath = path.join(dir, 'out', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.hashes = buildHashes(resolved, dir);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const { assetsDir: _assetsDir, ...serializableConfig } = resolved;
  fs.writeFileSync(path.join(dir, 'out', 'config.resolved.json'), JSON.stringify(serializableConfig, null, 2));
  writeProofReceipt(resolved, path.join(dir, 'out'), [contactSheet], [frame]);
  const env = { ...process.env, NAROVA_RELEASES_DIR: releases };

  const missing = run(['branch', 'save', 'proof-a', '--project', dir], { env });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--rationale/);

  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({ ...raw, title: 'Edited after proof' }));
  const stale = run(['branch', 'save', 'stale', '--rationale', 'This must not pair old frames with edited source.', '--project', dir], { env });
  assert.equal(stale.status, 3);
  assert.match(stale.stderr, /config changed after proof review/);
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify(raw));

  const saved = run(['branch', 'save', 'proof-a', '--rationale', 'A procedural field makes the data feel alive.', '--project', dir], { env });
  assert.equal(saved.status, 0, saved.stderr);
  assert.match(saved.stdout, /proof branch "proof-a" saved: status=candidate evidence=1/);
  const metadataDir = path.join(releases, '.branches', 'proof-a');
  const meta = JSON.parse(fs.readFileSync(path.join(metadataDir, 'branch.json'), 'utf8'));
  assert.equal(meta.status, 'candidate');
  assert.match(meta.rationale, /procedural field/);
  assert.deepEqual(meta.evidence, ['proof/evidence/contact-sheet-01.jpg']);
  assert.ok(meta.evidenceHashes[meta.evidence[0]]);
  assert.match(meta.snapshotManifestSha256, /^[a-f0-9]{64}$/);
  assert.match(meta.proofReceiptSha256, /^[a-f0-9]{64}$/);
  assert.match(meta.proofIdentity, /^[a-f0-9]{64}$/);
  assert.match(meta.projectIdentity, /^[a-f0-9]{64}$/);
  assert.ok(Object.keys(meta.snapshotHashes).some(file => /reel\.config\.json$/.test(file)));
  assert.ok(fs.existsSync(path.join(metadataDir, meta.evidence[0])));
  assert.ok(fs.existsSync(path.join(metadataDir, 'proof', 'frames', 'frame-01.jpg')));
  assert.ok(fs.existsSync(path.join(metadataDir, meta.proofReceipt)));

  const machineSaved = run([
    'branch', 'save', 'proof-json', '--rationale', 'Machine consumers retain the accepted rationale.',
    '--project', dir, '--json',
  ], { env });
  assert.equal(machineSaved.status, 0, machineSaved.stderr);
  const machineEnvelope = JSON.parse(machineSaved.stdout);
  assert.equal(machineEnvelope.data.rationale, 'Machine consumers retain the accepted rationale.');
  assert.match(machineEnvelope.data.proofIdentity, /^[a-f0-9]{64}$/);
  assert.match(machineEnvelope.data.snapshotIdentity, /^[a-f0-9]{64}$/);
  assert.ok(machineEnvelope.artifacts.some(artifact => artifact.role === 'archive'));
  assert.ok(machineEnvelope.artifacts.some(artifact => artifact.role === 'proof-metadata'));

  const beforeFailedOverwrite = fs.readFileSync(path.join(metadataDir, 'branch.json'), 'utf8');
  const invalid = run(['branch', 'save', 'proof-a', '--status', 'canddate', '--rationale', 'A typo must not destroy the approved proof.', '--project', dir], { env });
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /invalid branch status/);
  assert.equal(fs.readFileSync(path.join(metadataDir, 'branch.json'), 'utf8'), beforeFailedOverwrite,
    'metadata validation must happen before replacing an existing snapshot');

  const publishedManifest = path.join(releases, 'proof-a', 'manifest.json');
  const beforeBundleFailure = fs.readFileSync(publishedManifest, 'utf8');
  fs.unlinkSync(path.join(dir, 'out', 'config.resolved.json'));
  const incomplete = run(['branch', 'save', 'proof-a', '--rationale', 'A publication failure must roll back.', '--project', dir], { env });
  assert.equal(incomplete.status, 3);
  assert.match(incomplete.stderr, /resolved config changed after proof review/);
  assert.equal(fs.readFileSync(path.join(metadataDir, 'branch.json'), 'utf8'), beforeFailedOverwrite);
  assert.equal(fs.readFileSync(publishedManifest, 'utf8'), beforeBundleFailure,
    'the previous release and proof metadata must survive an incomplete replacement');
});

test('preview --stop is safe when no detached preview exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const r = run(['preview', '--stop', '--project', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no detached preview is running/);
});

test('check exits 1 with the full error list on an invalid config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  fs.writeFileSync(path.join(dir, 'reel.config.json'),
    JSON.stringify({ voices: {}, scenes: [{ id: 'x', body: 1, vo: [] }] }));
  const r = run(['check', '--project', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /body: HTML string required/);
  assert.match(r.stderr, /empty turn list requires a positive explicit dur/);
});

test('build --release runs the pre-build checker before synthesis', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-release-gate-'));
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({
    title: 'Release gate',
    voices: { a: { speaker: 'en_US-ryan-high' } },
    scenes: [{ id: 'empty', body: '<div></div>', vo: [{ who: 'a', text: 'hello' }] }],
  }));
  const r = run(['build', '--release', '--project', dir]);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, /black frame/);
  assert.match(r.stdout, /FAIL \(release\)/);
  assert.doesNotMatch(r.stdout + r.stderr, /synth complete/);
});

test('build --release --variant preflights the base before synthesis', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-variant-release-gate-'));
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({
    title: 'Variant release gate',
    voices: { a: { speaker: 'en_US-ryan-high' } },
    scenes: [{ id: 'opening', body: '<div></div>', vo: [{ who: 'a', text: 'Base.' }] }],
    variants: [{ id: 'fixed', scene: {
      body: '<p>Visible variant.</p>', vo: [{ who: 'a', text: 'Variant.' }],
    } }],
  }));
  const r = run(['build', '--release', '--variant', 'fixed', '--project', dir]);
  assert.equal(r.status, 3, r.stderr);
  assert.match(r.stdout, /scene "opening".*black frame/);
  assert.doesNotMatch(r.stdout + r.stderr, /synth complete/);
});

test('commands work from a subdirectory (config discovered by walking up)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const nested = path.join(proj, 'out', 'hf');
  fs.mkdirSync(nested, { recursive: true });
  const r = run(['check'], { cwd: nested });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ok: /m);
});

test('ingest and generate validate the ancestor project asset lock before network or provider work', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-assets-root-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const nested = path.join(proj, 'out', 'hf');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(proj, 'assets.lock.json'), '{malformed');
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;

  const generated = run(['generate', 'test clip', '--provider', 'sora'], { cwd: nested, env });
  assert.equal(generated.status, 1);
  assert.match(generated.stderr, /assets\.lock\.json: invalid JSON/);
  assert.doesNotMatch(generated.stderr, /OPENAI_API_KEY/);

  const ingested = run(['ingest', 'https://127.0.0.1:1/unreachable'], { cwd: nested, env });
  assert.equal(ingested.status, 1);
  assert.match(ingested.stderr, /assets\.lock\.json: invalid JSON/);
  assert.doesNotMatch(ingested.stderr, /fetch failed/);

  const acquired = run([
    'assets', 'acquire', '123', '--provider', 'pexels', '--kind', 'video',
    '--output', 'assets/clip.mp4',
  ], { cwd: nested, env });
  assert.equal(acquired.status, 1);
  assert.match(acquired.stderr, /assets\.lock\.json: invalid JSON/);
  assert.doesNotMatch(acquired.stderr, /PEXELS_API_KEY/);
});

test('compose prints the scene start table for QA', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const out = path.join(proj, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(out, 'audio', 'full.wav'), 'RIFFfake');
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
    opening: { dur: 3, turns: [0.16], words: [{ w: 'Hi.', t0: 0.16, t1: 0.9, who: 'a', si: 0 }] },
  }));
  const r = run(['compose', '--project', proj]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scene starts:/);
  assert.match(r.stdout, /00:00\.0 {2}opening {2}\(3\.0s\)/);
  assert.match(r.stdout, /narova shots/);
  assert.match(r.stdout, /captions -> /);
  assert.ok(fs.existsSync(path.join(out, 'captions.srt')));
  assert.ok(fs.existsSync(path.join(out, 'captions.vtt')));
});

test('compose preserves restored pre-0.28 safe geometry unless raw layout is explicitly authored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-legacy-layout-'));
  const out = path.join(dir, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  const raw = {
    title: 'Legacy layout', size: '16:9', voices: {},
    scenes: [{ id: 'one', dur: 1, vo: [], body: '<p>legacy</p>' }],
  };
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify(raw));
  fs.writeFileSync(path.join(out, 'audio', 'full.wav'), 'placeholder');
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({ total: 1, one: { dur: 1, turns: [], words: [] } }));
  const manifest = path.join(out, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ narova: '0.27.0', version: '1.0' }));
  fs.writeFileSync(path.join(out, '.restored-manifest.json'), JSON.stringify({ manifestSha256: hashFile(manifest) }));
  const restored = run(['compose', '--project', dir]);
  assert.equal(restored.status, 0, restored.stderr);
  const cssFile = path.join(out, 'hf-legacy-layout', 'style.css');
  assert.match(fs.readFileSync(cssFile, 'utf8'), /max-width:var\(--colw,1000px\)/);
  const recompiled = run(['compile', '--project', dir]);
  assert.equal(recompiled.status, 0, recompiled.stderr);
  const secondCompose = run(['compose', '--project', dir]);
  assert.equal(secondCompose.status, 0, secondCompose.stderr);
  assert.match(fs.readFileSync(cssFile, 'utf8'), /max-width:var\(--colw,1000px\)/,
    'legacy provenance must survive repeated manifest regeneration');
  const reboundMarker = JSON.parse(fs.readFileSync(path.join(out, '.restored-manifest.json'), 'utf8'));
  assert.equal(reboundMarker.legacySafeLayout, true);
  assert.equal(reboundMarker.manifestSha256, hashFile(manifest));

  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({ ...raw, safeLayout: false }));
  const explicitRaw = run(['compose', '--project', dir]);
  assert.equal(explicitRaw.status, 0, explicitRaw.stderr);
  assert.doesNotMatch(fs.readFileSync(cssFile, 'utf8'), /max-width:var\(--colw,1000px\)/);
  assert.equal(fs.existsSync(path.join(out, '.restored-manifest.json')), false,
    'an explicit raw-layout choice permanently retires restored legacy provenance');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restored branch overrides are reapplied and explicit CLI flags still win', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-restored-overrides-'));
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({
    title: 'Restored overrides', voices: {},
    scenes: [{ id: 'one', dur: 1, vo: [], body: '<p>base</p>' }],
    variants: [
      { id: 'bold', kind: 'visual', sceneOverrides: { one: { body: '<p>bold</p>' } } },
      { id: 'quiet', kind: 'visual', sceneOverrides: { one: { body: '<p>quiet</p>' } } },
    ],
  }));
  fs.writeFileSync(path.join(out, '.restored-overrides.json'), JSON.stringify({ variant: 'bold' }));
  const restored = run(['compile', '--project', dir]);
  assert.equal(restored.status, 0, restored.stderr);
  let manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.variant, 'bold');
  assert.match(manifest.scenes[0].body, /bold/);
  const explicit = run(['compile', '--variant', 'quiet', '--project', dir]);
  assert.equal(explicit.status, 0, explicit.stderr);
  manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.variant, 'quiet');
  assert.match(manifest.scenes[0].body, /quiet/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('shots without synth exits 1 with the run-synth hint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['shots', '--project', proj]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /narova synth/);
});

test('bare --out errors instead of resolving "true"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['compose', '--project', proj, '--out']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--out needs a value/);
});

test('any bare value-flag errors instead of resolving to true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['check', '--project', proj, '--tempo']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--tempo needs a value/);
});

test('unknown options are rejected instead of pretending to need a value', () => {
  const r = run(['check', '--definitely-not-a-flag']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --definitely-not-a-flag/);
});

test('help documents force synthesis and temporal QA flags', () => {
  const r = run(['help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--force\s+synth/);
  assert.match(r.stdout, /--motion\s+shots/);
  assert.match(r.stdout, /--beats\s+shots/);
  assert.match(r.stdout, /--verify-motion\s+build/);
});

/* A scaffold with timings.json already synthed (fake audio, real timings). */
function projectWithTimings() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const out = path.join(proj, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(out, 'audio', 'full.wav'), 'RIFFfake');
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
    opening: { dur: 3, turns: [0.16], words: [{ w: 'Hi.', t0: 0.16, t1: 0.9, who: 'a', si: 0 }] },
  }));
  return proj;
}

test('shots review modes are mutually exclusive', () => {
  const proj = projectWithTimings();
  const r = run(['shots', '--project', proj, '--at', '0.5', '--beats']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--at, --motion, and --beats are mutually exclusive/);
});

/* Scaffold with a real synthetic full.wav for audio-level review tests. */
function projectWithAudio() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const audioDir = path.join(proj, 'out', 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  const r = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-filter_threads', '1', '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
    '-c:a', 'pcm_s16le', '-threads', '1', path.join(audioDir, 'full.wav'),
  ], { encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`ffmpeg fixture failed: ${ffmpegFixtureFailure(r)}`);
  return proj;
}

test('review --audio-levels reports measured facts', () => {
  const proj = projectWithAudio();
  const r = run(['review', '--audio-levels', '--project', proj]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /audio-levels \(advisory/);
  assert.match(r.stdout, /integrated loudness:/);
  assert.match(r.stdout, /clipped samples: 0/);
});

test('review --audio-levels --json emits narova.result/1 envelope', () => {
  const proj = projectWithAudio();
  const r = run(['review', '--audio-levels', '--project', proj, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const envelope = JSON.parse(r.stdout);
  assert.equal(envelope.schema, 'narova.result/1');
  assert.equal(envelope.data.mode, 'audio-levels');
  assert.ok(envelope.data.facts);
  assert.equal(typeof envelope.data.digest, 'string');
});

test('review --audio-levels honors --audio and --interval', () => {
  const proj = projectWithAudio();
  const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const other = path.join(otherDir, 'loud.wav');
  const gen = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-filter_threads', '1', '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1,volume=20dB',
    '-c:a', 'pcm_s16le', '-threads', '1', other,
  ], { encoding: 'utf8', timeout: 30000 });
  if (gen.status !== 0) throw new Error(`ffmpeg fixture failed: ${ffmpegFixtureFailure(gen)}`);
  const r = run(['review', '--audio-levels', '--project', proj, '--audio', other, '--interval', '0.2,0.8']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /interval 0\.20s–0\.80s/);
  assert.match(r.stdout, /clipped samples: [1-9]/);
});

test('audio-level selectors are rejected outside their exact review mode', () => {
  const wrongMode = run(['check', '--audio-levels']);
  assert.equal(wrongMode.status, 2);
  assert.match(wrongMode.stderr, /--audio-levels is only valid with narova review/);

  const orphanSelector = run(['review', '--audio', 'full.wav']);
  assert.equal(orphanSelector.status, 2);
  assert.match(orphanSelector.stderr, /only valid with narova review --audio-levels/);
});

test('review --audio-levels rejects partially numeric intervals', () => {
  const proj = projectWithAudio();
  const r = run(['review', '--audio-levels', '--project', proj, '--interval', '1x,2y']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--interval needs 0 ≤ start < end/);
});

test('review --audio-levels rejects an empty explicit audio selector', () => {
  const proj = projectWithAudio();
  const r = run(['review', '--audio-levels', '--project', proj, '--audio=']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--audio needs a non-empty file path/);
});

test('review --audio-levels preserves silent peaks in machine output', () => {
  const proj = projectWithAudio();
  const silence = path.join(proj, 'out', 'audio', 'silence.wav');
  const gen = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-filter_threads', '1', '-filter_complex_threads', '1',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1',
    '-c:a', 'pcm_s16le', '-threads', '1', silence,
  ], { encoding: 'utf8', timeout: 30000 });
  if (gen.status !== 0) throw new Error(`ffmpeg fixture failed: ${ffmpegFixtureFailure(gen)}`);

  const r = run(['review', '--audio-levels', '--project', proj, '--audio', 'audio/silence.wav', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const envelope = JSON.parse(r.stdout);
  assert.equal(envelope.data.facts.integratedLoudness, '-inf');
  assert.equal(envelope.data.facts.truePeak, '-inf');
  assert.equal(envelope.data.facts.samplePeak, '-inf');
});

test('review --audio-levels --windows emits ordered joined machine facts', () => {
  const proj = projectWithAudio();
  const windows = JSON.stringify([
    { label: 'second', start: 0.5, end: 0.9 },
    { label: 'tiny', start: 0, end: 0.05 },
  ]);
  const r = run(['review', '--audio-levels', '--windows', windows, '--project', proj, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const envelope = JSON.parse(r.stdout);
  assert.equal(envelope.data.mode, 'audio-windows');
  assert.deepEqual(envelope.data.windows.map(row => row.label), ['second', 'tiny']);
  assert.equal(envelope.data.windows[1].facts.integratedLoudness, null);
  assert.equal(typeof envelope.data.digest, 'string');
});

test('review --audio-levels --delivered measures the selected encoded member', () => {
  const proj = projectWithAudio();
  const source = path.join(proj, 'out', 'audio', 'full.wav');
  const delivered = path.join(proj, 'out', 'delivery.mp4');
  const encoded = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-i', source, '-af', 'volume=-9dB',
    '-c:a', 'aac', '-vn', delivered,
  ], { encoding: 'utf8', timeout: 30000 });
  if (encoded.status !== 0) throw new Error(`ffmpeg fixture failed: ${ffmpegFixtureFailure(encoded)}`);
  const r = run(['review', '--audio-levels', '--delivered', 'delivery.mp4', '--project', proj, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const envelope = JSON.parse(r.stdout);
  assert.equal(envelope.data.mode, 'delivered-audio-levels');
  assert.equal(envelope.data.member.codec, 'aac');
  assert.equal(envelope.data.selectionBasis, 'only audio member');
  assert.equal(typeof envelope.data.digest, 'string');
});

test('review --audio-levels --mix-map exposes resolved declaration and total-mix facts', () => {
  const proj = projectWithAudio();
  const assets = path.join(proj, 'assets');
  const out = path.join(proj, 'out');
  fs.mkdirSync(assets, { recursive: true });
  for (const [name, source] of [['bed.wav', 'sine=frequency=220:duration=4'], ['hit.wav', 'sine=frequency=880:duration=0.2']]) {
    const made = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', source,
      '-c:a', 'pcm_s16le', path.join(assets, name),
    ], { encoding: 'utf8', timeout: 30000 });
    if (made.status !== 0) throw new Error(`ffmpeg fixture failed: ${ffmpegFixtureFailure(made)}`);
  }
  fs.copyFileSync(path.join(out, 'audio', 'full.wav'), path.join(out, 'audio', 'mix.wav'));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({ opening: { dur: 1, turns: [], words: [] } }));
  const configFile = path.join(proj, 'reel.config.mjs');
  const config = fs.readFileSync(configFile, 'utf8').replace(
    '  timing: {',
    '  bed: { file: "assets/bed.wav", volume: 0.2, fadeIn: 0.1, fadeOut: 0.2 },\n  sfx: [{ file: "assets/hit.wav", scene: "opening", at: 0.5, volume: 0.8 }],\n  timing: {',
  );
  fs.writeFileSync(configFile, config);

  const r = run(['review', '--audio-levels', '--mix-map', '--project', proj, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const envelope = JSON.parse(r.stdout);
  assert.equal(envelope.data.mode, 'audio-mix-map');
  assert.deepEqual(envelope.data.declarations.map(row => row.kind), ['bed', 'sfx']);
  assert.equal(envelope.data.declarations[1].window.start, 0.5);
  assert.match(envelope.data.caveat, /does not isolate or prove/);
});

test('audio proof selectors reject conflicting and orphaned combinations', () => {
  const proj = projectWithAudio();
  const conflict = run(['review', '--audio-levels', '--windows', '[]', '--delivered', '--project', proj]);
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /mutually exclusive/);
  const orphan = run(['review', '--windows', '[]', '--project', proj]);
  assert.equal(orphan.status, 2);
  assert.match(orphan.stderr, /only valid with narova review --audio-levels/);
  const duplicate = run([
    'review', '--audio-levels', '--windows',
    JSON.stringify([{ label: 'same', start: 0, end: 0.2 }, { label: 'same', start: 0.2, end: 0.4 }]),
    '--project', proj,
  ]);
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /duplicate audio window label/);
});

test('captions rewrites out/captions.{srt,vtt} from timings.json', () => {
  const proj = projectWithTimings();
  const r = run(['captions', '--project', proj]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /captions -> .*captions\.srt \(\+ captions\.vtt, 1 cues\)/);
  const out = path.join(proj, 'out');
  assert.equal(fs.readFileSync(path.join(out, 'captions.srt'), 'utf8'),
    '1\n00:00:00,160 --> 00:00:03,000\nHi.\n');
  assert.equal(fs.readFileSync(path.join(out, 'captions.vtt'), 'utf8'),
    'WEBVTT\n\n00:00:00.160 --> 00:00:03.000\nHi.\n');
});

test('captions without synth exits 1 with the run-synth hint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['captions', '--project', proj]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /narova synth/);
});

test('--platform sets a frame preset; an unknown platform fails check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const ok = run(['check', '--project', proj, '--platform', 'tiktok']);
  assert.equal(ok.status, 0, ok.stderr);
  const bad = run(['check', '--project', proj, '--platform', 'myspace']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--platform must be one of/);
});

test('--variant with an undeclared id fails check naming the declared variants', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['check', '--project', proj, '--variant', 'nope']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown variant "nope"/);
});

test('build --variant and --variants together are rejected before any synth', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['build', '--project', proj, '--variant', 'x', '--variants']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /mutually exclusive/);
});

test('CLI version matches the standalone package version', () => {
  const packageVersion = require('../package.json').version;
  assert.ok(typeof packageVersion === 'string' && packageVersion.length > 0);
  const r = run(['--version']);
  assert.equal(r.status, 0, '--version must exit clean');
  assert.equal(r.stdout.trim(), packageVersion);
});
