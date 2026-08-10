'use strict';
/* compose() end-to-end at the file level: real temp dirs, real writes. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { compose } = require('../src/compose');
const { HYPERFRAMES_VERSION } = require('../src/hf');
const { writeStageInputs, resolveReuse, commitFingerprint } = require('../src/pipeline');

const config = {
  title: 'IO Test',
  size: { w: 640, h: 360 },
  voices: { a: { label: 'A', color: '#2ee6d6', backend: 'piper' } },
  theme: {}, themeCss: '',
  scenes: [{ id: 'only', body: '<p>x</p>', vo: [{ who: 'a', text: 'Hello.' }] }],
};
const timings = {
  only: { dur: 3, turns: [0.16], words: [{ w: 'Hello.', t0: 0.16, t1: 0.9, who: 'a', si: 0 }] },
};

function tmpOut(withInputs = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-io-'));
  if (withInputs) {
    fs.writeFileSync(path.join(dir, 'timings.json'), JSON.stringify(timings));
    fs.mkdirSync(path.join(dir, 'audio'));
    fs.writeFileSync(path.join(dir, 'audio', 'full.wav'), 'RIFFfake');
  }
  return dir;
}

test('compose writes index.html, the audio copy, and a pinned package.json', () => {
  const out = tmpOut();
  const r = compose(config, out);
  assert.equal(r.scenes, 1);
  assert.equal(r.total, 3);
  const html = fs.readFileSync(path.join(out, 'hf-io-test', 'index.html'), 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('id="scene-only"'));
  assert.ok(!html.includes('<style>'), 'CSS must be external, not inlined');
  assert.ok(fs.existsSync(path.join(out, 'hf-io-test', 'style.css')), 'CSS must be written as a separate file');
  assert.equal(fs.readFileSync(path.join(out, 'hf-io-test', 'assets', 'narration.wav'), 'utf8'), 'RIFFfake');
  const pkg = JSON.parse(fs.readFileSync(path.join(out, 'hf-io-test', 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies.hyperframes, HYPERFRAMES_VERSION);
  assert.equal(pkg.name, 'io-test');
});

test('compose copies project assets and removes stale generated copies', () => {
  const out = tmpOut();
  const projectAssets = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-assets-'));
  fs.mkdirSync(path.join(projectAssets, 'fonts'));
  fs.writeFileSync(path.join(projectAssets, 'logo.svg'), '<svg/>');
  fs.writeFileSync(path.join(projectAssets, 'fonts', 'brand.woff2'), 'font');
  compose({ ...config, assetsDir: projectAssets }, out);
  assert.equal(fs.readFileSync(path.join(out, 'hf-io-test', 'assets', 'logo.svg'), 'utf8'), '<svg/>');
  assert.equal(fs.readFileSync(path.join(out, 'hf-io-test', 'assets', 'fonts', 'brand.woff2'), 'utf8'), 'font');

  fs.rmSync(path.join(projectAssets, 'logo.svg'));
  compose({ ...config, assetsDir: projectAssets }, out);
  assert.ok(!fs.existsSync(path.join(out, 'hf-io-test', 'assets', 'logo.svg')));
});

test('compose is a clean regeneration (second run overwrites)', () => {
  const out = tmpOut();
  compose(config, out);
  const first = fs.readFileSync(path.join(out, 'hf-io-test', 'index.html'), 'utf8');
  compose({ ...config, title: 'Changed' }, out);
  // Title changed → directory changed, old one removed.
  assert.ok(!fs.existsSync(path.join(out, 'hf-io-test')));
  const second = fs.readFileSync(path.join(out, 'hf-changed', 'index.html'), 'utf8');
  assert.notEqual(first, second);
  assert.ok(second.includes('<title>Changed</title>'));
});

test('compose without synth outputs fails with the run-synth-first hint', () => {
  const out = tmpOut(false);
  assert.throws(() => compose(config, out), /run `narova synth` first/);
});

test('Python stage manifests do not leak the machine-local assets path', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-stage-'));
  writeStageInputs({ ...config, assetsDir: '/machine/private/project/assets' }, out);
  const resolved = JSON.parse(fs.readFileSync(path.join(out, 'config.resolved.json'), 'utf8'));
  assert.ok(!Object.hasOwn(resolved, 'assetsDir'));
});

test('--reuse holds only while the spoken text is unchanged', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-reuse-'));
  assert.equal(resolveReuse(config, out, true), false, 'no previous synth -> full synth');
  writeStageInputs(config, out);                      // what the last synth consumed
  // synth writes timings.json + fingerprint — the test needs dummies so reuse can match.
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({ only: { dur: 3, turns: [0.16] } }), 'utf8');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  fs.writeFileSync(path.join(out, 'audio', 'full.wav'), 'fake');
  commitFingerprint(config, out);
  assert.equal(resolveReuse(config, out, true), true, 'same vo -> reuse the audio');
  const edited = { ...config, scenes: [{ ...config.scenes[0], vo: [{ who: 'a', text: 'Changed.' }] }] };
  assert.equal(resolveReuse(edited, out, true), false, 'changed vo -> force a full synth');
  const renamed = { ...config, scenes: [{ ...config.scenes[0], id: 'renamed' }] };
  assert.equal(resolveReuse(renamed, out, true), false, 'scene topology change -> rebuild timings');
  const silent = { ...config, voices: {}, scenes: [{ id: 'pause', body: '<p>x</p>', vo: [], dur: 3 }] };
  commitFingerprint(silent, out);
  assert.equal(resolveReuse({ ...silent, scenes: [{ ...silent.scenes[0], dur: 8 }] }, out, true), false,
    'silent duration change -> rebuild silent audio and timings');
  assert.equal(resolveReuse(config, out, false), false, '--reuse not requested -> never reuse');
});
