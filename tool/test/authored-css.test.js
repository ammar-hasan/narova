'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compose, composeSceneProject } = require('../src/compose');
const { compile } = require('../src/manifest');
const { renderContextHash } = require('../src/scene-cache');
const { configFromManifest } = require('../src/pipeline');

function fixture(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-css-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const out = path.join(project, 'out');
  fs.mkdirSync(path.join(out, 'audio'), { recursive: true });
  const audio = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', path.join(out, 'audio/full.wav')]);
  assert.equal(audio.status, 0, String(audio.stderr));
  fs.writeFileSync(path.join(out, 'timings.json'), JSON.stringify({ a: { dur: 1, turns: [], words: [] }, b: { dur: 1, turns: [], words: [] } }));
  const config = { title: 'CSS', projectDir: project, size: { w: 320, h: 180 }, renderer: 'hyperframes', voices: {}, theme: {}, themeCss: '', captionsEnabled: false, chrome: { topbar: false, counter: false, progress: false }, scenes: [{ id: 'a', dur: 1, vo: [], body: '<p>x</p>' }, { id: 'b', dur: 1, vo: [], body: '<p>y</p>' }] };
  return { project, out, config };
}

function sheets(dir) {
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  return [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(m => [m[1], fs.readFileSync(path.join(dir, m[1]), 'utf8')]);
}

test('full and isolated projects retain independent CSS sources, preambles and cascade order', t => {
  const { out, config } = fixture(t);
  config.themeCss = '@charset "UTF-8";\n@layer shared;\n@import url("assets/shared.css") layer(shared) screen;\np { color: blue; }';
  config.scenes[0]._cssFileContents = '@import "assets/scene.css" supports(display:grid);\np { border: 2px solid red; }';
  config.scenes[1]._cssFileContents = 'p { background: green; }';
  config.imports = { data: { file: 'data.json', contents: '{}' }, late: { file: 'last.CSS', contents: '@import url("assets/last.css");\np { color: purple; }' } };
  const full = compose(config, out);
  const isolated = composeSceneProject(config, out, 0);
  const a = sheets(full.dir), b = sheets(isolated.dir);
  assert.deepEqual(a, b, 'all global CSS, including another scene stylesheet, has identical full/isolated order');
  assert.deepEqual(a.slice(1).map(([, css]) => css), [config.themeCss, config.scenes[0]._cssFileContents, config.scenes[1]._cssFileContents, config.imports.late.contents]);
  assert.ok(!a[0][1].includes('@import'), 'generated rules do not precede author imports in their own sheet');
  assert.equal(config.stylesheets, undefined, 'composition does not mutate resolved author input');
});

test('late authored imports stay late rather than being repaired or hoisted', t => {
  const { out, config } = fixture(t);
  config.themeCss = 'p { color: blue; }\n@import "assets/late.css";';
  const full = compose(config, out);
  assert.equal(sheets(full.dir)[1][1], config.themeCss);
});

test('globally applicable scene CSS and declared dependent bytes invalidate browser shared identity', t => {
  const { project, config } = fixture(t);
  fs.mkdirSync(path.join(project, 'styles'));
  fs.mkdirSync(path.join(project, 'fonts'));
  fs.writeFileSync(path.join(project, 'styles/scene.css'), 'p { color: red; }');
  fs.writeFileSync(path.join(project, 'fonts/shared.woff'), 'font-one');
  config.scenes[1]._cssFileContents = 'p { color: red; }';
  config.sceneFileRefs = [{ sceneIndex: 1, key: 'cssFile', file: 'styles/scene.css' }];
  config.localResources = ['styles/scene.css', 'fonts/shared.woff'];
  config.localResourceDependencies = { 'styles/scene.css': ['fonts/shared.woff'] };
  const first = renderContextHash(compile(config));
  config.scenes[1]._cssFileContents = 'p { color: green; }';
  const second = renderContextHash(compile(config));
  assert.notEqual(first, second, 'another scene can be affected by globally applicable CSS');
  fs.writeFileSync(path.join(project, 'fonts/shared.woff'), 'font-two');
  const third = renderContextHash(compile(config));
  assert.notEqual(second, third, 'declared transitive font is a shared pixel dependency');
});

test('different stylesheet boundaries cannot collide in shared identity', t => {
  const { config } = fixture(t);
  config.themeCss = 'p { color: red; }';
  config.scenes[0]._cssFileContents = 'p { color: blue; }';
  const first = renderContextHash(compile(config));
  config.themeCss += '\n' + config.scenes[0]._cssFileContents;
  delete config.scenes[0]._cssFileContents;
  assert.notEqual(first, renderContextHash(compile(config)));
});

test('episode import tracks nested selected CSS despite an unrelated same-name root file', t => {
  const { project, config } = fixture(t);
  fs.mkdirSync(path.join(project, 'shared/styles'), { recursive: true });
  fs.writeFileSync(path.join(project, 'shared/styles/brand.css'), '@import "nested.css";');
  fs.writeFileSync(path.join(project, 'shared/styles/nested.css'), 'p { color: red; }');
  fs.writeFileSync(path.join(project, 'nested.css'), 'p { color: blue; }');
  config.themeCss = '@import url("shared/styles/brand.css");';
  config.localResources = ['shared/styles/brand.css', 'shared/styles/nested.css'];
  config.localResourceDependencies = { 'shared/styles/brand.css': ['shared/styles/nested.css'] };
  const first = compile(config), context = renderContextHash(first);
  assert.ok(first.hashes['globalasset:shared/styles/brand.css']);
  assert.ok(first.hashes['globalasset:shared/styles/nested.css']);
  assert.equal(first.hashes['globalasset:nested.css'], undefined);
  fs.writeFileSync(path.join(project, 'shared/styles/nested.css'), 'p { color: green; }');
  assert.notEqual(context, renderContextHash(compile(config)));
});

test('no-browser does not promote unused scene CSS dependencies to shared pixels', t => {
  const { project, config } = fixture(t);
  fs.mkdirSync(path.join(project, 'styles')); fs.mkdirSync(path.join(project, 'fonts'));
  fs.writeFileSync(path.join(project, 'styles/scene.css'), 'p { color: red; }');
  fs.writeFileSync(path.join(project, 'fonts/css-only.woff'), 'one');
  config.renderer = 'no-browser'; config.themeCss = 'p { color: black; }';
  config.scenes[1]._cssFileContents = 'p { color: red; }';
  config.sceneFileRefs = [{ sceneIndex: 1, key: 'cssFile', file: 'styles/scene.css' }];
  config.localResources = ['styles/scene.css', 'fonts/css-only.woff'];
  config.localResourceDependencies = { 'styles/scene.css': ['fonts/css-only.woff'] };
  const before = renderContextHash(compile(config));
  fs.writeFileSync(path.join(project, 'fonts/css-only.woff'), 'two');
  assert.equal(before, renderContextHash(compile(config)));
});

test('selected root CSS is not shadowed by a same-path file inside assets', t => {
  const { project, config } = fixture(t);
  for (const dir of ['shared', 'assets/shared']) fs.mkdirSync(path.join(project, dir), { recursive: true });
  fs.writeFileSync(path.join(project, 'shared/brand.css'), 'p { color: red; }');
  fs.writeFileSync(path.join(project, 'assets/shared/brand.css'), 'p { color: blue; }');
  config.themeCss = '@import url("shared/brand.css");';
  config.localResources = ['shared/brand.css'];
  const first = compile(config);
  assert.ok(first.hashes['globalasset:shared/brand.css']);
  assert.equal(first.hashes['globalasset:assets/shared/brand.css'], undefined);
  fs.writeFileSync(path.join(project, 'shared/brand.css'), 'p { color: green; }');
  assert.notEqual(renderContextHash(first), renderContextHash(compile(config)));
});

test('manifest restoration does not inject author CSS or mode into generated theme tokens', t => {
  const { out, config } = fixture(t);
  config.theme = { accent: '#abcdef', custom: '42px' }; config.mode = 'light';
  config.themeCss = '@import url("assets/shared.css");\n.override { color: red; }';
  const manifest = JSON.parse(JSON.stringify(compile(config)));
  for (const original of [config, undefined]) {
    const restored = configFromManifest(manifest, original);
    assert.equal(restored.theme.css, undefined);
    assert.equal(restored.theme.mode, undefined);
    assert.equal(restored.theme.custom, '42px');
    assert.equal(restored.mode, 'light');
    assert.equal(restored.themeCss, config.themeCss);
    const full = compose(restored, out), projected = sheets(full.dir);
    assert.ok(!projected[0][1].includes('.override'), 'author rules must not be duplicated as nested rules inside :root');
    assert.ok(!projected[0][1].includes('--css:'));
    assert.ok(!projected[0][1].includes('--mode:'));
    assert.match(projected[0][1], /--custom:42px/);
    assert.equal(projected[1][1], config.themeCss);
  }
});
