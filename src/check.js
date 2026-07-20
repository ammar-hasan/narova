'use strict';
/* Fast config check: summarize a resolved config and lint data-cue references.
 * No TTS, no Chrome, no writes — resolveConfig has already thrown on hard
 * errors, so everything here is a warning (exit stays 0). */

/* All data-cue attributes in a body, parsed leniently so we can flag junk. */
function cues(body) {
  const found = [];
  const re = /data-cue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
  let m;
  while ((m = re.exec(body)) !== null) found.push(m[1] ?? m[2] ?? m[3]);
  return found;
}

/* Print warnings + a one-line summary. Returns true (warnings never fail).
 * Cue semantics (player.js paintReveals): data-cue="k" reveals at turns[k],
 * a 0-based turn-start index; anything unresolvable falls back to t=0, so a
 * bad cue reveals at scene entry instead of syncing to a turn. */
function check(config) {
  const warnings = [];
  for (const s of config.scenes) {
    for (const raw of cues(s.body)) {
      const k = /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
      if (Number.isNaN(k)) {
        warnings.push(`scene "${s.id}": data-cue="${raw}" is not a number — it reveals at scene entry, not on a turn`);
      } else if (k >= s.vo.length) {
        warnings.push(`scene "${s.id}": data-cue="${raw}" but turns are indexed 0..${s.vo.length - 1} — it reveals at scene entry, not on a turn`);
      }
    }
  }
  for (const w of warnings) console.log(`warn: ${w}`);

  const turns = config.scenes.reduce((n, s) => n + s.vo.length, 0);
  const words = config.scenes.reduce((n, s) =>
    n + s.vo.reduce((m, t) => m + t.text.trim().split(/\s+/).length, 0), 0);
  const backends = [...new Set(Object.values(config.voices).map(v => v.backend))].join('+');
  console.log(`ok: "${config.title}" — ${config.scenes.length} scenes, ${turns} turns, ~${words} words (${config.size.w}x${config.size.h}, ${backends})`);
  return true;
}

module.exports = { check };
