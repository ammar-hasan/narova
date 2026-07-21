'use strict';
/* Fast config check: summarize a resolved config and lint scene bodies.
 * No TTS, no browser, no writes — resolveConfig has already thrown on hard
 * errors, so everything here is a warning (exit stays 0). */
const fs = require('fs');
const path = require('path');

// Ids the generated composition owns (src/compose/html.js + runtime.js).
const RESERVED_IDS = new Set(['root', 'bg', 'overlay', 'cap-stage', 'progress-bar', 'vo']);
const RESERVED_PREFIXES = ['scene-', 'capg-', 'capw-'];

/* Factual-claim sniffing for the grounding rule (references/url-to-source.md
 * §Claims ledger): a stat or superlative in the voiceover must be traceable to
 * the source. Heuristic — warnings only, never errors. */
const CLAIM_PATTERNS = [
  /\d[\d,.]*\s*(?:%|percent\b|x\b|\+|k\b|million\b|billion\b|users?\b|products?\b|customers?\b|downloads?\b|countries\b)/i,
  /\b(?:leading|best[- ]in[- ]class|industry[- ]first|world'?s first|largest|most popular|#1|number one|top-rated|half of)\b/i,
];

function findClaims(config) {
  const hits = [];
  for (const s of config.scenes) {
    s.vo.forEach((t, j) => {
      if (CLAIM_PATTERNS.some(re => re.test(t.text))) {
        hits.push(`scene "${s.id}" turn ${j}: "${t.text.length > 90 ? t.text.slice(0, 87) + '…' : t.text}"`);
      }
    });
  }
  return hits;
}

/* All opening tags in a body, with HTML comments stripped first — attributes
 * are only linted inside tags, never in visible prose. */
function tags(body) {
  return String(body).replace(/<!--[\s\S]*?-->/g, '').match(/<[a-zA-Z][^>]*>/g) || [];
}

function attr(tag, name) {
  const m = new RegExp(`(?<![-\\w])${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`).exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

function cssUrls(css) {
  const refs = [];
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]+))\s*\)/gi;
  let m;
  while ((m = re.exec(String(css))) !== null) refs.push(m[1] ?? m[2] ?? m[3]);
  return refs;
}

function inspectAssetRef(ref, config, at, warnings) {
  if (!ref || /^(?:data:|blob:|#|mailto:|tel:)/i.test(ref)) return;
  if (/^(?:https?:)?\/\//i.test(ref)) {
    warnings.push(`${at}: remote asset "${ref}" — download it into project assets/ before rendering`);
    return;
  }
  if (!ref.startsWith('assets/')) {
    warnings.push(`${at}: local asset "${ref}" must live under project assets/ and be referenced as assets/...`);
    return;
  }
  if (!config.assetsDir) {
    warnings.push(`${at}: "${ref}" is referenced but the project has no assets directory`);
    return;
  }
  const relative = ref.slice('assets/'.length).split(/[?#]/, 1)[0];
  const target = path.resolve(config.assetsDir, relative);
  const boundary = path.relative(config.assetsDir, target);
  if (!relative || boundary === '..' || boundary.startsWith(`..${path.sep}`) || path.isAbsolute(boundary)) {
    warnings.push(`${at}: asset path "${ref}" escapes project assets/`);
  } else if (!fs.existsSync(target)) {
    warnings.push(`${at}: asset not found: ${ref}`);
  }
}

/* Print warnings + a one-line summary. Returns true (warnings never fail).
 * Cue semantics (compose/runtime.js): data-cue="k" is coerced with +k and
 * looked up in turns[] (0-based) when it is a non-negative integer in range;
 * anything else falls back to scene entry. Mirror that coercion exactly —
 * never warn about a spelling the runtime resolves. */
function check(config) {
  const warnings = [];
  const ids = new Map();

  for (const s of config.scenes) {
    for (const t of tags(s.body)) {
      // Render-time network makes frames non-reproducible. Project media belongs
      // in assets/ (copied by compose) or in a small data URI / inline SVG.
      for (const name of ['src', 'poster']) {
        const ref = attr(t, name);
        if (ref != null) inspectAssetRef(ref, config, `scene "${s.id}" ${name}`, warnings);
      }
      const href = attr(t, 'href');
      if (/^(?:https?:)?\/\//i.test(href || '') || /^assets\//.test(href || '')) {
        inspectAssetRef(href, config, `scene "${s.id}" href`, warnings);
      }
      // cues
      if (/(?<![-\w])data-cue\s*=/.test(t)) {
        const raw = attr(t, 'data-cue');
        const k = +raw;
        if (!Number.isInteger(k) || k < 0) {
          warnings.push(`scene "${s.id}": data-cue="${raw}" does not resolve to a turn — it reveals at scene entry`);
        } else if (k >= s.vo.length) {
          warnings.push(`scene "${s.id}": data-cue="${raw}" but turns are indexed 0..${s.vo.length - 1} — it reveals at scene entry`);
        }
      } else if (/class\s*=\s*["'][^"']*\bcue\b/.test(t)) {
        warnings.push(`scene "${s.id}": class="cue" without data-cue — it animates at scene entry, not on a turn`);
      }
      // ids: page-unique, and must not collide with generated ids
      const id = attr(t, 'id');
      if (id != null) {
        if (RESERVED_IDS.has(id) || RESERVED_PREFIXES.some(p => id.startsWith(p))) {
          warnings.push(`scene "${s.id}": element id "${id}" collides with a generated composition id — rename it`);
        }
        if (ids.has(id)) warnings.push(`duplicate element id "${id}" in scenes "${ids.get(id)}" and "${s.id}" — ids must be page-unique`);
        else ids.set(id, s.id);
      }
    }
    for (const ref of cssUrls(s.body)) {
      inspectAssetRef(ref, config, `scene "${s.id}" inline style`, warnings);
    }
  }

  // theme.css animations run on the wall clock — the HyperFrames renderer seeks
  // frames, so an infinite animation produces nondeterministic output.
  if (/animation[^;{}]*\binfinite\b/.test(config.themeCss || '')) {
    warnings.push('theme.css uses "animation: … infinite" — not deterministic under frame rendering; move motion to data-cue/.reveal or drop it');
  }
  if (/(?:font-family|--[\w-]*(?:font|serif|sans|mono))\s*:[^;{}]*(?:Georgia|Times New Roman|Arial|Roboto)/i.test(config.themeCss || '')) {
    warnings.push('theme.css uses a named fallback font — HyperFrames may fetch it; use the bundled family plus serif/sans-serif/monospace unless the extra family is intentional');
  }
  for (const ref of cssUrls(config.themeCss || '')) {
    inspectAssetRef(ref, config, 'theme.css', warnings);
  }

  // Grounding: stats and superlatives in the vo need a claims ledger tracing
  // each one to the source (references/url-to-source.md §Claims ledger).
  const claims = findClaims(config);
  if (claims.length) {
    const dir = config.projectDir || '.';
    const hasLedger = ['claims.md', 'CLAIMS.md'].some(f => fs.existsSync(path.join(dir, f)));
    if (!hasLedger) {
      warnings.push(
        `vo contains ${claims.length} factual claim${claims.length === 1 ? '' : 's'} but the project has no claims.md ledger — ` +
        'tag each verbatim/paraphrase/inference against the source before synth (references/url-to-source.md):',
        ...claims.slice(0, 5).map(c => `  ${c}`),
      );
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
