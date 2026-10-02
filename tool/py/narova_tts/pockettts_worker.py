#!/usr/bin/env python3
"""Optional local Pocket TTS worker. Core owns timing and audio processing."""
from __future__ import annotations

import argparse
import collections
import contextlib
import hashlib
import importlib.metadata as metadata
import json
import math
import os
import platform
from pathlib import Path
import re
import sys
import tempfile
import wave

PROTOCOL = 'narova-tts-provider/v1'
PROVIDER = 'pockettts'
VERSION = '1.0.0'
CATALOG = json.loads(Path(__file__).with_name('pockettts_catalog.json').read_text())
LANGUAGES = {'en': 'english_2026-09', 'fr': 'french', 'de': 'german',
             'es': 'spanish', 'it': 'italian', 'pt': 'portuguese', 'nl': 'dutch'}
FILES = {'referenceAudio', 'voiceState', 'config', 'weights', 'tokenizer',
         'flowWeights', 'codecWeights', 'nonCloningWeights'}
CONTROLS = {'temperature': (0, 2, .3, False), 'samplerDecodeSteps': (1, 32, 1, True),
            'noiseClamp': (0, 10, None, False), 'eosThreshold': (-20, 20, -4., False),
            'framesAfterEos': (0, 50, None, True), 'maxTokens': (16, 256, 50, True)}
BOOLS = {'quantize', 'voiceCloning', 'truncateReference'}
CAPABILITIES = {'synthesis': True, 'voiceListing': True, 'languages': True,
                'wordTimings': False, 'surroundingText': False}
MAX_TEXT = 8192
MAX_STATE_BYTES = 256 * 1024**2
MAX_REFERENCE_SAMPLES = 16 * 1024**2


class ProviderError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def fail(message, code='invalid_request'):
    raise ProviderError(code, message)


def sha_file(file):
    h = hashlib.sha256()
    with open(file, 'rb') as source:
        for part in iter(lambda: source.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


def stable_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def binding(value, name):
    if not isinstance(value, dict) or set(value) != {'path', 'sha256'}:
        fail(f'{name}: use voices.<id>.providerFiles.{name} to bind a local file')
    p, digest = value.get('path'), value.get('sha256')
    if not isinstance(p, str) or not Path(p).is_absolute() or not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest):
        fail(f'{name}: invalid bound file identity')
    file = Path(p)
    limit = 2 * 1024**3 if name in {'weights', 'flowWeights', 'codecWeights', 'nonCloningWeights'} else 64 * 1024**2
    if name == 'config': limit = 1024**2
    if name == 'voiceState': limit = MAX_STATE_BYTES
    if not file.is_file() or file.stat().st_size > limit:
        fail(f'{name}: missing, nonregular or oversized file')
    if sha_file(file) != digest:
        fail(f'{name}: bytes changed after resolution; resolve the project again', 'input_changed')
    return file


def reference_tensor(file, truncate):
    """Inspect duration and decode only the explicitly selected bounded prefix."""
    import soundfile as sf
    import torch
    from pocket_tts.data.audio_utils import convert_audio
    with sf.SoundFile(str(file)) as source:
        if source.samplerate <= 0 or source.frames <= 0 or source.channels <= 0:
            fail('referenceAudio: empty or invalid audio')
        maximum = 30 * source.samplerate
        if source.frames > maximum and not truncate:
            fail('referenceAudio exceeds 30 seconds; select truncateReference=true explicitly')
        frames = min(source.frames, maximum)
        if frames * source.channels > MAX_REFERENCE_SAMPLES:
            fail('referenceAudio exceeds the 64 MiB decoded-sample bound; downmix/resample first')
        audio = source.read(frames=frames, dtype='float32', always_2d=True)
        sample_rate = source.samplerate
    tensor = torch.from_numpy(audio.mean(axis=1, keepdims=True).T)
    if not torch.isfinite(tensor).all(): fail('referenceAudio: nonfinite samples')
    return convert_audio(tensor, sample_rate, 24000, 1)


def validate_options(options, language=None):
    if language is not None and not isinstance(language, str): fail('language must be a string')
    if language and language.lower() not in LANGUAGES: fail('unsupported language; use en|fr|de|es|it|pt|nl')
    if options is None: options = {}
    if not isinstance(options, dict): fail('options must be an object')
    unknown = set(options) - (FILES | set(CONTROLS) | BOOLS | {'model', 'seed'})
    if unknown: fail('unsupported options: '+', '.join(sorted(unknown)))
    o = dict(options)
    for k, (lo, hi, default, integer) in CONTROLS.items():
        v = o.get(k, default)
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                              or v < lo or v > hi or (integer and not isinstance(v, int))
                              or (k == 'noiseClamp' and v <= 0)):
            fail(f'{k}: expected {"integer" if integer else "finite number"} from {lo} to {hi}')
        if k in o and v is None and k not in {'noiseClamp', 'framesAfterEos'}: fail(f'{k}: cannot be null')
        o[k] = v
    for k in BOOLS:
        if k in o and not isinstance(o[k], bool): fail(f'{k}: expected Boolean')
    if 'seed' in o and (type(o['seed']) is not int or not 0 <= o['seed'] <= 0xffffffff): fail('seed: expected integer 0..4294967295')
    if 'referenceAudio' in o and 'voiceState' in o: fail('referenceAudio and voiceState are mutually exclusive')
    for k in FILES & set(o): binding(o[k], k)
    if 'config' in o:
        if 'model' in o: fail('config and model are mutually exclusive')
        o['model'] = 'custom'
    else:
        if (FILES - {'referenceAudio', 'voiceState'}) & set(o): fail('custom model resources require config')
        if language:
            if not isinstance(language, str): fail('language must be a string')
            code = language.lower()
            if code not in LANGUAGES: fail(f'unsupported language {language!r}; use en|fr|de|es|it|pt|nl')
            default = LANGUAGES[code]
        else: default = 'english_2026-09'
        model = o.get('model', default)
        if not isinstance(model, str) or model not in CATALOG['models']: fail('model: select a released configuration or bind config')
        if language and model.split('_')[0] != LANGUAGES[language.lower()].split('_')[0]: fail('model conflicts with requested language')
        o['model'] = 'english_2026-09' if model == 'english' else model
    o.setdefault('quantize', False)
    o.setdefault('truncateReference', False)
    o.setdefault('voiceCloning', 'referenceAudio' in o or o['model'] == 'custom')
    if 'referenceAudio' in o and not o['voiceCloning']: fail('referenceAudio requires voiceCloning=true')
    return o


def runtime_version():
    versions = {'python': '.'.join(map(str, sys.version_info[:3])),
                'platform': platform.system(), 'architecture': platform.machine(),
                'decoderFramesPerCall': 1, 'torchThreads': 1}
    for name in ['pocket-tts', 'torch', 'numpy', 'soundfile', 'tokenizers',
                 'sentencepiece', 'scipy', 'safetensors', 'einops']:
        try: versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError: fail(f'{name} is missing; run narova-setup --pockettts', 'missing_dependency')
    if versions['pocket-tts'] != CATALOG['pocketVersion']:
        fail('Pocket TTS package differs from supported 3.3.0; re-run narova-setup --pockettts', 'incompatible_runtime')
    try: versions['torchao'] = metadata.version('torchao')
    except metadata.PackageNotFoundError: versions['torchao'] = None
    return VERSION+'+profile.'+stable_hash(versions)[:16], versions


def safe_message(exc):
    msg = str(exc)
    for name in ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN']:
        if os.environ.get(name): msg = msg.replace(os.environ[name], '[redacted]')
    return msg[:1000]


class Runtime:
    def __init__(self):
        # Fail a native chunk that never reaches EOS instead of publishing a truncated utterance.
        os.environ['KPOCKET_TTS_ERROR_WITHOUT_EOS'] = '1'
        self.version, self.versions = runtime_version()
        self.models = collections.OrderedDict()

    def model_data(self, o):
        import yaml
        if o['model'] == 'custom':
            data = yaml.safe_load(binding(o['config'], 'config').read_text())
            if not isinstance(data, dict): fail('config must be a model mapping')
        else:
            import pocket_tts
            file = Path(pocket_tts.__file__).parent/'config'/f"{o['model']}.yaml"
            if sha_file(file) != CATALOG['models'][o['model']]['config_sha256']:
                fail('installed model config differs from pinned release', 'incompatible_runtime')
            data = yaml.safe_load(file.read_text())
        # Override local resources only through content-bound options.
        locations = {'weights': ('weights_path',), 'nonCloningWeights': ('weights_path_without_voice_cloning',),
                     'tokenizer': ('flow_lm', 'lookup_table', 'tokenizer_path'),
                     'flowWeights': ('flow_lm', 'weights_path'), 'codecWeights': ('mimi', 'weights_path')}
        for k, keys in locations.items():
            if k not in o: continue
            dest = data
            for key in keys[:-1]: dest = dest[key]
            dest[keys[-1]] = str(binding(o[k], k))
        def resources(node):
            if not isinstance(node, dict): return
            for key, value in node.items():
                if key in {'weights_path', 'weights_path_without_voice_cloning', 'tokenizer_path'} and value:
                    local = any(value == v['path'] for k, v in o.items() if k in FILES and isinstance(v, dict))
                    pinned = isinstance(value, str) and re.fullmatch(r'hf://[^\s@]+@[0-9a-f]{40}', value)
                    if not local and not pinned: fail(f'{key}: bind local resources or use hf:// resources with an immutable 40-character revision')
                elif isinstance(value, dict): resources(value)
        resources(data)
        if not o['voiceCloning']:
            if not data.get('weights_path_without_voice_cloning'):
                fail('Preset mode requires declared nonCloningWeights; select voiceCloning=true for full weights')
            data['weights_path'] = data['weights_path_without_voice_cloning']
        # Never let the upstream loader silently select different weights.
        data['weights_path_without_voice_cloning'] = None
        if not data.get('weights_path') and not data.get('flow_lm', {}).get('weights_path'):
            fail('config has no bound or pinned model weights')
        return data

    def profile(self, o):
        data = self.model_data(o)
        return stable_hash({'runtime': self.versions, 'model': o['model'], 'data': data,
                            'files': {k: v['sha256'] for k, v in o.items() if k in FILES - {'referenceAudio', 'voiceState'}},
                            'voiceCloning': o['voiceCloning'], 'quantize': o['quantize']}), data

    def model(self, o):
        profile, data = self.profile(o)
        # Sampling settings are model-level in Pocket; don't share mutable knobs.
        key = stable_hash([profile, {k: o[k] for k in CONTROLS}])
        if key in self.models:
            self.models.move_to_end(key)
            return profile, self.models[key]
        from pocket_tts import TTSModel
        import yaml
        with tempfile.TemporaryDirectory(prefix='narova-pocket-model-') as temp:
            file = Path(temp)/'config.yaml'
            file.write_text(yaml.safe_dump(data))
            try:
                model = TTSModel.load_model(config=str(file), temp=o['temperature'],
                    sampler_decode_steps=o['samplerDecodeSteps'], noise_clamp=o['noiseClamp'],
                    eos_threshold=o['eosThreshold'], quantize=o['quantize'])
            except Exception as exc:
                message = ('Full voice-cloning weights are unavailable. Obtain access at https://huggingface.co/kyutai/pocket-tts, '
                           'then authenticate locally or acquire the selected model before using offline mode. ' if o['voiceCloning'] else
                           'Selected preset model is unavailable; acquire it once before offline use. ')
                fail(message+safe_message(exc), 'model_unavailable')
        # Queue-dependent decoder batching can change PCM rounding by one LSB.
        # A fixed frame size keeps seeded samples stable across scheduling.
        model.max_decoder_frames_per_call = self.versions['decoderFramesPerCall']
        entry = (model, collections.OrderedDict())
        self.models[key] = entry
        while len(self.models) > 2: self.models.popitem(last=False)
        return profile, entry

    def state(self, profile, entry, speaker, o):
        model, states = entry
        if 'voiceState' in o:
            source = binding(o['voiceState'], 'voiceState')
            import safetensors
            try:
                with safetensors.safe_open(str(source), framework='pt') as file:
                    meta = (file.metadata() or {}).get('narova_pockettts', '')
                if len(meta) > 65536: fail('voiceState: oversized provenance')
                record = json.loads(meta)
                if not isinstance(record, dict) or record.get('schema') != 'narova.pockettts-state/1' or record.get('profile') != profile:
                    fail('voiceState: incompatible model/runtime provenance; export it for the selected profile')
            except (ValueError, TypeError) as exc: fail('voiceState: missing/invalid Narova provenance')
            key = 'state:'+o['voiceState']['sha256']
        elif 'referenceAudio' in o:
            source = binding(o['referenceAudio'], 'referenceAudio')
            if source.suffix.lower() == '.safetensors': fail('referenceAudio is audio; use voiceState for exported conditioning')
            key = 'audio:'+o['referenceAudio']['sha256']+str(o['truncateReference'])
        else:
            if speaker not in CATALOG['voices']: fail('speaker: unknown preset; list voices or bind referenceAudio/voiceState')
            if o['model'] == 'custom': fail('custom models require referenceAudio or compatible voiceState')
            source = f"hf://kyutai/pocket-tts-without-voice-cloning/languages/{o['model']}/embeddings/{speaker}.safetensors@{CATALOG['embeddingRevision']}"
            key = 'preset:'+speaker
        if key not in states:
            try:
                if 'voiceState' in o:
                    from pocket_tts.models.model_state import _import_model_state
                    states[key] = _import_model_state(source, model.device)
                elif 'referenceAudio' in o:
                    tensor = reference_tensor(source, o['truncateReference'])
                    states[key] = model.get_state_for_audio_prompt(tensor)
                else:
                    states[key] = model.get_state_for_audio_prompt(str(source))
            except ProviderError: raise
            except Exception as exc: fail('Cannot load selected voice: '+safe_message(exc), 'voice_unavailable')
        states.move_to_end(key)
        while len(states) > 8: states.popitem(last=False)
        return states[key]

    def synthesize(self, request):
        text, speaker = request.get('text'), request.get('speaker')
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT: fail('text: provide 1..8192 characters; split oversized utterances')
        if not isinstance(speaker, str) or not speaker.strip(): fail('speaker: provide a preset ID or reference voice label')
        if request.get('context') is not None: fail('Pocket TTS does not support surrounding text context')
        o = validate_options(request.get('options'), request.get('language'))
        output = output_path(request.get('output'))
        profile, entry = self.model(o)
        model, _ = entry
        state = self.state(profile, entry, speaker, o)
        from pocket_tts.models.text_chunking import split_into_best_sentences, prepare_text_prompt
        chunks = split_into_best_sentences(model.flow_lm.conditioner.tokenizer, text, o['maxTokens'],
            model.pad_with_spaces_for_short_inputs, model.remove_semicolons,
            model.append_terminal_punctuation, model.capitalize_first_letter, model.replace_characters)
        # Pocket prepares each split chunk again immediately before inference.
        # Punctuation/short-input padding can increase its token count.
        prepared = [prepare_text_prompt(c, model.pad_with_spaces_for_short_inputs,
            model.remove_semicolons, model.append_terminal_punctuation,
            model.capitalize_first_letter, model.replace_characters)[0] for c in chunks]
        if any(len(model.flow_lm.conditioner.tokenizer(c)[0]) > o['maxTokens'] for c in prepared):
            fail('Utterance exceeds maxTokens; split at sentence/comma boundaries or increase maxTokens (at most 256)')
        import torch
        if 'seed' in o: torch.manual_seed(o['seed'])
        pending = None
        try:
            with tempfile.NamedTemporaryFile(dir=output.parent, prefix='.pocket-', suffix='.wav', delete=False) as f: pending = Path(f.name)
            frames = 0
            with wave.open(str(pending), 'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(model.sample_rate)
                for audio in model.generate_audio_stream(state, text, max_tokens=o['maxTokens'],
                        frames_after_eos=o['framesAfterEos'], copy_state=True):
                    if audio.ndim != 1 or not torch.isfinite(audio).all(): fail('Generated invalid audio', 'invalid_audio')
                    if frames + len(audio) > 24000 * 600: fail('Generated audio exceeds ten minute bound', 'invalid_audio')
                    wav.writeframes((audio.detach().cpu().clamp(-1, 1)*32767).short().numpy().tobytes())
                    frames += len(audio)
            if not frames or model.sample_rate != 24000: fail('Generated empty or unsupported audio', 'invalid_audio')
            pending.replace(output)
        finally:
            if pending: pending.unlink(missing_ok=True)
        return {'ok': True, 'id': request.get('id'), 'output': str(output), 'sampleRate': 24000,
                'channels': 1, 'providerVersion': self.version}

    def export(self, speaker, options, output):
        o = validate_options(options)
        dest = output_path(output)
        profile, entry = self.model(o)
        state = self.state(profile, entry, speaker, o)
        from pocket_tts import export_model_state
        import safetensors.torch
        pending = None
        try:
            with tempfile.NamedTemporaryFile(dir=dest.parent, prefix='.pocket-state-', suffix='.safetensors', delete=False) as f: pending = Path(f.name)
            export_model_state(state, str(pending))
            tensors = safetensors.torch.load_file(str(pending))
            provenance = {'schema': 'narova.pockettts-state/1', 'profile': profile, 'model': o['model'],
                          'voiceCloning': o['voiceCloning'], 'quantize': o['quantize'],
                          'source': {k: v['sha256'] for k, v in o.items() if k in {'referenceAudio', 'voiceState'}}, 'speaker': speaker}
            safetensors.torch.save_file(tensors, str(pending), metadata={'narova_pockettts': json.dumps(provenance)})
            if pending.stat().st_size > MAX_STATE_BYTES:
                fail('Exported conditioning exceeds the 256 MiB voiceState bound; use a shorter reference')
            pending.replace(dest)
        finally:
            if pending: pending.unlink(missing_ok=True)
        return {'ok': True, 'output': str(dest), 'sha256': sha_file(dest), 'model': o['model'], 'voiceCloning': o['voiceCloning'], 'quantize': o['quantize']}


def output_path(value):
    if not isinstance(value, str) or not Path(value).is_absolute(): fail('output: require an absolute local path')
    path = Path(value)
    if path.is_symlink() or (path.exists() and not path.is_file()): fail('output: refuse symbolic link or nonregular destination')
    if not path.parent.is_dir(): fail('output: parent directory is missing')
    return path


def catalog():
    return {'voices': [{'id': v, 'name': v} for v in CATALOG['voices']],
            'languages': LANGUAGES, 'models': [{'id': m, 'preview': '_24l' in m} for m in CATALOG['models']],
            'sourcesAndLicenses': CATALOG['voiceSources']}


def handle(request, runtime):
    if not isinstance(request, dict): fail('request must be an object')
    operation = request.get('operation')
    if operation == 'hello':
        if request.get('protocol') != PROTOCOL: fail('unsupported protocol')
        return {'ok': True, 'protocol': PROTOCOL, 'provider': PROVIDER,
                'providerVersion': runtime.version, 'capabilities': CAPABILITIES}
    if operation == 'listVoices': return {'ok': True, **catalog()}
    if operation == 'synthesize': return runtime.synthesize(request)
    fail('unsupported operation')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['worker', 'catalog', 'version', 'doctor', 'export-voice'], nargs='?', default='worker')
    parser.add_argument('--speaker', default='alba')
    parser.add_argument('--model')
    parser.add_argument('--reference')
    parser.add_argument('--output')
    parser.add_argument('--quantize', action='store_true')
    parser.add_argument('--voice-cloning', action='store_true')
    parser.add_argument('--truncate-reference', action='store_true')
    args = parser.parse_args()
    if args.action == 'catalog': print(json.dumps(catalog(), indent=2)); return
    if args.action == 'version':
        version, versions = runtime_version()
        print(json.dumps({'providerVersion': version, 'runtime': versions})); return
    # Pocket/HF diagnostics must never occupy the JSONL stdout channel.
    with contextlib.redirect_stdout(sys.stderr): runtime = Runtime()
    if args.action != 'worker':
        options = {'quantize': args.quantize, 'truncateReference': args.truncate_reference}
        if args.model: options['model'] = args.model
        if args.voice_cloning: options['voiceCloning'] = True
        if args.reference:
            p = Path(args.reference).resolve()
            options['referenceAudio'] = {'path': str(p), 'sha256': sha_file(p)}
        with contextlib.redirect_stdout(sys.stderr):
            if args.action == 'doctor':
                o = validate_options(options)
                profile, entry = runtime.model(o)
                runtime.state(profile, entry, args.speaker, o)
                result = {'ok': True, 'runtime': runtime.versions, 'model': o['model'], 'voiceCloning': o['voiceCloning'], 'profile': profile}
            else: result = runtime.export(args.speaker, options, args.output)
        print(json.dumps(result, indent=2)); return
    for line in sys.stdin:
        request = None
        try:
            if len(line) > 128*1024: fail('request exceeds 128 KiB')
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr): response = handle(request, runtime)
        except Exception as exc:
            response = {'ok': False, 'id': request.get('id') if isinstance(request, dict) else None,
                        'error': {'code': getattr(exc, 'code', 'generation_failed'), 'message': safe_message(exc)}}
        print(json.dumps(response, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print('[pockettts] '+safe_message(exc), file=sys.stderr)
        sys.exit(1)
