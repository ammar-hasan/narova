'use strict';
/* Fast config check: summarize a resolved config and lint scene bodies.
 * No TTS, no browser, no writes — resolveConfig has already thrown on hard
 * errors, so everything here is a warning (exit stays 0). */
const fs = require('fs');
const path = require('path');

// Ids the generated composition owns (src/compose/html.js + runtime.js).
const RESERVED_IDS = new Set(['root', 'bg', 'overlay', 'cap-stage', 'progress-bar', 'vo']);
const RESERVED_PREFIXES = ['scene-', 'capg-', 'capw-'];

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

  for (const w of warnings) console.log(`warn: ${w}`);

  const turns = config.scenes.reduce((n, s) => n + s.vo.length, 0);
  const words = config.scenes.reduce((n, s) =>
    n + s.vo.reduce((m, t) => m + t.text.trim().split(/\s+/).length, 0), 0);
  const backends = [...new Set(Object.values(config.voices).map(v => v.backend))].join('+');
  console.log(`ok: "${config.title}" — ${config.scenes.length} scenes, ${turns} turns, ~${words} words (${config.size.w}x${config.size.h}, ${backends})`);
  return true;
}

module.exports = { check };
