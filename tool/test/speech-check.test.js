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
const { audioFingerprint } = require('../src/audio-fingerprint');
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
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'out/speech-check.json'))).counts.unavailable,1);
 }
 assert.ok(!fs.existsSync(path.join(dir,'home')));
});
