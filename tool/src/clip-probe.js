'use strict';
/* Compose-time clip diagnostics (NAR-004-021).
 *
 * The HyperFrames engine extracts frames from every <video> in the composed
 * project before capture. When that stage dies the engine surfaces only its
 * exit code, so a 46-clip render fails with no hint of which clip killed it.
 * narova owns the composed inputs, so it brackets the stage itself: each
 * direct scene clip gets a cheap decode-head probe before render. Probes
 * never gate the render (a render that would succeed still succeeds); they
 * only make the failure diagnostic name the stage, the candidate clips, and
 * the retry count. Derivable without engine debug logging by construction. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/* Probe one clip: a stream-info read plus a single-frame decode from the
 * head. Returns { ref, ok, detail }. A clip that ffprobe cannot even open is
 * reported with its error head so the diagnostic is self-explanatory. */
function probeClip(absolutePath) {
  const info = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height',
    '-of', 'default=noprint_wrappers=1', absolutePath,
  ], { encoding: 'utf8', timeout: 20000 });
  if (info.status !== 0) {
    const head = String(info.stderr || '').trim().split('\n')[0] || 'ffprobe failed';
    return { ok: false, detail: head };
  }
  const decode = spawnSync('ffmpeg', [
    '-v', 'error', '-i', absolutePath, '-frames:v', '1', '-f', 'null', '-',
  ], { encoding: 'utf8', timeout: 30000 });
  if (decode.status !== 0) {
    const head = String(decode.stderr || '').trim().split('\n')[0] || 'first-frame decode failed';
    return { ok: false, detail: head };
  }
  return { ok: true, detail: String(info.stdout || '').trim().replace(/\n/g, ' ') };
}

/* Collect probe results for every scene clip in a resolved config. Returns
 * { clips: [{ sceneId, ref, abs, ok, detail }], missing: [ref...] } — paths
 * that do not exist are 'missing' rather than probe-failed so the diagnostic
 * can distinguish them (schema already rejects missing clips, but a config
 * assembled another way can still reach render). */
function probeProjectClips(config, projectDir) {
  const clips = [];
  const missing = [];
  const seen = new Set();
  for (const s of config.scenes || []) {
    if (!s.clip) continue;
    const ref = s.clip;
    const abs = path.isAbsolute(ref) ? ref : path.resolve(projectDir || '.', ref);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (!fs.existsSync(abs)) { missing.push(ref); continue; }
    const { ok, detail } = probeClip(abs);
    clips.push({ sceneId: s.id, ref, abs, ok, detail });
  }
  return { clips, missing };
}

/* The failure diagnostic for a multi-clip render (NAR-004-021). stage is the
 * narova-side bracket name; retries is how many engine-side attempts narova
 * made (it makes none itself — npx network retries are transport, not render
 * attempts, and are not counted). Undecodable probes are named directly;
 * when every probe passed, all clips remain candidates because any of them
 * can still fail inside engine extraction. */
function attributionDiagnostic(stage, probes, retries, cause) {
  const parts = [`${stage} failed`];
  const bad = probes.clips.filter(c => !c.ok);
  if (bad.length > 0) {
    parts.push(`probe flags ${bad.length} of ${probes.clips.length} clips:`);
    for (const c of bad) parts.push(`  - scene "${c.sceneId}" clip ${c.ref} — ${c.detail}`);
    parts.push('probes are advisory only — the failing clip above is the first place to look, but the engine failure may still be another clip');
  } else {
    parts.push(`all ${probes.clips.length} clips passed decode-head probes; candidates (any may have failed engine frame extraction):`);
    for (const c of probes.clips) parts.push(`  - scene "${c.sceneId}" clip ${c.ref}`);
  }
  for (const ref of probes.missing) parts.push(`  - referenced clip ${ref} is MISSING on disk`);
  parts.push(`render attempts by narova: ${retries}`);
  if (cause) parts.push(`engine exit: ${cause}`);
  return parts.join('\n');
}

module.exports = { probeClip, probeProjectClips, attributionDiagnostic };
