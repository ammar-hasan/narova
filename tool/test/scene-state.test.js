'use strict';

/* Bounded scene-state evidence (CHANGE-2026-058). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveConfig } = require('../src/schema');
const { compile, hashConfig } = require('../src/manifest');
const { MAX_BYTES, SCHEMA } = require('../src/scene-state');
const { writeVideoCiBinding } = require('../src/video-ci-binding');

const BIN = path.join(__dirname, '..', 'bin', 'narova.js');
const MEDIA_AVAILABLE = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

function stateDocument(clearance = 0.25) {
  return {
    schema: SCHEMA,
    producer: { id: 'spatial-validator', version: '1.0.0' },
    observations: [
      {
        id: 'camera-clearance', time: { start: 0, end: 1 }, status: 'available',
        method: 'minimum signed distance over deterministic camera samples',
        value: clearance, unit: 'scene-unit', basis: 'MEASURED',
      },
      {
        id: 'subject-contained', time: { at: 0.5 }, status: 'available',
        method: 'subject bounds tested against world bounds',
        value: true, unit: 'boolean', basis: 'MEASURED',
      },
      {
        id: 'spatial-phase', time: { at: 0.7 }, status: 'available',
        method: 'phase inferred from the validated camera interval',
        value: 'shelter', unit: 'label', basis: 'INFERRED',
      },
      {
        id: 'surface-contact', time: { at: 0.8 }, status: 'unavailable',
        method: 'contact solver was not supplied',
        reason: 'producer cannot establish surface contact',
      },
    ],
  };
}

function rawConfig() {
  return {
    title: 'Scene state fixture', size: '16:9', voices: {},
    scenes: [{ id: 'only', body: '<div>state</div>', vo: [], dur: 1 }],
    sceneState: [{ scene: 'only', file: 'scene-state.json' }],
    assertions: [
      {
        id: 'clearance', class: 'mechanical', expect: 'Camera stays clear.',
        scope: { scene: 'only' },
        observe: [{ metric: 'scene.state', ref: 'camera-clearance', operator: 'lte', value: 0.3 }],
      },
      {
        id: 'contained', class: 'mechanical', expect: 'Subject remains contained.',
        scope: { scene: 'only' },
        observe: [{ metric: 'scene.state', ref: 'subject-contained', operator: 'eq', value: true }],
      },
      {
        id: 'phase', class: 'mechanical', expect: 'The state enters shelter phase.',
        scope: { scene: 'only' },
        observe: [{ metric: 'scene.state', ref: 'spatial-phase', operator: 'eq', value: 'shelter' }],
      },
      {
        id: 'contact', class: 'mechanical', expect: 'Surface contact is present.',
        scope: { scene: 'only' },
        observe: [{ metric: 'scene.state', ref: 'surface-contact', operator: 'eq', value: true }],
      },
      {
        id: 'too-wide', class: 'mechanical', expect: 'Clearance should exceed one unit.',
        scope: { scene: 'only' },
        observe: [{ metric: 'scene.state', ref: 'camera-clearance', operator: 'gt', value: 1 }],
      },
    ],
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function tree(root) {
  const rows = {};
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) rows[path.relative(root, file)] = digest(file);
    }
  };
  visit(root);
  return rows;
}

test('scene-state authoring validates bounded task-specific facts without changing execution identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-scene-state-schema-'));
  writeJson(path.join(root, 'scene-state.json'), stateDocument());
  const raw = rawConfig();
  const resolved = resolveConfig(raw, {}, root);
  assert.equal(resolved.sceneState.length, 1);
  assert.equal(resolved.sceneState[0].scene, 'only');
  assert.equal(resolved.sceneState[0].source.format, SCHEMA);
  assert.equal(resolved.sceneState[0].source.content.observations[2].basis, 'INFERRED');
  assert.match(resolved.sceneState[0].source.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(resolved.assertions[0].observe[0], {
    metric: 'scene.state', ref: 'camera-clearance', operator: 'lte', value: 0.3,
  });

  const withoutEvidence = { ...raw };
  delete withoutEvidence.sceneState;
  delete withoutEvidence.assertions;
  const plain = resolveConfig(withoutEvidence, {}, root);
  assert.equal(hashConfig(resolved), hashConfig(plain));
  assert.equal(compile(resolved).scenes[0].hash, compile(plain).scenes[0].hash);
});

test('scene-state authoring rejects malformed, unsafe, duplicate, dangling, and type-incompatible inputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-scene-state-invalid-'));
  writeJson(path.join(root, 'scene-state.json'), stateDocument());

  const duplicate = rawConfig();
  duplicate.sceneState.push({ scene: 'only', file: 'scene-state.json' });
  assert.throws(() => resolveConfig(duplicate, {}, root), /scene: duplicate "only"/);

  const dangling = rawConfig();
  dangling.assertions[0].observe[0].ref = 'ghost-fact';
  assert.throws(() => resolveConfig(dangling, {}, root), /"ghost-fact" not found/);

  const noScope = rawConfig();
  noScope.assertions[0].scope = { start: 0, end: 1 };
  assert.throws(() => resolveConfig(noScope, {}, root), /scene\.state requires assertion scope\.scene/);

  const mismatch = rawConfig();
  mismatch.assertions[1].observe[0].value = 'yes';
  assert.throws(() => resolveConfig(mismatch, {}, root), /type does not match available state observation/);

  const malformed = stateDocument();
  malformed.observations.push({ ...malformed.observations[0] });
  writeJson(path.join(root, 'bad.json'), malformed);
  const badFile = rawConfig();
  badFile.sceneState[0].file = 'bad.json';
  assert.throws(() => resolveConfig(badFile, {}, root), /duplicate "camera-clearance"/);

  const missing = rawConfig();
  missing.sceneState[0].file = 'missing.json';
  assert.throws(() => resolveConfig(missing, {}, root), /file not found/);

  const outside = path.join(root, '..', `narova-state-outside-${process.pid}.json`);
  writeJson(outside, stateDocument());
  const escaping = rawConfig();
  escaping.sceneState[0].file = `../${path.basename(outside)}`;
  assert.throws(() => resolveConfig(escaping, {}, root), /path must stay inside the project/);
  fs.rmSync(outside, { force: true });

  fs.writeFileSync(path.join(root, 'oversized.json'), Buffer.alloc(MAX_BYTES + 1, 0x20));
  const oversized = rawConfig();
  oversized.sceneState[0].file = 'oversized.json';
  assert.throws(() => resolveConfig(oversized, {}, root), /exceeds .* scene-state bound/);
});

test('judge uses only artifact-bound state, preserves basis, and degrades missing binding to uncertainty', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-scene-state-judge-'));
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  const stateFile = path.join(root, 'scene-state.json');
  const configFile = path.join(root, 'reel.config.json');
  writeJson(stateFile, stateDocument());
  const raw = rawConfig();
  writeJson(configFile, raw);
  const resolved = resolveConfig(raw, {}, root);
  writeJson(path.join(out, 'manifest.json'), {
    narova: '0.39.0', version: '1.0', project: { title: raw.title },
    scenes: [{ id: 'only', start: 0, duration: 1 }],
  });
  writeJson(path.join(out, 'timings.json'), { total: 1, only: { dur: 1, turns: [], words: [] } });
  const video = path.join(out, 'video.mp4');
  const rendered = spawnSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:d=1:r=10',
    '-an', '-c:v', 'mpeg4', '-q:v', '4', '-pix_fmt', 'yuv420p', '-y', video,
  ], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr);
  const receiptFile = writeVideoCiBinding(video, { outDir: out, projectDir: root, config: resolved });
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  assert.deepEqual(receipt.context.sceneState.map(item => item.scene), ['only']);
  assert.equal(receipt.context.sceneState[0].source.content.observations[0].value, 0.25);

  const runJudge = () => spawnSync(process.execPath, [BIN, 'judge', '--project', root, '--json'], {
    encoding: 'utf8', env: { ...process.env, NAROVA_FIRST_RUN: '0' },
  });
  const first = runJudge();
  assert.equal(first.status, 0, first.stderr);
  const firstReport = JSON.parse(first.stdout).data.judgement;
  assert.equal(firstReport.score, null);
  assert.equal(firstReport.validityEffect, 'none');
  const assertionRows = firstReport.observations.filter(item => item.assertion)
    .map(item => item.assertion.id);
  assert.deepEqual(assertionRows, ['clearance', 'contained', 'phase', 'contact', 'too-wide']);
  const byId = id => firstReport.observations.find(item => item.assertion && item.assertion.id === id);
  assert.equal(byId('clearance').outcome, 'ALIGNED');
  assert.equal(byId('contained').evidence[0].value, true);
  assert.equal(byId('phase').classification, 'INFERRED');
  assert.equal(byId('phase').evidence[0].basis, 'INFERRED');
  assert.equal(byId('contact').outcome, 'UNCERTAIN');
  assert.equal(byId('contact').evidence[0].availability, 'unavailable');
  assert.deepEqual(byId('contact').evidence[0].sourceIdentity.globalTime, { at: 0.8 });
  assert.equal(byId('too-wide').outcome, 'DIVERGED');
  assert.equal(byId('clearance').evidence[0].sourceIdentity.sourceSha256,
    receipt.context.sceneState[0].source.sha256);
  assert.equal(byId('clearance').evidence[0].sourceIdentity.producer.id, 'spatial-validator');
  assert.match(byId('clearance').evidence[0].sourceIdentity.method, /minimum signed distance/);

  // Current authoring state can change, but the already-built artifact keeps
  // the exact receipt-bound fact. Judge remains read-only.
  writeJson(stateFile, stateDocument(9));
  const before = tree(root);
  const changed = runJudge();
  assert.equal(changed.status, 0, changed.stderr);
  const changedReport = JSON.parse(changed.stdout).data.judgement;
  const boundClearance = changedReport.observations.find(item => item.assertion?.id === 'clearance');
  assert.equal(boundClearance.evidence[0].value, 0.25);
  assert.equal(boundClearance.outcome, 'ALIGNED');
  assert.deepEqual(tree(root), before);

  // Without the matching receipt, current state is never substituted for the
  // missing artifact-bound snapshot.
  fs.renameSync(receiptFile, `${receiptFile}.saved`);
  const unbound = runJudge();
  assert.equal(unbound.status, 0, unbound.stderr);
  const unboundReport = JSON.parse(unbound.stdout).data.judgement;
  for (const row of unboundReport.observations.filter(item => item.assertion)) {
    assert.equal(row.outcome, 'UNCERTAIN');
    assert.equal(row.evidence[0].availability, 'unavailable');
  }

  const invalidReceipt = JSON.parse(fs.readFileSync(`${receiptFile}.saved`, 'utf8'));
  invalidReceipt.context.sceneState[0].source.content.unexpected = true;
  writeJson(receiptFile, invalidReceipt);
  const invalid = runJudge();
  assert.equal(invalid.status, 0, invalid.stderr);
  const invalidReport = JSON.parse(invalid.stdout).data.judgement;
  assert.equal(invalidReport.sources.evidenceBinding.grade, 'INVALID');
  assert.match(invalidReport.sources.evidenceBinding.reason, /unsupported field/);
  for (const row of invalidReport.observations.filter(item => item.assertion)) {
    assert.equal(row.outcome, 'UNCERTAIN');
  }
});
