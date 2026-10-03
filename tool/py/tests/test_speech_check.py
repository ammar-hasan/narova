import copy
import hashlib
import json
import tempfile
import sys
import time
import types
import unittest
import wave
from pathlib import Path
from unittest import mock
from narova_tts import pipeline, speech_check as speech


class Voice:
    seed_capable = True
    def __init__(self): self.calls = []
    def synthesize(self, who, text, out, **options):
        self.calls.append((text, options.get('seed')))
        seed = options.get('seed') or 0
        with wave.open(str(out), 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
            w.writeframes((int(100+seed%1000).to_bytes(2,'little',signed=True))*int(22050*(.22+seed%5*.02)))
    def close(self): pass


class Comparison(unittest.TestCase):
    def test_lexical_edits_and_equivalent_spans(self):
        self.assertEqual(speech.compare('Count that effort.', 'That effort')['differences'], [{'kind':'dropped','expected':['Count'],'observed':[]}])
        self.assertEqual([x['kind'] for x in speech.compare('Hello there','Hello uhh uhh there')['differences']],['added','added'])
        self.assertEqual(speech.compare('blue box','red box')['differences'][0]['kind'],'replaced')
        for a,b in [('Re-fixing twenty things!','refixing 20 things'),('re fixing things','refixing things'),('one hundred and twenty three','123'),('one-to-one','onetoone'),('between one hundred and two hundred','between 100 and 200'),('one trillion','1000000000000'),('one hundred and twenty thousand','120,000'),('one million and twenty thousand','1020000'),('one thousand and one hundred','1100'),('one million and one hundred thousand','1100000'),('twenty, one','20, 1'),('Hello, there','hello there'),('twenty، one','20، 1'),('twenty、one','20, 1'),('a hundred cats','100 cats'),('hundred cats','100 cats'),('a thousand and a hundred','1100'),('one quintillion','1000000000000000000'),('two thousand five hundred','2,500'),('Twenty-one cats','21 cats'),('عربی اردو','عربی اردو'),('a b c d twenty things','abcd 20 things')]:
            with self.subTest(a=a): self.assertEqual(speech.compare(a,b)['status'],'match')
        for a,b in [('one five','6'),('one five','15'),('1,2,3','123'),('one thousand and two thousand','3000'),('twenty, one','21'),('twenty; one','21'),('twenty. One.','21'),('twenty، one','21'),('twenty、one','21'),('twenty؛ one','21'),('123456789012345678901234567890','123456789012345678901234567891'),('twenty cats','21 cats'),('one and two','3'),('hello',''),('blue box','red box')]:
            with self.subTest(a=a): self.assertEqual(speech.compare(a,b)['status'],'mismatch')
    def test_cardinal_conjunctions_and_compound_hundreds(self):
        for expected, observed in [('We sold a hundred and a few more.', 'We sold 100 a few more.'),
                                   ('one hundred and twelve hundred', '1300'),
                                   ('a hundred and a million', '100 a million'),
                                   ('twenty zero cameras', '20 cameras'),
                                   ('one thousand zero cameras', '1000 cameras'),
                                   ('one hundred and zero', '100'),
                                   ('twelve hundred, one', '1201'),
                                   ('twenty one hundred hundred', '210000')]:
            with self.subTest(expected=expected):
                self.assertEqual(speech.compare(expected, observed)['status'], 'mismatch')
        edits = speech.compare('We sold a hundred and a few more.', 'We sold 100 a few more.')['differences']
        self.assertEqual(edits, [{'kind':'dropped','expected':['and'],'observed':[]}])
        for expected, observed in [('twelve hundred samples','1200 samples'),
                                   ('nineteen hundred copies','1900 copies'),
                                   ('twelve hundred and fifty','1250'),
                                   ('nineteen hundred ninety nine','1999'),
                                   ('twenty one hundred','2100'),
                                   ('a thousand and a hundred','1100'),
                                   ('one hundred and a few more','100 and a few more')]:
            with self.subTest(expected=expected):
                self.assertEqual(speech.compare(expected, observed)['status'], 'match')

    def test_unavailable_is_not_match_or_empty_success(self):
        with tempfile.TemporaryDirectory() as d:
            wav=Path(d)/'a.wav';wav.write_bytes(b'audio')
            with mock.patch.object(speech,'transcribe',side_effect=RuntimeError('missing engine')):
                self.assertEqual(speech.assess(wav,'Hello.',{},'en')['status'],'unavailable')
            with mock.patch.object(speech,'transcribe',return_value={'transcript':'','engine':'fixture','model':'fixture'}):
                result=speech.assess(wav,'Hello.',{},'en');self.assertEqual(result['status'],'mismatch');self.assertEqual(result['differences'][0]['kind'],'dropped')
    def test_recognizer_timeout_and_excess_output_are_bounded(self):
        with self.assertRaisesRegex(RuntimeError,'deadline'):
            speech._bounded_run([sys.executable,'-c','import time;time.sleep(5)'],.05)
        with self.assertRaisesRegex(RuntimeError,'exceeds'):
            speech._bounded_run([sys.executable,'-c','print("x"*1100000)'],2)
        with tempfile.TemporaryDirectory() as d:
            marker=Path(d)/'descendant'
            child_script=f'import time,pathlib;time.sleep(.3);pathlib.Path({str(marker)!r}).write_text("leaked")'
            parent_script=f'import subprocess,sys,time;subprocess.Popen([sys.executable,"-c",{child_script!r}]);time.sleep(5)'
            with self.assertRaisesRegex(RuntimeError,'deadline'):
                speech._bounded_run([sys.executable,'-c',parent_script],.12)
            time.sleep(.35)
            self.assertFalse(marker.exists(),'deadline must terminate owned recognizer descendants')
        result=speech._bounded_run([sys.executable,'-c','print("ok")'],2)
        self.assertEqual(result.stdout,'ok\n')
    def test_recognizer_selection_is_independent_and_language_aware(self):
        self.assertEqual(speech.options({'align':{'engine':'whisper-cpp','model':'old'},'speech':{'engine':'faster-whisper','model':'new'}},'fr-FR'),{'engine':'faster-whisper','model':'new','language':'fr'})
        class EnglishOnly:
            def __init__(self,*a,**k): self.model=types.SimpleNamespace(is_multilingual=False)
            def transcribe(self,*a,**k): raise AssertionError('English-only model must not silently force language to en')
        with mock.patch.dict(sys.modules,{'faster_whisper':types.SimpleNamespace(WhisperModel=EnglishOnly)}):
            with self.assertRaisesRegex(RuntimeError,'English-only'):
                speech._recognize(Path('/not-used.wav'),{'engine':'faster-whisper','model':'/local/snapshot','language':'fr'})
    def test_whisper_cpp_bare_model_lookup_and_invalid_output(self):
        from narova_tts import align
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);model=root/'models/ggml-tiny.en.bin';model.parent.mkdir();model.write_bytes(b'model')
            binary=root/'recognize';binary.write_text('#!'+sys.executable+'\nimport sys,json,pathlib\nbase=sys.argv[sys.argv.index("-of")+1]\npathlib.Path(base+".json").write_text(json.dumps({"transcription":[{"text":"Hello"}]}))\n');binary.chmod(0o700)
            with mock.patch.dict('os.environ',{'NAROVA_HOME':d}),mock.patch.object(align,'_whisper_cpp_bin',return_value=str(binary)):
                result=speech._recognize(root/'audio.wav',{'engine':'whisper-cpp','model':'ggml-tiny.en.bin','language':'en'})
                self.assertEqual(result['model'],str(model));self.assertEqual(result['transcript'],'Hello')
                quantized=model.parent/'ggml-tiny.en-q5_1.bin';quantized.write_bytes(b'model')
                with mock.patch.object(speech,'_bounded_run',side_effect=AssertionError('known English-only model must not be invoked')):
                    with self.assertRaisesRegex(RuntimeError,'English-only'):
                        speech._recognize(root/'audio.wav',{'engine':'whisper-cpp','model':str(quantized),'language':'fr'})
                renamed=model.parent/'custom.bin';renamed.write_bytes(b'model')
                for capability in (False,None,True):
                    data={'transcription':[{'text':'Bonjour'}]}
                    if capability is not None: data['model']={'multilingual':capability}
                    binary.write_text('#!'+sys.executable+'\nimport sys,pathlib\nbase=sys.argv[sys.argv.index("-of")+1]\npathlib.Path(base+".json").write_text('+repr(json.dumps(data))+')\n')
                    if capability is True:
                        self.assertEqual(speech._recognize(root/'audio.wav',{'engine':'whisper-cpp','model':str(renamed),'language':'fr'})['transcript'],'Bonjour')
                    else:
                        with self.assertRaisesRegex(RuntimeError,'English-only or unidentified'):
                            speech._recognize(root/'audio.wav',{'engine':'whisper-cpp','model':str(renamed),'language':'fr'})
                binary.write_text('#!'+sys.executable+'\nimport sys,pathlib\nbase=sys.argv[sys.argv.index("-of")+1]\npathlib.Path(base+".json").write_text("{}")\n')
                with self.assertRaisesRegex(RuntimeError,'invalid whisper.cpp'):
                    speech._recognize(root/'audio.wav',{'engine':'whisper-cpp','model':'ggml-tiny.en.bin','language':'en'})


class TurnChecks(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.cache=self.root/'cache';self.config={'voices':{'a':{'backend':'piper','speaker':'fixture'}},'timing':{'tempo':1,'gapSentence':.03,'gapTurn':.04,'lead':.02,'tail':.02}}
        self.scenes=[{'n':1,'id':'one','segments':[{'who':'a','text':'Count that effort.','lang':'en'},{'who':'a','text':'Keep this line.','lang':'en'}]}]
    def run_pipeline(self, label, policy=None, transcripts=None, reuse=False):
        out=self.root/label;out.mkdir(exist_ok=True)
        cfg=copy.deepcopy(self.config)
        if policy: cfg['speech']=policy
        (out/'narration.json').write_text(json.dumps(self.scenes));(out/'config.json').write_text(json.dumps(cfg))
        voice=Voice()
        patches=[mock.patch.object(pipeline,'CACHE_DIR',self.cache),mock.patch.object(pipeline,'build_backends',return_value={'a':voice})]
        if transcripts is not None: patches.append(mock.patch.object(speech,'transcribe',side_effect=[{'transcript':s,'engine':'fixture','model':'fixture','runtime':'1'} for s in transcripts]))
        from contextlib import ExitStack
        with ExitStack() as stack:
            for p in patches:stack.enter_context(p)
            result=pipeline.run(out/'narration.json',out/'config.json',out,reuse=reuse)
        return out,voice,result
    def test_retake_only_mismatch_selects_nonce_and_preserves_neighbor(self):
        original,voice,_=self.run_pipeline('original')
        neighbor=(original/'audio/sentences/01_001.wav').read_bytes()
        out,voice,result=self.run_pipeline('checked',{'check':'fail','retakes':2},['That effort.','Count that effort.','Keep this line.'])
        self.assertEqual(len(voice.calls),1,'baseline and neighbor must reuse existing sentence bytes; only retake synthesizes')
        self.assertEqual(neighbor,(out/'audio/sentences/01_001.wav').read_bytes())
        report=json.loads((out/'speech-check.json').read_text());self.assertTrue(report['complete']);self.assertEqual(report['counts']['match'],2)
        self.assertEqual(report['turns'][0]['selectedTake'],1);self.assertEqual(len(report['turns'][0]['attempts']),2)
        takes=json.loads((out/'audio/takes.json').read_text());self.assertEqual(takes[0]['take'],1);self.assertNotIn('take',takes[1]);self.assertEqual(takes[0]['ti'],0)
        self.assertNotEqual((original/'audio/sentences/01_000.wav').read_bytes(),(out/'audio/sentences/01_000.wav').read_bytes())
        timings=json.loads((out/'timings.json').read_text());self.assertGreater(timings['one']['turns'][1],timings['one']['turns'][0])
        reused,voice,_=self.run_pipeline('checked',{'check':'fail','retakes':2},['Count that effort.','Keep this line.'],reuse=True)
        self.assertFalse(voice.calls)
        self.assertEqual(len(json.loads((reused/'speech-check.json').read_text())['turns'][0]['attempts']),2)
        self.scenes[0]['segments'][0]['take']=100000000000000000
        self.run_pipeline('large-authored-take',{'check':'fail'},['Count that effort.','Keep this line.'])
        _,voice,_=self.run_pipeline('large-authored-take',{'check':'fail'},['Count that effort.','Keep this line.'],reuse=True)
        self.assertFalse(voice.calls)
        self.scenes[0]['segments'][0]['take']=1e21
        self.run_pipeline('exponent-authored-take',{'check':'fail'},['Count that effort.','Keep this line.'])
        reused,voice,_=self.run_pipeline('exponent-authored-take',{'check':'fail'},['Count that effort.','Keep this line.'],reuse=True)
        self.assertFalse(voice.calls)
        self.assertEqual(json.loads((reused/'speech-check.json').read_text())['turns'][0]['selectedTake'],0,'preserve legacy int-only cache nonce behavior for exponent-serialized values')
    def test_whole_multisentence_turn_retakes_and_provider_failure_stops(self):
        self.scenes[0]['segments'][0]['text'] = 'Count that effort. Keep every word.'
        self.scenes[0]['segments'][0]['take'] = 7
        out,voice,_ = self.run_pipeline('multi',{'check':'fail','retakes':1},['That effort. Keep every word.','Count that effort. Keep every word.','Keep this line.'])
        takes=json.loads((out/'audio/takes.json').read_text())
        self.assertEqual([t.get('take',0) for t in takes],[8,8,0])
        self.assertEqual(len(voice.calls),5)
        failed=self.root/'provider-error';failed.mkdir();(failed/'video.mp4').write_bytes(b'previous video')
        self.cache = self.root/'empty-cache'
        with mock.patch.object(Voice,'synthesize',side_effect=RuntimeError('provider failed')) as calls:
            with self.assertRaisesRegex(RuntimeError,'provider failed'):
                self.run_pipeline('provider-error',{'check':'warn','retakes':10},['wrong'])
        self.assertEqual(calls.call_count,1)
        self.assertEqual((failed/'video.mp4').read_bytes(),b'previous video')
    def test_context_cache_identity_and_complete_multisentence_history(self):
        self.config['voices']['a']['backend']='fixture'
        self.scenes[0]['segments'][0]['text']='Count that effort. Keep every word.'
        self.scenes[0]['segments'][0]['synthesisText']='Count that effort! Keep every word!'
        with mock.patch.object(Voice,'context_capable',True,create=True):
            out,_,_=self.run_pipeline('context',{'check':'fail','retakes':1},['That effort. Keep every word.','Count that effort. Keep every word.','Keep this line.'])
        with mock.patch.object(speech,'transcribe',side_effect=[{'transcript':t,'engine':'fixture','model':'fixture'} for t in ['Count that effort. Keep every word.','Keep this line.']]):
            self.assertEqual(speech.review(self.scenes,self.config,out)['counts']['match'],2)
        index=out/'audio/takes.json';original=json.loads(index.read_text())
        for change in ('key','prefix','contradiction','context','foreign-turn'):
            records=copy.deepcopy(original)
            if change=='key': records[0]['cacheKey']='f'*40
            elif change=='context': records[0]['context']['nextText']='wrong'
            elif change=='foreign-turn':
                for r in records[:2]:
                    for a in r['speechAttempts']: a.update(sceneId='other',scene=9,turn=8,who='b')
            elif change=='prefix':
                for r in records[:2]: r['speechAttempts']=r['speechAttempts'][1:]
            else: records[1]['speechAttempts'][-1]['audioSha256']='e'*64
            index.write_text(json.dumps(records))
            with mock.patch.object(speech,'transcribe',return_value={'transcript':'Keep this line.','engine':'fixture','model':'fixture'}):
                report=speech.review(self.scenes,self.config,out)
            self.assertEqual(report['turns'][0]['status'],'unavailable',change)
            with self.assertRaisesRegex(RuntimeError,'speech.check=fail'):
                speech.enforce(report['turns'],{'speech':{'check':'fail'}})
    def test_budget_exhaustion_warn_and_fail_preserve_video(self):
        out,voice,_=self.run_pipeline('warn',{'check':'warn','retakes':2},['That effort.']*3+['Keep this line.'])
        report=json.loads((out/'speech-check.json').read_text());self.assertEqual(report['turns'][0]['selectedTake'],2);self.assertEqual(len(report['turns'][0]['attempts']),3)
        out=self.root/'fail';out.mkdir();(out/'video.mp4').write_bytes(b'previous finished video')
        with self.assertRaisesRegex(RuntimeError,'speech.check=fail'):
            self.run_pipeline('fail',{'check':'fail','retakes':1},['That effort.']*2)
        self.assertEqual((out/'video.mp4').read_bytes(),b'previous finished video');self.assertFalse((out/'audio/takes.json').exists())
        self.assertEqual(len(json.loads((out/'speech-check.json').read_text())['turns'][0]['attempts']),2)
    def test_provider_failure_after_mismatch_retains_partial_history(self):
        out=self.root/'retake-error';out.mkdir();(out/'video.mp4').write_bytes(b'previous video')
        original=Voice.synthesize;calls=[]
        def fail_second(voice,*args,**options):
            calls.append(args)
            if len(calls)==2: raise RuntimeError('retake provider failed')
            return original(voice,*args,**options)
        with mock.patch.object(Voice,'synthesize',new=fail_second):
            with self.assertRaisesRegex(RuntimeError,'retake provider failed'):
                self.run_pipeline('retake-error',{'check':'warn','retakes':10},['That effort.'])
        self.assertEqual(len(calls),2)
        report=json.loads((out/'speech-check.json').read_text())
        self.assertFalse(report['complete']);self.assertEqual(len(report['turns'][0]['attempts']),1)
        self.assertEqual((out/'video.mp4').read_bytes(),b'previous video')
    def test_unavailable_does_not_spend_retake_budget(self):
        with mock.patch.object(speech,'transcribe',side_effect=RuntimeError('no model')):
            out,voice,_=self.run_pipeline('unavailable',{'check':'warn','retakes':10})
        self.assertEqual(len(voice.calls),2);self.assertEqual(json.loads((out/'speech-check.json').read_text())['counts']['unavailable'],2)
        self.scenes[0]['clipAudio']={'authority':'native','file':str(self.root/'not-decoded.mp4')}
        with self.assertRaisesRegex(RuntimeError,'speech.check=fail'):
            self.run_pipeline('native-fail',{'check':'fail'})
        self.assertEqual(json.loads((self.root/'native-fail/speech-check.json').read_text())['counts']['unavailable'],2)
    def test_unavailable_retake_retains_latest_complete_warn_candidate(self):
        self.scenes[0]['segments'][0]['text'] = 'Count that effort. Keep every word.'
        self.scenes[0]['segments'][0]['take'] = 7
        def observed(text): return {'transcript':text,'engine':'fixture','model':'fixture'}
        outcomes = [observed('That effort. Keep every word.'), RuntimeError('recognizer unavailable'), observed('Keep this line.')]
        with mock.patch.object(speech,'transcribe',side_effect=outcomes) as asr:
            out,voice,_ = self.run_pipeline('unknown-retake', {'check':'warn','retakes':2})
        self.assertEqual(asr.call_count,3,'unused remaining budget must not run')
        self.assertEqual(len(voice.calls),5,'both sentences retaken once, neighbor once')
        row=json.loads((out/'speech-check.json').read_text())['turns'][0]
        self.assertEqual((row['status'],row['selectedTake']),('unavailable',8))
        self.assertEqual([(a['take'],a['status']) for a in row['attempts']],[(7,'mismatch'),(8,'unavailable')])
        takes=json.loads((out/'audio/takes.json').read_text())
        self.assertEqual([t.get('take',0) for t in takes],[8,8,0])
        for take in takes[:2]:
            self.assertEqual(take['speechAttempts'],row['attempts'])
            self.assertEqual(take['sha256'],hashlib.sha256((out/take['file']).read_bytes()).hexdigest())
        # A read-only review reconstructs exactly the selected audio and history.
        with mock.patch.object(speech,'transcribe',side_effect=[observed('Count that effort. Keep every word.'),observed('Keep this line.')]):
            reviewed=speech.review(self.scenes,self.config,out)['turns'][0]
        self.assertEqual(reviewed['audioSha256'],row['audioSha256'])
        self.assertEqual(reviewed['selectedTake'],8)
        self.assertEqual(reviewed['attempts'],row['attempts'])
        for retake in (False,True):
            label='unknown-fail-'+str(retake);failed=self.root/label;failed.mkdir()
            (failed/'video.mp4').write_bytes(b'prior finished video')
            # A fail at either the initial candidate or a complete retake must
            # stop before publishing that turn and never invoke the neighbor.
            outcomes=([observed('That effort. Keep every word.')] if retake else [])+[RuntimeError('recognizer unavailable')]
            with mock.patch.object(speech,'transcribe',side_effect=outcomes) as asr:
                with self.assertRaisesRegex(RuntimeError,'speech.check=fail'):
                    self.run_pipeline(label,{'check':'fail','retakes':2})
            self.assertEqual(asr.call_count,2 if retake else 1)
            self.assertEqual((failed/'video.mp4').read_bytes(),b'prior finished video')
            self.assertFalse((failed/'audio/takes.json').exists())
            self.assertFalse((failed/'audio/sentences/01_000.wav').exists())
            row=json.loads((failed/'speech-check.json').read_text())['turns'][0]
            self.assertEqual(row['selectedTake'],8 if retake else 7)
            self.assertEqual(row['status'],'unavailable')

    def test_missing_take_records_cannot_pass_explicit_fail_reuse(self):
        out,_,_=self.run_pipeline('missing-records')
        (out/'audio/takes.json').unlink()
        (out/'video.mp4').write_bytes(b'prior finished video')
        with mock.patch.object(speech,'transcribe',side_effect=AssertionError('unbound audio must not reach ASR')):
            with self.assertRaisesRegex(RuntimeError,'speech.check=fail'):
                self.run_pipeline('missing-records',{'check':'fail'},reuse=True)
        self.assertEqual((out/'video.mp4').read_bytes(),b'prior finished video')
        self.assertEqual(json.loads((out/'speech-check.json').read_text())['counts']['unavailable'],2)

    def test_tampered_scene_or_sentence_cannot_pass_reuse(self):
        out,_,_=self.run_pipeline('bound')
        for missing in (True,False):
            if missing: (out/'audio/01.wav').unlink()
            else: (out/'audio/01.wav').write_bytes(b'changed scene')
            with mock.patch.object(speech,'transcribe',side_effect=AssertionError('unbound scene must not reach ASR')):
                with self.assertRaisesRegex(RuntimeError,'speech.check=fail'):
                    self.run_pipeline('bound',{'check':'fail'},reuse=True)
            self.assertEqual(json.loads((out/'speech-check.json').read_text())['counts']['unavailable'],2)
        # Restore output from sentence cache, then tamper only a sentence.
        out,_,_=self.run_pipeline('bound')
        (out/'audio/sentences/01_000.wav').write_bytes(b'changed sentence')
        with mock.patch.object(speech,'transcribe',side_effect=AssertionError('tampered sentence must not reach ASR')):
            report=speech.review(self.scenes,self.config,out)
        self.assertEqual(report['turns'][0]['status'],'unavailable')
    def test_missing_or_malformed_selection_metadata_cannot_pass(self):
        out,_,_=self.run_pipeline('metadata')
        index=out/'audio/takes.json';original=json.loads(index.read_text())
        for change in ('missing-key','invalid-history','invalid-history-dict','missing-auto-history','wrong-history-audio','wrong-key','wrong-coordinate','invalid-take'):
            records=copy.deepcopy(original)
            if change=='missing-key': del records[0]['cacheKey']
            elif change=='invalid-history': records[0]['speechAttempts']=['broken']
            elif change=='invalid-history-dict': records[0]['speechAttempts']=[{}]
            elif change=='missing-auto-history': records[0]['take']=1
            elif change=='wrong-key': records[0]['cacheKey']='f'*40
            elif change=='wrong-coordinate': records[0]['ti']=999
            elif change=='wrong-history-audio': records[0]['speechAttempts']=[{'take':0,'status':'match','audioSha256':'f'*64,'expectedText':'Count that effort.','sceneId':'one','scene':1,'turn':0,'who':'a'}]
            else: records[0]['take']=True
            index.write_text(json.dumps(records))
            with mock.patch.object(speech,'transcribe',return_value={'transcript':'Count that effort.' if change=='wrong-history-audio' else 'Keep this line.','engine':'fixture','model':'fixture'}):
                report=speech.review(self.scenes,self.config,out)
            self.assertEqual(report['turns'][0]['status'],'unavailable',change)
            with self.assertRaisesRegex(RuntimeError,'speech.check=fail'):
                speech.enforce(report['turns'],{'speech':{'check':'fail'}})
        index.write_text(json.dumps(original))
        config=copy.deepcopy(self.config);config['timing']['gapSentence']=None
        with mock.patch.object(speech,'transcribe',side_effect=[{'transcript':t,'engine':'fixture','model':'fixture'} for t in ['Count that effort.','Keep this line.']]):
            self.assertEqual(speech.review(self.scenes,config,out)['counts']['match'],2)
    def test_corrupt_take_index_is_advisory_unavailable_and_warn_reuse_continues(self):
        out,_,_=self.run_pipeline('corrupt')
        (out/'audio/takes.json').write_text('{')
        with mock.patch.object(speech,'transcribe',side_effect=AssertionError('invalid index must not reach ASR')):
            report=speech.review(self.scenes,self.config,out)
            self.assertEqual(report['counts']['unavailable'],2)
            out,voice,_=self.run_pipeline('corrupt',{'check':'warn'},reuse=True)
            self.assertFalse(voice.calls)
            self.assertEqual(json.loads((out/'speech-check.json').read_text())['counts']['unavailable'],2)
            with self.assertRaisesRegex(RuntimeError,'speech.check=fail'):
                self.run_pipeline('corrupt',{'check':'fail'},reuse=True)
    def test_review_preserves_project_and_rejects_changed_script(self):
        out,_,_=self.run_pipeline('review')
        before={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file()}
        with mock.patch.object(speech,'transcribe',side_effect=[{'transcript':t,'engine':'fixture','model':'fixture'} for t in ['That effort.','Keep this line.']]):
            report=speech.review(self.scenes,self.config,out)
        after={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file()}
        self.assertEqual(before,after);self.assertEqual(report['counts'],{'match':1,'mismatch':1,'unavailable':0})
        scenes=copy.deepcopy(self.scenes);scenes[0]['segments'][0]['captions']=False
        with mock.patch.object(speech,'transcribe',side_effect=[{'transcript':t,'engine':'fixture','model':'fixture'} for t in ['Count that effort.','Keep this line.']]):
            self.assertEqual(speech.review(scenes,self.config,out)['counts']['match'],2)
        self.assertEqual(before,{str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file()})
        scenes[0]['segments'][0]['text']='Changed.'
        with mock.patch.object(speech,'transcribe',side_effect=RuntimeError('no engine')):
            self.assertEqual(speech.review(scenes,self.config,out)['turns'][0]['status'],'unavailable')

if __name__ == '__main__':unittest.main()
