'use strict';
/* Caption export: sentence-level cues in GLOBAL time -> SRT + WebVTT.
 * One cue per sentence group (composeData's caption "line" unit) — never
 * word-per-word. Adjacent cues may touch (end === next start); that is valid
 * in both formats. */
const fs = require('fs');
const path = require('path');
const { composeData } = require('./compose/data');

const pad = (n, w = 2) => String(n).padStart(w, '0');

/* seconds -> "HH:MM:SS<sep>mmm" (sep "," for SRT, "." for WebVTT). */
function stamp(s, sep) {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(sec)}${sep}${pad(ms % 1000, 3)}`;
}

const cueText = g => g.words.map(w => w.w).join(' ');

/* data (from composeData) -> SRT text: numbered cues, comma millis. */
function buildSrt(data) {
  return data.groups.map((g, i) =>
    `${i + 1}\n${stamp(g.start, ',')} --> ${stamp(g.end, ',')}\n${cueText(g)}\n`
  ).join('\n');
}

/* data (from composeData) -> WebVTT text: WEBVTT header, dot millis. */
function buildVtt(data) {
  return 'WEBVTT\n\n' + data.groups.map(g =>
    `${stamp(g.start, '.')} --> ${stamp(g.end, '.')}\n${cueText(g)}\n`
  ).join('\n');
}

/* Write out/captions.srt + out/captions.vtt from the resolved config and the
 * existing out/timings.json. Throws if timings.json is missing/unreadable. */
function writeCaptions(config, outDir) {
  const timings = JSON.parse(fs.readFileSync(path.join(outDir, 'timings.json'), 'utf8'));
  const data = composeData(config, timings);
  const srt = path.join(outDir, 'captions.srt');
  const vtt = path.join(outDir, 'captions.vtt');
  fs.writeFileSync(srt, buildSrt(data));
  fs.writeFileSync(vtt, buildVtt(data));
  return { srt, vtt, cues: data.groups.length };
}

module.exports = { stamp, buildSrt, buildVtt, writeCaptions };
