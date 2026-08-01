'use strict';
/* Generate word-timed karaoke JSON + SRT from an audio file + transcript.
 * Uses the narova Python alignment pipeline (faster-whisper / whisper-cpp)
 * to get word-level timestamps, then maps a clean transcript onto them
 * via SequenceMatcher when the texts differ. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findPython, TOOL_ROOT } = require('./pipeline');

/* Run the Python whisper alignment script on an audio file.
 * Returns word-level timings: [{ w: "word", t0: 0.12, t1: 0.45 }] */
function transcribeAudio(audioPath, opts = {}) {
  const py = findPython(opts.projectDir);
  const scriptPath = path.join(TOOL_ROOT, 'py', 'narova_karaoke.py');
  const args = ['-u', scriptPath,
    '--audio', path.resolve(audioPath),
    '--out', opts.outDir || path.dirname(audioPath),
  ];
  if (opts.transcript) args.push('--transcript', path.resolve(opts.transcript));
  if (opts.engine) args.push('--engine', opts.engine);

  const pyPath = path.join(TOOL_ROOT, 'py');
  const r = spawnSync(py, args, {
    stdio: 'pipe',
    env: { ...process.env, PYTHONPATH: pyPath },
    encoding: 'utf8',
  });

  if (r.error) throw new Error(`whisper alignment failed: ${r.error.message}`);
  if (r.status !== 0) {
    const stderr = (r.stderr || '').trim();
    throw new Error(`whisper alignment exited ${r.status}${stderr ? ': ' + stderr : ''}`);
  }
  return r.stdout;
}

/* Build karaoke JSON cues from flat word timings.
 * Groups words into ~5-8 word cues with max 4.5s duration. */
function buildCues(words, opts = {}) {
  const maxWords = opts.maxWords || 8;
  const maxDur = opts.maxDur || 4.5;
  const cues = [];
  let i = 0;
  while (i < words.length) {
    const start = words[i].t0;
    let end = start;
    let chunk = [];
    // Collect words until we hit maxWords or maxDur.
    for (let j = i; j < words.length && (j - i) < maxWords; j++) {
      const candidateEnd = words[j].t1;
      if (j > i && (candidateEnd - start) > maxDur) break;
      chunk.push({ text: words[j].w, start: words[j].t0, end: words[j].t1 });
      end = words[j].t1;
      i = j + 1;
    }
    if (chunk.length === 0) { i++; continue; }
    // Ensure sequential word highlights (no two words at once).
    for (let wi = 1; wi < chunk.length; wi++) {
      const prevEnd = chunk[wi - 1].end;
      if (chunk[wi].start < prevEnd + 0.04) chunk[wi].start = prevEnd + 0.04;
      if (chunk[wi].end < chunk[wi].start + 0.03) chunk[wi].end = chunk[wi].start + 0.03;
    }
    // De-conflict cue boundaries.
    if (cues.length > 0 && cues[cues.length - 1].end > start) {
      cues[cues.length - 1].end = Math.min(cues[cues.length - 1].end, start - 0.02);
    }
    cues.push({
      start: Math.round(start * 1000) / 1000,
      end: Math.round(end * 1000) / 1000,
      text: chunk.map(w => w.text).join(' '),
      words: chunk.map(w => ({
        text: w.text,
        start: Math.round(w.start * 1000) / 1000,
        end: Math.round(w.end * 1000) / 1000,
      })),
    });
    // Reset i if chunk collection didn't advance it.
    if (i <= chunk.length) i = chunk.length;
  }
  return cues;
}

/* Generate SRT from karaoke cues. */
function buildSrt(cues) {
  const stamp = (s, sep) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(3);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(6, '0')}`.replace('.', sep);
  };
  return cues.map((cue, i) =>
    `${i + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cue.text}\n`
  ).join('\n');
}

/* Parse the Python JSON output line from narova_karaoke.py.
 * Expected format: a JSON array of { w, t0, t1 } objects, one per line. */
function parseWordTimings(stdout) {
  // The script prints one JSON line per word or a single JSON array.
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  // Try as a single JSON array first.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length && parsed[0].w) return parsed;
  } catch {}
  // Fallback: parse line-by-line JSON objects.
  const words = [];
  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    try {
      const obj = JSON.parse(l);
      if (obj.w && obj.t0 != null) words.push(obj);
    } catch {}
  }
  return words.length ? words : null;
}

/* Main entry: transcribe -> build cues -> write outputs.
 * Returns { karaokePath, srtPath, cues }. */
function generateKaraoke(audioPath, opts = {}) {
  const outDir = opts.outDir || path.dirname(audioPath);
  const baseName = opts.name || path.basename(audioPath, path.extname(audioPath));
  const log = opts.log || console.log;

  log(`transcribing ${path.basename(audioPath)}...`);
  const stdout = transcribeAudio(audioPath, {
    projectDir: opts.projectDir,
    transcript: opts.transcript,
    engine: opts.engine,
    outDir: outDir,
  });

  const words = parseWordTimings(stdout);
  if (!words || !words.length) {
    throw new Error('no word timings found — whisper may not have detected speech');
  }
  log(`  ${words.length} words timed`);

  // If a clean transcript was provided, the Python script already did mapping.
  // Build cues from the aligned words.
  const cues = buildCues(words, { maxWords: opts.maxWords, maxDur: opts.maxDur });
  log(`  ${cues.length} karaoke cues`);

  // Write karaoke JSON.
  const karaokePath = path.join(outDir, `${baseName}-karaoke.json`);
  fs.writeFileSync(karaokePath, JSON.stringify(cues, null, 2) + '\n');
  log(`karaoke JSON -> ${karaokePath}`);

  // Write SRT.
  const srtPath = path.join(outDir, `${baseName}-captions.srt`);
  fs.writeFileSync(srtPath, buildSrt(cues));
  log(`captions SRT -> ${srtPath}`);

  return { karaokePath, srtPath, cues };
}

module.exports = { generateKaraoke, buildCues, buildSrt, parseWordTimings };
