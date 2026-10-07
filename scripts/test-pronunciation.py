# Actual Pocket/ASR/MP4 proof on an already prepared local environment.
import os,json,pathlib,tempfile,subprocess,hashlib,time,re
R=pathlib.Path(__file__).resolve().parent.parent;P=pathlib.Path(os.environ.get('NAROVA_PRONUNCIATION_PRODUCT',str(R/'tool')))
D=pathlib.Path(tempfile.mkdtemp(prefix='narova-pronunciation-'));print('project='+str(D),flush=True)
E={k:v for k,v in os.environ.items() if not re.search(r'token|secret|password|api.?key|authorization|credential',k,re.I)}
E.update(NAROVA_FIRST_RUN='0',NAROVA_HOME=str(D/'home'),NAROVA_CACHE=str(D/'cache'),NAROVA_POCKETTTS_OFFLINE='1',HF_HUB_OFFLINE='1',HF_TOKEN='',HF_HUB_DISABLE_IMPLICIT_TOKEN='true',PYTHONDONTWRITEBYTECODE='1')
model=os.environ['NAROVA_PRONUNCIATION_MODEL']  # Already acquired local recognition model.
assert pathlib.Path(model).is_dir(), 'Supply an existing local ASR model directory'
CLI=['node',str(P/'bin/narova.js')];project=D/'episode';project.mkdir()
raw={'title':'Pronunciation and captions','renderer':'no-browser','size':{'w':640,'h':360},'voices':{'a':{'backend':'pockettts','speaker':'stuart_bell','providerOptions':{'maxTokens':80}}},'speech':{'check':'fail','retakes':2,'engine':'faster-whisper','model':model},'timing':{'tempo':1,'lead':.1,'tail':.1},'captions':{'preset':'karaoke','maxWords':8},'scenes':[{'id':'one','visual':{'type':'text','text':'Read CLAUDE.md','style':{'color':'#ffffff','fontSize':30}},'vo':[{'who':'a','text':'Read CLAUDE.md.','lang':'en'},{'who':'a','text':'Keep this lesson short.','lang':'en'}]}]}
(project/'reel.config.json').write_text(json.dumps(raw));source={'format':'narova.series/1','id':'course','title':'Course','defaults':{'pronounce':{'CLAUDE.md':'Claude Em Dee'}},'episodes':[{'id':'one','title':'One','project':'episode'}]};catalog=D/'series.config.json';catalog.write_text(json.dumps(source))
results={'product':str(P),'project':str(D),'readyCachedModels':True,'checks':[]}
def call(label,args,cwd=project,expected=0):
 start=time.monotonic();p=subprocess.run(CLI+args,cwd=cwd,env=E,text=True,capture_output=True,timeout=360);(D/(label+'.log')).write_text(p.stdout+p.stderr);print(label+' exit='+str(p.returncode)+' seconds='+str(round(time.monotonic()-start,2)),flush=True);assert p.returncode==expected,(label,p.stdout,p.stderr);return p
call('pin',['series','pin',str(catalog),'--episode','one'])
call('cold',['series','build',str(catalog),'--episode','one'])
report=json.loads((project/'out/speech-check.json').read_text());assert report['counts']=={'match':2,'mismatch':0,'unavailable':0},report
assert report['turns'][0]['expectedText']==raw['scenes'][0]['vo'][0]['text'];assert report['turns'][0]['spokenText']=='Read Claude Em Dee.'
takes=json.loads((project/'out/audio/takes.json').read_text());assert takes[0]['text']=='Read Claude Em Dee.'
words=json.loads((project/'out/timings.json').read_text())['one']['words'];assert 'CLAUDE.md.' in [w['w'] for w in words];assert not any(w['w'] in ['Em','Dee'] for w in words)
for ext in ['srt','vtt']:
 captions=(project/f'out/captions.{ext}').read_text();assert 'CLAUDE.md' in captions and 'Em Dee' not in captions
results['report']=report;results['checks'].append('Pocket stuart_bell mapped speech with passing independent ASR and clean caption/cue text')
video=project/'out/video.mp4';before=hashlib.sha256(video.read_bytes()).hexdigest();neighbor=(project/'out/audio/sentences/01_001.wav').read_bytes()
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_name,width,height','-of','json',str(video)],text=True));results['probe']=probe
frame=D/'caption.png';at=next(w['t0'] for w in words if w['w']=='CLAUDE.md.')+.05
subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',str(at),'-i',str(video),'-frames:v','1',str(frame)],check=True);results['frame']=str(frame)
review=call('review',['review','--speech','--json']);assert json.loads(review.stdout)['data']['counts']['match']==2
reuse=call('reuse',['build','--reuse']);assert 'reuse — skipping synth' in reuse.stdout;assert hashlib.sha256(video.read_bytes()).hexdigest()==before;results['checks'].append('Read-only review and exact video/audio reuse')
source['defaults']['pronounce']['CLAUDE.md']='Claude M D';catalog.write_text(json.dumps(source));call('repin',['series','pin',str(catalog),'--episode','one'])
# A live/default edit and repin do not silently change the prepared episode.
frozen=call('frozen',['build','--reuse']);assert hashlib.sha256(video.read_bytes()).hexdigest()==before
call('adopt',['series','build',str(catalog),'--episode','one','--update-shared'])
assert (project/'out/audio/sentences/01_001.wav').read_bytes()==neighbor
changed=json.loads((project/'out/audio/takes.json').read_text());assert changed[0]['text']=='Read Claude M D.' and changed[1]['cacheHit'];results['checks'].append('Explicit pin adoption changes mapped sentence only, retaining neighbor bytes')
target=D/'detached';call('detach',['series','detach',str(target),'--project',str(project)])
call('detached-build',['build'],target);assert json.loads((target/'out/speech-check.json').read_text())['counts']['match']==2
results['checks'].append('Detached standalone project retains ordinary pronunciation')
results['sha256']=hashlib.sha256(video.read_bytes()).hexdigest();results['video']=str(video);results['completed']=True
(D/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2),flush=True)
