'use strict';
/* First-class Narova Witness conformance (NAR-SPEC-024). */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { probeArtifact } = require('../src/judge');
const {
  canonicalize, expectedBundleId, publishWitnessBundle, validateWitnessBundle,
  verifyArtifactBytes, visualMetrics, witnessArtifact,
} = require('../src/witness');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, 'tool', 'bin', 'narova.js');
const MEDIA_AVAILABLE = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const run = args => spawnSync(process.execPath, [BIN, ...args], {
  encoding: 'utf8', env: { ...process.env, NAROVA_FIRST_RUN: '0' },
});
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let root;
let video;

before(() => {
  if (!MEDIA_AVAILABLE) return;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-witness-'));
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reel.config.json'), `${JSON.stringify({
    title: 'Witness fixture', size: '16:9', voices: {},
    scenes: [{ id: 'only', body: '<div>fixture</div>', vo: [], dur: 2 }],
  }, null, 2)}\n`);
  video = path.join(root, 'out', 'video.mp4');
  const generated = spawnSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=1',
    '-f', 'lavfi', '-i', 'color=c=white:s=160x90:r=10:d=1',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-c:v', 'mpeg4', '-q:v', '5', video,
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
});

after(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('canonicalization follows the frozen ECMAScript boundary vectors', () => {
  assert.equal(
    canonicalize({ b: 1, a: 2, A: 3, ä: 4, z: 5 }),
    '{"A":3,"a":2,"b":1,"z":5,"ä":4}',
  );
  assert.equal(
    `sha256:${crypto.createHash('sha256').update(canonicalize({ list: [3, 1, 2] })).digest('hex')}`,
    'sha256:e1a0b6138e48437b9d08d505c4b902f063d221a38a0e13b9c5605d8ab1f4545d',
  );
  assert.equal(canonicalize({ negzero: -0, small: 1e-7, large: 1e21 }), '{"large":1e+21,"negzero":0,"small":1e-7}');
  assert.throws(() => canonicalize({ invalid: Infinity }), /finite numbers/);
  assert.throws(() => canonicalize({ invalid: new Date() }), /JSON values/);
});

test('Witness emits deterministic, exact, pixels-only evidence with neutral authority', { skip: !MEDIA_AVAILABLE }, () => {
  const artifact = probeArtifact(video);
  const first = witnessArtifact(artifact);
  const second = witnessArtifact(artifact);
  const alias = path.join(root, 'out', 'same-bytes-different-name.bin');
  fs.copyFileSync(video, alias);
  const renamed = witnessArtifact(probeArtifact(alias));
  validateWitnessBundle(first);
  assert.deepEqual(second, first);
  assert.deepEqual(renamed, first);
  assert.equal(first.schema, 'narova.witness/1');
  assert.equal(first.bundleId, expectedBundleId(first));
  assert.equal(first.artifact.digest, digest(video));
  assert.equal(first.artifact.bytes, fs.statSync(video).size);
  assert.equal(first.coverage.profile, 'PIXELS_ONLY');
  assert.deepEqual(first.extensions['narova.renderer-compatibility'].artifactOnly, ['hyperframes', 'no-browser']);
  const frames = first.resources.filter(item => item.kind === 'decoded-grayscale-frame');
  assert.equal(frames.length, first.coverage.artifactFrames.analyzed);
  assert.deepEqual(frames.map(item => item.extensions['narova.frame-binding'].frameIndex),
    frames.map((item, index) => index));
  assert.ok(frames.every(item => item.extensions['narova.frame-binding'].parentArtifact.digest === digest(video)));
  assert.ok(frames.every(item => item.extensions['narova.frame-binding'].extractionMethod === first.methods[0].id));
  assert.ok(first.observations.every(item => frames.every(frame => item.evidence.includes(frame.id))));
  assert.equal(first.coverage.channels.find(item => item.kind === 'dom.element-boxes').availability, 'UNAVAILABLE');
  assert.equal(first.coverage.channels.find(item => item.kind === 'renderer.visual-node-boxes').availability, 'UNAVAILABLE');
  assert.equal(first.effect, 'NONE');
  assert.equal(first.summary.byBasis.LEARNED, 0);
  assert.equal(first.summary.byBasis.INTERPRETIVE, 0);
  assert.equal(first.summary.escalations, 0);
  assert.match(first.methods[0].provider, /^ffmpeg version /);
  assert.doesNotMatch(JSON.stringify(first), /"(?:score|qualityScore|beauty|recommendation|mutation|repair)"\s*:/);
  assert.doesNotMatch(JSON.stringify(first), /"(?:ALIGNED|DIVERGED)"/);

  const judgeVerdict = structuredClone(first);
  judgeVerdict.observations[0].value = { type: 'enum', enum: 'ALIGNED' };
  assert.throws(() => validateWitnessBundle(judgeVerdict), /Judge-only verdict/);
  const hiddenTaste = structuredClone(first);
  hiddenTaste.extensions['vendor.preference'] = { aesthetic_score: 0.9 };
  assert.throws(() => validateWitnessBundle(hiddenTaste), /not permitted/);

  const whole = visualMetrics(first, 0, artifact.duration);
  assert.ok(whole.sampledFrames > 1);
  assert.ok(whole.cutCount >= 1);
  assert.ok(whole.blackRatio > 0 && whole.blackRatio < 1);
});

test('narova witness atomically materializes a machine-native bundle', { skip: !MEDIA_AVAILABLE }, () => {
  const result = run(['witness', '--project', root, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.schema, 'narova.result/1');
  assert.equal(envelope.operation, 'witness');
  assert.equal(envelope.success, true);
  assert.equal(envelope.data.witness.schema, 'narova.witness/1');
  assert.equal(envelope.data.output, 'out/witness.json');
  assert.equal(envelope.artifacts.length, 1);
  assert.equal(envelope.artifacts[0].role, 'witness-evidence');
  const output = path.join(root, 'out', 'witness.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), envelope.data.witness);
  validateWitnessBundle(envelope.data.witness);

  const human = run(['witness', '--project', root, '--output', 'out/custom-witness.json']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /Narova Witness — artifact-bound perceptual evidence/);
  assert.match(human.stdout, /Creative authority: evidence only/);
  assert.match(human.stdout, /no score, taste judgement, gate, mutation, model, VLM, or network call/);
});

test('failed publication preserves prior evidence and output paths stay project-local', { skip: !MEDIA_AVAILABLE }, () => {
  const artifact = probeArtifact(video);
  const bundle = witnessArtifact(artifact);
  const output = path.join(root, 'out', 'preserved-witness.json');
  fs.writeFileSync(output, '{"prior":true}\n');
  const before = fs.readFileSync(output);
  assert.throws(() => publishWitnessBundle(bundle, output), /commit-time input verification/);
  assert.throws(() => publishWitnessBundle(bundle, output, {
    verifyInputs: () => { throw new Error('artifact changed before commit'); },
  }), /artifact changed/);
  assert.deepEqual(fs.readFileSync(output), before);
  assert.equal(fs.readdirSync(path.dirname(output)).some(name => name.includes('.part-')), false);

  const originalVideo = fs.readFileSync(video);
  try {
    assert.throws(() => publishWitnessBundle(bundle, output, {
      verifyInputs: () => {
        fs.appendFileSync(video, Buffer.from([0]));
        verifyArtifactBytes(artifact);
      },
    }), /artifact changed/);
  } finally {
    fs.writeFileSync(video, originalVideo);
  }
  assert.deepEqual(fs.readFileSync(output), before);

  const escaped = run(['witness', '--project', root, '--output', '../escaped-witness.json', '--json']);
  assert.notEqual(escaped.status, 0);
  assert.equal(fs.existsSync(path.join(root, '..', 'escaped-witness.json')), false);

  const missingParent = run(['witness', '--project', root, '--output', 'new-dir/witness.json', '--json']);
  assert.notEqual(missingParent.status, 0);
  assert.equal(fs.existsSync(path.join(root, 'new-dir')), false);
});

test('Judge consumes Witness identity and has no independent visual implementation', { skip: !MEDIA_AVAILABLE }, () => {
  const result = run(['judge', '--project', root, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout).data.judgement;
  assert.equal(report.witness.schema, 'narova.witness/1');
  assert.equal(report.witness.artifact.digest, report.artifact.sha256);
  assert.match(report.witness.bundleId, /^sha256:[a-f0-9]{64}$/);
  const visual = report.perception.implementations.find(item => item.kind === 'local-built-in-witness');
  assert.equal(visual.witnessBundleId, report.witness.bundleId);
  const source = fs.readFileSync(path.join(ROOT, 'tool', 'src', 'judge.js'), 'utf8');
  assert.doesNotMatch(source, /function\s+(?:analyzeFrames|visualMetrics|edgeEnergy|frameDifference)\s*\(/);
  assert.match(source, /witnessArtifact\(artifact\)/);
});
