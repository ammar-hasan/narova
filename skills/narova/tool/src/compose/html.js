'use strict';
/* Assembles the composition document. Follows the canonical standalone shape
 * from hyperframes-core/references/minimal-composition.md: root div directly in
 * <body> (no <template>), clips as DIRECT children of the root, audio as a
 * direct root child with framework-owned playback, one synchronous paused GSAP
 * timeline registered under the root's data-composition-id. */
const { runtimeScript } = require('./runtime');
const { threeHeadScripts, threeSceneBody, hasThreeScenes, hasThreeModels } = require('./three');
const path = require('path');
const { capturePaths, readCaptureManifest } = require('../walkthrough');

const fmt = n => String(Math.round(n * 1000) / 1000);

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* Build per-scene karaoke caption overlays from external word-timed cues.
 * Injected into scene bodies at compose time when config.narration.wordTimings
 * is set. Each cue gets a backdrop pill, a baseline text layer, and per-word
 * active layers that show one word in gold (hot) with the rest transparent (ghost). */
function buildKaraokeOverlays(config) {
  const cues = config.narrationSource?.wordTimings;
  if (!cues || !cues.length) return { css: '', overlays: null };

  const css = `
.narration-karaoke-pill{position:absolute;left:34px;right:34px;bottom:74px;z-index:20;min-height:128px;border-radius:28px;background:linear-gradient(180deg,rgba(3,8,18,.68),rgba(2,4,10,.91));border:1px solid rgba(236,202,120,.46);box-shadow:0 18px 55px rgba(0,0,0,.52),inset 0 1px 0 rgba(255,255,255,.09)}
.narration-karaoke-line{position:absolute;left:54px;right:54px;bottom:83px;z-index:21;min-height:110px;padding:10px 10px 19px;display:flex;flex-wrap:wrap;align-content:center;justify-content:center;column-gap:13px;row-gap:2px;color:#fffdf6;font-size:37px;font-weight:600;line-height:1.72;text-align:center;text-shadow:0 3px 8px rgba(0,0,0,.92),0 0 18px rgba(0,0,0,.48);white-space:normal}
.narration-karaoke-line span{display:inline-block}.narration-karaoke-active{z-index:22;user-select:none}.narration-karaoke-active .ghost{color:transparent;text-shadow:none}.narration-karaoke-active .hot{color:#ffd56a;transform:translateY(-1px) scale(1.055);text-shadow:0 0 8px rgba(255,203,83,.78),0 2px 7px rgba(0,0,0,.95)}`;

  function overlayForScene(sceneStart, sceneDur) {
    const sceneEnd = sceneStart + sceneDur;
    return cues.filter(c => c.start < sceneEnd && c.end > sceneStart).map((cue, ci) => {
      const start = Math.max(cue.start, sceneStart);
      const end = Math.min(cue.end, sceneEnd);
      const duration = Math.max(0.04, end - start);
      const tb = 3000 + ci * 12;
      const activeLayers = cue.words.map((w, wi) => {
        const ws = Math.max(w.start, sceneStart);
        const we = Math.min(w.end, sceneEnd);
        if (ws >= we) return '';
        const wordsHtml = cue.words.map((ww, idx) =>
          `<span class="${idx === wi ? 'hot' : 'ghost'}">${escapeHtml(ww.text)}</span>`).join(' ');
        return `<div class="narration-karaoke-line narration-karaoke-active" data-layout-ignore data-start="${fmt(ws)}" data-duration="${fmt(Math.max(0.04, we - ws))}" data-track-index="${tb + 2 + wi}">${wordsHtml}</div>`;
      }).join('');
      const baseWords = cue.words.map(w => `<span>${escapeHtml(w.text)}</span>`).join(' ');
      return `<div class="narration-karaoke-pill" data-start="${fmt(start)}" data-duration="${fmt(duration)}" data-track-index="${tb}"></div><div class="narration-karaoke-line" data-start="${fmt(start)}" data-duration="${fmt(duration)}" data-track-index="${tb + 1}">${baseWords}</div>${activeLayers}`;
    }).join('');
  }

  return { css, overlayForScene };
}

/* Every scene body lands on ONE page, so a hand-authored global-id rule would
 * make reusable SVG (gradient/filter <defs>, symbols) impossible across
 * scenes. Instead, compose namespaces each body's ids to `<sceneId>--<id>` and
 * rewrites the body's own fragment references to match: url(#…), href="#…",
 * for="…", and aria-labelledby/describedby token lists. Bodies without ids
 * pass through byte-identical. Ids stay unique WITHIN a scene — check.js lints
 * that. */
function namespaceIds(body, sceneId) {
  const src = String(body);
  const ids = [...new Set([...src.matchAll(/(?<![-\w])id\s*=\s*(?:"([^"\s]+)"|'([^'\s]+)')/g)]
    .map(m => m[1] ?? m[2]))];
  if (!ids.length) return src;
  const alt = ids.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const ns = (m, pre, id, post) => pre + sceneId + '--' + id + post;
  return src
    .replace(new RegExp(`(?<![-\\w])(id\\s*=\\s*["'])(${alt})(["'])`, 'g'), ns)
    .replace(new RegExp(`(url\\(#)(${alt})(\\))`, 'g'), ns)
    .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*["']#)(${alt})(["'])`, 'g'), ns)
    .replace(new RegExp(`(?<![-\\w])(for\\s*=\\s*["'])(${alt})(["'])`, 'g'), ns)
    .replace(/(aria-(?:labelledby|describedby)\s*=\s*["'])([^"']*)(["'])/g,
      (m, pre, val, post) => pre + val.split(/\s+/)
        .map(tok => (ids.includes(tok) ? `${sceneId}--${tok}` : tok)).join(' ') + post);
}

/* Full index.html for the generated project. `data` is composeData() output,
 * `css` the composeCss() stylesheet. */
function composeDoc(config, size, data, css) {
  const title = escapeHtml(config.title || 'narova');
  const nn = String(data.scenes.length).padStart(2, '0');
  // Page furniture is optional. resolveConfig has already turned `chrome:false`
  // into an explicit { topbar:false, counter:false, progress:false } object, so
  // here we only merge that resolved object over the all-on default.
  const chrome = { topbar: true, counter: true, progress: true, ...(config.chrome || {}) };

  // External karaoke captions: build overlays and inject into scene bodies.
  const karaoke = buildKaraokeOverlays(config);
  const karaokeCss = karaoke.css; // empty string if no karaoke config

  // Build enriched scenes with karaoke overlays injected as trailing HTML.
  let sceneCursor = 0;
  const enrichedScenes = config.scenes.map(s => {
    const dur = s.dur || 0;
    const overlay = karaoke.overlayForScene ? karaoke.overlayForScene(sceneCursor, dur) : '';
    let body = String(s.body || '');
    if (s.three) {
      body = threeSceneBody(s, { start: sceneCursor, dur }, size.w, size.h) + (body || '');
    }
    sceneCursor += dur;
    return { ...s, body: body + overlay };
  });

  // B-roll video clips must be direct children of the composition root so
  // HyperFrames can discover and seek them. Place them alongside scene clips
  // with the same start/duration; z-index puts them behind the HTML overlay.
  const captureManifests = Object.fromEntries(
    Object.keys(config.walkthroughs || {}).map(id => [id, readCaptureManifest(config, id)]),
  );
  const mediaClips = enrichedScenes.map((s, i) => {
    const sc = data.scenes[i];
    const id = escapeHtml(s.id);
    if (s.walkthrough) {
      const ref = s.walkthrough;
      const capture = captureManifests[ref.id];
      const capturedScene = capture && capture.timeline && capture.timeline.scenes
        ? capture.timeline.scenes.find(item => item.id === s.id)
        : null;
      if (!capture || !capturedScene) {
        throw new Error(`walkthrough "${ref.id}" capture manifest has no timing for scene "${s.id}"`);
      }
      const mediaStart = (capture.timeline.sourceOrigin ?? capture.timeline.preRoll ?? 0)
        + capturedScene.start;
      const position = `${fmt(ref.position.x * 100)}% ${fmt(ref.position.y * 100)}%`;
      const source = capturePaths(config, ref.id).assetRecording;
      return `  <video id="walkthrough-${id}" class="walkthrough-media walkthrough-${ref.layout}" src="${escapeHtml(source)}" data-start="${fmt(sc.start)}" data-duration="${fmt(sc.dur)}" data-media-start="${fmt(mediaStart)}" data-track-index="${200 + i}" muted playsinline preload="auto" style="--walkthrough-opacity:${fmt(ref.opacity)};--walkthrough-position:${position};object-fit:${ref.fit}"></video>`;
    }
    if (!s.clip) return '';
    const ext = escapeHtml(path.extname(s.clip));
    return `  <video id="broll-${id}" class="broll" src="assets/clip-${id}${ext}" data-start="${fmt(sc.start)}" data-duration="${fmt(sc.dur)}" data-track-index="${100 + i}" muted loop playsinline preload="auto"></video>`;
  }).filter(Boolean).join('\n');

  const sceneClips = enrichedScenes.map((s, i) => {
    const sc = data.scenes[i];
    const track = Math.floor(i / 3) + 1;
    const bar = chrome.topbar
      ? `<div class="topbar"><div class="wordmark"><b>${title}</b></div>${
        chrome.counter ? `<div class="counter">${String(i + 1).padStart(2, '0')} / ${nn}</div>` : ''}</div>`
      : '';
    const walkthroughClass = s.walkthrough
      ? ` has-walkthrough walkthrough-layout-${s.walkthrough.layout}`
      : '';
    let walkthroughShell = '';
    if (s.walkthrough && s.walkthrough.layout === 'window') {
      const flow = config.walkthroughs[s.walkthrough.id];
      let host = '';
      try { host = new URL(flow.url).host; } catch { /* validated by schema */ }
      walkthroughShell = `<div class="walkthrough-shell" aria-hidden="true">
      <div class="walkthrough-titlebar"><span class="walkthrough-dots"><i></i><i></i><i></i></span><span>${escapeHtml(flow.title)}</span><small>${escapeHtml(host)}</small></div>
    </div>`;
    }
    return `  <section id="scene-${s.id}" class="clip scene${walkthroughClass}" data-start="${fmt(sc.start)}" data-duration="${fmt(sc.dur)}" data-track-index="${track}">
    ${walkthroughShell}
    <div class="chrome">
      ${bar}
      <div class="canvas"><div class="scenebody">${namespaceIds(s.body, s.id)}</div></div>
    </div>
  </section>`;
  }).join('\n');

  // JSON inlined into a <script> — escape "<" so "</script>" in a token can't
  // terminate the block early.
  const dataJson = JSON.stringify(data).replace(/</g, '\\u003c');

  // The caption preset is carried twice: in DATA (runtime.js picks its word
  // tweens off it) and as a cap-preset-* class on the stage (css.js picks its
  // static styles off the class). Both derive from the same resolved config.
  const capPreset = (config.captions && config.captions.preset) || 'karaoke';

  const seriesBadge = config.series
    ? `<div class="series-badge">Part ${config.series.part}${config.series.total ? ` / ${config.series.total}` : ''}</div>`
    : '';

  const useThree = hasThreeScenes(config);
  const threeScripts = useThree ? threeHeadScripts(hasThreeModels(config)) : '';

  return `<!doctype html>
<!-- GENERATED by narova compose — do not edit. Source of truth: reel.config. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${size.w}, height=${size.h}">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>${threeScripts}
  <link rel="stylesheet" href="style.css">${karaokeCss ? '\n  <style>' + karaokeCss + '</style>' : ''}
</head>
<body>
<div id="root" data-composition-id="main" data-start="0"
     data-width="${size.w}" data-height="${size.h}" data-duration="${fmt(data.total)}">
  <div id="bg" class="stage"></div><!-- class="stage" kept so pre-0.3.0 theme.css background rules still apply -->
${mediaClips}
${sceneClips}
  <section id="overlay" class="clip overlay" data-start="0" data-duration="${fmt(data.total)}" data-track-index="1000">
    <div class="capzone"><div id="cap-stage" class="cap-preset-${capPreset}" style="position:relative;height:100%"></div></div>
    ${chrome.progress ? '<div class="progress"><i id="progress-bar"></i></div>' : ''}
    ${seriesBadge}
  </section>
  <audio id="vo" src="assets/narration.wav" data-start="0" data-track-index="1001"></audio>
</div>
<script>
var DATA = ${dataJson};
${runtimeScript()}
</script>
</body>
</html>
`;
}

module.exports = { composeDoc, escapeHtml, namespaceIds };
