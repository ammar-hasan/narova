'use strict';
/* ffmpeg assembly: concat per-scene wavs -> full.m4a, hold each captured frame for
 * (next_onset - onset), mux. No subtitles/ass filter (homebrew lacks libass —
 * LEARNINGS #11); captions are already baked into the frames. Assert frame-total ≈
 * audio-total before encoding (LEARNINGS #14). */
const fs = require('fs');
const path = require('path');
const { sh, probe, ensureDir } = require('../util');

/* Concatenate out/audio/NN.wav (scene order) into full.m4a. */
function buildFullAudio(audioDir, sceneNums, outFile, tmpDir) {
  ensureDir(tmpDir);
  const list = path.join(tmpDir, 'full_list.txt');
  fs.writeFileSync(list, sceneNums.map(n => `file '${path.join(audioDir, `${String(n).padStart(2, '0')}.wav`)}'\n`).join(''));
  sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
    '-c:a', 'aac', '-b:a', '192k', outFile]);
  return outFile;
}

/* Build the frame concat demuxer file: each frame held for next-onset minus onset,
 * last frame repeated (the demuxer needs the final file listed twice). */
function writeFramesConcat(framesDir, times, total, outFile) {
  const lines = [];
  for (let i = 0; i < times.length; i++) {
    const d = (i + 1 < times.length) ? (times[i + 1] - times[i]) : Math.max(0.2, total - times[i]);
    const png = path.join(framesDir, `${String(i).padStart(6, '0')}.png`);
    lines.push(`file '${png}'\nduration ${Math.max(0.03, round(d))}`);
  }
  lines.push(`file '${path.join(framesDir, `${String(times.length - 1).padStart(6, '0')}.png`)}'`);
  fs.writeFileSync(outFile, lines.join('\n') + '\n');
  return outFile;
}

const round = n => Math.round(n * 1000) / 1000;

/* Full assemble. Returns { mp4, seconds }. */
function assemble({ framesDir, times, total, audioDir, sceneNums, outDir, name = 'video.mp4', log = () => {} }) {
  const tmp = path.join(outDir, 'tmp');
  ensureDir(tmp);
  const full = path.join(outDir, 'full.m4a');
  buildFullAudio(audioDir, sceneNums, full, tmp);

  const audioTotal = probe(full);
  // Frame timeline total == sum of scene durs; assert it matches the concatenated audio.
  const drift = Math.abs(audioTotal - total);
  log(`frame-total ${total.toFixed(3)}s  audio-total ${audioTotal.toFixed(3)}s  drift ${drift.toFixed(3)}s`);
  if (drift > 0.5) {
    throw new Error(`frame/audio mismatch ${drift.toFixed(3)}s — would truncate under -shortest (LEARNINGS #14). ` +
      `Re-run synth so timings are rescaled to real audio duration (LEARNINGS #1).`);
  }

  const concatf = path.join(tmp, 'frames_concat.txt');
  writeFramesConcat(framesDir, times, total, concatf);

  const mp4 = path.join(outDir, name);
  sh('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0', '-i', concatf,
    '-i', full,
    '-map', '0:v', '-map', '1:a',
    '-r', '30', '-vsync', 'cfr', '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4]);

  return { mp4, seconds: probe(mp4) };
}

module.exports = { assemble, buildFullAudio, writeFramesConcat };
