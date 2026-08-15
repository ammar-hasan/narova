'use strict';
/* Review evidence surfaces (NAR-007-023 / NAR-007-024).
 *
 * Two families of ADVISORY output produced on request from existing build
 * material — no renderer invocation, no gates, no effect on validity:
 *
 *   clip coverage summary  every distinct scene clip, the scenes using it,
 *                          and reuse counts, ordered by reuse. Repetition is
 *                          surfaced information; it stays a legal creative
 *                          choice.
 *   owner-review artifacts a scene contact sheet (one labeled still per scene
 *                          from existing material) and a term-excerpt set
 *                          (one short audio clip per requested word/phrase cut
 *                          from existing synthesized audio at existing word
 *                          timings). Cheap enough to self-audit before an
 *                          expensive render or an owner handoff. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureDir } = require('./util');
const { composeData } = require('./compose/data');

/* NAR-007-023 — [{ clip, scenes[], beats }] ordered by descending reuse. */
function clipCoverage(config) {
  const byRef = new Map();
  for (const s of config.scenes || []) {
    if (!s.clip) continue;
    if (!byRef.has(s.clip)) byRef.set(s.clip, { clip: s.clip, scenes: [], beats: 0 });
    const entry = byRef.get(s.clip);
    entry.scenes.push(s.id);
    entry.beats += 1;
  }
  return [...byRef.values()].sort((a, b) => b.beats - a.beats || a.clip.localeCompare(b.clip));
}

function formatCoverage(rows) {
  if (rows.length === 0) return 'clip coverage: no scene clips in this project';
  const widest = Math.max(...rows.map(r => r.clip.length), 4);
  const lines = rows.map(r =>
    `${r.clip.padEnd(widest)}  ${String(r.beats).padStart(2)}x  scenes: ${r.scenes.join(', ')}`
  );
  const header = `clip coverage (advisory — reuse is a creative choice, not a defect):\n${'clip'.padEnd(widest)}  use  scenes`;
  return [header, ...lines].join('\n');
}

/* NAR-007-024 — scene contact sheet from EXISTING material: one labeled still
 * per scene from an encoded video (never a renderer invocation). Returns
 * { sheet, tiles, missing, reason? }. */
function contactSheet(config, outDir, timings) {
  const data = composeData(config, timings);
  const scenes = data.scenes.map((sc, i) => ({ ...sc, index: i }));
  const video = ['video.mp4', 'video-release.mp4']
    .map(f => path.join(outDir, f))
    .find(f => fs.existsSync(f));
  if (!video) {
    return { sheet: null, tiles: [], missing: scenes.map(s => s.id), reason: 'no encoded video in out/ — run a build first' };
  }
  const dir = ensureDir(path.join(outDir, 'review-evidence', 'contact-sheet'));
  const tiles = [];
  const missing = [];
  // drawtext needs an ffmpeg built with libfreetype; when absent, tiles fall
  // back to unlabeled stills (scene identity stays in the filename/order).
  const filterList = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });
  const labeled = filterList.status === 0 && /\bdrawtext\b/.test(String(filterList.stdout || ''));
  for (const sc of scenes) {
    const at = Math.min(sc.start + Math.max(0.05, sc.dur / 2), Math.max(0.05, sc.start + sc.dur - 0.02));
    const tile = path.join(dir, `${String(sc.index + 1).padStart(2, '0')}-${String(sc.id).replace(/[^\w.-]/g, '_')}.jpg`);
    const filters = labeled
      ? `scale=480:-2,drawtext=text='${`${String(sc.index + 1).padStart(2, '0')} ${sc.id}`.replace(/[':\\]/g, '')}':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6`
      : 'scale=480:-2';
    const r = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-ss', String(at), '-i', video,
      '-frames:v', '1', '-vf', filters, '-q:v', '3', tile,
    ], { encoding: 'utf8', timeout: 30000 });
    if (r.status === 0) tiles.push(tile); else missing.push(sc.id);
  }
  if (tiles.length === 0) {
    return { sheet: null, tiles, missing, reason: 'frame extraction produced no tiles' };
  }
  if (tiles.length === 1) return { sheet: tiles[0], tiles, missing };
  const sheet = path.join(dir, 'sheet.jpg');
  const montage = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    ...tiles.flatMap(t => ['-i', t]),
    '-filter_complex',
    `${tiles.map((_, i) => `[${i}:v]scale=480:-2[v${i}]`).join(';')};`
      + `${tiles.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${tiles.length}:columns=${Math.min(3, tiles.length)}[x]`,
    '-frames:v', '1', '-q:v', '3', sheet,
  ], { encoding: 'utf8', timeout: 120000 });
  if (montage.status !== 0) {
    return { sheet: null, tiles, missing, reason: 'montage failed; individual tiles kept' };
  }
  return { sheet, tiles, missing };
}

/* NAR-007-024 — term excerpts cut from existing synthesized audio at existing
 * word timings (composeData groups carry global t0/t1 per word). Returns
 * { excerpts: [{term, file}], notFound: [term], audio, reason? }. */
function termExcerpts(config, outDir, timings, terms, { pad = 0.25 } = {}) {
  const full = path.join(outDir, 'audio', 'full.wav');
  const result = { excerpts: [], notFound: [...terms], audio: null };
  if (!fs.existsSync(full)) {
    result.reason = 'no out/audio/full.wav — run synth first';
    return result;
  }
  result.audio = full;
  const data = composeData(config, timings);
  const words = [];
  for (const g of data.groups) for (const w of g.words) words.push(w);
  const normalize = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, '').replace(/\s+/g, ' ').trim();
  const dir = ensureDir(path.join(outDir, 'review-evidence', 'excerpts'));
  const made = [];
  for (const term of terms) {
    const needle = normalize(term);
    if (!needle) continue;
    const tokens = needle.split(' ');
    let hit = null;
    for (let i = 0; i + tokens.length <= words.length && !hit; i++) {
      const slice = words.slice(i, i + tokens.length);
      const joined = normalize(slice.map(w => w.w).join(' '));
      if (joined === needle) hit = { start: slice[0].t0, end: slice[slice.length - 1].t1 };
    }
    if (!hit) continue;
    const file = path.join(dir, `${String(term).replace(/[^\p{L}\p{N}_-]/gu, '_')}.wav`);
    const r = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-ss', String(Math.max(0, hit.start - pad)), '-to', String(hit.end + pad),
      '-i', full, '-c', 'copy', file,
    ], { encoding: 'utf8', timeout: 30000 });
    if (r.status === 0) made.push({ term, file });
  }
  const madeTerms = new Set(made.map(m => m.term));
  result.excerpts = made;
  result.notFound = terms.filter(t => !madeTerms.has(t));
  return result;
}

module.exports = { clipCoverage, formatCoverage, contactSheet, termExcerpts };
