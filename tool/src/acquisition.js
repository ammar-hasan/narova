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
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const { createGunzip } = require('zlib');
const { acquireFile, DEMO_VOICE } = require('./readiness');

const STATIC_RELEASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1';

/* Media-tool pins: retained, tagged ffmpeg-static b6.1.1 release assets.
 * GitHub's release API records each compressed asset's size and SHA-256.
 * The corresponding license is installed beside the binaries. macOS and
 * Windows stay fail-closed until equally verifiable sources are recorded. */
const MEDIA_PINS = {
  'linux-x64': {
    id: 'ffmpeg-static-b6.1.1-linux-x64',
    bytes: 58643973,
    files: [
      { name: 'ffmpeg', url: `${STATIC_RELEASE}/ffmpeg-linux-x64.gz`, sha256: 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa', bytes: 29354986 },
      { name: 'ffprobe', url: `${STATIC_RELEASE}/ffprobe-linux-x64.gz`, sha256: '25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067', bytes: 29276839 },
      { name: 'LICENSE', url: `${STATIC_RELEASE}/linux-x64.LICENSE.gz`, sha256: 'e6f01cb10f21032b80e78a1b0bd13d6c387d6f18eed9a37f99ea35d7e3f7bb7a', bytes: 12148 },
    ],
  },
  'linux-arm64': {
    id: 'ffmpeg-static-b6.1.1-linux-arm64',
    bytes: 51074414,
    files: [
      { name: 'ffmpeg', url: `${STATIC_RELEASE}/ffmpeg-linux-arm64.gz`, sha256: '754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0', bytes: 25568691 },
      { name: 'ffprobe', url: `${STATIC_RELEASE}/ffprobe-linux-arm64.gz`, sha256: '2ab6aba60ee84412dff9188720703376cb4e7aaf7e0b5e43aa8249f2acae5bf8', bytes: 25493573 },
      { name: 'LICENSE', url: `${STATIC_RELEASE}/linux-arm64.LICENSE.gz`, sha256: '04dec67da0540177665f991e3f8f08ed1bc6b949c09ce644c37cd30082591b56', bytes: 12150 },
    ],
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
    const identity = (files) => files.map(({ name, url, sha256, bytes }) => ({ name, url, sha256, bytes }));
    if (marker.schema !== 2 || marker.id !== pin.id) return false;
    if (JSON.stringify(marker.files) !== JSON.stringify(identity(pin.files))) return false;
    return mediaBinariesOk(root);
  } catch { return false; }
}

function mediaBinariesOk(root) {
  for (const relative of ['bin/ffmpeg', 'bin/ffprobe', 'LICENSE']) {
    const stat = fs.lstatSync(path.join(root, relative), { throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.size === 0) return false;
  }
  for (const bin of ['ffmpeg', 'ffprobe']) {
    const p = path.join(root, 'bin', bin);
    const result = spawnSync(p, ['-version'], { encoding: 'utf8', timeout: 10000 });
    if (result.status !== 0 || !result.stdout.toLowerCase().startsWith(`${bin} version`)) return false;
  }
  return true;
}

/* Provision the pinned media tool: staged digest-verified downloads,
 * decompression, executable validation, marker, and atomic directory exchange.
 * Any failure removes staged paths without replacing a prior install (NAR-021-003).
 * `pin` is injectable for fixture tests; production calls omit it. */
async function provisionMedia(view, pin = mediaPinFor()) {
  if (!pin) {
    const err = new Error(`no recorded media-tool pin for ${process.platform}-${process.arch} — failing closed`);
    err.code = 'NAROVA_MEDIA_UNPINNED';
    throw err;
  }
  const names = Array.isArray(pin.files) ? pin.files.map((file) => file.name) : [];
  if (JSON.stringify(names) !== JSON.stringify(['ffmpeg', 'ffprobe', 'LICENSE'])) {
    throw new Error(`media pin ${pin.id} must contain exactly ffmpeg, ffprobe, and LICENSE`);
  }
  if (pin.bytes !== pin.files.reduce((sum, file) => sum + file.bytes, 0)) {
    throw new Error(`media pin ${pin.id} has an inconsistent byte total`);
  }
  const home = process.env.NAROVA_HOME || path.join(os.homedir(), '.narova');
  const root = mediaInstallDir(pin);
  if (mediaMarkerOk(root, pin)) return { dir: root, acquired: 0, reused: true };

  const staging = `${root}.staging-${process.pid}`;
  const backup = `${root}.backup-${process.pid}`;
  let backedUp = false;
  let committed = false;
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(backup, { recursive: true, force: true });
    fs.mkdirSync(path.join(staging, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(staging, '.downloads'), { recursive: true });
    let acquired = 0;
    for (const file of pin.files) {
      if (!['ffmpeg', 'ffprobe', 'LICENSE'].includes(file.name)) {
        throw new Error(`unsupported media pin member: ${file.name}`);
      }
      const download = path.join(staging, '.downloads', `${file.name}.gz`);
      const got = await acquireFile(file.url, download, { sha256: file.sha256, bytes: file.bytes, view });
      acquired += got.bytes;
      const output = file.name === 'LICENSE'
        ? path.join(staging, 'LICENSE')
        : path.join(staging, 'bin', file.name);
      await pipeline(createReadStream(download), createGunzip(), createWriteStream(output));
    }
    fs.rmSync(path.join(staging, '.downloads'), { recursive: true, force: true });
    for (const bin of ['ffmpeg', 'ffprobe']) fs.chmodSync(path.join(staging, 'bin', bin), 0o755);
    if (!mediaBinariesOk(staging)) throw new Error(`media binaries for ${pin.id} failed version validation`);
    fs.writeFileSync(path.join(staging, '.narova-pin.json'), JSON.stringify({
      schema: 2,
      id: pin.id,
      files: pin.files.map(({ name, url, sha256, bytes }) => ({ name, url, sha256, bytes })),
      acquiredAt: new Date().toISOString(),
    }, null, 2));

    // Exchange only after every member is verified. A failed refresh keeps
    // the prior installation resolvable (NAR-021-003).
    fs.mkdirSync(path.dirname(root), { recursive: true });
    if (fs.existsSync(root)) {
      fs.renameSync(root, backup);
      backedUp = true;
    }
    fs.renameSync(staging, root);
    committed = true;
    fs.rmSync(backup, { recursive: true, force: true });
    return { dir: root, acquired, reused: false };
  } catch (err) {
    if (backedUp && !committed && !fs.existsSync(root) && fs.existsSync(backup)) {
      fs.renameSync(backup, root);
    }
    throw err;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    if (committed) fs.rmSync(backup, { recursive: true, force: true });
  }
}

/* Media tooling: platforms without a recorded digest fail closed to
 * explicit guidance (NAR-021-002 `needs-user-action`). The platform is
 * injectable so doctor's hint can be exercised for other platforms. */
function mediaGuidance(platform = process.platform) {
  if (platform === 'darwin') return 'install ffmpeg — `brew install ffmpeg` (or from https://ffmpeg.org)';
  if (platform === 'win32') return 'install ffmpeg — `winget install ffmpeg` (or from https://ffmpeg.org)';
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
