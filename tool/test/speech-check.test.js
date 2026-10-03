'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, execFileSync } = require('child_process');
const { resolveConfig } = require('../src/schema');
const { compile } = require('../src/manifest');
const { configFromManifest } = require('../src/pipeline');
const { audioFingerprint, narrationContextDigest, timingsFingerprint } = require('../src/audio-fingerprint');
const cli = path.resolve(__dirname, '../bin/narova.js');
const python = execFileSync('which', ['python3'], {encoding:'utf8'}).trim();
const raw = () => ({ title:'Speech', renderer:'no-browser', size:{w:320,h:180}, voices:{a:{speaker:'fixture'}}, scenes:[{id:'one',visual:{type:'group',children:[]},vo:[{who:'a',text:'Count that effort.',lang:'en'}]}] });
const temp = t => {const d=fs.mkdtempSync(path.join(os.tmpdir(),'narova-speech-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
function run(args, dir, env) {
 const r=spawnSync(process.execPath,[cli,...args,'--json'],{cwd:dir,env:{...process.env,...env},encoding:'utf8',timeout:90000});
 assert.ok(r.stdout.trim(),r.stderr);return {process:r,result:JSON.parse(r.stdout)};
}
function files(dir) {
 const result={};function scan(d){for(const x of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,x.name);if(x.isDirectory())scan(p);else result[path.relative(dir,p)]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}}scan(dir);return result;
}

test('speech policy validates, survives manifest restoration, and scopes reuse identity',t=>{
 const dir=temp(t),p=raw();p.speech={check:'warn',retakes:2,engine:'faster-whisper',model:'base.en',deterministicTakes:true};
 const config=resolveConfig(p,{},dir);assert.deepEqual(configFromManifest(compile(config)).speech,config.speech);
 const normal=resolveConfig(raw(),{},dir),base=audioFingerprint(normal);
 normal.speech={check:'warn'};assert.equal(audioFingerprint(normal),base);
 normal.speech.check='fail';assert.equal(audioFingerprint(normal),base,'policy must recheck existing audio without changing its identity');
 normal.scenes[0].vo[0].take=1;assert.notEqual(audioFingerprint(normal),base);delete normal.scenes[0].vo[0].take;
 normal.speech.retakes=1;const a=audioFingerprint(normal);assert.notEqual(a,base);normal.speech.retakes=2;assert.notEqual(audioFingerprint(normal),a);
 normal.speech={deterministicTakes:false};assert.notEqual(audioFingerprint(normal),base);
 for(const speech of [{check:null},{retakes:null},{engine:null},{model:null},{deterministicTakes:null},{check:'off'},{check:false},{retakes:-1},{retakes:11},{retakes:1.5},{retakes:true},{retakes:1},{check:'warn',engine:'cloud'},{model:''},{deterministicTakes:0}])assert.throws(()=>resolveConfig({...raw(),speech},{},dir),/config.speech/);
 const external=raw();external.speech={check:'warn',retakes:1};external.narration={file:'a.wav'};assert.throws(()=>resolveConfig(external,{},dir),/retakes/);
 const variant=raw();variant.speech={check:'warn',retakes:1};variant.variants=[{id:'unsafe',sceneOverrides:{one:{vo:[{who:'a',text:'Text',take:Number.MAX_SAFE_INTEGER}]}}}];assert.throws(()=>resolveConfig(variant,{variant:'unsafe'},dir),/safe integer/);
 const cpp=resolveConfig({...raw(),speech:{engine:'whisper-cpp',model:'ggml-tiny.en.bin'}},{},dir);assert.equal(cpp.speech.model,'ggml-tiny.en.bin');
 const localModel=path.join(dir,'recognizer.bin');fs.writeFileSync(localModel,'local model');assert.equal(resolveConfig({...raw(),speech:{model:'./recognizer.bin'}},{},dir).speech.model,localModel);
 const remote=resolveConfig({...raw(),speech:{model:'org/model'}},{},dir);assert.equal(remote.speech.model,'org/model');
});

test('speech review reports stale evidence as advisory success and rejects conflicting modes',t=>{
 const dir=temp(t);fs.writeFileSync(path.join(dir,'reel.config.json'),JSON.stringify(raw()));
 const env={NAROVA_HOME:path.join(dir,'home'),NAROVA_PYTHON:python};const before=files(dir);
 const {process:r,result}=run(['review','--speech'],dir,env);assert.equal(r.status,0,r.stderr);assert.equal(result.operation,'review');assert.equal(result.data.mode,'speech');assert.equal(result.data.counts.unavailable,1);assert.deepEqual(files(dir),before);
 const conflict=run(['review','--speech','--takes'],dir,env);assert.equal(conflict.process.status,2);assert.equal(conflict.result.success,false);
});

test('machine speech check gates reused audio and preserves the finished video and read-only review',t=>{
 const dir=temp(t),worker=path.join(dir,'worker.py');
 fs.writeFileSync(worker,String.raw`import sys,json,wave,math,struct
for line in sys.stdin:
 r=json.loads(line)
 if r['operation']=='hello': print(json.dumps({'ok':True,'protocol':'narova-tts-provider/v1','provider':'fixture','providerVersion':'1'}),flush=True)
 else:
  with wave.open(r['output'],'wb') as w:
   w.setnchannels(1);w.setsampwidth(2);w.setframerate(22050);w.writeframes(b''.join(struct.pack('<h',int(6000*math.sin(2*math.pi*440*i/22050))) for i in range(22050)))
  print(json.dumps({'id':r['id'],'ok':True,'output':r['output']}),flush=True)
`);
 fs.writeFileSync(path.join(dir,'provider.json'),JSON.stringify({name:'fixture',displayName:'Fixture',protocol:'narova-tts-provider/v1',command:[python,worker],requiredEnvironment:[],capabilities:{synthesis:true}}));
 const stub=path.join(dir,'asr');fs.mkdirSync(stub);
 fs.writeFileSync(path.join(stub,'faster_whisper.py'),String.raw`import types
class WhisperModel:
 def __init__(self,*a,**k):pass
 def transcribe(self,*a,**k):return [types.SimpleNamespace(text='That effort.')],None
`);
 const metadata=path.join(stub,'faster_whisper-0.0.dist-info');fs.mkdirSync(metadata);fs.writeFileSync(path.join(metadata,'METADATA'),'Metadata-Version: 2.1\nName: faster-whisper\nVersion: 0.0\n');
 const p=raw();p.voices.a.backend='fixture';p.speech={check:'warn',engine:'faster-whisper',model:'fixture'};
 const configFile=path.join(dir,'reel.config.json');fs.writeFileSync(configFile,JSON.stringify(p));
 const env={NAROVA_HOME:path.join(dir,'home'),NAROVA_CACHE:path.join(dir,'cache'),NAROVA_PYTHON:python,PYTHONPATH:stub,PYTHONDONTWRITEBYTECODE:'1'};
 assert.equal(run(['providers','add','provider.json'],dir,env).process.status,0);
 const built=run(['build'],dir,env);assert.equal(built.process.status,0,built.process.stderr);
 const video=path.join(dir,'out/video.mp4'),bytes=fs.readFileSync(video);
 const before=files(dir),review=run(['review','--speech'],dir,env);assert.equal(review.process.status,0,review.process.stderr);assert.equal(review.result.data.counts.mismatch,1);assert.equal(review.result.data.turns[0].differences[0].kind,'dropped');assert.deepEqual(files(dir),before);
 const index=path.join(dir,'out/audio/takes.json'),priorIndex=fs.readFileSync(index);fs.writeFileSync(index,'{');const corruptBefore=files(dir),corrupt=run(['review','--speech'],dir,env);assert.equal(corrupt.process.status,0,corrupt.process.stderr);assert.equal(corrupt.result.data.counts.unavailable,1);assert.deepEqual(files(dir),corruptBefore);fs.writeFileSync(index,priorIndex);
 p.speech.check='fail';fs.writeFileSync(configFile,JSON.stringify(p));
 const failed=run(['build','--reuse'],dir,env);assert.equal(failed.process.status,1,failed.process.stderr);assert.equal(failed.result.success,false);assert.deepEqual(fs.readFileSync(video),bytes);
 assert.ok(failed.result.artifacts.some(a=>a.role==='speech-check'));assert.ok(!failed.result.artifacts.some(a=>a.role==='video'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'out/speech-check.json'))).counts.mismatch,1);
 assert.ok(failed.result.diagnostics.some(d=>d.code==='operation.failed' && d.subject==='scene one turn 0' && /mismatch/.test(d.message)));
 assert.deepEqual(failed.result.data.speechFailure.turns,[{sceneId:'one',turn:0,status:'mismatch'}]);
 const sceneAudio=path.join(dir,'out/audio/01.wav');
 for(const corrupt of [false,true]){
  if(corrupt)fs.writeFileSync(sceneAudio,'undecodable fixture');else fs.unlinkSync(sceneAudio);
  const missing=run(['build','--reuse'],dir,env);assert.equal(missing.process.status,1,missing.process.stderr);
  assert.deepEqual(missing.result.data.speechFailure.turns,[{sceneId:'one',turn:0,status:'unavailable'}]);
  assert.ok(missing.result.artifacts.some(a=>a.role==='speech-check'));assert.ok(!missing.result.artifacts.some(a=>a.role==='video'));assert.deepEqual(fs.readFileSync(video),bytes);
 }
});


test('external narration fail policy stops before speech runtime or finished-video replacement',t=>{
 const dir=temp(t),p=raw();p.narration={file:'source.wav'};p.speech={check:'fail'};
 fs.writeFileSync(path.join(dir,'source.wav'),'external fixture');fs.writeFileSync(path.join(dir,'reel.config.json'),JSON.stringify(p));
 fs.mkdirSync(path.join(dir,'out'));const video=path.join(dir,'out/video.mp4');fs.writeFileSync(video,'previous video');
 const env={NAROVA_HOME:path.join(dir,'home'),NAROVA_PYTHON:'/nonexistent/runtime'};
 for(const command of ['synth','build']){
  const failed=run([command],dir,env);assert.equal(failed.process.status,1,failed.process.stderr);
  assert.match(failed.process.stderr,/speech.check=fail/);assert.equal(fs.readFileSync(video,'utf8'),'previous video');
  assert.ok(failed.result.artifacts.some(a=>a.role==='speech-check'));
  assert.ok(failed.result.diagnostics.some(d=>d.subject==='scene one turn 0' && /unavailable/.test(d.message)));
  assert.deepEqual(failed.result.data.speechFailure.turns,[{sceneId:'one',turn:0,status:'unavailable'}]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'out/speech-check.json'))).counts.unavailable,1);
 }
 assert.ok(!fs.existsSync(path.join(dir,'home')));
});


test('local recognizer byte changes invalidate selection reuse while ordinary sentence inputs stay stable',t=>{
 const dir=temp(t), priorEnv={NAROVA_HOME:process.env.NAROVA_HOME,NAROVA_WHISPER_MODEL:process.env.NAROVA_WHISPER_MODEL};
 process.env.NAROVA_HOME=path.join(dir,'home');delete process.env.NAROVA_WHISPER_MODEL;
 t.after(()=>{for(const [k,v] of Object.entries(priorEnv)){if(v==null)delete process.env[k];else process.env[k]=v;}});
 const model=path.join(dir,'model.bin'),snapshot=path.join(dir,'snapshot');fs.mkdirSync(snapshot);
 const blob=path.join(dir,'model-blob');fs.writeFileSync(blob,'first snapshot weights');fs.symlinkSync(blob,path.join(snapshot,'model.bin'));fs.writeFileSync(path.join(snapshot,'config.json'),'{}');
 const stored=path.join(process.env.NAROVA_HOME,'models','ggml-tiny.en.bin');fs.mkdirSync(path.dirname(stored),{recursive:true});fs.writeFileSync(stored,'first stored weights');
 const ordinary=resolveConfig(raw(),{},dir),baseline=audioFingerprint(ordinary),context= narrationContextDigest(ordinary);
 const config=resolveConfig({...raw(),speech:{check:'warn',retakes:1,engine:'whisper-cpp',model}},{},dir);
 const out=path.join(dir,'out');fs.mkdirSync(path.join(out,'audio'),{recursive:true});fs.writeFileSync(path.join(out,'audio/full.wav'),'fixture audio');fs.writeFileSync(path.join(out,'timings.json'),'{}');
 const {resolveReuse}=require('../src/pipeline');
 function replacement(file,options){
  config.speech={check:'warn',retakes:1,...options};fs.writeFileSync(file,'first weights');
  const previous=[audioFingerprint(config),narrationContextDigest(config)];
  fs.writeFileSync(path.join(out,'.audio-fingerprint'),previous[0]);fs.writeFileSync(path.join(out,'.timings-fingerprint'),timingsFingerprint(config));
  assert.equal(resolveReuse(config,out,true,()=>{}),true);
  fs.writeFileSync(file,'other weights');
  assert.notEqual(audioFingerprint(config),previous[0]);assert.notEqual(narrationContextDigest(config),previous[1]);
  assert.equal(resolveReuse(config,out,true,()=>{}),false,'new recognizer bytes must allow fresh candidate selection');
  config.speech.retakes=0;assert.equal(audioFingerprint(config),baseline);assert.equal(narrationContextDigest(config),context);
 }
 replacement(model,{engine:'whisper-cpp',model});
 replacement(blob,{engine:'faster-whisper',model:snapshot});
 replacement(stored,{engine:'whisper-cpp',model:'ggml-tiny.en.bin'});
 replacement(stored,{engine:'whisper-cpp'});
 process.env.NAROVA_WHISPER_MODEL=model;replacement(model,{engine:'whisper-cpp'});delete process.env.NAROVA_WHISPER_MODEL;
 config.align={engine:'faster-whisper',model:snapshot};replacement(blob,{});
 config.speech={check:'warn',retakes:1,engine:'faster-whisper',model:snapshot};
 const before=audioFingerprint(config);fs.writeFileSync(path.join(snapshot,'config.json'),'new tokenizer settings');assert.notEqual(audioFingerprint(config),before);
 const checked=audioFingerprint(config);fs.utimesSync(blob,new Date(0),new Date(0));assert.equal(audioFingerprint(config),checked,'mtime-only changes are not new recognition contents');
});

test('speech failure diagnostics are structured and redacted; prior committed delivery members remain reported',t=>{
 const dir=temp(t),p=raw();p.speech={check:'fail'};p.variants=[{id:'later',sceneOverrides:{one:{vo:[{who:'a',text:'Later line.',lang:'en'}]}}}];
 fs.writeFileSync(path.join(dir,'reel.config.json'),JSON.stringify(p));
 const helper=path.join(dir,'python-fixture');
 fs.writeFileSync(helper,`#!${python}\nimport sys,json,pathlib,os\nif '-c' in sys.argv: print('fixture');sys.exit(0)\nout=pathlib.Path(sys.argv[sys.argv.index('--out')+1])\nrow={'sceneId':'one','scene':1,'turn':0,'who':'a','status':'unavailable','reason':'fixture '+os.environ['FIXTURE_API_KEY'],'transcript':None,'differences':[]}\n(out/'speech-check.json').write_text(json.dumps({'schema':'narova.speech-check/1','complete':False,'turns':[row]}))\nprint('speech fixture unavailable')\nsys.exit(1)\n`);fs.chmodSync(helper,0o700);
 const preload=path.join(dir,'preload.js');
 fs.writeFileSync(preload,`const fs=require('fs'),path=require('path');const pipeline=require(${JSON.stringify(path.resolve(__dirname,'../src/pipeline'))});let count=0;const synth=pipeline.synth;pipeline.build=(config,opts)=>{fs.mkdirSync(opts.out,{recursive:true});if(count++){synth(opts.out,{...opts,config});throw new Error('unexpected synth success');}const mp4=path.join(opts.out,'video.mp4');fs.writeFileSync(mp4,'prior committed member');return {mp4,renderer:'fixture'};};`);
 const secret='disposable-fixture-credential';
 const r=spawnSync(process.execPath,['--require',preload,cli,'build','--variants','--json'],{cwd:dir,encoding:'utf8',env:{...process.env,NAROVA_HOME:path.join(dir,'home'),NAROVA_PYTHON:helper,FIXTURE_API_KEY:secret},timeout:30000});
 assert.equal(r.status,1,r.stderr);const result=JSON.parse(r.stdout);
 assert.deepEqual(result.data.speechFailure.turns,[{sceneId:'one',turn:0,status:'unavailable'}]);
 const diag=result.diagnostics.find(d=>d.subject==='scene one turn 0');assert.ok(diag);assert.match(diag.message,/unavailable/);assert.match(diag.message,/REDACTED/i);assert.ok(!r.stdout.includes(secret));assert.ok(!r.stderr.includes(secret));
 const videos=result.artifacts.filter(a=>a.role==='video');assert.equal(videos.length,1);assert.equal(fs.readFileSync(videos[0].path,'utf8'),'prior committed member');
 assert.ok(result.artifacts.some(a=>a.role==='speech-check'));
});


test('cached recognizer aliases, Hub IDs and defaults bind current snapshot and tokenizer bytes without acquisition',t=>{
 const dir=temp(t),names=['HF_HOME','HF_HUB_CACHE','HUGGINGFACE_HUB_CACHE','NAROVA_WHISPER_MODEL'];
 const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));for(const k of names)delete process.env[k];process.env.HF_HOME=dir;
 t.after(()=>{for(const [k,v]of Object.entries(old)){if(v==null)delete process.env[k];else process.env[k]=v;}});
 const config=resolveConfig({...raw(),speech:{check:'warn',retakes:1,engine:'faster-whisper',model:'tiny.en'}},{},dir);
 const revision='a'.repeat(40), repo=path.join(dir,'hub/models--Systran--faster-whisper-tiny.en'),snapshot=path.join(repo,'snapshots',revision);
 const missing=audioFingerprint(config);fs.mkdirSync(snapshot,{recursive:true});fs.mkdirSync(path.join(repo,'refs'));fs.writeFileSync(path.join(repo,'refs/main'),revision);fs.writeFileSync(path.join(snapshot,'model.bin'),'weights');fs.writeFileSync(path.join(snapshot,'tokenizer.json'),'tokenizer');
 const acquired=audioFingerprint(config);assert.notEqual(acquired,missing);
 for(const model of ['tiny.en','Systran/faster-whisper-tiny.en',null]){
  if(model)config.speech.model=model;else delete config.speech.model;
  const before=audioFingerprint(config);fs.appendFileSync(path.join(snapshot,'model.bin'),'replaced');assert.notEqual(audioFingerprint(config),before);
  const weights=audioFingerprint(config);fs.appendFileSync(path.join(snapshot,'tokenizer.json'),'changed');assert.notEqual(audioFingerprint(config),weights);
 }
 config.speech.model='tiny.en';const before=audioFingerprint(config),next='b'.repeat(40);
 fs.mkdirSync(path.join(repo,'snapshots',next));fs.writeFileSync(path.join(repo,'snapshots',next,'model.bin'),'new revision');fs.writeFileSync(path.join(repo,'refs/main'),next);assert.notEqual(audioFingerprint(config),before);
 config.speech.retakes=0;const plain=audioFingerprint(config);fs.appendFileSync(path.join(repo,'snapshots',next,'model.bin'),'other');assert.equal(audioFingerprint(config),plain);
 assert.ok(!fs.existsSync(path.join(dir,'hub/models--Systran--faster-whisper-tiny')),'default snapshot lookup must not acquire missing models');
});

test('advisory recognition resolves relative environment model paths from the synthesis directory',t=>{
 const dir=temp(t),helper=path.join(dir,'python-fixture'),envNames=['NAROVA_PYTHON','NAROVA_WHISPER_MODEL'];
 const prior=Object.fromEntries(envNames.map(k=>[k,process.env[k]]));t.after(()=>{for(const[k,v]of Object.entries(prior)){if(v==null)delete process.env[k];else process.env[k]=v;}});
 process.env.NAROVA_PYTHON=helper;process.env.NAROVA_WHISPER_MODEL='models/relative.bin';
 fs.writeFileSync(helper,`#!${python}\nimport json,os\nprint(json.dumps({'schema':'narova.speech-check/1','turns':[],'counts':{'match':0,'mismatch':0,'unavailable':0},'modelResolved':os.path.abspath(os.environ['NAROVA_WHISPER_MODEL'])}))\n`);fs.chmodSync(helper,0o700);
 const config=resolveConfig({...raw(),speech:{check:'warn',retakes:1,engine:'whisper-cpp'}},{},dir);
 const out=path.join(dir,'out');fs.mkdirSync(out);fs.writeFileSync(path.join(out,'.audio-fingerprint'),audioFingerprint(config));
 const report=require('../src/speech-check').reviewSpeech(config,out);
 assert.equal(report.modelResolved,path.resolve(__dirname,'../models/relative.bin'));
 assert.notEqual(report.modelResolved,path.join(dir,'models/relative.bin'));
});

test('relative recognizer stores and fallback tokenizer contents share the actual recognition root',t=>{
 const toolRoot=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(toolRoot,'.speech-identity-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const names=['NAROVA_HOME','HF_HOME','HF_HUB_CACHE','HUGGINGFACE_HUB_CACHE','NAROVA_WHISPER_MODEL','XDG_CACHE_HOME','NAROVA_SPEECH_TEST_HOME'];
 const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));for(const k of names)delete process.env[k];
 t.after(()=>{for(const[k,v]of Object.entries(old)){if(v==null)delete process.env[k];else process.env[k]=v;}});
 const relative=path.relative(toolRoot,dir);process.env.NAROVA_HOME=relative;process.env.HF_HOME=relative;
 const model=path.join(dir,'models/ggml-tiny.en.bin');fs.mkdirSync(path.dirname(model));fs.writeFileSync(model,'cpp weights');
 const config={speech:{check:'warn',retakes:1,engine:'whisper-cpp'}};
 const before=audioFingerprint(config);fs.appendFileSync(model,'actual replacement');assert.notEqual(audioFingerprint(config),before);
 function snapshot(cache,repo){
  const root=path.join(cache,'models--'+repo.replaceAll('/','--')),revision='c'.repeat(40),s=path.join(root,'snapshots',revision);
  fs.mkdirSync(s,{recursive:true});fs.mkdirSync(path.join(root,'refs'));fs.writeFileSync(path.join(root,'refs/main'),revision);return s;
 }
 const converted=snapshot(path.join(dir,'hub'),'Systran/faster-whisper-tiny.en');fs.writeFileSync(path.join(converted,'model.bin'),'model');fs.writeFileSync(path.join(converted,'tokenizer.json'),'tokenizer');
 config.speech={check:'warn',retakes:1,engine:'faster-whisper',model:'tiny.en'};
 const cached=audioFingerprint(config);fs.appendFileSync(path.join(converted,'model.bin'),'new weights');assert.notEqual(audioFingerprint(config),cached);
 process.env.HF_HUB_CACHE=path.join(relative,'custom-hub');
 const override=snapshot(path.join(dir,'custom-hub'),'Systran/faster-whisper-tiny.en');fs.writeFileSync(path.join(override,'model.bin'),'override weights');fs.writeFileSync(path.join(override,'tokenizer.json'),'override tokenizer');
 const changed=audioFingerprint(config);fs.appendFileSync(path.join(override,'model.bin'),'changed');assert.notEqual(audioFingerprint(config),changed);
 const overrideFile=path.join(override,'model.bin');
 process.env.NAROVA_SPEECH_TEST_HOME=dir;
 for(const value of ['$NAROVA_SPEECH_TEST_HOME/custom-hub','${NAROVA_SPEECH_TEST_HOME}/custom-hub',path.join('~',path.relative(os.homedir(),path.join(dir,'custom-hub'))) ]){
  process.env.HF_HUB_CACHE=value;
  const previous=audioFingerprint(config);fs.appendFileSync(overrideFile,'changed');assert.notEqual(audioFingerprint(config),previous,value);
 }
 process.env.HF_HUB_CACHE=path.join(relative,'custom-hub');
 const local=path.join(dir,'local-converted');fs.mkdirSync(local);fs.writeFileSync(path.join(local,'model.bin'),'local weights');config.speech.model=local;
 for(const repo of ['openai/whisper-tiny.en','openai/whisper-tiny']){
  // Rust tokenizer fallback uses HF_HOME/hub despite HF_HUB_CACHE override.
  const fallback=snapshot(path.join(dir,'hub'),repo),tokenizer=path.join(fallback,'tokenizer.json');fs.writeFileSync(tokenizer,'fallback tokenizer');
  const previous=audioFingerprint(config);fs.appendFileSync(tokenizer,'replacement');assert.notEqual(audioFingerprint(config),previous);
 }
 fs.writeFileSync(path.join(local,'tokenizer.json'),'locally bound tokenizer');
 const bound=audioFingerprint(config);fs.appendFileSync(path.join(dir,'hub/models--openai--whisper-tiny.en/snapshots','c'.repeat(40),'tokenizer.json'),'unused change');assert.equal(audioFingerprint(config),bound,'unused fallback must not invalidate a locally bound tokenizer');
 fs.unlinkSync(path.join(local,'tokenizer.json'));fs.symlinkSync(path.join(dir,'missing-tokenizer'),path.join(local,'tokenizer.json'));
 const broken=audioFingerprint(config);fs.appendFileSync(path.join(local,'model.bin'),'changed readable weights');assert.notEqual(audioFingerprint(config),broken,'broken optional tokenizer must not discard readable model identity');
 const fallbackFile=path.join(dir,'hub/models--openai--whisper-tiny.en/snapshots','c'.repeat(40),'tokenizer.json');
 const previous=audioFingerprint(config);fs.appendFileSync(fallbackFile,'changed fallback');assert.notEqual(audioFingerprint(config),previous,'dangling tokenizer uses the bound fallback');
 fs.unlinkSync(path.join(local,'tokenizer.json'));fs.mkdirSync(path.join(local,'tokenizer.json'));
 const directory=audioFingerprint(config);fs.appendFileSync(fallbackFile,'other fallback');assert.notEqual(audioFingerprint(config),directory,'a tokenizer directory is not a bound tokenizer file');
 config.speech.retakes=0;const zero=audioFingerprint(config);fs.appendFileSync(path.join(local,'model.bin'),'other weights');assert.equal(audioFingerprint(config),zero);
});


test('empty environment cache roots retain getenv semantics for recognizer model identity',t=>{
 const root=path.resolve(__dirname,'..'),dir=temp(t),unique=path.basename(dir),names=['NAROVA_HOME','HF_HOME','HF_HUB_CACHE','HUGGINGFACE_HUB_CACHE','XDG_CACHE_HOME','NAROVA_WHISPER_MODEL'];
 const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));t.after(()=>{for(const[k,v]of Object.entries(old)){if(v==null)delete process.env[k];else process.env[k]=v;}});
 const created=new Set(),owned=[];
 function mkdir(d){if(!fs.existsSync(d)){mkdir(path.dirname(d));fs.mkdirSync(d);created.add(d);}}
 t.after(()=>{for(const d of owned)fs.rmSync(d,{recursive:true,force:true});for(const d of [...created].reverse()){try{fs.rmdirSync(d);}catch{}}});
 let index=0;
 for(const[key,suffix]of [['HF_HUB_CACHE',''],['HUGGINGFACE_HUB_CACHE',''],['HF_HOME','hub'],['XDG_CACHE_HOME','huggingface/hub']]){
  for(const k of names)delete process.env[k];process.env[key]='';
  const repo=`fixture/${unique}-${index++}`,base=path.join(root,suffix,'models--'+repo.replaceAll('/','--')),revision='d'.repeat(40),snapshot=path.join(base,'snapshots',revision);
  mkdir(snapshot);mkdir(path.join(base,'refs'));owned.push(base);fs.writeFileSync(path.join(base,'refs/main'),revision);fs.writeFileSync(path.join(snapshot,'tokenizer.json'),'tokenizer');const model=path.join(snapshot,'model.bin');fs.writeFileSync(model,'weights');
  const config={speech:{check:'warn',retakes:1,engine:'faster-whisper',model:repo}};
  const previous=audioFingerprint(config);fs.appendFileSync(model,'replacement');assert.notEqual(audioFingerprint(config),previous,key);
 }
 for(const k of names)delete process.env[k];process.env.NAROVA_HOME='';
 const models=path.join(root,'models');mkdir(models);const model=path.join(models,unique+'.bin');owned.push(model);fs.writeFileSync(model,'cpp model');
 const config={speech:{check:'warn',retakes:1,engine:'whisper-cpp',model:path.basename(model)}};
 const before=audioFingerprint(config);fs.appendFileSync(model,'replacement');assert.notEqual(audioFingerprint(config),before,'empty NAROVA_HOME');
});
