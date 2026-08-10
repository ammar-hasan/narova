'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

function tempReleasesDir() {
  const dir = path.join(os.tmpdir(), `narova-releases-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.NAROVA_RELEASES_DIR = dir;
  delete require.cache[require.resolve('../src/releases')];
  return dir;
}

function releases() {
  delete require.cache[require.resolve('../src/releases')];
  return require('../src/releases');
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  delete process.env.NAROVA_RELEASES_DIR;
  delete require.cache[require.resolve('../src/releases')];
}

test('save creates a named release directory with manifest.json', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, test: true }));
  try {
    const r = await releases().save(mp, 'my-build-1');
    assert.equal(r.name, 'my-build-1');
    assert.ok(fs.existsSync(r.dir), 'release directory exists');
    assert.ok(fs.existsSync(path.join(r.dir, 'manifest.json')), 'manifest.json saved');
    const content = JSON.parse(fs.readFileSync(path.join(r.dir, 'manifest.json'), 'utf8'));
    assert.equal(content.narova, '0.8.2');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('list returns saved releases', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, test: true }));
  try {
    await releases().save(mp, 'release-list-test');
    const entries = releases().list();
    assert.ok(entries.length > 0);
    assert.ok(entries.some(e => e.name === 'release-list-test'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('restore writes manifest to destination', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, restored: true }));
  fs.writeFileSync(path.join(tmp, '.audio-fingerprint'), 'audio-id\n');
  fs.writeFileSync(path.join(tmp, '.timings-fingerprint'), 'timeline-id\n');
  fs.writeFileSync(path.join(tmp, 'timings.json'), '{"total":3}\n');
  const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-restore-'));
  try {
    await releases().save(mp, 'restore-test');
    const result = releases().restore('restore-test', destDir);
    assert.ok(fs.existsSync(result.manifest), 'manifest restored');
    const content = JSON.parse(fs.readFileSync(result.manifest, 'utf8'));
    assert.equal(content.restored, true);
    const marker = JSON.parse(fs.readFileSync(path.join(destDir, releases().RESTORE_MARKER), 'utf8'));
    assert.match(marker.manifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(destDir, '.timings-fingerprint'), 'utf8'), 'timeline-id\n');
    assert.equal(fs.readFileSync(path.join(destDir, 'timings.json'), 'utf8'), '{"total":3}\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(destDir, { recursive: true, force: true });
    cleanup(td);
  }
});

test('remove deletes a release directory', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, test: true }));
  try {
    await releases().save(mp, 'remove-test');
    const p = releases().remove('remove-test');
    assert.ok(!fs.existsSync(p), 'release directory should be deleted');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('remove throws on unknown name', () => {
  const td = tempReleasesDir();
  try { assert.throws(() => releases().remove('nonexistent-release-name-xyz')); }
  finally { cleanup(td); }
});

test('restore throws on unknown name', () => {
  const td = tempReleasesDir();
  try { assert.throws(() => releases().restore('nonexistent-release-name-xyz', '/tmp')); }
  finally { cleanup(td); }
});

test('save sanitizes name with invalid characters', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, test: true }));
  try {
    const r = await releases().save(mp, 'my build v1.0 (final)!');
    assert.equal(r.name, 'mybuildv1.0final');
    assert.ok(fs.existsSync(r.dir), 'sanitized release directory exists');
    assert.ok(fs.existsSync(path.join(r.dir, 'manifest.json')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('release path resolves inside releases directory', () => {
  const td = tempReleasesDir();
  try {
    const p = releases().releasePath('valid-release');
    const resolved = path.resolve(p);
    assert.ok(resolved.startsWith(path.resolve(td)), 'release dir stays inside releases root');
    assert.throws(() => releases().releasePath('.branches'), /reserved/);
    assert.throws(() => releases().releasePath('.narova-internal'), /reserved/);
    assert.throws(() => releases().releasePath('.BRANCHES'), /reserved/);
    assert.throws(() => releases().releasePath('.branches.'), /reserved/);
    assert.throws(() => releases().releasePath('.NAROVA-INTERNAL'), /reserved/);
    assert.throws(() => releases().releasePath('.narova-internal.'), /reserved/);
  } finally {
    cleanup(td);
  }
});

test('symlink aliases of one release store share the same physical lock namespace', () => {
  const td = tempReleasesDir();
  const directApi = releases();
  const alias = path.join(os.tmpdir(), `narova-releases-alias-${Date.now()}`);
  try {
    fs.symlinkSync(td, alias, 'dir');
    process.env.NAROVA_RELEASES_DIR = alias;
    const aliasApi = releases();
    const directLocks = fs.realpathSync(path.dirname(directApi._internals.branchLockFile('proof')));
    const aliasLocks = fs.realpathSync(path.dirname(aliasApi._internals.branchLockFile('proof')));
    assert.equal(aliasLocks, directLocks);
  } finally {
    try { fs.unlinkSync(alias); } catch {}
    cleanup(td);
  }
});

test('saving the same release name replaces rather than merges stale files', async () => {
  const td = tempReleasesDir();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-fresh-'));
  const out = path.join(project, 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(project, 'reel.config.mjs'), 'export default { scenes: [] };');
  fs.writeFileSync(path.join(project, 'theme.css'), '.old{}');
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ narova: 'x', project: {} }));
  try {
    await releases().save(path.join(out, 'manifest.json'), 'same', { projectDir: project });
    fs.rmSync(path.join(project, 'theme.css'));
    await releases().save(path.join(out, 'manifest.json'), 'same', { projectDir: project });
    assert.equal(fs.existsSync(path.join(td, 'same', 'theme.css')), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    cleanup(td);
  }
});

test('branch status accepts only the documented lifecycle', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-status-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: 'x', project: {} }));
  try {
    await releases().save(mp, 'branch');
    assert.throws(() => releases().saveBranch('branch', { status: 'banana' }), /invalid branch status/);
    releases().saveBranch('branch', { status: 'candidate' });
    assert.throws(() => releases().setBranchStatus('branch', 'done'), /invalid branch status/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('staged branch publication replaces release and metadata as one pair', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-publish-'));
  const oldManifest = path.join(tmp, 'old.json');
  const newManifest = path.join(tmp, 'new.json');
  fs.writeFileSync(oldManifest, JSON.stringify({ narova: 'old', project: {} }));
  fs.writeFileSync(newManifest, JSON.stringify({ narova: 'new', project: {} }));
  try {
    const api = releases();
    await api.save(oldManifest, 'proof');
    api.saveBranch('proof', { status: 'approved', rationale: 'old' });
    await api.save(newManifest, 'stage');
    api.saveBranch('stage', { status: 'candidate', rationale: 'new' });
    const published = api.publishStagedBranch('stage', 'proof');
    assert.equal(published.name, 'proof');
    assert.equal(JSON.parse(fs.readFileSync(path.join(td, 'proof', 'manifest.json'))).narova, 'new');
    assert.equal(api.readBranch('proof').rationale, 'new');
    assert.equal(fs.existsSync(path.join(td, 'stage')), false);
    assert.equal(fs.existsSync(path.join(td, '.branches', 'stage')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('staged branch publication uses compare-and-swap to reject a concurrent stale replacement', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-cas-'));
  const manifest = value => {
    const file = path.join(tmp, `${value}.json`);
    fs.writeFileSync(file, JSON.stringify({ narova: value, project: {} }));
    return file;
  };
  try {
    const api = releases();
    await api.save(manifest('old'), 'proof');
    api.saveBranch('proof', { status: 'approved', rationale: 'old' });
    const baseline = api.branchRevision('proof');
    await api.save(manifest('first'), 'stage-first');
    api.saveBranch('stage-first', { status: 'candidate', rationale: 'first' });
    await api.save(manifest('second'), 'stage-second');
    api.saveBranch('stage-second', { status: 'candidate', rationale: 'second' });
    api.publishStagedBranch('stage-first', 'proof', { expectedRevision: baseline });
    assert.throws(() => api.publishStagedBranch('stage-second', 'proof', { expectedRevision: baseline }),
      /changed while this proof was being saved/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(td, 'proof', 'manifest.json'))).narova, 'first');
    assert.equal(api.readBranch('proof').rationale, 'first');
    const targetRevision = api.branchRevision('proof');
    const stagedRevision = api.branchRevision('stage-second');
    api.setBranchRationale('stage-second', 'mutated staged proof');
    assert.throws(() => api.publishStagedBranch('stage-second', 'proof', {
      expectedRevision: targetRevision,
      expectedStagedRevision: stagedRevision,
    }), /changed before publication/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(td, 'proof', 'manifest.json'))).narova, 'first');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('same-manifest concurrent saves compare the complete snapshot before publishing', async () => {
  const td = tempReleasesDir();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-full-cas-'));
  const manifest = path.join(root, 'manifest.json');
  const baseline = path.join(root, 'baseline');
  const slow = path.join(root, 'slow');
  const fast = path.join(root, 'fast');
  const slowStarted = path.join(root, 'slow-started');
  fs.writeFileSync(manifest, JSON.stringify({ narova: 'same', project: {} }));
  for (const dir of [baseline, slow, fast]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(baseline, 'reel.config.mjs'), 'export default { scenes: [] };');
  fs.writeFileSync(path.join(slow, 'reel.config.mjs'),
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(slowStarted)}, 'yes'); await new Promise(resolve => setTimeout(resolve, 100)); export default { scenes: [] };\n`);
  fs.writeFileSync(path.join(fast, 'reel.config.mjs'), 'export default { scenes: [], project: { title: "fast" } };');
  try {
    const api = releases();
    await api.save(manifest, 'proof', { projectDir: baseline });
    const staleSave = api.save(manifest, 'proof', { projectDir: slow });
    while (!fs.existsSync(slowStarted)) await new Promise(resolve => setTimeout(resolve, 2));
    await api.save(manifest, 'proof', { projectDir: fast });
    await assert.rejects(staleSave, /changed while this snapshot was being saved/);
    assert.equal(fs.readFileSync(path.join(td, 'proof', 'reel.config.mjs'), 'utf8'),
      'export default { scenes: [], project: { title: "fast" } };');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    cleanup(td);
  }
});

test('snapshot revision framing distinguishes binary contents from extra tree entries', () => {
  const td = tempReleasesDir();
  try {
    const api = releases();
    const dir = api.releasePath('collision-proof');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a'), Buffer.from('X\0file\0b\0Y'));
    const oneFile = api.branchRevision('collision-proof');
    fs.rmSync(dir, { recursive: true });
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'a'), 'X');
    fs.writeFileSync(path.join(dir, 'b'), 'Y');
    const twoFiles = api.branchRevision('collision-proof');
    assert.notEqual(oneFile, twoFiles);
  } finally {
    cleanup(td);
  }
});

test('snapshot revision includes special filesystem entries without reading them', t => {
  if (process.platform === 'win32') return t.skip('mkfifo is not available on Windows');
  const td = tempReleasesDir();
  try {
    const api = releases();
    const dir = api.releasePath('special-entry-proof');
    fs.mkdirSync(dir);
    const before = api.branchRevision('special-entry-proof');
    const made = spawnSync('mkfifo', [path.join(dir, 'timeline-fifo')]);
    if (made.status !== 0) return t.skip('mkfifo is unavailable');
    assert.notEqual(api.branchRevision('special-entry-proof'), before);
  } finally {
    cleanup(td);
  }
});

test('all named writers share one lock and a dead owner is recovered', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-writer-lock-'));
  const manifest = path.join(tmp, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ narova: 'locked', project: {} }));
  try {
    const api = releases();
    await api.save(manifest, 'proof');
    api.saveBranch('proof', { status: 'candidate', rationale: 'before' });
    const importStarted = path.join(tmp, 'import-started');
    fs.writeFileSync(path.join(tmp, 'reel.config.mjs'),
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(importStarted)}, 'yes'); await new Promise(resolve => setTimeout(resolve, 100)); export default { scenes: [] };\n`);
    const staleSave = api.save(manifest, 'proof', { projectDir: tmp });
    while (!fs.existsSync(importStarted)) await new Promise(resolve => setTimeout(resolve, 2));
    api.setBranchRationale('proof', 'new concurrent decision');
    await assert.rejects(staleSave, /changed while this snapshot was being saved/);
    assert.equal(api.readBranch('proof').rationale, 'new concurrent decision');
    const unlock = api._internals.acquireBranchLock('proof');
    try {
      assert.throws(() => api.setBranchStatus('proof', 'approved'), /another process/);
      await assert.rejects(api.save(manifest, 'proof'), /another process/);
    } finally { unlock(); }
    const lockFile = api._internals.branchLockFile('proof');
    fs.mkdirSync(lockFile, { recursive: true });
    fs.writeFileSync(path.join(lockFile, 'intent-99999999-orphaned.json'), JSON.stringify({ pid: 99_999_999, nonce: 'orphaned', started: 'old' }));
    fs.writeFileSync(path.join(lockFile, 'intent-reused-pid.json'), JSON.stringify({ pid: process.pid, nonce: 'old-generation', started: 'not-this-process' }));
    const malformed = path.join(lockFile, 'intent-malformed.json');
    fs.writeFileSync(malformed, '{}');
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(malformed, old, old);
    api.setBranchStatus('proof', 'approved');
    assert.equal(api.readBranch('proof').status, 'approved');
    assert.deepEqual(fs.readdirSync(lockFile), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('release snapshots restore the exact CLI overrides used by a proof', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-overrides-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-overrides-dest-'));
  const manifest = path.join(tmp, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ narova: '0.28.0', project: {} }));
  try {
    const api = releases();
    await api.save(manifest, 'variant-proof', {
      resolvedOverrides: { variant: 'bold', renderer: 'no-browser', tempo: '1.1' },
    });
    api.restore('variant-proof', dest);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dest, api.RESTORE_OVERRIDES), 'utf8')),
      { variant: 'bold', renderer: 'no-browser', tempo: '1.1' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    cleanup(td);
  }
});

test('post-publication backup cleanup failure keeps the newly committed pair', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-cleanup-'));
  const oldManifest = path.join(tmp, 'old.json');
  const newManifest = path.join(tmp, 'new.json');
  fs.writeFileSync(oldManifest, JSON.stringify({ narova: 'old', project: {} }));
  fs.writeFileSync(newManifest, JSON.stringify({ narova: 'new', project: {} }));
  try {
    const api = releases();
    await api.save(oldManifest, 'proof');
    api.saveBranch('proof', { status: 'approved', rationale: 'old' });
    await api.save(newManifest, 'stage');
    api.saveBranch('stage', { status: 'candidate', rationale: 'new' });
    const published = api.publishStagedBranch('stage', 'proof', {
      removeDir: () => { throw new Error('simulated cleanup failure'); },
    });
    assert.equal(published.name, 'proof');
    assert.equal(JSON.parse(fs.readFileSync(path.join(td, 'proof', 'manifest.json'))).narova, 'new');
    assert.equal(api.readBranch('proof').rationale, 'new');
    assert.deepEqual(api.list().map(entry => entry.name).sort(), ['proof']);
    assert.deepEqual(api.listBranches().map(entry => entry.name).sort(), ['proof']);
    const retained = path.join(td, '.narova-internal', 'publication-backups');
    assert.ok(fs.readdirSync(retained).some(name => name.startsWith('release-proof-')),
      'failed cleanup retains the old release only in Narova internal storage');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('publication backup setup failure does not strand branch locks', async () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-backup-setup-'));
  const manifest = path.join(tmp, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ narova: 'x', project: {} }));
  try {
    const api = releases();
    await api.save(manifest, 'proof');
    api.saveBranch('proof', { status: 'approved', rationale: 'old' });
    await api.save(manifest, 'stage');
    api.saveBranch('stage', { status: 'candidate', rationale: 'new' });
    const backupPath = path.join(td, '.narova-internal', 'publication-backups');
    fs.writeFileSync(backupPath, 'not a directory');
    assert.throws(() => api.publishStagedBranch('stage', 'proof'));
    api.setBranchStatus('proof', 'candidate');
    api.setBranchStatus('stage', 'approved');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('branch metadata stays external while authored files named branch.json and .narova-branch restore', async () => {
  const td = tempReleasesDir();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-proof-'));
  const restored = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-proof-restored-'));
  const out = path.join(project, 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(path.join(project, '.narova-branch'), { recursive: true });
  fs.writeFileSync(path.join(project, 'branch.json'), '{"authored":true}');
  fs.writeFileSync(path.join(project, '.narova-branch', 'body.html'), '<p>authored source</p>');
  fs.writeFileSync(path.join(project, 'reel.config.mjs'), `export default {
    imports: { authored: 'branch.json' },
    scenes: [{ id: 'proof', dur: 2, vo: [], bodyFile: '.narova-branch/body.html' }],
  };`);
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ narova: 'x', project: {} }));
  try {
    const api = releases();
    const saved = await api.save(path.join(out, 'manifest.json'), 'proof', { projectDir: project });
    const evidenceDir = path.join(api.branchDir('proof'), 'evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'contact-sheet-01.jpg'), 'proof');
    api.saveBranch('proof', {
      status: 'approved', rationale: 'The proof resolves the risky transformation.',
      evidence: ['evidence/contact-sheet-01.jpg'],
    });
    api.restore('proof', restored, { newProject: restored });
    assert.equal(fs.readFileSync(path.join(restored, 'branch.json'), 'utf8'), '{"authored":true}');
    assert.equal(fs.readFileSync(path.join(restored, '.narova-branch', 'body.html'), 'utf8'), '<p>authored source</p>');
    assert.equal(fs.existsSync(path.join(restored, '.branches')), false);
    assert.equal(fs.existsSync(path.join(api.branchDir('proof'), 'evidence', 'contact-sheet-01.jpg')), true);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(restored, { recursive: true, force: true });
    cleanup(td);
  }
});

test('save -> mutate/delete -> restore round-trips modular source files (bodyFile, cssFile, scriptFile, threeModule, imports)', async () => {
  const td = tempReleasesDir();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-project-'));
  const out = path.join(project, 'out');
  fs.mkdirSync(out, { recursive: true });
  // Modular source files at project-relative paths (incl. a nested dir).
  fs.mkdirSync(path.join(project, 'scenes'), { recursive: true });
  fs.writeFileSync(path.join(project, 'scenes', 'body.html'), '<p>ORIGINAL BODY</p>');
  fs.writeFileSync(path.join(project, 'scenes', 'style.css'), '.x{color:#original}');
  fs.writeFileSync(path.join(project, 'scenes', 'script.js'), 'tl.to("#a",{duration:1},_scStart);');
  fs.writeFileSync(path.join(project, 'scenes', 'three.js'), 'renderer.render(scene,camera);');
  fs.writeFileSync(path.join(project, 'shared.js'), 'window.shared=true;');
  // reel.config.mjs (ESM export default) — the default filename, which the old
  // regex pseudo-parser could not read reliably.
  fs.writeFileSync(path.join(project, 'reel.config.mjs'),
    `export default {\n  title: 'Mod', size: '16:9',\n  voices: { a: { backend: 'piper', speaker: 'x', color: '#0ff', label: 'A' } },\n  imports: { shared: 'shared.js' },\n  scenes: [\n    { id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }],\n      bodyFile: 'scenes/body.html', cssFile: 'scenes/style.css',\n      scriptFile: 'scenes/script.js', threeModule: 'scenes/three.js' }\n  ],\n};\n`);
  try {
    const { resolveConfig } = require('../src/schema');
    const { compile } = require('../src/manifest');
    // Build the manifest via the real resolver so it is realistic.
    const manifest = compile(resolveConfig({
      title: 'Mod', size: '16:9',
      voices: { a: { backend: 'piper', speaker: 'x', color: '#0ff', label: 'A' } },
      imports: { shared: 'shared.js' },
      scenes: [{
        id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }],
        bodyFile: 'scenes/body.html', cssFile: 'scenes/style.css',
        scriptFile: 'scenes/script.js', threeModule: 'scenes/three.js',
      }],
    }, {}, project), { toolVersion: '0.26.0' });
    fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest));

    // 1) save
    await releases().save(path.join(out, 'manifest.json'), 'modular', { projectDir: project });

    // 2) mutate + delete the source files (simulate the user editing/losing them)
    fs.writeFileSync(path.join(project, 'scenes', 'body.html'), '<p>MUTATED</p>');
    fs.writeFileSync(path.join(project, 'scenes', 'style.css'), '.x{color:#mutated}');
    fs.rmSync(path.join(project, 'scenes', 'script.js'));
    fs.rmSync(path.join(project, 'scenes', 'three.js'));
    fs.rmSync(path.join(project, 'shared.js'));

    // 3) restore into the SAME project (--overwrite so mutated files are replaced)
    releases().restore('modular', out, { projectDir: project, overwrite: true });

    // 4) the restored config must resolve and see the ORIGINAL contents at the
    //    original project-relative paths (not under a source/ prefix).
    const resolved = resolveConfig({
      title: 'Mod', size: '16:9',
      voices: { a: { backend: 'piper', speaker: 'x', color: '#0ff', label: 'A' } },
      imports: { shared: 'shared.js' },
      scenes: [{
        id: 's1', dur: 2, vo: [{ who: 'a', text: 'One.' }],
        bodyFile: 'scenes/body.html', cssFile: 'scenes/style.css',
        scriptFile: 'scenes/script.js', threeModule: 'scenes/three.js',
      }],
    }, {}, project);
    assert.equal(resolved.scenes[0].body, '<p>ORIGINAL BODY</p>', 'bodyFile restored to original');
    assert.equal(resolved.scenes[0]._cssFileContents, '.x{color:#original}', 'cssFile restored');
    assert.equal(resolved.scenes[0]._scriptFileContents, 'tl.to("#a",{duration:1},_scStart);', 'scriptFile restored');
    assert.equal(resolved.scenes[0]._threeModuleContents, 'renderer.render(scene,camera);', 'threeModule restored');
    assert.equal(resolved.imports.shared.contents, 'window.shared=true;', 'import restored');
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    cleanup(td);
  }
});
