'use strict';

/* Phase 3 Video CI: preserve actual proof bytes, then compare without choosing. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveConfig } = require('../src/schema');
const { buildHashes } = require('../src/manifest');
const { writeProofReceipt } = require('../src/proof-receipt');
const { writeVideoCiBinding } = require('../src/video-ci-binding');

const BIN = path.join(__dirname, '..', 'bin', 'narova.js');
const MEDIA_AVAILABLE = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function tree(root) {
  const result = {};
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result[path.relative(root, file)] = digest(file);
      else result[path.relative(root, file)] = entry.isSymbolicLink() ? `link:${fs.readlinkSync(file)}` : 'special';
    }
  };
  visit(root);
  return result;
}

function renderColor(file, color) {
  const result = spawnSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:d=1:r=10`,
    '-an', '-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p', '-y', file,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function prepareProofFixture(project, raw) {
  const out = path.join(project, 'out');
  const review = path.join(out, 'hf-proof', 'snapshots', 'review');
  fs.mkdirSync(review, { recursive: true });
  const resolved = resolveConfig(raw, {}, project);
  const manifest = {
    narova: '0.32.1', version: '1.0', project: { title: raw.title },
    scenes: raw.scenes.map(scene => ({ id: scene.id, dur: scene.dur })),
    hashes: buildHashes(resolved, project),
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
    total: raw.scenes.reduce((total, scene) => total + scene.dur, 0),
    ...Object.fromEntries(raw.scenes.map(scene => [scene.id, { dur: scene.dur, turns: [], words: [] }])),
  }));
  const { assetsDir: _assetsDir, ...serializable } = resolved;
  fs.writeFileSync(path.join(out, 'config.resolved.json'), JSON.stringify(serializable, null, 2));
  const contact = path.join(review, 'contact-sheet.jpg');
  const frame = path.join(review, '0001.jpg');
  fs.writeFileSync(contact, 'contact');
  fs.writeFileSync(frame, 'frame');
  writeProofReceipt(resolved, out, [contact], [frame]);
  return { out, resolved };
}

function projectFixture(parent, name = 'project') {
  const project = path.join(parent, name);
  const raw = {
    title: 'Focused proof experiment', size: '16:9', voices: {},
    scenes: [{ id: 'opening', dur: 1, vo: [], body: '<p>opening</p>' }],
    assertions: [
      {
        id: 'static-opening', class: 'creative-hypothesis',
        expect: 'The opening should remain nearly static.',
        scope: { start: 0, end: 0.9 },
        observe: [{ metric: 'video.static_ratio', operator: 'gte', value: 0.9 }],
        related: { scene: 'opening', source: 'scenes/opening.html', protected: ['timing'] },
      },
      {
        id: 'dark-opening', class: 'experimental',
        expect: 'The opening should remain dark.',
        scope: { start: 0, end: 0.9 },
        observe: [{ metric: 'video.black_ratio', operator: 'gte', value: 0.9 }],
      },
    ],
  };
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'reel.config.json'), `${JSON.stringify(raw, null, 2)}\n`);
  const { out } = prepareProofFixture(project, raw);
  return { project, out, raw };
}

test('focused proof branches preserve real encoded attempts and compare without ranking or mutation', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-branch-video-ci-'));
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases);
  const { project, out } = projectFixture(root);
  const video = path.join(out, 'video.mp4');
  const env = { ...process.env, NAROVA_FIRST_RUN: '0', NAROVA_RELEASES_DIR: releases };
  const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env, ...opts });

  renderColor(video, 'red');
  writeVideoCiBinding(video, { outDir: out, projectDir: project });
  const savedA = run([
    'branch', 'save', 'attempt-a', '--project', project,
    '--rationale', 'A red field may make the stillness feel exposed.',
    '--judge-assertion', 'static-opening', '--json',
  ]);
  assert.equal(savedA.status, 0, savedA.stderr);
  const envelopeA = JSON.parse(savedA.stdout);
  assert.equal(envelopeA.operation, 'branch save');
  assert.equal(envelopeA.data.videoCi.schema, 'narova.branch-video-ci/1');
  assert.equal(envelopeA.data.videoCi.focusAssertion, 'static-opening');
  assert.match(envelopeA.data.videoCiIdentity, /^[a-f0-9]{64}$/);
  const branchAPath = path.join(releases, '.branches', 'attempt-a', 'branch.json');
  const branchA = JSON.parse(fs.readFileSync(branchAPath, 'utf8'));
  const preservedA = path.join(releases, '.branches', 'attempt-a', branchA.videoCi.artifact.path);
  assert.equal(digest(preservedA), digest(video));
  assert.doesNotMatch(JSON.stringify(branchA.videoCi), new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  renderColor(video, 'blue');
  writeVideoCiBinding(video, { outDir: out, projectDir: project });
  const savedB = run([
    'branch', 'save', 'attempt-b', '--project', project,
    '--rationale', 'A blue field may make the same hold feel remote.',
    '--judge-assertion', 'static-opening',
  ]);
  assert.equal(savedB.status, 0, savedB.stderr);
  const branchB = JSON.parse(fs.readFileSync(path.join(releases, '.branches', 'attempt-b', 'branch.json'), 'utf8'));
  const preservedB = path.join(releases, '.branches', 'attempt-b', branchB.videoCi.artifact.path);
  assert.notEqual(digest(preservedA), digest(preservedB));

  const rejected = run(['branch', 'set', 'attempt-a', '--status', 'rejected', '--project', project]);
  assert.equal(rejected.status, 0, rejected.stderr);
  const before = { project: tree(project), releases: tree(releases) };
  const compared = run(['branch', 'compare', 'attempt-a', 'attempt-b', '--project', project, '--json']);
  assert.equal(compared.status, 0, compared.stderr);
  const comparisonEnvelope = JSON.parse(compared.stdout);
  assert.equal(comparisonEnvelope.operation, 'branch compare');
  assert.deepEqual(comparisonEnvelope.artifacts, []);
  const comparison = comparisonEnvelope.data.comparison;
  assert.equal(comparison.schema, 'narova.branch-comparison/1');
  assert.equal(comparison.creatorAuthority, 'creator');
  assert.equal(comparison.score, null);
  assert.equal(comparison.ranking, null);
  assert.equal(comparison.selection, null);
  assert.equal(comparison.mutation, 'none');
  assert.deepEqual(comparison.branches.map(branch => branch.name), ['attempt-a', 'attempt-b']);
  assert.deepEqual(comparison.branches.map(branch => branch.status), ['rejected', 'candidate']);
  assert.notEqual(comparison.branches[0].artifact.sha256, comparison.branches[1].artifact.sha256);
  assert.deepEqual({ project: tree(project), releases: tree(releases) }, before);

  let deep = project;
  for (let index = 0; index < 20; index++) deep = path.join(deep, `level-${index}`);
  fs.mkdirSync(deep, { recursive: true });
  const deeplyNested = run(['branch', 'compare', 'attempt-a', 'attempt-b', '--json'], { cwd: deep });
  assert.equal(deeplyNested.status, 0, deeplyNested.stderr);
  assert.deepEqual(JSON.parse(deeplyNested.stdout).data.comparison.branches.map(branch => branch.name), ['attempt-a', 'attempt-b']);

  const human = run(['branch', 'compare', 'attempt-b', 'attempt-a', '--project', project]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /No score, ranking, recommendation, selection, or mutation/);
  assert.match(human.stdout, /PROOF A — attempt-b/);
  assert.match(human.stdout, /PROOF B — attempt-a/);
  assert.match(human.stdout, /Narova has not chosen among these proofs/);

  const duplicate = run(['branch', 'compare', 'attempt-a', 'attempt-a', '--project', project]);
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /unique branch names/);
  const alias = run(['branch', 'compare', 'attempt-a', 'attempt/-a', '--project', project]);
  assert.equal(alias.status, 2);
  assert.match(alias.stderr, /unique branch names/);

  const savedC = run([
    'branch', 'save', 'attempt-c', '--project', project,
    '--rationale', 'Test whether darkness, rather than hue, carries the tension.',
    '--judge-assertion', 'dark-opening',
  ]);
  assert.equal(savedC.status, 0, savedC.stderr);
  const mismatched = run(['branch', 'compare', 'attempt-a', 'attempt-c', '--project', project]);
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.stderr, /different assertion/);

  const other = projectFixture(root, 'other-project');
  const crossProject = run(['branch', 'compare', 'attempt-a', 'attempt-b', '--project', other.project]);
  assert.equal(crossProject.status, 1);
  assert.match(crossProject.stderr, /other-project proof evidence/);

  const jsonConfig = path.join(project, 'reel.config.json');
  const parkedConfig = path.join(project, 'reel.config.parked');
  const executableConfig = path.join(project, 'reel.config.cjs');
  const sideEffect = path.join(project, 'compare-loaded-config');
  fs.renameSync(jsonConfig, parkedConfig);
  fs.writeFileSync(executableConfig, [
    "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'compare-loaded-config'), 'loaded');",
    'module.exports = { title: "must not execute", voices: {}, scenes: [{ id: "x", dur: 1, vo: [], body: "<p>x</p>" }] };',
  ].join('\n'));
  const noConfigExecution = run(['branch', 'compare', 'attempt-a', 'attempt-b', '--project', project]);
  assert.equal(noConfigExecution.status, 0, noConfigExecution.stderr);
  assert.ok(!fs.existsSync(sideEffect), 'comparison must locate the project without executing authored config');
  fs.unlinkSync(executableConfig);
  fs.renameSync(parkedConfig, jsonConfig);

  const branchBPath = path.join(releases, '.branches', 'attempt-b', 'branch.json');
  const intactBranchB = fs.readFileSync(branchBPath, 'utf8');
  const invalidStatus = JSON.parse(intactBranchB);
  invalidStatus.status = 'winner';
  fs.writeFileSync(branchBPath, JSON.stringify(invalidStatus, null, 2));
  const malformedLifecycle = run(['branch', 'compare', 'attempt-a', 'attempt-b', '--project', project]);
  assert.equal(malformedLifecycle.status, 1);
  assert.match(malformedLifecycle.stderr, /invalid branch status/);
  fs.writeFileSync(branchBPath, intactBranchB);

  const experimentDir = path.join(releases, '.branches', 'attempt-b', 'video-ci');
  const externalExperimentDir = path.join(root, 'external-video-ci');
  fs.renameSync(experimentDir, externalExperimentDir);
  fs.symlinkSync(externalExperimentDir, experimentDir, 'dir');
  const escapedEvidence = run(['branch', 'compare', 'attempt-a', 'attempt-b', '--project', project]);
  assert.equal(escapedEvidence.status, 1);
  assert.match(escapedEvidence.stderr, /no intact focused Video CI experiment/);
  fs.unlinkSync(experimentDir);
  fs.renameSync(externalExperimentDir, experimentDir);

  const intactMetadata = fs.readFileSync(branchAPath, 'utf8');
  const editedObservation = JSON.parse(intactMetadata);
  editedObservation.videoCi.observation.observed = 'silently rewritten observation';
  fs.writeFileSync(branchAPath, JSON.stringify(editedObservation, null, 2));
  const tamperedObservation = run(['branch', 'compare', 'attempt-a', 'attempt-b', '--project', project]);
  assert.equal(tamperedObservation.status, 1);
  assert.match(tamperedObservation.stderr, /no intact focused Video CI experiment/);
  fs.writeFileSync(branchAPath, intactMetadata);

  fs.appendFileSync(preservedA, 'tampered');
  const tampered = run(['branch', 'compare', 'attempt-a', 'attempt-b', '--project', project]);
  assert.equal(tampered.status, 1);
  assert.match(tampered.stderr, /no intact focused Video CI experiment/);
});

test('focused save rejects missing binding, unknown focus, and video without focus before replacing a branch', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-branch-video-ci-fail-'));
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases);
  const { project, out } = projectFixture(root);
  const video = path.join(out, 'video.mp4');
  renderColor(video, 'white');
  const env = { ...process.env, NAROVA_FIRST_RUN: '0', NAROVA_RELEASES_DIR: releases };
  const run = args => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });

  const noBinding = run([
    'branch', 'save', 'focused', '--project', project, '--rationale', 'Try stillness.',
    '--judge-assertion', 'static-opening',
  ]);
  assert.equal(noBinding.status, 1);
  assert.match(noBinding.stderr, /matching canonical video evidence receipt/);
  assert.ok(!fs.existsSync(path.join(releases, 'focused')));
  assert.ok(!fs.existsSync(path.join(releases, '.branches', 'focused')));

  writeVideoCiBinding(video, { outDir: out, projectDir: project });
  const unknown = run([
    'branch', 'save', 'focused', '--project', project, '--rationale', 'Try stillness.',
    '--judge-assertion', 'missing-assertion',
  ]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /was not found/);
  assert.ok(!fs.existsSync(path.join(releases, 'focused')));

  const videoWithoutFocus = run([
    'branch', 'save', 'focused', '--project', project, '--rationale', 'Try stillness.',
    '--video', video,
  ]);
  assert.equal(videoWithoutFocus.status, 2);
  assert.match(videoWithoutFocus.stderr, /focused narova branch save/);

  const absentStore = path.join(root, 'absent-store');
  const noStore = spawnSync(process.execPath, [
    BIN, 'branch', 'compare', 'a', 'b', '--project', project,
  ], {
    encoding: 'utf8',
    env: { ...process.env, NAROVA_FIRST_RUN: '0', NAROVA_RELEASES_DIR: absentStore },
  });
  assert.equal(noStore.status, 1);
  assert.match(noStore.stderr, /no proof branch store exists/);
  assert.ok(!fs.existsSync(absentStore), 'read-only comparison must not create an empty global store');
});

test('focused save pins the explicitly loaded config instead of rediscovering another candidate', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-branch-video-ci-config-'));
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases);
  const { project, out } = projectFixture(root);
  const explicitConfig = path.join(project, 'focused.config.json');
  fs.copyFileSync(path.join(project, 'reel.config.json'), explicitConfig);
  const rediscovered = path.join(project, 'reel.config.mjs');
  const marker = path.join(project, 'wrong-config-loaded');
  fs.writeFileSync(rediscovered, [
    "import fs from 'node:fs'; import path from 'node:path';",
    "fs.writeFileSync(path.join(import.meta.dirname, 'wrong-config-loaded'), 'loaded');",
    'export default { title: "wrong", voices: {}, scenes: [{ id: "wrong", dur: 1, vo: [], body: "<p>wrong</p>" }] };',
  ].join('\n'));
  const video = path.join(out, 'video.mp4');
  renderColor(video, 'yellow');
  writeVideoCiBinding(video, { outDir: out, projectDir: project });
  const result = spawnSync(process.execPath, [
    BIN, 'branch', 'save', 'explicit-proof', '--project', project,
    '--config', explicitConfig, '--rationale', 'Preserve the explicitly authored hypothesis.',
    '--judge-assertion', 'static-opening',
  ], {
    encoding: 'utf8',
    env: { ...process.env, NAROVA_FIRST_RUN: '0', NAROVA_RELEASES_DIR: releases },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!fs.existsSync(marker), 'release staging must not rediscover or execute another config');
  const savedConfig = path.join(releases, 'explicit-proof', path.basename(explicitConfig));
  assert.equal(fs.readFileSync(savedConfig, 'utf8'), fs.readFileSync(explicitConfig, 'utf8'));
  assert.ok(!fs.existsSync(path.join(releases, 'explicit-proof', 'reel.config.mjs')));
});

test('focused save anchors explicit config references and rejects metadata name collisions', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-branch-video-ci-nested-config-'));
  const releases = path.join(root, 'releases');
  const project = path.join(root, 'project');
  const proofProject = path.join(project, 'proofs');
  const out = path.join(proofProject, 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(releases);
  fs.writeFileSync(path.join(project, 'reel.config.json'), JSON.stringify({
    title: 'wrong ancestor', voices: {}, scenes: [{ id: 'wrong', dur: 1, vo: [], body: '<p>wrong</p>' }],
  }));
  const raw = {
    title: 'nested proof',
    size: '16:9',
    voices: {},
    scenes: [{ id: 'opening', dur: 1, vo: [], bodyFile: 'scene.html' }],
    assertions: [{
      id: 'static-opening', class: 'creative-hypothesis', expect: 'Remain still.',
      scope: { start: 0, end: 0.9 },
      observe: [{ metric: 'video.static_ratio', operator: 'gte', value: 0.9 }],
    }],
  };
  const explicitConfig = path.join(proofProject, 'focused.config.json');
  fs.writeFileSync(explicitConfig, JSON.stringify(raw, null, 2));
  fs.writeFileSync(path.join(proofProject, 'scene.html'), '<p>nested proof scene</p>');
  prepareProofFixture(proofProject, raw);
  const video = path.join(out, 'video.mp4');
  renderColor(video, 'purple');
  writeVideoCiBinding(video, { outDir: out, projectDir: proofProject });

  const saved = spawnSync(process.execPath, [
    BIN, 'branch', 'save', 'nested-proof', '--project', project,
    '--config', explicitConfig, '--rationale', 'Preserve the nested proof source.',
    '--judge-assertion', 'static-opening',
  ], {
    encoding: 'utf8',
    env: { ...process.env, NAROVA_FIRST_RUN: '0', NAROVA_RELEASES_DIR: releases },
  });
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(fs.readFileSync(path.join(releases, 'nested-proof', 'scene.html'), 'utf8'), '<p>nested proof scene</p>');

  const collidingConfig = path.join(proofProject, 'manifest.json');
  fs.writeFileSync(collidingConfig, JSON.stringify(raw));
  const rejected = spawnSync(process.execPath, [
    BIN, 'branch', 'save', 'collision', '--project', proofProject,
    '--config', collidingConfig, '--rationale', 'This name is intentionally ambiguous.',
    '--judge-assertion', 'static-opening',
  ], {
    encoding: 'utf8',
    env: { ...process.env, NAROVA_FIRST_RUN: '0', NAROVA_RELEASES_DIR: releases },
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /conflicts with Narova snapshot metadata/);
  assert.ok(!fs.existsSync(path.join(releases, 'collision')));
});
