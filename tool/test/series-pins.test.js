'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const series=require('../src/series');
const archive=require('../src/project-archive');
const {resolveConfig}=require('../src/schema');
const BIN=path.resolve(__dirname,'../bin/narova.js');
const save=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v,null,2));};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'narova-pins-'));t.after(()=>fs.rmSync(root,{force:true,recursive:true}));
 const raw={title:'Episode',renderer:'no-browser',scenes:[{id:'one',dur:1,vo:[],visual:{type:'rect',w:1280,h:720,fill:'#fff'}}]};
 const file=path.join(root,'series.config.json'),source={format:series.FORMAT,id:'course',title:'Course',defaults:{theme:{accent:'#ff0000'}},resources:{look:{file:'styles/look.css',dependencies:['fonts/shared.woff2']},other:{file:'media/other.svg'}},context:{audience:{text:'Beginners'}},states:{start:{facts:{day:1}}},episodes:['first','second','third'].map(id=>({id,title:id,project:'episodes/'+id}))};
 save(file,source);save(path.join(root,'styles/look.css'),'@font-face{font-family:Shared;src:url(../fonts/shared.woff2)} .shared{color:red}');save(path.join(root,'fonts/shared.woff2'),'storage-only font fixture');save(path.join(root,'media/other.svg'),'<svg/>');
 for(const e of source.episodes)save(path.join(root,e.project,'reel.config.json'),raw);
 const project=id=>path.join(root,'episodes',id);return{root,file,source,raw,project,read:()=>JSON.parse(fs.readFileSync(file)),put:s=>save(file,s),pin:(id,options={})=>series.pin(file,id,options),prepare:(id,options={})=>series.prepareBuild(file,id,options)};
}
const run=args=>spawnSync(process.execPath,[BIN,...args],{encoding:'utf8',env:{...process.env,NAROVA_FIRST_RUN:'0'}});

test('two pins share each payload once; later CSS revision retains old look and same font',t=>{
 const f=fixture(t);let s=f.read();s.episodes[0].shared={resources:['look'],context:['audience'],incoming:'start'};f.put(s);
 const a=f.pin('first'),b=f.pin('second',{resources:['look']});assert.equal(fs.readdirSync(path.join(f.root,series.STORE,'files')).length,2);assert.notEqual(a.revision,b.revision);assert.equal(fs.existsSync(path.join(f.project('first'),series.HOME)),false);
 save(path.join(f.root,'styles/look.css'),'@font-face{font-family:Shared;src:url(../fonts/shared.woff2)} .shared{color:green}');f.pin('third',{resources:['look']});assert.equal(fs.readdirSync(path.join(f.root,series.STORE,'files')).length,3);
 fs.rmSync(path.join(f.root,'styles'),{recursive:true});fs.rmSync(path.join(f.root,'fonts'),{recursive:true});
 f.prepare('first');f.prepare('second');f.prepare('third');for(const id of ['first','second'])assert.match(fs.readFileSync(path.join(f.project(id),series.FILES,'styles/look.css'),'utf8'),/color:red/);assert.match(fs.readFileSync(path.join(f.project('third'),series.FILES,'styles/look.css'),'utf8'),/color:green/);
 assert.equal(series.readBinding(f.project('first')).defaults.theme.accent,'#ff0000');assert.deepEqual(f.read().episodes[0].shared,{revision:a.revision});assert.equal(series.inspectSource(f.file).episodes[0].pin.available,true);
});

test('catalog recipe is initial default; explicit selectors replace it, then frozen repeats retain selection',t=>{
 const f=fixture(t),s=f.read();s.episodes[0].shared={resources:['look'],context:['audience'],incoming:'start'};s.episodes[1].shared={resources:['look']};f.put(s);
 f.prepare('first',{resources:[],incoming:''});assert.deepEqual(series.readBinding(f.project('first')).selection,{resources:[],context:['audience'],incoming:null});
 f.prepare('second');s.episodes[1].shared={resources:['other']};f.put(s);f.prepare('second');assert.deepEqual(series.readBinding(f.project('second')).selection.resources,['look']);
});

test('selected object corruption fails before initial publication and before retained reuse; unrelated corrupt object is ignored',t=>{
 const f=fixture(t),a=f.pin('first',{resources:['look']});const report=series.inspectSource(f.file);assert.equal(report.episodes[0].pin.available,true);f.prepare('first');
 const b=series.readBinding(f.project('first')),object=path.join(f.root,series.STORE,'files',b.files[0].sha256);save(path.join(f.root,series.STORE,'files','a'.repeat(64)),'unselected garbage');f.prepare('first');save(object,'corrupt');
 assert.throws(()=>f.prepare('first',{updateShared:true}),/mismatch|stored byte count/);assert.equal(series.readBinding(f.project('first')).revision,a.revision);assert.equal(series.inspectSource(f.file).episodes[0].pin.available,false);
 fs.rmSync(f.project('first'),{recursive:true});save(path.join(f.project('first'),'reel.config.json'),f.raw);assert.throws(()=>f.prepare('first'),/mismatch|stored byte count/);assert.equal(fs.existsSync(path.join(f.project('first'),series.MEMBERSHIP)),false);
});

test('pin is full dependency identity, rejects missing/symlinked manifest/object and cross-episode substitution',t=>{
 const f=fixture(t),a=f.pin('first',{resources:['look']});const store=path.join(f.root,series.STORE);const manifest=path.join(store,'bindings',a.revision+'.json'),bytes=fs.readFileSync(manifest);
 fs.unlinkSync(manifest);assert.throws(()=>f.prepare('first'),/missing file/);fs.writeFileSync(manifest,bytes);
 const binding=JSON.parse(bytes),obj=path.join(store,'files',binding.files[0].sha256),payload=fs.readFileSync(obj);fs.unlinkSync(obj);fs.symlinkSync(path.join(f.root,'fonts/shared.woff2'),obj);assert.throws(()=>f.prepare('first'),/symlink/);fs.unlinkSync(obj);fs.writeFileSync(obj,payload);
 let s=f.read();s.episodes[1].shared={revision:a.revision};f.put(s);assert.throws(()=>f.prepare('second'),/series\/episode/);
 const count=fs.readdirSync(path.join(store,'files')).length;save(path.join(f.root,'fonts/shared.woff2'),'new font');const next=f.pin('first');assert.notEqual(next.revision,a.revision);assert.equal(fs.readdirSync(path.join(store,'files')).length,count+1);
});

test('repinning is explicit and a prepared mismatch requires update; adoption history/restoration remain valid',t=>{
 const f=fixture(t),a=f.pin('first',{resources:['look'],context:['audience']});f.prepare('first');
 save(path.join(f.root,'styles/look.css'),'@font-face{font-family:Shared;src:url(../fonts/shared.woff2)} .shared{color:green}');const b=f.pin('first');assert.deepEqual(b.selection,a.selection);
 assert.throws(()=>f.prepare('first'),/--update-shared/);assert.equal(series.readBinding(f.project('first')).revision,a.revision);assert.throws(()=>f.prepare('first',{resources:['other'],updateShared:true}),/repin/);
 assert.equal(f.prepare('first',{updateShared:true}).revision,b.revision);series.restore(a.revision,f.project('first'));assert.equal(series.readBinding(f.project('first')).revision,a.revision);assert.throws(()=>f.prepare('first'),/--update-shared/);
 assert.equal(f.prepare('first',{resources:['look'],context:['audience'],updateShared:true}).revision,b.revision);
});

test('from-bound migration preserves old retained selection without reading live files or changing the episode',t=>{
 const f=fixture(t);series.bind(f.file,'first',{resources:['look'],context:['audience']});const before=fs.readFileSync(path.join(f.project('first'),series.BINDING));fs.rmSync(path.join(f.root,'fonts'),{recursive:true});fs.rmSync(path.join(f.root,'styles'),{recursive:true});
 assert.throws(()=>f.pin('first',{fromBound:true,resources:[]}),/omit selection/);const pin=f.pin('first',{fromBound:true});assert.equal(pin.revision,JSON.parse(before).revision);assert.deepEqual(fs.readFileSync(path.join(f.project('first'),series.BINDING)),before);
 fs.rmSync(path.join(f.project('first'),series.HOME),{recursive:true});fs.unlinkSync(path.join(f.project('first'),series.MEMBERSHIP));assert.equal(f.prepare('first').revision,pin.revision);
});

test('pin admission failures preserve prior catalog and never silently repair corrupt objects',t=>{
 const f=fixture(t);f.pin('first',{resources:['look']});const before=fs.readFileSync(f.file);const report=series.inspectSource(f.file),manifest=JSON.parse(fs.readFileSync(path.join(f.root,series.STORE,'bindings',report.episodes[0].shared.revision+'.json')));save(path.join(f.root,series.STORE,'files',manifest.files[0].sha256),'bad');
 assert.throws(()=>f.pin('first'),/mismatch/);assert.deepEqual(fs.readFileSync(f.file),before);
});

test('catalog publication failure and intervening edit preserve source; valid unreferenced store bytes may remain',t=>{
 const f=fixture(t);const before=fs.readFileSync(f.file),link=fs.linkSync;fs.linkSync=function(a,b){if(b===f.file&&!String(a).includes('backup'))throw new Error('injected catalog publish failure');return link.apply(this,arguments);};try{assert.throws(()=>f.pin('first',{resources:['look']}),/injected/);}finally{fs.linkSync=link;}assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(fs.existsSync(path.join(f.root,series.STORE,'lock')),false);
 const write=fs.writeFileSync;let edited=false;fs.writeFileSync=function(file,...args){const result=write.call(this,file,...args);if(String(file).includes('.catalog-pin-')&&!edited){edited=true;write(f.file,JSON.stringify({...f.read(),title:'Concurrent edit'}));}return result;};try{assert.throws(()=>f.pin('first',{resources:['look']}),/catalog changed/);}finally{fs.writeFileSync=write;}assert.equal(f.read().title,'Concurrent edit');assert.equal(f.read().episodes[0].shared,undefined);
});

test('pinned materialization still packs/opens/detaches without the series store',t=>{
 const f=fixture(t);f.pin('first',{resources:['look']});f.prepare('first');const project=f.project('first');const selected=archive.collectProjectFiles(project);assert.ok(series.verifyArchive(selected.files));const target=path.join(f.root,'detached');series.detach(project,target);fs.rmSync(path.join(f.root,series.STORE),{recursive:true});fs.rmSync(path.join(f.root,'fonts'),{recursive:true});fs.rmSync(path.join(f.root,'styles'),{recursive:true});assert.ok(series.readBinding(project));const raw=JSON.parse(fs.readFileSync(path.join(target,'reel.config.json')));assert.ok(resolveConfig(raw,{},target).localResources.length);assert.equal(fs.existsSync(path.join(target,series.MEMBERSHIP)),false);
});

test('CLI pin exposes structured publication and focused help; rejects invalid shared data and misplaced from-bound',t=>{
 const f=fixture(t);const help=run(['series','pin','--help']);assert.equal(help.status,0);assert.match(help.stdout,/--from-bound/);const result=run(['series','pin',f.file,'--episode','first','--resources','look','--json']);assert.equal(result.status,0,result.stderr+result.stdout);const data=JSON.parse(result.stdout);assert.equal(data.operation,'series pin');assert.equal(data.data.committed,true);assert.equal(data.data.revision,f.read().episodes[0].shared.revision);
 const misplaced=run(['series','inspect',f.file,'--from-bound','--json']);assert.notEqual(misplaced.status,0);assert.match(misplaced.stdout,/only valid/);
 for(const shared of [{revision:['a'.repeat(64)]},{revision:'bad'},{revision:'a'.repeat(64),resources:[]},{resources:['look','look']},{resources:['absent']},{unknown:true},{incoming:'absent'}]){const s=f.read();s.episodes[1].shared=shared;f.put(s);assert.throws(()=>series.inspectSource(f.file),/pin requires|unknown|unique/);}
});


test('an edit immediately before atomic catalog capture is retained instead of overwritten',t=>{
 const f=fixture(t),rename=fs.renameSync;fs.renameSync=function(a,b){if(a===f.file){const s=f.read();s.episodes[1].title='Concurrent sibling edit';save(f.file,s);}return rename.apply(this,arguments);};
 try{assert.throws(()=>f.pin('first',{resources:['look']}),/catalog changed/);}finally{fs.renameSync=rename;}
 assert.equal(f.read().episodes[1].title,'Concurrent sibling edit');assert.equal(f.read().episodes[0].shared,undefined);assert.equal(fs.existsSync(path.join(f.root,series.STORE,'lock')),false);
});

test('a concurrent new catalog wins exclusive publication; recovery bytes are named and retained',t=>{
 const f=fixture(t),before=fs.readFileSync(f.file),link=fs.linkSync;fs.linkSync=function(a,b){if(b===f.file&&!String(a).includes('backup'))save(f.file,{...f.source,title:'Concurrent replacement'});return link.apply(this,arguments);};
 let error;try{f.pin('first',{resources:['look']});}catch(e){error=e;}finally{fs.linkSync=link;}
 assert.match(error?.message,/catalog changed during publication/);assert.match(error.message,/preserve recovery material/);assert.equal(f.read().title,'Concurrent replacement');assert.equal(f.read().episodes[0].shared,undefined);
 const recovery=fs.readdirSync(f.root).find(n=>n.startsWith('.catalog-pin-backup-'));assert.ok(recovery);assert.deepEqual(fs.readFileSync(path.join(f.root,recovery)),before);
});

test('store admission rejects symlink directories and busy mutation without publishing a pin',t=>{
 const f=fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(f.root,series.STORE),'dir');assert.throws(()=>f.pin('first',{resources:['look']}),/contained directory/);assert.equal(f.read().episodes[0].shared,undefined);fs.unlinkSync(path.join(f.root,series.STORE));fs.mkdirSync(path.join(f.root,series.STORE));fs.mkdirSync(path.join(f.root,series.STORE,'lock'));assert.throws(()=>f.pin('first',{resources:['look']}),/busy store mutation/);assert.equal(f.read().episodes[0].shared,undefined);
});
