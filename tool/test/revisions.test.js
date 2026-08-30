'use strict';
/* CHANGE-2026-026 — revision impact and history: recording-side conformance
 * tests (TASK-2026-026-001).
 *
 *   NAR-009-025  revision recording: state-change append, no-change
 *                suppression, restart on ledger loss, advisory failure
 *                posture, variant suppression.
 *   NAR-007-036  realized-reuse evidence: per-scene digest byte-identity,
 *                span reuse/rendered/fallback classification, sentence-cache
 *                counts, rebuilt-by-design, not-applicable handling.
 *   NAR-007-037  every ratio states basis and unit; unevidenced quantities
 *                are null, never invented.
 * All advisory: no gate consumes the ledger; nothing here fails a build. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rev = require('../src/revisions');
const { compile, mergeTimings } = require('../src/manifest');
const { resolveConfig } = require('../src/schema');
const { build } = require('../src/pipeline');

test('revision manifest identity ignores additive toolchain-version evidence', () => {
  const base = {
    project: { title: 'same' },
    renderer: { provider: 'hyperframes', providerVersion: 'renderer-1' },
    environment: { backend: 'piper', backendVersion: 'speech-1' },
    scenes: [],
  };
  const changedVersions = JSON.parse(JSON.stringify(base));
  changedVersions.renderer.providerVersion = 'renderer-2';
  changedVersions.environment.backendVersion = 'speech-2';
  assert.equal(rev.manifestIdentity(base), rev.manifestIdentity(changedVersions));
  changedVersions.renderer.provider = 'no-browser';
  assert.notEqual(rev.manifestIdentity(base), rev.manifestIdentity(changedVersions));
});

test('post-synthesis manifest identity ignores the volatile synth timestamp', () => {
  const base = { stages: { synth: '2026-08-30T10:00:00.000Z' }, scenes: [{ id: 's', duration: 1 }] };
  const later = { stages: { synth: '2026-08-30T11:00:00.000Z' }, scenes: [{ id: 's', duration: 1 }] };
  assert.equal(rev.manifestIdentity(base), rev.manifestIdentity(later));
  later.scenes[0].duration = 1.1;
  assert.notEqual(rev.manifestIdentity(base), rev.manifestIdentity(later));
});

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;
let HAS_CANVAS = false;
try { require.resolve('@napi-rs/canvas'); HAS_CANVAS = true; } catch {}
const CAN_RENDER = HAS_FFMPEG && HAS_CANVAS;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'narova-revisions-'));

function projectConfig(overrides = {}) {
  return resolveConfig({
    title: 'Revisions',
    size: '16:9',
    voices: { a: { label: 'A', color: '#0ff', backend: 'piper', speaker: 'x' } },
    scenes: [
      { id: 's1', vo: [{ who: 'a', text: 'One.' }], body: '<p>1</p>' },
      { id: 's2', vo: [{ who: 'a', text: 'Two.' }], body: '<p>2</p>' },
    ],
    ...overrides,
  }, {}, os.tmpdir());
}

/* ---- NAR-009-025: state identity ------------------------------------------ */

test('identical authored state yields the identical state identity (volatile timestamps excluded)', () => {
  const cfg = projectConfig();
  // compile() stamps project.created / environment.compiled with the current
  // time; identity MUST ignore them.
  const a = rev.stateIdentity(cfg, {});
  const b = rev.stateIdentity(JSON.parse(JSON.stringify(cfg)), {});
  assert.equal(a, b);
});

test('an authored edit, renderer choice, backend, fps, or quality change flips the identity', () => {
  const base = rev.stateIdentity(projectConfig(), {});
  const editedText = projectConfig();
  editedText.scenes[1].vo[0].text = 'Two, improved.';
  assert.notEqual(rev.stateIdentity(editedText, {}), base);
  const editedBody = projectConfig();
  editedBody.scenes[0].body = '<p>1b</p>';
  assert.notEqual(rev.stateIdentity(editedBody, {}), base);
  assert.notEqual(rev.stateIdentity(projectConfig(), { renderer: 'no-browser' }), base);
  assert.notEqual(rev.stateIdentity(projectConfig(), { backend: 'qwen' }), base);
  assert.notEqual(rev.stateIdentity(projectConfig(), { fps: 60 }), base);
  assert.notEqual(rev.stateIdentity(projectConfig(), { quality: 'draft' }), base);
});

test('state identity is authored, not artifact bytes: changed audio alone records no revision', () => {
  const dir = tmp();
  const cfg = projectConfig();
  const fakeManifest = { scenes: [{ id: 's1', hash: 'h1', duration: 1 }, { id: 's2', hash: 'h2', duration: 1 }] };
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio', '01.wav'), 'wav-bytes-v1');
  fs.writeFileSync(path.join(dir, 'audio', '02.wav'), 'wav-bytes-v1');
  const first = rev.recordRevision({ config: cfg, opts: {}, outDir: dir, manifest: fakeManifest, log: () => {} });
  assert.equal(first.recorded, true);
  assert.equal(first.ordinal, 1);
  // Audio bytes change on disk with NO authored change: identity unchanged.
  fs.writeFileSync(path.join(dir, 'audio', '01.wav'), 'wav-bytes-v2');
  const second = rev.recordRevision({ config: cfg, opts: {}, outDir: dir, manifest: fakeManifest, log: () => {} });
  assert.equal(second.recorded, false);
  assert.equal(second.ordinal, 1);
  assert.equal(rev.readLedger(dir).length, 1);
});

/* ---- NAR-009-025: ledger lifecycle ----------------------------------------- */

test('first revision has no parent; subsequent revisions chain to the previous ordinal', () => {
  const dir = tmp();
  const manifest = { scenes: [{ id: 's1', hash: 'h1', duration: 1 }] };
  const cfgA = projectConfig();
  const r1 = rev.recordRevision({ config: cfgA, outDir: dir, manifest, log: () => {} });
  assert.equal(r1.record.parent, null);
  const cfgB = projectConfig();
  cfgB.scenes[0].body = '<p>changed</p>';
  const r2 = rev.recordRevision({ config: cfgB, outDir: dir, manifest, log: () => {} });
  assert.equal(r2.recorded, true);
  assert.equal(r2.ordinal, 2);
  assert.equal(r2.record.parent, 1);
  assert.equal(rev.readLedger(dir).length, 2);
});

test('ledger deletion restarts history at v1 and never fails', () => {
  const dir = tmp();
  const manifest = { scenes: [{ id: 's1', hash: 'h1', duration: 1 }] };
  rev.recordRevision({ config: projectConfig(), outDir: dir, manifest, log: () => {} });
  fs.rmSync(path.join(dir, 'revisions.jsonl'));
  const r = rev.recordRevision({ config: projectConfig(), outDir: dir, manifest, log: () => {} });
  assert.equal(r.recorded, true);
  assert.equal(r.ordinal, 1);
  assert.equal(r.record.parent, null);
});

test('a corrupt trailing ledger line is ignored up to the last parseable record', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'revisions.jsonl'),
    JSON.stringify({ v: 1, ordinal: 1, stateIdentity: 'a' }) + '\n{"broken..."');
  const records = rev.readLedger(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].ordinal, 1);
});

test('an unwritable ledger is reported and never throws (advisory)', () => {
  const dir = tmp();
  const manifest = { scenes: [{ id: 's1', hash: 'h1', duration: 1 }] };
  // Normal path succeeds first.
  const ok = rev.recordRevision({ config: projectConfig(), outDir: dir, manifest, log: () => {} });
  assert.equal(ok.recorded, true);
  // Make the ledger read-only: the next append must be reported, not thrown.
  const file = path.join(dir, 'revisions.jsonl');
  fs.chmodSync(file, 0o444);
  if (process.platform !== 'win32' && process.getuid && process.getuid() !== 0) {
    const logs = [];
    let r;
    assert.doesNotThrow(() => {
      const cfg = projectConfig();
      cfg.scenes[0].body = '<p>edited</p>';
      r = rev.recordRevision({ config: cfg, outDir: dir, manifest, log: m => logs.push(m) });
    });
    assert.equal(r.recorded, false);
    assert.ok(r.error);
    assert.ok(logs.some(l => l.includes('build result is unaffected')));
  }
});

test('variant builds never record revisions', () => {
  const dir = tmp();
  const manifest = { scenes: [{ id: 's1', hash: 'h1', duration: 1 }] };
  const variantCfg = projectConfig();
  variantCfg.variant = 'hook';
  const r = rev.recordRevision({ config: variantCfg, outDir: dir, manifest, log: () => {} });
  assert.equal(r.recorded, false);
  assert.equal(r.variant, true);
  assert.equal(rev.readLedger(dir).length, 0);
});

/* ---- NAR-007-036 / NAR-007-037: measured reuse record ---------------------- */

test('per-scene audio byte-identity is established by digest against the parent record', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio', '01.wav'), 'aaa');
  fs.writeFileSync(path.join(dir, 'audio', '02.wav'), 'bbb');
  fs.writeFileSync(path.join(dir, 'audio', '03.wav'), 'ccc');
  const manifest = {
    scenes: [
      { id: 's1', hash: 'h1', duration: 2 },
      { id: 's2', hash: 'h2', duration: 2 },
      { id: 's3', hash: 'h3', duration: 4 },
    ],
  };
  const previous = { sceneAudio: rev.sceneAudioDigests(dir, manifest.scenes) };
  // Narration-only edit semantics: scene 2's audio regenerated, others kept.
  fs.writeFileSync(path.join(dir, 'audio', '02.wav'), 'bbb-changed');
  const m = rev.measuredReuseRecord({ outDir: dir, manifest, previous, renderReuse: null });
  assert.equal(m.basis, 'measured');
  assert.equal(m.audio.unit, 'duration-weighted scene audio');
  assert.equal(m.audio.scenesIdentical, 2);
  assert.equal(m.audio.scenesEvidenced, 3);
  assert.equal(m.audio.identicalSeconds, 6);
  assert.equal(m.audio.evidencedSeconds, 8);
  assert.equal(m.audio.ratio, 0.75);
  // Per-scene digests carry the byte facts.
  const digests = rev.sceneAudioDigests(dir, manifest.scenes);
  assert.equal(digests.s1, previous.sceneAudio.s1);
  assert.notEqual(digests.s2, previous.sceneAudio.s2);
  // Spans were not used on this path: not applicable, not a number.
  assert.equal(m.spans.note.includes('not applicable'), true);
});

test('missing per-scene audio (external narration / silent) is not applicable, not a number', () => {
  const dir = tmp(); // no audio dir at all
  const manifest = { scenes: [{ id: 's1', hash: 'h1', duration: 2 }] };
  const m = rev.measuredReuseRecord({ outDir: dir, manifest, previous: null, renderReuse: null });
  assert.equal(m.audio.ratio, null);
  assert.ok(m.audio.note.includes('not applicable'));
  assert.equal(m.sentences, null);
});

test('sentence-cache counts come from take evidence; absent evidence is null', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio', 'takes.json'), JSON.stringify([
    { cacheHit: true }, { cacheHit: false }, { cacheHit: true },
  ]));
  const counts = rev.sentenceCacheCounts(dir);
  assert.deepEqual(counts, { hits: 2, fresh: 1, total: 3, basis: 'measured', unit: 'sentence count' });
  const empty = rev.sentenceCacheCounts(tmp());
  assert.equal(empty, null);
});

test('fallback re-renders are classified as fallback and never counted as reuse', () => {
  const dir = tmp();
  const manifest = { scenes: [{ id: 's1', hash: 'h1', duration: 2 }] };
  const renderReuse = {
    mode: 'per-scene',
    fallback: 'per-scene render failed: boom',
    selectiveSkipped: null,
    spans: [{ sceneId: 's1', status: 'fallback', seconds: 2 }],
  };
  const m = rev.measuredReuseRecord({ outDir: dir, manifest, previous: null, renderReuse });
  assert.equal(m.spans.perScene[0].status, 'fallback');
  assert.equal(m.spans.reusedCount, 0);
  assert.equal(m.spans.fallback, 'per-scene render failed: boom');
});

test('rebuilt-by-design artifacts are named, not counted as reuse or misses', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'audio', 'full.wav'), 'f');
  fs.writeFileSync(path.join(dir, 'audio', 'mix.wav'), 'm');
  const m = rev.measuredReuseRecord({
    outDir: dir, manifest: { scenes: [] }, previous: null,
    renderReuse: null, deliverableCount: 2, videoName: 'video.mp4',
  });
  const names = m.rebuiltByDesign.join(' | ');
  assert.ok(names.includes('video.mp4'));
  assert.ok(names.includes('full.wav'));
  assert.ok(names.includes('mix.wav'));
  assert.ok(names.includes('2 delivery member'));
});

test('measured reuse records performed and reused delivery execution separately', () => {
  const m = rev.measuredReuseRecord({
    outDir: tmp(), manifest: { scenes: [] }, previous: null, renderReuse: null,
    deliverableCount: 3,
    deliveryExecution: [
      { id: 'narova-standard', execution: {
        source: { status: 'performed', from: null }, encode: { status: 'performed', from: null },
      } },
      { id: 'reels-1080p', execution: {
        source: { status: 'reused', from: 'narova-standard' }, encode: { status: 'performed', from: null },
      } },
      { id: 'shorts-1080p', execution: {
        source: { status: 'reused', from: 'narova-standard' }, encode: { status: 'reused', from: 'reels-1080p' },
      } },
    ],
  });
  assert.equal(m.delivery.sourceRendersPerformed, 1);
  assert.equal(m.delivery.sourceRendersReused, 2);
  assert.equal(m.delivery.encodesPerformed, 2);
  assert.equal(m.delivery.encodesReused, 1);
  assert.match(rev.formatMeasuredSummary(m), /delivery source renders 1 performed\/2 reused/);
});

test('record contents carry every NAR-009-025 field', () => {
  const dir = tmp();
  const cfg = projectConfig();
  const enrichedScenes = cfg.scenes.map((s, i) => ({ id: s.id, hash: 'h' + i, duration: 1.5 }));
  const r = rev.recordRevision({
    config: cfg, opts: { renderer: 'hyperframes' }, outDir: dir,
    manifest: { scenes: enrichedScenes, format: { fps: 30 } },
    stageDurations: { synth: 1.2, composeAndRender: 3.4 }, log: () => {},
  });
  const rec = r.record;
  assert.equal(rec.ordinal, 1);
  assert.equal(rec.parent, null);
  assert.ok(rec.stateIdentity.length === 64);
  assert.ok(rec.audioFingerprint.length === 64);
  assert.ok(rec.timingsFingerprint.length === 64);
  assert.ok(rec.manifestIdentity.length === 64);
  assert.ok(rec.renderContextIdentity.length === 64);
  assert.deepEqual(rec.sceneIdentities, [
    { id: 's1', digest: 'h0', narration: rev.narrationDigest({ vo: [] }), silentDur: null, minDur: null, duration: 1.5, sentences: null },
    { id: 's2', digest: 'h1', narration: rev.narrationDigest({ vo: [] }), silentDur: null, minDur: null, duration: 1.5, sentences: null },
  ]);
  assert.deepEqual(rec.stageDurations, { synth: 1.2, composeAndRender: 3.4 });
  assert.ok(rec.measuredReuse);
  assert.equal(rec.label, null);
});

/* ---- NAR-007-035 / NAR-009-026..027: revision-impact report ----------------- */

function rec(ordinal, scenes, extra = {}) {
  return {
    ordinal,
    parent: ordinal > 1 ? ordinal - 1 : null,
    renderContextIdentity: 'ctx-A',
    narrationContext: 'nc-A',
    sceneIdentities: scenes,
    stageDurations: { synth: 1, composeAndRender: 10 },
    ...extra,
  };
}
const scene = (id, o = {}) => ({
  id, digest: o.digest || `d-${id}`, narration: o.narration || `n-${id}`,
  silentDur: o.silentDur ?? null, duration: o.duration ?? 2, sentences: o.sentences ?? 3,
});

test('classification: narration vs visual vs timing vs added/removed/reordered', () => {
  const before = [scene('s1'), scene('s2'), scene('s3'), scene('s4'), scene('s5', { silentDur: 3 })];
  const after = [
    scene('s1'),                                       // unchanged
    scene('s2', { narration: 'n-s2-edited' }),          // script changed
    scene('s3', { digest: 'd-s3-edited' }),             // visual changed
    scene('s5', { silentDur: 5 }),                      // silent duration changed
    scene('s6'),                                        // added
  ];
  const rows = rev.buildRevisionReport({ currentScenes: after, currentContextIdentity: 'ctx-A', baselineRecord: rec(1, before) }).rows;
  const cls = Object.fromEntries(rows.map(r => [r.sceneId, r]));
  assert.equal(cls.s1.cls, 'unchanged');
  assert.equal(cls.s2.cls, 'narration');
  assert.equal(cls.s3.cls, 'visual');
  assert.equal(cls.s5.cls, 'timing'); // narration equal, silentDur differs from null
  assert.equal(cls.s6.cls, 'structural');
  assert.equal(cls.s6.reason, 'added');
  assert.equal(cls.s4.cls, 'structural');
  assert.equal(cls.s4.reason, 'removed');

  // Reorder: same ids, different order -> structural (reordered)
  const reordered = [scene('s2'), scene('s1')];
  const rows2 = rev.buildRevisionReport({ currentScenes: reordered, currentContextIdentity: 'ctx-A', baselineRecord: rec(1, [scene('s1'), scene('s2')]) }).rows;
  assert.ok(rows2.every(r => r.cls === 'structural' && r.reason === 'reordered'));
});

test('classification: minDur-only edits are timing changes with a downstream cascade', () => {
  const before = [{ id: 's1', digest: 'same', narration: 'same', silentDur: null, minDur: null }];
  const after = [{ ...before[0], minDur: 8 }];
  const rows = rev.classifyScenes(after, before);
  assert.deepEqual(rows, [{ sceneId: 's1', cls: 'timing', reason: 'minDur changed' }]);
  assert.ok(rev.derivedImpacts(rows[0]).includes('timeline re-chained'));
});

test('render-context change is one project line, never N per-scene changes', () => {
  const before = [scene('s1'), scene('s2')];
  const report = rev.buildRevisionReport({
    currentScenes: before, currentContextIdentity: 'ctx-B', baselineRecord: rec(1, before, { renderContextIdentity: 'ctx-A' }),
  });
  assert.ok(report.contextChanged);
  assert.ok(report.rows.every(r => r.cls === 'unchanged'));
  assert.equal(report.reuse.spans.keep, 0); // all spans re-render
  // The formatter states the project line separately.
  const text = rev.formatRevisionImpact(report);
  assert.ok(text.includes('shared render context changed'));
  assert.ok(!/visual changed/.test(text));
});

test('predicted reuse numbers are reproducible from the per-scene rows and state basis+unit', () => {
  const before = [
    scene('s1', { duration: 4, sentences: 5 }),
    scene('s2', { duration: 4, sentences: 5 }),
    scene('s3', { duration: 4, sentences: 5 }),
    scene('s4', { duration: 4, sentences: 5 }),
  ];
  const after = [scene('s1'), scene('s2', { narration: 'n2b' }), scene('s3'), scene('s4')];
  const report = rev.buildRevisionReport({ currentScenes: after, currentContextIdentity: 'ctx-A', baselineRecord: rec(1, before) });
  const { audio, spans, sentences } = report.reuse;
  assert.equal(audio.basis, 'predicted');
  assert.equal(audio.unit, 'duration-weighted scene audio');
  assert.equal(audio.scenesKeep, 3);      // rows s1,s3,s4 non-narration
  assert.equal(audio.scenesTotal, 4);
  assert.equal(audio.keepSeconds, 12);    // 3 x 4s
  assert.equal(audio.ratio, 0.75);        // recomputable: 12/16
  assert.equal(spans.unit, 'scene span count');
  assert.equal(spans.keep, 1);          // only s1 precedes the duration-changing edit
  assert.ok(spans.note.includes('start-time shift'));
  assert.equal(sentences.unit, 'sentence count');
  assert.equal(sentences.keep, 15);
  assert.equal(sentences.total, 20);
});

test('estimate derives from recorded measured durations or is omitted with a plain statement', () => {
  const before = [scene('s1'), scene('s2')];
  const after = [scene('s1'), scene('s2', { narration: 'n2b' })];
  const withBasis = rev.buildRevisionReport({ currentScenes: after, currentContextIdentity: 'ctx-A', baselineRecord: rec(1, before) });
  assert.ok(withBasis.estimate.estimate != null);
  assert.ok(withBasis.estimate.note.includes('estimate'));
  const noBasis = rev.buildRevisionReport({
    currentScenes: after, currentContextIdentity: 'ctx-A',
    baselineRecord: rec(1, before, { stageDurations: null }),
  });
  assert.equal(noBasis.estimate.estimate, null);
  assert.ok(rev.formatRevisionImpact(noBasis).includes('omitted'));
});

test('two recorded revisions classify from the records alone (no project state needed)', () => {
  const v1 = rec(1, [scene('s1'), scene('s2', { narration: 'n2a' })]);
  const v3 = rec(3, [scene('s1'), scene('s2', { narration: 'n2c', digest: 'd2c' })], { parent: 2 });
  const report = rev.buildRevisionReport({ baselineRecord: v1, afterRecord: v3 });
  const cls = Object.fromEntries(report.rows.map(r => [r.sceneId, r.cls]));
  assert.equal(cls.s1, 'unchanged');
  assert.equal(cls.s2, 'narration'); // narration digest wins over visual
  assert.ok(rev.formatRevisionImpact(report).includes('vs v1, v3 after'));
});

test('project-level narration identity change (tempo/voice) zeroes predicted audio reuse honestly', () => {
  const before = [scene('s1', { duration: 4, sentences: 3 }), scene('s2', { duration: 4, sentences: 3 })];
  // Tempo-only edit: no scene content changed, but the shared context did.
  const report = rev.buildRevisionReport({
    currentScenes: before, currentContextIdentity: 'ctx-A',
    baselineRecord: rec(1, before), audioIdentityChanged: true,
  });
  assert.ok(report.rows.every(r => r.cls === 'unchanged'));
  assert.ok(report.audioIdentityChanged);
  assert.equal(report.reuse.audio.ratio, 0);
  assert.ok(report.reuse.audio.note.includes('re-synthesizes'));
  assert.equal(report.reuse.sentences.keep, 0);
  const text = rev.formatRevisionImpact(report);
  assert.ok(text.includes('narration identity changed'));
});

test('narrationContextDigest: a turn edit leaves the shared context stable; a tempo/voice edit flips it', () => {
  const { narrationContextDigest, audioFingerprint } = require('../src/audio-fingerprint');
  const base = projectConfig();
  const ctxBase = narrationContextDigest(base);
  const fpBase = audioFingerprint(base);
  // Turn-text edit: full fingerprint flips, shared context does not.
  const edited = projectConfig();
  edited.scenes[1].vo[0].text = 'Two, improved.';
  assert.notEqual(audioFingerprint(edited), fpBase);
  assert.equal(narrationContextDigest(edited), ctxBase);
  // Tempo edit: both flip.
  const tempo = projectConfig();
  tempo.timing.tempo = 1.3;
  assert.notEqual(narrationContextDigest(tempo), ctxBase);
  // Voice speaker edit: both flip.
  const voice = projectConfig();
  voice.voices.a.speaker = 'other';
  assert.notEqual(narrationContextDigest(voice), ctxBase);
});

test('history summary names narration-identity-only changes', () => {
  const v1 = rec(1, [scene('s1')], { narrationContext: 'nc-a' });
  const v2 = rec(2, [scene('s1')], { narrationContext: 'nc-b' });
  assert.equal(rev.changeSummaryForRecord(v2, v1), 'narration identity change only');
  // A turn edit alone (fingerprint changed, context same) is NOT an identity note.
  const v3 = rec(3, [scene('s1', { narration: 'n1-edited' })], { narrationContext: 'nc-b' });
  assert.equal(rev.changeSummaryForRecord(v3, v2), '1 narration scene change');
});

test('change summary for history rows names the change classes', () => {
  const v1 = rec(1, [scene('s1'), scene('s2')]);
  assert.equal(rev.changeSummaryForRecord(v1, null), 'initial revision');
  const v2 = rec(2, [scene('s1'), scene('s2', { narration: 'n2b' })]);
  assert.ok(rev.changeSummaryForRecord(v2, v1).includes('1 narration'));
  const v3 = rec(3, [scene('s1'), scene('s2', { narration: 'n2b' })], { renderContextIdentity: 'ctx-B' });
  assert.equal(rev.changeSummaryForRecord(v3, v2), 'render-context change only');
});

test('annotate rewrites only the label; unknown ordinals fail plainly', () => {
  const dir = tmp();
  fs.mkdirSync(dir, { recursive: true });
  const a = { v: 1, ordinal: 1, label: null, keep: 'x' };
  const b = { v: 1, ordinal: 2, label: 'stay', keep: 'y' };
  fs.writeFileSync(path.join(dir, 'revisions.jsonl'), `${JSON.stringify(a)}\n${JSON.stringify(b)}\n`);
  const ok = rev.annotateLedger(dir, 1, 'initial product reel');
  assert.equal(ok.ok, true);
  const records = rev.readLedger(dir);
  assert.equal(records[0].label, 'initial product reel');
  assert.equal(records[0].keep, 'x');       // nothing else touched
  assert.equal(records[1].label, 'stay');   // other line byte-stable semantics
  const bad = rev.annotateLedger(dir, 99, 'nope');
  assert.equal(bad.ok, false);
  assert.ok(bad.error.includes('no revision v99'));
});

/* ---- CLI dispatch: narova diff / narova history ----------------------------- */

const BIN = path.resolve(__dirname, '..', 'bin', 'narova.js');

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', cwd });
}

test('CLI: history list/annotate/compare and diff dispatch with their baseline statements', () => {
  const dir = tmp();
  const out = path.join(dir, 'out');
  fs.mkdirSync(out, { recursive: true });

  // A minimal valid project exists from the start: diff is a project
  // operation and must resolve the config even with an empty ledger.
  fs.writeFileSync(path.join(dir, 'reel.config.js'), `module.exports = {
    title: 'CLI', size: { w: 160, h: 90 }, renderer: 'no-browser', chrome: false,
    voices: { a: { backend: 'piper', speaker: 's', color: '#0ff' } },
    scenes: [
      { id: 's1', vo: [{ who: 'a', text: 'One.' }], body: '<p>1</p>' },
      { id: 's2', vo: [{ who: 'a', text: 'Two.' }], body: '<p>2</p>' },
    ],
  };`);

  // Empty ledger: history and diff both state so plainly and succeed.
  let r = runCli(['history', '--out', out]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('no revisions recorded'));
  r = runCli(['diff', '--project', dir, '--out', out]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('no revisions recorded'));

  // A fabricated two-record ledger.
  const mk = (ordinal, s2narration) => JSON.stringify({
    v: 1, ordinal, parent: ordinal > 1 ? ordinal - 1 : null,
    recordedAt: '2026-08-19T00:00:00.000Z',
    renderContextIdentity: 'ctx-A',
    sceneIdentities: [
      { id: 's1', digest: 'd1', narration: 'n1', silentDur: null, duration: 2, sentences: 1 },
      { id: 's2', digest: 'd2', narration: s2narration, silentDur: null, duration: 2, sentences: 1 },
    ],
    stageDurations: { synth: 0.5, composeAndRender: 4 },
  });
  fs.writeFileSync(path.join(out, 'revisions.jsonl'), `${mk(1, 'n2')}\n${mk(2, 'n2-edited')}\n`);

  r = runCli(['history', '--out', out]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('v1'));
  assert.ok(r.stdout.includes('initial revision'));
  assert.ok(r.stdout.includes('1 narration scene change'));

  r = runCli(['history', 'annotate', '--out', out, '2', 'CTA changed']);
  assert.equal(r.status, 0);
  r = runCli(['history', '--out', out]);
  assert.ok(r.stdout.includes('CTA changed'));

  r = runCli(['history', 'annotate', '--out', out, '99', 'x']);
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('no revision v99'));

  r = runCli(['history', 'compare', '--out', out, '1..2']);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('vs v1, v2 after'));
  assert.ok(r.stdout.includes('script changed'));

  // Current project matches v2's authored narration -> diff reports no changes.
  // (The fabricated narrations are placeholders, so this asserts dispatch and
  // baseline naming rather than exact classification.)
  r = runCli(['diff', '--project', dir, '--out', out]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('Revision impact (vs v2)'));
  assert.ok(r.stdout.includes('Estimated render'));
});

test('whole-video cache reuse is named for what it is (never "not applicable")', () => {
  const dir = tmp();
  const manifest = { scenes: [{ id: 's1', hash: 'h1', duration: 2 }] };
  const reused = rev.measuredReuseRecord({
    outDir: dir, manifest, previous: null,
    renderReuse: { mode: 'whole-video', wholeVideoReused: true, spans: null, fallback: null, selectiveSkipped: null },
  });
  assert.equal(reused.spans.wholeVideoReused, true);
  assert.ok(reused.spans.note.includes('reused'));
  assert.ok(rev.formatMeasuredSummary(reused).includes('whole-video render reused'));
  const rendered = rev.measuredReuseRecord({
    outDir: dir, manifest, previous: null,
    renderReuse: { mode: 'whole-video', wholeVideoReused: false, spans: null, fallback: null, selectiveSkipped: 'project choreography can reference global DATA' },
  });
  assert.equal(rendered.spans.wholeVideoReused, false);
  assert.ok(rendered.spans.note.includes('selective render skipped'));
});

test('duration-changing edits cascade: only scenes BEFORE the first change keep spans', () => {
  const before = [
    scene('s1', { duration: 4 }), scene('s2', { duration: 4 }),
    scene('s3', { duration: 4 }), scene('s4', { duration: 4 }),
  ];
  // Narration edit on s2 (verified live: later starts shift -> span keys flip).
  const after = [scene('s1'), scene('s2', { narration: 'n2-edited' }), scene('s3'), scene('s4')];
  const report = rev.buildRevisionReport({ currentScenes: after, currentContextIdentity: 'ctx-A', baselineRecord: rec(1, before) });
  assert.equal(report.reuse.spans.keep, 1); // only s1 precedes the change
  assert.ok(report.reuse.spans.note.includes('start-time shift'));
  // Audio: s1/s3/s4 still byte-stable via the sentence cache.
  assert.equal(report.reuse.audio.scenesKeep, 3);
  // Visual-only edit: no duration change, no cascade.
  const afterVisual = [scene('s1'), scene('s2', { digest: 'd2-edited' }), scene('s3'), scene('s4')];
  const report2 = rev.buildRevisionReport({ currentScenes: afterVisual, currentContextIdentity: 'ctx-A', baselineRecord: rec(1, before) });
  assert.equal(report2.reuse.spans.keep, 3);
  assert.equal(report2.reuse.spans.note, null);
});

/* ---- integration: real builds record revisions end-to-end ------------------- */

(CAN_RENDER ? test : test.skip)('integration: no-browser external-narration builds record, suppress, and restart revisions', () => {
  const dir = tmp();
  // External narration: a 2.4s tone, two 1.2s scenes with word timings.
  const wav = path.join(dir, 'narration.wav');
  const words = path.join(dir, 'words.json');
  spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=330:duration=2.4', '-ar', '48000', '-ac', '1', wav]);
  fs.writeFileSync(words, JSON.stringify([
    { start: 0.1, end: 1.1, text: 'Scene one.', words: [
      { text: 'Scene', start: 0.1, end: 0.5 }, { text: 'one.', start: 0.55, end: 1.1 }] },
    { start: 1.2, end: 2.3, text: 'Scene two.', words: [
      { text: 'Scene', start: 1.2, end: 1.6 }, { text: 'two.', start: 1.65, end: 2.3 }] },
  ]));

  const mk = (twoText) => resolveConfig({
    title: 'Rev', size: { w: 160, h: 90 }, renderer: 'no-browser',
    narration: { file: 'narration.wav', wordTimings: 'words.json' },
    voices: { a: { speaker: 'x', color: '#2ee6d6' } }, chrome: false,
    scenes: [
      { id: 's1', dur: 1.2, vo: [{ who: 'a', text: 'Scene one.' }], visual: { type: 'stack', style: { background: '#080d16' }, children: [
        { type: 'text', text: 'ONE', style: { color: '#fff', fontSize: 24 } }] } },
      { id: 's2', dur: 1.2, vo: [{ who: 'a', text: 'Scene two.' }], visual: { type: 'stack', style: { background: '#080d16' }, children: [
        { type: 'text', text: twoText, style: { color: '#fff', fontSize: 24 } }] } },
    ],
  }, {}, dir);
  const out = path.join(dir, 'out');
  const lines = [];
  const log = m => lines.push(String(m));

  const r1 = build(mk('TWO'), { out, projectDir: dir, log });
  assert.equal(r1.revisions.recorded, true);
  assert.equal(r1.revisions.ordinal, 1);
  assert.ok(fs.existsSync(path.join(out, 'revisions.jsonl')));
  assert.ok(lines.some(l => l.includes('recorded v1')));

  // Unchanged rebuild: identical authored state -> no revision.
  const r2 = build(mk('TWO'), { out, projectDir: dir, log });
  assert.equal(r2.revisions.recorded, false);
  assert.equal(r2.revisions.ordinal, 1);
  assert.ok(lines.some(l => l.includes('no change since v1')));
  assert.equal(rev.readLedger(out).length, 1);

  // Visual-only edit: revision 2, span evidence shows the untouched scene reused.
  const r3 = build(mk('TWO — bigger'), { out, projectDir: dir, log });
  assert.equal(r3.revisions.recorded, true);
  assert.equal(r3.revisions.ordinal, 2);
  assert.equal(r3.revisions.record.parent, 1);
  const ledger = rev.readLedger(out);
  assert.equal(ledger[1].sceneIdentities[0].digest, ledger[0].sceneIdentities[0].digest);
  assert.notEqual(ledger[1].sceneIdentities[1].digest, ledger[0].sceneIdentities[1].digest);
  // Span evidence: s1 reused, s2 re-rendered (no fallback).
  const spans = ledger[1].measuredReuse.spans;
  assert.equal(spans.perScene.find(p => p.sceneId === 's1').status, 'reused');
  assert.equal(spans.perScene.find(p => p.sceneId === 's2').status, 'rendered');
  assert.equal(spans.fallback, null);
  // External narration: per-scene audio + sentences are not applicable.
  assert.equal(ledger[1].measuredReuse.audio.ratio, null);
  assert.equal(ledger[1].measuredReuse.sentences, null);
  // Stage durations recorded as measured numbers.
  assert.ok(ledger[1].stageDurations.synth != null);
  assert.ok(ledger[1].stageDurations.composeAndRender != null);

  // Ledger deletion: next state-changing build restarts at v1, nothing fails.
  fs.rmSync(path.join(out, 'revisions.jsonl'));
  const r4 = build(mk('TWO — bigger still'), { out, projectDir: dir, log });
  assert.equal(r4.revisions.recorded, true);
  assert.equal(r4.revisions.ordinal, 1);
  assert.equal(r4.revisions.record.parent, null);
});
