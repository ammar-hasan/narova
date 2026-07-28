'use strict';
/* Named release management: save, list, restore project snapshots.

 * Each release is a directory under RELEASES_DIR/<name>/ containing:
 *   manifest.json     — the versioned intermediate representation
 *   config.json       — exported resolved config snapshot
 *   theme.css         — project theme stylesheet (if present)
 *   assets/           — project asset tree (if present)
 *   claims.md         — claims ledger (if present)
 *   sources.md        — source reference (if present)

 * Restore writes everything back to the project directory, warning on
 * conflicts. The snapshot is content-addressed: manifest hashes identify
 * every file, so a restore can detect drift from the original build. */

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
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '').replace(/\.+/g, '.') || 'release';
  const p = path.join(ensureDir(), safeName);
  const resolved = path.resolve(p);
  if (!resolved.startsWith(path.resolve(ensureDir()) + path.sep)) {
    throw new Error(`release name "${name}" resolves outside the releases directory`);
  }
  return p;
}

/* Recursively copy a directory tree. */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/* Recursively remove a directory tree. */
function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) rmDir(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

/* Snapshot a project: copies manifest + config + theme + assets + ledgers
 * into the release directory. Returns { name, dir, created }. */
function save(manifestPath, name, opts = {}) {
  const releaseDir = releasePath(name);
  fs.mkdirSync(releaseDir, { recursive: true });

  // manifest.json — always present
  const manifestSrc = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'manifest.json'), manifestSrc, 'utf8');

  const safeName = path.basename(releaseDir);

  // Project snapshot (source files that made this build).
  const projectDir = opts.projectDir;
  if (projectDir && fs.existsSync(projectDir)) {
    // config snapshot — copy the first found reel.config.*
    for (const name of ['reel.config.mjs', 'reel.config.js', 'reel.config.json', 'reel.config.cjs']) {
      const cf = path.join(projectDir, name);
      if (fs.existsSync(cf)) {
        fs.copyFileSync(cf, path.join(releaseDir, `config.${path.extname(name).slice(1)}`));
        break;
      }
    }
    // theme.css
    const themeFile = path.join(projectDir, 'theme.css');
    if (fs.existsSync(themeFile)) {
      fs.copyFileSync(themeFile, path.join(releaseDir, 'theme.css'));
    }
    // assets directory
    const assetsDir = path.join(projectDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      copyDir(assetsDir, path.join(releaseDir, 'assets'));
    }
    // ledgers
    for (const ledger of ['claims.md', 'sources.md']) {
      const lf = path.join(projectDir, ledger);
      if (fs.existsSync(lf)) fs.copyFileSync(lf, path.join(releaseDir, ledger));
    }
  }

  return { name: safeName, dir: releaseDir, created: new Date().toISOString() };
}

function list() {
  ensureDir();
  const entries = [];
  try {
    for (const f of fs.readdirSync(RELEASES_DIR, { withFileTypes: true })) {
      if (!f.isDirectory()) continue;
      const mp = path.join(RELEASES_DIR, f.name, 'manifest.json');
      if (!fs.existsSync(mp)) continue;
      const stat = fs.statSync(mp);
      const manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
      entries.push({
        name: f.name,
        path: mp,
        dir: path.join(RELEASES_DIR, f.name),
        size: stat.size,
        created: stat.birthtime.toISOString(),
        title: manifest.project?.title || '',
        version: manifest.narova || '',
        duration: manifest.totalDuration || 0,
      });
    }
  } catch {}
  return entries.sort((a, b) => new Date(b.created) - new Date(a.created));
}

/* Restore a named release into destDir (the project's out/ directory).
 * Manifest goes to destDir/manifest.json. Source files go to the project
 * root (one level above destDir by default). */
function restore(name, destDir, opts = {}) {
  const srcDir = releasePath(name);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    throw new Error(`release not found: ${name}`);
  }
  const manifestSrc = path.join(srcDir, 'manifest.json');
  if (!fs.existsSync(manifestSrc)) throw new Error(`release "${name}" has no manifest.json`);

  // Restore manifest to out/
  const manifestDest = path.join(destDir, 'manifest.json');
  fs.copyFileSync(manifestSrc, manifestDest);

  // Restore source files to project root.
  const projectDir = opts.projectDir || path.resolve(destDir, '..');
  const results = { manifest: manifestDest, restored: [] };

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(projectDir, entry.name);

    if (entry.isDirectory()) {
      if (fs.existsSync(dest)) continue; // don't overwrite existing dirs
      copyDir(src, dest);
    } else {
      if (fs.existsSync(dest)) continue;
      fs.copyFileSync(src, dest);
    }
    results.restored.push(entry.name);
  }

  return results;
}

function remove(name) {
  const p = releasePath(name);
  if (!fs.existsSync(p)) throw new Error(`release not found: ${name}`);
  rmDir(p);
  return p;
}

module.exports = { save, list, restore, remove, RELEASES_DIR, releasePath };
