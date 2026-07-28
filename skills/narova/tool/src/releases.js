'use strict';
/* Named release management: save, list, restore narova manifests. */

const fs = require('fs');
const path = require('path');
const os = require('os');

const RELEASES_DIR = process.env.NAROVA_RELEASES_DIR
  || path.join(process.env.NAROVA_HOME || path.join(os.homedir(), '.narova'), 'releases');

function ensureDir() {
  if (!fs.existsSync(RELEASES_DIR)) fs.mkdirSync(RELEASES_DIR, { recursive: true });
  return RELEASES_DIR;
}

function releasePath(name) {
  return path.join(ensureDir(), `${name}.manifest.json`);
}

function save(manifestPath, name) {
  const src = fs.readFileSync(manifestPath, 'utf8');
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '').replace(/\.+/g, '.') || 'release';
  const dest = releasePath(safeName);
  fs.writeFileSync(dest, src, 'utf8');
  return { name: safeName, path: dest, created: new Date().toISOString() };
}

function list() {
  ensureDir();
  const entries = [];
  try {
    for (const f of fs.readdirSync(RELEASES_DIR)) {
      if (!f.endsWith('.manifest.json')) continue;
      const fp = path.join(RELEASES_DIR, f);
      const stat = fs.statSync(fp);
      const name = f.replace(/\.manifest\.json$/, '');
      entries.push({ name, path: fp, size: stat.size, created: stat.birthtime.toISOString() });
    }
  } catch {}
  return entries.sort((a, b) => new Date(b.created) - new Date(a.created));
}

function restore(name, destDir) {
  const src = releasePath(name);
  if (!fs.existsSync(src)) throw new Error(`release not found: ${name}`);
  const dest = path.join(destDir, 'manifest.json');
  fs.copyFileSync(src, dest);
  return dest;
}

function remove(name) {
  const p = releasePath(name);
  if (!fs.existsSync(p)) throw new Error(`release not found: ${name}`);
  fs.unlinkSync(p);
  return p;
}

module.exports = { save, list, restore, remove, RELEASES_DIR };
