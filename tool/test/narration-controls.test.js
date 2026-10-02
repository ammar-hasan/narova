'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { exportCache, importCache, wavFacts } = require('../src/voice-cache');
const { resolveConfig } = require('../src/schema');
const { compile } = require('../src/manifest');
const { configFromManifest, mixExternalAudio } = require('../src/pipeline');
const { composeData } = require('../src/compose/data');
const { composeDoc } = require('../src/compose/html');
const { buildSrt } = require('../src/captions');
const { audioFingerprint } = require('../src/audio-fingerprint');
const { effectAnchor } = require('../src/timing');
const { applyFinalLoudness } = require('../src/final-loudness');
const cli = path.resolve(__dirname, '../bin/narova.js');
const python = execFileSync('which', ['python3'], { encoding: 'utf8' }).trim();
const raw = () => ({ title: 'Controls', voices: { a: { speaker: 'en_US-ryan-high' } }, scenes: [{ id: 'one', body: '', vo: [{ who: 'a', text: 'Hello.' }, { who: 'a', text: 'Hidden.' }] }] });
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-controls-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function run(args, cwd, env) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout); assert.equal(data.success, true); return data;
}
function wav(file, stereo = false, gain = 1) {
  const filter = stereo ? 'aevalsrc=0.1*sin(2*PI*440*t)|0.06*sin(2*PI*880*t):s=48000:d=3' : 'sine=frequency=440:duration=3';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', filter, '-af', `volume=${gain}`, '-c:a', 'pcm_s16le', file], { stdio: 'pipe' });
}

test('turn controls validate, round trip, and separate speech from presentation identity', t => {
  const dir = temp(t), project = raw();
  project.scenes[0].vo[0].pauseAfter = 0.7; project.scenes[0].vo[1].captions = false;
  project.mix = { loudness: { target: -18 } };
  const config = resolveConfig(project, {}, dir), manifest = compile(config, { projectDir: dir });
  const restored = configFromManifest(manifest);
  assert.equal(restored.scenes[0].vo[0].pauseAfter, 0.7);
  assert.equal(restored.scenes[0].vo[1].captions, false);
  assert.deepEqual(restored.mix, { loudness: { target: -18, peak: -1.5, lra: 11 } });
  const original = audioFingerprint(config);
  config.scenes[0].vo[1].captions = true; config.mix.loudness.target = -20;
  assert.equal(audioFingerprint(config), original);
  config.scenes[0].vo[0].pauseAfter = 0.8;
  assert.notEqual(audioFingerprint(config), original);
  for (const bad of [-1, Infinity, NaN, '1']) { project.scenes[0].vo[0].pauseAfter = bad; assert.throws(() => resolveConfig(project, {}, dir), /pauseAfter/); }
  project.scenes[0].vo[0].pauseAfter = 0;
  project.scenes[0].vo[1].captions = 'false'; assert.throws(() => resolveConfig(project, {}, dir), /captions/);
  project.scenes[0].vo[1].captions = false;
  for (const target of [-71, -4, NaN, '18']) { project.mix.loudness.target = target; assert.throws(() => resolveConfig(project, {}, dir), /mix.loudness.target/); }
});

test('hidden turns retain caption boundaries, sidecars, normalized cues and dedicated external visibility', t => {
  const config = raw(); config.scenes[0].vo[1].captions = false;
  const timings = { one: { dur: 4, turns: [0, 2], words: [{ w: 'Hello.', who: 'a', si: 0, ti: 0, t0: 0, t1: 1 }, { w: 'Hidden.', who: 'a', si: 1, ti: 1, t0: 2, t1: 3 }] } };
  const data = composeData(config, timings);
  assert.equal(data.groups[0].end, 2); assert.equal(data.groups[1].hidden, true);
  assert.match(buildSrt(data), /Hidden/); assert.equal(data.scenes[0].sentences.length, 2);
  const legacy = structuredClone(timings);
  legacy.one.words.forEach(word => { delete word.ti; });
  assert.equal(composeData(config, legacy).groups[1].hidden, true, 'old synthesized timing without turn metadata still hides the authored turn');
  config.narrationSource = { file: 'external.wav', wordTimings: [{ start: 0, end: 1, words: [{ text: 'Hello.', start: 0, end: 1 }] }, { start: 2, end: 3, words: [{ text: 'Hidden.', start: 2, end: 3 }] }] };
  const html = composeDoc(config, { w: 640, h: 360 }, data, '');
  assert.match(html, /<span>Hello\.<\/span>/);
  assert.doesNotMatch(html, /<span>Hidden\.<\/span>/);
});

test('literal SFX selectors require explicit occurrence for repeats and retain global placement', () => {
  const starts = new Map([['one', 5]]), timings = { one: { words: [{ w: 'Hello,', si: 0, t0: 0.2 }, { w: 'hello!', si: 0, t0: 1.1 }, { w: 'سلام۔', si: 0, t0: 2 }] } };
  assert.equal(effectAnchor(starts, 'one', { sentence: 0, word: { text: 'HELLO', occurrence: 1 }, offset: 0.2 }, timings).time, 6.3);
  assert.equal(effectAnchor(starts, 'one', { sentence: 0, word: { text: 'سلام' } }, timings).time, 7);
  assert.throws(() => effectAnchor(starts, 'one', { sentence: 0, word: { text: 'hello' } }, timings), /matches/);
  assert.throws(() => effectAnchor(starts, 'one', { sentence: 0, word: { text: 'missing' } }, timings), /matches/);
});

test('portable context-aware sentences rebuild without provider credentials and reject tampering atomically', t => {
  const dir = temp(t), worker = path.join(dir, 'worker.py'), calls = path.join(dir, 'calls.jsonl');
  fs.writeFileSync(worker, String.raw`import sys,json,os,wave,math,struct
for line in sys.stdin:
 r=json.loads(line)
 if r['operation']=='hello':
  print(json.dumps({'ok':True,'protocol':'narova-tts-provider/v1','provider':'fixture','providerVersion':'1','capabilities':{'surroundingText':True}}),flush=True)
 else:
  if not os.environ.get('FIXTURE_TOKEN'): raise RuntimeError('keyless worker must never be called')
  with open(os.environ['CALLS'],'a') as log: log.write(json.dumps(r)+'\n')
  if r['text']==os.environ.get('FAIL_TEXT'):
   print(json.dumps({'id':r['id'],'ok':False,'error':'injected failure'}),flush=True); continue
  with wave.open(r['output'],'wb') as w:
   w.setnchannels(1);w.setsampwidth(2);w.setframerate(22050)
   w.writeframes(b''.join(struct.pack('<h',int(7000*math.sin(2*math.pi*(440+sum(map(ord,r['text']))%200)*i/22050))) for i in range(11025)))
  print(json.dumps({'id':r['id'],'ok':True,'output':r['output']}),flush=True)
`);
  fs.writeFileSync(path.join(dir, 'provider.json'), JSON.stringify({ name: 'fixture', displayName: 'Fixture', protocol: 'narova-tts-provider/v1', command: [python, worker], requiredEnvironment: ['FIXTURE_TOKEN'], capabilities: { synthesis: true, surroundingText: true } }));
  fs.writeFileSync(path.join(dir, 'reel.config.mjs'), `export default { title: 'Cache', renderer: 'no-browser', size: {w:640,h:360}, voices: { a: { backend: 'fixture', speaker: 'test' } }, timing: { tempo: 1, lead: 0.1, tail: 0.1, gapSentence: 0.1, gapTurn: 0.2 }, scenes: [{ id: 'one', visual: { type: 'group', children: [] }, vo: [{ who: 'a', text: 'First. Second.', pauseAfter: 0.4 }, { who: 'a', text: 'Last.', captions: false, pauseAfter: 0.3 }] }] };`);
  const env = { NAROVA_HOME: path.join(dir, 'home'), NAROVA_CACHE: path.join(dir, 'cache1'), NAROVA_PYTHON: python, FIXTURE_TOKEN: 'test-placeholder', CALLS: calls };
  run(['providers', 'add', 'provider.json'], dir, env);
  run(['synth', '--out', 'out1'], dir, env);
  const requests = fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests[0].context, { previousText: '', nextText: 'Second.' });
  assert.deepEqual(requests[1].context, { previousText: 'First.', nextText: '' });
  assert.deepEqual(requests[2].context, { previousText: '', nextText: '' });
  const timing = JSON.parse(fs.readFileSync(path.join(dir, 'out1/timings.json'))).one;
  assert.ok(Math.abs(timing.turns[1] - timing.words[1].t1 - 0.6) < 0.005, JSON.stringify(timing));
  const bundle = path.join(dir, 'sentences');
  const exported = run(['voice-cache', 'export', '--out', 'out1', '--dir', 'sentences'], dir, env);
  assert.equal(exported.operation, 'voice-cache export'); assert.equal(exported.data.entries, 3);
  const keyless = { ...env, FIXTURE_TOKEN: '', NAROVA_CACHE: path.join(dir, 'cache2') };
  run(['voice-cache', 'import', '--dir', 'sentences'], dir, keyless);
  run(['build', '--out', 'out2'], dir, keyless);
  assert.equal(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 3);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'out1/audio/full.wav')), fs.readFileSync(path.join(dir, 'out2/audio/full.wav')));
  assert.ok(fs.statSync(path.join(dir, 'out2/video.mp4')).size > 0);
  const relativeCache = { ...keyless, NAROVA_CACHE: path.relative(path.resolve(__dirname, '..'), path.join(dir, 'relative-cache')) };
  run(['voice-cache', 'import', '--dir', 'sentences'], dir, relativeCache);
  run(['build', '--out', 'out-relative'], dir, relativeCache);
  assert.equal(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 3, 'relative cache import and Python synthesis resolve the same directory');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'out1/audio/full.wav')), fs.readFileSync(path.join(dir, 'out-relative/audio/full.wav')));
  assert.match(fs.readFileSync(path.join(dir, 'out2/captions.srt'), 'utf8'), /Last/);
  const oldTakes = fs.readFileSync(path.join(dir, 'out1/audio/takes.json'));
  const projectFile = path.join(dir, 'reel.config.mjs');
  fs.writeFileSync(projectFile, fs.readFileSync(projectFile, 'utf8').replace('First. Second.', 'Changed. Second.').replace('Last.', 'Bad.'));
  const interrupted = spawnSync(process.execPath, [cli, 'synth', '--out', 'out1', '--force'], { cwd: dir, env: { ...process.env, ...env, FAIL_TEXT: 'Bad.' }, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(interrupted.status, 0);
  assert.equal(fs.existsSync(path.join(dir, 'out1/audio/takes.json')), false, 'incomplete generation cannot export prior keys');
  assert.throws(() => exportCache(path.join(dir, 'out1'), path.join(dir, 'incomplete')), /ENOENT/);
  fs.writeFileSync(path.join(dir, 'out1/audio/takes.json'), oldTakes);
  assert.throws(() => exportCache(path.join(dir, 'out1'), path.join(dir, 'mismatched')), /completed take record/);
  const manifestFile = path.join(bundle, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestFile));
  const priorEnv = process.env.NAROVA_CACHE; process.env.NAROVA_CACHE = path.join(dir, 'cache3');
  try {
    fs.mkdirSync(process.env.NAROVA_CACHE);
    const first = manifest.entries[0], priorFile = path.join(process.env.NAROVA_CACHE, first.file);
    const prior = Buffer.from(fs.readFileSync(path.join(bundle, first.file))); prior[prior.length - 2] ^= 1;
    fs.writeFileSync(priorFile, prior);
    assert.throws(() => importCache(bundle), /conflicting/);
    const rename = fs.renameSync; let failed = false;
    fs.renameSync = (from, to) => {
      if (!failed && to === path.join(process.env.NAROVA_CACHE, manifest.entries[1].file)) { failed = true; throw new Error('injected publication failure'); }
      return rename(from, to);
    };
    try { assert.throws(() => importCache(bundle, { overwrite: true }), /injected/); }
    finally { fs.renameSync = rename; }
    assert.deepEqual(fs.readFileSync(priorFile), prior);
    assert.equal(fs.existsSync(path.join(process.env.NAROVA_CACHE, manifest.entries[1].file)), false);
    fs.rmSync(process.env.NAROVA_CACHE, { recursive: true });
    const corrupt = path.join(bundle, manifest.entries[1].file), original = fs.readFileSync(corrupt);
    fs.writeFileSync(corrupt, original.subarray(0, original.length - 2));
    assert.throws(() => importCache(bundle), /WAV|integrity/);
    assert.equal(fs.existsSync(process.env.NAROVA_CACHE), false);
    fs.writeFileSync(corrupt, original);
    const invalidOrder = Buffer.concat([original.subarray(0, 12), original.subarray(36), original.subarray(12, 36)]);
    assert.throws(() => require('../src/voice-cache').wavFacts(invalidOrder), /WAV/);
    manifest.entries[1].file = '../escape.wav'; fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    assert.throws(() => importCache(bundle), /unexpected|invalid/);
    manifest.entries[1].file = `${manifest.entries[1].key}.wav`; fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    fs.unlinkSync(corrupt); fs.symlinkSync(path.join(dir, 'out1/audio/full.wav'), corrupt);
    assert.throws(() => importCache(bundle), /regular/);
  } finally { if (priorEnv === undefined) delete process.env.NAROVA_CACHE; else process.env.NAROVA_CACHE = priorEnv; }
});

test('final loudness is opt-in, post-mix, stereo and duration preserving', t => {
  const dir = temp(t), full = path.join(dir, 'full.wav'); wav(full, true);
  const before = fs.readFileSync(full);
  assert.equal(applyFinalLoudness({}, dir), null); assert.equal(fs.existsSync(path.join(dir, 'mix.wav')), false);
  const result = applyFinalLoudness({ mix: { loudness: { target: -20, peak: -1.5, lra: 11 } } }, dir);
  assert.ok(Math.abs(result.duration - 3) < 0.001);
  assert.deepEqual(fs.readFileSync(full), before);
  const samples = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, 'mix.wav'), '-f', 's16le', '-ac', '2', '-']);
  let differences = 0; for (let i = 0; i < samples.length; i += 4) if (samples.readInt16LE(i) !== samples.readInt16LE(i + 2)) differences++;
  assert.ok(differences > samples.length / 20, 'stereo must retain different channel signals');
  const analysis = spawnSync('ffmpeg', ['-hide_banner', '-i', path.join(dir, 'mix.wav'), '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const facts = JSON.parse(analysis.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)[0]);
  assert.ok(Math.abs(Number(facts.input_i) + 20) < 0.3, facts.input_i);
  const bed = path.join(dir, 'bed.wav'); wav(bed, true, 0.3);
  mixExternalAudio({ scenes: [{ id: 'one', dur: 3 }], bed: { file: bed, volume: 1, fadeIn: 0, fadeOut: 0 } }, full, dir, () => {});
  const mixed = fs.readFileSync(path.join(dir, 'mix.wav'));
  applyFinalLoudness({ mix: { loudness: { target: -24, peak: -2, lra: 11 } } }, dir);
  assert.notDeepEqual(fs.readFileSync(path.join(dir, 'mix.wav')), mixed);
  assert.deepEqual(fs.readFileSync(full), before);
});

test('shared script file preserves owning-scene scheduling and sibling cache identities', t => {
  const dir = temp(t), source = `var sc = DATA.scenes.find(function(s) { return s.start === _scStart; }); tl.set('#scene-' + sc.id + ' .detail', {opacity:1}, sc.start + 0.2);`;
  fs.writeFileSync(path.join(dir, 'shared.js'), source);
  const project = raw(); project.voices = {};
  project.scenes = ['one', 'two'].map(id => ({ id, body: '<div class="detail">Detail</div>', vo: [], dur: 1, scriptFile: 'shared.js' }));
  const config = resolveConfig(project, {}, dir);
  const { collectMainAuthorJavaScript, renderMainAuthorJavaScript } = require('../src/author-js');
  const fullData = { scenes: [{ id: 'one', start: 0, dur: 1 }, { id: 'two', start: 1, dur: 1 }] };
  const evaluate = (data, options) => {
    const calls = [];
    const code = renderMainAuthorJavaScript(collectMainAuthorJavaScript(config, { data, ...options })).code;
    new Function('window', 'DATA', 'tl', code)({ __narovaAuthorState: {} }, data, { set(target, vars, time) { calls.push({ target, time }); } });
    return calls;
  };
  const full = evaluate(fullData, {}), isolated = evaluate({ scenes: [{ id: 'two', start: 0, dur: 1 }] }, { sceneIndex: 1 });
  assert.deepEqual(full, [{ target: '#scene-one .detail', time: 0.2 }, { target: '#scene-two .detail', time: 1.2 }]);
  assert.deepEqual(isolated, [{ target: '#scene-two .detail', time: 0.2 }]);
  const cache = require('../src/scene-cache'), original = compile(config, { projectDir: dir });
  const context = cache.renderContextHash(original, { fps: 30 });
  config.scenes[0].body = '<div class="detail">Changed</div>';
  const changed = compile(config, { projectDir: dir });
  assert.equal(cache.renderContextHash(changed, { fps: 30 }), context);
  assert.equal(cache.sceneCacheKey(original.scenes[1], context), cache.sceneCacheKey(changed.scenes[1], context));
  assert.notEqual(cache.sceneCacheKey(original.scenes[0], context), cache.sceneCacheKey(changed.scenes[0], context));
});

test('explicit caption colors validate, survive restoration and draw in both profiles', t => {
  const dir = temp(t), project = raw();
  project.captions = { plate: true, color: '#eeeeee', activeColor: '#ffcc00', pastColor: '#cccccc', plateColor: '#101820' };
  const config = resolveConfig(project, {}, dir), restored = configFromManifest(compile(config, { projectDir: dir }));
  const timings = { one: { dur: 3, turns: [0], words: [{ w: 'Hello.', who: 'a', si: 0, ti: 0, t0: 0, t1: 1 }] } };
  const data = composeData(restored, timings);
  assert.equal(data.captionPresentation.activeColor, '#ffcc00');
  const css = require('../src/compose/css').captionPresentationCss(restored.captions);
  assert.match(css, /#cap-stage \.cap-w\.active\{color:#ffcc00\}/);
  assert.match(css, /background:#101820/);
  const { drawCaptions } = require('../src/renderers').getRenderer('no-browser')._internals;
  function draw(time) {
    const colors = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {}, fillText() {}, measureText() { return { width: 45 }; }, set fillStyle(value) { colors.push(value); } };
    drawCaptions(ctx, { timeline: data, size: { w: 640, h: 360 }, voices: restored.voices, theme: {} }, time, {});
    return colors;
  }
  assert.deepEqual(draw(0.5), ['#101820', '#ffcc00']);
  assert.deepEqual(draw(1.5), ['#101820', '#cccccc']);
  project.captions.activeColor = 'red'; assert.throws(() => resolveConfig(project, {}, dir), /activeColor/);
});

test('variants validate turn controls and support explicit caption color overrides', t => {
  const dir = temp(t), project = raw();
  project.variants = [{ id: 'alternate', sceneOverrides: { one: { vo: [{ who: 'a', text: 'Alternate.', pauseAfter: -1, captions: 'false' }] } } }];
  assert.throws(() => resolveConfig(project, { variant: 'alternate' }, dir), /pauseAfter|captions/);
  project.variants[0].sceneOverrides.one.vo[0] = { who: 'a', text: 'Alternate.', pauseAfter: 1, captions: false };
  project.variants[0].captions = { activeColor: '#ffcc00' };
  assert.equal(resolveConfig(project, { variant: 'alternate' }, dir).captions.activeColor, '#ffcc00');
  const supplied = path.join(dir, 'external.wav'); wav(supplied);
  project.narration = { file: 'external.wav' };
  assert.throws(() => resolveConfig(project, { variant: 'alternate' }, dir), /requires synthesized narration/);
  delete project.narration;
  project.variants = [{ id: 'legacy', scene: { body: '', vo: [{ who: 'a', text: 'Alternate.', pauseAfter: -1 }] } }];
  assert.throws(() => resolveConfig(project, { variant: 'legacy' }, dir), /pauseAfter/);
});

test('plans distinguish pause assembly, final mixing and caption-only revisions', t => {
  const dir = temp(t), project = raw(), config = resolveConfig(project, {}, dir);
  const manifest = path.join(dir, 'manifest.json'); fs.writeFileSync(manifest, JSON.stringify(compile(config, { projectDir: dir })));
  const { plan } = require('../src/plan');
  const revised = structuredClone(project); revised.scenes[0].vo[0].pauseAfter = 1;
  assert.equal(plan(manifest, resolveConfig(revised, {}, dir)).level.tts, true, 'synthesis stage must reassemble pauses while keeping cached sentences');
  const mix = structuredClone(project); mix.mix = { loudness: { target: -20 } };
  const mixing = plan(manifest, resolveConfig(mix, {}, dir)); assert.equal(mixing.level.mix, true); assert.equal(mixing.level.tts, false);
  const hidden = structuredClone(project); hidden.scenes[0].vo[0].captions = false;
  assert.equal(plan(manifest, resolveConfig(hidden, {}, dir)).level.tts, false);
  const rev = require('../src/revisions');
  const before = rev.sceneProjection(compile(config, { projectDir: dir })), after = rev.sceneProjection(compile(resolveConfig(revised, {}, dir), { projectDir: dir }));
  assert.equal(rev.classifyScenes(after, before)[0].cls, 'narration');
});

test('external captions associate multiple sentence cues and mixed-turn cues by transcript', () => {
  const config = raw(); config.voices.b = { label: 'B' }; config.scenes[0].dur = 5;
  config.scenes[0].vo = [{ who: 'a', text: 'First. Second.' }, { who: 'b', text: 'Hidden.', captions: false }];
  const word = (text, start) => ({ text, start, end: start + 0.5 });
  config.narrationSource = { file: 'external.wav', wordTimings: [
    { text: 'First.', start: 0, end: 0.5, words: [word('First.', 0)] },
    { text: 'Second.', start: 1, end: 1.5, words: [word('Second.', 1)] },
    { text: 'Hidden.', start: 2, end: 2.5, words: [word('Hidden.', 2)] },
  ] };
  const { externalTimings } = require('../src/timing');
  const timings = externalTimings(config);
  assert.deepEqual(timings.one.words.map(w => w.ti), [0, 0, 1]);
  assert.deepEqual(timings.one.words.map(w => w.who), ['a', 'a', 'b']);
  const data = composeData(config, timings);
  assert.deepEqual(data.groups.map(g => g.hidden === true), [false, false, true]);
  const html = composeDoc(config, { w: 640, h: 360 }, data, '');
  assert.match(html, /<span>Second\.<\/span>/); assert.doesNotMatch(html, /<span>Hidden\.<\/span>/);
  config.narrationSource.wordTimings = [{ text: 'First. Second. Hidden.', start: 0, end: 2.5, words: [word('First.', 0), word('Second.', 1), word('Hidden.', 2)] }];
  const combined = composeData(config, externalTimings(config));
  assert.deepEqual(combined.groups.map(g => g.hidden === true), [false, true]);
  assert.equal(combined.scenes[0].sentences[0].words.length, 3, 'caption grouping does not lose cue words');
  const mixedHtml = composeDoc(config, { w: 640, h: 360 }, combined, '');
  assert.match(mixedHtml, /<span>Second\.<\/span>/); assert.doesNotMatch(mixedHtml, /<span>Hidden\.<\/span>/);
  config.narrationSource.wordTimings[0].words = [word('Unassociated', 0)];
  assert.throws(() => externalTimings(config), /cannot be associated/);
});

test('actual no-browser composition retains mixed-cue turn ownership and rejects mismatched evidence', t => {
  const dir = temp(t), audio = path.join(dir, 'external.wav'); wav(audio);
  const config = raw(); config.size = { w: 640, h: 360 };
  config.scenes[0].dur = 3; config.scenes[0].visual = { type: 'group', children: [] };
  config.scenes[0].vo = [{ who: 'a', text: 'Shown.' }, { who: 'a', text: 'Hidden.', captions: false }];
  const word = (text, start) => ({ text, start, end: start + 0.5 });
  config.narrationSource = { file: audio, wordTimings: [{ text: 'Shown. Hidden.', start: 0, end: 2, words: [word('Shown.', 0), word('Hidden.', 1)] }] };
  fs.writeFileSync(path.join(dir, 'timings.json'), JSON.stringify({ one: { dur: 3, turns: [0, 1] } }));
  const renderer = require('../src/renderers').getRenderer('no-browser');
  const composed = renderer.compose(config, dir);
  const project = JSON.parse(fs.readFileSync(path.join(composed.dir, 'project.json')));
  assert.deepEqual(project.timeline.groups.map(g => g.hidden === true), [false, true]);
  const drawn = [], ctx = new Proxy({ measureText() { return { width: 45 }; }, fillText(text) { drawn.push(text); } }, { get(obj, key) { return obj[key] || (() => {}); } });
  renderer._internals.drawCaptions(ctx, project, 1.2, {}); assert.deepEqual(drawn, []);
  config.narrationSource.wordTimings[0].words = [word('Hidden.', 0), word('Shown.', 1)];
  assert.throws(() => renderer.compose(config, dir), /cannot be associated/);
  config.scenes[0].vo[1].captions = true;
  assert.doesNotThrow(() => renderer.compose(config, dir), 'unhidden legacy supplied words remain usable');
});

test('final loudness changes invalidate muxed whole videos while preserving pixel-only scene keys', t => {
  const dir = temp(t), project = raw(), cache = require('../src/scene-cache');
  const original = compile(resolveConfig(project, {}, dir), { projectDir: dir });
  project.mix = { loudness: { target: -20 } };
  const changed = compile(resolveConfig(project, {}, dir), { projectDir: dir });
  const context = cache.renderContextHash(original, { fps: 30 });
  assert.equal(cache.renderContextHash(changed, { fps: 30 }), context);
  assert.equal(cache.sceneCacheKey(original.scenes[0], context), cache.sceneCacheKey(changed.scenes[0], context));
  assert.notEqual(cache.wholeVideoKey(original, context), cache.wholeVideoKey(changed, context));
  project.mix.loudness.target = -24;
  const revised = compile(resolveConfig(project, {}, dir), { projectDir: dir });
  assert.notEqual(cache.wholeVideoKey(changed, context), cache.wholeVideoKey(revised, context));
});

test('external builds fail missing or ambiguous literal anchors before optional mixer recovery', t => {
  const dir = temp(t); wav(path.join(dir, 'external.wav')); wav(path.join(dir, 'effect.wav'));
  fs.writeFileSync(path.join(dir, 'words.json'), JSON.stringify([{ text: 'Hello hello.', start: 0, end: 2, words: [{ text: 'Hello', start: 0, end: 0.5 }, { text: 'hello.', start: 1, end: 1.5 }] }]));
  const project = { title: 'Selector errors', renderer: 'no-browser', size: { w: 640, h: 360 }, voices: { a: { label: 'A' } }, narration: { file: 'external.wav', wordTimings: 'words.json' }, mix: { loudness: { target: -20 } }, scenes: [{ id: 'one', dur: 3, visual: { type: 'group', children: [] }, vo: [{ who: 'a', text: 'Hello hello.' }] }], sfx: [{ file: 'effect.wav', scene: 'one', at: { sentence: 0, word: { text: 'hello' } } }] };
  for (const selector of [{ text: 'hello' }, { text: 'missing' }]) {
    project.sfx[0].at.word = selector;
    fs.writeFileSync(path.join(dir, 'reel.config.mjs'), 'export default ' + JSON.stringify(project));
    const result = spawnSync(process.execPath, [cli, 'build', '--out', 'out', '--json'], { cwd: dir, encoding: 'utf8', timeout: 60000 });
    assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /matches|occurrence/);
    assert.equal(fs.existsSync(path.join(dir, 'out/audio/mix.wav')), false);
    assert.equal(fs.existsSync(path.join(dir, 'out/video.mp4')), false);
  }
});

test('overlapping external cues invalidate neighboring visibility dependencies without invalidating unrelated spans', t => {
  const dir = temp(t), cache = require('../src/scene-cache');
  const project = raw(); project.scenes = ['one', 'two', 'three'].map((id, i) => ({ id, dur: 1, body: '', vo: [{ who: 'a', text: ['First.', 'Second.', 'Third.'][i] }] }));
  const config = resolveConfig(project, {}, dir);
  config.narrationSource = { file: path.join(dir, 'external.wav'), wordTimings: [
    { text: 'First. Second.', start: 0, end: 2, words: [{ text: 'First.', start: 0, end: 1.2 }, { text: 'Second.', start: 1.2, end: 2 }] },
    { text: 'Third.', start: 2, end: 3, words: [{ text: 'Third.', start: 2, end: 3 }] },
  ] };
  const snapshot = () => {
    const timings = require('../src/timing').externalTimings(config);
    const file = path.join(dir, 'timings.json'); fs.writeFileSync(file, JSON.stringify(timings));
    const manifest = require('../src/manifest').mergeTimings(compile(config, { projectDir: dir }), file);
    const context = cache.renderContextHash(manifest, { fps: 30 });
    return { context, keys: manifest.scenes.map((scene, i) => cache.sceneCacheKey(scene, context, cache.sceneAssetIdentity(manifest, i))), data: composeData(config, timings) };
  };
  const before = snapshot(); config.scenes[0].vo[0].captions = false; const after = snapshot();
  assert.equal(before.context, after.context);
  assert.notEqual(before.keys[0], after.keys[0]); assert.notEqual(before.keys[1], after.keys[1]);
  assert.equal(before.keys[2], after.keys[2]);
  assert.equal(after.data.groups.filter(g => g.words.some(w => w.w === 'First.')).every(g => g.hidden), true);
  assert.equal(after.data.groups.every(group => group.end >= group.start), true, 'cross-scene evidence must not produce negative sidecar durations');
});


test('canonical WAV validation compares exact header and chunk identifiers', t => {
  const dir = temp(t), file = path.join(dir, 'speech.wav');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-ar', '22050', '-ac', '1', '-c:a', 'pcm_s16le', file]);
  const bytes = fs.readFileSync(file); assert.equal(wavFacts(bytes).sampleRate, 22050);
  for (const offset of [0, 8, bytes.indexOf(Buffer.from('fmt ')), bytes.indexOf(Buffer.from('data'))]) {
    assert.ok(offset >= 0); const bad = Buffer.from(bytes); bad[offset] |= 0x80;
    assert.throws(() => wavFacts(bad), /WAV/);
  }
});


test('hiding an unrelated scene does not split an unchanged visible mixed-turn cue', t => {
  const config = raw(); config.scenes = [
    { id: 'one', dur: 2, vo: [{ who: 'a', text: 'First.' }, { who: 'a', text: 'Second.' }] },
    { id: 'two', dur: 1, vo: [{ who: 'a', text: 'Third.' }] },
  ];
  config.narrationSource = { wordTimings: [
    { text: 'First. Second.', start: 0, end: 2, words: [{ text: 'First.', start: 0, end: 1 }, { text: 'Second.', start: 1, end: 2 }] },
    { text: 'Third.', start: 2, end: 3, words: [{ text: 'Third.', start: 2, end: 3 }] },
  ] };
  const snapshot = browser => composeData(config, require('../src/timing').externalTimings(config, { browser })).groups.filter(group => group.start < 2);
  const before = snapshot(false);
  config.scenes[1].vo[0].captions = false;
  assert.deepEqual(snapshot(false), before);
  config.narrationSource.file = 'external.wav';
  config.scenes[1].vo[0].captions = true; const browserBefore = snapshot(true);
  config.scenes[1].vo[0].captions = false; assert.deepEqual(snapshot(true), browserBefore);
});
