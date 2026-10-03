"""Built-in routing, runtime identity and raw-output rollback regressions."""
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
from narova_tts import backends
from narova_tts.pipeline import voice_cache_speaker

class PocketBackendTests(unittest.TestCase):
    def test_route_is_builtin_and_transports_bound_options_without_registration(self):
        state = {'path': '/state', 'sha256': 'a'*64}
        voices = {'a': {'backend': 'pockettts', 'speaker': 'alba',
                       'providerOptions': {'temperature': .4},
                       'providerFileInputs': {'voiceState': state}, 'providerVersion': 'profile'}}
        with patch.object(backends, 'PocketTtsBackend', return_value=object()) as adapter:
            routed = backends.build_backends(voices, 'piper', provider_loader=lambda _: self.fail('registry used'))
        adapter.assert_called_once_with({'a':'alba'}, {'a':{'temperature':.4,'voiceState':state}}, {'a':'profile'})
        self.assertIs(routed['a'], adapter.return_value)

    def test_sentence_identity_includes_controls_files_and_runtime(self):
        base = {'backend':'pockettts','speaker':'alba','providerVersion':'first','providerOptions':{'temperature':.3},'providerFileInputs':{'voiceState':{'path':'/state','sha256':'a'*64}}}
        first = voice_cache_speaker(base,'a')
        for key,value in [('providerVersion','second'),('providerOptions',{'temperature':.4}),('providerFileInputs',{'voiceState':{'path':'/state','sha256':'b'*64}})]:
            self.assertNotEqual(first, voice_cache_speaker({**base,key:value},'a'))

    def test_runtime_drift_fails_before_generation_and_keeps_previous_raw_output(self):
        obj = object.__new__(backends.PocketTtsBackend)
        obj._versions = {'resolved-profile'}
        obj._worker = types.SimpleNamespace(provider_version='changed-profile')
        with patch.object(backends.ExternalProviderBackend,'_ensure_worker',return_value=obj._worker), patch.object(obj,'close') as close:
            with self.assertRaisesRegex(RuntimeError,'changed after resolution'): obj._ensure_worker()
            close.assert_called_once()
        obj._worker = None
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)/'raw.wav'; out.write_bytes(b'prior valid output')
            self.assertEqual(obj._validate_output(out),out)
            self.assertEqual(out.read_bytes(),b'prior valid output')
            alias = Path(d)/'alias'; alias.symlink_to(out)
            with self.assertRaises(ValueError): obj._validate_output(alias)

    def test_missing_optional_runtime_names_setup(self):
        with tempfile.TemporaryDirectory() as d, patch.dict(backends.os.environ,{'NAROVA_POCKETTTS_VENV':d}):
            with self.assertRaisesRegex(RuntimeError,'narova-setup --pockettts'):
                backends.PocketTtsBackend({'a':'alba'})
