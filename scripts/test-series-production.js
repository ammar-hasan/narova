'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const repo = path.resolve(__dirname, '..');
const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-series-production-'));
const testVoice = process.env.NAROVA_SERIES_TEST_VOICE || 'en_US-ryan-medium';
const voiceRoot = process.env.NAROVA_PIPER_DIR || path.join(os.homedir(), '.cache/narova/piper');
for (const ext of ['.onnx', '.onnx.json']) {
  assert.ok(fs.existsSync(path.join(voiceRoot, testVoice + ext)), `Install the test Piper voice first: ${testVoice}. This check does not acquire models.`);
}
const python = require(path.join(repo, 'tool/src/pipeline')).findPython();
const runtime = spawnSync(python, ['-c', 'import piper'], { encoding: 'utf8' });
assert.equal(runtime.status, 0, 'An existing Piper runtime is required. This check does not install it.');
console.log('Production evidence: ' + evidenceDir);
const series = require(path.join(repo, 'tool/src/series'));
const { loadProjectConfig } = require(path.join(repo, 'tool/src/config'));
const { resolveConfig } = require(path.join(repo, 'tool/src/schema'));
const { compile } = require(path.join(repo, 'tool/src/manifest'));
const { plan } = require(path.join(repo, 'tool/src/plan'));
const root = path.join(evidenceDir, 'fixtures');
fs.mkdirSync(root, { recursive: true });
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2)); };
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const report = { source: repo, episodes: [], checks: [], videos: [] };
const check = name => { report.checks.push(name); console.log('PASS ' + name); };
function cli(args, expected = 0) {
  const result = spawnSync(process.execPath, [path.join(repo, 'tool/bin/narova.js'), ...args, '--json'], { encoding: 'utf8', env: { ...process.env, NAROVA_FIRST_RUN: '0' }, timeout: 180000 });
  write(path.join(evidenceDir, `command-${String(cli.count++).padStart(2, '0')}.log`), JSON.stringify({ args, status: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2));
  assert.equal(result.status, expected, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}
cli.count = 0;
const loaded = async project => { const source = await loadProjectConfig(project); return resolveConfig(source.raw, {}, source.dir); };
const video = project => path.join(project, 'out/video.mp4');
function probe(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout); assert.ok(Number(value.format.duration) > 0); assert.ok(value.streams.some(s => s.codec_type === 'video')); assert.ok(value.streams.some(s => s.codec_type === 'audio'));
  report.videos.push({ file, sha256: digest(file), duration: Number(value.format.duration), streams: value.streams.map(s => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height })) });
  return Number(value.format.duration);
}
function make(kind) {
  const dir = path.join(root, kind); const first = path.join(dir, 'episodes/one'), second = path.join(dir, 'episodes/two');
  const src = { format: series.FORMAT, id: kind, title: kind + ' series', defaults: { voices: { host: { backend: 'piper', speaker: testVoice, label: 'Host' } }, captions: { size: 14, maxWords: 4, plate: true }, theme: { accent: '#55ccbb' } }, resources: { logo: { file: 'media/logo.svg' }, future: { file: 'missing-unselected.png' } }, context: { intent: { text: kind === 'course' ? 'Define terms before examples.' : kind === 'vlog' ? 'Observe one ordinary day.' : 'The cast discovers the key.' }, future: { text: 'Unselected future spoiler' } }, states: { incoming: { facts: { topic: kind, known: ['beginning'] } } }, episodes: [{ id: 'one', title: kind + ' one', project: 'episodes/one' }, { id: 'two', title: kind + ' two', project: 'episodes/two', relationships: [{ type: 'follows', episode: 'one' }] }] };
  if (kind === 'drama') src.defaults.voices.guest = { backend: 'piper', speaker: testVoice, label: 'Guest' };
  const sourceFile = path.join(dir, 'series.config.json'); write(sourceFile, src); write(path.join(dir, 'media/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="25"><rect width="90" height="25" fill="#55ccbb"/></svg>');
  for (const [id, project] of [['one', first], ['two', second]]) {
    const vo = kind === 'vlog' ? [] : kind === 'course' ? [{ who: 'host', text: id === 'one' ? 'A planet travels around a star.' : 'An orbit is the path of a planet.' }] : [{ who: 'host', text: id === 'one' ? 'I found the key.' : 'The door is open.' }, { who: 'guest', text: id === 'one' ? 'Keep it safe.' : 'Let us go inside.' }];
    write(path.join(project, 'reel.config.json'), { title: kind + ' ' + id, renderer: 'no-browser', size: { w: 320, h: 180 }, scenes: [{ id: 'main', ...(kind === 'vlog' ? { dur: 1.2 } : {}), vo, visual: { type: 'stack', style: { background: id === 'one' ? '#142633' : '#261b35', padding: 14, gap: 8 }, children: [{ type: 'text', text: kind.toUpperCase() + ' ' + id, style: { color: '#ffffff', fontSize: 20, height: 30 } }, { type: 'image', src: series.FILES + 'media/logo.svg', style: { width: 90, height: 25, alignSelf: 'start', fit: 'contain' } }] } }] });
    write(path.join(project, 'creative-brief.md'), '# Creative brief\nStatus: ready\nAmbition: routine\n\nSmall series conformance fixture; distinct episode scripts and backgrounds.\n');
    series.bind(dir, id, { resources: ['logo'], context: ['intent'], incoming: 'incoming' });
    report.episodes.push({ kind, id, project, revision: series.readBinding(project).revision });
  }
  return { dir, first, second, src, sourceFile };
}
async function main() {
  const course = make('course');
  cli(['build', '--project', course.second, '--fps', '10', '--quality', 'draft', '--reuse']); probe(video(course.second));
  assert.equal(fs.existsSync(video(course.first)), false); check('later course lesson builds before earlier lesson');
  cli(['build', '--project', course.first, '--fps', '10', '--quality', 'draft', '--reuse']); probe(video(course.first));
  const vlog = make('vlog');
  const courseAudio = path.join(course.first, 'out/audio/full.wav'); const durResult = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', courseAudio], { encoding: 'utf8' }); const narrationDur = Number(durResult.stdout);
  const vlogConfig = JSON.parse(fs.readFileSync(path.join(vlog.second, 'reel.config.json'))); fs.copyFileSync(courseAudio, path.join(vlog.second, 'narration.wav')); vlogConfig.narration = { file: 'narration.wav' }; vlogConfig.scenes[0].dur = narrationDur; vlogConfig.scenes[0].vo = [{ who: 'host', text: 'A planet travels around a star.' }]; write(path.join(vlog.second, 'reel.config.json'), vlogConfig);
  for (const project of [vlog.second, vlog.first]) { cli(['build', '--project', project, '--fps', '10', '--quality', 'draft', '--reuse']); probe(video(project)); }
  check('silent and externally narrated vlog episodes produce real MP4s');
  const drama = make('drama');
  for (const project of [drama.second, drama.first]) { cli(['build', '--project', project, '--fps', '10', '--quality', 'draft', '--reuse']); probe(video(project)); }
  const dramaManifest = JSON.parse(fs.readFileSync(path.join(drama.second, 'out/manifest.json'))); assert.deepEqual(Object.keys(dramaManifest.voices), ['host', 'guest']); assert.equal(dramaManifest.scenes[0].vo.length, 2); assert.equal(series.readBinding(drama.second).incoming.value.facts.known[0], 'beginning'); check('drama preserves shared cast order, two turns and authored incoming state');
  const originalVideo = digest(video(course.second)), originalAudio = digest(path.join(course.second, 'out/audio/full.wav')); const oldRevision = series.readBinding(course.second).revision;
  course.src.context.intent.text = 'Corrected authored course intention'; write(course.sourceFile, course.src); series.adopt(course.dir, course.second);
  cli(['build', '--project', course.second, '--fps', '10', '--quality', 'draft', '--reuse']); assert.equal(digest(video(course.second)), originalVideo); assert.equal(digest(path.join(course.second, 'out/audio/full.wav')), originalAudio); check('context-only adoption reuses identical video/audio bytes');
  course.src.defaults.theme.accent = '#ee8866'; write(course.sourceFile, course.src); const firstRevision = series.readBinding(course.first).revision;
  series.adopt(course.dir, course.second); assert.equal(series.readBinding(course.first).revision, firstRevision); assert.equal((await loaded(course.second)).theme.accent, '#ee8866'); series.restore(oldRevision, course.second); assert.equal((await loaded(course.second)).theme.accent, '#55ccbb'); check('explicit adoption/restoration changes only selected episode');
  write(path.join(course.dir, 'media/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="25"><rect width="90" height="25" fill="#cc3355"/></svg>');
  assert.equal(plan(path.join(course.second, 'out/manifest.json'), await loaded(course.second)).level.render, false); series.adopt(course.dir, course.second); assert.equal(plan(path.join(course.second, 'out/manifest.json'), await loaded(course.second)).level.render, true);
  cli(['build', '--project', course.second, '--fps', '10', '--quality', 'draft', '--reuse']); assert.notEqual(digest(video(course.second)), originalVideo); assert.equal(digest(path.join(course.second, 'out/audio/full.wav')), originalAudio); check('adopted consumed resource changes video and retains speech audio');
  const good = digest(video(course.second)); const retained = path.join(course.second, series.FILES, 'media/logo.svg'); const bytes = fs.readFileSync(retained); write(retained, 'corrupt retained resource'); cli(['build', '--project', course.second, '--reuse'], 1); assert.equal(digest(video(course.second)), good); write(retained, bytes); check('retained corruption fails before replacing prior video');
  const packed = path.join(evidenceDir, 'episode.narova'); cli(['pack', '--project', course.second, '--output', packed]); const opened = path.join(root, 'opened'); cli(['open', packed, '--dir', opened]);
  assert.equal(fs.readFileSync(packed).includes(Buffer.from('Unselected future spoiler')), false); fs.rmSync(course.sourceFile); fs.rmSync(path.join(course.dir, 'media'), { recursive: true });
  cli(['build', '--project', opened, '--fps', '10', '--quality', 'draft', '--reuse']); probe(video(opened)); assert.equal(digest(path.join(opened, 'out/audio/full.wav')), originalAudio); check('packed/opened episode builds without series workspace or transported caches');
  const detached = path.join(root, 'detached'); cli(['series', 'detach', detached, '--project', course.second]); assert.equal(series.readBinding(detached), null); cli(['build', '--project', detached, '--fps', '10', '--quality', 'draft', '--reuse']); probe(video(detached)); assert.equal(digest(path.join(detached, 'out/audio/full.wav')), originalAudio); check('fresh detached project builds with equivalent retained inputs');
  cli(['build', '--project', course.first, '--fps', '10', '--quality', 'draft', '--reuse']); check('older bound episode builds after live series removal');
  // A small isolated external worker emits real WAVs. Its invocation count
  // distinguishes whole/sentence cache hits from coincidentally equal output.
  const priorEnvironment = Object.fromEntries(['NAROVA_HOME', 'NAROVA_PYTHON', 'NAROVA_CACHE'].map(key => [key, process.env[key]]));
  try {
    process.env.NAROVA_HOME = path.join(evidenceDir, 'provider-home'); process.env.NAROVA_PYTHON = python; process.env.NAROVA_CACHE = path.join(evidenceDir, 'sentence-cache');
    const providerRoot = path.join(root, 'provider-cache'), providerProject = path.join(providerRoot, 'episode'); const calls = path.join(evidenceDir, 'provider-calls.log'); const worker = path.join(evidenceDir, 'worker.py');
    write(worker, `import json,sys,wave,math,struct,hashlib\nfrom pathlib import Path\nfor line in sys.stdin:\n r=json.loads(line)\n if r.get('operation')=='hello':\n  result={'ok':True,'protocol':'narova-tts-provider/v1','provider':'series-cache-fixture','providerVersion':'1'}\n elif r.get('operation')=='synthesize':\n  p=Path(r['options']['profile']['path']); sample=p.parent/json.loads(p.read_text())['sample']\n  freq=440+int.from_bytes(hashlib.sha256(sample.read_bytes()).digest()[:2],'big')%440\n  with Path(r['options']['log']).open('a') as log: log.write(str(freq)+'\\n')\n  with wave.open(r['output'],'wb') as audio:\n   audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(24000)\n   audio.writeframes(b''.join(struct.pack('<h',round(12000*math.sin(2*math.pi*freq*i/24000))) for i in range(19200)))\n  result={'id':r['id'],'ok':True,'output':r['output']}\n else: result={'ok':False}\n print(json.dumps(result),flush=True)\n`);
    write(path.join(process.env.NAROVA_HOME, 'providers/series-cache-fixture.json'), { name: 'series-cache-fixture', protocol: 'narova-tts-provider/v1', providerVersion: '1', command: [python, worker], capabilities: { synthesis: true } });
    write(path.join(providerRoot, 'voice/profile.json'), { sample: 'reference.wav' });
    const recording = frequency => { const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=24000:duration=0.4`, path.join(providerRoot, 'voice/reference.wav')]); assert.equal(r.status, 0); };
    recording(220);
    write(path.join(providerRoot, 'series.config.json'), { format: series.FORMAT, id: 'cache', title: 'Provider cache', defaults: { voices: { host: { backend: 'series-cache-fixture', speaker: 'fixture', providerFiles: { profile: 'voice/profile.json' }, providerOptions: { log: calls } } } }, resources: { profile: { file: 'voice/profile.json', dependencies: ['voice/reference.wav'] } }, episodes: [{ id: 'one', title: 'One', project: 'episode' }] });
    write(path.join(providerProject, 'reel.config.json'), { title: 'Provider cache', renderer: 'no-browser', size: { w: 320, h: 180 }, scenes: [{ id: 'main', vo: [{ who: 'host', text: 'One dependency.' }], visual: { type: 'rect', x: 0, y: 0, w: 320, h: 180, fill: '#112233' } }] });
    write(path.join(providerProject, 'creative-brief.md'), '# Creative brief\nStatus: ready\nAmbition: routine\n\nVerify provider dependency cache inputs.\n'); series.bind(providerRoot, 'one');
    const count = () => fs.readFileSync(calls, 'utf8').trim().split('\n').length;
    const build = () => cli(['build', '--project', providerProject, '--fps', '10', '--quality', 'draft', '--reuse']);
    build(); probe(video(providerProject)); const firstAudio = digest(path.join(providerProject, 'out/audio/full.wav')); assert.equal(count(), 1);
    build(); assert.equal(count(), 1); assert.equal(digest(path.join(providerProject, 'out/audio/full.wav')), firstAudio);
    recording(330); series.adopt(providerRoot, providerProject); build(); probe(video(providerProject)); assert.equal(count(), 2); assert.notEqual(digest(path.join(providerProject, 'out/audio/full.wav')), firstAudio);
    build(); assert.equal(count(), 2); check('changed provider dependency misses whole/sentence speech caches and unchanged bytes reuse');
    write(path.join(providerProject, series.FILES, 'voice/reference.wav'), 'stale selected dependency'); cli(['build', '--project', providerProject, '--reuse'], 1); assert.equal(count(), 2); check('stale selected provider dependency fails before cached speech reuse');
  } finally { for (const [key, value] of Object.entries(priorEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
  write(path.join(evidenceDir, 'results.json'), report);
}
main().catch(error => { write(path.join(evidenceDir, 'failed.json'), { error: error.stack, report }); console.error(error); process.exitCode = 1; });
