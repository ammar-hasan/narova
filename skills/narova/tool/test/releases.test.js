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
  // Bust require cache so module picks up the env var
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

test('save creates a named release file', () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', version: '1.0', test: true }));
  try {
    const r = releases().save(mp, 'my-build-1');
    assert.equal(r.name, 'my-build-1');
    assert.ok(fs.existsSync(r.path));
    const content = JSON.parse(fs.readFileSync(r.path, 'utf8'));
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
  fs.writeFileSync(mp, JSON.stringify({ test: true }));
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
  fs.writeFileSync(mp, JSON.stringify({ narova: '0.8.2', restored: true }));
  const destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-restore-'));
  try {
    releases().save(mp, 'restore-test');
    const dest = releases().restore('restore-test', destDir);
    assert.ok(fs.existsSync(dest));
    const content = JSON.parse(fs.readFileSync(dest, 'utf8'));
    assert.equal(content.restored, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(destDir, { recursive: true, force: true });
    cleanup(td);
  }
});

test('remove deletes a release', () => {
  const td = tempReleasesDir();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rel-'));
  const mp = path.join(tmp, 'manifest.json');
  fs.writeFileSync(mp, JSON.stringify({ test: true }));
  try {
    releases().save(mp, 'remove-test');
    const p = releases().remove('remove-test');
    assert.ok(!fs.existsSync(p));
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
  fs.writeFileSync(mp, JSON.stringify({ test: true }));
  try {
    const r = releases().save(mp, 'my build v1.0 (final)!');
    assert.equal(r.name, 'mybuildv1.0final');
    assert.ok(fs.existsSync(r.path));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    cleanup(td);
  }
});
