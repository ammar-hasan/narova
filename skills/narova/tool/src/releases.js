'use strict';
/* Named release management: save, list, restore project snapshots.

 * Each release is a directory under RELEASES_DIR/<name>/ containing:
 *   manifest.json     — the versioned intermediate representation
 *   reel.config.mjs   — original config (preserves original filename)
 *   theme.css         — project theme stylesheet (if present)
 *   assets/           — project asset tree (if present)
 *   claims.md         — claims ledger (if present)
 *   sources.md        — source reference (if present)

 * Restore writes everything back to the project directory. Policies:
 *   --overwrite  replace existing files (default: skip)
 *   --merge      merge assets directories (default: skip dirs)
 *   --new-project <dir>  restore into a fresh directory
 *   --dry-run    print what would happen without writing */

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

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) rmDir(p);
    else fs.unlinkSync(p);
  }
  fs.rmdirSync(dir);
}

/* Resolve the project root the same way other commands do — walk up from
 * the given directory to find reel.config.*. Falls back to the directory
 * itself when no config file is found. */
function resolveProjectDir(fromDir) {
  // Dynamic require to avoid circular deps at module load time.
  const { loadConfigFile } = require('./config');
  let dir = path.resolve(fromDir);
  for (let i = 0; i < 16; i++) {
    for (const name of ['reel.config.mjs', 'reel.config.js', 'reel.config.json', 'reel.config.cjs']) {
      if (fs.existsSync(path.join(dir, name))) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(fromDir); // fallback: use the given dir
}

/* Snapshot a project: copies manifest + config + theme + assets + ledgers
 * + audio fingerprint and timings (so --reuse works after restore).
 * Returns { name, dir, created, files }. */
function save(manifestPath, name, opts = {}) {
  const releaseDir = releasePath(name);
  fs.mkdirSync(releaseDir, { recursive: true });

  const manifestSrc = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'manifest.json'), manifestSrc, 'utf8');

  const outDir = path.dirname(manifestPath);
  const safeName = path.basename(releaseDir);
  const saved = ['manifest.json'];

  // Save audio fingerprint + timings so --reuse works after restore.
  // These are small text files; saving them avoids a full re-synth.
  for (const fname of ['.audio-fingerprint', 'timings.json']) {
    const src = path.join(outDir, fname);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(releaseDir, fname));
      saved.push(fname);
    }
  }

  // Resolve the project root properly.
  const projectDir = opts.projectDir
    ? resolveProjectDir(opts.projectDir)
    : resolveProjectDir(path.resolve(path.dirname(manifestPath), '..'));

  if (projectDir && fs.existsSync(projectDir)) {
    // Preserve original config filename.
    for (const fname of ['reel.config.mjs', 'reel.config.js', 'reel.config.json', 'reel.config.cjs']) {
      const cf = path.join(projectDir, fname);
      if (fs.existsSync(cf)) {
        fs.copyFileSync(cf, path.join(releaseDir, fname));
        saved.push(fname);
        break;
      }
    }
    // theme.css
    const themeFile = path.join(projectDir, 'theme.css');
    if (fs.existsSync(themeFile)) {
      fs.copyFileSync(themeFile, path.join(releaseDir, 'theme.css'));
      saved.push('theme.css');
    }
    // assets directory
    const assetsDir = path.join(projectDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      copyDir(assetsDir, path.join(releaseDir, 'assets'));
      saved.push('assets/');
    }
    // ledgers
    for (const ledger of ['claims.md', 'sources.md']) {
      const lf = path.join(projectDir, ledger);
      if (fs.existsSync(lf)) {
        fs.copyFileSync(lf, path.join(releaseDir, ledger));
        saved.push(ledger);
      }
    }
  }

  return { name: safeName, dir: releaseDir, created: new Date().toISOString(), files: saved };
}

/* Save branch metadata alongside a release. Branches extend releases with
 * creative rationale, status tracking, and parentage — enabling the workflow:
 * "bring back the surreal concept," "take B's visuals + A's narration," etc.
 *
 * branch.json shape:
 *   { rationale, status, parent, created }
 *   status: exploring | candidate | approved | rejected | archived
 *   parent: optional branch name this was derived from */
function saveBranch(name, meta = {}) {
  const releaseDir = releasePath(name);
  if (!fs.existsSync(releaseDir)) throw new Error(`release "${name}" not found — save it first`);
  const branch = {
    created: new Date().toISOString(),
    rationale: meta.rationale || '',
    status: meta.status || 'exploring',
    ...(meta.parent ? { parent: meta.parent } : {}),
  };
  fs.writeFileSync(path.join(releaseDir, 'branch.json'), JSON.stringify(branch, null, 2));
  return branch;
}

/* Read branch metadata from a release, if present. */
function readBranch(name) {
  const bp = path.join(releasePath(name), 'branch.json');
  if (!fs.existsSync(bp)) return null;
  return JSON.parse(fs.readFileSync(bp, 'utf8'));
}

/* List all releases with branch metadata included. */
function listBranches() {
  return list().map(entry => {
    const branch = readBranch(entry.name);
    return branch ? { ...entry, branch } : entry;
  });
}

/* Update the status of an existing branch. */
function setBranchStatus(name, status) {
  const branch = readBranch(name);
  if (!branch) throw new Error(`branch "${name}" not found`);
  branch.status = status;
  branch.updated = new Date().toISOString();
  fs.writeFileSync(path.join(releasePath(name), 'branch.json'), JSON.stringify(branch, null, 2));
  return branch;
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
 * root (resolved via resolveProjectDir, not guessed from out/).

 * Policies (set via opts):
 *   overwrite: true → replace existing files
 *   newProject: <dir> → restore into a fresh directory instead
 *   dryRun: true → log what would happen without writing */
function restore(name, destDir, opts = {}) {
  const srcDir = releasePath(name);
  if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
    throw new Error(`release not found: ${name}`);
  }
  const manifestSrc = path.join(srcDir, 'manifest.json');
  if (!fs.existsSync(manifestSrc)) throw new Error(`release "${name}" has no manifest.json`);

  const overwrite = opts.overwrite === true;
  const dryRun = opts.dryRun === true;
  const log = opts.log || console.log;

  const projectDir = opts.newProject
    ? path.resolve(opts.newProject)
    : opts.projectDir
      ? resolveProjectDir(opts.projectDir)
      : resolveProjectDir(path.resolve(destDir, '..'));

  // For new-project restore, put the manifest in the new project's out/.
  const manifestDestDir = opts.newProject ? path.join(projectDir, 'out') : destDir;
  if (!dryRun) fs.mkdirSync(manifestDestDir, { recursive: true });
  const manifestDest = path.join(manifestDestDir, 'manifest.json');
  if (!dryRun) fs.copyFileSync(manifestSrc, manifestDest);

  // Ensure the project directory exists before copying source files.
  if (!dryRun && !fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  const results = { manifest: manifestDest, restored: [], skipped: [], conflicts: [] };

  // Restore audio fingerprint and timings to the output directory (not project root).
  for (const fname of ['.audio-fingerprint', 'timings.json']) {
    const src = path.join(srcDir, fname);
    const dest = path.join(manifestDestDir, fname);
    if (fs.existsSync(src)) {
      if (!dryRun) {
        fs.mkdirSync(manifestDestDir, { recursive: true });
        fs.copyFileSync(src, dest);
      }
      results.restored.push(fname);
    }
  }

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') continue;
    if (entry.name === '.audio-fingerprint' || entry.name === 'timings.json') continue;
    const src = path.join(srcDir, entry.name);
    const dest = path.join(projectDir, entry.name);

    if (entry.isDirectory()) {
      if (fs.existsSync(dest)) {
        results.conflicts.push(entry.name + '/');
        if (!overwrite) continue;
      }
      if (!dryRun) {
        if (overwrite && fs.existsSync(dest)) rmDir(dest);
        copyDir(src, dest);
      }
    } else {
      if (fs.existsSync(dest)) {
        results.conflicts.push(entry.name);
        if (!overwrite) continue;
      }
      if (!dryRun) fs.copyFileSync(src, dest);
    }
    results.restored.push(entry.name);
  }

  if (dryRun) {
    log(`dry-run: would restore ${results.restored.length} file(s) to ${projectDir}`);
    if (results.conflicts.length) log(`  conflicts (skipped without --overwrite): ${results.conflicts.join(', ')}`);
  } else {
    if (results.conflicts.length) log(`  skipped ${results.conflicts.length} existing file(s) (use --overwrite to replace): ${results.conflicts.join(', ')}`);
  }

  return results;
}

function remove(name) {
  const p = releasePath(name);
  if (!fs.existsSync(p)) throw new Error(`release not found: ${name}`);
  rmDir(p);
  return p;
}

module.exports = { save, list, restore, remove, RELEASES_DIR, releasePath, resolveProjectDir, saveBranch, readBranch, listBranches, setBranchStatus };
