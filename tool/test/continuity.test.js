'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  continuityFromRecipe, loadContinuityShot, parsePlan,
} = require('../src/continuity');

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-continuity-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  return dir;
}

function plan(anchor = null) {
  return {
    entities: {
      amina: { kind: 'character', description: 'Amina wears a teal scarf.' },
      lantern: { kind: 'object', description: 'A small brass lantern with blue glass.' },
      courtyard: { kind: 'place', description: 'A white courtyard with three arches.' },
    },
    shots: {
      arrival: {
        entities: ['amina', 'lantern', 'courtyard'],
        keep: ['The scarf, lantern, and three arches remain recognizable.'],
        change: ['Move to a low camera angle as Amina lifts the lantern.'],
        ...(anchor ? { anchor } : {}),
      },
    },
  };
}

test('continuity plan keeps open entity kinds and exact selected order', () => {
  const parsed = parsePlan(plan());
  assert.deepEqual(parsed.shots.arrival.entities, ['amina', 'lantern', 'courtyard']);
  assert.equal(parsed.entities.lantern.kind, 'object');
  assert.throws(() => parsePlan({ ...plan(), surprise: true }), /unknown field/);
  const dangling = plan();
  dangling.shots.arrival.entities.push('missing');
  assert.throws(() => parsePlan(dangling), /unknown entity "missing"/);
  const duplicate = plan();
  duplicate.shots.arrival.entities.push('amina');
  assert.throws(() => parsePlan(duplicate), /duplicate entity/);
});

test('selected text continuity expands creator-authored context without an anchor', () => {
  const dir = tmp();
  try {
    const selected = loadContinuityShot(dir, plan(), 'arrival');
    assert.equal(selected.reference, null);
    assert.equal(selected.snapshot.shot, 'arrival');
    assert.deepEqual(selected.snapshot.entities.map(entity => entity.id), ['amina', 'lantern', 'courtyard']);
    assert.match(selected.text, /Amina wears a teal scarf/);
    assert.match(selected.text, /Intentionally change:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selected anchor is contained, regular, image-named, and digest-bound', () => {
  const dir = tmp();
  try {
    const anchor = path.join(dir, 'assets', 'arrival.png');
    fs.writeFileSync(anchor, Buffer.from('image-bytes'));
    const selected = loadContinuityShot(dir, plan('assets/arrival.png'), 'arrival');
    assert.equal(selected.reference.kind, 'image');
    assert.equal(selected.reference.path, anchor);
    assert.equal(selected.snapshot.anchor.bytes, 11);
    assert.match(selected.snapshot.anchor.sha256, /^[a-f0-9]{64}$/);

    assert.throws(() => loadContinuityShot(dir, plan('../outside.png'), 'arrival'), /escapes the project/);
    fs.writeFileSync(path.join(dir, 'assets', 'note.txt'), 'not image');
    assert.throws(() => loadContinuityShot(dir, plan('assets/note.txt'), 'arrival'), /must be an image/);
    if (process.platform !== 'win32') {
      fs.symlinkSync(anchor, path.join(dir, 'assets', 'linked.png'));
      assert.throws(() => loadContinuityShot(dir, plan('assets/linked.png'), 'arrival'), /regular file/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recipe continuity reuses authored snapshot but refreshes current anchor identity', () => {
  const dir = tmp();
  try {
    const anchor = path.join(dir, 'assets', 'arrival.png');
    fs.writeFileSync(anchor, 'first');
    const first = loadContinuityShot(dir, plan('assets/arrival.png'), 'arrival');
    fs.writeFileSync(anchor, 'second-version');
    const restored = continuityFromRecipe(dir, first.snapshot);
    assert.equal(restored.snapshot.shot, 'arrival');
    assert.equal(restored.snapshot.anchor.bytes, 14);
    assert.notEqual(restored.snapshot.anchor.sha256, first.snapshot.anchor.sha256);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
