'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { bake, normalizeRecipe } = require('../tools/bake-rigid-body');
const { sampleAt } = require('../tools/sample-bake');

function baseRecipe(overrides = {}) {
  return {
    schema: 'narova.3d-rigid-body/1',
    units: 'm-kg-s',
    step: 1 / 120,
    duration: 2,
    sampleRate: 30,
    gravity: [0, -9.81, 0],
    bodies: [],
    constraints: [],
    actions: [],
    ...overrides,
  };
}

async function bakeRecipe(recipe, name = 'bake') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-rigid-body-'));
  const input = path.join(directory, 'recipe.json');
  const output = path.join(directory, `${name}.json`);
  fs.writeFileSync(input, `${JSON.stringify(recipe)}\n`);
  const result = await bake(input, output);
  return { directory, input, output, result, bytes: fs.readFileSync(output) };
}

test('falling body bakes byte-identically and reaches supported rest after contact', async t => {
  const recipe = baseRecipe({
    bodies: [
      { id: 'floor', type: 'fixed', shape: { kind: 'box', halfExtents: [4, 0.5, 4] }, position: [0, -0.5, 0] },
      { id: 'ball', type: 'dynamic', shape: { kind: 'sphere', radius: 0.5 }, position: [0, 3, 0], restitution: 0, linearDamping: 0.2 },
    ],
  });
  const first = await bakeRecipe(recipe, 'first');
  const secondOutput = path.join(first.directory, 'second.json');
  await bake(first.input, secondOutput);
  t.after(() => fs.rmSync(first.directory, { recursive: true, force: true }));
  assert.deepEqual(fs.readFileSync(secondOutput), first.bytes);
  const contact = first.result.contacts.find(event => event.phase === 'begin' && event.a === 'ball' && event.b === 'floor');
  assert.ok(contact, 'support contact should be recorded');
  const finalBall = first.result.samples.at(-1).bodies.find(body => body.id === 'ball');
  assert.ok(finalBall.position[1] >= 0.499 && finalBall.position[1] <= 0.505, `unexpected rest height ${finalBall.position[1]}`);
  assert.ok(Math.abs(finalBall.linearVelocity[1]) < 0.02, 'ball should be effectively at rest');
});

test('collision contact is recorded before the visible response', async t => {
  const recipe = baseRecipe({
    gravity: [0, 0, 0],
    duration: 1.5,
    bodies: [
      { id: 'moving', type: 'dynamic', shape: { kind: 'sphere', radius: 0.5 }, position: [-2, 0, 0], linearVelocity: [3, 0, 0], restitution: 1, canSleep: false },
      { id: 'waiting', type: 'dynamic', shape: { kind: 'sphere', radius: 0.5 }, position: [0, 0, 0], restitution: 1, canSleep: false },
    ],
  });
  const baked = await bakeRecipe(recipe);
  t.after(() => fs.rmSync(baked.directory, { recursive: true, force: true }));
  const contact = baked.result.contacts.find(event => event.phase === 'begin');
  assert.ok(contact, 'collision begin should be recorded');
  const response = baked.result.samples.find(sample => {
    const waiting = sample.bodies.find(body => body.id === 'waiting');
    return sample.time >= contact.time && waiting.linearVelocity[0] > 0.1;
  });
  assert.ok(response, 'waiting body should respond after contact');
  assert.ok(response.time >= contact.time);
});

test('jointed motion keeps its anchor relationship within tolerance', async t => {
  const recipe = baseRecipe({
    duration: 1,
    bodies: [
      { id: 'base', type: 'fixed', shape: { kind: 'box', halfExtents: [0.2, 0.2, 0.2] }, position: [0, 0, 0] },
      { id: 'arm', type: 'dynamic', shape: { kind: 'box', halfExtents: [0.15, 0.6, 0.15] }, position: [0, -0.8, 0], canSleep: false },
    ],
    constraints: [
      { id: 'hinge', type: 'revolute', bodyA: 'base', bodyB: 'arm', anchorA: [0, -0.2, 0], anchorB: [0, 0.6, 0], axis: [0, 0, 1], limits: [-1.2, 1.2] },
    ],
    actions: [
      { id: 'push', time: 0, type: 'impulse', body: 'arm', value: [1.5, 0, 0] },
    ],
  });
  const baked = await bakeRecipe(recipe);
  t.after(() => fs.rmSync(baked.directory, { recursive: true, force: true }));
  const maximumError = Math.max(...baked.result.samples.map(sample => sample.constraints[0].anchorError));
  assert.ok(maximumError < 0.015, `hinge anchor error ${maximumError} exceeded tolerance`);
});

test('canonical-time sampling is independent of request order', async t => {
  const recipe = baseRecipe({
    gravity: [0, 0, 0],
    duration: 1,
    bodies: [{ id: 'subject', type: 'dynamic', shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, linearVelocity: [1, 0, 0], canSleep: false }],
  });
  const baked = await bakeRecipe(recipe);
  t.after(() => fs.rmSync(baked.directory, { recursive: true, force: true }));
  const orderedTimes = [0, 0.125, 0.4, 0.9, 1];
  const ordered = new Map(orderedTimes.map(time => [time, sampleAt(baked.result, time)]));
  for (const time of [0.9, 0.125, 1, 0, 0.4]) assert.deepEqual(sampleAt(baked.result, time), ordered.get(time));
});

test('invalid recipes fail with attribution before replacing prior output', async t => {
  assert.throws(() => normalizeRecipe(baseRecipe({ bodies: [
    { id: 'same', type: 'dynamic', shape: { kind: 'sphere', radius: 1 } },
    { id: 'same', type: 'fixed', shape: { kind: 'sphere', radius: 1 } },
  ] })), /duplicates 'same'/);
  assert.throws(() => normalizeRecipe(baseRecipe({ bodies: [
    { id: 'cloth', type: 'dynamic', shape: { kind: 'cloth' } },
  ] })), /unsupported/);
  assert.throws(() => normalizeRecipe(baseRecipe({ step: Number.NaN, bodies: [
    { id: 'body', type: 'dynamic', shape: { kind: 'sphere', radius: 1 } },
  ] })), /recipe\.step/);
  assert.throws(() => normalizeRecipe(baseRecipe({ step: 0.03, bodies: [
    { id: 'body', type: 'dynamic', shape: { kind: 'sphere', radius: 1 } },
  ] })), /align to the fixed simulation step/);
  assert.throws(() => normalizeRecipe(baseRecipe({ bodies: [
    { id: 'body', type: 'dynamic', shape: { kind: 'sphere', radius: 1 }, canSleep: 'no' },
  ] })), /canSleep must be a boolean/);

  const valid = await bakeRecipe(baseRecipe({ bodies: [
    { id: 'body', type: 'dynamic', shape: { kind: 'sphere', radius: 1 } },
  ] }));
  t.after(() => fs.rmSync(valid.directory, { recursive: true, force: true }));
  const previous = fs.readFileSync(valid.output);
  fs.writeFileSync(valid.input, '{"schema":');
  await assert.rejects(bake(valid.input, valid.output));
  assert.deepEqual(fs.readFileSync(valid.output), previous);
  await assert.rejects(bake(valid.input, path.join(valid.directory, '..', 'escape.json'), valid.directory), /output must stay within project root/);
  fs.writeFileSync(valid.input, ' '.repeat(1024 * 1024 + 1));
  await assert.rejects(bake(valid.input, valid.output), /must not exceed 1048576 bytes/);
  assert.deepEqual(fs.readFileSync(valid.output), previous);
});
