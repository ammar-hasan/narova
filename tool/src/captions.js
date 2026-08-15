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
 * existing out/timings.json. Throws if timings.json is missing/unreadable.
 *
 * NAR-017-018 — empty-derivation guard: when derivation yields zero cue
 * groups while narration audio exists, an empty sidecar is never published
 * silently. The sidecars are omitted, the reason is recorded in
 * out/captions-omitted.json (which release check honors), and the omission is
 * reported in the return value for the build log. */
function writeCaptions(config, outDir) {
  const timings = JSON.parse(fs.readFileSync(path.join(outDir, 'timings.json'), 'utf8'));
  const data = composeData(config, timings);
  const srt = path.join(outDir, 'captions.srt');
  const vtt = path.join(outDir, 'captions.vtt');
  const audioPath = path.join(outDir, 'audio', 'full.wav');
  const hasNarrationAudio = fs.existsSync(audioPath);
  if (data.groups.length === 0 && hasNarrationAudio) {
    for (const f of [srt, vtt]) fs.rmSync(f, { force: true });
    const omissionPath = path.join(outDir, 'captions-omitted.json');
    const reason = 'caption derivation produced an empty sentence set while narration audio exists — timing/alignment evidence is missing or empty';
    fs.writeFileSync(omissionPath, JSON.stringify({ reason, cues: 0, at: new Date().toISOString() }, null, 2) + '\n');
    return { srt, vtt, cues: 0, omitted: true, reason, omissionPath };
  }
  fs.rmSync(path.join(outDir, 'captions-omitted.json'), { force: true });
  fs.writeFileSync(srt, buildSrt(data));
  fs.writeFileSync(vtt, buildVtt(data));
  return { srt, vtt, cues: data.groups.length };
}

module.exports = { stamp, buildSrt, buildVtt, writeCaptions };
