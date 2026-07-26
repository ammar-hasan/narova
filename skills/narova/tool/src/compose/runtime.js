'use strict';
/* The composition's <script> body: builds the caption DOM at load and one
 * paused GSAP timeline, registered at window.__timelines["main"]. Everything is
 * synchronous, driven only by the inlined DATA — no clocks, no randomness, no
 * network — so any frame is reproducible from its time value (the HyperFrames
 * determinism contract). Discrete state flips use tl.set(className) at absolute
 * times: the seek-safe karaoke pattern. All motion is timeline tweens/sets, so
 * seeking to any frame renders the correct state — no wall-clock CSS. That is
 * also why the caption presets (slam/pop) animate with short GSAP tweens at
 * word times instead of CSS transitions: a transition runs on the wall clock
 * and would not reproduce under seek-based frame rendering. */

/* Returns the script body; `DATA` is inlined by html.js just above it. */
function runtimeScript() {
  return `window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
var stage = document.getElementById('cap-stage');

// caption style preset (config.captions.preset; html.js mirrors it as a
// cap-preset-* class on the stage). karaoke/rise are pure class-flip looks;
// slam/pop add motion as short timeline tweens at word times — never CSS
// transitions (wall clock, not seek-safe).
var PRESET = DATA.preset || 'karaoke';

// captions: one group per sentence, stacked on the same band; the timeline
// shows exactly one at a time and walks each word upcoming -> active -> past.
DATA.groups.forEach(function (g, gi) {
  var el = document.createElement('div');
  el.className = 'cap-group';
  el.id = 'capg-' + gi;
  var spk = document.createElement('div');
  spk.className = 'spk ' + g.who;
  spk.innerHTML = '<span class="eq"><i></i><i></i><i></i></span>';
  spk.appendChild(document.createTextNode(g.label));
  el.appendChild(spk);
  var line = document.createElement('div');
  line.className = 'caption2';
  line.dir = 'auto';  // RTL for Arabic / Urdu — browser detects script direction
  g.words.forEach(function (w, wi) {
    var s = document.createElement('span');
    s.className = 'cap-w ' + g.who + (w.kw ? ' kw' : '');
    s.id = 'capw-' + gi + '-' + wi;
    s.textContent = w.w;
    line.appendChild(s);
    line.appendChild(document.createTextNode(' '));
  });
  el.appendChild(line);
  stage.appendChild(el);

  tl.set(el, { opacity: 1 }, g.start);
  if (g.end < DATA.total) tl.set(el, { opacity: 0 }, g.end);

  g.words.forEach(function (w, wi) {
    var id = '#capw-' + gi + '-' + wi, base = 'cap-w ' + g.who + (w.kw ? ' kw' : '');
    var pastAt = g.words[wi + 1] ? g.words[wi + 1].t0 : w.t1;
    tl.set(id, { className: base + ' active' }, w.t0);
    tl.set(id, { className: base + ' past' }, pastAt);
    if (PRESET === 'slam') {
      // slam: the active word lands big and settles back once it has passed.
      // Built from .to() tweens ONLY — a fromTo leaves every UPCOMING word
      // parked at its from-state (scale 1.7) until its turn, so the words
      // pile onto each other. .to() tweens leave the pre-start state alone
      // (scale 1), which is the correct seek-safe resting state.
      tl.to(id, { scale: 1.7, duration: 0.06, ease: 'power4.in' }, w.t0);
      tl.to(id, { scale: 1.25, duration: 0.14, ease: 'power2.out' }, w.t0 + 0.06);
      tl.to(id, { scale: 1, duration: 0.22, ease: 'power2.out' }, pastAt);
    } else if (PRESET === 'pop') {
      // pop: the active word pops up into its slot (opacity stays class-driven,
      // so the past state is never overridden by a lingering inline style).
      tl.fromTo(id, { scale: 0.55, y: 10 }, { scale: 1, y: 0, duration: 0.18, ease: 'back.out(2.2)' }, w.t0);
    }
  });
});

// When does an element animate? data-cue="k" pins it to the start of turn k
// (0-based into the scene's vo turns; an unresolvable cue falls back to scene
// entry). Anything else joins the scene's entry stagger (DOM order, 0.1s
// apart). data-delay="s" nudges either trigger. Coercion is +value with an
// integer test — keep EXACTLY in sync with src/check.js so the lint predicts
// the runtime.
function cueTime(sc, el, entryIndex) {
  var delay = parseFloat(el.getAttribute('data-delay') || '0') || 0;
  var raw = el.getAttribute('data-cue');
  if (raw != null) {
    var k = +raw;
    var local = (Number.isInteger(k) && k >= 0 && k < sc.turns.length) ? sc.turns[k] : 0;
    return sc.start + local + delay;
  }
  return sc.start + 0.1 + entryIndex * 0.1 + delay;
}

// GSAP writes a CSS transform, which REPLACES an SVG element's transform
// attribute — a reveal on <g transform="translate(x,y)"> teleports it to the
// origin. Fix: wrap the carrier in a fresh <g>, move the animation hooks
// (classes + data-attrs) onto the wrapper, and tween that instead. The
// carrier's own transform survives untouched.
var ANIM_ATTRS = ['data-cue', 'data-delay', 'data-grow', 'data-draw', 'data-count', 'data-count-suffix', 'data-mark'];
function shieldSvgTransform(el) {
  var isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
  if (!isSvg || typeof el.hasAttribute !== 'function' || !el.hasAttribute('transform') || !el.parentNode) return el;
  var wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);
  ['reveal', 'cue'].forEach(function (c) {
    if (el.classList.contains(c)) { el.classList.remove(c); wrap.classList.add(c); }
  });
  ANIM_ATTRS.forEach(function (a) {
    if (el.hasAttribute(a)) { wrap.setAttribute(a, el.getAttribute(a)); el.removeAttribute(a); }
  });
  return wrap;
}

// data-mark="underline|circle|box|highlight": a rough hand-drawn annotation
// around/under the element, drawn at the element's trigger (same cueTime
// semantics as every other animator). Layout is fixed at load, so
// getBoundingClientRect relative to the scene is deterministic. The
// hand-drawn feel comes from two slightly offset strokes and a FIXED jitter
// pattern — never randomness (the determinism contract). Unknown kinds are
// ignored; check.js lints the same set.
var MARK_JITTER = [0.9, -1.2, 0.6, -0.4, 1.1, -0.8, 0.5, -1.0];
function mf(n) { return Math.round(n * 10) / 10; }
function markPath(layer, d, cls) {
  var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  p.setAttribute('class', cls);
  layer.appendChild(p);
  return p;
}
// The same stroke-dash self-draw as data-draw, with a fixed lag for the
// second (sketch) stroke.
function drawMark(p, t, lag) {
  if (typeof p.getTotalLength !== 'function') return;
  var len = p.getTotalLength();
  tl.fromTo(p, { strokeDasharray: len, strokeDashoffset: len },
    { strokeDashoffset: 0, duration: 0.55, ease: 'power2.inOut' }, t + lag);
}
function annotate(scene, layer, el, kind, t) {
  var sr = scene.getBoundingClientRect();
  var r = el.getBoundingClientRect();
  var x = r.left - sr.left, y = r.top - sr.top, w = r.width, h = r.height;
  var i, d, p;
  if (kind === 'underline') {
    var ly = y + h + 4, x0 = x - 3, x1 = x + w + 3, seg = 6;
    for (i = 0; i < 2; i++) {
      var o = i * 2.4, s = i * 3;
      d = 'M ' + mf(x0) + ' ' + mf(ly + o + MARK_JITTER[s % 8]);
      for (var k = 1; k <= seg; k++) {
        d += ' L ' + mf(x0 + (x1 - x0) * k / seg) + ' ' + mf(ly + o + MARK_JITTER[(k + s) % 8]);
      }
      drawMark(markPath(layer, d, i ? 'mark mark2' : 'mark'), t, i * 0.07);
    }
  } else if (kind === 'circle') {
    var cx = x + w / 2, cy = y + h / 2, rx = w / 2 + 10, ry = h / 2 + 8;
    for (i = 0; i < 2; i++) {
      var j = i * 1.7, rx2 = rx + j, ry2 = ry - j * 0.6;
      d = 'M ' + mf(cx - rx2) + ' ' + mf(cy) +
        ' a ' + mf(rx2) + ' ' + mf(ry2) + ' 0 1 0 ' + mf(2 * rx2) + ' 0' +
        ' a ' + mf(rx2) + ' ' + mf(ry2) + ' 0 1 0 ' + mf(-2 * rx2) + ' 0';
      p = markPath(layer, d, i ? 'mark mark2' : 'mark');
      if (i) p.setAttribute('transform', 'rotate(-1.6 ' + mf(cx) + ' ' + mf(cy) + ')');
      drawMark(p, t, i * 0.07);
    }
  } else if (kind === 'box') {
    var bx = x - 8, by = y - 6, bw = w + 16, bh = h + 12;
    for (i = 0; i < 2; i++) {
      var b = i * 2.2, q = i * 4;
      d = 'M ' + mf(bx - b + MARK_JITTER[q % 8]) + ' ' + mf(by + MARK_JITTER[(q + 1) % 8]) +
        ' L ' + mf(bx + bw + MARK_JITTER[(q + 2) % 8]) + ' ' + mf(by - b + MARK_JITTER[(q + 3) % 8]) +
        ' L ' + mf(bx + bw - b + MARK_JITTER[(q + 4) % 8]) + ' ' + mf(by + bh + MARK_JITTER[(q + 5) % 8]) +
        ' L ' + mf(bx + MARK_JITTER[(q + 6) % 8]) + ' ' + mf(by + bh - b + MARK_JITTER[(q + 7) % 8]) + ' Z';
      drawMark(markPath(layer, d, i ? 'mark mark2' : 'mark'), t, i * 0.07);
    }
  } else if (kind === 'highlight') {
    // a marker wash swept in from the left behind the text (the mark layer
    // paints below .chrome, so the text stays on top).
    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', mf(x - 3));
    rect.setAttribute('y', mf(y + h * 0.06));
    rect.setAttribute('width', mf(w + 6));
    rect.setAttribute('height', mf(h * 0.88));
    rect.setAttribute('class', 'markhl');
    layer.appendChild(rect);
    tl.fromTo(rect, { scaleX: 0, transformOrigin: 'left center' },
      { scaleX: 1, duration: 0.5, ease: 'power3.out' }, t);
  }
}

// scenes: entrance reveals, voice-cued reveals, and the data-* animators
// (grow/draw/count/mark), all as timeline tweens or seek-safe sets. An element
// with BOTH a reveal class and data-cue is cue-only (no double tween).
DATA.scenes.forEach(function (sc) {
  var scene = document.getElementById('scene-' + sc.id);
  if (!scene) return;
  var targets = [];
  scene.querySelectorAll('.reveal, .cue, [data-cue], [data-grow], [data-draw], [data-count], [data-mark]').forEach(function (el) {
    targets.push(shieldSvgTransform(el));
  });
  // one shared SVG overlay per scene, created lazily on the first data-mark;
  // it paints below .chrome (z-index 3), behind the text it annotates.
  var layer = null;
  function markLayer() {
    if (layer) return layer;
    var sr = scene.getBoundingClientRect();
    layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    layer.setAttribute('class', 'marklayer');
    layer.setAttribute('viewBox', '0 0 ' + mf(sr.width) + ' ' + mf(sr.height));
    layer.setAttribute('width', mf(sr.width));
    layer.setAttribute('height', mf(sr.height));
    scene.appendChild(layer);
    return layer;
  }
  var entry = 0;
  targets.forEach(function (el) {
    var hasCue = el.hasAttribute('data-cue');
    var t = cueTime(sc, el, entry);
    if (!hasCue) entry++;
    var cls = el.classList;
    if (hasCue) {
      tl.fromTo(el, { opacity: 0, y: 16, scale: 0.965 },
        { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.4)' }, t);
    } else if (cls.contains('reveal') || cls.contains('cue')) {
      tl.fromTo(el, { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }, t);
    }
    // data-grow: horizontal bar growth (element is authored at full width).
    if (el.hasAttribute('data-grow')) {
      tl.fromTo(el, { scaleX: 0, transformOrigin: 'left center' },
        { scaleX: 1, duration: 0.7, ease: 'power3.out' }, t);
    }
    // data-draw: an SVG path/line draws itself (stroke-dash walk).
    if (el.hasAttribute('data-draw') && typeof el.getTotalLength === 'function') {
      var len = el.getTotalLength();
      tl.fromTo(el, { strokeDasharray: len, strokeDashoffset: len },
        { strokeDashoffset: 0, duration: 0.9, ease: 'power2.inOut' }, t);
    }
    // data-count: number counts up to the target. Stepped tl.set (not a
    // callback-driven tween) so a seek to any frame shows the right value.
    if (el.hasAttribute('data-count')) {
      var target = parseFloat(el.getAttribute('data-count'));
      if (isFinite(target)) {
        var suffix = el.getAttribute('data-count-suffix') || '';
        var decimals = /\\.\\d$/.test(el.getAttribute('data-count')) ? 1 : 0;
        var steps = Math.max(2, Math.min(40, Math.round(Math.abs(target)) || 2));
        for (var s = 0; s <= steps; s++) {
          tl.set(el, { textContent: (target * s / steps).toFixed(decimals) + suffix },
            t + 0.9 * s / steps);
        }
      }
    }
    // data-mark: hand-drawn annotation at the element's trigger. The kind set
    // must stay EXACTLY in sync with src/check.js.
    var mk = el.getAttribute('data-mark');
    if (mk === 'underline' || mk === 'circle' || mk === 'box' || mk === 'highlight') {
      annotate(scene, markLayer(), el, mk, t);
    }
  });
  // data-drift: slow Ken Burns tween spanning the whole scene. Values:
  // "in" (push-in), "out" (pull-back), "left"/"right" (wide panorama pan),
  // "up" (tilt-up sweep), "pano" (background-position sweep across an
  // ultra-wide image). Put it on media elements only (an <img> inside an
  // overflow-hidden pane, or a full-bleed background div) and never on an
  // element that also has .reveal/.cue — those tween transform channels of
  // their own; put the cue on a wrapper.
  scene.querySelectorAll('[data-drift]').forEach(function (el) {
    var mode = el.getAttribute('data-drift');
    if (mode === 'pano') {
      tl.fromTo(el, { backgroundPosition: '0% 50%' },
        { backgroundPosition: '100% 50%', duration: sc.dur, ease: 'none' }, sc.start);
      return;
    }
    var from = { scale: 1.0, xPercent: 0, yPercent: 0 }, to = { scale: 1.10, xPercent: 0, yPercent: 0 };
    if (mode === 'out') { from = { scale: 1.14, xPercent: 0, yPercent: 0 }; to = { scale: 1.0, xPercent: 0, yPercent: 0 }; }
    else if (mode === 'left') { from = { scale: 1.15, xPercent: 4.5, yPercent: 0 }; to = { scale: 1.15, xPercent: -4.5, yPercent: 0 }; }
    else if (mode === 'right') { from = { scale: 1.15, xPercent: -4.5, yPercent: 0 }; to = { scale: 1.15, xPercent: 4.5, yPercent: 0 }; }
    else if (mode === 'up') { from = { scale: 1.16, xPercent: 0, yPercent: 3.6 }; to = { scale: 1.16, xPercent: 0, yPercent: -3.6 }; }
    to.duration = sc.dur;
    to.ease = 'none';
    tl.fromTo(el, from, to, sc.start);
  });
  // scene transition: sc.transition picks the entrance — fade (default,
  // dip-to-black), wipe (clip-path sweep in from the right), slide (x +
  // opacity from the right), zoom (scale 1.08 -> 1 + opacity). All are ~0.7s
  // timeline tweens at scene start, so they are seek-safe. Unknown values
  // fall back to fade — check.js lints the same set. The first scene never
  // transitions.
  if (sc.start > 0.01) {
    var tr = sc.transition || 'fade';
    if (tr === 'wipe') {
      tl.fromTo(scene, { clipPath: 'inset(0 0 0 100%)' },
        { clipPath: 'inset(0 0 0 0%)', duration: 0.7, ease: 'power2.inOut' }, sc.start);
    } else if (tr === 'slide') {
      tl.fromTo(scene, { x: 90, opacity: 0 },
        { x: 0, opacity: 1, duration: 0.7, ease: 'power3.out' }, sc.start);
    } else if (tr === 'zoom') {
      tl.fromTo(scene, { scale: 1.08, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.7, ease: 'power2.out' }, sc.start);
    } else {
      tl.fromTo(scene, { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'power1.out' }, sc.start);
    }
  }
});

// progress bar is optional chrome (config.chrome.progress === false omits it)
if (document.getElementById('progress-bar')) {
  tl.fromTo('#progress-bar', { scaleX: 0 }, { scaleX: 1, duration: DATA.total, ease: 'none' }, 0);
}
tl.to({}, { duration: DATA.total }, 0); // anchor: timeline spans the full video
window.__timelines['main'] = tl;`;
}

module.exports = { runtimeScript };
