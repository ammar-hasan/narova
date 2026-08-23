'use strict';

/* Phase 4 Video CI: one explicit, branch-isolated caption-sidecar repair. */
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
const { repairCandidateIdentity, verifyCaptionRepair } = require('../src/caption-repair');
const { branchExperimentIdentity } = require('../src/branch-experiment');

const BIN = path.join(__dirname, '..', 'bin', 'narova.js');
const MEDIA_AVAILABLE = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function tree(root) {
  const result = {};
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) result[path.relative(root, file)] = digest(file);
      else result[path.relative(root, file)] = `special:${entry.name}`;
    }
  };
  visit(root);
  return result;
}

function renderVideo(file) {
  const result = spawnSync('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:d=1:r=10',
    '-an', '-c:v', 'mpeg4', '-q:v', '3', '-pix_fmt', 'yuv420p', '-y', file,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function fixture(parent, name, {
  assertionClass = 'accessibility', expected = 2, captions = {}, captionState = 'missing',
  legacyMarker = false, withSceneState = false,
} = {}) {
  const project = path.join(parent, name);
  const out = path.join(project, 'out');
  const review = path.join(out, 'hf-proof', 'snapshots', 'review');
  fs.mkdirSync(review, { recursive: true });
  const raw = {
    title: 'Caption repair fixture', size: '16:9',
    voices: { narrator: { backend: 'piper', voice: 'fixture' } },
    captions,
    scenes: [{
      id: 'opening', dur: 1, body: '<p>Two words</p>',
      vo: [{ who: 'narrator', text: 'Two words.' }],
    }],
    assertions: [{
      id: 'captions-present', class: assertionClass,
      expect: 'The rendered work should expose at least two caption words.',
      scope: { start: 0, end: 1 },
      observe: [{ metric: 'caption.word_count', operator: 'gte', value: expected }],
      related: { scene: 'opening', protected: ['video', 'timing', 'narration'] },
    }],
  };
  if (withSceneState) {
    const state = {
      schema: 'narova.scene-state/1',
      producer: { id: 'caption-fixture-validator', version: '1' },
      observations: [{
        id: 'camera-clearance', time: { start: 0, end: 1 }, status: 'available',
        method: 'fixed fixture measurement', value: 0.5, unit: 'scene-unit', basis: 'MEASURED',
      }],
    };
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(path.join(project, 'scene-state.json'), `${JSON.stringify(state, null, 2)}\n`);
    raw.sceneState = [{ scene: 'opening', file: 'scene-state.json' }];
  }
  if (legacyMarker) raw.safeLayout = false;
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'reel.config.json'), `${JSON.stringify(raw, null, 2)}\n`);
  const resolved = resolveConfig(raw, {}, project);
  const manifest = {
    narova: '0.32.1', version: '1.0', project: { title: raw.title },
    scenes: [{ id: 'opening', start: 0, duration: 1 }],
    hashes: buildHashes(resolved, project),
  };
  const timings = {
    total: 1,
    opening: {
      dur: 1,
      turns: [{ who: 'narrator', start: 0, end: 0.8 }],
      words: [
        { who: 'narrator', si: 0, w: 'Two', t0: 0.05, t1: 0.3 },
        { who: 'narrator', si: 0, w: 'words.', t0: 0.35, t1: 0.7 },
      ],
    },
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify(timings));
  const {
    assetsDir: _assetsDir, assertions: _assertions, provenance: _provenance,
    sceneState: _sceneState, ...serializable
  } = resolved;
  fs.writeFileSync(path.join(out, 'config.resolved.json'), JSON.stringify(serializable, null, 2));
  const contact = path.join(review, 'contact-sheet.jpg');
  const frame = path.join(review, '0001.jpg');
  fs.writeFileSync(contact, 'contact');
  fs.writeFileSync(frame, 'frame');
  writeProofReceipt(resolved, out, [contact], [frame]);
  const video = path.join(out, 'video.mp4');
  renderVideo(video);
  if (captionState === 'malformed') fs.writeFileSync(path.join(out, 'captions.vtt'), 'WEBVTT\n\nnot a cue\n');
  if (captionState === 'oversized') {
    fs.writeFileSync(path.join(out, 'captions.vtt'), `WEBVTT\n\n${'x'.repeat(1024 * 1024)}\n`);
  }
  writeVideoCiBinding(video, { outDir: out, projectDir: project, config: resolved });
  if (legacyMarker) {
    fs.writeFileSync(path.join(out, '.restored-manifest.json'), JSON.stringify({
      manifestSha256: digest(path.join(out, 'manifest.json')),
      legacySafeLayout: true,
    }));
  }
  return { project, out, video };
}

function runner(releases) {
  const env = { ...process.env, NAROVA_FIRST_RUN: '0', NAROVA_RELEASES_DIR: releases };
  return args => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });
}

function branchPair(releases, name) {
  return {
    snapshot: tree(path.join(releases, name)),
    metadata: tree(path.join(releases, '.branches', name)),
  };
}

test('caption repair creates a real aligned candidate while production stays byte-identical', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-caption-repair-'));
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases);
  const { project, video } = fixture(root, 'project');
  const run = runner(releases);
  const before = tree(project);
  const result = run([
    'judge', '--repair', '--project', project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'caption-candidate', '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operation, 'judge');
  assert.equal(envelope.data.judgement.observations.find(row => row.assertion?.id === 'captions-present').outcome, 'UNCERTAIN');
  assert.deepEqual(envelope.artifacts.map(item => item.role), ['archive', 'proof-metadata']);
  const candidate = envelope.data.repairCandidate;
  assert.equal(candidate.schema, 'narova.repair-candidate/1');
  assert.equal(candidate.policy, 'caption-sidecar-rebuild/v1');
  assert.equal(candidate.observations.before.outcome, 'UNCERTAIN');
  assert.equal(candidate.observations.after.outcome, 'ALIGNED');
  assert.equal(candidate.artifact.identical, true);
  assert.equal(candidate.allProtectedIdentitiesMatch, true);
  assert.equal(candidate.approval, null);
  assert.equal(candidate.selection, null);
  assert.deepEqual(tree(project), before);

  const metadata = path.join(releases, '.branches', 'caption-candidate');
  const branch = JSON.parse(fs.readFileSync(path.join(metadata, 'branch.json'), 'utf8'));
  assert.equal(branch.status, 'candidate');
  assert.equal(digest(path.join(metadata, branch.videoCi.artifact.path)), digest(video));
  assert.ok(fs.readFileSync(path.join(metadata, 'video-ci', 'captions.srt'), 'utf8').includes('Two words.'));
  assert.ok(fs.readFileSync(path.join(metadata, 'video-ci', 'captions.vtt'), 'utf8').startsWith('WEBVTT'));
  assert.equal(verifyCaptionRepair(metadata, branch.repairCandidate, branch.repairCandidateIdentity,
    branch, path.join(releases, 'caption-candidate')), true);

  const malformed = fixture(root, 'malformed-project', { captionState: 'malformed' });
  const malformedBefore = tree(malformed.project);
  const human = run([
    'judge', '--repair', '--project', malformed.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'caption-candidate-2',
  ]);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Current production: unchanged/);
  assert.match(human.stdout, /unapproved candidate/);
  assert.deepEqual(tree(malformed.project), malformedBefore);
});

test('caption repair preserves receipt-bound scene-state evidence byte-for-byte', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-caption-repair-state-'));
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases);
  const { project, video } = fixture(root, 'project', { withSceneState: true });
  const baselineBinding = JSON.parse(fs.readFileSync(`${video}.narova-ci.json`, 'utf8'));
  assert.equal(baselineBinding.context.sceneState.length, 1);
  const run = runner(releases);
  const result = run([
    'judge', '--repair', '--project', project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'state-preserved', '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const candidate = JSON.parse(result.stdout).data.repairCandidate;
  assert.equal(candidate.protectedIdentities.sceneState.match, true);
  const candidateBinding = JSON.parse(fs.readFileSync(path.join(
    releases, '.branches', 'state-preserved', 'video-ci', 'artifact.mp4.narova-ci.json',
  ), 'utf8'));
  assert.deepEqual(candidateBinding.context.sceneState, baselineBinding.context.sceneState);
});

test('caption repair rejects creative, disabled, unbound, and non-aligning cases without replacement', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-caption-repair-reject-'));
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases);
  const run = runner(releases);

  const seed = fixture(root, 'seed');
  let result = run(['judge', '--repair', '--project', seed.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'protected']);
  assert.equal(result.status, 0, result.stderr);
  const protectedBranch = branchPair(releases, 'protected');

  const legacy = fixture(root, 'legacy-marker', {
    assertionClass: 'creative-intent', legacyMarker: true,
  });
  const legacyBefore = tree(legacy.project);
  result = run(['judge', '--repair', '--project', legacy.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'protected']);
  assert.equal(result.status, 1);
  assert.deepEqual(tree(legacy.project), legacyBefore);
  assert.deepEqual(branchPair(releases, 'protected'), protectedBranch);

  const creative = fixture(root, 'creative', { assertionClass: 'creative-intent' });
  const creativeBefore = tree(creative.project);
  result = run(['judge', '--repair', '--project', creative.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'protected']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only mechanical or accessibility/);
  assert.deepEqual(tree(creative.project), creativeBefore);
  assert.deepEqual(branchPair(releases, 'protected'), protectedBranch);

  const oversized = fixture(root, 'oversized', { captionState: 'oversized' });
  result = run(['judge', '--repair', '--project', oversized.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'protected']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot use unavailable receipt-bound caption evidence/);
  assert.deepEqual(branchPair(releases, 'protected'), protectedBranch);

  const disabled = fixture(root, 'disabled', { captions: false });
  result = run(['judge', '--repair', '--project', disabled.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'protected']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /captions are disabled/);
  assert.deepEqual(branchPair(releases, 'protected'), protectedBranch);

  const unbound = fixture(root, 'unbound');
  fs.rmSync(`${unbound.video}.narova-ci.json`);
  result = run(['judge', '--repair', '--project', unbound.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'protected']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical video evidence receipt/);
  assert.deepEqual(branchPair(releases, 'protected'), protectedBranch);

  const stale = fixture(root, 'stale');
  const staleReceipt = `${stale.video}.narova-ci.json`;
  const staleBinding = JSON.parse(fs.readFileSync(staleReceipt, 'utf8'));
  staleBinding.artifact.sha256 = '0'.repeat(64);
  fs.writeFileSync(staleReceipt, JSON.stringify(staleBinding));
  result = run(['judge', '--repair', '--project', stale.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'protected']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /canonical video evidence receipt/);
  assert.deepEqual(branchPair(releases, 'protected'), protectedBranch);

  const nonaligning = fixture(root, 'nonaligning', { expected: 99 });
  result = run(['judge', '--repair', '--project', nonaligning.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'protected']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not align/);
  assert.deepEqual(branchPair(releases, 'protected'), protectedBranch);
  assert.ok(!fs.readdirSync(releases).some(name => name.startsWith('.branch-stage-')));
});

test('tampered caption evidence invalidates the candidate', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-caption-repair-tamper-'));
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases);
  const { project } = fixture(root, 'project');
  const result = runner(releases)(['judge', '--repair', '--project', project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'candidate', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const metadata = path.join(releases, '.branches', 'candidate');
  const snapshot = path.join(releases, 'candidate');
  const branch = JSON.parse(fs.readFileSync(path.join(metadata, 'branch.json'), 'utf8'));
  fs.appendFileSync(path.join(metadata, 'video-ci', 'captions.srt'), '\nchanged');
  assert.equal(verifyCaptionRepair(metadata, branch.repairCandidate,
    branch.repairCandidateIdentity, branch, snapshot), false);
});

test('caption repair rejects internally stale receipt snapshots and forged protected claims', { skip: !MEDIA_AVAILABLE }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-caption-repair-binding-'));
  const releases = path.join(root, 'releases');
  fs.mkdirSync(releases);
  const stale = fixture(root, 'stale-content', { captionState: 'malformed' });
  const receiptFile = `${stale.video}.narova-ci.json`;
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  receipt.context.captions[0].content += 'changed without updating its identity';
  fs.writeFileSync(receiptFile, JSON.stringify(receipt));
  let result = runner(releases)(['judge', '--repair', '--project', stale.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'stale-candidate']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /snapshot content does not match its receipt identity/);
  assert.equal(fs.existsSync(path.join(releases, 'stale-candidate')), false);

  const valid = fixture(root, 'valid');
  result = runner(releases)(['judge', '--repair', '--project', valid.project,
    '--judge-assertion', 'captions-present', '--repair-branch', 'candidate']);
  assert.equal(result.status, 0, result.stderr);
  const metadata = path.join(releases, '.branches', 'candidate');
  const snapshot = path.join(releases, 'candidate');
  const branch = JSON.parse(fs.readFileSync(path.join(metadata, 'branch.json'), 'utf8'));
  const forged = structuredClone(branch.repairCandidate);
  forged.protectedIdentities.proof = {
    before: 'f'.repeat(64), after: 'f'.repeat(64), match: true,
  };
  assert.equal(verifyCaptionRepair(metadata, forged, repairCandidateIdentity(forged),
    branch, snapshot), false);

  const rewritten = structuredClone(branch);
  const replacements = {
    'captions.srt': '1\n00:00:00,050 --> 00:00:00,700\nOne\n',
    'captions.vtt': 'WEBVTT\n\n00:00:00.050 --> 00:00:00.700\nOne\n',
  };
  for (const [name, contents] of Object.entries(replacements)) {
    fs.writeFileSync(path.join(metadata, 'video-ci', name), contents);
  }
  const bindingItem = rewritten.videoCi.contextArtifacts.find(item => item.role === 'video-ci-evidence');
  const bindingFile = path.join(metadata, bindingItem.path);
  const binding = JSON.parse(fs.readFileSync(bindingFile, 'utf8'));
  for (const source of binding.context.captions) {
    const contents = replacements[`captions.${source.format}`];
    source.content = contents;
    source.bytes = Buffer.byteLength(contents);
    source.sha256 = crypto.createHash('sha256').update(contents).digest('hex');
  }
  fs.writeFileSync(bindingFile, `${JSON.stringify(binding, null, 2)}\n`);
  for (const item of rewritten.videoCi.contextArtifacts) {
    const file = path.join(metadata, item.path);
    item.bytes = fs.statSync(file).size;
    item.sha256 = digest(file);
  }
  rewritten.videoCi.evidenceBinding.sha256 = bindingItem.sha256;
  for (const item of rewritten.repairCandidate.captions.after) {
    const context = rewritten.videoCi.contextArtifacts.find(candidate => candidate.path === item.path);
    item.bytes = context.bytes;
    item.sha256 = context.sha256;
  }
  rewritten.videoCiIdentity = branchExperimentIdentity(rewritten.videoCi);
  rewritten.repairCandidateIdentity = repairCandidateIdentity(rewritten.repairCandidate);
  assert.equal(verifyCaptionRepair(metadata, rewritten.repairCandidate,
    rewritten.repairCandidateIdentity, rewritten, snapshot), false);
});
