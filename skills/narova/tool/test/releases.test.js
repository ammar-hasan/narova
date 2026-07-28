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

test('save creates a named release directory with manifest.json', () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, test: true }));
  try {
    const r = releases().save(mp, 'my-build-1');
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

test('list returns saved releases', () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, test: true }));
  try {
    releases().save(mp, 'release-list-test');
    const entries = releases().list();
    assert.ok(entries.length > 0);
    assert.ok(entries.some(e => e.name === 'release-list-test'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});

test('restore writes manifest to destination', () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, restored: true }));
  const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-restore-'));
  try {
    releases().save(mp, 'restore-test');
    const result = releases().restore('restore-test', destDir);
    assert.ok(fs.existsSync(result.manifest), 'manifest restored');
    const content = JSON.parse(fs.readFileSync(result.manifest, 'utf8'));
    assert.equal(content.restored, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(destDir, { recursive: true, force: true });
    cleanup(td);
  }
});

test('remove deletes a release directory', () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, test: true }));
  try {
    releases().save(mp, 'remove-test');
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

test('save sanitizes name with invalid characters', () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', project: { title: 'Test' }, test: true }));
  try {
    const r = releases().save(mp, 'my build v1.0 (final)!');
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
