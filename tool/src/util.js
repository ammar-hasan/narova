'use strict';
/* Shared helpers: process runners, ffprobe, path/size helpers. */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* Run a command, inheriting stderr, throwing on failure. */
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd} exited ${r.status}`);
  return r;
}

/* Media duration in seconds via ffprobe (long-form flags — LEARNINGS #19). */
function probe(p) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', String(p),
  ], { encoding: 'utf8' });
  return parseFloat(out.trim());
}

function which(bin) {
  const r = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

/* Normalize a config.size ({w,h} | "16:9"|"1:1"|"9:16") into {w,h}.
 * Unknown values throw — a typo'd aspect must not silently render 16:9. */
function resolveSize(size) {
  const presets = { '16:9': { w: 1280, h: 720 }, '1:1': { w: 1080, h: 1080 }, '9:16': { w: 720, h: 1280 } };
  if (!size) return { w: 1280, h: 720 };
  if (typeof size === 'string') {
    if (presets[size]) return presets[size];
    throw new Error(`unknown size "${size}" — use 16:9, 1:1, 9:16, or {w,h}`);
  }
  if (size.w && size.h) {
    const w = size.w | 0, h = size.h | 0;
    if (w > 0 && h > 0) return { w, h };
    throw new Error(`invalid size ${JSON.stringify(size)} — width and height must be positive`);
  }
  throw new Error(`unknown size ${JSON.stringify(size)} — use 16:9, 1:1, 9:16, or {w,h}`);
}

/* Platform presets: --platform / config.platform. `size` is the frame preset
 * used when no explicit size is set; `band` is the target duration range in
 * seconds used by `narova check` for length linting (2026 platform norms). */
const PLATFORMS = {
  tiktok:   { size: { w: 1080, h: 1920 }, band: [21, 34],  label: 'TikTok' },
  reels:    { size: { w: 1080, h: 1920 }, band: [15, 30],  label: 'Instagram Reels' },
  shorts:   { size: { w: 1080, h: 1920 }, band: [30, 50],  label: 'YouTube Shorts' },
  linkedin: { size: { w: 1080, h: 1080 }, band: [30, 90],  label: 'LinkedIn' },
  x:        { size: { w: 1080, h: 1920 }, band: [0, 140],  label: 'X' },
  youtube:  { size: { w: 1920, h: 1080 }, band: [0, 720],  label: 'YouTube' },
};

/* #rrggbb -> "rgba(r,g,b,a)" for text-shadow tints. */
function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return `rgba(46,230,214,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const NAROVA_HOME = process.env.NAROVA_HOME || path.join(os.homedir(), '.narova');
const SAMPLES_DIR = path.join(NAROVA_HOME, 'samples');
const SAMPLE_EXTS = ['.wav', '.mp3', '.flac', '.m4a'];

/* Resolve a chatterbox voice-cloning speaker reference to an absolute path.
 * Absolute paths pass through. Relative names are looked up in
 * ~/.narova/samples/ with common audio extensions. Returns null when no
 * sample matches. */
function resolveVoiceSample(speaker) {
  if (!speaker || typeof speaker !== 'string') return null;
  if (path.isAbsolute(speaker)) return speaker;
  for (const ext of SAMPLE_EXTS) {
    const candidate = path.join(SAMPLES_DIR, speaker + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  const asIs = path.join(SAMPLES_DIR, speaker);
  if (fs.existsSync(asIs)) return asIs;
  return null;
}

module.exports = { sh, probe, which, ensureDir, resolveSize, hexToRgba, PLATFORMS, resolveVoiceSample, SAMPLES_DIR };
