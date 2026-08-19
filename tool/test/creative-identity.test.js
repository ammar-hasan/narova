'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ci = require('../src/creative-identity');
const { check } = require('../src/check');
const { resolveConfig } = require('../src/schema');

/* creative-identity surfaces write to the user home ledger; isolate it. */
function isolateHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-ci-ledger-'));
  const prev = process.env.NAROVA_CREATIVE_IDENTITY_DIR;
  process.env.NAROVA_CREATIVE_IDENTITY_DIR = dir;
  t.after(() => {
    if (prev == null) delete process.env.NAROVA_CREATIVE_IDENTITY_DIR;
    else process.env.NAROVA_CREATIVE_IDENTITY_DIR = prev;
  });
  return dir;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'narova-ci-'));

function writeCreative(dir, text) {
  fs.writeFileSync(path.join(dir, 'creative.md'), text);
}

/* check() prints via console.log; capture it. */
function run(config, opts = {}) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  let ok;
  try { ok = check(config, opts); } finally { console.log = orig; }
  return { ok, lines };
}

const projectConfig = (dir, theme) => ({
  title: 'CI test',
  size: { w: 1280, h: 720 },
  projectDir: dir,
  theme: theme || { bg: '#0b1220', accent: '#eda15f' },
  mode: 'dark',
  voices: { a: { backend: 'piper' } },
  scenes: [
    { id: 'one', dur: 10, vo: [{ who: 'a', text: 'one' }], body: '<p data-cue="0">x</p>' },
    { id: 'two', dur: 10, vo: [], body: '<p class="reveal">y</p>' },
  ],
});

test('fingerprint is deterministic and config-only (NAR-007-031)', () => {
  const dir = tmp();
  const a = ci.fingerprint(projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' }));
  const b = ci.fingerprint(projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' }));
  assert.deepEqual(a, b);
  // accent-only change alters the palette dimension and nothing else
  const c = ci.fingerprint(projectConfig(dir, { bg: '#0b1220', accent: '#ffcc00' }));
  assert.notDeepEqual(a.palette.hueHist, c.palette.hueHist);
  assert.deepEqual(a.structure, c.structure);
  assert.deepEqual(a.layout, c.layout);
});

test('fingerprint covers palette, structure, layout, motion (NAR-007-031)', () => {
  const dir = tmp();
  const fp = ci.fingerprint(projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' }));
  assert.ok(fp.palette.hueHist.length === 18);
  assert.equal(fp.structure.sceneCount, 2);
  assert.ok(Array.isArray(fp.structure.durationShare));
  assert.ok(fp.layout.captions === 'subtitle');
  assert.ok(fp.motion.includes('body:data-cue'));
  assert.ok(fp.motion.includes('body:reveal'));
});

test('self-check flags a contradicted claim family (NAR-007-032)', () => {
  const dir = tmp();
  writeCreative(dir, 'palette: light bright sunny day\nprovenance: brief\n');
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' }); // dark
  const fp = ci.fingerprint(cfg);
  const claims = ci.parseClaims(path.join(dir, 'creative.md'));
  const advisories = ci.selfCheck(cfg, fp, claims);
  assert.ok(advisories.some(a => /CLAIM-MISMATCH/.test(a) && /light family/.test(a)));
});

test('self-check flags under-authored identity (NAR-007-032)', () => {
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy\n'); // no provenance
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  const fp = ci.fingerprint(cfg);
  const claims = ci.parseClaims(path.join(dir, 'creative.md'));
  const advisories = ci.selfCheck(cfg, fp, claims);
  assert.ok(advisories.some(a => /UNDER-AUTHORED/.test(a) && /provenance tag/.test(a)));
});

test('self-check is silent when claims match the authored identity (NAR-007-032)', () => {
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy amber\nprovenance: brief\n');
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  const fp = ci.fingerprint(cfg);
  const claims = ci.parseClaims(path.join(dir, 'creative.md'));
  assert.deepEqual(ci.selfCheck(cfg, fp, claims), []);
});

test('citation advisories: unresolved citation warns, resolvable does not (NAR-002-027)', () => {
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy\nprovenance: brief\n\nSource: [brand](./brand.md)\n');
  assert.ok(ci.citationAdvisories(projectConfig(dir), dir).some(a => /brand\.md/.test(a)));
  fs.writeFileSync(path.join(dir, 'brand.md'), 'tokens\n');
  assert.deepEqual(ci.citationAdvisories(projectConfig(dir), dir), []);
});

test('sibling check flags a near-duplicate and is silent without a ledger (NAR-007-033)', (t) => {
  isolateHome(t);
  const dirA = tmp();
  const dirB = tmp();
  writeCreative(dirA, 'palette: dark navy amber\nprovenance: brief\n');
  writeCreative(dirB, 'palette: dark navy amber\nprovenance: brief\n');
  const cfgA = projectConfig(dirA, { bg: '#0b1220', accent: '#eda15f' });
  const cfgB = projectConfig(dirB, { bg: '#0b1221', accent: '#eda15e' });
  // no ledger yet -> silent
  assert.deepEqual(ci.siblingCheck(cfgB, dirB, ci.fingerprint(cfgB)).advisories, []);
  // populate the ledger with A
  ci.run(cfgA, { projectDir: dirA });
  const out = ci.siblingCheck(cfgB, dirB, ci.fingerprint(cfgB));
  assert.ok(out.advisories.some(a => /identity near sibling/.test(a) && /brief/.test(a)));
});

test('sibling check ignores the project itself (NAR-007-033)', (t) => {
  isolateHome(t);
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy amber\nprovenance: brief\n');
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  ci.run(cfg, { projectDir: dir });
  // second run of the same project: self is skipped, no sibling advisory
  assert.deepEqual(ci.siblingCheck(cfg, dir, ci.fingerprint(cfg)).advisories, []);
});

test('advisories are deduplicated per unchanged project state (NAR-007-032)', (t) => {
  isolateHome(t);
  const dir = tmp();
  writeCreative(dir, 'palette: light bright sunny\nprovenance: brief\n');
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  const r1 = ci.run(cfg, { projectDir: dir });
  assert.ok(r1.lines.length > 0);
  assert.deepEqual(ci.run(cfg, { projectDir: dir }).lines, []);
});

test('dedup holds across multiple state changes (H1 regression)', (t) => {
  isolateHome(t);
  const dir = tmp();
  writeCreative(dir, 'palette: light bright sunny\nprovenance: brief\n');
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  assert.equal(ci.run(cfg, { projectDir: dir }).lines.length, 1); // state1
  assert.equal(ci.run(cfg, { projectDir: dir }).lines.length, 0); // unchanged
  cfg.theme.accent = '#ffcc00';
  assert.equal(ci.run(cfg, { projectDir: dir }).lines.length, 1); // state2
  assert.equal(ci.run(cfg, { projectDir: dir }).lines.length, 0); // unchanged
  cfg.theme.accent = '#00aa00';
  assert.equal(ci.run(cfg, { projectDir: dir }).lines.length, 1); // state3
  assert.equal(ci.run(cfg, { projectDir: dir }).lines.length, 0); // unchanged
});

test('a newly appearing sibling re-emits only sibling lines (M1 regression)', (t) => {
  isolateHome(t);
  const dirB = tmp();
  const dirA = tmp();
  writeCreative(dirB, 'palette: dark navy amber\nprovenance: brief\n');
  writeCreative(dirA, 'palette: dark navy amber\nprovenance: brief\n');
  const cfgB = () => projectConfig(dirB, { bg: '#0b1220', accent: '#eda15f' });
  // B alone: no self advisories (matching claims), no siblings -> silent
  assert.deepEqual(ci.run(cfgB(), { projectDir: dirB }).lines, []);
  assert.deepEqual(ci.run(cfgB(), { projectDir: dirB }).lines, []);
  // A appears as a near-sibling of B
  ci.run(projectConfig(dirA, { bg: '#0b1221', accent: '#eda15e' }), { projectDir: dirA });
  const r = ci.run(cfgB(), { projectDir: dirB });
  assert.ok(r.lines.some(l => /identity near sibling/.test(l)), r.lines.join('\n'));
  // unchanged again -> silent
  assert.deepEqual(ci.run(cfgB(), { projectDir: dirB }).lines, []);
});

test('alpha-hex palette tokens are parsed (M2 regression)', () => {
  const dir = tmp();
  const fp = ci.fingerprint(projectConfig(dir, { bg: '#0b1220ff', accent: '#eda15f80' }));
  assert.ok(fp.palette.stats.meanLuma != null);
  assert.ok(fp.palette.stats.meanSat != null);
});

test('unparseable authored palette tokens produce an advisory (M2)', (t) => {
  isolateHome(t);
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy\nprovenance: brief\n');
  const cfg = projectConfig(dir, { bg: 'rebeccapurple', accent: '#eda15f' });
  const r = ci.run(cfg, { projectDir: dir });
  assert.ok(r.self.some(a => /not a parseable hex color/.test(a)), r.self.join('\n'));
});

test('beat-spine sibling advisory requires equal scene counts (L2 regression)', (t) => {
  isolateHome(t);
  const dirA = tmp();
  const dirB = tmp();
  writeCreative(dirA, 'palette: dark navy amber\nprovenance: brief\n');
  writeCreative(dirB, 'palette: dark navy amber\nprovenance: brief\n');
  // A: 2 scenes [0.5, 0.5]; B: 3 scenes [0.5, 0.5, 0]-ish — different counts
  const cfgA = { ...projectConfig(dirA, { bg: '#0b1220', accent: '#eda15f' }),
    scenes: [
      { id: 'one', dur: 10, vo: [{ who: 'a', text: 'one' }], body: '<p>x</p>' },
      { id: 'two', dur: 10, vo: [], body: '<p>y</p>' },
    ] };
  ci.run(cfgA, { projectDir: dirA });
  const cfgB = { ...projectConfig(dirB, { bg: '#0b1221', accent: '#eda15e' }),
    scenes: [
      { id: 'one', dur: 10, vo: [{ who: 'a', text: 'one' }], body: '<p>x</p>' },
      { id: 'two', dur: 10, vo: [], body: '<p>y</p>' },
      { id: 'three', dur: 10, vo: [], body: '<p>z</p>' },
    ] };
  const r = ci.siblingCheck(cfgB, dirB, ci.fingerprint(cfgB));
  assert.ok(!r.advisories.some(a => /structural beat spine identical/.test(a)), r.advisories.join('\n'));
});

test('malformed ledger entries are ignored, surface still works (L5 regression)', (t) => {
  isolateHome(t);
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy amber\nprovenance: brief\n');
  const ledgerDir = process.env.NAROVA_CREATIVE_IDENTITY_DIR;
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(path.join(ledgerDir, 'ledger.json'), JSON.stringify([
    { key: 'x', fp: 'not-an-object' },
    { title: 'T', at: 'now' }, // no fp
  ]));
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  const r = ci.run(cfg, { projectDir: dir });
  assert.ok(Array.isArray(r.lines));
});

test('ledger stores hashed titles, never raw narration or claims (M3/privacy)', (t) => {
  isolateHome(t);
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy amber\nprovenance: brief\n');
  const cfg = { ...projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' }), title: 'Private Pitch Project' };
  ci.run(cfg, { projectDir: dir });
  const ledger = JSON.parse(fs.readFileSync(
    path.join(process.env.NAROVA_CREATIVE_IDENTITY_DIR, 'ledger.json'), 'utf8'));
  assert.ok(!JSON.stringify(ledger).includes('Private Pitch Project'));
  assert.ok(!JSON.stringify(ledger).includes('one')); // no narration text
  assert.ok(ledger.every(e => !e.title || e.title.length <= 12));
});

test('artifact is emitted with fingerprint, claims, and comparison basis (NAR-007-034)', (t) => {
  isolateHome(t);
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy amber\nprovenance: brief\n');
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  const outDir = path.join(dir, 'out');
  const r = ci.run(cfg, { projectDir: dir, outDir, emitArtifact: true });
  assert.ok(r.artifactPath);
  const artifact = JSON.parse(fs.readFileSync(r.artifactPath, 'utf8'));
  assert.ok(artifact.fingerprint.palette.hueHist);
  assert.equal(artifact.rationaleClaims.palette, 'dark navy amber');
  assert.ok('comparison' in artifact);
});

test('artifact with no claims records claims as absent (NAR-007-034)', (t) => {
  isolateHome(t);
  const dir = tmp();
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  const outDir = path.join(dir, 'out');
  const r = ci.run(cfg, { projectDir: dir, outDir, emitArtifact: true });
  const artifact = JSON.parse(fs.readFileSync(r.artifactPath, 'utf8'));
  assert.equal(artifact.rationaleClaims, null);
});

test('check() integration: no creative.md stays silent; with one, advisory appears (NAR-007-032)', (t) => {
  isolateHome(t);
  const dir = tmp();
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  cfg.projectDir = dir;
  // no creative.md -> no creative-identity lines
  let { lines } = run(cfg);
  assert.ok(!lines.some(l => l.includes('creative-identity')), lines.join('\n'));
  // with a mismatched creative.md -> advisory, and check still passes
  writeCreative(dir, 'palette: light bright sunny\nprovenance: brief\n');
  const r2 = run(cfg);
  assert.ok(r2.lines.some(l => /warn: creative-identity: CLAIM-MISMATCH/.test(l)), r2.lines.join('\n'));
  assert.ok(r2.ok);
});

test('check() emits the artifact on request and never fails the build (NAR-007-034)', (t) => {
  isolateHome(t);
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy amber\nprovenance: brief\n');
  const cfg = projectConfig(dir, { bg: '#0b1220', accent: '#eda15f' });
  cfg.projectDir = dir;
  const outDir = path.join(dir, 'out');
  const r = run(cfg, { outDir, emitCreativeArtifact: true });
  assert.ok(fs.existsSync(path.join(outDir, 'creative-identity.json')));
  assert.ok(r.ok);
});

test('resolved config end-to-end via schema (NAR-007-031..034)', async (t) => {
  isolateHome(t);
  const dir = tmp();
  writeCreative(dir, 'palette: dark navy amber\nprovenance: brief\n');
  const raw = {
    title: 'CI e2e',
    theme: { bg: '#0b1220', accent: '#eda15f' },
    voices: { a: { backend: 'piper' } },
    scenes: [
      { id: 'one', dur: 10, vo: [{ who: 'a', text: 'one' }], body: '<p data-cue="0">x</p>' },
      { id: 'two', dur: 10, vo: [], body: '<p class="reveal">y</p>' },
    ],
  };
  const resolved = await resolveConfig(raw, {}, dir);
  const r = ci.run(resolved, { projectDir: dir });
  assert.deepEqual(r.self, []);
  assert.ok(r.lines.length === 0);
});
