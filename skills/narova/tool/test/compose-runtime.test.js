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

function runScript({ sceneEls = {}, data = DATA } = {}) {
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
    createElementNS: (ns, tag) => {
      const n = makeNode(tag);
      n.namespaceURI = ns;
      n.getTotalLength = () => 100;   // SVG geometry stubs for dash walks
      n.getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10 });
      return n;
    },
    createTextNode: t => ({ text: t }),
  };
  const window = {};
  new Function('window', 'document', 'gsap', 'DATA', runtimeScript())(window, document, gsap, data);
  return { calls, window, capStage, tl };
}

/* A scene element whose querySelectorAll returns canned nodes for the runtime's
 * single animation-target selector. */
const TARGET_SELECTOR = '.reveal, .cue, [data-cue], [data-grow], [data-draw], [data-count], [data-mark]';
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
  // transformOrigin is pre-seeded via tl.set before the tween (avoids
  // timeline breakage from tweening transformOrigin under hyperframes@0.7.64).
  const set = calls.find(c => c.op === 'set' && c.target === bar);
  assert.equal(set.vars.transformOrigin, 'left center');
  const tw = calls.find(c => c.op === 'fromTo' && c.target === bar);
  assert.equal(tw.from.scaleX, 0);
  assert.equal(tw.to.scaleX, 1);
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

/* ---- caption presets + emphasis keywords ---- */

const KW_DATA = {
  ...DATA,
  groups: [
    { who: 'a', label: 'A', start: 0.16, end: 9,
      words: [{ w: 'Big', t0: 0.16, t1: 0.5, kw: 1 }, { w: 'word.', t0: 0.5, t1: 1.0 }] },
  ],
};

test('emphasis keywords carry the kw class through every karaoke flip', () => {
  const { calls, capStage } = runScript({ data: KW_DATA });
  const line = capStage.children[0].children.find(c => c.className === 'caption2');
  assert.equal(line.children[0].className, 'cap-w a kw');
  assert.ok(calls.some(c => c.op === 'set' && c.vars.className === 'cap-w a kw active' && c.at === 0.16));
  assert.ok(calls.some(c => c.op === 'set' && c.vars.className === 'cap-w a kw past' && c.at === 0.5));
  assert.ok(calls.some(c => c.op === 'set' && c.vars.className === 'cap-w a active'),
    'non-keyword words keep the plain base');
});

test('preset slam: active word slams to 1.25 and settles back at the past flip', () => {
  const { calls } = runScript({ data: { ...DATA, preset: 'slam' } });
  // `to` tweens only — a fromTo would park every upcoming word at its
  // from-state (scale 1.7) until its turn and the words would overlap.
  assert.ok(!calls.some(c => c.op === 'fromTo' && c.target.startsWith('#capw-') && 'scale' in (c.from || {})),
    'slam must not use scale fromTo on caption words (upcoming words park at the from-state)');
  const land = calls.find(c => c.op === 'to' && c.target === '#capw-0-0' && c.vars.scale === 1.7);
  assert.equal(land.at, 0.16);
  const hold = calls.find(c => c.op === 'to' && c.target === '#capw-0-0' && c.vars.scale === 1.25);
  assert.ok(hold.at > land.at && hold.at <= land.at + 0.1);
  const settle = calls.find(c => c.op === 'to' && c.target === '#capw-0-0' && c.vars.scale === 1);
  assert.equal(settle.at, 0.5);   // the past flip (next word's t0)
});

test('preset pop: active word pops up with a quick scale+y tween', () => {
  const { calls } = runScript({ data: { ...DATA, preset: 'pop' } });
  const pop = calls.find(c => c.op === 'fromTo' && c.target === '#capw-0-1');
  assert.equal(pop.from.scale, 0.55);
  assert.equal(pop.from.y, 10);
  assert.equal(pop.to.scale, 1);
  assert.equal(pop.to.y, 0);
  assert.equal(pop.at, 0.5);
  assert.ok(!('opacity' in pop.from) && !('opacity' in pop.to),
    'opacity stays class-driven so the past state is never overridden');
});

test('presets karaoke and rise add NO word tweens (class flips only)', () => {
  for (const preset of ['karaoke', 'rise', undefined]) {
    const { calls } = runScript({ data: { ...DATA, preset } });
    assert.ok(!calls.some(c => (c.op === 'fromTo' || c.op === 'to') && /^#capw-/.test(c.target)),
      `preset ${preset} must not tween words`);
  }
});

/* ---- scene transitions ---- */

test('transition wipe: clip-path inset sweep at scene start', () => {
  const s2 = sceneEl();
  const data = { ...DATA, scenes: [DATA.scenes[0], { ...DATA.scenes[1], transition: 'wipe' }] };
  const { calls } = runScript({ data, sceneEls: { 'scene-s2': s2 } });
  const tw = calls.find(c => c.op === 'fromTo' && c.target === s2);
  assert.equal(tw.from.clipPath, 'inset(0 0 0 100%)');
  assert.equal(tw.to.clipPath, 'inset(0 0 0 0%)');
  assert.equal(tw.to.duration, 0.7);
  assert.equal(tw.at, 5);
});

test('transition slide: x + opacity from the right', () => {
  const s2 = sceneEl();
  const data = { ...DATA, scenes: [DATA.scenes[0], { ...DATA.scenes[1], transition: 'slide' }] };
  const { calls } = runScript({ data, sceneEls: { 'scene-s2': s2 } });
  const tw = calls.find(c => c.op === 'fromTo' && c.target === s2);
  assert.equal(tw.from.x, 90);
  assert.equal(tw.from.opacity, 0);
  assert.equal(tw.to.x, 0);
  assert.equal(tw.to.opacity, 1);
  assert.equal(tw.to.duration, 0.7);
  assert.equal(tw.at, 5);
});

test('transition zoom: scale 1.08 -> 1 + opacity', () => {
  const s2 = sceneEl();
  const data = { ...DATA, scenes: [DATA.scenes[0], { ...DATA.scenes[1], transition: 'zoom' }] };
  const { calls } = runScript({ data, sceneEls: { 'scene-s2': s2 } });
  const tw = calls.find(c => c.op === 'fromTo' && c.target === s2);
  assert.equal(tw.from.scale, 1.08);
  assert.equal(tw.from.opacity, 0);
  assert.equal(tw.to.scale, 1);
  assert.equal(tw.to.opacity, 1);
  assert.equal(tw.at, 5);
});

test('an unknown transition value falls back to fade (check.js parity)', () => {
  const s2 = sceneEl();
  const data = { ...DATA, scenes: [DATA.scenes[0], { ...DATA.scenes[1], transition: 'spiral' }] };
  const { calls } = runScript({ data, sceneEls: { 'scene-s2': s2 } });
  const tw = calls.find(c => c.op === 'fromTo' && c.target === s2);
  assert.equal(tw.from.opacity, 0);
  assert.equal(tw.to.opacity, 1);
  assert.ok(!('clipPath' in tw.from) && !('scale' in tw.from) && !('x' in tw.from));
});

test('the first scene never transitions, whatever its transition value', () => {
  const s1 = sceneEl();
  const data = { ...DATA, scenes: [{ ...DATA.scenes[0], transition: 'zoom' }, DATA.scenes[1]] };
  const { calls } = runScript({ data, sceneEls: { 'scene-s1': s1, 'scene-s2': sceneEl() } });
  assert.ok(!calls.some(c => c.op === 'fromTo' && c.target === s1));
});

/* ---- data-mark annotations ---- */

function markScene(targets) {
  const s = makeNode('section');
  s.querySelectorAll = sel => (sel === TARGET_SELECTOR ? targets : []);
  s.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
  return s;
}
function markEl(kind, attrs = {}) {
  const el = makeNode('p', { 'data-mark': kind, ...attrs });
  el.getBoundingClientRect = () => ({ left: 100, top: 200, width: 300, height: 40 });
  return el;
}

test('data-mark underline: two jittered strokes self-draw at the cue time', () => {
  const el = markEl('underline', { 'data-cue': '0' });
  const s1 = markScene([el]);
  const { calls } = runScript({ sceneEls: { 'scene-s1': s1 } });
  const layer = s1.children.find(c => c.tag === 'svg');
  assert.ok(layer, 'one SVG mark layer is appended to the scene');
  assert.equal(layer.getAttribute('class'), 'marklayer');
  assert.equal(layer.getAttribute('viewBox'), '0 0 1280 720');
  const strokes = layer.children.filter(c => c.tag === 'path');
  assert.equal(strokes.length, 2);
  assert.equal(strokes[0].getAttribute('class'), 'mark');
  assert.equal(strokes[1].getAttribute('class'), 'mark mark2');
  assert.match(strokes[0].getAttribute('d'), /^M /);
  assert.notEqual(strokes[0].getAttribute('d'), strokes[1].getAttribute('d'),
    'the sketch stroke is offset from the main one');
  const draws = calls.filter(c => c.op === 'fromTo' && strokes.includes(c.target));
  assert.equal(draws.length, 2);
  assert.equal(draws[0].from.strokeDashoffset, 100);   // getTotalLength stub
  assert.equal(draws[0].to.strokeDashoffset, 0);
  assert.equal(draws[0].at, 0.16);                     // cue time: turn 0
  assert.ok(Math.abs(draws[1].at - 0.23) < 1e-9, 'second stroke lags by 0.07');
});

test('data-mark circle: two elliptical strokes, the sketch one rotated', () => {
  const el = markEl('circle', { 'data-cue': '1' });
  const s1 = markScene([el]);
  const { calls } = runScript({ sceneEls: { 'scene-s1': s1 } });
  const layer = s1.children.find(c => c.tag === 'svg');
  const strokes = layer.children.filter(c => c.tag === 'path');
  assert.equal(strokes.length, 2);
  assert.match(strokes[0].getAttribute('d'), / a /);
  assert.match(strokes[1].getAttribute('transform'), /^rotate\(-1\.6 /);
  assert.ok(!strokes[0].hasAttribute('transform'));
  assert.equal(calls.find(c => c.op === 'fromTo' && c.target === strokes[0]).at, 2.5);  // cue 1
});

test('data-mark box: two closed rectangle strokes at the entry stagger', () => {
  const el = markEl('box');
  const s1 = markScene([el]);
  const { calls } = runScript({ sceneEls: { 'scene-s1': s1 } });
  const layer = s1.children.find(c => c.tag === 'svg');
  const strokes = layer.children.filter(c => c.tag === 'path');
  assert.equal(strokes.length, 2);
  assert.ok(strokes.every(p => / Z$/.test(p.getAttribute('d'))));
  assert.ok(Math.abs(calls.find(c => c.op === 'fromTo' && c.target === strokes[0]).at - 0.1) < 1e-9,
    'no data-cue -> scene entry stagger');
});

test('data-mark highlight: an accent rect swept in with scaleX from the left', () => {
  const el = markEl('highlight', { 'data-cue': '0' });
  const s1 = markScene([el]);
  const { calls } = runScript({ sceneEls: { 'scene-s1': s1 } });
  const layer = s1.children.find(c => c.tag === 'svg');
  const rect = layer.children.find(c => c.tag === 'rect');
  assert.ok(rect, 'the highlight is a rect, not a path');
  assert.equal(rect.getAttribute('class'), 'markhl');
  // transformOrigin is pre-seeded via tl.set before the tween.
  const set = calls.find(c => c.op === 'set' && c.target === rect);
  assert.equal(set.vars.transformOrigin, 'left center');
  const tw = calls.find(c => c.op === 'fromTo' && c.target === rect);
  assert.equal(tw.from.scaleX, 0);
  assert.equal(tw.to.scaleX, 1);
  assert.equal(tw.at, 0.16);
  assert.equal(layer.children.filter(c => c.tag === 'path').length, 0);
});

test('data-mark honors data-delay and unknown kinds are ignored', () => {
  const late = markEl('underline', { 'data-cue': '0', 'data-delay': '0.5' });
  const junk = markEl('scribble');
  const s1 = markScene([late]);
  const s2 = markScene([junk]);
  const { calls } = runScript({ sceneEls: { 'scene-s1': s1, 'scene-s2': s2 } });
  const layer = s1.children.find(c => c.tag === 'svg');
  const strokes = layer.children.filter(c => c.tag === 'path');
  assert.equal(calls.find(c => c.op === 'fromTo' && c.target === strokes[0]).at, 0.16 + 0.5);
  assert.ok(!s2.children.some(c => c.tag === 'svg'), 'unknown kind: no mark layer created');
  assert.ok(!calls.some(c => strokes.length && c.target === junk), 'unknown kind: no tweens');
});

test('data-mark on an SVG transform carrier moves to the wrapper', () => {
  const marker = makeNode('g', { transform: 'translate(100,60)', 'data-mark': 'circle', 'data-cue': '0' });
  marker.namespaceURI = 'http://www.w3.org/2000/svg';
  const svg = makeNode('svg');
  svg.appendChild(marker);
  const s1 = markScene([marker]);
  runScript({ sceneEls: { 'scene-s1': s1 } });
  const wrap = svg.children[0];
  assert.equal(wrap.getAttribute('data-mark'), 'circle');
  assert.ok(!marker.hasAttribute('data-mark'), 'carrier keeps only its transform');
});
