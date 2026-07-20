'use strict';
/* Fast config check: summarize a resolved config and lint data-cue references.
 * No TTS, no Chrome, no writes — resolveConfig has already thrown on hard
 * errors, so everything here is a warning (exit stays 0). */

/* All data-cue attributes in a body, parsed leniently so we can flag junk.
 * HTML comments are stripped first ([data-cue] never matches inside them). */
function cues(body) {
  const found = [];
  const re = /(?<![-\w])data-cue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;
  let m;
  const html = body.replace(/<!--[\s\S]*?-->/g, '');
  while ((m = re.exec(html)) !== null) found.push(m[1] ?? m[2] ?? m[3]);
  return found;
}

/* Print warnings + a one-line summary. Returns true (warnings never fail).
 * Cue semantics (player.js paintReveals): data-cue="k" is coerced with +k and
 * looked up in turns[], a 0-based turn-start array; anything that doesn't land
 * on a turn falls back to t=0, i.e. the element reveals at scene entry instead
 * of syncing to a turn. Mirror that coercion exactly — never warn about a
 * spelling the player resolves (e.g. " 1 " or "1.0" both sync to turn 1). */
function check(config) {
  const warnings = [];
  for (const s of config.scenes) {
    for (const raw of cues(s.body)) {
      const k = +raw;
      if (!Number.isInteger(k) || k < 0) {
        warnings.push(`scene "${s.id}": data-cue="${raw}" does not resolve to a turn — it reveals at scene entry`);
      } else if (k >= s.vo.length) {
        warnings.push(`scene "${s.id}": data-cue="${raw}" but turns are indexed 0..${s.vo.length - 1} — it reveals at scene entry`);
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
