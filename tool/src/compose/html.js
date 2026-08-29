'use strict';
/* Assembles the composition document. Follows the canonical standalone shape
 * from hyperframes-core/references/minimal-composition.md: root div directly in
 * <body> (no <template>), clips as DIRECT children of the root, audio as a
 * direct root child with framework-owned playback, one synchronous paused GSAP
 * timeline registered under the root's data-composition-id. */
const { runtimeScript } = require('./runtime');
const { threeHeadScripts, threeSceneBody, threeModuleSceneBody, hasThreeScenes, hasThreeModels } = require('./three');
const { authorReadyScript, collectMainAuthorJavaScript, escapeInlineScript, renderMainAuthorJavaScript } = require('../author-js');
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

  // overlayForScene(sceneStart, sceneDur, offset=0): filtering always uses the
  // GLOBAL cue coordinates (sceneStart is the scene's global start), but emitted
  // data-start values are reduced by `offset` so a per-scene isolated project —
  // whose timeline is rebased to t=0 — gets scene-local timestamps. The full
  // render passes offset=0 (its timeline is already global); the per-scene
  // render passes offset=globalStart. Durations are differences, so they are
  // unaffected by the offset.
  function overlayForScene(sceneStart, sceneDur, offset = 0) {
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
        return `<div class="narration-karaoke-line narration-karaoke-active" data-layout-ignore data-start="${fmt(ws - offset)}" data-duration="${fmt(Math.max(0.04, we - ws))}" data-track-index="${tb + 2 + wi}">${wordsHtml}</div>`;
      }).join('');
      const baseWords = cue.words.map(w => `<span>${escapeHtml(w.text)}</span>`).join(' ');
      return `<div class="narration-karaoke-pill" data-start="${fmt(start - offset)}" data-duration="${fmt(duration)}" data-track-index="${tb}"></div><div class="narration-karaoke-line" data-start="${fmt(start - offset)}" data-duration="${fmt(duration)}" data-track-index="${tb + 1}">${baseWords}</div>${activeLayers}`;
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
  const enrichedScenes = config.scenes.map((s, i) => {
    const measured = data.scenes[i];
    if (!measured) throw new Error(`composeDoc: no timing data for scene "${s.id}"`);
    const start = measured.start;
    const dur = measured.dur;
    const cueGroups = (data.groups || []).filter(g =>
      g.start < start + dur && g.end > start,
    ).map(g => ({
      ...g,
      start: Math.max(0, g.start - start),
      end: Math.min(dur, g.end - start),
      words: (g.words || []).map(w => ({ ...w, t0: w.t0 - start, t1: w.t1 - start })),
    }));
    const sceneData = { ...measured, markers: data.markers || {}, groups: cueGroups };
    const overlay = karaoke.overlayForScene ? karaoke.overlayForScene(start, dur) : '';
    let body = String(s.body || '');
    if (s._threeModuleContents) {
      body = threeModuleSceneBody(s, sceneData, size.w, size.h) + (body || '');
    } else if (s.three) {
      body = threeSceneBody(s, sceneData, size.w, size.h) + (body || '');
    }
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

  // Keep each authored source identifiable while preserving the historic
  // shared classic-script scope and execution order. Only literal closing
  // script tags are escaped; comparisons and every other expression remain
  // byte-for-byte author-controlled.
  const authorBlocks = collectMainAuthorJavaScript(config, { data });
  const choreography = escapeInlineScript(renderMainAuthorJavaScript(authorBlocks).code);

  // The caption preset is carried twice: in DATA (runtime.js picks its word
  // tweens off it) and as a cap-preset-* class on the stage (css.js picks its
  // static styles off the class). Both derive from the same resolved config.
  const capPreset = config.captionsEnabled === false ? false
    : ((config.captions && config.captions.preset) || 'subtitle');
  const captionsOff = capPreset === false;

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
  <script src="assets/gsap.min.js"></script>${threeScripts}
  <link rel="stylesheet" href="style.css">${karaokeCss ? '\n  <style>' + karaokeCss + '</style>' : ''}
</head>
<body>
<div id="root" data-composition-id="main" data-start="0"
     data-width="${size.w}" data-height="${size.h}" data-duration="${fmt(data.total)}">
  <div id="bg" class="stage"></div><!-- class="stage" kept so pre-0.3.0 theme.css background rules still apply -->
${mediaClips}
${sceneClips}
  <section id="overlay" class="clip overlay" data-start="0" data-duration="${fmt(data.total)}" data-track-index="1000">
    ${captionsOff ? '' : `<div class="capzone"><div id="cap-stage" class="cap-preset-${capPreset}" style="position:relative;height:100%"></div></div>`}
    ${chrome.progress ? '<div class="progress"><i id="progress-bar"></i></div>' : ''}
    ${seriesBadge}
  </section>
  <audio id="vo" src="assets/narration.wav" data-start="0" data-track-index="1001"></audio>
</div>
<script>
var DATA = ${dataJson};
${runtimeScript({ deferTimeline: true })}${choreography}${authorReadyScript()}
</script>
</body>
</html>
`;
}

/* Generate a self-contained HyperFrames HTML document for a SINGLE scene.
 * The scene's internal timeline (DATA scenes[], groups[], turns[]) is rebased
 * so the scene's start is t=0. This allows an independent HF project to render
 * just this scene, which can then be concatenated with other scene spans via
 * ffmpeg. Every visual element emitted by composeDoc() has an equivalent here
 * or an explicit dependency that forces a larger render scope.
 *
 * Gap audit (each item must have parity with composeDoc):
 *   ✅ transitions — _firstScene metadata + runtime fix
 *   ✅ project choreography — injected
 *   ✅ scene choreography/script files — injected
 *   ✅ imported JS — injected
 *   ✅ named markers — included in DATA
 *   ✅ captions — filtered + rebased
 *   ✅ karaoke overlays — injected into body
 *   ✅ series badge — included
 *   ✅ walkthrough shell/titlebar — included
 *   ✅ walkthrough media / b-roll — included
 *   ✅ Three.js head scripts — included
 *   ✅ Three.js / threeModule scene body — included
 *   ✅ caption preset class — included
 *   ✅ chrome — respects config (topbar, counter, progress)
 *   ✅ progress bar — respects chrome.progress, segmented correctly
 *   ✅ imported CSS — merged via composeSceneProject */
function composeSceneDoc(config, sceneIdx, size, data, css) {
  const title = escapeHtml(config.title || 'narova');
  const scene = config.scenes[sceneIdx];
  const scData = data.scenes.find(d => d.id === scene.id);
  if (!scData) throw new Error(`composeSceneDoc: no data for scene "${scene.id}"`);
  const globalStart = scData.start;
  const sceneDur = scData.dur;
  const total = data.total;
  const chrome = { topbar: true, counter: true, progress: true, ...(config.chrome || {}) };
  const nn = String(data.scenes.length).padStart(2, '0');
  const isFirstScene = sceneIdx === 0;
  const r3 = v => Math.round(v * 1000) / 1000;

  // External karaoke captions for this scene's time window. Filtering uses the
  // GLOBAL window (globalStart..globalStart+sceneDur); emitted data-start values
  // are rebased to scene-local by passing offset=globalStart (this project's
  // timeline starts at 0).
  const karaoke = buildKaraokeOverlays(config);
  const karaokeOverlay = karaoke.overlayForScene ? karaoke.overlayForScene(globalStart, sceneDur, globalStart) : '';
  const karaokeCss = karaoke.css || '';

  // Captions: filter groups within this scene's time window, rebase to t=0.
  const sceneGroups = (data.groups || []).filter(g => {
    return g.start < globalStart + sceneDur && g.end > globalStart;
  }).map(g => ({
    who: g.who, label: g.label,
    start: Math.max(0, r3(g.start - globalStart)),
    end: Math.min(sceneDur, r3(g.end - globalStart)),
    words: g.words.filter(w => {
      return w.t0 < globalStart + sceneDur && w.t1 > globalStart;
    }).map(w => ({
      w: w.w, kw: w.kw || 0,
      t0: r3(Math.max(0, w.t0 - globalStart)),
      t1: r3(Math.min(sceneDur, w.t1 - globalStart)),
    })),
  })).filter(g => g.start < g.end);

  // Scene-local DATA: only this scene, timeline rebased to t=0.
  // _firstScene metadata tells the runtime whether to apply an entrance
  // transition — see runtime.js transition logic for the contract.
  //
  // Timing invariants for an isolated scene project (its timeline is t=0..dur):
  //   - turns are ALREADY scene-local in timings.json (manifest.mergeTimings
  //     adds scene.start to convert them to global for the full project). They
  //     are passed through UNCHANGED here — rebasing them again would corrupt
  //     them (a local 0.2s turn in scene 2 would become 0.2 - start < 0).
  //   - markers are GLOBAL project timestamps, so they ARE rebased: a marker
  //     inside this scene's window becomes a scene-local time; markers outside
  //     the window are dropped (no element in this scene can fire them).
  const sceneTurns = scData.turns || [];
  const localSentences = (scData.sentences || []).map(sentence => ({
    sentenceIndex: sentence.sentenceIndex,
    words: (sentence.words || []).map(word => ({
      token: word.token,
      speaker: word.speaker,
      start: r3(word.start - globalStart),
      end: r3(word.end - globalStart),
    })),
  }));
  const localMarkers = {};
  for (const [mk, mv] of Object.entries(config.markers || {})) {
    if (typeof mv === 'number' && mv >= globalStart && mv <= globalStart + sceneDur) {
      localMarkers[mk] = r3(mv - globalStart);
    }
  }
  const sceneData = {
    total: sceneDur,
    preset: data.preset,
    scenes: [{
      id: scData.id,
      start: 0,
      dur: sceneDur,
      turns: sceneTurns,
      sentences: localSentences,
      transition: scData.transition || 'fade',
      _firstScene: isFirstScene,
    }],
    groups: sceneGroups,
    markers: localMarkers,
  };

  // Three.js and raw Three.js module scene body. The scene is rebased to t=0,
  // so the Three.js bootstrap must schedule its render-driver tween and cue
  // animations at LOCAL coordinates: start=0 and the (already scene-local)
  // turns array. Passing the global start here would place the driver tween
  // beyond the isolated project's duration and the canvas would never animate.
  const enrichedScene = { ...scene };
  const s = enrichedScene;
  const scLocal = { start: 0, dur: sceneDur, turns: sceneTurns, sentences: localSentences, markers: localMarkers, groups: sceneGroups };
  let body = String(s.body || '');
  if (s._threeModuleContents) {
    body = threeModuleSceneBody(s, scLocal, size.w, size.h) + (body || '');
  } else if (s.three) {
    body = threeSceneBody(s, scLocal, size.w, size.h) + (body || '');
  }
  body += karaokeOverlay;
  const nsBody = namespaceIds(body, s.id);

  // Topbar: respects chrome config (topbar/counter).
  const bar = chrome.topbar
    ? `<div class="topbar"><div class="wordmark"><b>${title}</b></div>${
      chrome.counter ? `<div class="counter">${String(sceneIdx + 1).padStart(2, '0')} / ${nn}</div>` : ''}</div>`
    : '';

  // Walkthrough shell (same as composeDoc).
  const walkthroughClass = s.walkthrough
    ? ` has-walkthrough walkthrough-layout-${s.walkthrough.layout}`
    : '';
  let walkthroughShell = '';
  if (s.walkthrough && s.walkthrough.layout === 'window') {
    const flow = config.walkthroughs[s.walkthrough.id];
    let host = '';
    try { host = new URL(flow.url).host; } catch {}
    walkthroughShell = `<div class="walkthrough-shell" aria-hidden="true">
      <div class="walkthrough-titlebar"><span class="walkthrough-dots"><i></i><i></i><i></i></span><span>${escapeHtml(flow.title)}</span><small>${escapeHtml(host)}</small></div>
    </div>`;
  }

  // B-roll / walkthrough media for this scene only (same as composeDoc).
  let mediaClip = '';
  if (s.walkthrough) {
    const captureManifests = Object.fromEntries(
      Object.keys(config.walkthroughs || {}).map(id => [id, readCaptureManifest(config, id)]),
    );
    const capture = captureManifests[s.walkthrough.id];
    const capturedScene = capture && capture.timeline && capture.timeline.scenes
      ? capture.timeline.scenes.find(item => item.id === s.id)
      : null;
    if (capture && capturedScene) {
      const ref = s.walkthrough;
      const mediaStart = (capture.timeline.sourceOrigin ?? capture.timeline.preRoll ?? 0) + capturedScene.start;
      const position = `${fmt(ref.position.x * 100)}% ${fmt(ref.position.y * 100)}%`;
      const source = capturePaths(config, ref.id).assetRecording;
      mediaClip = `  <video id="walkthrough-${s.id}" class="walkthrough-media walkthrough-${ref.layout}" src="${escapeHtml(source)}" data-start="0" data-duration="${fmt(sceneDur)}" data-media-start="${fmt(mediaStart)}" data-track-index="200" muted playsinline preload="auto" style="--walkthrough-opacity:${fmt(ref.opacity)};--walkthrough-position:${position};object-fit:${ref.fit}"></video>`;
    }
  } else if (s.clip) {
    const ext = escapeHtml(path.extname(s.clip));
    mediaClip = `  <video id="broll-${s.id}" class="broll" src="assets/clip-${s.id}${ext}" data-start="0" data-duration="${fmt(sceneDur)}" data-track-index="100" muted loop playsinline preload="auto"></video>`;
  }

  const dataJson = JSON.stringify(sceneData).replace(/</g, '\\u003c');
  const useThree = hasThreeScenes(config);
  const threeScripts = useThree ? threeHeadScripts(hasThreeModels(config)) : '';

  const capPreset = config.captionsEnabled === false ? false
    : ((config.captions && config.captions.preset) || 'subtitle');
  const captionsOff = capPreset === false;

  const seriesBadge = config.series
    ? `<div class="series-badge">Part ${config.series.part}${config.series.total ? ` / ${config.series.total}` : ''}</div>`
    : '';

  // The isolated project uses the same authored source records but rebases its
  // scene-script wrapper to t=0.
  const authorBlocks = collectMainAuthorJavaScript(config, { data, sceneIndex: sceneIdx });
  const choreography = escapeInlineScript(renderMainAuthorJavaScript(authorBlocks).code);

  return `<!doctype html>
<!-- GENERATED by narova compose (per-scene) — do not edit. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${size.w}, height=${size.h}">
  <title>${title} / ${s.id}</title>
  <script src="assets/gsap.min.js"></script>${threeScripts}
  <link rel="stylesheet" href="style.css">${karaokeCss ? '\n  <style>' + karaokeCss + '</style>' : ''}
</head>
<body>
<div id="root" data-composition-id="main" data-start="0"
     data-width="${size.w}" data-height="${size.h}" data-duration="${fmt(sceneDur)}">
  <div id="bg" class="stage"></div>
${mediaClip}
  <section id="scene-${s.id}" class="clip scene${walkthroughClass}" data-start="0" data-duration="${fmt(sceneDur)}" data-track-index="1">
    ${walkthroughShell}
    <div class="chrome">
      ${bar}
      <div class="canvas"><div class="scenebody">${nsBody}</div></div>
    </div>
  </section>
  <section id="overlay" class="clip overlay" data-start="0" data-duration="${fmt(sceneDur)}" data-track-index="1000">
    ${captionsOff ? '' : `<div class="capzone"><div id="cap-stage" class="cap-preset-${capPreset}" style="position:relative;height:100%"></div></div>`}
    ${chrome.progress ? `<div class="progress"><i id="progress-bar"></i></div>` : ''}
    ${seriesBadge}
  </section>
  <audio id="vo" src="narration.wav" data-start="0" data-track-index="1001"></audio>
</div>
<script>
var DATA = ${dataJson};
${runtimeScript({ deferTimeline: true })}${choreography}
(function(){
  var bar = document.getElementById('progress-bar');
  if (bar) {
    var p0 = ${fmt(globalStart / (total || 1))}, p1 = ${fmt((globalStart + sceneDur) / (total || 1))};
    bar.style.transform = 'scaleX(' + p0 + ')';
    tl.fromTo(bar, { scaleX: p0 }, { scaleX: p1, duration: ${fmt(sceneDur)}, ease: 'none' }, 0);
  }
})();
${authorReadyScript()}
</script>
</body>
</html>`;
}

module.exports = { composeDoc, composeSceneDoc, escapeHtml, namespaceIds };
