"""Hermetic boundary tests. No model downloads or speech dependencies required."""
import collections
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

TOOL = Path(__file__).parents[1] / 'narova_tts'
spec = importlib.util.spec_from_file_location('pocket_worker', TOOL / 'pockettts_worker.py')
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)

class BoundaryTests(unittest.TestCase):
    def test_catalog_is_complete_and_explicit(self):
        c = w.catalog()
        self.assertEqual(len(c['voices']), 27)
        self.assertEqual(len(c['models']), 18)
        self.assertEqual(set(c['languages']), {'en','fr','de','es','it','pt','nl'})
        self.assertTrue(any(m['preview'] for m in c['models']))
        self.assertEqual(w.validate_options({})['model'], 'english_2026-09')
        self.assertEqual(w.validate_options({'model':'english'})['model'], 'english_2026-09')

    def test_all_language_defaults_and_model_conflicts(self):
        for language, model in w.LANGUAGES.items():
            self.assertEqual(w.validate_options({}, language)['model'], model)
            with self.assertRaises(w.ProviderError): w.validate_options({'model':'english_2026-09' if language!='en' else 'french'},language)
        for language in ['ur','ar','en-US',[]]:
            with self.assertRaises(w.ProviderError): w.validate_options({}, language)

    def test_control_limits_and_types(self):
        for key,(lo,hi,default,integer) in w.CONTROLS.items():
            invalid = [-100, hi+1, True, '1', float('nan'), float('inf')]
            if integer: invalid.append(1.5)
            if key not in {'noiseClamp','framesAfterEos'}: invalid.append(None)
            if key=='noiseClamp': invalid.append(0)
            for value in invalid:
                with self.subTest(key=key,value=value), self.assertRaises(w.ProviderError): w.validate_options({key:value})
            self.assertEqual(w.validate_options({key:hi})[key], hi)
        for key in w.BOOLS:
            with self.assertRaises(w.ProviderError): w.validate_options({key:1})
        for seed in [-1,2**32,True,.5]:
            with self.assertRaises(w.ProviderError): w.validate_options({'seed':seed})
        with self.assertRaises(w.ProviderError): w.validate_options({'unsupported':1})

    def test_files_are_explicit_current_bytes_not_opaque_paths(self):
        with tempfile.TemporaryDirectory() as d:
            f=Path(d)/'voice.wav'; f.write_bytes(b'first')
            bound={'path':str(f),'sha256':w.sha_file(f)}
            self.assertEqual(w.binding(bound,'referenceAudio'),f)
            self.assertTrue(w.validate_options({'referenceAudio':bound})['voiceCloning'])
            f.write_bytes(b'second')
            with self.assertRaisesRegex(w.ProviderError,'bytes changed'): w.binding(bound,'referenceAudio')
            for invalid in [str(f),{'path':str(f)},{'path':'relative','sha256':'a'*64}, {'path':str(f),'sha256':'a'*64,'extra':True}]:
                with self.assertRaises(w.ProviderError): w.binding(invalid,'voiceState')
            bound['sha256']=w.sha_file(f)
            with self.assertRaisesRegex(w.ProviderError,'mutually exclusive'): w.validate_options({'voiceState':bound,'referenceAudio':bound})
            with self.assertRaisesRegex(w.ProviderError,'requires voiceCloning'): w.validate_options({'referenceAudio':bound,'voiceCloning':False})

    def test_unknown_options_and_missing_files_fail_before_model_load(self):
        runtime=object.__new__(w.Runtime)
        runtime.model=lambda _: self.fail('model loaded before validation')
        with tempfile.TemporaryDirectory() as d:
            request={'speaker':'alba','text':'Hello.','output':str(Path(d)/'out.wav')}
            for options in [{'wrong':1},{'voiceState':{'path':str(Path(d)/'missing'),'sha256':'a'*64}}]:
                with self.assertRaises(w.ProviderError): runtime.synthesize({**request,'options':options})
            for text in ['', 'a'*8193, None]:
                with self.assertRaises(w.ProviderError): runtime.synthesize({**request,'text':text})
            with self.assertRaises(w.ProviderError): runtime.synthesize({**request,'context':{'previous':'Hello'}})

    def test_output_guard_preserves_existing_data(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'good';p.write_bytes(b'good')
            link=Path(d)/'link';link.symlink_to(p)
            for value in ['relative',str(link),d,str(Path(d)/'missing'/'file')]:
                with self.assertRaises(w.ProviderError): w.output_path(value)
            self.assertEqual(p.read_bytes(),b'good')

    def test_hello_capabilities_and_protocol(self):
        runtime=types.SimpleNamespace(version='test')
        hello=w.handle({'operation':'hello','protocol':w.PROTOCOL},runtime)
        self.assertEqual(hello['provider'],'pockettts')
        self.assertFalse(hello['capabilities']['wordTimings'])
        self.assertFalse(hello['capabilities']['surroundingText'])
        self.assertEqual(len(w.handle({'operation':'listVoices'},runtime)['voices']),27)
        with self.assertRaises(w.ProviderError): w.handle({'operation':'hello','protocol':'wrong'},runtime)

    def test_runtime_profile_detects_dependency_drift(self):
        versions={'pocket-tts':'3.3.0','torch':'2.10.0','numpy':'2.5.3','soundfile':'0.14.0','torchao':'none',
            'tokenizers':'x','sentencepiece':'x','scipy':'x','safetensors':'x','einops':'x'}
        with patch.object(w.metadata,'version',side_effect=lambda n:versions[n]):
            first,_=w.runtime_version()
            versions['torch']='changed'
            second,_=w.runtime_version()
            self.assertNotEqual(first,second)
            versions['pocket-tts']='main'
            with self.assertRaises(w.ProviderError): w.runtime_version()

    def test_full_and_preset_selection_never_fallback(self):
        data={'weights_path':'hf://owner/model/clone@'+'a'*40,
              'weights_path_without_voice_cloning':'hf://owner/model/preset@'+'b'*40}
        runtime=object.__new__(w.Runtime)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'config.yaml';p.write_text(json.dumps(data))
            bound={'path':str(p),'sha256':w.sha_file(p)}
            fake_yaml=types.SimpleNamespace(safe_load=json.loads)
            with patch.dict(sys.modules,{'yaml':fake_yaml}):
                for cloning,suffix in [(True,'a'),(False,'b')]:
                    o=w.validate_options({'config':bound,'voiceCloning':cloning})
                    selected=runtime.model_data(o)
                    self.assertTrue(selected['weights_path'].endswith(suffix*40))
                    self.assertIsNone(selected['weights_path_without_voice_cloning'])

    def test_custom_resources_must_all_be_bound_or_revision_pinned(self):
        runtime=object.__new__(w.Runtime)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'config.yaml'
            with patch.dict(sys.modules,{'yaml':types.SimpleNamespace(safe_load=json.loads)}):
                for resource in ['https://example.com/model','hf://owner/repo/model@main',str(Path(d)/'unbound')]:
                    p.write_text(json.dumps({'weights_path':resource}))
                    bound={'path':str(p),'sha256':w.sha_file(p)}
                    with self.assertRaisesRegex(w.ProviderError,'immutable'): runtime.model_data(w.validate_options({'config':bound}))

    def test_saved_state_rejects_incompatible_provenance_before_native_read(self):
        runtime=object.__new__(w.Runtime)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'state.safetensors';p.write_bytes(b'state')
            o=w.validate_options({'voiceState':{'path':str(p),'sha256':w.sha_file(p)}})
            class Reader:
                def __enter__(self): return self
                def __exit__(self,*args): pass
                def metadata(self): return {'narova_pockettts':json.dumps({'schema':'narova.pockettts-state/1','profile':'other'})}
            fake=types.SimpleNamespace(safe_open=lambda *args,**kwargs:Reader())
            model=types.SimpleNamespace(get_state_for_audio_prompt=lambda *a,**kw:self.fail('incompatible state was used'))
            with patch.dict(sys.modules,{'safetensors':fake}),self.assertRaisesRegex(w.ProviderError,'incompatible'):
                runtime.state('expected',(model,collections.OrderedDict()),'alba',o)

    def test_state_cache_is_bounded_and_reuses_selected_voice(self):
        runtime=object.__new__(w.Runtime)
        calls=[]
        model=types.SimpleNamespace(get_state_for_audio_prompt=lambda source,**kw: calls.append(source) or {'source':source})
        states=collections.OrderedDict(); o=w.validate_options({})
        first=runtime.state('profile',(model,states),'alba',o)
        self.assertIs(first,runtime.state('profile',(model,states),'alba',o))
        for speaker in w.CATALOG['voices'][:10]: runtime.state('profile',(model,states),speaker,o)
        self.assertLessEqual(len(states),8)
        self.assertTrue(all('@'+w.CATALOG['embeddingRevision'] in c for c in calls))

    def test_bad_audio_rolls_back_and_generation_copies_state_and_seeds(self):
        runtime=object.__new__(w.Runtime);runtime.version='test'
        seeds=[];kwargs=[]
        model=types.SimpleNamespace(sample_rate=24000,pad_with_spaces_for_short_inputs=False,
            remove_semicolons=False,append_terminal_punctuation=True,capitalize_first_letter=True,
            replace_characters=None,flow_lm=types.SimpleNamespace(conditioner=types.SimpleNamespace(tokenizer=lambda t:([1],None))))
        class BadAudio:
            ndim=2
        def generate(*args,**kw):
            kwargs.append(kw)
            yield BadAudio()
        model.generate_audio_stream=generate
        runtime.model=lambda _: ('profile',(model,collections.OrderedDict()))
        runtime.state=lambda *args: {'state':'unchanged'}
        fake_torch=types.SimpleNamespace(manual_seed=lambda seed:seeds.append(seed))
        fake_chunks=types.SimpleNamespace(split_into_best_sentences=lambda *args:['Hello.'],prepare_text_prompt=lambda text,*args:(text,0))
        with tempfile.TemporaryDirectory() as d,patch.dict(sys.modules,{'torch':fake_torch,'pocket_tts.models.text_chunking':fake_chunks}):
            output=Path(d)/'out.wav';output.write_bytes(b'previous valid output')
            with self.assertRaisesRegex(w.ProviderError,'invalid audio'):
                runtime.synthesize({'speaker':'alba','text':'Hello.','options':{'seed':42},'output':str(output)})
            self.assertEqual(output.read_bytes(),b'previous valid output')
            self.assertEqual(list(Path(d).iterdir()),[output])
            self.assertEqual(seeds,[42]);self.assertTrue(kwargs[0]['copy_state'])

    def test_oversized_native_chunk_fails_instead_of_omitting_words(self):
        runtime=object.__new__(w.Runtime)
        model=types.SimpleNamespace(pad_with_spaces_for_short_inputs=False,remove_semicolons=False,
            append_terminal_punctuation=True,capitalize_first_letter=True,replace_characters=None,
            flow_lm=types.SimpleNamespace(conditioner=types.SimpleNamespace(tokenizer=lambda _:([1]*100,None))))
        runtime.model=lambda _: ('profile',(model,collections.OrderedDict()))
        runtime.state=lambda *args: {}
        with tempfile.TemporaryDirectory() as d,patch.dict(sys.modules,{'pocket_tts.models.text_chunking':types.SimpleNamespace(split_into_best_sentences=lambda *args:['long'],prepare_text_prompt=lambda text,*args:(text,0))}):
            with self.assertRaisesRegex(w.ProviderError,'exceeds maxTokens'):
                runtime.synthesize({'speaker':'alba','text':'long','output':str(Path(d)/'out.wav')})
            self.assertFalse(list(Path(d).iterdir()))

    def test_final_preparation_cannot_push_chunk_over_limit(self):
        runtime=object.__new__(w.Runtime)
        model=types.SimpleNamespace(pad_with_spaces_for_short_inputs=True,remove_semicolons=False,
            append_terminal_punctuation=True,capitalize_first_letter=True,replace_characters=None,
            flow_lm=types.SimpleNamespace(conditioner=types.SimpleNamespace(tokenizer=lambda text:([1]*(20 if text=='prepared' else 12),None))))
        runtime.model=lambda _: ('profile',(model,collections.OrderedDict()))
        runtime.state=lambda *args: {}
        chunks=types.SimpleNamespace(split_into_best_sentences=lambda *args:['short'],prepare_text_prompt=lambda *args:('prepared',0))
        with tempfile.TemporaryDirectory() as d,patch.dict(sys.modules,{'pocket_tts.models.text_chunking':chunks}):
            with self.assertRaisesRegex(w.ProviderError,'exceeds maxTokens'):
                runtime.synthesize({'speaker':'alba','text':'short','options':{'maxTokens':16},'output':str(Path(d)/'out.wav')})
            self.assertFalse(list(Path(d).iterdir()))

    def test_custom_model_cannot_bypass_language_routing_or_preset_selection(self):
        runtime=object.__new__(w.Runtime)
        with tempfile.TemporaryDirectory() as d:
            file=Path(d)/'config.yaml'
            file.write_text(json.dumps({'weights_path':'hf://owner/model/full@'+'a'*40}))
            bound={'path':str(file),'sha256':w.sha_file(file)}
            with self.assertRaisesRegex(w.ProviderError,'unsupported language'): w.validate_options({'config':bound},'ur')
            with patch.dict(sys.modules,{'yaml':types.SimpleNamespace(safe_load=json.loads)}):
                with self.assertRaisesRegex(w.ProviderError,'nonCloningWeights'):
                    runtime.model_data(w.validate_options({'config':bound,'voiceCloning':False}))

    def test_reference_duration_and_bounded_truncation_before_encoding(self):
        reads=[]
        class Audio:
            def mean(self,**kwargs): return self
            @property
            def T(self): return self
        class Sound:
            samplerate=100;frames=3100;channels=2
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self,**kwargs): reads.append(kwargs['frames']);return Audio()
        modules={'soundfile':types.SimpleNamespace(SoundFile=lambda _:Sound()),
                 'torch':types.SimpleNamespace(from_numpy=lambda x:x,isfinite=lambda _:types.SimpleNamespace(all=lambda:True)),
                 'pocket_tts.data.audio_utils':types.SimpleNamespace(convert_audio=lambda tensor,*args:tensor)}
        with patch.dict(sys.modules,modules):
            with self.assertRaisesRegex(w.ProviderError,'exceeds 30 seconds'):w.reference_tensor(Path('/test.wav'),False)
            self.assertEqual(reads,[])
            w.reference_tensor(Path('/test.wav'),True)
            self.assertEqual(reads,[3000])
            Sound.frames=3000;Sound.channels=10000
            with self.assertRaisesRegex(w.ProviderError,'decoded-sample'):w.reference_tensor(Path('/test.wav'),False)
            self.assertEqual(reads,[3000])

    def test_explicit_state_import_ignores_filename_suffix(self):
        runtime=object.__new__(w.Runtime)
        profile='expected'
        class Reader:
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def metadata(self):return {'narova_pockettts':json.dumps({'schema':'narova.pockettts-state/1','profile':profile})}
        fake_sf=types.SimpleNamespace(safe_open=lambda *a,**kw:Reader())
        imports=[]
        importer=types.SimpleNamespace(_import_model_state=lambda source,device:imports.append(source) or {'state':1})
        model=types.SimpleNamespace(device='cpu',get_state_for_audio_prompt=lambda *args:self.fail('state treated as audio'))
        with tempfile.TemporaryDirectory() as d,patch.dict(sys.modules,{'safetensors':fake_sf,'pocket_tts.models.model_state':importer}):
            file=Path(d)/'extensionless';file.write_bytes(b'conditioning')
            opts=w.validate_options({'voiceState':{'path':str(file),'sha256':w.sha_file(file)}})
            self.assertEqual(runtime.state(profile,(model,collections.OrderedDict()),'saved',opts),{'state':1})
            self.assertEqual(imports,[file])

    def test_state_bounds_cover_larger_profiles_and_export_rolls_back(self):
        runtime=object.__new__(w.Runtime);runtime.model=lambda _ :('profile',(None,None));runtime.state=lambda *args:{}
        parent=types.ModuleType('safetensors');child=types.ModuleType('safetensors.torch');parent.torch=child
        child.load_file=lambda _:{}
        child.save_file=lambda tensors,path,**kwargs:Path(path).write_bytes(b'oversized state')
        native=types.SimpleNamespace(export_model_state=lambda state,path:Path(path).write_bytes(b'state'))
        self.assertGreater(w.MAX_STATE_BYTES,71*1024**2)
        with tempfile.TemporaryDirectory() as d,patch.dict(sys.modules,{'pocket_tts':native,'safetensors':parent,'safetensors.torch':child}),patch.object(w,'MAX_STATE_BYTES',5):
            file=Path(d)/'state';file.write_bytes(b'previous')
            with self.assertRaisesRegex(w.ProviderError,'256 MiB'):runtime.export('alba',{},str(file))
            self.assertEqual(file.read_bytes(),b'previous');self.assertEqual(list(Path(d).iterdir()),[file])

    def test_loaded_models_use_fixed_decoder_batches_and_bounded_cache(self):
        runtime=object.__new__(w.Runtime);runtime.models=collections.OrderedDict()
        runtime.versions={'decoderFramesPerCall':1}
        runtime.profile=lambda _ :('profile',{'config':'test'})
        loads=[]
        def load(**kwargs):
            model=types.SimpleNamespace(max_decoder_frames_per_call=0)
            loads.append(model);return model
        native=types.SimpleNamespace(TTSModel=types.SimpleNamespace(load_model=load))
        with patch.dict(sys.modules,{'pocket_tts':native,'yaml':types.SimpleNamespace(safe_dump=json.dumps)}):
            for temp in [.1,.2,.3]:
                _,(model,_)=runtime.model(w.validate_options({'temperature':temp}))
                self.assertEqual(model.max_decoder_frames_per_call,1)
            self.assertEqual(len(runtime.models),2)
            runtime.model(w.validate_options({'temperature':.3}))
            self.assertEqual(len(loads),3)

    def test_messages_redact_credentials(self):
        with patch.dict(os.environ,{'HF_TOKEN':'private-test-token'}):
            self.assertNotIn('private-test-token',w.safe_message(Exception('oops private-test-token')))

if __name__=='__main__': unittest.main()
