'use strict';
/* Auto-derive scene durations from word-timed karaoke data.
 * Reads a reel.config.* and a karaoke JSON file, prints suggested scene
 * durations aligned to the word timings. Use with --apply to rewrite the config. */

const fs = require('fs');
const path = require('path');

/* Given scene start/cue boundaries and word timing data, compute the
 * scene duration that ends at a natural cue boundary (or nearest word end). */
function retimeScenes(scenes, cues, opts = {}) {
  const snap = opts.snap || 'cue'; // 'cue' | 'word' — what boundary to snap to
  const pad = opts.pad || 0.2;     // extra seconds after the last word
  let cursor = 0;
  const results = [];

  for (let si = 0; si < scenes.length; si++) {
    const s = scenes[si];
    if (!s.dur) continue; // keep existing

    // Find cues that overlap the current time window plus lookahead.
    const lookahead = Math.max(0, s.dur || 2);
    const sceneEndEstimate = cursor + lookahead * 1.5;
    const relevant = cues.filter(c => c.start >= cursor && c.end <= sceneEndEstimate);

    let endTime = cursor + (s.dur || 2); // fallback

    if (relevant.length > 0) {
      if (snap === 'cue') {
        // Snap to the end of the last cue that fits within lookahead.
        const fitting = relevant.filter(c => c.end <= sceneEndEstimate);
        if (fitting.length > 0) {
          endTime = fitting[fitting.length - 1].end + pad;
        } else {
          endTime = relevant[0].start + pad;
        }
      } else {
        // Snap to the end of the last word.
        const allWords = relevant.flatMap(c => c.words);
        if (allWords.length > 0) {
          const lastWord = allWords[allWords.length - 1];
          endTime = lastWord.end + pad;
        }
      }
    }

    endTime = Math.round(endTime * 1000) / 1000;
    results.push({ id: s.id, from: s.dur, to: endTime - cursor, start: cursor, end: endTime });
    cursor = endTime;
  }

  return results;
}

/* Read a reel.config.* file, parse out scene definitions, and return them. */
function readConfigScenes(configPath) {
  const abs = path.resolve(configPath);
  const configText = fs.readFileSync(abs, 'utf8');

  // Extract scenes array text for re-writing.
  const sceneMatch = configText.match(/scenes\s*:\s*\[/);
  if (!sceneMatch) throw new Error('could not find scenes array in config');

  return { text: configText, path: abs, sceneStart: sceneMatch.index };
}

/* Print a retiming plan. With --apply, rewrite the scene durations in-place. */
function retime(configPath, karaokePath, opts = {}) {
  const configText = fs.readFileSync(path.resolve(configPath), 'utf8');
  const cues = JSON.parse(fs.readFileSync(path.resolve(karaokePath), 'utf8'));

  // Parse scene durations from config text.
  const durRe = /dur\s*:\s*([\d.]+)/g;
  const durs = [];
  let m;
  while ((m = durRe.exec(configText)) !== null) {
    durs.push(parseFloat(m[1]));
  }

  // Parse scene IDs from config text.
  const idRe = /id\s*:\s*"([^"]+)"/g;
  const ids = [];
  while ((m = idRe.exec(configText)) !== null) {
    ids.push(m[1]);
  }

  const scenes = ids.map((id, i) => ({ id, dur: durs[i] || 2 }));
  const plan = retimeScenes(scenes, cues, opts);

  const log = opts.log || console.log;
  log('scene  │  current  →  proposed  │  start');
  log('───────┼────────────────────────┼────────');
  for (const r of plan) {
    const arrow = r.from !== r.to ? '→' : '=';
    log(`${r.id.padEnd(7)} │  ${String(r.from).padStart(5)}s  ${arrow}  ${String(r.to.toFixed(2)).padStart(6)}s  │  ${r.start.toFixed(1)}s`);
  }

  if (opts.apply) {
    // Rewrite each dur value in-place, from LAST to FIRST to preserve positions.
    const sorted = [...plan].sort((a, b) => {
      const aIdx = configText.indexOf(`dur: ${a.from}`);
      const bIdx = configText.indexOf(`dur: ${b.from}`);
      return (bIdx === -1 ? 0 : bIdx) - (aIdx === -1 ? 0 : aIdx);
    });
    let out = configText;
    for (const r of sorted) {
      // Match dur: <number> but not dur: <number>.<number> to avoid matching a
      // decimal suffix as part of the previous integer replacement.
      const durReLocal = new RegExp(`(dur\\s*:\\s*)${r.from}(?![\\d.])`);
      const match = durReLocal.exec(out);
      if (!match) {
        log(`warn: could not find dur: ${r.from} for scene "${r.id}"`);
        continue;
      }
      const before = out.slice(0, match.index + match[1].length);
      const after = out.slice(match.index + match[0].length);
      out = before + r.to.toFixed(2) + after;
    }
    fs.writeFileSync(path.resolve(configPath), out);
    log(`\napplied: ${path.basename(configPath)} updated`);
  } else {
    log('\n--apply to rewrite scene durations in config');
  }

  return plan;
}

module.exports = { retime, retimeScenes };
