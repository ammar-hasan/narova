'use strict';
/* Named release management: save, list, restore project snapshots.

 * Each release is a directory under RELEASES_DIR/<name>/ containing:
 *   manifest.json     — the versioned intermediate representation
 *   reel.config.mjs   — original config (preserves original filename)
 *   theme.css         — project theme stylesheet (if present)
 *   assets/           — project asset tree (if present)
 *   claims.md         — claims ledger (if present)
 *   sources.md        — source reference (if present)
 *   assets.lock.json  — creative-asset provenance (if present)

 * Restore writes everything back to the project directory. Policies:
 *   --overwrite  replace existing files (default: skip)
 *   --merge      merge assets directories (default: skip dirs)
 *   --new-project <dir>  restore into a fresh directory
 *   --dry-run    print what would happen without writing */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const {
  lockPath: assetLockPath, readAssetLock, resolveProjectFile, sha256File,
  verifyAssets, withAssetMutation,
} = require('./asset-registry');

const RELEASES_DIR = process.env.NAROVA_RELEASES_DIR
  || path.join(process.env.NAROVA_HOME || path.join(os.homedir(), '.narova'), 'releases');
const BRANCHES_DIR = path.join(RELEASES_DIR, '.branches');
const INTERNAL_DIR = path.join(RELEASES_DIR, '.narova-internal');
const LOCKS_DIR = path.join(INTERNAL_DIR, 'branch-locks');
const PROCESS_DIR = path.join(INTERNAL_DIR, 'processes');
const PUBLICATION_BACKUPS_DIR = path.join(INTERNAL_DIR, 'publication-backups');
const RESTORE_MARKER = '.restored-manifest.json';
const RESTORE_OVERRIDES = '.restored-overrides.json';

function ensureDir() {
  if (!fs.existsSync(RELEASES_DIR)) fs.mkdirSync(RELEASES_DIR, { recursive: true });
  return RELEASES_DIR;
}

function releasePath(name) {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '').replace(/\.+/g, '.') || 'release';
  // Default macOS and Windows filesystems compare names case-insensitively;
  // Windows also ignores trailing dots. Reject those aliases explicitly even
  // when this code is tested from a case-sensitive volume.
  const filesystemName = safeName.toLowerCase().replace(/[. ]+$/g, '');
  const reservedNames = [path.basename(BRANCHES_DIR), path.basename(INTERNAL_DIR)]
    .map(value => value.toLowerCase().replace(/[. ]+$/g, ''));
  if (reservedNames.includes(filesystemName)) {
    throw new Error(`release name "${name}" is reserved for Narova internals`);
  }
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

/* Branch names live in one user-wide store, so a name alone cannot establish
 * which project produced a proof. Bind proof metadata to the canonical project
 * root without exposing the local path in branch.json. Moving a project
 * intentionally invalidates its old proof selection; save a fresh branch from
 * the new root so rendered evidence cannot be borrowed across projects. */
function projectIdentity(projectDir) {
  const resolved = resolveProjectDir(projectDir || '.');
  let canonical = path.resolve(resolved);
  try { canonical = fs.realpathSync.native(canonical); } catch { /* use resolved path */ }
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function branchLockFile(name) {
  const safeName = path.basename(releasePath(name));
  fs.mkdirSync(LOCKS_DIR, { recursive: true });
  return path.join(LOCKS_DIR, `${safeName}.lock`);
}

function lockOwnerAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    return true;
  }
}

function osProcessStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterCommand = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
    if (afterCommand[19]) return `proc:${afterCommand[19]}`;
  } catch { /* macOS and other non-/proc systems use ps below */ }
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
    encoding: 'utf8', timeout: 2_000,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
  });
  const started = result.status === 0 ? String(result.stdout || '').trim() : '';
  return started ? `ps:${started}` : null;
}

let currentProcessIdentity = null;
function registerCurrentProcessIdentity() {
  if (currentProcessIdentity) return currentProcessIdentity;
  currentProcessIdentity = osProcessStartIdentity(process.pid)
    || `node:${process.pid}:${Math.round(Date.now() - process.uptime() * 1000)}:${crypto.randomBytes(12).toString('hex')}`;
  fs.mkdirSync(PROCESS_DIR, { recursive: true });
  const file = path.join(PROCESS_DIR, `${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, started: currentProcessIdentity }));
  return currentProcessIdentity;
}

function processStartIdentity(pid) {
  const native = osProcessStartIdentity(pid);
  if (native) return native;
  try {
    const registered = JSON.parse(fs.readFileSync(path.join(PROCESS_DIR, `${pid}.json`), 'utf8'));
    if (registered.pid === pid && typeof registered.started === 'string' && registered.started) return registered.started;
  } catch {}
  return null;
}

function intentOwnerAlive(owner) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0
      || typeof owner.nonce !== 'string' || !owner.nonce
      || typeof owner.started !== 'string' || !owner.started) return null;
  if (lockOwnerAlive(owner.pid) === false) return false;
  const currentStart = processStartIdentity(owner.pid);
  // Unsupported/denied OS identity lookup fails closed for a syntactically
  // valid live owner. Narova peers still compare through the process registry.
  if (!currentStart) return true;
  return currentStart === owner.started;
}

/* Every mutation publishes a unique intent. There is no replaceable shared
 * owner or reclaimer path: contenders can delete only a dead process's
 * unguessable intent filename. If two live contenders overlap, one may win or
 * both may fail, but they can never both enter the mutation section. */
function acquireBranchLock(name) {
  const safeName = path.basename(releasePath(name));
  const lockDir = branchLockFile(name);
  fs.mkdirSync(lockDir, { recursive: true });
  const nonce = crypto.randomBytes(12).toString('hex');
  const ownIntent = path.join(lockDir, `intent-${process.pid}-${nonce}.json`);
  const token = JSON.stringify({ pid: process.pid, nonce, started: registerCurrentProcessIdentity() });
  fs.writeFileSync(ownIntent, token, { flag: 'wx' });
  const release = () => { try { fs.rmSync(ownIntent, { force: true }); } catch {} };
  try {
    for (const entry of fs.readdirSync(lockDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(lockDir, entry.name);
      if (file === ownIntent) continue;
      let stale = false;
      try {
        const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
        const alive = intentOwnerAlive(owner);
        stale = alive === false || (alive == null && Date.now() - fs.statSync(file).mtimeMs > 60_000);
      } catch {
        try { stale = Date.now() - fs.statSync(file).mtimeMs > 60_000; } catch { continue; }
      }
      if (stale) {
        // This pathname contains a random nonce and is never reused, so
        // removing it cannot target a replacement live owner's intent.
        fs.rmSync(file, { force: true });
      } else {
        throw new Error(`branch "${safeName}" is being changed by another process`);
      }
    }
    // Close the scan/create race: any contender that appeared after our first
    // scan is live and must cause this attempt to fail. Later contenders see
    // our own live intent and fail in turn.
    const peers = fs.readdirSync(lockDir).filter(entry => path.join(lockDir, entry) !== ownIntent);
    if (peers.length) throw new Error(`branch "${safeName}" is being changed by another process`);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

function acquireBranchLocks(names) {
  const ordered = [...new Set(names)].sort((a, b) => branchLockFile(a).localeCompare(branchLockFile(b)));
  const releases = [];
  try {
    for (const name of ordered) releases.push(acquireBranchLock(name));
  } catch (error) {
    for (const release of releases.reverse()) release();
    throw error;
  }
  return () => { for (const release of releases.reverse()) release(); };
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
  const expectedRevision = branchRevision(name);
  // Build a complete fresh snapshot beside the existing release. Publishing
  // by rename prevents removed source files from surviving a same-name save.
  const releaseDir = fs.mkdtempSync(path.join(ensureDir(), `.${safeName}-staging-`));
  try {

  const manifestSrc = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(path.join(releaseDir, 'manifest.json'), manifestSrc, 'utf8');

  const outDir = path.dirname(manifestPath);
  const saved = ['manifest.json'];

  const resolvedOverrides = opts.resolvedOverrides && typeof opts.resolvedOverrides === 'object'
    ? opts.resolvedOverrides : {};
  if (Object.keys(resolvedOverrides).length) {
    fs.writeFileSync(path.join(releaseDir, RESTORE_OVERRIDES), JSON.stringify(resolvedOverrides, null, 2));
    saved.push(RESTORE_OVERRIDES);
  }

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
    let assetLock = null;
    if (fs.existsSync(assetLockPath(projectDir))) {
      assetLock = readAssetLock(projectDir, { missingOk: false });
      const report = verifyAssets(projectDir);
      const failures = report.results.filter(result => !result.ok);
      if (failures.length) {
        throw new Error(`cannot save release with stale asset provenance: ${failures
          .map(result => `${result.file} (${result.issues.join('; ')})`).join(', ')}`);
      }
    }
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
    for (const ledger of ['claims.md', 'sources.md', 'assets.lock.json']) {
      const lf = path.join(projectDir, ledger);
      if (fs.existsSync(lf)) {
        fs.copyFileSync(lf, path.join(releaseDir, ledger));
        saved.push(ledger);
      }
    }
    // The registry may intentionally track reusable files outside the renderer
    // asset root. Snapshot every artifact and recipe at its original path so a
    // restored lock never points at files that the release omitted.
    if (assetLock) {
      const snapshotTrackedFile = ref => {
        const resolved = resolveProjectFile(projectDir, ref);
        const dest = path.join(releaseDir, resolved.relative);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(resolved.absolute, dest);
        if (!saved.includes(resolved.relative)) saved.push(resolved.relative);
      };
      for (const asset of assetLock.assets) {
        snapshotTrackedFile(asset.file);
        if (asset.recipe) snapshotTrackedFile(asset.recipe);
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

  // The source registry may have changed while the snapshot was assembled.
  // Validate the staged bytes against the staged lock immediately before
  // publication; this accepts any internally consistent revision and rejects
  // a mixed lock/file snapshot without holding a project lock across config IO.
  if (fs.existsSync(assetLockPath(releaseDir))) {
    const stagedLock = readAssetLock(releaseDir, { missingOk: false });
    const stagedReport = verifyAssets(releaseDir);
    const failures = stagedReport.results.filter(result => !result.ok);
    if (failures.length) {
      throw new Error(`cannot save release with mixed asset provenance: ${failures
        .map(result => `${result.file} (${result.issues.join('; ')})`).join(', ')}`);
    }
    for (const asset of stagedLock.assets) {
      resolveProjectFile(releaseDir, asset.file);
      if (asset.recipe) resolveProjectFile(releaseDir, asset.recipe);
    }
  }

  const releaseLock = acquireBranchLock(name);
  try {
    if (branchRevision(name) !== expectedRevision) {
      throw new Error(`release "${safeName}" changed while this snapshot was being saved`);
    }
    if (fs.existsSync(finalReleaseDir)) rmDir(finalReleaseDir);
    const oldBranchDir = branchDir(name);
    if (fs.existsSync(oldBranchDir)) rmDir(oldBranchDir);
    fs.renameSync(releaseDir, finalReleaseDir);
  } finally { releaseLock(); }
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
 *   { rationale, status, parent, evidence, evidenceHashes, proofReceipt,
 *     proofReceiptSha256, proofIdentity, snapshotIdentity, snapshotHashes, snapshotManifestSha256,
 *     projectIdentity, created }
 *   status: exploring | candidate | approved | rejected | archived
 *   parent: optional branch name this was derived from */
const BRANCH_STATUSES = new Set(['exploring', 'candidate', 'approved', 'rejected', 'archived']);

/* Branch artifacts live beside release snapshots, never inside their authored
 * source namespace. Any project-relative filename can therefore round-trip. */
function branchDir(name) {
  return path.join(BRANCHES_DIR, path.basename(releasePath(name)));
}

function writeBranch(name, branch) {
  const dir = branchDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'branch.json'), JSON.stringify(branch, null, 2));
  return branch;
}

function validBranchStatus(status) {
  if (!BRANCH_STATUSES.has(status)) throw new Error(`invalid branch status "${status}" (expected ${[...BRANCH_STATUSES].join('|')})`);
  return status;
}

function saveBranch(name, meta = {}) {
  const releaseLock = acquireBranchLock(name);
  try {
    const releaseDir = releasePath(name);
    if (!fs.existsSync(releaseDir)) throw new Error(`release "${name}" not found — save it first`);
    const branch = {
    created: new Date().toISOString(),
    rationale: meta.rationale || '',
    status: validBranchStatus(meta.status || 'exploring'),
    evidence: Array.isArray(meta.evidence) ? meta.evidence : [],
    evidenceHashes: meta.evidenceHashes && typeof meta.evidenceHashes === 'object' ? meta.evidenceHashes : {},
    proofReceipt: meta.proofReceipt || '',
    proofReceiptSha256: meta.proofReceiptSha256 || '',
    proofIdentity: meta.proofIdentity || '',
    snapshotIdentity: meta.snapshotIdentity || '',
    snapshotHashes: meta.snapshotHashes && typeof meta.snapshotHashes === 'object' ? meta.snapshotHashes : {},
    snapshotManifestSha256: meta.snapshotManifestSha256 || '',
    projectIdentity: meta.projectIdentity || '',
    ...(meta.parent ? { parent: meta.parent } : {}),
    };
    return writeBranch(name, branch);
  } finally { releaseLock(); }
}

/* Publish a fully built staged release + external branch directory together.
 * Existing targets are moved aside first and restored if either final rename
 * fails, so a failed overwrite never destroys the last approved proof. */
function publishStagedBranch(stagedName, targetName, opts = {}) {
  const stagedRelease = releasePath(stagedName);
  const stagedMetadata = branchDir(stagedName);
  const targetRelease = releasePath(targetName);
  const targetMetadata = branchDir(targetName);
  const safeName = path.basename(targetRelease);
  const expectedStagedRevision = opts.expectedStagedRevision == null
    ? branchRevision(stagedName) : opts.expectedStagedRevision;
  // Prepare fallible shared infrastructure before taking live intent locks.
  // A permissions or path-type failure here must not strand either lock.
  fs.mkdirSync(PUBLICATION_BACKUPS_DIR, { recursive: true });
  const releaseLocks = acquireBranchLocks([stagedName, targetName]);
  let suffix = `${safeName}-${process.pid}-${Date.now()}`;
  let backupRelease = path.join(PUBLICATION_BACKUPS_DIR, `release-${suffix}`);
  let backupMetadata = path.join(PUBLICATION_BACKUPS_DIR, `metadata-${suffix}`);
  while (fs.existsSync(backupRelease) || fs.existsSync(backupMetadata)) {
    suffix += '-x';
    backupRelease = path.join(PUBLICATION_BACKUPS_DIR, `release-${suffix}`);
    backupMetadata = path.join(PUBLICATION_BACKUPS_DIR, `metadata-${suffix}`);
  }
  let releaseBackedUp = false;
  let metadataBackedUp = false;
  let releasePublished = false;
  let metadataPublished = false;
  try {
    if (!fs.existsSync(stagedRelease) || !fs.existsSync(stagedMetadata)) {
      throw new Error('staged branch is incomplete');
    }
    if (branchRevision(stagedName) !== expectedStagedRevision) {
      throw new Error(`staged branch "${path.basename(stagedRelease)}" changed before publication`);
    }
    if (opts.expectedRevision != null && branchRevision(targetName) !== opts.expectedRevision) {
      throw new Error(`branch "${safeName}" changed while this proof was being saved`);
    }
    if (fs.existsSync(targetRelease)) {
      fs.renameSync(targetRelease, backupRelease);
      releaseBackedUp = true;
    }
    if (fs.existsSync(targetMetadata)) {
      fs.renameSync(targetMetadata, backupMetadata);
      metadataBackedUp = true;
    }
    fs.renameSync(stagedRelease, targetRelease);
    releasePublished = true;
    fs.renameSync(stagedMetadata, targetMetadata);
    metadataPublished = true;
  } catch (error) {
    try {
      if (metadataPublished && fs.existsSync(targetMetadata)) fs.renameSync(targetMetadata, stagedMetadata);
      if (releasePublished && fs.existsSync(targetRelease)) fs.renameSync(targetRelease, stagedRelease);
      if (releaseBackedUp && fs.existsSync(backupRelease)) fs.renameSync(backupRelease, targetRelease);
      if (metadataBackedUp && fs.existsSync(backupMetadata)) fs.renameSync(backupMetadata, targetMetadata);
    } catch (rollbackError) {
      error.message += `; rollback failed: ${rollbackError.message}`;
    }
    throw error;
  } finally {
    releaseLocks();
  }
  // Both final renames are the commit point. Cleanup must never re-enter the
  // rollback path: a deletion error after one backup was removed could no
  // longer restore a complete prior pair. Leave an inert hidden backup behind
  // on cleanup failure; a later save can safely proceed around it.
  const cleanup = opts.removeDir || rmDir;
  if (releaseBackedUp) {
    try { cleanup(backupRelease); } catch { /* committed publication wins */ }
  }
  if (metadataBackedUp) {
    try { cleanup(backupMetadata); } catch { /* committed publication wins */ }
  }
  return { name: safeName, dir: targetRelease, metadataDir: targetMetadata };
}

function branchRevision(name) {
  const digest = crypto.createHash('sha256');
  const updatePart = value => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    digest.update(length);
    digest.update(bytes);
  };
  const hashTree = (label, root) => {
    updatePart(label);
    if (!fs.existsSync(root)) {
      updatePart('missing');
      return;
    }
    const visit = (dir, relative = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
      for (const entry of entries) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          updatePart('dir');
          updatePart(rel);
          visit(absolute, rel);
        } else if (entry.isFile()) {
          updatePart('file');
          updatePart(rel);
          updatePart(crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest());
        } else if (entry.isSymbolicLink()) {
          updatePart('link');
          updatePart(rel);
          updatePart(fs.readlinkSync(absolute));
        } else {
          // Never read FIFOs, sockets, or devices: doing so may block. Their
          // framed type and stable lstat identity still make their presence
          // publication-relevant instead of silently omitting them.
          const stat = fs.lstatSync(absolute);
          const type = entry.isFIFO() ? 'fifo'
            : entry.isSocket() ? 'socket'
              : entry.isCharacterDevice() ? 'character-device'
                : entry.isBlockDevice() ? 'block-device' : 'special';
          updatePart(type);
          updatePart(rel);
          updatePart(`${stat.mode}:${stat.rdev}:${stat.size}`);
        }
      }
    };
    visit(root);
  };
  // The compare-and-swap identity covers the complete published pair, not
  // merely manifest.json and branch.json. A same-manifest save can still
  // change config, assets, timings, evidence, or proof receipts.
  hashTree('release', releasePath(name));
  hashTree('metadata', branchDir(name));
  return digest.digest('hex');
}

/* Read branch metadata from a release, if present. */
function readBranch(name) {
  const current = path.join(branchDir(name), 'branch.json');
  if (fs.existsSync(current)) return JSON.parse(fs.readFileSync(current, 'utf8'));
  // Read pre-0.28 metadata without reserving branch.json for new snapshots.
  const legacy = path.join(releasePath(name), 'branch.json');
  if (!fs.existsSync(legacy)) return null;
  const parsed = JSON.parse(fs.readFileSync(legacy, 'utf8'));
  return parsed && BRANCH_STATUSES.has(parsed.status) && typeof parsed.rationale === 'string'
    ? parsed : null;
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
  const releaseLock = acquireBranchLock(name);
  try {
    const branch = readBranch(name);
    if (!branch) throw new Error(`branch "${name}" not found`);
    branch.status = validBranchStatus(status);
    branch.updated = new Date().toISOString();
    return writeBranch(name, branch);
  } finally { releaseLock(); }
}

function setBranchRationale(name, rationale) {
  const releaseLock = acquireBranchLock(name);
  try {
    const branch = readBranch(name);
    if (!branch) throw new Error(`branch "${name}" not found`);
    branch.rationale = String(rationale || '').trim();
    branch.updated = new Date().toISOString();
    return writeBranch(name, branch);
  } finally { releaseLock(); }
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

  // Validate the release's provenance unit before writing even the restored
  // manifest. A corrupt snapshot must never be published with its old lock.
  const releaseHasAssetLock = fs.existsSync(path.join(srcDir, 'assets.lock.json'));
  const releaseAssetLock = releaseHasAssetLock ? readAssetLock(srcDir, { missingOk: false }) : null;
  const releaseRefs = releaseAssetLock
    ? [...new Set(releaseAssetLock.assets.flatMap(asset => [asset.file, asset.recipe].filter(Boolean)))]
    : [];
  if (releaseAssetLock) {
    const report = verifyAssets(srcDir);
    const failures = report.results.filter(result => !result.ok);
    if (failures.length) {
      throw new Error(`release asset provenance is stale: ${failures
        .map(result => `${result.file} (${result.issues.join('; ')})`).join(', ')}`);
    }
    for (const ref of releaseRefs) resolveProjectFile(srcDir, ref);
  }

  // For new-project restore, put the manifest in the new project's out/.
  const manifestDestDir = opts.newProject ? path.join(projectDir, 'out') : destDir;
  if (!dryRun) fs.mkdirSync(manifestDestDir, { recursive: true });
  const manifestDest = path.join(manifestDestDir, 'manifest.json');

  // Ensure the project directory exists before copying source files.
  if (!dryRun && !fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

  const restoreProject = () => {
  const lockDest = path.join(projectDir, 'assets.lock.json');
  let lockStat = null;
  try { lockStat = fs.lstatSync(lockDest); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (lockStat && !lockStat.isFile()) {
    throw new Error(`${lockDest}: expected a regular file, not a symlink or directory`);
  }
  const destinationHasAssetLock = !!lockStat;
  const destinationAssetLock = destinationHasAssetLock
    ? readAssetLock(projectDir, { missingOk: false })
    : null;
  if (!releaseAssetLock && destinationAssetLock && overwrite) {
    throw new Error('cannot overwrite a project with tracked assets from a release that has no assets.lock.json');
  }

  if (!dryRun) {
    fs.copyFileSync(manifestSrc, manifestDest);
    const manifestSha256 = sha256File(manifestDest);
    fs.writeFileSync(path.join(manifestDestDir, RESTORE_MARKER), JSON.stringify({ manifestSha256 }, null, 2));
  }

  const results = { manifest: manifestDest, restored: [], skipped: [], conflicts: [] };

  const trackedPlan = [];
  let trackedConflict = false;
  if (releaseAssetLock && (!destinationHasAssetLock || overwrite)) {
    for (const ref of releaseRefs) {
      const source = resolveProjectFile(srcDir, ref);
      const destination = fs.existsSync(projectDir)
        ? resolveProjectFile(projectDir, ref, { mustExist: false })
        : { absolute: path.join(projectDir, source.relative), relative: source.relative };
      let destinationStat = null;
      try { destinationStat = fs.lstatSync(destination.absolute); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      let same = false;
      if (destinationStat && (destinationStat.isFile() || destinationStat.isSymbolicLink())) {
        // mustExist performs the realpath boundary check before an existing
        // symlink can be accepted as an equal tracked destination.
        const existing = resolveProjectFile(projectDir, ref);
        same = sha256File(source.absolute) === sha256File(existing.absolute);
      }
      const conflict = !!destinationStat && !same;
      if (conflict && !overwrite) trackedConflict = true;
      trackedPlan.push({ ref, source, destination, same, conflict });
    }
  }

  const publishAssetUnit = releaseAssetLock
    && (!destinationHasAssetLock || overwrite)
    && !trackedConflict;
  const restoreBackupDir = !dryRun && publishAssetUnit
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'narova-restore-assets-'))
    : null;
  const restoreBackups = [];
  if (restoreBackupDir) {
    const destinationRefs = destinationAssetLock
      ? destinationAssetLock.assets.flatMap(asset => [asset.file, asset.recipe].filter(Boolean))
      : [];
    const targets = [...new Set([
      ...trackedPlan.map(item => item.destination.absolute),
      ...destinationRefs.map(ref => resolveProjectFile(projectDir, ref, { mustExist: false }).absolute),
      lockDest,
    ])];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const backup = path.join(restoreBackupDir, String(i));
      let existed = false;
      try { fs.lstatSync(target); existed = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (existed) fs.cpSync(target, backup, { recursive: true, dereference: false, verbatimSymlinks: true });
      restoreBackups.push({ target, backup, existed });
    }
  }
  const rollbackAssetUnit = () => {
    if (!restoreBackupDir) return;
    for (const item of restoreBackups.reverse()) {
      fs.rmSync(item.target, { recursive: true, force: true });
      if (item.existed) {
        fs.mkdirSync(path.dirname(item.target), { recursive: true });
        fs.cpSync(item.backup, item.target, { recursive: true, dereference: false, verbatimSymlinks: true });
      }
    }
    fs.rmSync(restoreBackupDir, { recursive: true, force: true });
  };
  const commitAssetUnit = () => {
    if (restoreBackupDir) {
      try { fs.rmSync(restoreBackupDir, { recursive: true, force: true }); } catch { /* restored unit is committed */ }
    }
  };
  const copyTrackedFile = opts.copyTrackedFile || fs.copyFileSync;

  try {
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

  const savedOverrides = path.join(srcDir, RESTORE_OVERRIDES);
  const restoredOverrides = path.join(manifestDestDir, RESTORE_OVERRIDES);
  if (!dryRun) {
    if (fs.existsSync(savedOverrides)) fs.copyFileSync(savedOverrides, restoredOverrides);
    else fs.rmSync(restoredOverrides, { force: true });
  }
  if (fs.existsSync(savedOverrides)) results.restored.push(RESTORE_OVERRIDES);

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === 'manifest.json') continue;
    if (entry.name === 'assets.lock.json') continue;
    if (['.audio-fingerprint', '.timings-fingerprint', 'timings.json', RESTORE_OVERRIDES].includes(entry.name)) continue;
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

  if (releaseAssetLock) {
    if (destinationHasAssetLock && !overwrite) {
      results.conflicts.push('assets.lock.json');
      results.skipped.push('assets.lock.json');
    } else if (trackedConflict) {
      for (const item of trackedPlan.filter(item => item.conflict)) results.conflicts.push(item.ref);
      results.conflicts.push('assets.lock.json');
      results.skipped.push('assets.lock.json');
    } else {
      for (const item of trackedPlan) {
        if (item.same) continue;
        if (!dryRun) {
          if (fs.existsSync(item.destination.absolute)) fs.rmSync(item.destination.absolute, { recursive: true, force: true });
          fs.mkdirSync(path.dirname(item.destination.absolute), { recursive: true });
          copyTrackedFile(item.source.absolute, item.destination.absolute);
        }
        if (!results.restored.includes(item.ref)) results.restored.push(item.ref);
      }
      if (!dryRun) {
        // Never let copyFileSync follow a destination symlink. The preflight
        // rejects one, and removal makes publication replace-only.
        fs.rmSync(lockDest, { force: true });
        copyTrackedFile(path.join(srcDir, 'assets.lock.json'), lockDest);
      }
      results.restored.push('assets.lock.json');
    }
  }
  commitAssetUnit();
  } catch (error) {
    try { rollbackAssetUnit(); }
    catch (rollbackError) { error.message += `; asset restore rollback failed: ${rollbackError.message}`; }
    throw error;
  }

  if (dryRun) {
    log(`dry-run: would restore ${results.restored.length} file(s) to ${projectDir}`);
    if (results.conflicts.length) log(`  conflicts (skipped without --overwrite): ${results.conflicts.join(', ')}`);
  } else {
    if (results.conflicts.length) log(`  skipped ${results.conflicts.length} existing file(s) (use --overwrite to replace): ${results.conflicts.join(', ')}`);
  }

  return results;
  };

  const shouldSerializeAssets = !dryRun && (releaseAssetLock || fs.existsSync(assetLockPath(projectDir)));
  return shouldSerializeAssets ? withAssetMutation(projectDir, restoreProject) : restoreProject();
}

function remove(name) {
  const releaseLock = acquireBranchLock(name);
  try {
    const p = releasePath(name);
    if (!fs.existsSync(p)) throw new Error(`release not found: ${name}`);
    rmDir(p);
    const metadata = branchDir(name);
    if (fs.existsSync(metadata)) rmDir(metadata);
    return p;
  } finally { releaseLock(); }
}

module.exports = {
  save, list, restore, remove, RELEASES_DIR, RESTORE_MARKER, RESTORE_OVERRIDES, releasePath, branchDir, resolveProjectDir,
  saveBranch, readBranch, listBranches, setBranchStatus, setBranchRationale,
  validBranchStatus, publishStagedBranch, branchRevision, projectIdentity,
  _internals: { acquireBranchLock, branchLockFile },
};
