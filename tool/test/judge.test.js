'use strict';
/* Video CI rendered-evidence mirror and option expansion (NAR-SPEC-023). */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCaptionCues, compareProbe, captionEvidence } = require('../src/judge');
const { hashConfig } = require('../src/manifest');
const { writeVideoCiBinding } = require('../src/video-ci-binding');
const { interventionPlan } = require('../src/intervention-plan');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, 'tool', 'bin', 'narova.js');
const FAMILIES = [
  'intent-rendered-correspondence',
  'visual-narrative-correspondence',
  'entity-continuity',
  'attention-visual-hierarchy',
  'temporal-behavior',
];

const run = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], {
  encoding: 'utf8',
  env: { ...process.env, NAROVA_FIRST_RUN: '0' },
  ...opts,
});
const MEDIA_AVAILABLE = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
  && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function treeState(root) {
  const state = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) state[relative] = { bytes: fs.statSync(absolute).size, sha256: digest(absolute) };
      else state[relative] = { kind: 'non-regular' };
    }
  }
  visit(root);
  return state;
}

function machineResult(result) {
  assert.ok(result.stdout.trim(), result.stderr);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.schema, 'narova.result/1');
  assert.equal(envelope.operation, 'judge');
  assert.equal(envelope.success, result.status === 0);
  return envelope;
}

function makeProject(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-judge-edge-'));
  const out = path.join(root, 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(root, 'reel.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return { root, out };
}

function silentSceneConfig(extra = {}) {
  return {
    title: 'Video CI Edge Fixture',
    size: '16:9',
    voices: {},
    scenes: [{ id: 'only', body: '<div>edge fixture</div>', vo: [], dur: 1 }],
    ...extra,
  };
}

function bindVideo(root, out, file = path.join(out, 'video.mp4')) {
  return writeVideoCiBinding(file, { outDir: out, projectDir: root });
}

let fixtureRoot;
let project;
let video;

before(() => {
  if (!MEDIA_AVAILABLE) return;

  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-judge-'));
  project = path.join(fixtureRoot, 'project');
  const out = path.join(project, 'out');
  fs.mkdirSync(out, { recursive: true });
  const config = {
    title: 'Video CI Fixture',
    size: '16:9',
    voices: {},
    scenes: [
      { id: 'opening', body: '<div>empty chair</div>', vo: [], dur: 1 },
      { id: 'reveal', body: '<div>red reveal</div>', vo: [], dur: 1 },
    ],
    assertions: [
      {
        id: 'silent-opening',
        class: 'deliberate-choice',
        expect: 'The opening should remain silent and nearly static.',
        origin: { kind: 'user-brief', ref: 'risky opening' },
        scope: { scene: 'opening', start: 0, end: 0.9 },
        observe: [
          { metric: 'audio.silence_ratio', operator: 'gte', value: 0.99 },
          { metric: 'video.static_ratio', operator: 'gte', value: 0.9 },
        ],
        riskyBecause: ['unconventional stillness', 'no narration'],
        questions: ['Did unintended motion undermine the stillness?'],
        related: {
          scene: 'opening', source: 'scenes/opening.html', creativeLineage: 'proof-b',
          protected: ['silence', 'camera rhythm'],
        },
      },
      {
        id: 'unexpected-audio',
        class: 'mechanical',
        expect: 'The opening should contain clearly audible sound.',
        scope: { start: 0, end: 0.9 },
        observe: [{ metric: 'audio.silence_ratio', operator: 'lte', value: 0.1 }],
        related: { source: 'scenes/opening.html', protected: ['camera rhythm'] },
      },
      {
        id: 'audible-discomfort',
        class: 'creative-intent',
        expect: 'Audible texture should make the silent opening uncomfortable.',
        scope: { scene: 'opening', start: 0, end: 0.9 },
        observe: [{ metric: 'audio.silence_ratio', operator: 'lte', value: 0.1 }],
        related: { component: 'ambient-texture', protected: ['static composition'] },
      },
      {
        id: 'unreadable-material',
        class: 'deliberate-violation',
        expect: 'Unreadable type should function as visual material.',
        scope: { scene: 'reveal' },
      },
      {
        id: 'outside-artifact',
        class: 'mechanical',
        expect: 'A range outside the artifact should never borrow a nearby frame.',
        scope: { start: 3, end: 4 },
        observe: [{ metric: 'video.black_ratio', operator: 'eq', value: 1 }],
      },
      {
        id: 'narrow-static',
        class: 'mechanical',
        expect: 'A narrow range needs an actual frame pair before static motion is established.',
        scope: { start: 0.1, end: 0.11 },
        observe: [{ metric: 'video.static_ratio', operator: 'gte', value: 0.9 }],
      },
      {
        id: 'scoped-level',
        class: 'mechanical',
        expect: 'Scoped silence has a measurable low audio level.',
        scope: { start: 0.1, end: 0.6 },
        observe: [{ metric: 'audio.mean_db', operator: 'lte', value: -80 }],
      },
    ],
  };
  fs.writeFileSync(path.join(project, 'reel.config.json'), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(project, 'creative-brief.md'), '# Creative brief\n\nKeep the opening strange.\n');
  fs.writeFileSync(path.join(out, 'timings.json'), `${JSON.stringify({
    total: 2,
    opening: { dur: 1, turns: [], words: [] },
    reveal: { dur: 1, turns: [], words: [] },
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'captions.srt'), '1\n00:00:01,100 --> 00:00:01,800\nA red reveal\n\n');
  fs.writeFileSync(path.join(out, 'invalid.mp4'), 'not an encoded video');

  video = path.join(out, 'video.mp4');
  const generated = spawnSync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=1',
    '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=1',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-map', '2:a', '-t', '2', '-shortest',
    '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', video,
  ], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  bindVideo(project, out, video);
});

after(() => {
  if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('caption parser preserves SRT and hourless VTT timing', () => {
  assert.deepEqual(parseCaptionCues('1\n00:00:01,250 --> 00:00:02,500\nHello <i>there</i>\n\n'), [
    { start: 1.25, end: 2.5, text: 'Hello there', words: 2 },
  ]);
  assert.deepEqual(parseCaptionCues('WEBVTT\n\n01:02.000 --> 01:03.500\nStill here\n\n'), [
    { start: 62, end: 63.5, text: 'Still here', words: 2 },
  ]);
  assert.deepEqual(parseCaptionCues('WEBVTT\n\n00:00:01,000 --> 00:00:02,000\nWrong separator\n\n'), []);
  assert.deepEqual(parseCaptionCues('WEBVTT\n\n00:61.000 --> 00:62.000\nWrong range\n\n'), []);
  assert.equal(compareProbe(0.89, { operator: 'gte', value: 0.9, tolerance: 0.02 }), true);
  assert.equal(compareProbe(0.11, { operator: 'lte', value: 0.1, tolerance: 0.02 }), true);
});

test('assertions do not alter rendering, cache, proof, or revision identity', () => {
  const base = { title: 'x', scenes: [{ id: 's', body: '<p>x</p>', vo: [], dur: 1 }] };
  const declared = { ...base, assertions: [{ id: 'one', class: 'creative-intent', expect: 'stay odd' }] };
  assert.equal(hashConfig(base), hashConfig(declared));
});

test('judge emits a deterministic scoreless five-family mirror and preserves every file', { skip: !MEDIA_AVAILABLE }, () => {
  const beforeState = treeState(project);
  const first = run(['judge', '--project', project, '--json']);
  assert.equal(first.status, 0, first.stderr);
  const firstEnvelope = machineResult(first);
  const report = firstEnvelope.data.judgement;
  assert.equal(report.schema, 'narova.judgement/1');
  assert.equal(report.score, null);
  assert.equal(report.validityEffect, 'none');
  assert.equal(report.mutation, 'none');
  assert.equal(report.artifact.path, fs.realpathSync(video));
  assert.match(report.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.families.map(family => family.family), FAMILIES);
  assert.equal(report.families.find(family => family.family === 'visual-narrative-correspondence').coverage, 'partial');
  assert.equal(report.families.find(family => family.family === 'entity-continuity').coverage, 'uncertain');
  assert.equal(report.families.find(family => family.family === 'attention-visual-hierarchy').coverage, 'partial');
  assert.equal(report.perception.implementations.find(item => item.id === 'semantic-perception').available, false);
  assert.deepEqual(firstEnvelope.artifacts, []);

  const aligned = report.observations.find(item => item.assertion && item.assertion.id === 'silent-opening');
  assert.equal(aligned.outcome, 'ALIGNED');
  assert.equal(aligned.assessmentTarget, 'declared-probes');
  assert.equal(aligned.classification, 'MEASURED');
  assert.equal(aligned.relatedProductionState.scene, 'opening');
  assert.equal(aligned.relatedProductionState.source.basis, 'AUTHORED');
  assert.match(aligned.interpretation, /establishes only those probe comparisons/);
  const alignedMeaning = report.observations.find(item => item.id === `${aligned.id}-semantic`);
  assert.equal(alignedMeaning.outcome, 'UNCERTAIN');
  assert.equal(alignedMeaning.assessmentTarget, 'free-form-correspondence');
  assert.equal(alignedMeaning.evidence[0].metric, 'semantic.correspondence');
  assert.equal(alignedMeaning.evidence[0].availability, 'unavailable');
  assert.deepEqual(alignedMeaning.suggestedQuestions, ['Did unintended motion undermine the stillness?']);
  assert.equal(report.families.find(family => family.family === 'intent-rendered-correspondence').coverage, 'partial');

  const diverged = report.observations.find(item => item.assertion && item.assertion.id === 'unexpected-audio');
  assert.equal(diverged.outcome, 'DIVERGED');
  assert.equal(diverged.classification, 'MEASURED');
  assert.equal(diverged.evidence[0].metric, 'audio.silence_ratio');
  assert.equal(diverged.evidence[0].value, 1);

  const deliberate = report.observations.find(item => item.assertion && item.assertion.id === 'unreadable-material');
  assert.equal(deliberate.outcome, 'UNCERTAIN');
  assert.doesNotMatch(deliberate.interpretation, /bad|failure|fix/i);

  for (const id of ['outside-artifact', 'narrow-static']) {
    const uncertain = report.observations.find(item => item.assertion && item.assertion.id === id);
    assert.equal(uncertain.outcome, 'UNCERTAIN');
    assert.equal(uncertain.evidence[0].availability, 'unavailable');
  }
  const scopedLevel = report.observations.find(item => item.assertion && item.assertion.id === 'scoped-level');
  assert.equal(scopedLevel.outcome, 'ALIGNED');
  assert.ok(scopedLevel.evidence[0].value <= -80);

  const temporal = report.observations.filter(item => item.family === 'temporal-behavior');
  assert.equal(temporal.length, 2);
  assert.match(temporal[0].interpretation, /may be deliberate/);
  assert.ok(temporal[1].evidence.find(item => item.metric === 'video.cut_count').value >= 1);

  const second = run(['judge', '--project', project, '--json']);
  assert.equal(second.status, 0, second.stderr);
  const secondEnvelope = machineResult(second);
  assert.deepEqual(secondEnvelope.data.judgement, report);
  assert.deepEqual(treeState(project), beforeState);
});

test('human judgement leads with evidence and preserves creator authority', { skip: !MEDIA_AVAILABLE }, () => {
  const result = run(['judge', '--project', project, '--video', 'out/video.mp4']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Narova Video CI — rendered-evidence mirror/);
  assert.match(result.stdout, /Creative authority: the creator decides/);
  assert.match(result.stdout, /No universal score, validity gate, hidden lens, or automatic repair/);
  assert.match(result.stdout, /Perception implementations:/);
  assert.match(result.stdout, /Source coverage:/);
  assert.match(result.stdout, /OBSERVATION 00:00\.0–00:00\.9/);
  assert.ok(result.stdout.indexOf('Evidence:') < result.stdout.indexOf('Interpretation:'));
  assert.doesNotMatch(result.stdout, /Video quality:\s*\d|BAD VIDEO|FIX THIS/);
});

test('judge rejects unavailable artifacts and repair without writes', { skip: !MEDIA_AVAILABLE }, () => {
  const beforeState = treeState(project);
  const missing = run(['judge', '--project', project, '--video', 'missing.mp4', '--json']);
  assert.equal(missing.status, 1);
  assert.equal(machineResult(missing).exit.class, 'operation-failure');

  const undecodable = run(['judge', '--project', project, '--video', 'out/invalid.mp4', '--json']);
  assert.equal(undecodable.status, 1);
  assert.equal(machineResult(undecodable).exit.class, 'operation-failure');

  const unavailableAnalyzer = run(['judge', '--project', project, '--json'], {
    env: { ...process.env, NAROVA_FIRST_RUN: '0', PATH: path.dirname(process.execPath) },
  });
  assert.equal(unavailableAnalyzer.status, 1);
  assert.equal(machineResult(unavailableAnalyzer).exit.class, 'operation-failure');

  const repair = run(['judge', '--project', project, '--repair', '--json']);
  assert.equal(repair.status, 2, repair.stderr);
  const envelope = machineResult(repair);
  assert.equal(envelope.exit.class, 'usage-error');
  assert.match(envelope.diagnostics[0].message, /requires --judge-assertion/);
  assert.deepEqual(treeState(project), beforeState);
});

test('intervention planning expands creative divergence without ranking or execution', () => {
  const judgement = {
    schema: 'narova.judgement/1',
    artifact: { path: '/tmp/proof.mp4', sha256: 'a'.repeat(64) },
    observations: [{
      id: 'intent-001', outcome: 'DIVERGED',
      timeRange: { start: 0, end: 8, scope: 'authored-global-time' },
      assertion: { id: 'uncomfortable-opening', class: 'creative-intent', expect: 'Hold an uncomfortable static opening.' },
      relatedProductionState: {
        scene: 'opening', source: { value: 'scenes/opening.html', basis: 'AUTHORED' },
        protected: ['silence', 'camera rhythm'], mappingBasis: 'AUTHORED', causality: 'not-established',
      },
    }, {
      id: 'intent-002', outcome: 'ALIGNED', timeRange: { start: 8, end: 9 },
      assertion: { id: 'transition', class: 'creative-intent', expect: 'Transition at eight seconds.' },
      relatedProductionState: {},
    }, {
      id: 'temporal-001', outcome: 'OBSERVED', timeRange: { start: 0, end: 8 },
      assertion: null, relatedProductionState: {},
    }],
  };
  const plan = interventionPlan(judgement);
  assert.equal(plan.schema, 'narova.intervention-plan/1');
  assert.equal(plan.authority, 'creator');
  assert.equal(plan.mutation, 'none');
  assert.equal(plan.selection, null);
  assert.equal(plan.optionSets.length, 1);
  assert.deepEqual(plan.optionSets[0].options.map(item => item.stance), [
    'keep-unchanged', 'align-to-intent', 'embrace-result', 'compare-branch',
  ]);
  assert.deepEqual(plan.optionSets[0].relatedProductionState.targets, [
    { kind: 'scene', value: 'opening', basis: 'AUTHORED' },
    { kind: 'source', value: 'scenes/opening.html', basis: 'AUTHORED' },
  ]);
  assert.deepEqual(plan.optionSets[0].relatedProductionState.protectedConcerns, ['silence', 'camera rhythm']);
  assert.ok(plan.optionSets[0].options.every(item => item.authority === 'creator-choice' && item.mutation === 'none'));
  assert.deepEqual(interventionPlan(judgement), plan);
  assert.doesNotMatch(JSON.stringify(plan), /recommended|preferred|ranking|score/i);
});

test('judge --plan returns the full judgement and deterministic plural options without writes', { skip: !MEDIA_AVAILABLE }, () => {
  const beforeState = treeState(project);
  const first = run(['judge', '--project', project, '--plan', '--json']);
  assert.equal(first.status, 0, first.stderr);
  const envelope = machineResult(first);
  assert.equal(envelope.data.judgement.schema, 'narova.judgement/1');
  const plan = envelope.data.interventionPlan;
  assert.equal(plan.schema, 'narova.intervention-plan/1');
  assert.equal(plan.selection, null);
  assert.ok(plan.optionSets.length >= 2);
  assert.ok(plan.optionSets.every(set => ['DIVERGED', 'UNCERTAIN'].includes(set.outcome)));
  assert.ok(plan.optionSets.every(set => set.options.length >= 3 && set.options[0].stance === 'keep-unchanged'));
  const silentMeaning = plan.optionSets.find(set => set.assertion.id === 'silent-opening');
  assert.ok(silentMeaning);
  assert.match(silentMeaning.observationId, /-semantic$/);
  assert.equal(silentMeaning.outcome, 'UNCERTAIN');
  assert.equal(plan.optionSets.some(set => set.observationId.startsWith('temporal-')), false);

  const mechanical = plan.optionSets.find(set => set.assertion.id === 'unexpected-audio');
  assert.deepEqual(mechanical.options.map(item => item.stance), [
    'keep-unchanged', 'inspect-source', 'align-to-intent', 'compare-branch',
  ]);
  assert.deepEqual(mechanical.relatedProductionState.protectedConcerns, ['camera rhythm']);
  assert.deepEqual(mechanical.relatedProductionState.targets, [
    { kind: 'scene', value: 'opening', basis: 'INFERRED_FROM_TIME' },
    { kind: 'source', value: 'scenes/opening.html', basis: 'AUTHORED' },
  ]);
  const uncertain = plan.optionSets.find(set => set.assertion.id === 'unreadable-material');
  assert.deepEqual(uncertain.options.map(item => item.stance), [
    'keep-unchanged', 'clarify-intent', 'gather-evidence', 'cheap-proof',
  ]);
  const creative = plan.optionSets.find(set => set.assertion.id === 'audible-discomfort');
  assert.deepEqual(creative.options.map(item => item.stance), [
    'keep-unchanged', 'align-to-intent', 'embrace-result', 'compare-branch',
  ]);
  assert.deepEqual(creative.relatedProductionState.protectedConcerns, ['static composition']);

  const second = run(['judge', '--project', project, '--plan', '--json']);
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(machineResult(second).data, envelope.data);
  assert.deepEqual(treeState(project), beforeState);
});

test('human judge planning follows evidence and states the agency boundary', { skip: !MEDIA_AVAILABLE }, () => {
  const result = run(['judge', '--project', project, '--plan']);
  assert.equal(result.status, 0, result.stderr);
  const judgementIndex = result.stdout.indexOf('Narova Video CI — rendered-evidence mirror');
  const planningIndex = result.stdout.indexOf('Narova Video CI — intervention options');
  assert.ok(judgementIndex >= 0 && planningIndex > judgementIndex);
  assert.match(result.stdout, /Options are unranked/);
  assert.match(result.stdout, /No option selected or executed/);
  assert.match(result.stdout, /Keep the rendered result unchanged/);
  assert.doesNotMatch(result.stdout, /recommended option|preferred option|best option/i);
});

test('malformed captions stay unavailable and a measured contradiction still diverges', { skip: !MEDIA_AVAILABLE }, () => {
  const fixture = makeProject(silentSceneConfig({
    assertions: [{
      id: 'mixed-evidence',
      class: 'mechanical',
      expect: 'The artifact should be silent and contain no caption words.',
      scope: { start: 0, end: 1 },
      observe: [
        { metric: 'audio.silence_ratio', operator: 'gte', value: 1 },
        { metric: 'caption.word_count', operator: 'eq', value: 0 },
      ],
    }],
  }));
  try {
    fs.writeFileSync(path.join(fixture.out, 'captions.vtt'), 'this is not a VTT document\n');
    const generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=1',
      '-map', '0:v', '-map', '1:a', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac',
      path.join(fixture.out, 'video.mp4'),
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    bindVideo(fixture.root, fixture.out);

    const result = run(['judge', '--project', fixture.root, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = machineResult(result).data.judgement;
    assert.equal(report.sources.captions.available, false);
    assert.equal(report.sources.captions.grade, 'INVALID');
    assert.match(report.sources.captions.reason, /WEBVTT/);
    const observation = report.observations.find(item => item.assertion && item.assertion.id === 'mixed-evidence');
    assert.equal(observation.outcome, 'DIVERGED');
    assert.equal(observation.evidence[0].value, 0);
    assert.equal(observation.evidence[1].availability, 'unavailable');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('audio measurements include timeline gaps and select the reported default stream', { skip: !MEDIA_AVAILABLE }, () => {
  const gap = makeProject(silentSceneConfig({
    scenes: [{ id: 'only', body: '<div>edge fixture</div>', vo: [], dur: 2 }],
    assertions: [{
      id: 'tail-silence', class: 'mechanical', expect: 'Most of the artifact is silent.',
      scope: { start: 0, end: 2 },
      observe: [{ metric: 'audio.silence_ratio', operator: 'gte', value: 0.7 }],
    }],
  }));
  const multi = makeProject(silentSceneConfig());
  try {
    let generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=2',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.5',
      '-map', '0:v', '-map', '1:a', '-t', '2', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac',
      path.join(gap.out, 'video.mp4'),
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    let report = machineResult(run(['judge', '--project', gap.root, '--json'])).data.judgement;
    const gapObservation = report.observations.find(item => item.assertion && item.assertion.id === 'tail-silence');
    assert.equal(gapObservation.outcome, 'ALIGNED');
    assert.ok(gapObservation.evidence[0].value >= 0.7, gapObservation.evidence[0].value);

    generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=1',
      '-filter_complex', '[2:a]pan=stereo|c0=c0|c1=c0[a2]',
      '-map', '0:v', '-map', '1:a', '-map', '[a2]',
      '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac',
      '-disposition:a:0', '0', '-disposition:a:1', 'default', '-shortest',
      path.join(multi.out, 'video.mp4'),
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    report = machineResult(run(['judge', '--project', multi.root, '--json'])).data.judgement;
    assert.equal(report.artifact.streams.audio.index, 2);
    assert.equal(report.artifact.streams.audio.channels, 2);
    const temporal = report.observations.find(item => item.family === 'temporal-behavior');
    assert.equal(temporal.evidence.find(item => item.metric === 'audio.silence_ratio').value, 0);
  } finally {
    fs.rmSync(gap.root, { recursive: true, force: true });
    fs.rmSync(multi.root, { recursive: true, force: true });
  }
});

test('embedded text captions are inspected and empty intent is explicit', { skip: !MEDIA_AVAILABLE }, () => {
  const embedded = makeProject(silentSceneConfig({
    assertions: [{
      id: 'embedded-words', class: 'accessibility', expect: 'Two caption words are encoded.',
      observe: [{ metric: 'caption.word_count', operator: 'eq', value: 2 }],
    }],
  }));
  const noIntent = makeProject(silentSceneConfig());
  try {
    const subtitle = path.join(embedded.root, 'input.srt');
    fs.writeFileSync(subtitle, '1\n00:00:00,100 --> 00:00:00,800\nHello there\n\n');
    const generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=1',
      '-i', subtitle, '-map', '0:v', '-map', '1:a', '-map', '2:s',
      '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-c:s', 'mov_text', '-shortest',
      path.join(embedded.out, 'video.mp4'),
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    let report = machineResult(run(['judge', '--project', embedded.root, '--json'])).data.judgement;
    assert.equal(report.sources.captions.available, true);
    assert.equal(report.sources.captions.source, 'embedded');
    const embeddedWords = report.observations.find(item => item.assertion && item.assertion.id === 'embedded-words');
    assert.equal(embeddedWords.outcome, 'ALIGNED');
    assert.equal(embeddedWords.relatedProductionState.scene, null);
    assert.equal(embeddedWords.relatedProductionState.mappingBasis, 'UNAVAILABLE');

    report = machineResult(run([
      'judge', '--project', noIntent.root, '--video', path.join(embedded.out, 'video.mp4'), '--json',
    ])).data.judgement;
    const intent = report.observations.find(item => item.family === 'intent-rendered-correspondence');
    assert.equal(intent.outcome, 'UNCERTAIN');
    assert.match(intent.observed, /No structured creative assertion/);
    assert.equal(report.families[0].observations, 1);
  } finally {
    fs.rmSync(embedded.root, { recursive: true, force: true });
    fs.rmSync(noIntent.root, { recursive: true, force: true });
  }
});

test('decoder corruption is an operation failure instead of confident partial evidence', { skip: !MEDIA_AVAILABLE }, () => {
  const fixture = makeProject(silentSceneConfig({
    scenes: [{ id: 'only', body: '<div>edge fixture</div>', vo: [], dur: 3 }],
  }));
  try {
    const target = path.join(fixture.out, 'video.mp4');
    const generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=3',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=3',
      '-map', '0:v', '-map', '1:a', '-c:v', 'mpeg4', '-q:v', '4', '-g', '30',
      '-c:a', 'aac', '-movflags', '+faststart', target,
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const bytes = fs.readFileSync(target);
    const mediaStart = bytes.indexOf(Buffer.from('mdat')) + 4;
    assert.ok(mediaStart > 4);
    const middle = mediaStart + Math.floor((bytes.length - mediaStart) / 2);
    for (let index = middle; index < Math.min(bytes.length, middle + 4000); index++) bytes[index] ^= 0xff;
    fs.writeFileSync(target, bytes);

    const result = run(['judge', '--project', fixture.root, '--json']);
    assert.equal(result.status, 1, result.stderr);
    const envelope = machineResult(result);
    assert.equal(envelope.exit.class, 'operation-failure');
    assert.match(envelope.diagnostics[0].message, /analysis exited|Invalid data|Error/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('indirect playlists and attached artwork cannot masquerade as bound video artifacts', { skip: !MEDIA_AVAILABLE }, () => {
  const fixture = makeProject(silentSceneConfig());
  try {
    const segment = path.join(fixture.out, 'segment.ts');
    let generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=1',
      '-c:v', 'mpeg2video', '-f', 'mpegts', segment,
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const playlist = path.join(fixture.out, 'video.m3u8');
    fs.writeFileSync(playlist, '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXTINF:1.0,\nsegment.ts\n#EXT-X-ENDLIST\n');
    let result = run(['judge', '--project', fixture.root, '--video', 'out/video.m3u8', '--json']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(machineResult(result).diagnostics[0].message, /self-contained/);

    const audio = path.join(fixture.root, 'audio.mp3');
    const cover = path.join(fixture.root, 'cover.jpg');
    const artwork = path.join(fixture.out, 'artwork.mp3');
    generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:a', 'libmp3lame', audio,
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90', '-frames:v', '1', cover,
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error', '-i', audio, '-i', cover, '-map', '0:a', '-map', '1:v',
      '-c', 'copy', '-id3v2_version', '3', '-metadata:s:v', 'title=Album cover',
      '-metadata:s:v', 'comment=Cover (front)', artwork,
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    result = run(['judge', '--project', fixture.root, '--video', 'out/artwork.mp3', '--json']);
    assert.equal(result.status, 1, result.stderr);
    assert.match(machineResult(result).diagnostics[0].message, /no decodable video stream/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('video stream offsets and incomplete assertion scopes preserve artifact time and uncertainty', { skip: !MEDIA_AVAILABLE }, () => {
  const fixture = makeProject(silentSceneConfig({
    scenes: [
      { id: 'before', body: '<div>before</div>', vo: [], dur: 1 },
      { id: 'during', body: '<div>during</div>', vo: [], dur: 1 },
    ],
    assertions: [
      {
        id: 'pre-video', class: 'mechanical', expect: 'No selected video frames exist yet.',
        scope: { start: 0, end: 0.9 },
        observe: [{ metric: 'video.black_ratio', operator: 'eq', value: 1 }],
      },
      {
        id: 'partial-red', class: 'mechanical', expect: 'The requested three-second range is red.',
        scope: { start: 1, end: 3 },
        observe: [{ metric: 'video.black_ratio', operator: 'eq', value: 0 }],
      },
      {
        id: 'container-full', class: 'mechanical', expect: 'The selected video covers the full container.',
        scope: { start: 0, end: 2 },
        observe: [{ metric: 'video.black_ratio', operator: 'eq', value: 0 }],
      },
    ],
  }));
  try {
    const generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=2',
      '-itsoffset', '1', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=1',
      '-map', '1:v', '-map', '0:a', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac',
      path.join(fixture.out, 'video.mp4'),
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const report = machineResult(run(['judge', '--project', fixture.root, '--json'])).data.judgement;
    assert.equal(report.artifact.streams.video.timelineOffset, 1);
    const pre = report.observations.find(item => item.assertion && item.assertion.id === 'pre-video');
    assert.equal(pre.outcome, 'UNCERTAIN');
    assert.equal(pre.evidence[0].availability, 'unavailable');
    const partial = report.observations.find(item => item.assertion && item.assertion.id === 'partial-red');
    assert.equal(partial.outcome, 'UNCERTAIN');
    assert.deepEqual(partial.timeRange, { start: 1, end: 3, scope: 'authored-global-time' });
    assert.deepEqual(partial.scopeCoverage, {
      status: 'partial', measuredRange: { start: 1, end: 2 },
    });
    assert.equal(partial.evidence[0].value, 0);
    assert.equal(partial.evidence[0].availability, 'partial');
    assert.equal(partial.relatedProductionState.scene, null);
    assert.equal(partial.relatedProductionState.mappingBasis, 'UNAVAILABLE');
    const containerFull = report.observations.find(item => item.assertion && item.assertion.id === 'container-full');
    assert.equal(containerFull.outcome, 'UNCERTAIN');
    assert.deepEqual(containerFull.scopeCoverage, {
      status: 'partial', measuredRange: { start: 1, end: 2 },
    });
    assert.equal(containerFull.evidence[0].value, 0);
    assert.equal(containerFull.evidence[0].availability, 'partial');
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('bound context survives shared-output replacement and malformed alternatives remain visible', { skip: !MEDIA_AVAILABLE }, () => {
  const fixture = makeProject(silentSceneConfig({
    assertions: [{
      id: 'bound-words', class: 'accessibility', expect: 'The bound captions contain two words.',
      observe: [{ metric: 'caption.word_count', operator: 'eq', value: 2 }],
    }],
  }));
  try {
    const target = path.join(fixture.out, 'video.mp4');
    const generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1', '-map', '0:v', '-map', '1:a',
      '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', target,
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    fs.writeFileSync(path.join(fixture.out, 'captions.vtt'), 'WEBVTT\n\n00:00:00,100 --> 00:00:00,800\nMalformed format\n\n');
    fs.writeFileSync(path.join(fixture.out, 'captions.srt'), '1\n00:00:00,100 --> 00:00:00,800\nRight words\n\n');
    fs.writeFileSync(path.join(fixture.out, 'manifest.json'), `${JSON.stringify({
      scenes: [{ id: 'only', start: 0, duration: 1 }],
    })}\n`);
    const bindingPath = bindVideo(fixture.root, fixture.out);
    fs.writeFileSync(path.join(fixture.out, 'captions.srt'), '1\n00:00:00,100 --> 00:00:00,800\nWrong replacement words\n\n');
    fs.writeFileSync(path.join(fixture.out, 'manifest.json'), `${JSON.stringify({
      scenes: [{ id: 'wrong', start: 0, duration: 9 }],
    })}\n`);

    let result = run(['judge', '--project', fixture.root, '--json']);
    assert.equal(result.status, 0, result.stderr);
    let report = machineResult(result).data.judgement;
    assert.equal(report.sources.evidenceBinding.used, true);
    assert.equal(report.sources.captions.source, 'bound-sidecar-snapshot');
    assert.match(report.sources.captions.path, new RegExp(`${path.basename(bindingPath).replace('.', '\\.')}`));
    assert.equal(report.sources.captions.alternatives.length, 1);
    assert.match(report.sources.captions.alternatives[0].reason, /malformed/);
    assert.equal(report.observations.find(item => item.assertion && item.assertion.id === 'bound-words').outcome, 'ALIGNED');
    assert.equal(report.sources.resolvedConfig.path, fs.realpathSync(path.join(fixture.root, 'reel.config.json')));
    assert.match(report.sources.resolvedConfig.sha256, /^[a-f0-9]{64}$/);
    assert.match(report.sources.resolvedConfig.effectiveSha256, /^[a-f0-9]{64}$/);

    const canonicalBinding = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
    const alternateBinding = structuredClone(canonicalBinding);
    alternateBinding.context.manifest.value = alternateBinding.context.manifest.content;
    delete alternateBinding.context.manifest.content;
    fs.writeFileSync(bindingPath, `${JSON.stringify(alternateBinding, null, 2)}\n`);
    report = machineResult(run(['judge', '--project', fixture.root, '--json'])).data.judgement;
    assert.equal(report.sources.evidenceBinding.used, false);
    assert.equal(report.sources.evidenceBinding.grade, 'INVALID');
    assert.match(report.sources.evidenceBinding.reason, /unsupported field: value/);
    fs.writeFileSync(bindingPath, `${JSON.stringify(canonicalBinding, null, 2)}\n`);

    result = run(['judge', '--project', fixture.root]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /rejected\/alternate:.*one or more caption timestamps are malformed/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('large timing mismatches are not rescaled and the default embedded subtitle is canonical', { skip: !MEDIA_AVAILABLE }, () => {
  const truncated = makeProject(silentSceneConfig({
    scenes: [
      { id: 'first', body: '<div>first</div>', vo: [], dur: 1 },
      { id: 'missing', body: '<div>missing</div>', vo: [], dur: 1 },
    ],
    assertions: [{
      id: 'missing-scene', class: 'mechanical', expect: 'The missing scene is black.', scope: { scene: 'missing' },
      observe: [{ metric: 'video.black_ratio', operator: 'eq', value: 1 }],
    }],
  }));
  const subtitles = makeProject(silentSceneConfig({
    assertions: [{
      id: 'default-words', class: 'accessibility', expect: 'Default captions contain two words.',
      observe: [{ metric: 'caption.word_count', operator: 'eq', value: 2 }],
    }],
  }));
  try {
    let generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=1',
      '-c:v', 'mpeg4', '-q:v', '5', path.join(truncated.out, 'video.mp4'),
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    fs.writeFileSync(path.join(truncated.out, 'manifest.json'), `${JSON.stringify({
      scenes: [{ id: 'first', start: 0, duration: 1 }],
    })}\n`);
    bindVideo(truncated.root, truncated.out);
    let report = machineResult(run(['judge', '--project', truncated.root, '--json'])).data.judgement;
    const missing = report.observations.find(item => item.assertion && item.assertion.id === 'missing-scene');
    assert.equal(missing.outcome, 'UNCERTAIN');
    assert.deepEqual(missing.timeRange, { start: null, end: null, scope: 'unavailable-scene-scope' });
    assert.equal(missing.scopeCoverage.status, 'unavailable');

    const wrong = path.join(subtitles.root, 'wrong.srt');
    const right = path.join(subtitles.root, 'right.srt');
    fs.writeFileSync(wrong, '1\n00:00:00,100 --> 00:00:00,800\nWrong\n\n');
    fs.writeFileSync(right, '1\n00:00:00,100 --> 00:00:00,800\nRight words\n\n');
    generated = spawnSync('ffmpeg', [
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=1',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1', '-i', wrong, '-i', right,
      '-map', '0:v', '-map', '1:a', '-map', '2:s', '-map', '3:s',
      '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'aac', '-c:s', 'mov_text',
      '-disposition:s:0', '0', '-disposition:s:1', 'default', '-shortest',
      path.join(subtitles.out, 'video.mp4'),
    ], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    report = machineResult(run(['judge', '--project', subtitles.root, '--json'])).data.judgement;
    assert.equal(report.sources.captions.path.endsWith('#stream-3'), true);
    assert.equal(report.observations.find(item => item.assertion && item.assertion.id === 'default-words').outcome, 'ALIGNED');

    const unsupportedDefault = captionEvidence(subtitles.out, {
      ...report.artifact,
      streams: {
        ...report.artifact.streams,
        subtitles: [
          { index: 0, codec: 'dvd_subtitle', default: true },
          { index: 3, codec: 'mov_text', default: false },
        ],
      },
    }, null);
    assert.equal(unsupportedDefault.available, false);
    assert.equal(unsupportedDefault.path.endsWith('#stream-0'), true);
    assert.equal(unsupportedDefault.alternatives.length, 1);
    assert.equal(unsupportedDefault.alternatives[0].available, true);
    assert.equal(unsupportedDefault.alternatives[0].path.endsWith('#stream-3'), true);
  } finally {
    fs.rmSync(truncated.root, { recursive: true, force: true });
    fs.rmSync(subtitles.root, { recursive: true, force: true });
  }
});
