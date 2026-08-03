'use strict';
/* CLI smoke tests: spawn the real binary, assert exit codes + output shape.
 * Only cheap commands — nothing that synthesizes or renders. */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'narova.js');
const run = (args, opts = {}) => spawnSync('node', [BIN, ...args], { encoding: 'utf8', ...opts });

test('--version prints a semver', () => {
  const r = run(['--version']);
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test('help shows on no command, help, and -h', () => {
  for (const args of [[], ['help'], ['-h']]) {
    const r = run(args);
    assert.equal(r.status, 0, args.join(' '));
    assert.match(r.stdout, /Usage: narova/);
    assert.match(r.stdout, /walkthrough explore/);
    assert.match(r.stdout, /walkthrough capture/);
  }
});

test('renderers list exposes both bundled local providers', () => {
  const r = run(['renderers', 'list']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^hyperframes\t[^\t]+\tlocal · browser$/m);
  assert.match(r.stdout, /^native\t1\.0\.0\tlocal · browserless$/m);
});

test('walkthrough status reports a missing take; capture requires synth timings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-walkthrough-'));
  fs.writeFileSync(path.join(dir, 'reel.config.json'), JSON.stringify({
    title: 'Demo',
    voices: { a: { speaker: 'en_US-ryan-high' } },
    walkthroughs: {
      app: {
        url: 'https://example.com',
        steps: [{ at: 0.5, action: 'click', target: { text: 'More information' } }],
      },
    },
    scenes: [{
      id: 'demo',
      body: '<p>See the product.</p>',
      walkthrough: 'app',
      vo: [{ who: 'a', text: 'See how it works.' }],
    }],
  }));
  const status = run(['walkthrough', 'status', '--project', dir]);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /app: recording missing/);

  const capture = run(['walkthrough', 'capture', 'app', '--project', dir]);
  assert.equal(capture.status, 1);
  assert.match(capture.stderr, /narova synth/);
});

test('render is gone with a pointer to compose/build', () => {
  const r = run(['render']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /removed in 0\.3\.0/);
});

test('unknown command exits 1', () => {
  const r = run(['frobnicate']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown command/);
});

test('init scaffolds a project that passes check; init never overwrites', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  assert.equal(run(['init', proj]).status, 0);
  const c = run(['check', '--project', proj]);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /^ok: /m);
  assert.ok(!/^warn:/m.test(c.stdout), 'scaffold must check clean');
  const again = run(['init', proj]);
  assert.match(again.stdout, /skip\s+reel\.config\.mjs \(exists\)/);
  assert.ok(fs.statSync(path.join(proj, 'assets')).isDirectory());
});

test('preview --stop is safe when no detached preview exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const r = run(['preview', '--stop', '--project', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no detached preview is running/);
});

test('check exits 1 with the full error list on an invalid config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  fs.writeFileSync(path.join(dir, 'reel.config.json'),
    JSON.stringify({ voices: {}, scenes: [{ id: 'x', body: 1, vo: [] }] }));
  const r = run(['check', '--project', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /body: HTML string required/);
  assert.match(r.stderr, /empty turn list requires a positive explicit dur/);
});

test('commands work from a subdirectory (config discovered by walking up)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const nested = path.join(proj, 'out', 'hf');
  fs.mkdirSync(nested, { recursive: true });
  const r = run(['check'], { cwd: nested });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ok: /m);
});

test('compose prints the scene start table for QA', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const out = path.join(proj, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(out, 'audio', 'full.wav'), 'RIFFfake');
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
    title: { dur: 3, turns: [0.16], words: [{ w: 'Hi.', t0: 0.16, t1: 0.9, who: 'a', si: 0 }] },
  }));
  const r = run(['compose', '--project', proj]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /scene starts:/);
  assert.match(r.stdout, /00:00\.0 {2}title {2}\(3\.0s\)/);
  assert.match(r.stdout, /narova shots/);
  assert.match(r.stdout, /captions -> /);
  assert.ok(fs.existsSync(path.join(out, 'captions.srt')));
  assert.ok(fs.existsSync(path.join(out, 'captions.vtt')));
});

test('shots without synth exits 1 with the run-synth hint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['shots', '--project', proj]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /narova synth/);
});

test('bare --out errors instead of resolving "true"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['compose', '--project', proj, '--out']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--out needs a value/);
});

test('any bare value-flag errors instead of resolving to true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['check', '--project', proj, '--tempo']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--tempo needs a value/);
});

/* A scaffold with timings.json already synthed (fake audio, real timings). */
function projectWithTimings() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const out = path.join(proj, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(out, 'audio', 'full.wav'), 'RIFFfake');
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({
    title: { dur: 3, turns: [0.16], words: [{ w: 'Hi.', t0: 0.16, t1: 0.9, who: 'a', si: 0 }] },
  }));
  return proj;
}

test('captions rewrites out/captions.{srt,vtt} from timings.json', () => {
  const proj = projectWithTimings();
  const r = run(['captions', '--project', proj]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /captions -> .*captions\.srt \(\+ captions\.vtt, 1 cues\)/);
  const out = path.join(proj, 'out');
  assert.equal(fs.readFileSync(path.join(out, 'captions.srt'), 'utf8'),
    '1\n00:00:00,160 --> 00:00:03,000\nHi.\n');
  assert.equal(fs.readFileSync(path.join(out, 'captions.vtt'), 'utf8'),
    'WEBVTT\n\n00:00:00.160 --> 00:00:03.000\nHi.\n');
});

test('captions without synth exits 1 with the run-synth hint', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['captions', '--project', proj]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /narova synth/);
});

test('--platform sets a frame preset; an unknown platform fails check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const ok = run(['check', '--project', proj, '--platform', 'tiktok']);
  assert.equal(ok.status, 0, ok.stderr);
  const bad = run(['check', '--project', proj, '--platform', 'myspace']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown platform "myspace"/);
});

test('--variant with an undeclared id fails check naming the declared variants', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['check', '--project', proj, '--variant', 'nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown variant "nope"/);
});

test('build --variant and --variants together are rejected before any synth', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-cli-'));
  const proj = path.join(dir, 'p');
  run(['init', proj]);
  const r = run(['build', '--project', proj, '--variant', 'x', '--variants']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /mutually exclusive/);
});
