'use strict';

const { OUTPUT_SCHEMA } = require('./bake-rigid-body');

function fail(message) {
  throw new Error(message);
}

function interpolateArray(a, b, progress) {
  return a.map((value, index) => value + (b[index] - value) * progress);
}

function normalizedQuaternion(a, b, progress) {
  let target = b;
  if (a.reduce((sum, value, index) => sum + value * b[index], 0) < 0) target = b.map(value => -value);
  const value = interpolateArray(a, target, progress);
  const length = Math.hypot(...value);
  return value.map(component => component / length);
}

function sampleAt(bake, time) {
  if (!bake || bake.schema !== OUTPUT_SCHEMA || !Array.isArray(bake.samples) || bake.samples.length === 0) {
    fail(`bake must use '${OUTPUT_SCHEMA}' and contain samples`);
  }
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > bake.timing.duration) {
    fail(`time must be between 0 and ${bake.timing.duration}`);
  }
  let upperIndex = bake.samples.findIndex(sample => sample.time >= time);
  if (upperIndex < 0) upperIndex = bake.samples.length - 1;
  const upper = bake.samples[upperIndex];
  const lower = upperIndex === 0 ? upper : bake.samples[upperIndex - 1];
  if (upper.time === lower.time || time === upper.time) return structuredClone(upper);
  const progress = (time - lower.time) / (upper.time - lower.time);
  const upperById = new Map(upper.bodies.map(body => [body.id, body]));
  return {
    time,
    bodies: lower.bodies.map(body => {
      const next = upperById.get(body.id);
      return {
        id: body.id,
        position: interpolateArray(body.position, next.position, progress),
        rotation: normalizedQuaternion(body.rotation, next.rotation, progress),
        linearVelocity: interpolateArray(body.linearVelocity, next.linearVelocity, progress),
        angularVelocity: interpolateArray(body.angularVelocity, next.angularVelocity, progress),
        sleeping: progress < 1 ? body.sleeping : next.sleeping,
      };
    }),
    constraints: structuredClone(lower.constraints),
  };
}

module.exports = { sampleAt };
