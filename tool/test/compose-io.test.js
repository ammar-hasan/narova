'use strict';
/* compose() end-to-end at the file level: real temp dirs, real writes. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compose, composeSceneProject } = require('../src/compose');
const { HYPERFRAMES_VERSION } = require('../src/hf');
const { writeStageInputs, resolveReuse, commitFingerprint } = require('../src/pipeline');

const HAS_FFMPEG = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;

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

function inlinedData(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  const match = html.match(/var DATA = (\{.*\});\nwindow\.__timelines/);
  assert.ok(match, 'generated document contains inlined composition data');
  return JSON.parse(match[1]);
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

test('compose preflights authored JavaScript before creating a render project', () => {
  const out = tmpOut();
  assert.throws(() => compose({ ...config, choreography: 'if (!sc) { return; }' }, out),
    /config\.choreography at 1:12 — Illegal return statement/);
  assert.ok(!fs.readdirSync(out).some(name => name.startsWith('hf-')),
    'a non-executable author source must fail before render-project writes');
});

test('compose does not execute syntactically valid author code during preflight', () => {
  const out = tmpOut();
  const result = compose({ ...config, choreography: 'throw new Error("runtime proof");' }, out);
  const html = fs.readFileSync(path.join(result.dir, 'index.html'), 'utf8');
  assert.match(html, /window\.__narovaAuthorState\.source="config\.choreography"/);
  assert.match(html, /throw new Error\("runtime proof"\)/);
});

test('compose preserves a raw Three module throw for attributed browser execution', () => {
  const out = tmpOut();
  const result = compose({
    ...config,
    scenes: [{
      ...config.scenes[0],
      _threeModuleContents: 'throw new Error("three runtime proof");',
    }],
  }, out);
  const html = fs.readFileSync(path.join(result.dir, 'index.html'), 'utf8');
  assert.match(html, /scene \\"only\\" threeModule/);
  assert.match(html, /throw new Error\("three runtime proof"\)/);
  assert.ok(html.indexOf('boots[i]()') < html.indexOf("window.__timelines['main']=tl"),
    'raw module initialization must finish before public timeline readiness');
});

test('compose queues a valid raw Three module without changing its author body', () => {
  const out = tmpOut();
  const authorBody = 'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0x44aaff})));';
  const result = compose({
    ...config,
    scenes: [{ ...config.scenes[0], _threeModuleContents: authorBody }],
  }, out);
  const html = fs.readFileSync(path.join(result.dir, 'index.html'), 'utf8');
  assert.ok(html.includes(authorBody));
  assert.match(html, /__narovaRegisterThreeBoot\(boot\)/);
});

test('external word helpers preserve legacy browser turns and caption projection', {
  skip: HAS_FFMPEG ? false : 'ffmpeg required for isolated-scene audio trim',
}, () => {
  const out = tmpOut(false);
  const audio = path.join(out, 'external.wav');
  const generated = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'anullsrc=r=8000:cl=mono', '-t', '5', audio], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr || 'failed to create external narration fixture');
  const external = {
    ...config,
    title: 'External compatibility',
    scenes: [
      { id: 'first', dur: 2, body: '<p data-cue="0">one</p>', vo: [{ who: 'a', text: 'One.' }] },
      { id: 'second', dur: 3, body: '<p data-cue="0">two</p>', vo: [{ who: 'a', text: 'Two.' }] },
    ],
    narrationSource: {
      file: audio,
      wordTimings: [
        { start: 0.5, end: 0.9, text: 'One.', words: [{ text: 'One.', start: 0.5, end: 0.9 }] },
        { start: 2.75, end: 3.2, text: 'Two.', words: [{ text: 'Two.', start: 2.75, end: 3.2 }] },
      ],
    },
  };

  try {
    const full = compose(external, out);
    const fullData = inlinedData(full.dir);
    assert.deepEqual(fullData.scenes.map(scene => scene.turns), [[], []],
      'raw external browser projection keeps numeric turn cues unresolved');
    assert.deepEqual(fullData.scenes[1].sentences[0], {
      sentenceIndex: 0,
      words: [{ token: 'Two.', speaker: 'a', start: 2.75, end: 3.2 }],
    }, 'new helper evidence is normalized in global composition time');
    assert.equal(fullData.groups[0].start, null,
      'legacy standard-caption projection retains raw external word coordinates');
    assert.deepEqual(fullData.groups[0].words, [{ t0: null, t1: null }],
      'legacy standard-caption projection does not silently gain normalized text/timing');

    const isolated = composeSceneProject(external, out, 1);
    const isolatedData = inlinedData(isolated.dir);
    assert.deepEqual(isolatedData.scenes[0].turns, []);
    assert.deepEqual(isolatedData.scenes[0].sentences[0], {
      sentenceIndex: 0,
      words: [{ token: 'Two.', speaker: 'a', start: 0.75, end: 1.2 }],
    }, 'isolated helper evidence rebases without changing legacy turn behavior');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
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
