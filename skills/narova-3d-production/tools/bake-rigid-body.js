#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'narova.3d-rigid-body/1';
const OUTPUT_SCHEMA = 'narova.3d-rigid-body-bake/1';
const ADAPTER = Object.freeze({ id: 'narova-rapier-rigid-body', version: '0.1.0' });
const MAX_BODIES = 128;
const MAX_CONSTRAINTS = 128;
const MAX_ACTIONS = 1024;
const MAX_STEPS = 240000;
const MAX_SAMPLES = 36000;
const MAX_INPUT_BYTES = 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function finiteNumber(value, field, { min = -Infinity, max = Infinity, exclusiveMin = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be a finite number`);
  if ((exclusiveMin ? value <= min : value < min) || value > max) {
    fail(`${field} must be ${exclusiveMin ? '>' : '>='} ${min} and <= ${max}`);
  }
  return value;
}

function vector(value, field, length) {
  if (!Array.isArray(value) || value.length !== length) fail(`${field} must contain exactly ${length} numbers`);
  return value.map((entry, index) => finiteNumber(entry, `${field}[${index}]`));
}

function optionalVector(value, field, length, fallback) {
  return value === undefined ? fallback.slice() : vector(value, field, length);
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`);
  return value;
}

function exactKeys(value, field, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${field}.${key} is not supported`);
  }
}

function uniqueId(value, field, used) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(value)) {
    fail(`${field} must be a stable identifier of 1-64 characters`);
  }
  if (used.has(value)) fail(`${field} duplicates '${value}'`);
  used.add(value);
  return value;
}

function requireWholeRatio(value, unit, field) {
  const ratio = value / unit;
  const rounded = Math.round(ratio);
  if (Math.abs(ratio - rounded) > 1e-8) fail(`${field} must align to the fixed simulation step`);
  return rounded;
}

function normalizeShape(raw, field) {
  const shape = object(raw, field);
  if (shape.kind === 'box') {
    exactKeys(shape, field, new Set(['kind', 'halfExtents']));
    const halfExtents = vector(shape.halfExtents, `${field}.halfExtents`, 3);
    halfExtents.forEach((n, i) => finiteNumber(n, `${field}.halfExtents[${i}]`, { min: 0, exclusiveMin: true, max: 10000 }));
    return { kind: 'box', halfExtents };
  }
  if (shape.kind === 'sphere') {
    exactKeys(shape, field, new Set(['kind', 'radius']));
    return { kind: 'sphere', radius: finiteNumber(shape.radius, `${field}.radius`, { min: 0, exclusiveMin: true, max: 10000 }) };
  }
  if (shape.kind === 'capsule') {
    exactKeys(shape, field, new Set(['kind', 'halfHeight', 'radius']));
    return {
      kind: 'capsule',
      halfHeight: finiteNumber(shape.halfHeight, `${field}.halfHeight`, { min: 0, exclusiveMin: true, max: 10000 }),
      radius: finiteNumber(shape.radius, `${field}.radius`, { min: 0, exclusiveMin: true, max: 10000 }),
    };
  }
  fail(`${field}.kind '${String(shape.kind)}' is unsupported; use box, sphere, or capsule`);
}

function normalizeRecipe(raw) {
  const recipe = object(raw, 'recipe');
  exactKeys(recipe, 'recipe', new Set(['schema', 'units', 'step', 'duration', 'sampleRate', 'gravity', 'bodies', 'constraints', 'actions']));
  if (recipe.schema !== SCHEMA) fail(`recipe.schema must be '${SCHEMA}'`);
  if (recipe.units !== 'm-kg-s') fail("recipe.units must be 'm-kg-s'");
  const step = finiteNumber(recipe.step, 'recipe.step', { min: 0, exclusiveMin: true, max: 1 });
  const duration = finiteNumber(recipe.duration, 'recipe.duration', { min: 0, exclusiveMin: true, max: 600 });
  const sampleRate = finiteNumber(recipe.sampleRate, 'recipe.sampleRate', { min: 0, exclusiveMin: true, max: 240 });
  if (!Number.isInteger(sampleRate)) fail('recipe.sampleRate must be an integer');
  const stepCount = requireWholeRatio(duration, step, 'recipe.duration');
  const stepsPerSample = requireWholeRatio(1 / sampleRate, step, 'recipe.sampleRate');
  if (stepsPerSample < 1) fail('recipe.sampleRate must not exceed the simulation step rate');
  const sampleIntervals = duration * sampleRate;
  if (Math.abs(sampleIntervals - Math.round(sampleIntervals)) > 1e-8) fail('recipe.duration must contain a whole number of sample intervals');
  const sampleCount = Math.round(sampleIntervals) + 1;
  if (stepCount > MAX_STEPS) fail(`recipe requests ${stepCount} steps; maximum is ${MAX_STEPS}`);
  if (sampleCount > MAX_SAMPLES) fail(`recipe requests ${sampleCount} samples; maximum is ${MAX_SAMPLES}`);
  const gravity = optionalVector(recipe.gravity, 'recipe.gravity', 3, [0, -9.81, 0]);

  if (!Array.isArray(recipe.bodies) || recipe.bodies.length === 0 || recipe.bodies.length > MAX_BODIES) {
    fail(`recipe.bodies must contain 1-${MAX_BODIES} bodies`);
  }
  const ids = new Set();
  const bodies = recipe.bodies.map((entry, index) => {
    const field = `recipe.bodies[${index}]`;
    const body = object(entry, field);
    exactKeys(body, field, new Set(['id', 'type', 'shape', 'position', 'rotation', 'linearVelocity', 'angularVelocity', 'density', 'friction', 'restitution', 'linearDamping', 'angularDamping', 'canSleep']));
    const id = uniqueId(body.id, `${field}.id`, ids);
    if (!['fixed', 'dynamic', 'kinematic'].includes(body.type)) fail(`${field}.type must be fixed, dynamic, or kinematic`);
    const rotation = optionalVector(body.rotation, `${field}.rotation`, 4, [0, 0, 0, 1]);
    const norm = Math.hypot(...rotation);
    if (norm < 1e-12) fail(`${field}.rotation must be a non-zero quaternion`);
    return {
      id,
      type: body.type,
      shape: normalizeShape(body.shape, `${field}.shape`),
      position: optionalVector(body.position, `${field}.position`, 3, [0, 0, 0]),
      rotation: rotation.map(n => n / norm),
      linearVelocity: optionalVector(body.linearVelocity, `${field}.linearVelocity`, 3, [0, 0, 0]),
      angularVelocity: optionalVector(body.angularVelocity, `${field}.angularVelocity`, 3, [0, 0, 0]),
      density: body.density === undefined ? 1 : finiteNumber(body.density, `${field}.density`, { min: 0, exclusiveMin: true, max: 100000 }),
      friction: body.friction === undefined ? 0.5 : finiteNumber(body.friction, `${field}.friction`, { min: 0, max: 10 }),
      restitution: body.restitution === undefined ? 0 : finiteNumber(body.restitution, `${field}.restitution`, { min: 0, max: 1 }),
      linearDamping: body.linearDamping === undefined ? 0 : finiteNumber(body.linearDamping, `${field}.linearDamping`, { min: 0, max: 1000 }),
      angularDamping: body.angularDamping === undefined ? 0 : finiteNumber(body.angularDamping, `${field}.angularDamping`, { min: 0, max: 1000 }),
      canSleep: body.canSleep === undefined ? true : (() => {
        if (typeof body.canSleep !== 'boolean') fail(`${field}.canSleep must be a boolean`);
        return body.canSleep;
      })(),
    };
  });

  const constraintIds = new Set();
  const constraintsRaw = recipe.constraints === undefined ? [] : recipe.constraints;
  if (!Array.isArray(constraintsRaw) || constraintsRaw.length > MAX_CONSTRAINTS) fail(`recipe.constraints must contain at most ${MAX_CONSTRAINTS} entries`);
  const constraints = constraintsRaw.map((entry, index) => {
    const field = `recipe.constraints[${index}]`;
    const constraint = object(entry, field);
    exactKeys(constraint, field, new Set(['id', 'type', 'bodyA', 'bodyB', 'anchorA', 'anchorB', 'axis', 'limits']));
    const id = uniqueId(constraint.id, `${field}.id`, constraintIds);
    if (!['fixed', 'revolute', 'prismatic'].includes(constraint.type)) fail(`${field}.type must be fixed, revolute, or prismatic`);
    if (!ids.has(constraint.bodyA) || !ids.has(constraint.bodyB) || constraint.bodyA === constraint.bodyB) fail(`${field} must name two distinct existing bodies`);
    const normalized = {
      id,
      type: constraint.type,
      bodyA: constraint.bodyA,
      bodyB: constraint.bodyB,
      anchorA: optionalVector(constraint.anchorA, `${field}.anchorA`, 3, [0, 0, 0]),
      anchorB: optionalVector(constraint.anchorB, `${field}.anchorB`, 3, [0, 0, 0]),
    };
    if (constraint.type !== 'fixed') {
      normalized.axis = vector(constraint.axis, `${field}.axis`, 3);
      const axisNorm = Math.hypot(...normalized.axis);
      if (axisNorm < 1e-12) fail(`${field}.axis must be non-zero`);
      normalized.axis = normalized.axis.map(n => n / axisNorm);
    } else if (constraint.axis !== undefined || constraint.limits !== undefined) {
      fail(`${field} fixed constraints do not accept axis or limits`);
    }
    if (constraint.limits !== undefined) {
      const limits = vector(constraint.limits, `${field}.limits`, 2);
      if (limits[0] > limits[1]) fail(`${field}.limits minimum must not exceed maximum`);
      normalized.limits = limits;
    }
    return normalized;
  });

  const actionIds = new Set();
  const actionsRaw = recipe.actions === undefined ? [] : recipe.actions;
  if (!Array.isArray(actionsRaw) || actionsRaw.length > MAX_ACTIONS) fail(`recipe.actions must contain at most ${MAX_ACTIONS} entries`);
  const actions = actionsRaw.map((entry, index) => {
    const field = `recipe.actions[${index}]`;
    const action = object(entry, field);
    exactKeys(action, field, new Set(['id', 'time', 'type', 'body', 'value', 'rotation']));
    const id = uniqueId(action.id, `${field}.id`, actionIds);
    if (!['impulse', 'torqueImpulse', 'kinematicPosition'].includes(action.type)) fail(`${field}.type must be impulse, torqueImpulse, or kinematicPosition`);
    if (!ids.has(action.body)) fail(`${field}.body '${String(action.body)}' does not exist`);
    const target = bodies.find(body => body.id === action.body);
    if (action.type === 'kinematicPosition' && target.type !== 'kinematic') fail(`${field} kinematicPosition requires a kinematic body`);
    if (action.type !== 'kinematicPosition' && target.type !== 'dynamic') fail(`${field} ${action.type} requires a dynamic body`);
    const normalized = {
      id,
      time: finiteNumber(action.time, `${field}.time`, { min: 0, max: duration }),
      type: action.type,
      body: action.body,
      value: vector(action.value, `${field}.value`, 3),
    };
    if (action.type === 'kinematicPosition') {
      const rotation = optionalVector(action.rotation, `${field}.rotation`, 4, [0, 0, 0, 1]);
      const rotationNorm = Math.hypot(...rotation);
      if (rotationNorm < 1e-12) fail(`${field}.rotation must be a non-zero quaternion`);
      normalized.rotation = rotation.map(n => n / rotationNorm);
    } else if (action.rotation !== undefined) {
      fail(`${field}.rotation is only valid for kinematicPosition`);
    }
    requireWholeRatio(normalized.time, step, `${field}.time`);
    return normalized;
  }).sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  return { schema: SCHEMA, units: 'm-kg-s', step, duration, sampleRate, gravity, bodies, constraints, actions };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

function cleanNumber(value) {
  if (!Number.isFinite(value)) fail('simulation diverged to non-finite state');
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function cleanVec(value) {
  return [cleanNumber(value.x), cleanNumber(value.y), cleanNumber(value.z)];
}

function cleanQuat(value) {
  return [cleanNumber(value.x), cleanNumber(value.y), cleanNumber(value.z), cleanNumber(value.w)];
}

function rotateVector(quaternion, vectorValue) {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = vectorValue;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

function worldPoint(bodyState, localPoint) {
  const rotated = rotateVector(bodyState.rotation, localPoint);
  return rotated.map((value, index) => value + bodyState.position[index]);
}

function constraintState(constraint, byId) {
  const a = byId.get(constraint.bodyA);
  const b = byId.get(constraint.bodyB);
  const pointA = worldPoint(a, constraint.anchorA);
  const pointB = worldPoint(b, constraint.anchorB);
  const delta = pointB.map((value, index) => value - pointA[index]);
  const separation = Math.hypot(...delta);
  if (constraint.type === 'prismatic') {
    const axis = rotateVector(a.rotation, constraint.axis);
    const coordinate = delta.reduce((sum, value, index) => sum + value * axis[index], 0);
    const perpendicular = delta.map((value, index) => value - coordinate * axis[index]);
    return {
      id: constraint.id,
      coordinate: cleanNumber(coordinate),
      perpendicularError: cleanNumber(Math.hypot(...perpendicular)),
      withinLimits: constraint.limits ? coordinate >= constraint.limits[0] - 1e-6 && coordinate <= constraint.limits[1] + 1e-6 : null,
    };
  }
  return { id: constraint.id, anchorError: cleanNumber(separation) };
}

async function simulate(recipe, RAPIER) {
  const world = new RAPIER.World({ x: recipe.gravity[0], y: recipe.gravity[1], z: recipe.gravity[2] });
  world.timestep = recipe.step;
  const eventQueue = new RAPIER.EventQueue(true);
  const handles = new Map();
  const colliderOwners = new Map();

  for (const body of recipe.bodies) {
    let desc;
    if (body.type === 'fixed') desc = RAPIER.RigidBodyDesc.fixed();
    else if (body.type === 'dynamic') desc = RAPIER.RigidBodyDesc.dynamic();
    else desc = RAPIER.RigidBodyDesc.kinematicPositionBased();
    desc.setTranslation(body.position[0], body.position[1], body.position[2]);
    desc.setRotation({ x: body.rotation[0], y: body.rotation[1], z: body.rotation[2], w: body.rotation[3] });
    desc.setLinvel(body.linearVelocity[0], body.linearVelocity[1], body.linearVelocity[2]);
    desc.setAngvel({ x: body.angularVelocity[0], y: body.angularVelocity[1], z: body.angularVelocity[2] });
    desc.setLinearDamping(body.linearDamping);
    desc.setAngularDamping(body.angularDamping);
    desc.setCanSleep(body.canSleep);
    const rigidBody = world.createRigidBody(desc);
    let colliderDesc;
    if (body.shape.kind === 'box') colliderDesc = RAPIER.ColliderDesc.cuboid(...body.shape.halfExtents);
    else if (body.shape.kind === 'sphere') colliderDesc = RAPIER.ColliderDesc.ball(body.shape.radius);
    else colliderDesc = RAPIER.ColliderDesc.capsule(body.shape.halfHeight, body.shape.radius);
    colliderDesc.setDensity(body.density);
    colliderDesc.setFriction(body.friction);
    colliderDesc.setRestitution(body.restitution);
    colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = world.createCollider(colliderDesc, rigidBody);
    handles.set(body.id, rigidBody);
    colliderOwners.set(collider.handle, body.id);
  }

  for (const constraint of recipe.constraints) {
    const a = handles.get(constraint.bodyA);
    const b = handles.get(constraint.bodyB);
    const anchorA = { x: constraint.anchorA[0], y: constraint.anchorA[1], z: constraint.anchorA[2] };
    const anchorB = { x: constraint.anchorB[0], y: constraint.anchorB[1], z: constraint.anchorB[2] };
    let data;
    if (constraint.type === 'fixed') {
      data = RAPIER.JointData.fixed(anchorA, { x: 0, y: 0, z: 0, w: 1 }, anchorB, { x: 0, y: 0, z: 0, w: 1 });
    } else if (constraint.type === 'revolute') {
      data = RAPIER.JointData.revolute(anchorA, anchorB, { x: constraint.axis[0], y: constraint.axis[1], z: constraint.axis[2] });
    } else {
      data = RAPIER.JointData.prismatic(anchorA, anchorB, { x: constraint.axis[0], y: constraint.axis[1], z: constraint.axis[2] });
    }
    if (constraint.limits) {
      data.limitsEnabled = true;
      data.limits = constraint.limits.slice();
    }
    world.createImpulseJoint(data, a, b, true);
  }

  const samples = [];
  const contacts = [];
  const executedActions = [];
  let actionIndex = 0;
  let simTime = 0;
  let nextSample = 0;
  const epsilon = recipe.step * 1e-6;

  function runActionsThrough(time) {
    while (actionIndex < recipe.actions.length && recipe.actions[actionIndex].time <= time + epsilon) {
      const action = recipe.actions[actionIndex++];
      const body = handles.get(action.body);
      if (action.type === 'impulse') body.applyImpulse({ x: action.value[0], y: action.value[1], z: action.value[2] }, true);
      else if (action.type === 'torqueImpulse') body.applyTorqueImpulse({ x: action.value[0], y: action.value[1], z: action.value[2] }, true);
      else {
        body.setNextKinematicTranslation({ x: action.value[0], y: action.value[1], z: action.value[2] });
        body.setNextKinematicRotation({ x: action.rotation[0], y: action.rotation[1], z: action.rotation[2], w: action.rotation[3] });
      }
      executedActions.push({ id: action.id, time: cleanNumber(action.time) });
    }
  }

  function takeSample(time) {
    const bodyStates = recipe.bodies.map(body => {
      const handle = handles.get(body.id);
      return {
        id: body.id,
        position: cleanVec(handle.translation()),
        rotation: cleanQuat(handle.rotation()),
        linearVelocity: cleanVec(handle.linvel()),
        angularVelocity: cleanVec(handle.angvel()),
        sleeping: handle.isSleeping(),
      };
    });
    const byId = new Map(bodyStates.map(body => [body.id, body]));
    samples.push({
      time: cleanNumber(time),
      bodies: bodyStates,
      constraints: recipe.constraints.map(constraint => constraintState(constraint, byId)),
    });
  }

  runActionsThrough(0);
  takeSample(0);
  nextSample = 1;
  const totalSteps = Math.round(recipe.duration / recipe.step);
  for (let stepIndex = 0; stepIndex < totalSteps; stepIndex += 1) {
    const nextTime = Math.min(recipe.duration, (stepIndex + 1) * recipe.step);
    runActionsThrough(nextTime);
    world.step(eventQueue);
    simTime = nextTime;
    eventQueue.drainCollisionEvents((h1, h2, started) => {
      const pair = [colliderOwners.get(h1), colliderOwners.get(h2)].sort();
      contacts.push({ time: cleanNumber(simTime), a: pair[0], b: pair[1], phase: started ? 'begin' : 'end' });
    });
    while (nextSample <= Math.floor(recipe.duration * recipe.sampleRate + 1e-9)) {
      const sampleTime = nextSample / recipe.sampleRate;
      if (sampleTime > simTime + epsilon) break;
      takeSample(sampleTime);
      nextSample += 1;
    }
  }
  if (samples[samples.length - 1].time < recipe.duration - epsilon) takeSample(recipe.duration);

  return {
    schema: OUTPUT_SCHEMA,
    units: recipe.units,
    input: { schema: recipe.schema, digest: digest(recipe) },
    adapter: { ...ADAPTER, engine: { id: '@dimforge/rapier3d-deterministic-compat', version: RAPIER.version() } },
    timing: { step: recipe.step, duration: recipe.duration, sampleRate: recipe.sampleRate },
    bodies: recipe.bodies.map(body => ({ id: body.id, type: body.type, shape: body.shape })),
    constraints: recipe.constraints,
    actions: executedActions,
    contacts,
    samples,
    warnings: [],
  };
}

function ensureContained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) return;
  fail(`${label} must stay within project root`);
}

function containedPaths(projectRoot, inputPath, outputPath) {
  const authoredRoot = path.resolve(projectRoot);
  const root = fs.realpathSync(authoredRoot);
  if (!fs.statSync(root).isDirectory()) fail('project root must be a directory');
  const inputCandidate = path.resolve(authoredRoot, inputPath);
  const outputCandidate = path.resolve(authoredRoot, outputPath);
  ensureContained(authoredRoot, inputCandidate, 'input');
  ensureContained(authoredRoot, outputCandidate, 'output');
  const input = fs.realpathSync(inputCandidate);
  ensureContained(root, input, 'input');
  const inputStat = fs.statSync(input);
  if (!inputStat.isFile()) fail('input must be a regular file');
  if (inputStat.size > MAX_INPUT_BYTES) fail(`input must not exceed ${MAX_INPUT_BYTES} bytes`);
  const outputParent = fs.realpathSync(path.dirname(outputCandidate));
  ensureContained(root, outputParent, 'output parent');
  const output = path.join(outputParent, path.basename(outputCandidate));
  if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) fail('output must not be a symbolic link');
  return { input, output };
}

async function bake(inputPath, outputPath, projectRoot = path.dirname(path.resolve(inputPath))) {
  const { input, output } = containedPaths(projectRoot, inputPath, outputPath);
  if (input === output) fail('output must differ from input');
  const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
  const recipe = normalizeRecipe(raw);
  const RAPIER = require('@dimforge/rapier3d-deterministic-compat');
  await RAPIER.init();
  const result = await simulate(recipe, RAPIER);
  const bytes = `${canonical(result)}\n`;
  const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.renameSync(temporary, output);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return result;
}

async function main(argv) {
  if (argv.length !== 3) fail('usage: node tools/bake-rigid-body.js <project-root> <contained-recipe.json> <contained-output.json>');
  await bake(argv[1], argv[2], argv[0]);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`3D rigid-body bake failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { ADAPTER, OUTPUT_SCHEMA, SCHEMA, bake, canonical, containedPaths, normalizeRecipe, simulate };
