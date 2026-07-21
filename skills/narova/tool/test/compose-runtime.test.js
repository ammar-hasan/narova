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

/* Minimal DOM + GSAP stubs. */
function makeNode(tag) {
  return {
    tag, className: '', id: '', children: [], textContent: '',
    set innerHTML(v) { this._innerHTML = v; }, get innerHTML() { return this._innerHTML || ''; },
    appendChild(c) { this.children.push(c); return c; },
  };
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
    createTextNode: t => ({ text: t }),
  };
  const window = {};
  new Function('window', 'document', 'gsap', 'DATA', runtimeScript())(window, document, gsap, DATA);
  return { calls, window, capStage, tl };
}

/* A scene element whose querySelectorAll returns canned nodes per selector. */
function sceneEl(bySelector) {
  return { querySelectorAll: sel => bySelector[sel] || [] };
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
  const cue = makeNode('p');
  cue.getAttribute = () => '0';
  const { calls } = runScript({
    sceneEls: { 'scene-s2': sceneEl({ '[data-cue]': [cue] }) },
  });
  const tw = calls.find(c => c.op === 'fromTo' && c.target === cue);
  assert.equal(tw.at, 5 + 0.16);
});

test('unresolvable cue falls back to scene entry (check.js parity)', () => {
  for (const raw of ['9', '-1', 'nope', '1.5']) {
    const cue = makeNode('p');
    cue.getAttribute = () => raw;
    const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl({ '[data-cue]': [cue] }) } });
    const tw = calls.find(c => c.op === 'fromTo' && c.target === cue);
    assert.equal(tw.at, 0, `data-cue="${raw}" must reveal at scene entry`);
  }
  // "1.0" coerces to integer 1 -> resolves to turn 1, NOT scene entry
  const cue = makeNode('p');
  cue.getAttribute = () => '1.0';
  const { calls } = runScript({ sceneEls: { 'scene-s1': sceneEl({ '[data-cue]': [cue] }) } });
  assert.equal(calls.find(c => c.op === 'fromTo' && c.target === cue).at, 2.5);
});

test('reveal/cue-without-attr animate at scene entry; no double tween with data-cue', () => {
  const reveal = makeNode('h1');
  const { calls } = runScript({
    sceneEls: { 'scene-s1': sceneEl({ '.reveal:not([data-cue]), .cue:not([data-cue])': [reveal] }) },
  });
  const tw = calls.filter(c => c.op === 'fromTo' && c.target === reveal);
  assert.equal(tw.length, 1);
  assert.ok(Math.abs(tw[0].at - 0.1) < 1e-9);   // sc.start + 0.1
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
    createTextNode: t => ({ text: t }),
  };
  new Function('window', 'document', 'gsap', 'DATA', runtimeScript())({}, document, gsap, DATA);
  assert.ok(!calls.some(c => c.target === '#progress-bar'), 'no tween may target a missing progress bar');
  assert.ok(calls.some(c => c.op === 'to' && c.vars.duration === DATA.total), 'full-span anchor still present');
});

test('determinism: script contains no clocks, randomness, or infinite repeats', () => {
  const src = runtimeScript();
  for (const banned of ['Date.now', 'performance.now', 'Math.random', 'repeat: -1', 'repeat:-1', 'setTimeout', 'requestAnimationFrame', 'fetch(']) {
    assert.ok(!src.includes(banned), `generated runtime must not contain ${banned}`);
  }
});
