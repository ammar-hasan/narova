'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
  } finally {
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
