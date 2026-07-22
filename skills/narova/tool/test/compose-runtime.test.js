'use strict';
/* Executes the generated timeline script against stub DOM + GSAP objects and
 * asserts the seek-safe contract: karaoke className flips at word times, cue
 * tweens at sceneStart + turns[k], the full-span anchor, and registration
 * under window.__timelines. This is the composition's most delicate artifact —
 * these tests lock its behavior without a browser. */
const { test } = require('node:test');
const assert = require('node:assert');
const { runtimeScript } = require('../src/compose/runtime');

const DATA = {
  total: 9,
  scenes: [
    { id: 's1', start: 0, dur: 5, turns: [0.16, 2.5] },
    { id: 's2', start: 5, dur: 4, turns: [0.16] },
  ],
  groups: [
    { who: 'a', label: 'A', start: 0.16, end: 5.16,
      words: [{ w: 'Hi', t0: 0.16, t1: 0.5 }, { w: 'there.', t0: 0.5, t1: 1.0 }] },
    { who: 'b', label: 'B', start: 5.16, end: 9,
      words: [{ w: 'Bye.', t0: 5.16, t1: 5.7 }] },
  ],
};

/* Minimal DOM + GSAP stubs. `attrs` backs get/has/set/removeAttribute;
 * classList is derived from className. */
function makeNode(tag, attrs = {}) {
  const node = {
    tag, className: '', id: '', children: [], textContent: '',
    attrs: { ...attrs },
    parentNode: null,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    set innerHTML(v) { this._innerHTML = v; }, get innerHTML() { return this._innerHTML || ''; },
    appendChild(c) { c.parentNode = node; this.children.push(c); return c; },
    insertBefore(c, ref) {
      c.parentNode = node;
      const i = this.children.indexOf(ref);
      this.children.splice(i < 0 ? this.children.length : i, 0, c);
      return c;
    },
    getAttribute(n) { return n in node.attrs ? node.attrs[n] : null; },
    hasAttribute(n) { return n in node.attrs; },
    setAttribute(n, v) { node.attrs[n] = String(v); },
    removeAttribute(n) { delete node.attrs[n]; },
  };
  node.classList = {
    contains: c => node.className.split(/\s+/).includes(c),
    add: c => { if (!node.classList.contains(c)) node.className = (node.className + ' ' + c).trim(); },
    remove: c => { node.className = node.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
  };
  return node;
}

function runScript({ sceneEls = {} } = {}) {
  const calls = [];
  const tl = {
    set: (target, vars, at) => { calls.push({ op: 'set', target, vars, at }); return tl; },
    to: (target, vars, at) => { calls.push({ op: 'to', target, vars, at }); return tl; },
    fromTo: (target, from, to, at) => { calls.push({ op: 'fromTo', target, from, to, at }); return tl; },
  };
  const gsap = { timeline: opts => { assert.equal(opts.paused, true, 'timeline must be paused'); return tl; } };
  const capStage = makeNode('div');
  const progressBar = makeNode('i');
  const document = {
    getElementById: id => (id === 'cap-stage' ? capStage : id === 'progress-bar' ? progressBar : sceneEls[id] || null),
    createElement: makeNode,
    createElementNS: (ns, tag) => { const n = makeNode(tag); n.namespaceURI = ns; return n; },
    createTextNode: t => ({ text: t }),
  };
  const window = {};
  new Function('window', 'document', 'gsap', 'DATA', runtimeScript())(window, document, gsap, DATA);
  return { calls, window, capStage, tl };
}

/* A scene element whose querySelectorAll returns canned nodes for the runtime's
 * single animation-target selector. */
const TARGET_SELECTOR = '.reveal, .cue, [data-cue], [data-grow], [data-draw], [data-count]';
function sceneEl(targets = [], drifts = []) {
  return { querySelectorAll: sel => (sel === TARGET_SELECTOR ? targets : sel === '[data-drift]' ? drifts : []) };
}

test('registers one paused timeline under __timelines.main', () => {
  const { window, tl } = runScript();
  assert.equal(window.__timelines.main, tl);
});

test('caption DOM: one group per sentence, one span per word', () => {
  const { capStage } = runScript();
  assert.equal(capStage.children.length, 2);
  const line = capStage.children[0].children.find(c => c.className === 'caption2');
  assert.equal(line.children.filter(c => (c.className || '').startsWith('cap-w')).length, 2);
});

test('karaoke: className flips to active at t0 and past at the next onset', () => {
  const { calls } = runScript();
  const active = calls.find(c => c.op === 'set' && c.vars.className === 'cap-w a active');
  assert.equal(active.at, 0.16);
  const past = calls.find(c => c.op === 'set' && c.vars.className === 'cap-w a past' && c.target === '#capw-0-0');
  assert.equal(past.at, 0.5);            // next word's t0
});

test('caption groups toggle opacity at start/end; last group never hides', () => {
  const { calls, capStage } = runScript();
  const [g0, g1] = capStage.children;
  assert.ok(calls.some(c => c.op === 'set' && c.target === g0 && c.vars.opacity === 1 && c.at === 0.16));
  assert.ok(calls.some(c => c.op === 'set' && c.target === g0 && c.vars.opacity === 0 && c.at === 5.16));
  assert.ok(!calls.some(c => c.op === 'set' && c.target === g1 && c.vars.opacity === 0),
    'the final group must stay visible to the last frame');
});

test('cue tween lands at sceneStart + turns[k]; scene-local turns globalized', () => {
  const cue = makeNode('p', { 'data-cue': '0' });
  const { calls } = runScript({
    sceneEls: { 'scene-s2': sceneEl([cue]) },
  });
  const tw = calls.find(c => c.op === 'fromTo' && c.target === cue);
  assert.equal(tw.at, 5 + 0.16);
});

test('unresolvable cue falls back to scene entry (check.js parity)', () => {
  for (const raw of ['9', '-1', 'nope', '1.5']) {
    const cue = makeNode('p', { 'data-cue': raw });
    const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl([cue]) } });
    const tw = calls.find(c => c.op === 'fromTo' && c.target === cue);
    assert.equal(tw.at, 0, `data-cue="${raw}" must reveal at scene entry`);
  }
  // "1.0" coerces to integer 1 -> resolves to turn 1, NOT scene entry
  const cue = makeNode('p', { 'data-cue': '1.0' });
  const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl([cue]) } });
  assert.equal(calls.find(c => c.op === 'fromTo' && c.target === cue).at, 2.5);
});

test('reveal/cue-class without data-cue animates at scene entry; no double tween', () => {
  const reveal = makeNode('h1');
  reveal.className = 'reveal';
  const { calls } = runScript({
    sceneEls: { 'scene-s1': sceneEl([reveal]) },
  });
  const tw = calls.filter(c => c.op === 'fromTo' && c.target === reveal);
  assert.equal(tw.length, 1);
  assert.ok(Math.abs(tw[0].at - 0.1) < 1e-9);   // sc.start + 0.1
});

test('data-delay nudges both cue and entry triggers', () => {
  const cued = makeNode('p', { 'data-cue': '1', 'data-delay': '0.35' });
  const late = makeNode('p', { 'data-delay': '0.5' });
  late.className = 'reveal';
  const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl([cued, late]) } });
  assert.equal(calls.find(c => c.op === 'fromTo' && c.target === cued).at, 2.5 + 0.35);
  assert.ok(Math.abs(calls.find(c => c.op === 'fromTo' && c.target === late).at - 0.6) < 1e-9);
});

test('data-grow tweens scaleX 0 -> 1 from the left origin', () => {
  const bar = makeNode('div', { 'data-grow': '' });
  const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl([bar]) } });
  const tw = calls.find(c => c.op === 'fromTo' && c.target === bar);
  assert.equal(tw.from.scaleX, 0);
  assert.equal(tw.to.scaleX, 1);
  assert.equal(tw.from.transformOrigin, 'left center');
});

test('data-draw walks the stroke dash over the path length', () => {
  const path = makeNode('path', { 'data-draw': '' });
  path.getTotalLength = () => 123;
  const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl([path]) } });
  const tw = calls.find(c => c.op === 'fromTo' && c.target === path);
  assert.equal(tw.from.strokeDashoffset, 123);
  assert.equal(tw.to.strokeDashoffset, 0);
});

test('data-count steps textContent 0 -> target as seek-safe sets', () => {
  const stat = makeNode('span', { 'data-count': '20', 'data-count-suffix': '%' });
  const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl([stat]) } });
  const sets = calls.filter(c => c.op === 'set' && c.target === stat && 'textContent' in c.vars);
  assert.equal(sets.length, 21);                     // 0..20 inclusive
  assert.equal(sets[0].vars.textContent, '0%');
  assert.equal(sets.at(-1).vars.textContent, '20%');
  assert.ok(sets.every((c, i) => i === 0 || c.at > sets[i - 1].at), 'steps advance in time');
});

test('data-drift="pano" sweeps background-position across the whole scene', () => {
  const img = makeNode('div', { 'data-drift': 'pano' });
  const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl([], [img]) } });
  const tw = calls.find(c => c.op === 'fromTo' && c.target === img);
  assert.equal(tw.from.backgroundPosition, '0% 50%');
  assert.equal(tw.to.backgroundPosition, '100% 50%');
  assert.equal(tw.to.duration, 5);     // sc.dur
  assert.equal(tw.to.ease, 'none');
  assert.equal(tw.at, 0);              // sc.start
});

test('data-drift Ken Burns modes tween transform over the whole scene', () => {
  const pin = makeNode('img', { 'data-drift': 'in' });     // default push-in
  const pan = makeNode('img', { 'data-drift': 'left' });   // lateral pan
  const { calls } = runScript({ sceneEls: { 'scene-s2': sceneEl([], [pin, pan]) } });
  const a = calls.find(c => c.op === 'fromTo' && c.target === pin);
  assert.equal(a.from.scale, 1.0);
  assert.equal(a.to.scale, 1.10);
  assert.equal(a.to.duration, 4);      // s2 dur — spans the scene
  assert.equal(a.to.ease, 'none');
  assert.equal(a.at, 5);               // s2 start
  const b = calls.find(c => c.op === 'fromTo' && c.target === pan);
  assert.equal(b.from.xPercent, 4.5);
  assert.equal(b.to.xPercent, -4.5);
});

test('scene transition: scenes after the first fade up from dark; the first does not', () => {
  const s1 = sceneEl(), s2 = sceneEl();
  const { calls } = runScript({ sceneEls: { 'scene-s1': s1, 'scene-s2': s2 } });
  const fade = calls.find(c => c.op === 'fromTo' && c.target === s2 && c.from.opacity === 0);
  assert.ok(fade, 'scene 2 fades up from opacity 0');
  assert.equal(fade.to.opacity, 1);
  assert.equal(fade.to.duration, 0.7);
  assert.equal(fade.at, 5);            // s2 start
  assert.ok(!calls.some(c => c.op === 'fromTo' && c.target === s1),
    'the first scene (start 0) must not fade');
});

test('an SVG transform carrier is wrapped: the tween targets the wrapper', () => {
  const marker = makeNode('g', { transform: 'translate(100,60)', 'data-cue': '1' });
  marker.namespaceURI = 'http://www.w3.org/2000/svg';
  marker.className = 'cue';
  const svg = makeNode('svg');
  svg.appendChild(marker);
  const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl([marker]) } });
  assert.ok(!calls.some(c => c.target === marker), 'no tween may touch the transform carrier');
  const wrap = svg.children[0];
  assert.equal(wrap.tag, 'g');
  assert.equal(wrap.children[0], marker);
  assert.equal(wrap.getAttribute('data-cue'), '1', 'cue moves to the wrapper');
  assert.ok(wrap.classList.contains('cue'));
  assert.ok(!marker.hasAttribute('data-cue'), 'carrier keeps only its transform');
  assert.equal(marker.getAttribute('transform'), 'translate(100,60)');
  assert.equal(calls.find(c => c.op === 'fromTo' && c.target === wrap).at, 2.5);
});

test('full-span anchor + progress bar span the total duration', () => {
  const { calls } = runScript();
  assert.ok(calls.some(c => c.op === 'to' && c.vars.duration === DATA.total && c.at === 0));
  const bar = calls.find(c => c.op === 'fromTo' && c.target === '#progress-bar');
  assert.equal(bar.to.duration, DATA.total);
  assert.equal(bar.to.ease, 'none');
});

test('chrome.progress === false: no progress tween when the bar is absent', () => {
  const calls = [];
  const tl = {
    set: (target, vars, at) => { calls.push({ op: 'set', target, vars, at }); return tl; },
    to: (target, vars, at) => { calls.push({ op: 'to', target, vars, at }); return tl; },
    fromTo: (target, from, to, at) => { calls.push({ op: 'fromTo', target, from, to, at }); return tl; },
  };
  const gsap = { timeline: () => tl };
  const capStage = makeNode('div');
  const document = {
    getElementById: id => (id === 'cap-stage' ? capStage : null), // no progress-bar in the DOM
    createElement: makeNode,
    createElementNS: (ns, tag) => makeNode(tag),
    createTextNode: t => ({ text: t }),
  };
  new Function('window', 'document', 'gsap', 'DATA', runtimeScript())({}, document, gsap, DATA);
  assert.ok(!calls.some(c => c.target === '#progress-bar'), 'no tween may target a missing progress bar');
  assert.ok(calls.some(c => c.op === 'to' && c.vars.duration === DATA.total), 'full-span anchor still present');
});

test('determinism: script contains no clocks, randomness, or infinite repeats', () => {
  const src = runtimeScript();
  for (const banned of ['Date.now', 'performance.now', 'Math.random', 'repeat: -1', 'repeat:-1', 'setTimeout', 'requestAnimationFrame', 'fetch(']) {
    assert.ok(!src.includes(banned), `generated runtime must not contain ${src.includes(banned) ? banned : ''}`);
  }
});
