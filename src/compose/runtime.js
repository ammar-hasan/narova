'use strict';
/* The composition's <script> body: builds the caption DOM at load and one
 * paused GSAP timeline, registered at window.__timelines["main"]. Everything is
 * synchronous, driven only by the inlined DATA — no clocks, no randomness, no
 * network — so any frame is reproducible from its time value (the HyperFrames
 * determinism contract). Discrete state flips use tl.set(className) at absolute
 * times: the seek-safe karaoke pattern. */

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

// scenes: entry reveals + voice-cued reveals, all as timeline tweens.
// data-cue="k" = 0-based index into the scene's vo turns; an unresolvable cue
// falls back to scene entry (same semantics narova check lints).
DATA.scenes.forEach(function (sc) {
  var scene = document.getElementById('scene-' + sc.id);
  if (!scene) return;
  scene.querySelectorAll('.reveal').forEach(function (el, i) {
    tl.fromTo(el, { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' },
      sc.start + 0.1 + i * 0.1);
  });
  scene.querySelectorAll('[data-cue]').forEach(function (el) {
    var k = parseInt(el.getAttribute('data-cue'), 10);
    var local = (k >= 0 && k < sc.turns.length) ? sc.turns[k] : 0;
    tl.fromTo(el, { opacity: 0, y: 16, scale: 0.965 },
      { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(1.4)' },
      sc.start + local);
  });
});

tl.fromTo('#progress-bar', { scaleX: 0 }, { scaleX: 1, duration: DATA.total, ease: 'none' }, 0);
tl.to({}, { duration: DATA.total }, 0); // anchor: timeline spans the full video
window.__timelines['main'] = tl;`;
}

module.exports = { runtimeScript };
