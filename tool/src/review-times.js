'use strict';
/* Deterministic visual-review sampling. Scene motion sampling is intentionally
 * cheap; beat sampling is the production gate and captures both the arrival and
 * resolved state of every narration sentence/marker. */

const r3 = n => Math.round(n * 1000) / 1000;

function uniqueSorted(times, total = Infinity) {
  return [...new Set(times
    .filter(Number.isFinite)
    .map(t => r3(Math.max(0, Math.min(total, t)))))]
    .sort((a, b) => a - b);
}

function motionReviewTimes(data) {
  return uniqueSorted((data.scenes || []).flatMap(sc =>
    [0.1, 0.5, 0.9].map(p => sc.start + sc.dur * p)), data.total);
}

function beatReviewTimes(data) {
  const times = [];
  const coveredScenes = new Set();

  const scenes = data.scenes || [];
  for (const group of data.groups || []) {
    const scene = scenes.find((sc, index) => group.start >= sc.start
      && (group.start < sc.start + sc.dur
        || (index === scenes.length - 1 && group.start <= sc.start + sc.dur)));
    if (scene) coveredScenes.add(scene.id);
    const span = Math.max(0, group.end - group.start);
    const edge = Math.min(0.2, span / 3);
    times.push(group.start + edge, group.end - edge);
  }

  // Named markers are deliberate creative beats even in silent work. Review
  // both sides so a reveal/cut cannot hide between two otherwise clean frames.
  for (const marker of Object.values(data.markers || {})) {
    if (Number.isFinite(marker)) times.push(marker - 0.1, marker + 0.1);
  }

  // Silent scenes have no sentence groups. Preserve useful coverage rather
  // than returning no frames at all.
  for (const scene of scenes) {
    if (!coveredScenes.has(scene.id)) {
      times.push(scene.start + scene.dur * 0.1,
        scene.start + scene.dur * 0.5,
        scene.start + scene.dur * 0.9);
    }
  }

  return uniqueSorted(times, data.total);
}

module.exports = { beatReviewTimes, motionReviewTimes, uniqueSorted };
