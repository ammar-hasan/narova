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

/* isInside: true if `child` resolves strictly under `parent`. */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..';
}

function findConfigInDir(dir) {
  for (const name of ['reel.config.mjs', 'reel.config.js', 'reel.config.json', 'reel.config.cjs']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
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
 * Returns { name, dir, created, files }.
 *
 * Async because scene file references are discovered by loading the config
 * through the SAME real loader the build uses (config.loadConfigFile, which
 * handles ESM/CJS/JSON) — never a second regex-based pseudo-parser. */
async function save(manifestPath, name, opts = {}) {
  const finalReleaseDir = releasePath(name);
  const safeName = path.basename(finalReleaseDir);
  // Build a complete fresh snapshot beside the existing release. Publishing
  // by rename prevents removed source files from surviving a same-name save.
  const releaseDir = fs.mkdtempSync(path.join(ensureDir(), `.${safeName}-staging-`));
  try {

  const manifestSrc = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'manifest.json'), manifestSrc, 'utf8');

  const outDir = path.dirname(manifestPath);
  const saved = ['manifest.json'];

  // Save audio/timeline identities + timings so --reuse and measured release
  // checks remain trustworthy after restore.
  for (const fname of ['.audio-fingerprint', '.timings-fingerprint', 'timings.json']) {
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

    // Scene file references + imports: snapshot every project-relative source
    // file referenced by the config (bodyFile, cssFile, choreographyFile,
    // scriptFile, threeFile, threeModule, elementsFile, visualFile, and
    // config.imports). We load the config with the real loader (config.js —
    // same code path as `narova build`) to discover the paths.
    //
    // Files are written at their ORIGINAL project-relative path under the
    // release dir (e.g. releaseDir/scenes/intro.html, NOT
    // releaseDir/source/scenes/intro.html). restore() copies each release-dir
    // entry back to the project root, so the project-relative path round-trips
    // exactly and the restored config can resolve its file refs again.
    try {
      const configFile = findConfigInDir(projectDir);
      if (configFile) {
        const { loadConfigFile } = require('./config');
        const raw = await loadConfigFile(configFile);
        const snapshotRef = ref => {
          if (typeof ref !== 'string' || !ref.trim() || /^(?:https?:)?\/\//i.test(ref) || path.isAbsolute(ref)) return;
          const refPath = path.resolve(projectDir, ref);
          if (!isInside(projectDir, refPath) || !fs.existsSync(refPath) || !fs.statSync(refPath).isFile()) return;
          const dest = path.join(releaseDir, ref);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(refPath, dest);
          if (!saved.includes(ref)) saved.push(ref);
        };
        const sceneRefKeys = ['bodyFile', 'cssFile', 'choreographyFile', 'scriptFile',
          'threeFile', 'threeModule', 'elementsFile', 'visualFile'];
        if (raw && Array.isArray(raw.scenes)) {
          for (const s of raw.scenes) {
            for (const key of sceneRefKeys) {
              if (typeof s[key] !== 'string' || !s[key].trim()) continue;
              snapshotRef(s[key]);
            }
            snapshotRef(s.clip);
            if (s.three) {
              const env = typeof s.three.envMap === 'string' ? s.three.envMap : s.three.envMap?.src;
              snapshotRef(env);
              const visit = obj => {
                snapshotRef(obj && obj.src);
                for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'texture']) snapshotRef(obj && obj[key]);
                for (const child of (obj && obj.children || [])) visit(child);
              };
              for (const obj of (s.three.objects || [])) visit(obj);
            }
          }
        }
        if (raw && raw.imports && typeof raw.imports === 'object' && !Array.isArray(raw.imports)) {
          for (const ref of Object.values(raw.imports)) {
            if (typeof ref !== 'string' || !ref.trim()) continue;
            snapshotRef(ref);
          }
        }
        // Custom asset roots preserve their original project-relative name.
        if (typeof raw.assets === 'string') {
          const assetRoot = path.resolve(projectDir, raw.assets);
          if (isInside(projectDir, assetRoot) && fs.existsSync(assetRoot) && fs.statSync(assetRoot).isDirectory()) {
            copyDir(assetRoot, path.join(releaseDir, raw.assets));
            if (!saved.includes(raw.assets + '/')) saved.push(raw.assets + '/');
          }
        }
        const bed = raw.bed || raw.music;
        snapshotRef(typeof bed === 'string' ? bed : bed && bed.file);
        for (const fx of (raw.sfx || [])) snapshotRef(typeof fx === 'string' ? fx : fx.file);
        if (raw.narration && typeof raw.narration === 'object') {
          snapshotRef(raw.narration.file);
          snapshotRef(raw.narration.wordTimings);
        }
        for (const character of Object.values(raw.characters || {})) {
          snapshotRef(character && (character.model || character.src));
        }
      }
    } catch { /* best-effort */ }
  }

  if (fs.existsSync(finalReleaseDir)) rmDir(finalReleaseDir);
  fs.renameSync(releaseDir, finalReleaseDir);
  return { name: safeName, dir: finalReleaseDir, created: new Date().toISOString(), files: saved };
  } catch (error) {
    try { rmDir(releaseDir); } catch {}
    throw error;
  }
}

/* Save branch metadata alongside a release. Branches extend releases with
 * creative rationale, status tracking, and parentage — enabling the workflow:
 * "bring back the surreal concept," "take B's visuals + A's narration," etc.
 *
 * branch.json shape:
 *   { rationale, status, parent, created }
 *   status: exploring | candidate | approved | rejected | archived
 *   parent: optional branch name this was derived from */
const BRANCH_STATUSES = new Set(['exploring', 'candidate', 'approved', 'rejected', 'archived']);

function validBranchStatus(status) {
  if (!BRANCH_STATUSES.has(status)) throw new Error(`invalid branch status "${status}" (expected ${[...BRANCH_STATUSES].join('|')})`);
  return status;
}

function saveBranch(name, meta = {}) {
  const releaseDir = releasePath(name);
  if (!fs.existsSync(releaseDir)) throw new Error(`release "${name}" not found — save it first`);
  const branch = {
    created: new Date().toISOString(),
    rationale: meta.rationale || '',
    status: validBranchStatus(meta.status || 'exploring'),
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
  branch.status = validBranchStatus(status);
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

  // Restore fingerprints and timings to the output directory (not project root).
  for (const fname of ['.audio-fingerprint', '.timings-fingerprint', 'timings.json']) {
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
    if (['.audio-fingerprint', '.timings-fingerprint', 'timings.json'].includes(entry.name)) continue;
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
