'use strict';

/* Internal timing facts. Compatibility profiles are explicit here: external
 * artifact overlap uses a microsecond tolerance; the legacy browser projection
 * retains strict overlap, raw caption words and absent numeric turns. */
const round3 = value => Math.round(value * 1000) / 1000;

function sceneAnchors(scenes, duration, { roundEach = false } = {}) {
  const starts = new Map();
  let total = 0;
  for (const scene of scenes) {
    starts.set(scene.id, round3(total));
    const next = total + duration(scene);
    total = roundEach ? round3(next) : next;
  }
  return { starts, total };
}

function effectAnchor(starts, scene, offset) {
  const start = scene == null ? 0 : starts.get(scene);
  return { start, time: Number.isFinite(start) ? start + offset : null };
}

function externalTimings(config, { browser = false } = {}) {
  const source = config.narrationSource;
  if (browser && !(source && source.file && source.wordTimings)) return null;
  const entries = {};
  let cursor = 0;
  for (const scene of config.scenes) {
    const dur = scene.dur || 0;
    const end = browser ? cursor + dur : Math.round((cursor + dur) * 1e6) / 1e6;
    const tolerance = browser ? 0 : 1e-6;
    const cues = (source?.wordTimings || [])
      .filter(cue => cue.start < end - tolerance && cue.end > cursor + tolerance);
    const turns = scene.vo || [];
    const words = cues.flatMap((cue, si) => (cue.words || []).map(word => ({
      w: word.text || word.w || '',
      t0: Math.max(0, word.start - cursor),
      t1: Math.max(0, word.end - cursor),
      who: cue.who || turns[si]?.who || turns[0]?.who || Object.keys(config.voices || {})[0] || 'a',
      si,
    })));
    entries[scene.id] = browser
      ? { dur, words: cues.flatMap(cue => cue.words), cueWords: words }
      : {
        dur,
        turns: turns.map((turn, i) => cues[i]
          ? Math.max(0, cues[i].start - cursor)
          : i * dur / Math.max(1, turns.length)),
        words,
      };
    cursor = end;
  }
  return { total: browser ? cursor : round3(cursor), ...entries };
}

module.exports = { sceneAnchors, effectAnchor, externalTimings };
