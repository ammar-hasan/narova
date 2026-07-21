'use strict';
/* timings.json (scene-local seconds) -> the global-time DATA object inlined into
 * the composition. All rounding is 3 decimals, and scene starts are a cumulative
 * sum of ALREADY-ROUNDED durations so start[i+1] === start[i] + dur[i] exactly —
 * HyperFrames lints same-track overlap, and float noise would trip it. */

const r3 = n => Math.round(n * 1000) / 1000;

/* Build { total, scenes, groups } from the resolved config + timings.json.
 * scenes[i]: { id, start, dur, turns }  (turns stay scene-local; runtime adds start)
 * groups[i]: { who, label, start, end, words:[{w,t0,t1}] }  (global time, one per
 * sentence — the caption "line" unit, same grouping the old player used via si). */
function composeData(config, timings) {
  const scenes = [];
  let acc = 0;
  for (const s of config.scenes) {
    const t = timings[s.id];
    if (!t) throw new Error(`timings.json: no entry for scene "${s.id}" — re-run narova synth`);
    scenes.push({ id: s.id, start: r3(acc), dur: t.dur, turns: t.turns });
    acc = r3(acc + t.dur);
  }
  const total = acc;

  const groups = [];
  for (const sc of scenes) {
    const t = timings[sc.id];
    const by = new Map();
    for (const w of t.words) {
      if (!by.has(w.si)) by.set(w.si, []);
      by.get(w.si).push(w);
    }
    for (const ws of by.values()) {
      const who = ws[0].who;
      groups.push({
        who,
        label: (config.voices[who] && config.voices[who].label) || who,
        start: r3(sc.start + ws[0].t0),
        words: ws.map(w => ({ w: w.w, t0: r3(sc.start + w.t0), t1: r3(sc.start + w.t1) })),
      });
    }
  }
  groups.sort((a, b) => a.start - b.start);
  // A group stays on screen until the next group starts (or the video ends).
  groups.forEach((g, i) => { g.end = groups[i + 1] ? groups[i + 1].start : total; });

  return { total, scenes, groups };
}

module.exports = { composeData, r3 };
