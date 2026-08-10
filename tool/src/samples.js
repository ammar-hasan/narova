'use strict';
/* Voice sample management for chatterbox voice cloning.
 * Samples live in ~/.narova/samples/ and are referenced by name in config
 * (e.g. `speaker: "my-voice"`). The schema resolves names to absolute paths
 * before they reach the Python TTS stage. */
const fs = require('fs');
const path = require('path');
const { SAMPLES_DIR, which } = require('./util');

const VALID_EXTS = new Set(['.wav', '.mp3', '.flac', '.m4a']);
const MIN_DURATION = 2;   // seconds — shorter won't clone well
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB cap

function ensureSamplesDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* Add a sample: copies `source` into baseDir/<name><ext>.
 * Validates the file exists, has a supported audio extension, is between
 * MIN_DURATION and MAX_SIZE, and returns the new sample's absolute path.
 * `baseDir` defaults to SAMPLES_DIR (~/.narova/samples/) but can be
 * overridden for testing. Throws on invalid input. */
function addSample(source, name, baseDir) {
  const dir = baseDir || SAMPLES_DIR;
  if (!source || typeof source !== 'string') throw new Error('source path is required');
  if (!name || typeof name !== 'string') throw new Error('sample name is required');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new Error(`sample name "${name}" must be alphanumeric (dots/hyphens/underscores ok)`);
  }

  const src = path.resolve(source);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
    throw new Error(`source file not found: ${src}`);
  }

  const ext = path.extname(src).toLowerCase();
  if (!VALID_EXTS.has(ext)) {
    throw new Error(`unsupported audio format "${ext}" — use .wav, .mp3, .flac, or .m4a`);
  }

  const size = fs.statSync(src).size;
  if (size > MAX_SIZE) {
    throw new Error(`sample too large (${(size / 1024 / 1024).toFixed(1)} MB) — max ${MAX_SIZE / 1024 / 1024} MB`);
  }

  // Duration check via ffprobe (best-effort — skips if ffprobe is absent).
  const ffprobe = which('ffprobe');
  if (ffprobe) {
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', src,
      ], { encoding: 'utf8' });
      const dur = parseFloat(out.trim());
      if (Number.isFinite(dur) && dur < MIN_DURATION) {
        throw new Error(`sample is only ${dur.toFixed(1)}s — chatterbox needs at least ${MIN_DURATION}s (aim for 10–20s of clean speech)`);
      }
    } catch (e) {
      if (e.message.includes('sample is only')) throw e;
    }
  }

  ensureSamplesDir(dir);
  const dest = path.join(dir, name + '.wav');

  // Normalize with ffmpeg: mono, 24kHz, voice-range EQ, peak-safe loudness.
  // Raw mic recordings often have stereo channels, clipping peaks, or room
  // noise that chatterbox rejects — this pass makes them clone-ready.
  const ffmpeg = which('ffmpeg');
  if (ffmpeg) {
    try {
      const { spawnSync } = require('child_process');
      const r = spawnSync('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-i', src,
        '-af', 'pan=mono|c0=0.5*c0+0.5*c1,highpass=f=65,lowpass=f=12000,loudnorm=I=-20:TP=-2:LRA=7',
        '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le',
        dest,
      ], { stdio: 'ignore' });
      if (r.status !== 0) {
        // ffmpeg failed — fall back to raw copy.
        fs.copyFileSync(src, dest);
      }
    } catch (_) {
      fs.copyFileSync(src, dest);
    }
  } else {
    fs.copyFileSync(src, dest);
  }
  return dest;
}

/* Remove a named sample from baseDir. Throws if not found. */
function removeSample(name, baseDir) {
  const dir = baseDir || SAMPLES_DIR;
  if (!name || typeof name !== 'string') throw new Error('sample name is required');
  // Samples are always saved as .wav after normalization.
  const p = path.join(dir, name + '.wav');
  if (fs.existsSync(p)) { fs.unlinkSync(p); return p; }
  // Check as-is for legacy non-normalized samples.
  const asIs = path.join(dir, name);
  if (fs.existsSync(asIs)) { fs.unlinkSync(asIs); return asIs; }
  throw new Error(`sample "${name}" not found in ${dir}`);
}

/* List all saved voice samples. Returns [{name, path, size, ext}]. */
function listSamples(baseDir) {
  const dir = baseDir || SAMPLES_DIR;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => VALID_EXTS.has(path.extname(f).toLowerCase()))
    .map(f => {
      const p = path.join(dir, f);
      const stat = fs.statSync(p);
      return { name: path.basename(f, path.extname(f)), path: p, size: stat.size, ext: path.extname(f).toLowerCase() };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { addSample, removeSample, listSamples };
