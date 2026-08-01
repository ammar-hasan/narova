'use strict';
/* narova compose: config + out/timings.json + out/audio/full.wav -> out/hf/,
 * a self-contained HyperFrames project (index.html + project assets +
 * narration.wav + package.json). Regenerated from scratch every run — the
 * config, theme, and project assets are source; out/hf is never hand-edited. */
const fs = require('fs');
const path = require('path');
const { ensureDir, probe, sh } = require('../util');
const { HYPERFRAMES_VERSION } = require('../hf');
const { composeData } = require('./data');
const { composeCss } = require('./css');
const { composeDoc } = require('./html');
const { assertFreshCaptures } = require('../walkthrough');

function compose(config, outDir) {
  const timingsPath = path.join(outDir, 'timings.json');
  const fullWav = path.join(outDir, 'audio', 'full.wav');
  // External narration: no TTS synth needed — scenes carry explicit dur.
  const hasExternalNarration = !!(config.narrationSource && config.narrationSource.file);
  const needsTimings = hasExternalNarration && config.narrationSource.wordTimings;
  if (!hasExternalNarration && (!fs.existsSync(timingsPath) || !fs.existsSync(fullWav))) {
    throw new Error('compose needs out/timings.json and out/audio/full.wav — run `narova synth` first');
  }
  let timings = {};
  if (fs.existsSync(timingsPath)) {
    timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  }
  if (needsTimings) {
    // Synthesize minimal timing entries for scenes with external karaoke.
    const cues = config.narrationSource.wordTimings;
    let totalDur = 0;
    for (const s of config.scenes) totalDur += s.dur || 0;
    timings.total = totalDur;
    let cursor = 0;
    for (const s of config.scenes) {
      const sceneEnd = cursor + (s.dur || 0);
      const sceneCues = cues.filter(c => c.start < sceneEnd && c.end > cursor);
      const words = sceneCues.flatMap(c => c.words);
      timings[s.id] = { dur: s.dur || 0, words };
      cursor = sceneEnd;
    }
  } else if (!hasExternalNarration) {
    // Standard mode: validate timings.
  }
  if (!hasExternalNarration) assertFreshCaptures(config, timings, outDir);

  const size = config.size;
  const data = composeData(config, timings);
  const css = composeCss(config.theme || {}, config.voices, size, config.themeCss || '', config.mode);
  const html = composeDoc(config, size, data, css);

  const slugTitle = slug(config.title || 'narova');
  const hfDir = path.join(outDir, `hf-${slugTitle}`);
  // A clean rebuild matters for assets: deleting logo.svg from the source must
  // not leave a stale copy in the render project. Also remove any old hf-*
  // directories so renames don't accumulate stale projects.
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('hf-')) {
      fs.rmSync(path.join(outDir, entry.name), { recursive: true, force: true });
    }
  }
  ensureDir(hfDir);
  const assetsDir = ensureDir(path.join(hfDir, 'assets'));
  if (config.assetsDir) fs.cpSync(config.assetsDir, assetsDir, { recursive: true });
  // Copy and auto-loop per-scene b-roll clips. If a clip is shorter than
  // its scene, narova creates a looped version with ffmpeg so the renderer
  // doesn't stutter on boundary seeks.
  for (const s of config.scenes) {
    if (s.clip) {
      const ext = path.extname(s.clip).toLowerCase() || '.mp4';
      const dest = path.join(assetsDir, `clip-${s.id}${ext}`);
      const srcPath = path.resolve(config.projectDir, s.clip);
      fs.copyFileSync(srcPath, dest);
      const sceneDur = timings[s.id] ? timings[s.id].dur : 0;
      if (sceneDur > 0) {
        try {
          const clipDur = probe(srcPath);
          if (clipDur < sceneDur * 0.95) {
            const isWebm = ext === '.webm';
            sh('ffmpeg', [
              '-y', '-loglevel', 'error',
              '-stream_loop', '-1', '-i', srcPath,
              '-t', String(Math.ceil(sceneDur + 1)),
              '-an',
              ...(isWebm
                ? ['-c:v', 'libvpx-vp9', '-crf', '20', '-b:v', '0']
                : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20']),
              '-r', '30', '-g', '30', '-keyint_min', '30',
              '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
              '-movflags', '+faststart', dest,
            ]);
          }
        } catch { /* keep original clip if ffprobe/ffmpeg fails */ }
      }
    }
  }
  fs.writeFileSync(path.join(hfDir, 'index.html'), html);
  fs.writeFileSync(path.join(hfDir, 'style.css'), css);
  // Audio: external narration file, mix.wav, or full.wav (in that order).
  if (hasExternalNarration) {
    fs.copyFileSync(config.narrationSource.file, path.join(assetsDir, 'narration.wav'));
  } else {
    const mixWav = path.join(outDir, 'audio', 'mix.wav');
    fs.copyFileSync(fs.existsSync(mixWav) ? mixWav : fullWav, path.join(assetsDir, 'narration.wav'));
  }
  fs.writeFileSync(path.join(hfDir, 'package.json'), JSON.stringify({
    name: slug(config.title || 'narova'),
    private: true,
    devDependencies: { hyperframes: HYPERFRAMES_VERSION },
  }, null, 2) + '\n');

  return { dir: hfDir, total: data.total, scenes: data.scenes.length };
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'narova';
}

module.exports = { compose };
