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
const {
  loadVideoCiBinding, verifyVideoCiBinding, writeVideoCiBinding,
} = require('../src/video-ci-binding');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, 'tool', 'bin', 'narova.js');
const MEDIA_AVAILABLE = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const run = (args, extraEnv = {}) => spawnSync(process.execPath, [BIN, ...args], {
  encoding: 'utf8', env: { ...process.env, NAROVA_FIRST_RUN: '0', ...extraEnv },
});
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function installFakeHyperFrames(dir) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const npx = path.join(bin, 'npx');
  fs.writeFileSync(npx, `#!/usr/bin/env node
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const at = process.argv.indexOf('--output');
if (at < 0 || !process.argv[at + 1]) process.exit(2);
const output = path.resolve(process.cwd(), process.argv[at + 1]);
const result = spawnSync('ffmpeg', [
  '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=160x90:r=30:d=1',
  '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output,
]);
process.exit(result.status == null ? 1 : result.status);
`);
  fs.chmodSync(npx, 0o755);
  return bin;
}

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
  assert.equal(first.coverage.channels.find(item => item.kind === 'dom.layout-audit').reason,
    'ADAPTER_DOES_NOT_EXPOSE_CHANNEL');
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

function privilegedFixture(provider = 'no-browser') {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), `narova-witness-${provider}-`));
  const out = path.join(fixture, 'out');
  fs.mkdirSync(out);
  const artifactFile = path.join(out, 'video.mp4');
  fs.copyFileSync(video, artifactFile);
  const manifest = {
    renderer: { provider, providerVersion: 'fixture-renderer' },
    format: { width: 160, height: 90, fps: 10 },
    captions: { enabled: false, preset: 'subtitle' },
    safeLayout: false,
    scenes: [{
      id: 'strange', index: 0, start: 0, duration: 2, transition: 'fade', vo: [],
      visual: {
        type: 'rect', style: { opacity: 0.5, overflow: 'hidden' },
        children: [{ type: 'rect', style: { x: -120, y: 12, width: 80, height: 40, opacity: 0 } }],
      },
    }],
  };
  fs.writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  fs.writeFileSync(path.join(out, 'timings.json'), '{}\n');
  fs.writeFileSync(path.join(fixture, 'reel.config.json'), `${JSON.stringify({
    title: 'Privileged fixture', renderer: provider, size: '16:9', voices: {},
    scenes: [{ id: 'strange', vo: [], dur: 2, visual: manifest.scenes[0].visual }],
  })}\n`);
  const receipt = writeVideoCiBinding(artifactFile, {
    outDir: out, projectDir: fixture, sceneState: [],
  });
  const artifact = probeArtifact(artifactFile);
  const binding = loadVideoCiBinding(artifact, out);
  return { fixture, out, artifactFile, manifest, receipt, artifact, binding };
}

test('no-browser receipt adds exactly bound neutral production state to narova.witness/1', { skip: !MEDIA_AVAILABLE }, () => {
  const rich = privilegedFixture();
  try {
    const videoBefore = fs.readFileSync(rich.artifactFile);
    const receiptBefore = fs.readFileSync(rich.receipt);
    const first = witnessArtifact(rich.artifact, { binding: rich.binding });
    fs.writeFileSync(path.join(rich.out, 'manifest.json'), '{"renderer":{"provider":"hyperframes"}}\n');
    const second = witnessArtifact(rich.artifact, { binding: rich.binding });
    assert.deepEqual(second, first);
    const cli = run(['witness', '--project', rich.fixture, '--json']);
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).data.witness.coverage.profile, 'MIXED');
    const judged = run(['judge', '--project', rich.fixture, '--json']);
    assert.equal(judged.status, 0, judged.stderr);
    assert.equal(JSON.parse(judged.stdout).data.judgement.witness.coverage.profile, 'MIXED');
    validateWitnessBundle(first);
    assert.equal(first.schema, 'narova.witness/1');
    assert.equal(first.coverage.profile, 'MIXED');
    const channel = first.coverage.channels.find(item => item.kind === 'renderer.visual-node-boxes');
    assert.equal(channel.availability, 'AVAILABLE');
    const observation = first.observations.find(item => item.kind === 'renderer.visual-node-boxes.bound-sample-count');
    assert.equal(observation.basis, 'MEASURED');
    assert.deepEqual(observation.sourceRoles, ['PRODUCTION_STATE']);
    assert.equal(observation.confidence.value, 1);
    const resource = first.resources.find(item => item.kind === 'renderer.visual-node-boxes');
    const state = resource.extensions['narova.inline-json'].data;
    assert.equal(state.source.artifact.digest, rich.artifact.sha256);
    assert.equal(state.source.manifest.digest, rich.binding.document.context.manifest.sha256);
    assert.ok(state.samples.every(item => item.frameResource.startsWith('resource:frame:')));
    assert.ok(state.samples.some(item => item.nodes[1].effectiveOpacity === 0));
    const whiteState = state.samples.find(item => item.time.ticks >= 100000000);
    const luma = first.observations.find(item => item.kind === 'artifact.luma.mean-series')
      .value.series.find(item => item.time.ticks === whiteState.time.ticks);
    assert.equal(whiteState.nodes[1].effectiveOpacity, 0);
    assert.ok(luma.number > 0.8);
    assert.equal(first.observations.some(item => /visibility/.test(item.kind)), false);
    assert.doesNotMatch(JSON.stringify(first), /"(?:score|qualityScore|beauty|recommendation|mutation|repair|verdict)"\s*:/i);
    assert.deepEqual(fs.readFileSync(rich.artifactFile), videoBefore);
    assert.deepEqual(fs.readFileSync(rich.receipt), receiptBefore);

    const tampered = structuredClone(first);
    tampered.resources.find(item => item.kind === 'renderer.visual-node-boxes')
      .extensions['narova.inline-json'].data.samples[0].frameIndex += 1;
    assert.throws(() => validateWitnessBundle(tampered), /inline resource.*digest/);
    const rebound = structuredClone(first);
    rebound.resources.find(item => item.kind === 'renderer.visual-node-boxes')
      .extensions['narova.derivation-binding'].receipt.digest = '0'.repeat(64);
    rebound.bundleId = expectedBundleId(rebound);
    assert.throws(() => validateWitnessBundle(rebound), /invalid artifact or manifest binding/);
  } finally {
    fs.rmSync(rich.fixture, { recursive: true, force: true });
  }
});

test('stale receipt and HyperFrames degrade to the unchanged pixels-only path', { skip: !MEDIA_AVAILABLE }, () => {
  const stale = privilegedFixture();
  const hyperframes = privilegedFixture('hyperframes');
  const malformed = privilegedFixture();
  try {
    const document = JSON.parse(fs.readFileSync(stale.receipt, 'utf8'));
    document.artifact.sha256 = '0'.repeat(64);
    fs.writeFileSync(stale.receipt, `${JSON.stringify(document)}\n`);
    const invalid = loadVideoCiBinding(stale.artifact, stale.out);
    assert.equal(invalid.used, false);
    const staleBundle = witnessArtifact(stale.artifact, { binding: invalid });
    assert.equal(staleBundle.coverage.profile, 'PIXELS_ONLY');
    assert.equal(staleBundle.coverage.channels.find(item => item.kind === 'renderer.visual-node-boxes').reason,
      'ARTIFACT_BOUND_SOURCE_INVALID');

    const browserBundle = witnessArtifact(hyperframes.artifact, { binding: hyperframes.binding });
    assert.equal(browserBundle.coverage.profile, 'PIXELS_ONLY');
    assert.equal(browserBundle.coverage.channels.find(item => item.kind === 'renderer.visual-node-boxes').availability, 'UNAVAILABLE');
    assert.equal(browserBundle.coverage.channels.find(item => item.kind === 'dom.layout-audit').reason,
      'LOCAL_CONTAINMENT_UNAVAILABLE');
    assert.equal(witnessArtifact(hyperframes.artifact).coverage.channels
      .find(item => item.kind === 'dom.layout-audit').reason, 'ADAPTER_DOES_NOT_EXPOSE_CHANNEL');
    const cli = run(['witness', '--project', hyperframes.fixture, '--json']);
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).data.witness.coverage.profile, 'PIXELS_ONLY');

    const malformedReceipt = JSON.parse(fs.readFileSync(malformed.receipt, 'utf8'));
    malformedReceipt.context.manifest.content.format = null;
    fs.writeFileSync(malformed.receipt, `${JSON.stringify(malformedReceipt)}\n`);
    const malformedBinding = loadVideoCiBinding(malformed.artifact, malformed.out);
    assert.equal(malformedBinding.used, true);
    const malformedBundle = witnessArtifact(malformed.artifact, { binding: malformedBinding });
    assert.equal(malformedBundle.coverage.profile, 'PIXELS_ONLY');
    assert.equal(malformedBundle.coverage.channels.find(item => item.kind === 'renderer.visual-node-boxes').reason,
      'BOUND_NO_BROWSER_SOURCE_INVALID');
  } finally {
    fs.rmSync(stale.fixture, { recursive: true, force: true });
    fs.rmSync(hyperframes.fixture, { recursive: true, force: true });
    fs.rmSync(malformed.fixture, { recursive: true, force: true });
  }
});

test('rich Witness publication rechecks the exact receipt before atomic commit', { skip: !MEDIA_AVAILABLE }, () => {
  const rich = privilegedFixture();
  try {
    const bundle = witnessArtifact(rich.artifact, { binding: rich.binding });
    const output = path.join(rich.out, 'witness.json');
    fs.writeFileSync(output, '{"prior":true}\n');
    const prior = fs.readFileSync(output);
    fs.appendFileSync(rich.receipt, ' ');
    assert.throws(() => publishWitnessBundle(bundle, output, {
      verifyInputs: () => {
        verifyArtifactBytes(rich.artifact);
        verifyVideoCiBinding(rich.binding);
      },
    }), /binding changed during analysis/);
    assert.deepEqual(fs.readFileSync(output), prior);
  } finally {
    fs.rmSync(rich.fixture, { recursive: true, force: true });
  }
});

test('build --witness publishes one advisory bundle without changing ordinary build identities', { skip: !MEDIA_AVAILABLE }, () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-witness-real-no-browser-'));
  try {
    const freezeDate = path.join(project, 'freeze-date.cjs');
    fs.writeFileSync(freezeDate, `
const NativeDate = Date;
global.Date = class FrozenDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : ['2026-08-24T00:00:00.000Z'])); }
  static now() { return NativeDate.parse('2026-08-24T00:00:00.000Z'); }
};
`);
    const frozenEnv = { NODE_OPTIONS: `--require=${freezeDate}` };
    fs.writeFileSync(path.join(project, 'reel.config.json'), `${JSON.stringify({
      title: 'Real renderer Witness', renderer: 'no-browser', size: '16:9', voices: {},
      scenes: [{
        id: 'only', vo: [], dur: 1,
        visual: {
          type: 'rect', style: { background: '#111111' },
          children: [{ type: 'rect', style: { x: 80, y: 60, width: 240, height: 120, opacity: 0.75 } }],
        },
      }],
    })}\n`);
    const built = run(['build', '--project', project, '--json'], frozenEnv);
    assert.equal(built.status, 0, built.stderr);
    const rendered = path.join(project, 'out', 'video.mp4');
    const receipt = `${rendered}.narova-ci.json`;
    const videoBefore = fs.readFileSync(rendered);
    const receiptBefore = fs.readFileSync(receipt);
    assert.equal(fs.existsSync(path.join(project, 'out', 'witness.json')), false);

    const witnessed = run(['build', '--witness', '--project', project, '--json'], frozenEnv);
    assert.equal(witnessed.status, 0, witnessed.stderr);
    const envelope = JSON.parse(witnessed.stdout);
    assert.equal(envelope.data.witness.availability, 'AVAILABLE');
    assert.ok(envelope.artifacts.some(item => item.role === 'witness-evidence'
      && item.path.endsWith('out/witness.json')));
    const witnessFile = path.join(project, 'out', 'witness.json');
    const bundle = JSON.parse(fs.readFileSync(witnessFile, 'utf8'));
    assert.equal(bundle.coverage.profile, 'MIXED');
    assert.equal(bundle.resources.find(item => item.kind === 'renderer.visual-node-boxes')
      .extensions['narova.inline-json'].data.source.renderer.provider, 'no-browser');
    assert.deepEqual(fs.readFileSync(rendered), videoBefore);
    assert.deepEqual(fs.readFileSync(receipt), receiptBefore);

    const witnessBeforeOptOut = fs.readFileSync(witnessFile);
    const ordinaryAgain = run(['build', '--project', project, '--json'], frozenEnv);
    assert.equal(ordinaryAgain.status, 0, ordinaryAgain.stderr);
    assert.equal(Object.hasOwn(JSON.parse(ordinaryAgain.stdout).data, 'witness'), false);
    assert.deepEqual(fs.readFileSync(rendered), videoBefore);
    assert.deepEqual(fs.readFileSync(receipt), receiptBefore);
    assert.deepEqual(fs.readFileSync(witnessFile), witnessBeforeOptOut);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('build --witness rejects plural variants before rendering', () => {
  const result = run(['build', '--witness', '--variants', '--project', root, '--json']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /supports one selected primary build/);
});

test('HyperFrames build --witness stays pixels-only without exact render provenance', { skip: !MEDIA_AVAILABLE }, () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-witness-hf-build-'));
  try {
    const fakeBin = installFakeHyperFrames(project);
    fs.writeFileSync(path.join(project, 'reel.config.json'), `${JSON.stringify({
      title: 'HyperFrames Witness boundary', renderer: 'hyperframes', size: '16:9', voices: {},
      scenes: [{ id: 'only', vo: [], dur: 1, body: '<div>Intentional layout</div>' }],
    })}\n`);
    const result = run(['build', '--witness', '--project', project, '--json'], {
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ''}`,
    });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.data.witness.availability, 'AVAILABLE');
    const bundle = JSON.parse(fs.readFileSync(path.join(project, 'out', 'witness.json'), 'utf8'));
    assert.equal(bundle.coverage.profile, 'PIXELS_ONLY');
    assert.equal(bundle.coverage.channels.find(item => item.kind === 'dom.layout-audit').reason,
      'LOCAL_CONTAINMENT_UNAVAILABLE');
    assert.equal(bundle.observations.some(item => item.kind.startsWith('dom.')), false);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('build --witness publication failure is advisory and leaves the primary build successful', { skip: !MEDIA_AVAILABLE }, () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-witness-advisory-'));
  try {
    fs.mkdirSync(path.join(project, 'out', 'witness.json'), { recursive: true });
    fs.writeFileSync(path.join(project, 'reel.config.json'), `${JSON.stringify({
      title: 'Advisory Witness failure', renderer: 'no-browser', size: '16:9', voices: {},
      scenes: [{ id: 'only', vo: [], dur: 1, visual: { type: 'rect', style: { background: '#222222' } } }],
    })}\n`);
    const result = run(['build', '--witness', '--project', project, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.success, true);
    assert.deepEqual(envelope.data.witness, {
      availability: 'UNAVAILABLE', reason: 'WITNESS_PUBLICATION_FAILED',
    });
    assert.ok(envelope.diagnostics.some(item => item.severity === 'warning'
      && item.code === 'advisory.witness.unavailable'));
    assert.equal(envelope.artifacts.some(item => item.role === 'witness-evidence'), false);
    assert.equal(fs.existsSync(path.join(project, 'out', 'video.mp4')), true);
    assert.equal(fs.statSync(path.join(project, 'out', 'witness.json')).isDirectory(), true);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
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
  assert.match(source, /witnessArtifact\(artifact, \{ binding \}\)/);
});
