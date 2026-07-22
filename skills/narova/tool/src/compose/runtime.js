'use strict';
/* The composition's <script> body: builds the caption DOM at load and one
 * paused GSAP timeline, registered at window.__timelines["main"]. Everything is
 * synchronous, driven only by the inlined DATA — no clocks, no randomness, no
 * network — so any frame is reproducible from its time value (the HyperFrames
 * determinism contract). Discrete state flips use tl.set(className) at absolute
 * times: the seek-safe karaoke pattern. All motion is timeline tweens/sets, so
 * seeking to any frame renders the correct state — no wall-clock CSS. */

/* Returns the script body; `DATA` is inlined by html.js just above it. */
function runtimeScript() {
  return `window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
var stage = document.getElementById('cap-stage');

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
  g.words.forEach(function (w, wi) {
    var s = document.createElement('span');
    s.className = 'cap-w ' + g.who;
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
    var id = '#capw-' + gi + '-' + wi, base = 'cap-w ' + g.who;
    tl.set(id, { className: base + ' active' }, w.t0);
    tl.set(id, { className: base + ' past' }, g.words[wi + 1] ? g.words[wi + 1].t0 : w.t1);
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
var ANIM_ATTRS = ['data-cue', 'data-delay', 'data-grow', 'data-draw', 'data-count', 'data-count-suffix'];
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

// scenes: entrance reveals, voice-cued reveals, and the data-* animators
// (grow/draw/count), all as timeline tweens or seek-safe sets. An element with
// BOTH a reveal class and data-cue is cue-only (no double tween).
DATA.scenes.forEach(function (sc) {
  var scene = document.getElementById('scene-' + sc.id);
  if (!scene) return;
  var targets = [];
  scene.querySelectorAll('.reveal, .cue, [data-cue], [data-grow], [data-draw], [data-count]').forEach(function (el) {
    targets.push(shieldSvgTransform(el));
  });
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
  // scene transition: every scene after the first fades up from dark over
  // its first beats — a deterministic dip-to-black cut.
  if (sc.start > 0.01) {
    tl.fromTo(scene, { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'power1.out' }, sc.start);
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
