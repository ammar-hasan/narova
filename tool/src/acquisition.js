'use strict';
/* Pinned acquisition manifest (NAR-SPEC-021, NAR-021-003).
 *
 * Every auto-provisioned artifact is acquired ONLY from a pinned URL
 * recorded here and verified against a digest recorded here before first
 * use. An item without a recorded digest FAILS CLOSED: it is never
 * silently downloaded; the user gets explicit install guidance instead
 * (principle 26 — a pinned name is not supply-chain identity).
 *
 * The voice pin lives in readiness.js (DEMO_VOICE) so the readiness probe
 * and this manifest cannot drift apart (adversarial-review F2). */
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { acquireFile, DEMO_VOICE } = require('./readiness');

/* Media-tool pins: static builds from the dated, immutable BtbN
 * FFmpeg-Builds autobuild snapshot `autobuild-2026-08-18-15-03` (GitHub
 * release artifacts; digests computed at pin time and cross-checked
 * against the listed asset sizes). macOS has no checksummed static
 * source, so it stays fail-closed to brew/ffmpeg.org guidance until one
 * is recorded. */
const MEDIA_PINS = {
  'linux-x64': {
    id: 'linux64-gpl-N-126207-g21bbd98e7b',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-18-15-03/ffmpeg-N-126207-g21bbd98e7b-linux64-gpl.tar.xz',
    sha256: 'ae86e7d2924f46a4658c2a83a74096c8bf5dc7e78bd94e869ff35b45ddf762a0',
    bytes: 127991188,
    topdir: 'ffmpeg-N-126207-g21bbd98e7b-linux64-gpl',
  },
  'linux-arm64': {
    id: 'linuxarm64-gpl-N-126207-g21bbd98e7b',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-18-15-03/ffmpeg-N-126207-g21bbd98e7b-linuxarm64-gpl.tar.xz',
    sha256: 'ac47b6cf125e1d85566aba95fb8d715692f9cb3f24bd694298b235f8f4252a8c',
    bytes: 109609092,
    topdir: 'ffmpeg-N-126207-g21bbd98e7b-linuxarm64-gpl',
  },
};

function mediaPinFor(platform = process.platform, arch = process.arch) {
  return MEDIA_PINS[`${platform}-${arch}`] || null;
}

/* Install root for a media pin under user storage (NAR-021-003). */
function mediaInstallDir(pin = mediaPinFor()) {
  const home = process.env.NAROVA_HOME || path.join(os.homedir(), '.narova');
  return pin ? path.join(home, 'tools', 'media', pin.id) : null;
}

/* Marker recorded inside an installed pin; a matching marker plus present
 * binaries is what the readiness probe treats as satisfied. */
function mediaMarkerOk(root, pin) {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(root, '.narova-pin.json'), 'utf8'));
    if (marker.sha256 !== pin.sha256) return false;
    for (const bin of ['ffmpeg', 'ffprobe']) {
      const p = path.join(root, 'bin', bin);
      if (!fs.existsSync(p)) return false;
    }
    return true;
  } catch { return false; }
}

/* Provision the pinned media tool: staged digest-verified download,
 * staged extraction, marker, atomic directory commit. Any failure removes
 * every staged path so no partial install is resolvable (NAR-021-003).
 * `pin` is injectable for fixture tests; production calls omit it. */
async function provisionMedia(view, pin = mediaPinFor()) {
  if (!pin) {
    const err = new Error(`no recorded media-tool pin for ${process.platform}-${process.arch} — failing closed`);
    err.code = 'NAROVA_MEDIA_UNPINNED';
    throw err;
  }
  const home = process.env.NAROVA_HOME || path.join(os.homedir(), '.narova');
  const root = mediaInstallDir(pin);
  if (mediaMarkerOk(root, pin)) return { dir: root, acquired: 0, reused: true };

  const archive = `${root}.tar.xz`;
  const staging = `${root}.staging-${process.pid}`;
  const cleanup = () => { fs.rmSync(archive, { force: true }); fs.rmSync(staging, { recursive: true, force: true }); };
  try {
    fs.rmSync(root, { recursive: true, force: true }); // stale or corrupt prior install
    const got = await acquireFile(pin.url, archive, { sha256: pin.sha256, bytes: pin.bytes, view });

    // Staged extraction; system tar with xz/gz per extension.
    fs.mkdirSync(staging, { recursive: true });
    const xflag = archive.endsWith('.tar.gz') ? '-xzf' : '-xJf';
    const extracted = spawnSync('tar', [xflag, archive, '-C', staging], { stdio: 'ignore' });
    if (extracted.status !== 0) throw new Error(`extracting ${pin.url} failed (tar exited ${extracted.status})`);
    const inner = path.join(staging, pin.topdir);
    for (const bin of ['ffmpeg', 'ffprobe']) {
      const p = path.join(inner, 'bin', bin);
      if (!fs.existsSync(p)) throw new Error(`archive for ${pin.url} does not contain bin/${bin}`);
      fs.chmodSync(p, 0o755);
    }
    fs.writeFileSync(path.join(inner, '.narova-pin.json'), JSON.stringify({
      sha256: pin.sha256, url: pin.url, bytes: pin.bytes, acquiredAt: new Date().toISOString(),
    }, null, 2));

    // Atomic commit: the install dir appears only when fully verified.
    fs.mkdirSync(path.dirname(root), { recursive: true });
    fs.renameSync(inner, root);
    return { dir: root, acquired: got.bytes, reused: false };
  } catch (err) {
    cleanup();
    fs.rmSync(root, { recursive: true, force: true }); // never leave a half install
    throw err;
  } finally {
    fs.rmSync(archive, { force: true }); // the archive is not an install artifact
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/* Media tooling: platforms without a recorded digest fail closed to
 * explicit guidance (NAR-021-002 `needs-user-action`). */
function mediaGuidance() {
  const p = process.platform;
  if (p === 'darwin') return 'install ffmpeg — `brew install ffmpeg` (or from https://ffmpeg.org)';
  if (p === 'win32') return 'install ffmpeg — `winget install ffmpeg` (or from https://ffmpeg.org)';
  return 'install ffmpeg via your distribution (e.g. `apt install ffmpeg`) or from https://ffmpeg.org';
}

/* Provision the demo voice into its piper data dir. Idempotent: files whose
 * digests already match are never re-acquired (NAR-021-007). Returns
 * measured acquired bytes and per-file outcomes for the demo report. */
async function provisionDemoVoice(view) {
  const dir = DEMO_VOICE.dataDir();
  const outcomes = [];
  let acquired = 0;
  for (const file of DEMO_VOICE.files) {
    const dest = path.join(dir, file.name);
    let reused = false;
    if (fs.existsSync(dest)) {
      const cur = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
      if (cur === file.sha256) reused = true;
      else fs.unlinkSync(dest); // stale or corrupt — replace through the staged path
    }
    if (reused) {
      outcomes.push({ name: file.name, bytes: 0, reused: true });
      continue;
    }
    const r = await acquireFile(file.url, dest, { sha256: file.sha256, bytes: file.bytes, view });
    acquired += r.bytes;
    outcomes.push({ name: file.name, bytes: r.bytes, reused: false });
  }
  return { dir, acquired, outcomes };
}

module.exports = {
  MEDIA_PINS, mediaPinFor, mediaInstallDir, mediaMarkerOk,
  mediaGuidance, provisionDemoVoice, provisionMedia,
};
