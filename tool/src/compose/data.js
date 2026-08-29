'use strict';
/* timings.json (scene-local seconds) -> the global-time DATA object inlined into
 * the composition. All rounding is 3 decimals, and scene starts are a cumulative
 * sum of ALREADY-ROUNDED durations so start[i+1] === start[i] + dur[i] exactly —
 * HyperFrames lints same-track overlap, and float noise would trip it. */

const r3 = n => Math.round(n * 1000) / 1000;

/* Emphasis matching (config.captions.emphasis): strip surrounding punctuation
 * and symbols from BOTH the config words and the spoken tokens, then compare
 * case-insensitively — so "world." in the transcript matches emphasis "World".
 * The same normalization must be applied to both sides. */
const normWord = s => String(s).toLowerCase()
  .replace(/^[\p{P}\p{S}]+/u, '').replace(/[\p{P}\p{S}]+$/u, '');

/* Build { total, scenes, groups, preset } from the resolved config +
 * timings.json.
 * scenes[i]: { id, start, dur, turns, sentences, transition? }  (turns stay
 * scene-local; resolved sentence/word cue spans use composition coordinates;
 * transition passes through from the scene config)
 * groups[i]: { who, label, start, end, words:[{w,t0,t1,kw?}] }  (global time,
 * one per sentence — the caption "line" unit, same grouping the old player
 * used via si; kw=1 marks an emphasis keyword)
 * preset: the caption style preset name (runtime + css key their look off it). */
function composeData(config, timings, captionsEnabled = true) {
  const captions = config.captions || {};
  const emphasis = new Set((captions.emphasis || []).map(normWord));
  const maxWords = Number.isInteger(captions.maxWords) ? captions.maxWords : Infinity;

  const scenes = [];
  let acc = 0;
  for (const s of config.scenes) {
    const t = timings[s.id];
    if (!t) throw new Error(`timings.json: no entry for scene "${s.id}" — re-run narova synth`);
    scenes.push({
      id: s.id, start: r3(acc), dur: t.dur, turns: t.turns || [],
      ...(s.transition ? { transition: s.transition } : {}),
    });
    acc = r3(acc + t.dur);
  }
  const total = acc;

  const groups = [];
  for (const sc of scenes) {
    const t = timings[sc.id];
    const groupWords = words => {
      const grouped = new Map();
      for (const w of words) {
        if (!grouped.has(w.si)) grouped.set(w.si, []);
        grouped.get(w.si).push(w);
      }
      return grouped;
    };
    const by = groupWords(t.words || []);
    // A compatibility-only external browser projection may retain raw caption
    // words while cueWords carries their normalized timing view. Ordinary
    // synthesized timing uses the same collection for both consumers.
    if (t.cueWords != null && !Array.isArray(t.cueWords)) {
      throw new Error(`timings.json: cueWords for scene "${sc.id}" must be an array`);
    }
    const cueBy = t.cueWords ? groupWords(t.cueWords) : by;
    // Cue evidence is independent of caption visibility and maxWords chunking.
    // Keep sentence identity and word order exactly as timings.json provides
    // them; lookup validation in runtime reports absent or unusable evidence.
    sc.sentences = [...cueBy.entries()].map(([si, ws]) => ({
      sentenceIndex: si,
      words: ws.map(w => ({
        token: w.w,
        speaker: w.who,
        start: r3(sc.start + w.t0),
        end: r3(sc.start + w.t1),
      })),
    }));
    for (const [si, ws] of by.entries()) {
      const who = ws[0].who;
      const label = (config.voices[who] && config.voices[who].label) || who;
      // Chunk long sentences into maxWords-sized caption lines (bilingual content).
      for (let offset = 0; offset < ws.length; offset += maxWords) {
        const chunk = ws.slice(offset, offset + maxWords);
        groups.push({
          who, si,
          label,
          start: r3(sc.start + chunk[0].t0),
          sceneEnd: r3(sc.start + sc.dur),
          words: chunk.map(w => {
            const word = { w: w.w, t0: r3(sc.start + w.t0), t1: r3(sc.start + w.t1) };
            if (emphasis.size && emphasis.has(normWord(w.w))) word.kw = 1;
            return word;
          }),
        });
      }
    }
  }
  groups.sort((a, b) => a.start - b.start);
  // A caption group stays visible until the next group starts or its scene ends.
  // This prevents captions from bleeding into a silent end card.
  groups.forEach((g, i) => {
    const next = groups[i + 1];
    g.end = next ? Math.min(next.start, g.sceneEnd) : g.sceneEnd;
    delete g.sceneEnd;
  });

  return {
    total, scenes, groups,
    preset: captionsEnabled ? (captions.preset || 'subtitle') : false,
    captionPresentation: {
      plate: captions.plate === true,
      size: captions.size != null ? captions.size : Math.min(30, Math.max(17, (config.size?.w || 1280) * 0.027)),
    },
    markers: config.markers || {},
  };
}

module.exports = { composeData, r3, normWord };
