'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const p=require('../src/pronunciation');
const {resolveConfig}=require('../src/schema');
const {compile,hashConfig}=require('../src/manifest');
const {configFromManifest}=require('../src/pipeline');
const {audioFingerprint,timingsFingerprint,narrationContextDigest}=require('../src/audio-fingerprint');
const {narrationDigest,sceneProjection,stateIdentity,manifestIdentity}=require('../src/revisions');
const series=require('../src/series');
const raw=()=>({title:'Pronunciation',renderer:'no-browser',voices:{a:{backend:'piper',speaker:'en_US-lessac-medium'}},scenes:[{id:'one',body:'<p>CLAUDE.md</p>',vo:[{who:'a',text:'Read CLAUDE.md. Keep this line.'}]}]});
const save=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v));};

test('literal longest matching is case sensitive, Unicode bounded and nonrecursive',()=>{
 const map={'CLAUDE.md':'Claude Em Dee','Claude':'Clawd','Code':'Another. Sentence!','محمد':'Muhammad','😀':'Smile'};
 assert.equal(p.applyPronounce('CLAUDE.md, Claude Code; xClaude Claude2 Claude_ Claudé claude محمد محمدی 😀.',map),'Claude Em Dee, Clawd Another. Sentence!; xClaude Claude2 Claude_ Claudé claude Muhammad محمدی Smile.');
 assert.equal(p.applyPronounce('A+B [name] $foo',{'A+B':'sum','[name]':'person','$foo':'variable'}),'sum person variable');
});
test('sentence ownership survives replacements and existing external synthesisText precedence/fallback',()=>{
 const t={text:'Read CLAUDE.md. Continue.',synthesisText:'[whisper] CLAUDE.md! Continue!'};
 const map={'CLAUDE.md':'Claude. Em Dee','Continue.':'Keep going'};
 assert.deepEqual(p.spokenSentences(t,'pockettts',map),['Read Claude. Em Dee.','Keep going']);
 assert.deepEqual(p.spokenSentences(t,'external',map),['[whisper] Claude. Em Dee!','Continue!']);
 assert.deepEqual(p.spokenSentences({...t,synthesisText:'Different.'},'external',map),p.spokenSentences(t,'piper',map));
});
test('malformed pronunciation records fail before production with source diagnostics',()=>{
 for(const pronounce of [null,false,[],new Date(),{'':'x'},{' foo':'x'},{foo:4},{foo:''},{foo:' x'},JSON.parse('{"__proto__":"x"}'),{constructor:'x'}]) assert.throws(()=>resolveConfig({...raw(),pronounce}),/pronounce/);
 assert.deepEqual(resolveConfig({...raw(),pronounce:{}}).pronounce,{});
});
test('manifest restoration and effective identities preserve clean text and unused-map compatibility',()=>{
 const original=resolveConfig(raw());
 const unused=resolveConfig({...raw(),pronounce:{Unused:'other'}});
 const used=resolveConfig({...raw(),pronounce:{'CLAUDE.md':'Claude Em Dee'}});
 for(const fingerprint of [audioFingerprint,timingsFingerprint]){assert.equal(fingerprint(original),fingerprint(unused));assert.notEqual(fingerprint(original),fingerprint(used));}
 assert.equal(narrationContextDigest(original),narrationContextDigest(used));
 assert.equal(hashConfig(original),hashConfig(unused));
 for(const config of [unused,resolveConfig({...raw(),pronounce:{}})]) {
   assert.equal(stateIdentity(original),stateIdentity(config));
   assert.equal(manifestIdentity(compile(original)),manifestIdentity(compile(config)));
 }
 assert.notEqual(stateIdentity(original),stateIdentity(used));
 const m=compile(used),restored=configFromManifest(m);
 assert.deepEqual(restored.pronounce,used.pronounce);assert.equal(restored.scenes[0].vo[0].text,raw().scenes[0].vo[0].text);
 assert.equal(audioFingerprint(used),audioFingerprint(restored));
 assert.equal(narrationDigest(original.scenes[0],original),narrationDigest(unused.scenes[0],unused));
 assert.notEqual(sceneProjection(compile(original))[0].narration,sceneProjection(m)[0].narration);
});
test('series pins retain pronunciation and support literal overrides/removal and portable detach',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'narova-pronounce-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
 const file=path.join(root,'series.config.json'),project=path.join(root,'episode');
 const source={format:series.FORMAT,id:'course',title:'Course',defaults:{pronounce:{'CLAUDE.md':'Claude Em Dee','Claude Code':'Clawd Code','NASA':'Nassa'}},episodes:[{id:'one',title:'One',project:'episode'}]};
 save(file,source);save(path.join(project,'reel.config.json'),{...raw(),pronounce:{'Claude Code':'Claude code'},seriesOverrides:{remove:{pronounce:['NASA']}}});
 const old=series.pin(file,'one');series.prepareBuild(file,'one');
 source.defaults.pronounce['CLAUDE.md']='new';source.episodes[0].shared={revision:old.revision};save(file,source);
 const load=async dir=>resolveConfig((await require('../src/config').loadProjectConfig(dir)).raw,{},dir);
 const config=await load(project);assert.deepEqual(series.inspectProject(project).effective.defaults.pronounce,config.pronounce);assert.deepEqual(config.pronounce,{'CLAUDE.md':'Claude Em Dee','Claude Code':'Claude code'});
 series.pin(file,'one');assert.deepEqual(series.compare(file,project).runtime.changedDefaults,['pronounce']);
 const target=path.join(root,'detached');series.detach(project,target);fs.rmSync(path.join(root,series.STORE),{recursive:true});fs.unlinkSync(file);
 assert.deepEqual((await load(target)).pronounce,config.pronounce);
 assert.throws(()=>series.validateSource({...source,defaults:{pronounce:{'bad':' '}}}),/pronounce/);
});

test('bound and detached merge does not normalize malformed episode maps into valid records',()=>{
 const {mergeDefaults}=require('../src/series-defaults');
 for(const local of [new Date(),new Map(),new Set()]) assert.throws(()=>resolveConfig(mergeDefaults({...raw(),pronounce:local},{pronounce:{NASA:'Nassa'}},[]).raw),/pronounce/);
});
