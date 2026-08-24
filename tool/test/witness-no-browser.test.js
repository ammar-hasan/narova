'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  MAX_NODES_PER_SAMPLE, MAX_SAMPLES, SCHEMA, extractNoBrowserVisualNodes,
  _internals: { boundedSamples, multiply, transformedBox },
} = require('../src/witness-no-browser');

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const time = seconds => ({ ticks: Math.round(seconds * 100000000), timescale: 100000000 });
const sample = (frameIndex, seconds) => ({
  frameIndex,
  frameResource: `resource:frame:${String(frameIndex).padStart(6, '0')}`,
  time: time(seconds),
});

function manifest(visual, overrides = {}) {
  return {
    renderer: { provider: 'no-browser', providerVersion: 'test-renderer' },
    format: { width: 640, height: 360, fps: 30 },
    captions: { enabled: false, preset: 'subtitle' },
    safeLayout: false,
    scenes: [{
      id: 'only', index: 0, start: 0, duration: 2, transition: 'fade', vo: [], visual,
    }],
    ...overrides,
  };
}

function input(document, samples = [sample(0, 0), sample(1, 0.5)]) {
  return {
    manifest: document,
    artifact: { algorithm: 'sha256', digest: DIGEST_A, bytes: 1234 },
    manifestIdentity: { algorithm: 'sha256', digest: DIGEST_B, bytes: 5678 },
    samples,
  };
}

test('extractor consumes exact artifact samples and emits renderer-state boxes without filesystem lookup', () => {
  const document = manifest({
    type: 'rect', style: { width: 320, height: 180 },
    children: [{ type: 'rect', style: { x: 20, y: 30, width: 100, height: 40 } }],
  });
  const original = fs.readFileSync;
  fs.readFileSync = () => { throw new Error('unexpected filesystem read'); };
  let result;
  try { result = extractNoBrowserVisualNodes(input(document, [sample(7, 0.375)])); }
  finally { fs.readFileSync = original; }

  assert.equal(result.schema, SCHEMA);
  assert.deepEqual(result.source.artifact, input(document).artifact);
  assert.deepEqual(result.source.manifest, input(document).manifestIdentity);
  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].frameIndex, 7);
  assert.deepEqual(result.samples[0].time, time(0.375));
  assert.equal(result.samples[0].frameResource, 'resource:frame:000007');
  assert.deepEqual(result.samples[0].nodes.map(node => node.path), [
    'scene:only/visual', 'scene:only/visual/children/0',
  ]);
  assert.deepEqual(result.samples[0].nodes[1].layoutBox,
    { x: 20, y: 30, width: 100, height: 40 });
  assert.equal(result.coverage.partial, false);
  assert.match(result.limitations[0], /do not establish.*pixels.*perceptible/);
});

test('nested opacity, animation, draw order, and declared clip ancestry follow renderer state', () => {
  const document = manifest({
    type: 'rect',
    style: { width: 300, height: 200, opacity: 0.5, overflow: 'hidden', radius: 12 },
    children: [{
      type: 'rect', style: { width: 200, height: 100, opacity: 0.8 },
      children: [{
        type: 'rect', style: { width: 80, height: 40, opacity: 0.6 },
        enter: { type: 'fade', at: 0.3, duration: 0.5 },
      }],
    }],
  });
  const result = extractNoBrowserVisualNodes(input(document, [sample(0, 0.2), sample(1, 1)]));
  const early = result.samples[0].nodes;
  const settled = result.samples[1].nodes;
  assert.deepEqual(settled.map(node => node.drawOrder), [0, 1, 2]);
  assert.equal(settled[0].effectiveOpacity, 0.5);
  assert.equal(settled[1].effectiveOpacity, 0.4);
  assert.equal(settled[2].effectiveOpacity, 0.24);
  assert.equal(early[2].effectiveOpacity, 0);
  assert.equal(settled[2].clipChain.length, 1);
  assert.equal(settled[2].clipChain[0].path, 'scene:only/visual');
  assert.equal(settled[0].declaredClip, true);
});

test('later-scene cue animation converts compiled global turn starts back to renderer-local time', () => {
  const document = manifest({ type: 'rect' }, {
    scenes: [{
      id: 'first', index: 0, start: 0, duration: 1, transition: 'fade', vo: [],
      visual: { type: 'rect' },
    }, {
      id: 'second', index: 1, start: 1, duration: 1, transition: 'fade',
      vo: [{ who: 'n', text: 'cue', start: 1.2, words: [] }],
      visual: { type: 'rect', enter: { type: 'fade', at: { cue: 0 }, duration: 0.2 } },
    }],
  });
  const result = extractNoBrowserVisualNodes(input(document, [sample(10, 1.1), sample(11, 1.5)]));
  assert.equal(result.samples[0].scene.id, 'second');
  assert.equal(result.samples[0].nodes[0].animationState.opacity, 0);
  assert.equal(result.samples[1].nodes[0].animationState.opacity, 1);
});

test('progress state and scene wipe participate in neutral production-state evidence', () => {
  const document = manifest({ type: 'rect' }, {
    scenes: [{
      id: 'first', index: 0, start: 0, duration: 1, transition: 'fade', vo: [],
      visual: { type: 'rect' },
    }, {
      id: 'second', index: 1, start: 1, duration: 1, transition: 'wipe', vo: [],
      visual: { type: 'progress', value: 0.25, style: { width: 200, height: 20 } },
    }],
  });
  const result = extractNoBrowserVisualNodes(input(document, [sample(10, 1.1)]));
  const state = result.samples[0];
  assert.equal(state.nodes[0].animationState.progress, 0.25);
  assert.equal(state.sceneClip.kind, 'scene-transition-wipe');
  assert.equal(state.nodes[0].clipChain[0].path, 'scene:second/transition-wipe');
});

test('display AABB includes ancestor transforms while retaining neutral cropped geometry', () => {
  const document = manifest({
    type: 'rect', style: { rotate: 15 },
    children: [{
      type: 'rect', style: { x: -700, y: 20, width: 300, height: 200, rotate: 90 },
      children: [{ type: 'rect', style: { x: 10, y: 15, width: 60, height: 30 } }],
    }],
  });
  const result = extractNoBrowserVisualNodes(input(document, [sample(0, 1)]));
  const root = result.samples[0].nodes[1];
  const child = result.samples[0].nodes[2];
  assert.notDeepEqual(child.displayAabb, child.animatedBox);
  assert.ok(root.displayAabb.x < 0);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /quality|warning|defect|repair|score|verdict|recommendation/i);
});

test('bounded selection and node traversal expose deterministic partial coverage', () => {
  const children = Array.from({ length: 12 }, (_, index) => ({
    type: 'rect', style: { x: index, width: 2, height: 2 },
  }));
  const samples = Array.from({ length: 10 }, (_, index) => sample(index, index / 10));
  const result = extractNoBrowserVisualNodes({
    ...input(manifest({ type: 'stack', children }), samples),
    options: { maximumSamples: 3, maximumNodesPerSample: 4 },
  });
  assert.deepEqual(result.samples.map(item => item.frameIndex), [0, 4, 9]);
  assert.ok(result.samples.every(item => item.nodes.length === 4 && item.truncated));
  assert.equal(result.coverage.sampleTruncation, true);
  assert.equal(result.coverage.nodeTruncations, 3);
  assert.equal(result.coverage.partial, true);
  assert.equal(MAX_SAMPLES, 64);
  assert.equal(MAX_NODES_PER_SAMPLE, 256);
  assert.deepEqual(boundedSamples(samples, 1).map(item => item.frameIndex), [0]);
});

test('missing visual is explicit and HyperFrames or malformed bindings are rejected', () => {
  const unavailable = extractNoBrowserVisualNodes(input(manifest(null), [sample(0, 0.2)]));
  assert.equal(unavailable.samples[0].availability, 'UNAVAILABLE');
  assert.equal(unavailable.coverage.unavailableSamples, 1);
  assert.equal(unavailable.coverage.partial, true);

  const hyperframes = manifest({ type: 'rect' });
  hyperframes.renderer.provider = 'hyperframes';
  assert.throws(() => extractNoBrowserVisualNodes(input(hyperframes)), /exact no-browser manifest/);
  assert.throws(() => extractNoBrowserVisualNodes({
    ...input(manifest({ type: 'rect' })), artifact: { algorithm: 'sha256', digest: 'bad', bytes: 1 },
  }), /artifact identity is invalid/);
});

test('matrix helpers preserve exact identity and transformed corner enclosure', () => {
  const identity = [1, 0, 0, 1, 0, 0];
  assert.deepEqual(multiply(identity, identity), identity);
  assert.deepEqual(transformedBox({ x: 10, y: 20, w: 30, h: 40 }, identity),
    { x: 10, y: 20, width: 30, height: 40 });
});
