'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const series = require('../src/series');
const { resolveConfig } = require('../src/schema');
const { compile, hashConfig, sceneAssetRefs } = require('../src/manifest');
const { configFromManifest, audioFingerprint } = require('../src/pipeline');
const archive = require('../src/project-archive');
const { loadConfigFile } = require('../src/config');
const BIN = path.resolve(__dirname, '../bin/narova.js');
const run = args => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, NAROVA_FIRST_RUN: '0' } });
const save = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2)); };
function fixture(t, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-series-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, 'episodes', 'second');
  const configFile = path.join(project, 'reel.config.json');
  const raw = { title: 'Second episode', renderer: 'no-browser', scenes: [{ id: 'scene', dur: 1, vo: [], visual: { type: 'rect', x: 0, y: 0, w: 1280, h: 720, fill: '#112233' } }] };
  save(configFile, raw);
  const sourceFile = path.join(root, 'series.config.json');
  const source = { format: series.FORMAT, id: 'course', title: 'Course', defaults: { theme: { accent: '#abcdef' } },
    resources: { logo: { file: 'media/logo.svg' }, unused: { file: 'missing-unselected.png' } },
    context: { vocabulary: { text: 'A planet orbits a star.', source: 'creator' }, future: { text: 'Private finale spoiler' } },
    states: { after_first: { facts: { introduced: ['orbit'] }, note: 'Authored handoff' } },
    episodes: [{ id: 'first', title: 'Planned first' }, { id: 'second', title: 'Second', project: 'episodes/second', relationships: [{ type: 'prerequisite', episode: 'first' }] }] };
  save(sourceFile, source); save(path.join(root, 'media/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="red"/></svg>');
  return { root, project, raw, source, sourceFile, configFile, bound: () => series.bind(sourceFile, 'second', opts), resolved: () => resolveConfig(JSON.parse(fs.readFileSync(configFile)), {}, project) };
}

test('standalone and legacy part metadata do not infer nearby series membership', t => {
  const f = fixture(t); f.raw.series = { part: 2, total: 6 }; save(f.configFile, f.raw);
  const config = f.resolved(); assert.deepEqual(config.series, { part: 2, total: 6 }); assert.equal(config.seriesBinding, undefined);
  f.raw.seriesOverrides = { remove: { voices: ['host'] } }; save(f.configFile, f.raw); assert.throws(f.resolved, /no binding/);
});

test('catalog ordering, planned projects and typed DAG validation remain non-rendering', t => {
  const f = fixture(t); const report = series.inspectSource(f.sourceFile);
  assert.deepEqual(report.episodes.map(e => e.projectStatus), ['planned', 'available']);
  assert.throws(() => series.bind(f.sourceFile, 'first'), /no project/);
  for (const mutate of [s => s.episodes.push(s.episodes[0]), s => s.episodes[1].relationships[0].episode = 'absent', s => s.episodes[0].relationships = [{ type: 'continuity', episode: 'second' }]]) {
    const source = structuredClone(f.source); mutate(source); save(f.sourceFile, source); assert.throws(() => series.inspectSource(f.sourceFile), /duplicate|invalid episode|cycle/);
  }
});

test('bind retains only explicit resources/context/state and ignores unavailable unselected bytes', t => {
  const f = fixture(t, { resources: ['logo'], context: ['vocabulary'], incoming: 'after_first' });
  const result = f.bound(); assert.equal(result.committed, true);
  const binding = series.readBinding(f.project); assert.deepEqual(Object.keys(binding.resources), ['logo']); assert.deepEqual(Object.keys(binding.context), ['vocabulary']);
  assert.equal(binding.incoming.value.facts.introduced[0], 'orbit'); assert.equal(binding.revision, result.revision);
  assert.equal(fs.existsSync(path.join(f.project, series.FILES, 'media/logo.svg')), true);
  assert.equal(JSON.stringify(binding).includes('spoiler'), false);
  fs.rmSync(f.sourceFile); fs.rmSync(path.join(f.root, 'media'), { recursive: true });
  assert.equal(f.resolved().theme.accent, '#abcdef'); assert.equal(series.inspectProject(f.project).incoming.id, 'after_first');
});

test('voice ordering preserves slots, complete replacement and positional override behavior', t => {
  const f = fixture(t); f.source.defaults.voices = { host: { backend: 'piper', speaker: 'shared-host', label: 'Host' }, guest: { backend: 'piper', speaker: 'shared-guest', label: 'Guest' } };
  f.raw.voices = { guest: { backend: 'piper', speaker: 'local-guest' }, host: { backend: 'piper', speaker: 'local-host' }, newcomer: { backend: 'piper', speaker: 'new' } };
  save(f.sourceFile, f.source); save(f.configFile, f.raw); f.bound();
  const config = resolveConfig(f.raw, { voiceA: 'first', voiceB: 'second' }, f.project);
  assert.deepEqual(Object.keys(config.voices), ['host', 'guest', 'newcomer']); assert.equal(config.voices.host.speaker, 'first'); assert.equal(config.voices.guest.speaker, 'second');
  assert.equal(config.voices.host.label, 'narrator · HOST'); assert.equal(config.voices.host.color, '#2ee6d6'); assert.equal(config.voices.guest.color, '#ff7eb6');
  const restored = configFromManifest(compile(config)); assert.deepEqual(Object.keys(restored.voices), ['host', 'guest', 'newcomer']);
});

test('explicit shared voiceOrder is validated and retained independently of map serialization', t => {
  const f = fixture(t); f.source.defaults.voices = { host: {}, guest: {} }; f.source.voiceOrder = ['guest', 'host']; save(f.sourceFile, f.source); f.bound();
  assert.deepEqual(Object.keys(f.resolved().voices), ['guest', 'host']);
  f.source.voiceOrder = ['host']; save(f.sourceFile, f.source); assert.throws(() => series.inspectSource(f.sourceFile), /every shared voice/);
});

test('removals precede episode values; captions disablement and product defaults remain explicit', t => {
  const f = fixture(t); f.source.defaults.voices = { host: { backend: 'piper' }, guest: { backend: 'piper' } }; f.source.defaults.captions = { preset: 'karaoke', maxWords: 4 };
  f.raw.seriesOverrides = { remove: { voices: ['guest'], theme: ['accent'], captions: ['maxWords'] } }; f.raw.voices = { newcomer: {} }; f.raw.theme = { bg: '#010203' };
  save(f.sourceFile, f.source); save(f.configFile, f.raw); f.bound(); const config = f.resolved();
  assert.deepEqual(Object.keys(config.voices), ['host', 'newcomer']); assert.equal(config.captions.maxWords, null); assert.equal(config.captions.preset, 'karaoke'); assert.equal(config.theme.bg, '#010203');
  const info = series.inspectProject(f.project); assert.equal(info.effective.origins.theme.bg, 'episode'); assert.deepEqual(info.effective.removals.voices, ['guest']);
  f.raw.seriesOverrides.remove.voices = ['not_inherited']; save(f.configFile, f.raw); assert.throws(f.resolved, /no inherited member/);
});

test('a local caption object inherits shared disablement and can explicitly enable', t => {
  const f = fixture(t); f.source.defaults.captions = false; f.raw.captions = { plate: true }; save(f.sourceFile, f.source); save(f.configFile, f.raw); f.bound();
  assert.equal(f.resolved().captionsEnabled, false); f.raw.captions.enabled = true; save(f.configFile, f.raw); assert.equal(f.resolved().captionsEnabled, true);
});

test('unknown defaults, selectors, unsafe paths, aliases and symlinks fail before membership publication', t => {
  const f = fixture(t);
  for (const mutate of [s => s.defaults.scenes = [], s => s.resources.logo.file = '../escape', s => s.extra = true]) {
    const source = structuredClone(f.source); mutate(source); save(f.sourceFile, source); assert.throws(f.bound, /unknown field|path|parent/);
    assert.equal(fs.existsSync(path.join(f.project, series.MEMBERSHIP)), false);
  }
  save(f.sourceFile, f.source); assert.throws(() => series.bind(f.sourceFile, 'second', { context: ['absent'] }), /unknown selection/);
  fs.symlinkSync(path.join(f.root, 'media/logo.svg'), path.join(f.root, 'linked.svg')); f.source.resources.linked = { file: 'linked.svg' }; save(f.sourceFile, f.source);
  assert.throws(() => series.bind(f.sourceFile, 'second', { resources: ['linked'] }), /symlink/);
});

test('declared local dependencies retain source-relative inline markup and reject incomplete closure', t => {
  const f = fixture(t); save(path.join(f.root, 'parts/body.html'), '<img src="../media/logo.svg"><div style="background:url(../media/logo.svg)">Logo</div>');
  f.source.resources.body = { file: 'parts/body.html', dependencies: ['media/logo.svg'] }; save(f.sourceFile, f.source);
  f.raw.scenes[0] = { id: 'scene', dur: 1, vo: [], bodyFile: series.FILES + 'parts/body.html' }; save(f.configFile, f.raw);
  series.bind(f.sourceFile, 'second', { resources: ['body'] }); const config = f.resolved();
  assert.match(config.scenes[0].body, /\.narova-series\/current\/files\/media\/logo.svg/); assert.equal(sceneAssetRefs(config.scenes[0], f.project).unresolved, false);
  f.source.resources.body.dependencies = []; save(f.sourceFile, f.source); assert.throws(() => series.adopt(f.sourceFile, f.project), /undeclared dependency/);
});

test('bound provider input bytes retain ordinary identities without requiring providers for inspection', t => {
  const f = fixture(t); save(path.join(f.root, 'media/conditioning.dat'), 'voice-state');
  f.source.resources.state = { file: 'media/conditioning.dat' }; f.source.defaults.voices = { host: { backend: 'unregistered-series-provider', providerFiles: { conditioning: 'media/conditioning.dat' } } }; save(f.sourceFile, f.source);
  f.bound(); assert.equal(series.inspectProject(f.project).effective.defaults.voices.host.providerFiles.conditioning, series.FILES + 'media/conditioning.dat');
  assert.throws(f.resolved, /unregistered external provider/);
});

test('executable episode inspection, compare, bind and adoption never evaluate its config', t => {
  const f = fixture(t); fs.unlinkSync(f.configFile); const sentinel = path.join(f.root, 'executed');
  save(path.join(f.project, 'reel.config.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'ran'); module.exports = ${JSON.stringify(f.raw)};`);
  f.bound(); assert.equal(series.inspectProject(f.project).effective.status, 'unavailable');
  f.source.context.vocabulary.text = 'Changed'; save(f.sourceFile, f.source); series.compare(f.sourceFile, f.project); series.adopt(f.sourceFile, f.project);
  assert.equal(fs.existsSync(sentinel), false);
  const result = run(['series', 'inspect', '--project', f.project, '--json']); assert.equal(result.status, 0, result.stderr); const payload = JSON.parse(result.stdout);
  assert.equal(payload.operation, 'series'); assert.equal(payload.data.action, 'inspect'); assert.equal(fs.existsSync(sentinel), false);
});

test('context-only adoption and overridden defaults preserve execution and speech identities', t => {
  const f = fixture(t, { context: ['vocabulary'] }); f.raw.theme = { accent: '#001122' }; save(f.configFile, f.raw); const first = f.bound(); const before = f.resolved();
  f.source.context.vocabulary.text = 'An authored correction.'; f.source.defaults.theme.accent = '#ff0000'; save(f.sourceFile, f.source);
  const report = series.compare(f.sourceFile, f.project); assert.equal(report.contextChanged, true); assert.deepEqual(report.runtime.changedDefaults, []);
  series.adopt(f.sourceFile, f.project); const after = f.resolved(); assert.notEqual(after.seriesBinding.revision, first.revision);
  assert.equal(hashConfig(before), hashConfig(after)); assert.equal(audioFingerprint(before), audioFingerprint(after)); assert.deepEqual(compile(before).hashes, compile(after).hashes);
  const restored = configFromManifest(compile(after)); assert.equal(restored.seriesBinding.revision, after.seriesBinding.revision);
});

test('consumed file changes alter only applicable identities; unused files do not alter exact scene refs', t => {
  const f = fixture(t, { resources: ['logo'] }); f.raw.scenes[0].visual = { type: 'image', src: series.FILES + 'media/logo.svg', x: 0, y: 0, w: 10, h: 10 }; save(f.configFile, f.raw);
  f.bound(); const before = f.resolved(), first = compile(before);
  save(path.join(f.root, 'media/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="blue"/></svg>');
  assert.deepEqual(compile(f.resolved()).hashes, first.hashes); series.adopt(f.sourceFile, f.project); const after = f.resolved(), second = compile(after);
  assert.equal(audioFingerprint(before), audioFingerprint(after)); assert.notDeepEqual(first.scenes[0].assets, second.scenes[0].assets);
});

test('corrupt/missing retained bytes and missing binding fail even when a live source remains', t => {
  const f = fixture(t, { resources: ['logo'] }); f.bound(); const retained = path.join(f.project, series.FILES, 'media/logo.svg');
  save(retained, 'changed'); assert.throws(f.resolved, /identity mismatch/); fs.unlinkSync(retained); assert.throws(f.resolved, /missing file/);
  fs.unlinkSync(path.join(f.project, series.BINDING)); assert.throws(f.resolved, /incomplete/);
});

test('adoption and restoration preserve episode source/outputs and never change sibling projects', t => {
  const f = fixture(t); const first = f.bound(); save(path.join(f.project, 'out/video.mp4'), 'prior video'); const authored = fs.readFileSync(f.configFile);
  f.source.defaults.theme.accent = '#ff1122'; save(f.sourceFile, f.source); const adopted = series.adopt(f.sourceFile, f.project); assert.notEqual(adopted.revision, first.revision);
  assert.equal(f.resolved().theme.accent, '#ff1122'); const restored = series.restore(first.revision, f.project); assert.equal(restored.revision, first.revision); assert.equal(f.resolved().theme.accent, '#abcdef');
  assert.deepEqual(fs.readFileSync(f.configFile), authored); assert.equal(fs.readFileSync(path.join(f.project, 'out/video.mp4'), 'utf8'), 'prior video'); assert.equal(fs.existsSync(path.join(f.root, 'episodes/first')), false);
});

test('publication failure restores the prior selection and initial failure leaves no membership', t => {
  const f = fixture(t); const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === path.join(f.project, series.CURRENT)) throw new Error('injected publish failure'); return rename(from, to); };
  try { assert.throws(f.bound, /injected publish/); } finally { fs.renameSync = rename; }
  assert.equal(fs.existsSync(path.join(f.project, series.MEMBERSHIP)), false);
  const first = f.bound(); f.source.defaults.theme.accent = '#00ffee'; save(f.sourceFile, f.source); let once = true;
  fs.renameSync = (from, to) => { if (once && to === path.join(f.project, series.CURRENT) && path.basename(from).startsWith('.stage-')) { once = false; throw new Error('injected adoption failure'); } return rename(from, to); };
  try { assert.throws(() => series.adopt(f.sourceFile, f.project), /injected adoption/); } finally { fs.renameSync = rename; }
  assert.equal(series.readBinding(f.project).revision, first.revision); assert.equal(f.resolved().theme.accent, '#abcdef');
});

test('post-commit cleanup failure retains the successful binding and a recoverable backup', t => {
  const f = fixture(t); f.bound(); f.source.defaults.theme.accent = '#445566'; save(f.sourceFile, f.source); const remove = fs.rmSync;
  fs.rmSync = (file, options) => { if (path.basename(file).startsWith('.backup-')) throw new Error('injected cleanup failure'); return remove(file, options); };
  try { assert.equal(series.adopt(f.sourceFile, f.project).committed, true); } finally { fs.rmSync = remove; }
  assert.equal(f.resolved().theme.accent, '#445566'); assert.equal(fs.readdirSync(path.join(f.project, series.HOME)).some(name => name.startsWith('.backup-')), true);
});

test('handoff is identity-bound authored state and does not advance the catalog or incoming state', t => {
  const f = fixture(t, { incoming: 'after_first' }); f.bound(); const oldSource = fs.readFileSync(f.sourceFile), binding = series.readBinding(f.project);
  const file = path.join(f.root, 'handoff.json'); save(file, { facts: { introduced: ['orbit', 'gravity'] }, note: 'Authored next lesson context' }); const result = series.handoff(file, f.project);
  assert.equal(result.sha256, series.digest(result.value)); assert.deepEqual(fs.readFileSync(f.sourceFile), oldSource); assert.equal(series.readBinding(f.project).revision, binding.revision);
});

test('bound pack/open/remix exclude history/unselected context and verify current identities without providers', async t => {
  const f = fixture(t, { resources: ['logo'], context: ['vocabulary'] }); f.bound(); f.source.defaults.theme.accent = '#665544'; save(f.sourceFile, f.source); series.adopt(f.sourceFile, f.project);
  const file = path.join(f.root, 'episode.narova'); const packed = archive.packProject({ projectDir: f.project, raw: f.raw, config: f.resolved(), configFile: f.configFile, output: file, productVersion: '0.53.0' });
  assert.equal(packed.manifest.members.some(e => e.path.includes('/history/')), false); assert.equal(fs.readFileSync(file).includes(Buffer.from('spoiler')), false);
  fs.rmSync(f.sourceFile); const opened = path.join(f.root, 'opened'); archive.openArchive(file, opened);
  assert.equal(resolveConfig(f.raw, {}, opened).theme.accent, '#665544'); const remixed = path.join(f.root, 'remixed'); await archive.remix(file, remixed); assert.equal(series.readBinding(remixed).series.id, 'course');
  assert.equal(fs.existsSync(path.join(opened, 'out')), false); assert.equal(fs.existsSync(path.join(opened, series.HOME, 'history')), false);
});

test('detach JSON and executable projects publishes equivalent ordinary sources without evaluating source', async t => {
  for (const executable of [false, true]) {
    const f = fixture(t, { resources: ['logo'], context: ['vocabulary'] }); const before = f.bound(); const sentinel = path.join(f.root, 'executed');
    if (executable) { fs.unlinkSync(f.configFile); save(path.join(f.project, 'reel.config.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinel)}, 'ran'); export default ${JSON.stringify(f.raw)};`); }
    const target = path.join(f.root, 'detached'); const result = series.detach(f.project, target); assert.equal(result.committed, true); assert.equal(fs.existsSync(sentinel), false);
    assert.equal(series.readBinding(target), null); assert.equal(series.readBinding(f.project).revision, before.revision);
    const { loadProjectConfig } = require('../src/config'); const loaded = await loadProjectConfig(target); const resolved = resolveConfig(loaded.raw, {}, target);
    assert.equal(resolved.seriesBinding, undefined); assert.equal(resolved.theme.accent, '#abcdef'); assert.equal(resolved.localResources.includes(series.FILES + 'media/logo.svg'), true);
    assert.throws(() => series.detach(f.project, target), /already exists/);
  }
});

test('detach validation, copy and publication failures preserve source/output and publish no partial destination', t => {
  const f = fixture(t, { resources: ['logo'] }); const before = f.bound(); save(path.join(f.project, 'out/video.mp4'), 'verified prior');
  const target = path.join(f.root, 'detached'), write = fs.writeFileSync, rename = fs.renameSync;
  fs.writeFileSync = (file, ...args) => { if (String(file).includes('.detached.stage-')) throw new Error('injected copy failure'); return write(file, ...args); };
  try { assert.throws(() => series.detach(f.project, target), /injected copy/); } finally { fs.writeFileSync = write; }
  assert.equal(fs.existsSync(target), false);
  fs.renameSync = (from, to) => { if (to === target) throw new Error('injected detach publication'); return rename(from, to); };
  try { assert.throws(() => series.detach(f.project, target), /injected detach publication/); } finally { fs.renameSync = rename; }
  assert.equal(fs.existsSync(target), false); assert.equal(series.readBinding(f.project).revision, before.revision); assert.equal(fs.readFileSync(path.join(f.project, 'out/video.mp4'), 'utf8'), 'verified prior');
});

test('concurrent managed mutation fails with a recovery action rather than overwriting', t => {
  const f = fixture(t); f.bound(); fs.mkdirSync(path.join(f.project, series.HOME, 'lock'));
  assert.throws(() => series.adopt(f.sourceFile, f.project), /busy managed mutation.*recover/);
});

test('canonical binding identities preserve array order and sort Unicode/integer object keys', () => {
  assert.equal(series.canonical({ '2': 'two', '10': 'ten', '\u{10000}': 'astral', '\ue000': 'bmp' }), '{"10":"ten","2":"two","\ue000":"bmp","\u{10000}":"astral"}');
  assert.notEqual(series.digest({ voiceOrder: ['host', 'guest'] }), series.digest({ voiceOrder: ['guest', 'host'] }));
});

test('ordinary planner reports consumed resource edits and keeps unconsumed selections reusable', t => {
  const f = fixture(t, { resources: ['logo'] }); f.raw.scenes[0].visual = { type: 'image', src: series.FILES + 'media/logo.svg', x: 0, y: 0, w: 10, h: 10 }; save(f.configFile, f.raw); f.bound();
  const old = path.join(f.root, 'old-manifest.json'); save(old, compile(f.resolved()));
  const { plan } = require('../src/plan'); assert.equal(plan(old, f.resolved()).level.render, false);
  save(path.join(f.root, 'media/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" fill="green"/></svg>'); series.adopt(f.sourceFile, f.project);
  assert.equal(plan(old, f.resolved()).level.render, true);
  const f2 = fixture(t, { resources: ['logo'] }); f2.bound(); save(old, compile(f2.resolved()));
  save(path.join(f2.root, 'media/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5" fill="blue"/></svg>'); series.adopt(f2.sourceFile, f2.project);
  assert.equal(plan(old, f2.resolved()).level.render, false);
});

test('release source snapshots retain the selected binding and restore into an independent project', async t => {
  const f = fixture(t, { resources: ['logo'], context: ['vocabulary'] }); const first = f.bound();
  const releasesDir = path.join(f.root, 'releases'); const prior = process.env.NAROVA_RELEASES_DIR; process.env.NAROVA_RELEASES_DIR = releasesDir;
  delete require.cache[require.resolve('../src/releases')]; const releases = require('../src/releases');
  t.after(() => { if (prior === undefined) delete process.env.NAROVA_RELEASES_DIR; else process.env.NAROVA_RELEASES_DIR = prior; delete require.cache[require.resolve('../src/releases')]; });
  const out = path.join(f.project, 'out'); save(path.join(out, 'manifest.json'), compile(f.resolved()));
  const saved = await releases.save(path.join(out, 'manifest.json'), 'series-proof', { projectDir: f.project, configSource: { file: f.configFile, raw: f.raw, sourceBytes: fs.readFileSync(f.configFile) } });
  assert.equal(series.readBinding(saved.dir).revision, first.revision); assert.equal(fs.existsSync(path.join(saved.dir, series.HOME, 'history')), false);
  const target = path.join(f.root, 'restored'); await releases.restore('series-proof', path.join(target, 'out'), { newProject: target });
  assert.equal(series.readBinding(target).revision, first.revision); assert.equal(resolveConfig(f.raw, {}, target).theme.accent, '#abcdef');
});

test('a bound external-voice archive opens without registration and ordinary resolution still requires it', t => {
  const f = fixture(t); const prior = process.env.NAROVA_HOME; const home = path.join(f.root, 'provider-home'); process.env.NAROVA_HOME = home;
  t.after(() => { if (prior === undefined) delete process.env.NAROVA_HOME; else process.env.NAROVA_HOME = prior; });
  save(path.join(home, 'providers/series-provider.json'), { name: 'series-provider', protocol: 'narova-tts-provider/v1', command: [process.execPath, '-e', 'process.exit(0)'], capabilities: { synthesis: true } });
  save(path.join(f.root, 'media/state.bin'), 'conditioning'); f.source.resources.voice_state = { file: 'media/state.bin' }; f.source.defaults.voices = { host: { backend: 'series-provider', providerFiles: { state: 'media/state.bin' } } }; save(f.sourceFile, f.source); f.bound();
  const file = path.join(f.root, 'external.narova'); archive.packProject({ projectDir: f.project, raw: f.raw, config: f.resolved(), configFile: f.configFile, output: file, productVersion: '0.53.0' });
  fs.rmSync(path.join(home, 'providers'), { recursive: true }); const target = path.join(f.root, 'recipient'); archive.openArchive(file, target);
  assert.equal(series.inspectProject(target).effective.status, 'available'); assert.throws(() => resolveConfig(f.raw, {}, target), /unregistered external provider/);
});

test('both renderers receive selected images and real MP4 reuse follows consumed bytes', t => {
  const available = spawnSync('ffmpeg', ['-version']).status === 0;
  try { require('@napi-rs/canvas'); } catch { t.skip('requires @napi-rs/canvas'); return; }
  if (!available) { t.skip('requires ffmpeg'); return; }
  const f = fixture(t, { resources: ['logo'], context: ['vocabulary'] });
  save(path.join(f.root, 'media/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
  const audio = path.join(f.project, 'narration.wav'); const generated = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1', audio]); assert.equal(generated.status, 0);
  f.raw.narration = { file: 'narration.wav' }; f.raw.size = { w: 64, h: 36 }; f.raw.scenes[0].visual = { type: 'image', src: series.FILES + 'media/logo.svg', style: { fit: 'fill' } };
  save(f.configFile, f.raw); f.bound(); const config = f.resolved(); const out = path.join(f.project, 'out'); const { build } = require('../src/pipeline');
  build(config, { out, projectDir: f.project, fps: 5, quality: 'draft', log() {} }); const video = path.join(out, 'video.mp4'); const first = fs.readFileSync(video);
  const pixel = () => spawnSync('ffmpeg', ['-v', 'error', '-ss', '0.4', '-i', video, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).stdout;
  const red = pixel(); assert.ok(red[0] > red[2] + 100, 'selected red SVG reached the real encoded video');
  f.source.context.vocabulary.text = 'Updated context'; save(f.sourceFile, f.source); series.adopt(f.sourceFile, f.project); const logs = [];
  build(f.resolved(), { out, projectDir: f.project, fps: 5, quality: 'draft', log: value => logs.push(value) }); assert.deepEqual(fs.readFileSync(video), first); assert.match(logs.join('\n'), /rendering nothing/);
  const browser = resolveConfig({ ...f.raw, renderer: 'hyperframes' }, {}, f.project); const composed = require('../src/compose').compose(browser, out);
  const browserDir = composed.dir || composed.project; assert.deepEqual(fs.readFileSync(path.join(browserDir, series.FILES, 'media/logo.svg')), fs.readFileSync(path.join(f.project, series.FILES, 'media/logo.svg')));
  save(path.join(f.root, 'media/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>'); series.adopt(f.sourceFile, f.project);
  build(f.resolved(), { out, projectDir: f.project, fps: 5, quality: 'draft', log() {} }); const blue = pixel(); assert.ok(blue[2] > blue[0] + 100, 'adopted blue SVG reached the real encoded video');
  assert.notDeepEqual(fs.readFileSync(video), first); assert.throws(() => build(config, { out, projectDir: f.project }), /selection changed/);
});

test('declared transitive resource bytes affect bound and detached consumer identities', async t => {
  const f = fixture(t); f.source.resources.outer = { file: 'media/outer.svg', dependencies: ['media/logo.svg'] }; save(path.join(f.root, 'media/outer.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><image href="logo.svg"/></svg>'); save(f.sourceFile, f.source);
  f.raw.scenes[0].visual = { type: 'image', src: series.FILES + 'media/outer.svg' }; save(f.configFile, f.raw); series.bind(f.sourceFile, 'second', { resources: ['outer'] });
  const first = compile(f.resolved()); const old = path.join(f.root, 'old.json'); save(old, first);
  save(path.join(f.root, 'media/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><circle r="8" fill="blue"/></svg>'); series.adopt(f.sourceFile, f.project); const second = compile(f.resolved());
  assert.notDeepEqual(first.scenes[0].assets, second.scenes[0].assets); assert.equal(require('../src/plan').plan(old, f.resolved()).level.render, true);
  const target = path.join(f.root, 'detached'); series.detach(f.project, target); const loaded = await require('../src/config').loadProjectConfig(target); assert.deepEqual(compile(resolveConfig(loaded.raw, {}, target)).scenes[0].assets, second.scenes[0].assets);
});

test('retained defaults cannot escape the declared resource closure even with a recomputed binding digest', t => {
  const f = fixture(t, { resources: ['logo'] }); f.bound(); const binding = series.readBinding(f.project);
  binding.defaults.voices = { host: { backend: 'unregistered-provider', providerFiles: { state: '../../../../outside.dat' } } }; binding.voiceOrder = ['host']; const { revision, ...body } = binding; binding.revision = series.digest(body);
  assert.throws(() => series.validateBinding(binding), /path|closure|resource/);
});

test('selected executable markup with unproven dependencies fails before publication', t => {
  const f = fixture(t); save(path.join(f.root, 'parts/body.html'), '<script>fetch("./" + window.asset)</script>'); f.source.resources.dynamic = { file: 'parts/body.html' }; save(f.sourceFile, f.source);
  assert.throws(() => series.bind(f.sourceFile, 'second', { resources: ['dynamic'] }), /closure|executable|dynamic/);
});

test('selected declarative visual files pack with source-relative local dependencies', t => {
  const f = fixture(t); save(path.join(f.root, 'parts/visual.json'), { type: 'image', src: '../media/logo.svg' }); f.source.resources.visual = { file: 'parts/visual.json', dependencies: ['media/logo.svg'] }; save(f.sourceFile, f.source); f.raw.scenes[0] = { id: 'scene', dur: 1, vo: [], visualFile: series.FILES + 'parts/visual.json' }; save(f.configFile, f.raw); series.bind(f.sourceFile, 'second', { resources: ['visual'] });
  archive.packProject({ projectDir: f.project, raw: f.raw, config: f.resolved(), configFile: f.configFile, output: path.join(f.root, 'visual.narova'), productVersion: '0.53.0' });
});

test('detached CommonJS js default exports retain shared defaults after ordinary loader unwrapping', async t => {
  const f = fixture(t); fs.unlinkSync(f.configFile); save(path.join(f.project, 'reel.config.js'), 'module.exports = { default: ' + JSON.stringify(f.raw) + ' };'); f.bound(); const target = path.join(f.root, 'detached'); series.detach(f.project, target);
  const loaded = await require('../src/config').loadProjectConfig(target); assert.equal(resolveConfig(loaded.raw, {}, target).theme.accent, '#abcdef');
});

test('falsy or malformed override/removal declarations are rejected rather than treated as absent', t => {
  const f = fixture(t); f.bound(); for (const invalid of [null, false, 0, { remove: null }, { remove: false }, { remove: { theme: false } }]) assert.throws(() => resolveConfig({ ...f.raw, seriesOverrides: invalid }, {}, f.project), /seriesOverrides/);
});

test('restore repairs a missing current binding while retaining its explicit membership identity', t => {
  const f = fixture(t); const first = f.bound(); f.source.defaults.theme.accent = '#112233'; save(f.sourceFile, f.source); series.adopt(f.sourceFile, f.project); fs.unlinkSync(path.join(f.project, series.BINDING));
  assert.throws(f.resolved, /incomplete/); assert.equal(series.restore(first.revision, f.project).revision, first.revision); assert.equal(f.resolved().theme.accent, '#abcdef');
});

test('initial membership rollback failure reports and retains verified recovery material', t => {
  const f = fixture(t); const rename = fs.renameSync, unlink = fs.unlinkSync;
  fs.renameSync = (from, to) => { if (to === path.join(f.project, series.CURRENT)) throw new Error('publish failure'); return rename(from, to); };
  fs.unlinkSync = file => { if (file === path.join(f.project, series.MEMBERSHIP)) throw new Error('rollback failure'); return unlink(file); };
  try { assert.throws(f.bound, /membership rollback failed.*recover verified binding at/); } finally { fs.renameSync = rename; fs.unlinkSync = unlink; }
  const stage = fs.readdirSync(path.join(f.project, series.HOME)).find(name => name.startsWith('.stage-')); assert.ok(stage); assert.ok(fs.existsSync(path.join(f.project, series.HOME, stage, 'binding.json')));
});

test('a fresh detach target created during staging is preserved and fails publication', t => {
  const f = fixture(t); f.bound(); const target = path.join(f.root, 'detached'), write = fs.writeFileSync; let once = true;
  fs.writeFileSync = (file, ...args) => { if (once && String(file).includes('.detached.stage-')) { once = false; fs.mkdirSync(target); write(path.join(target, 'keep.txt'), 'concurrent source'); } return write(file, ...args); };
  try { assert.throws(() => series.detach(f.project, target), /target already exists/); } finally { fs.writeFileSync = write; }
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'concurrent source'); assert.equal(fs.existsSync(path.join(target, 'reel.config.json')), false);
});

test('series operation failures retain action in the machine envelope', () => {
  const result = run(['series', 'restore', 'not-a-digest', '--json']); assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).data.action, 'restore');
});

test('shared media in assembly character parts is selected automatically and rebased', t => {
  const f = fixture(t); save(path.join(f.root, 'media/actor.glb'), 'declared model bytes'); f.source.resources.actor = { file: 'media/actor.glb' }; f.source.defaults.characters = { actor: { parts: [{ type: 'model', src: 'media/actor.glb' }] } }; save(f.sourceFile, f.source); f.bound();
  const binding = series.readBinding(f.project); assert.equal(binding.resources.actor.file, 'media/actor.glb'); assert.equal(f.resolved().characters.actor.parts[0].src, series.FILES + 'media/actor.glb');
});

test('isolated browser projects mount retained images and declared font URLs', t => {
  const f = fixture(t, { resources: ['logo'] }); f.raw.renderer = 'hyperframes'; f.raw.scenes[0].visual = { type: 'image', src: series.FILES + 'media/logo.svg' }; save(f.configFile, f.raw); f.bound();
  const audio = path.join(f.project, 'audio.wav'); const made = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1', audio]); if (made.error?.code === 'ENOENT') { t.skip('requires ffmpeg'); return; } assert.equal(made.status, 0);
  const config = resolveConfig({ ...f.raw, narration: { file: 'audio.wav' } }, {}, f.project); const out = path.join(f.project, 'out'); const { writeStageInputs } = require('../src/pipeline'); writeStageInputs(config, out); save(path.join(out, 'timings.json'), require('../src/timing').externalTimings(config));
  const compose = require('../src/compose'); compose.compose(config, out); const span = compose.composeSceneProject(config, out, 0); assert.equal(fs.existsSync(path.join(span.dir, series.FILES, 'media/logo.svg')), true);
  const font = series.FILES + 'fonts/author.ttf'; assert.match(compose.buildFontFaces({ localResources: [font], scenes: [{ visual: { type: 'text', style: { fontFamily: 'author', fontFile: font } } }] }), /url\("\.narova-series\/current\/files\/fonts\/author.ttf"\)/);
});

test('history aliases cannot restore a different independently valid revision', t => {
  const f = fixture(t); const first = f.bound(); f.source.defaults.theme.accent = '#ff0011'; save(f.sourceFile, f.source); const second = series.adopt(f.sourceFile, f.project);
  const retained = path.join(f.project, series.HOME, 'history', first.revision); fs.rmSync(retained, { recursive: true }); fs.cpSync(path.join(f.project, series.CURRENT), retained, { recursive: true });
  assert.throws(() => series.restore(first.revision, f.project), /does not match requested revision/); assert.equal(series.readBinding(f.project).revision, second.revision);
});

test('compare reports effective voice-order and selected advisory catalog changes separately', t => {
  const f = fixture(t); f.source.defaults.voices = { host: {}, guest: {} }; save(f.sourceFile, f.source); f.bound();
  f.source.voiceOrder = ['guest', 'host']; f.source.episodes[1].group = 'Revised module'; save(f.sourceFile, f.source); const change = series.compare(f.sourceFile, f.project);
  assert.equal(change.runtime.voiceOrderChanged, true); assert.equal(change.contextChanged, true);
});

test('catalog locators cannot publish through an ancestor symlink outside the declared series', t => {
  const f = fixture(t); const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside); save(path.join(outside, 'reel.config.cjs'), 'module.exports = ' + JSON.stringify(f.raw)); fs.symlinkSync(outside, path.join(f.root, 'linked')); f.source.episodes[1].project = 'linked'; save(f.sourceFile, f.source);
  assert.throws(f.bound, /symlink project locator/); assert.equal(fs.existsSync(path.join(outside, series.MEMBERSHIP)), false);
});

test('release snapshot rejects a selected file changed during copying before publication', async t => {
  const f = fixture(t, { resources: ['logo'] }); f.bound(); const prior = process.env.NAROVA_RELEASES_DIR; process.env.NAROVA_RELEASES_DIR = path.join(f.root, 'releases'); delete require.cache[require.resolve('../src/releases')];
  t.after(() => { if (prior === undefined) delete process.env.NAROVA_RELEASES_DIR; else process.env.NAROVA_RELEASES_DIR = prior; delete require.cache[require.resolve('../src/releases')]; });
  const manifest = path.join(f.project, 'out/manifest.json'); save(manifest, compile(f.resolved())); const copy = fs.copyFileSync; let once = true;
  fs.copyFileSync = (from, to, ...args) => { if (once && String(to).includes(series.FILES + 'media/logo.svg')) { once = false; save(from, 'changed during copying'); } return copy(from, to, ...args); };
  try { await assert.rejects(() => require('../src/releases').save(manifest, 'bad-series', { projectDir: f.project, configSource: { file: f.configFile, raw: f.raw, sourceBytes: fs.readFileSync(f.configFile) } }), /identity mismatch/); }
  finally { fs.copyFileSync = copy; }
  assert.equal(fs.existsSync(path.join(process.env.NAROVA_RELEASES_DIR, 'bad-series')), false);
});

test('named ESM exports retain ordinary loader behavior after detachment', async t => {
  const f = fixture(t); fs.unlinkSync(f.configFile); save(path.join(f.project, 'reel.config.mjs'), `export const title='Episode'; export const renderer='no-browser'; export const scenes=${JSON.stringify(f.raw.scenes)};`);
  series.bind(f.sourceFile, 'second'); const target = path.join(f.root, 'detached'); series.detach(f.project, target);
  const raw = await loadConfigFile(path.join(target, 'reel.config.mjs'));
  assert.equal(resolveConfig(raw, {}, target).title, 'Episode');
});

test('detached ESM can be packed as an ordinary portable project', async t => {
  const f = fixture(t); fs.unlinkSync(f.configFile); save(path.join(f.project, 'reel.config.mjs'), `export default ${JSON.stringify(f.raw)};`);
  series.bind(f.sourceFile, 'second'); const target = path.join(f.root, 'detached'); series.detach(f.project, target);
  const raw = await loadConfigFile(path.join(target, 'reel.config.mjs')); const config = resolveConfig(raw, {}, target);
  const result = archive.packProject({ projectDir: target, raw, config, configFile: path.join(target, 'reel.config.mjs'), output: path.join(f.root, 'detached.narova'), productVersion: '0.53.0' });
  assert.ok(result);
});

test('selected event-handler markup cannot hide dynamic resource closure', t => {
  const f = fixture(t); save(path.join(f.root, 'parts/body.html'), '<img onload="fetch(window.remoteAsset)">');
  f.source.resources.body = { file: 'parts/body.html' }; save(f.configFile, f.raw); save(f.sourceFile, f.source);
  assert.throws(() => series.bind(f.sourceFile, 'second', { resources: ['body'] }), /closure|executable/);
  assert.equal(fs.existsSync(path.join(f.project, series.MEMBERSHIP)), false);
});

test('exchanged bindings require recorded voice order before publication', t => {
  const f = fixture(t); f.source.defaults.voices = { host: { backend: 'piper' } }; save(f.configFile, f.raw); save(f.sourceFile, f.source); series.bind(f.sourceFile, 'second');
  const binding = series.readBinding(f.project); delete binding.voiceOrder; const { revision, ...body } = binding; binding.revision = series.digest(body); save(path.join(f.project, series.BINDING), binding);
  assert.throws(() => series.readBinding(f.project), /voiceOrder|required/);
});

test('explicit falsy catalog collections reject with attribution', t => {
  const f = fixture(t); f.source.episodes = false; save(f.sourceFile, f.source); assert.throws(() => series.inspectSource(f.sourceFile), /episodes/);
  f.source.episodes = [{ id: 'second', title: 'One', relationships: false }]; save(f.sourceFile, f.source); assert.throws(() => series.inspectSource(f.sourceFile), /relationships/);
});

test('context-only binding adoption preserves proof and delivery execution identity', t => {
  const f = fixture(t); series.bind(f.sourceFile, 'second', { context: ['vocabulary'] }); const before = compile(f.resolved());
  f.source.context.vocabulary.text = 'After'; save(f.sourceFile, f.source); series.adopt(f.sourceFile, f.project); const after = compile(f.resolved());
  after.environment.compiled = before.environment.compiled;
  const a = path.join(f.root, 'a.json'), b = path.join(f.root, 'b.json'); save(a, before); save(b, after);
  assert.equal(require('../src/proof-receipt')._internals.stableManifestHash(a), require('../src/proof-receipt')._internals.stableManifestHash(b));
  assert.equal(require('../src/revisions').manifestIdentity(before), require('../src/revisions').manifestIdentity(after));
});

test('bound explicit captions true works when shared captions are absent', t => {
  const f = fixture(t); f.raw.captions = true; save(f.configFile, f.raw); save(f.sourceFile, f.source); assert.throws(f.resolved, /captions/);
  series.bind(f.sourceFile, 'second'); assert.equal(f.resolved().captionsEnabled, true);
});

test('series JSON bounds do not restrict ordinary episode JSON size', t => {
  const f = fixture(t); delete f.raw.scenes[0].visual; f.raw.scenes[0].body = '<div>' + 'a'.repeat(2 * 1024 * 1024) + '</div>'; save(f.configFile, f.raw); save(f.sourceFile, f.source);
  assert.ok(f.resolved()); series.bind(f.sourceFile, 'second'); assert.ok(f.resolved());
});

test('shared XTTS clone speaker files cannot become ambient inputs', t => {
  const f = fixture(t); const sample = path.join(f.root, 'ambient.wav'); save(sample, 'recording'); f.source.defaults.voices = { host: { backend: 'xtts', speaker: sample } }; save(f.configFile, f.raw); save(f.sourceFile, f.source);
  assert.throws(() => series.bind(f.sourceFile, 'second'), /speaker|clone/);
});

test('inlined selected source contributes its declared transitive consumer closure', t => {
  const f = fixture(t); save(path.join(f.root, 'parts/body.html'), '<link rel="stylesheet" href="../styles/card.css"><div class="card">Card</div>'); save(path.join(f.root, 'styles/card.css'), '.card{background:url(../media/logo.svg)}'); save(path.join(f.root, 'media/logo.svg'), '<svg>red</svg>');
  f.source.resources.card = { file: 'parts/body.html', dependencies: ['styles/card.css', 'media/logo.svg'] }; f.raw.scenes[0] = { id: 'main', dur: 1, vo: [], bodyFile: series.FILES + 'parts/body.html' }; save(f.configFile, f.raw); save(f.sourceFile, f.source); series.bind(f.sourceFile, 'second', { resources: ['card'] });
  const before = compile(f.resolved()); save(path.join(f.root, 'media/logo.svg'), '<svg>blu</svg>'); series.adopt(f.sourceFile, f.project); const after = compile(f.resolved());
  const consumed = series.FILES + 'media/logo.svg'; assert.ok(before.scenes[0].assets[consumed]); assert.notEqual(before.scenes[0].assets[consumed], after.scenes[0].assets[consumed]); assert.notDeepEqual(before.hashes, after.hashes);
});

test('provider file dependencies invalidate speech and survive manifest restoration', t => {
  const f = fixture(t); const prior = process.env.NAROVA_HOME; const home = path.join(f.root, 'provider-home'); process.env.NAROVA_HOME = home;
  t.after(() => { if (prior === undefined) delete process.env.NAROVA_HOME; else process.env.NAROVA_HOME = prior; });
  save(path.join(home, 'providers/series-provider.json'), { name: 'series-provider', protocol: 'narova-tts-provider/v1', command: [process.execPath, '-e', 'process.exit(0)'], capabilities: { synthesis: true } });
  save(path.join(f.root, 'voice/profile.json'), { sample: 'reference.wav' }); save(path.join(f.root, 'voice/reference.wav'), 'first recording');
  f.source.resources.profile = { file: 'voice/profile.json', dependencies: ['voice/reference.wav'] };
  f.source.defaults.voices = { host: { backend: 'series-provider', providerFiles: { profile: 'voice/profile.json' } } }; save(f.sourceFile, f.source); f.bound();
  const before = f.resolved(); const manifest = compile(before); const file = series.FILES + 'voice/reference.wav';
  assert.equal(before.voices.host.providerDependencyInputs.profile[file], require('../src/manifest').hashFile(path.join(f.project, file)));
  assert.deepEqual(configFromManifest(manifest).voices.host.providerDependencyInputs, before.voices.host.providerDependencyInputs);
  save(path.join(f.root, 'voice/reference.wav'), 'second recording'); series.adopt(f.sourceFile, f.project); const after = f.resolved();
  assert.notEqual(audioFingerprint(before), audioFingerprint(after));
  assert.notEqual(require('../src/audio-fingerprint').narrationContextDigest(before), require('../src/audio-fingerprint').narrationContextDigest(after));
  const priorManifest = path.join(f.root, 'before.json'); save(priorManifest, manifest);
  assert.equal(require('../src/plan').plan(priorManifest, after).level.tts, true);
});

test('global stylesheet consumers expand their complete retained closure after restoration', t => {
  const f = fixture(t); save(path.join(f.root, 'styles/main.css'), '.card{background:url(../media/icon.svg)}');
  save(path.join(f.root, 'media/icon.svg'), '<svg><image href="detail.svg"/></svg>'); save(path.join(f.root, 'media/detail.svg'), '<svg>red</svg>');
  f.source.resources.style = { file: 'styles/main.css', dependencies: ['media/icon.svg', 'media/detail.svg'] };
  f.raw.theme = { css: series.FILES + 'styles/main.css' }; save(f.sourceFile, f.source); save(f.configFile, f.raw); series.bind(f.sourceFile, 'second', { resources: ['style'] });
  const before = compile(f.resolved()); const key = 'globalasset:' + series.FILES + 'media/detail.svg';
  assert.ok(before.hashes[key]); assert.equal(configFromManifest(before).themeCssFile, series.FILES + 'styles/main.css');
  save(path.join(f.root, 'media/detail.svg'), '<svg>blue</svg>'); series.adopt(f.sourceFile, f.project);
  assert.notEqual(before.hashes[key], compile(f.resolved()).hashes[key]);
});

test('each resource proves its own closure rather than borrowing another selection', t => {
  const f = fixture(t); save(path.join(f.root, 'parts/body.html'), '<img src="../media/logo.svg">');
  f.source.resources.body = { file: 'parts/body.html' }; save(f.sourceFile, f.source);
  assert.throws(() => series.bind(f.sourceFile, 'second', { resources: ['body', 'logo'] }), /undeclared dependency/);
  assert.equal(fs.existsSync(path.join(f.project, series.MEMBERSHIP)), false);
});

test('corrupt existing history cannot displace a valid current revision', t => {
  const f = fixture(t, { resources: ['logo'] }); const first = f.bound();
  f.source.defaults.theme.accent = '#123456'; save(f.sourceFile, f.source); series.adopt(f.sourceFile, f.project); series.restore(first.revision, f.project);
  save(path.join(f.project, series.HOME, 'history', first.revision, 'files/media/logo.svg'), 'corrupt history');
  f.source.defaults.theme.accent = '#654321'; save(f.sourceFile, f.source);
  assert.throws(() => series.adopt(f.sourceFile, f.project), /identity mismatch/);
  assert.equal(series.readBinding(f.project).revision, first.revision);
});

test('history copy is verified before the current selection can be replaced', t => {
  const f = fixture(t, { resources: ['logo'] }); const first = f.bound(); f.source.defaults.theme.accent = '#123456'; save(f.sourceFile, f.source);
  const copy = fs.cpSync; fs.cpSync = (from, to, ...args) => { const result = copy(from, to, ...args); if (String(to).includes('/history/.stage-')) save(path.join(to, 'files/media/logo.svg'), 'corrupt copy'); return result; };
  try { assert.throws(() => series.adopt(f.sourceFile, f.project), /identity mismatch/); } finally { fs.cpSync = copy; }
  assert.equal(series.readBinding(f.project).revision, first.revision);
});

test('inlined module imports retain their source directory without rewriting ordinary strings', t => {
  const f = fixture(t); save(path.join(f.root, 'modules/main.js'), `import('./helper.mjs').then(m=>window.shared=m.value); const label="import('./helper.mjs')"; // import('./helper.mjs')`);
  save(path.join(f.root, 'modules/helper.mjs'), 'export const value=42;'); f.source.resources.module = { file: 'modules/main.js', dependencies: ['modules/helper.mjs'] };
  f.raw.scenes[0] = { id: 'main', dur: 1, vo: [], body: '<div>Module</div>', scriptFile: series.FILES + 'modules/main.js' }; save(f.sourceFile, f.source); save(f.configFile, f.raw); series.bind(f.sourceFile, 'second', { resources: ['module'] });
  const script = f.resolved().scenes[0]._scriptFileContents;
  assert.ok(script.includes(`import('./${series.FILES}modules/helper.mjs').then`));
  assert.ok(script.includes(`const label="import('./helper.mjs')"`)); assert.ok(script.endsWith(`// import('./helper.mjs')`));
});

test('selected glTF models use a retained directory for external buffers in every composition', t => {
  const f = fixture(t); save(path.join(f.root, 'models/mesh.gltf'), { asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin', byteLength: 12 }] }); save(path.join(f.root, 'models/mesh.bin'), Buffer.alloc(12));
  f.source.resources.model = { file: 'models/mesh.gltf', dependencies: ['models/mesh.bin'] }; f.raw.renderer = 'hyperframes'; f.raw.scenes[0] = { id: 'main', dur: 1, vo: [], three: { objects: [{ type: 'model', src: series.FILES + 'models/mesh.gltf' }] } };
  save(f.sourceFile, f.source); save(f.configFile, f.raw); series.bind(f.sourceFile, 'second', { resources: ['model'] }); const config = f.resolved();
  const body = require('../src/compose/three').threeSceneBody(config.scenes[0], { start: 0, dur: 1 }, 320, 180, config.localResources);
  assert.ok(body.includes(`fetch("${series.FILES}models/mesh.gltf")`)); assert.ok(body.includes(`parseAsync(buf,"${series.FILES}models/")`));
  const compose = require('../src/compose'); const directory = path.join(f.root, 'composition');
  require('../src/pipeline').writeStageInputs(config, directory);
  save(path.join(directory, 'timings.json'), { main: { dur: 1, turns: [], words: [] } });
  fs.mkdirSync(path.join(directory, 'audio'), { recursive: true });
  const made = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '1', path.join(directory, 'audio/full.wav')]);
  if (made.error?.code === 'ENOENT') { t.skip('requires ffmpeg'); return; } assert.equal(made.status, 0);
  const full = compose.compose(config, directory); const span = compose.composeSceneProject(config, directory, 0);
  for (const root of [full.dir, span.dir]) assert.equal(fs.existsSync(path.join(root, series.FILES, 'models/mesh.bin')), true);
});

test('release snapshots reject runtime binding drift but accept advisory and overridden revisions', async t => {
  const f = fixture(t, { context: ['vocabulary'], resources: ['logo'] }); f.bound(); const prior = process.env.NAROVA_RELEASES_DIR; process.env.NAROVA_RELEASES_DIR = path.join(f.root, 'releases'); delete require.cache[require.resolve('../src/releases')];
  t.after(() => { if (prior === undefined) delete process.env.NAROVA_RELEASES_DIR; else process.env.NAROVA_RELEASES_DIR = prior; delete require.cache[require.resolve('../src/releases')]; });
  const releases = require('../src/releases'); const manifest = path.join(f.project, 'out/manifest.json'); save(manifest, compile(f.resolved()));
  const options = { projectDir: f.project, configSource: { file: f.configFile, raw: f.raw, bytes: fs.readFileSync(f.configFile) } };
  f.source.defaults.theme.accent = '#0000ff'; save(f.sourceFile, f.source); series.adopt(f.sourceFile, f.project);
  await assert.rejects(() => releases.save(manifest, 'stale', options), /runtime inputs changed/); assert.equal(fs.existsSync(path.join(process.env.NAROVA_RELEASES_DIR, 'stale')), false);
  save(manifest, compile(f.resolved())); f.source.context.vocabulary.text = 'Context correction'; save(f.sourceFile, f.source); series.adopt(f.sourceFile, f.project);
  assert.ok(await releases.save(manifest, 'advisory', options));
  f.raw.theme = { accent: '#112233' }; save(f.configFile, f.raw); save(manifest, compile(f.resolved())); options.configSource.bytes = fs.readFileSync(f.configFile);
  f.source.defaults.theme.accent = '#ff0000'; save(f.sourceFile, f.source); series.adopt(f.sourceFile, f.project);
  assert.ok(await releases.save(manifest, 'overridden', options));
  save(manifest, compile(f.resolved())); save(path.join(f.root, 'media/logo.svg'), '<svg>unused change</svg>'); series.adopt(f.sourceFile, f.project);
  assert.ok(await releases.save(manifest, 'unused-resource', options));
});


// The CLI fixture intercepts only expensive production. Real config resolution,
// publication, selection validation and machine failure/receipt paths execute.
function buildRunner(f, { fail = false } = {}) {
  const trace = path.join(f.root, 'build-trace.jsonl');
  const hook = path.join(f.root, 'build-hook.cjs');
  save(hook, `const fs = require('fs');
const pipeline = require(${JSON.stringify(path.resolve(__dirname, '../src/pipeline'))});
pipeline.build = (config, options) => {
  fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify({ title: config.title, accent: config.theme.accent, revision: config.seriesBinding.revision, projectDir: options.projectDir, reuse: options.reuse, renderer: options.renderer, fps: options.fps, variant: config.variant }) + '\\n');
  ${fail ? "throw new Error('fixture production failure');" : 'return { seconds: 1, renderer: config.renderer };'}
};
`);
  return { trace, run: args => spawnSync(process.execPath, ['--require', hook, BIN, ...args, '--json'], { encoding: 'utf8', env: { ...process.env, NAROVA_FIRST_RUN: '0' } }) };
}

test('combined preparation initially binds, preserves local overrides and keeps repeated selectors frozen', t => {
  const f = fixture(t); f.raw.theme = { bg: '#123456' }; save(f.configFile, f.raw);
  const first = series.prepareBuild(f.sourceFile, 'second', { resources: 'logo', context: 'vocabulary', incoming: 'after_first' });
  assert.equal(first.action, 'bind'); assert.equal(first.committed, true); assert.equal(f.resolved().theme.bg, '#123456');
  const before = fs.readFileSync(f.configFile); const binding = fs.readFileSync(path.join(f.project, series.BINDING));
  f.source.defaults.theme.accent = '#ff0000'; save(f.sourceFile, f.source); fs.unlinkSync(path.join(f.root, 'media/logo.svg'));
  const repeat = series.prepareBuild(f.sourceFile, 'second', { resources: 'logo', context: 'vocabulary', incoming: 'after_first' });
  assert.equal(repeat.action, 'retained'); assert.equal(repeat.committed, false); assert.equal(repeat.revision, first.revision);
  assert.equal(f.resolved().theme.accent, '#abcdef'); assert.deepEqual(fs.readFileSync(f.configFile), before); assert.deepEqual(fs.readFileSync(path.join(f.project, series.BINDING)), binding);
});

test('combined preparation updates only on request, retains selections/history and accepts update on first use', t => {
  const f = fixture(t); const first = series.prepareBuild(f.root, 'second', { resources: 'logo', context: 'vocabulary', updateShared: true });
  assert.equal(first.action, 'bind'); f.source.defaults.theme.accent = '#00ff00'; save(f.sourceFile, f.source);
  const next = series.prepareBuild(f.root, 'second', { updateShared: true });
  assert.equal(next.action, 'adopt'); assert.equal(next.committed, true); assert.notEqual(next.revision, first.revision);
  assert.deepEqual(series.readBinding(f.project).selection.resources, ['logo']); assert.equal(f.resolved().theme.accent, '#00ff00');
  assert.equal(fs.existsSync(path.join(f.project, series.HOME, 'history', first.revision, 'binding.json')), true);
  series.prepareBuild(f.root, 'second', { updateShared: true, resources: '', context: '', incoming: '' });
  assert.deepEqual(series.readBinding(f.project).selection, { resources: [], context: [], incoming: null });
});

test('combined preparation rejects identity changes, selector drift, duplicate selectors and corrupt retained files', t => {
  const f = fixture(t, { resources: ['logo'], context: ['vocabulary'], incoming: 'after_first' }); f.bound();
  const binding = fs.readFileSync(path.join(f.project, series.BINDING));
  for (const options of [{ resources: '' }, { resources: 'logo,logo' }, { context: '' }, { incoming: '' }, { resources: 'unused' }]) {
    assert.throws(() => series.prepareBuild(f.root, 'second', options), /update-shared|unique names|unknown selection/);
    assert.deepEqual(fs.readFileSync(path.join(f.project, series.BINDING)), binding);
  }
  assert.throws(() => series.prepareBuild(f.root, 'second', { resources: 'unused' }), /--update-shared/);
  assert.throws(() => series.prepareBuild(f.root, 'first', { project: f.project, updateShared: true }), /identity/);
  f.source.id = 'different'; save(f.sourceFile, f.source);
  assert.throws(() => series.prepareBuild(f.root, 'second', { updateShared: true }), /identity/);
  f.source.id = 'course'; save(f.sourceFile, f.source);
  save(path.join(f.project, series.FILES, 'media/logo.svg'), 'corrupt');
  assert.throws(() => series.prepareBuild(f.root, 'second'), /identity|changed|corrupt/);
  assert.throws(() => series.prepareBuild(f.root, 'second', { updateShared: true }), /identity|changed|corrupt/);
});

test('combined repeated selection treats list order as irrelevant and never evaluates sibling projects', t => {
  const f = fixture(t); f.source.resources.other = { file: 'media/other.svg' }; save(path.join(f.root, 'media/other.svg'), '<svg/>');
  f.source.context.other = { text: 'Other context' }; f.source.episodes[0].project = 'episodes/first';
  const sentinel = path.join(f.root, 'sibling-executed');
  save(path.join(f.root, 'episodes/first/reel.config.cjs'), `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'wrong'); throw new Error('sibling must not load');`);
  save(f.sourceFile, f.source); series.prepareBuild(f.root, 'second', { resources: 'logo,other', context: 'vocabulary,other' });
  const repeat = series.prepareBuild(f.root, 'second', { resources: 'other,logo', context: 'other,vocabulary' });
  assert.equal(repeat.action, 'retained'); assert.equal(fs.existsSync(sentinel), false);
  assert.equal(fs.existsSync(path.join(f.root, 'episodes/first', series.MEMBERSHIP)), false);
});

test('combined CLI dispatches ordinary build options and emits one preparation/build result', t => {
  const f = fixture(t); const runner = buildRunner(f);
  const result = runner.run(['series', 'build', f.root, '--episode', 'second', '--resources', 'logo', '--reuse', '--renderer', 'no-browser', '--fps', '24']);
  assert.equal(result.status, 0, result.stderr); const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operation, 'series build'); assert.equal(envelope.data.action, 'build'); assert.equal(envelope.data.series.action, 'bind'); assert.equal(envelope.data.series.committed, true);
  assert.equal(envelope.data.renderer, 'no-browser'); assert.equal(envelope.artifacts.filter(a => a.role === 'series-binding').length, 1);
  const trace = JSON.parse(fs.readFileSync(runner.trace, 'utf8').trim());
  assert.equal(trace.projectDir, f.project); assert.equal(trace.reuse, true); assert.equal(trace.fps, '24'); assert.equal(trace.renderer, 'no-browser');
  const repeat = runner.run(['series', 'build', f.root, '--episode', 'second', '--resources', 'logo']);
  assert.equal(repeat.status, 0, repeat.stderr); const repeated = JSON.parse(repeat.stdout);
  assert.equal(repeated.data.series.action, 'retained'); assert.equal(repeated.artifacts.some(a => a.role === 'series-binding'), false);
});

test('combined CLI failures retain committed preparation facts and never claim a video', t => {
  const f = fixture(t); const runner = buildRunner(f, { fail: true });
  const result = runner.run(['series', 'build', f.root, '--episode', 'second', '--resources', 'logo']);
  assert.equal(result.status, 1, result.stderr); const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.operation, 'series build'); assert.equal(envelope.success, false); assert.equal(envelope.data.series.action, 'bind');
  assert.equal(envelope.data.series.committed, true); assert.equal(envelope.artifacts.filter(a => a.role === 'series-binding').length, 1);
  assert.equal(envelope.artifacts.some(a => a.role === 'video'), false); assert.equal(series.readBinding(f.project).revision, envelope.data.series.revision);
});

test('combined CLI usage errors precede binding, config execution and expensive production', t => {
  const f = fixture(t); const runner = buildRunner(f);
  for (const tail of [[], ['--episode', 'second', '--variant', 'a', '--variants'], ['--episode', 'second', '--config', f.configFile], ['--episode', 'second', '--renderer', 'invalid'], ['--episode', 'second', 'extra'], ['--episode', 'second', '--update-shared=false']]) {
    const result = runner.run(['series', 'build', f.root, ...tail]);
    assert.equal(result.status, 2, result.stderr); assert.equal(JSON.parse(result.stdout).operation, 'series build');
    assert.equal(fs.existsSync(path.join(f.project, series.MEMBERSHIP)), false); assert.equal(fs.existsSync(runner.trace), false);
  }
  for (const args of [['build', '--project', f.project, '--update-shared'], ['series', 'bind', f.root, '--episode', 'second', '--update-shared']]) {
    const result = runner.run(args); assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /only valid with narova series build/);
  }
});

test('combined CLI builds base and variants with the same prepared revision', t => {
  const f = fixture(t); f.raw.variants = [{ id: 'alternate', title: 'Alternate' }]; save(f.configFile, f.raw); const runner = buildRunner(f);
  const result = runner.run(['series', 'build', f.root, '--episode', 'second', '--variants']);
  assert.equal(result.status, 0, result.stderr); const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.data.series.action, 'bind'); assert.equal(envelope.data.builds.length, 2);
  const traces = fs.readFileSync(runner.trace, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(traces.length, 2); assert.equal(traces[0].revision, traces[1].revision); assert.equal(traces[1].variant, 'alternate');
});

test('check and release accept exact retained SVG/font/CSS refs with local assets', t => {
  const f = fixture(t, { resources: ['logo', 'font', 'style'] });
  f.source.resources.font = { file: 'fonts/title.ttf' };
  f.source.resources.style = { file: 'styles/brand.css', dependencies: ['media/logo.svg'] };
  save(path.join(f.root, 'fonts/title.ttf'), Buffer.from('fixture font'));
  save(path.join(f.root, 'styles/brand.css'), '.logo{background:url(../media/logo.svg)}');
  save(path.join(f.project, 'assets/local.svg'), '<svg/>');
  f.raw.theme = { css: series.FILES + 'styles/brand.css' };
  f.raw.scenes[0].body = `<img src="${series.FILES}media/logo.svg#logo"><img src="assets/local.svg">`;
  f.raw.scenes[0].visual = { type: 'group', children: [
    { type: 'svg', src: series.FILES + 'media/logo.svg' },
    { type: 'text', text: 'Title', style: { fontFile: series.FILES + 'fonts/title.ttf' } },
  ] };
  save(f.sourceFile, f.source); save(f.configFile, f.raw); f.bound();
  for (const release of [false, true]) {
    const diagnostics = [], original = console.log; console.log = () => {};
    try { assert.equal(require('../src/check').check(f.resolved(), { release, diagnostics }), true); }
    finally { console.log = original; }
    assert.equal(diagnostics.some(d => d.code === 'gate.release.asset-location'), false, JSON.stringify(diagnostics));
  }
  // A nearby unselected file is not whitelisted by the retained directory name.
  save(path.join(f.project, series.FILES, 'media/unselected.svg'), '<svg/>');
  f.raw.scenes[0].body += `<img src="${series.FILES}media/unselected.svg">`;
  save(f.configFile, f.raw);
  const result = run(['check', '--release', '--project', f.project, '--json']);
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr + result.stdout, /unselected.svg/);
});

test('checking reverifies changed or missing retained resources after resolution', t => {
  const f = fixture(t, { resources: ['logo'] }); f.bound();
  const config = f.resolved();
  const original = console.log; console.log = () => {}; t.after(() => { console.log = original; });
  save(path.join(f.project, series.FILES, 'media/logo.svg'), '<svg>changed</svg>');
  assert.equal(require('../src/check').check(config), false);
  fs.rmSync(path.join(f.project, series.FILES, 'media/logo.svg'));
  assert.equal(require('../src/check').check(config, { release: true }), false);
});
