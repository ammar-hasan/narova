'use strict';
/* Pure, bounded production-state extraction for the no-browser renderer.
 *
 * The caller supplies the exact receipt-embedded manifest and exact artifact
 * frame samples. This module never reads mutable project/output files and does
 * not inspect pixels, infer viewer visibility, or make creative judgements. */
const {
  animatedState, captionSafeInset, layoutTree, transitionState,
} = require('./renderers/no-browser')._internals;

const SCHEMA = 'narova.renderer-visual-node-boxes/1';
const MAX_SAMPLES = 64;
const MAX_NODES_PER_SAMPLE = 256;
const MAX_DEPTH = 128;
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

function round(value, places = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clampOpacity(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function multiply(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ];
}

const translate = (x, y) => [1, 0, 0, 1, x, y];
const scale = value => [value, 0, 0, value, 0, 0];
const rotate = radians => [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];

function around(cx, cy, rotation, scaleValue) {
  return multiply(
    multiply(multiply(translate(cx, cy), rotate(rotation)), scale(scaleValue)),
    translate(-cx, -cy),
  );
}

function point(matrix, x, y) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function box(value) {
  return {
    x: round(value.x), y: round(value.y),
    width: round(value.w), height: round(value.h),
  };
}

function transformedBox(value, matrix) {
  const points = [
    point(matrix, value.x, value.y),
    point(matrix, value.x + value.w, value.y),
    point(matrix, value.x + value.w, value.y + value.h),
    point(matrix, value.x, value.y + value.h),
  ];
  const xs = points.map(item => item.x);
  const ys = points.map(item => item.y);
  return {
    x: round(Math.min(...xs)), y: round(Math.min(...ys)),
    width: round(Math.max(...xs) - Math.min(...xs)),
    height: round(Math.max(...ys) - Math.min(...ys)),
  };
}

function boundedSamples(samples, maximum) {
  if (samples.length <= maximum) return samples.slice();
  if (maximum === 1) return [samples[0]];
  const selected = [];
  const seen = new Set();
  for (let index = 0; index < maximum; index++) {
    const sourceIndex = Math.floor(index * (samples.length - 1) / (maximum - 1));
    if (!seen.has(sourceIndex)) {
      selected.push(samples[sourceIndex]);
      seen.add(sourceIndex);
    }
  }
  return selected;
}

function validateIdentity(value, name) {
  if (!value || value.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(value.digest || '')
      || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    throw new Error(`no-browser Witness ${name} identity is invalid`);
  }
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('no-browser Witness input is invalid');
  }
  const manifest = input.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || !manifest.renderer || manifest.renderer.provider !== 'no-browser') {
    throw new Error('no-browser Witness requires an exact no-browser manifest snapshot');
  }
  const format = manifest.format;
  if (!format || !Number.isFinite(format.width) || format.width <= 0
      || !Number.isFinite(format.height) || format.height <= 0
      || !Number.isFinite(format.fps) || format.fps <= 0
      || !Array.isArray(manifest.scenes)) {
    throw new Error('no-browser Witness manifest geometry or scenes are invalid');
  }
  manifest.scenes.forEach((scene, index) => {
    if (!scene || typeof scene.id !== 'string' || !scene.id
        || !Number.isFinite(Number(scene.start)) || Number(scene.start) < 0
        || !Number.isFinite(Number(scene.duration)) || Number(scene.duration) <= 0) {
      throw new Error(`no-browser Witness manifest scene ${index} timing is invalid`);
    }
  });
  validateIdentity(input.artifact, 'artifact');
  validateIdentity(input.manifestIdentity, 'manifest');
  if (!Array.isArray(input.samples)) throw new Error('no-browser Witness samples are invalid');
  const frames = new Set();
  input.samples.forEach((sample, index) => {
    if (!sample || !Number.isSafeInteger(sample.frameIndex) || sample.frameIndex < 0
        || frames.has(sample.frameIndex) || typeof sample.frameResource !== 'string'
        || !sample.frameResource.startsWith('resource:frame:')
        || !sample.time || !Number.isSafeInteger(sample.time.ticks)
        || !Number.isSafeInteger(sample.time.timescale) || sample.time.timescale <= 0) {
      throw new Error(`no-browser Witness sample ${index} is invalid or duplicate`);
    }
    frames.add(sample.frameIndex);
  });
  return input;
}

function sceneTimeline(scene) {
  const sceneStart = Number(scene.start);
  return {
    start: sceneStart,
    dur: Number(scene.duration),
    // Compiled manifest turn starts are artifact-global; animatedState consumes
    // the scene-local turns carried by the renderer project timeline.
    turns: (scene.vo || []).map(turn => Number.isFinite(Number(turn.start))
      ? Math.max(0, Number(turn.start) - sceneStart) : 0),
    transition: scene.transition || 'fade',
  };
}

function activeScene(scenes, seconds) {
  let selected = null;
  let index = -1;
  for (let current = 0; current < scenes.length; current++) {
    const start = Number(scenes[current] && scenes[current].start);
    if (Number.isFinite(start) && seconds >= start) {
      selected = scenes[current];
      index = current;
    }
  }
  return selected ? { scene: selected, index } : null;
}

function captionInset(manifest, height) {
  const captions = manifest.captions || {};
  const groupsExist = manifest.scenes.some(scene => (scene.vo || [])
    .some(turn => Array.isArray(turn.words) && turn.words.length));
  return captionSafeInset({
    safeLayout: manifest.safeLayout === true,
    captionsEnabled: captions.enabled !== false,
    size: { h: height },
    timeline: {
      preset: captions.enabled === false ? false : (captions.preset || 'subtitle'),
      groups: groupsExist ? [{}] : [],
    },
  });
}

function sceneMatrix(width, height, transition) {
  const cx = width / 2;
  const cy = height / 2;
  return multiply(
    multiply(translate(cx + transition.x, cy), scale(transition.scale)),
    translate(-cx, -cy),
  );
}

function stateRecord(state) {
  return {
    x: round(state.x), y: round(state.y),
    scale: round(state.scale), rotateDegrees: round(state.rotate),
    opacity: round(clampOpacity(state.opacity)),
    width: Number.isFinite(state.width) ? round(state.width) : null,
    height: Number.isFinite(state.height) ? round(state.height) : null,
    progress: Number.isFinite(state.progress) ? round(state.progress) : null,
  };
}

function extractSample(manifest, sample, nodeLimit) {
  const seconds = sample.time.ticks / sample.time.timescale;
  const active = activeScene(manifest.scenes, seconds);
  if (!active || !active.scene.visual) {
    return {
      frameIndex: sample.frameIndex, frameResource: sample.frameResource,
      time: sample.time, availability: 'UNAVAILABLE',
      reason: active ? 'BOUND_SCENE_HAS_NO_PORTABLE_VISUAL_TREE' : 'NO_BOUND_SCENE_AT_ARTIFACT_TIME',
      nodes: [], truncated: false,
    };
  }
  const width = Number(manifest.format.width);
  const height = Number(manifest.format.height);
  const timeline = sceneTimeline(active.scene);
  const localTime = Math.max(0, seconds - timeline.start);
  const transition = transitionState(timeline, localTime, active.index);
  const rootMatrix = sceneMatrix(width, height, transition);
  const sceneClip = transition.wipe < 1 ? {
    kind: 'scene-transition-wipe',
    path: `scene:${active.scene.id}/transition-wipe`,
    displayBox: box({ x: 0, y: 0, w: width * transition.wipe, h: height }),
  } : null;
  const frames = layoutTree(active.scene.visual, width, height, {
    b: captionInset(manifest, height),
  });
  const stack = [{
    node: active.scene.visual,
    path: `scene:${active.scene.id}/visual`,
    depth: 0,
    parentMatrix: IDENTITY,
    parentOpacity: clampOpacity(transition.opacity),
    clipChain: sceneClip ? [sceneClip] : [],
  }];
  const nodes = [];
  let drawOrder = 0;
  let depthLimited = false;
  while (stack.length && nodes.length < nodeLimit) {
    const entry = stack.pop();
    const node = entry.node;
    const style = node.style || {};
    const base = frames.get(node) || { x: 0, y: 0, w: 0, h: 0 };
    const state = animatedState(node, localTime, timeline);
    const local = {
      x: base.x + state.x,
      y: base.y + state.y,
      w: state.width == null ? base.w : state.width,
      h: state.height == null ? base.h : state.height,
    };
    const cx = local.x + local.w / 2;
    const cy = local.y + local.h / 2;
    const ownMatrix = around(cx, cy, state.rotate * Math.PI / 180, state.scale);
    const cumulative = multiply(multiply(rootMatrix, entry.parentMatrix), ownMatrix);
    const effectiveOpacity = clampOpacity(entry.parentOpacity * clampOpacity(state.opacity));
    const declaredClip = style.overflow === 'hidden' || style.clip === true;
    const ownClip = declaredClip ? {
      path: entry.path,
      localBox: box(local),
      displayAabb: transformedBox(local, cumulative),
      radius: round(Number(style.radius) || 0),
    } : null;
    const clipChain = ownClip ? [...entry.clipChain, ownClip] : entry.clipChain;
    nodes.push({
      path: entry.path,
      type: typeof node.type === 'string' ? node.type : 'unknown',
      depth: entry.depth,
      drawOrder: drawOrder++,
      layoutBox: box(base),
      animatedBox: box(local),
      displayAabb: transformedBox(local, cumulative),
      animationState: stateRecord(state),
      effectiveOpacity: round(effectiveOpacity),
      declaredClip,
      clipChain,
    });
    const children = Array.isArray(node.children) ? node.children : [];
    if (entry.depth >= MAX_DEPTH && children.length) {
      depthLimited = true;
      continue;
    }
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({
        node: children[index],
        path: `${entry.path}/children/${index}`,
        depth: entry.depth + 1,
        parentMatrix: multiply(entry.parentMatrix, ownMatrix),
        parentOpacity: effectiveOpacity,
        clipChain,
      });
    }
  }
  return {
    frameIndex: sample.frameIndex,
    frameResource: sample.frameResource,
    time: sample.time,
    availability: 'AVAILABLE',
    scene: { id: active.scene.id, index: active.index, localSeconds: round(localTime, 8) },
    transition: {
      opacity: round(transition.opacity), x: round(transition.x),
      scale: round(transition.scale), wipe: round(transition.wipe),
    },
    sceneClip,
    nodes,
    truncated: stack.length > 0 || depthLimited,
    truncationReasons: [
      ...(stack.length > 0 ? ['NODE_LIMIT'] : []),
      ...(depthLimited ? ['DEPTH_LIMIT'] : []),
    ],
  };
}

function extractNoBrowserVisualNodes(input) {
  validateInput(input);
  const requestedSampleLimit = input.options && input.options.maximumSamples;
  const requestedNodeLimit = input.options && input.options.maximumNodesPerSample;
  const sampleLimit = Number.isInteger(requestedSampleLimit) && requestedSampleLimit > 0
    ? Math.min(requestedSampleLimit, MAX_SAMPLES) : MAX_SAMPLES;
  const nodeLimit = Number.isInteger(requestedNodeLimit) && requestedNodeLimit > 0
    ? Math.min(requestedNodeLimit, MAX_NODES_PER_SAMPLE) : MAX_NODES_PER_SAMPLE;
  const selected = boundedSamples(input.samples, sampleLimit);
  const samples = selected.map(sample => extractSample(input.manifest, sample, nodeLimit));
  const unavailable = samples.filter(sample => sample.availability === 'UNAVAILABLE').length;
  const nodeTruncations = samples.filter(sample => sample.truncated).length;
  return {
    schema: SCHEMA,
    source: {
      artifact: input.artifact,
      manifest: input.manifestIdentity,
      renderer: {
        provider: 'no-browser',
        version: input.manifest.renderer.providerVersion || null,
      },
    },
    options: { maximumSamples: sampleLimit, maximumNodesPerSample: nodeLimit, maximumDepth: MAX_DEPTH },
    coverage: {
      inputSamples: input.samples.length,
      analyzedSamples: samples.length,
      unavailableSamples: unavailable,
      sampleTruncation: input.samples.length > samples.length,
      nodeTruncations,
      partial: unavailable > 0 || nodeTruncations > 0 || input.samples.length > samples.length,
    },
    samples,
    limitations: [
      'production-state boxes do not establish that corresponding pixels were painted or perceptible to a viewer',
      'displayAabb encloses transformed corners; clipChain records node clips and transition wipes without computing an exact clipped polygon or visible fraction',
      'the channel covers the bound portable visual tree, not renderer chrome, caption glyphs, or raster clip contents',
      'structural paths are stable only within the bound manifest source digest',
    ],
  };
}

module.exports = {
  MAX_NODES_PER_SAMPLE, MAX_SAMPLES, SCHEMA,
  extractNoBrowserVisualNodes,
  _internals: { around, boundedSamples, multiply, transformedBox },
};
