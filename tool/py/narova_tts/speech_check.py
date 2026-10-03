"""Optional transcript evidence. ASR differences are observations, not verdicts."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import re
import signal
import time
import subprocess
import sys
import tempfile
import unicodedata
import wave
from decimal import Decimal, InvalidOperation
from pathlib import Path

SCHEMA = "narova.speech-check/1"
PROFILE = "speech-comparison/1"
_UNITS = dict(zip("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(), range(20)))
_TENS = dict(zip("twenty thirty forty fifty sixty seventy eighty ninety".split(), range(20, 100, 10)))
_SCALES = {word: 10**(3*i) for i,word in enumerate("thousand million billion trillion quadrillion quintillion sextillion septillion octillion nonillion decillion".split(),1)}


def digest(file):
    h = hashlib.sha256()
    with Path(file).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
    return h.hexdigest()


def _cardinal_and(raw, boundaries, i, last, scale):
    if last not in ('hundred', 'scale') or i+1 >= len(raw) or raw[i+1].casefold() not in {*_UNITS, *_TENS, 'a'}:
        return False
    # An article must introduce an actual cardinal, not lexical 'a few'.
    if boundaries[i+1] or raw[i+1].casefold() == 'zero': return False
    if raw[i+1].casefold() == 'a' and (last != 'scale' or i+2 >= len(raw) or boundaries[i+2] or raw[i+2].casefold() not in {'hundred', *_SCALES}):
        return False
    for j in range(i+1, len(raw)):
        if boundaries[j]: break
        word = raw[j].casefold()
        # Another hundred group is a separate number, including twelve hundred.
        if word == 'hundred' and last == 'hundred': return False
        if word in _SCALES: return _SCALES[word] < scale
        if word not in {*_UNITS, *_TENS, 'hundred', 'and', 'a'}: break
    return True


def _tokens(text):
    text = unicodedata.normalize("NFKC", text)
    # Python's word class omits combining marks, including meaningful vowels
    # and tones. Retain the marks present in this text inside lexical tokens.
    marks = ''.join(sorted({c for c in text if unicodedata.category(c).startswith('M')}))
    word = r"[^\W\d_]" if not marks else r"(?:[^\W\d_]|[" + re.escape(marks) + "])"
    matches = list(re.finditer(r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|" + word + r"+(?:['’]" + word + r"+)?", text, re.UNICODE))
    raw = [m.group() for m in matches]
    boundaries = [bool(i and any(unicodedata.category(c).startswith('P') and unicodedata.category(c) != 'Pd' and c not in "'’_" for c in text[matches[i-1].end():m.start()])) for i,m in enumerate(matches)]
    result, i = [], 0
    while i < len(raw):
        token = raw[i].casefold().replace("’", "'").replace("'", "")
        article = token == 'a' and i+1 < len(raw) and not boundaries[i+1] and raw[i+1].casefold() in {'hundred', *_SCALES}
        if token in _UNITS or token in _TENS or token == 'hundred' or token in _SCALES or article:
            start, total, group, last, scale = i, 0, (1 if token == 'hundred' or token in _SCALES else 0), ('unit' if token == 'hundred' or token in _SCALES else None), float('inf')
            while i < len(raw):
                if i > start and boundaries[i]: break
                w = raw[i].casefold()
                article = w == 'a' and last in (None, 'scale') and i+1 < len(raw) and not boundaries[i+1] and raw[i+1].casefold() in {'hundred', *_SCALES}
                if w in _UNITS or w in _TENS or article:
                    value = 1 if article else _UNITS.get(w, _TENS.get(w))
                    if value == 0 and last is not None: break
                    if last in ('unit', 'teen') or (last == 'tens' and value >= 10): break
                    group += value; last = 'tens' if w in _TENS else ('teen' if value >= 10 else 'unit')
                elif w == 'hundred' and 1 <= group < 100 and last in ('unit', 'teen', 'tens'):
                    group *= 100; last = 'hundred'
                elif w in _SCALES and group and _SCALES[w] < scale:
                    scale = _SCALES[w]; total += group * scale; group = 0; last = 'scale'
                elif w == 'and' and _cardinal_and(raw, boundaries, i, last, scale):
                    pass
                else: break
                i += 1
            result.append({'value': str(total + group), 'words': raw[start:i], 'separatorBefore': boundaries[start]}); continue
        if token[0].isdigit():
            try:
                token = format(Decimal(token.replace(',', '')), 'f')
                if '.' in token: token = token.rstrip('0').rstrip('.')
            except InvalidOperation: pass
        result.append({'value': token, 'words': [raw[i]], 'separatorBefore': boundaries[i]}); i += 1
    return result


def compare(expected, transcript):
    """Ordered lexical edits; letter-only word boundaries are interchangeable."""
    a, b = _tokens(expected), _tokens(transcript)
    if len(a) > 512 or len(b) > 512: raise ValueError('speech comparison supports at most 512 lexical tokens per turn; split the turn')
    if all(not any(c.isdigit() for c in t['value']) for t in a+b) and ''.join(t['value'] for t in a) == ''.join(t['value'] for t in b):
        return {'status':'match','differences':[]}
    def letters(t):
        text = ''.join(t['words']).casefold().replace('’', '').replace("'", '')
        return text if not any(c.isdigit() for c in text) else None
    def joins(tokens, k):
        return not (tokens[k]['separatorBefore'] and any(c.isdigit() for c in tokens[k]['value']) and any(c.isdigit() for c in tokens[k-1]['value']))
    al, bl = [letters(t) for t in a], [letters(t) for t in b]
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    moves = {}
    for i in range(1, n + 1): dp[i][0] = i; moves[i, 0] = (i - 1, 0, 'dropped')
    for j in range(1, m + 1): dp[0][j] = j; moves[0, j] = (0, j - 1, 'added')
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            candidates = [(dp[i-1][j-1] + 1, i-1, j-1, 'replaced'), (dp[i-1][j] + 1, i-1, j, 'dropped'), (dp[i][j-1] + 1, i, j-1, 'added')]
            # Find the shortest shared suffix ending at word boundaries. Longer
            # shared spans can be split at this common boundary in the same DP.
            if a[i-1]['value'] == b[j-1]['value']:
                candidates.insert(0, (dp[i-1][j-1], i-1, j-1, 'equal'))
            pi, pj = i-1, j-1
            av, bv = al[pi], bl[pj]
            while av is not None and bv is not None:
                if av == bv:
                    candidates.insert(0, (dp[pi][pj], pi, pj, 'equal')); break
                if len(av) < len(bv) and bv.endswith(av) and pi and joins(a, pi):
                    pi -= 1; av = al[pi] + av if al[pi] is not None else None
                elif len(bv) < len(av) and av.endswith(bv) and pj and joins(b, pj):
                    pj -= 1; bv = bl[pj] + bv if bl[pj] is not None else None
                else: break
            cost, pi, pj, kind = min(candidates, key=lambda x: x[0]); dp[i][j] = cost; moves[i, j] = (pi, pj, kind)
    edits, i, j = [], n, m
    while i or j:
        pi, pj, kind = moves[i, j]
        if kind != 'equal':
            edits.append({'kind': kind, 'expected': [w for t in a[pi:i] for w in t['words']], 'observed': [w for t in b[pj:j] for w in t['words']]})
        i, j = pi, pj
    edits.reverse()
    return {'status': 'mismatch' if edits else 'match', 'differences': edits}


def options(config, lang=None):
    speech, alignment = config.get('speech') or {}, config.get('align') or {}
    if not isinstance(alignment, dict): alignment = {}
    engine = speech.get('engine', alignment.get('engine', 'auto'))
    model = speech.get('model', alignment.get('model', os.environ.get('NAROVA_WHISPER_MODEL')))
    language = (lang or '').split('-')[0].lower() or None
    return {'engine': engine, 'model': model, 'language': language}


def _bounded_run(command, timeout, *, own_group=True):
    """Bound recognition logs on disk and terminate owned descendants."""
    limit = 1024 * 1024
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        child = subprocess.Popen(command, stdout=stdout, stderr=stderr,
                                 start_new_session=own_group)
        started = time.monotonic()
        try:
            while child.poll() is None:
                if time.monotonic()-started > timeout:
                    raise RuntimeError('speech recognizer deadline exceeded')
                if os.fstat(stdout.fileno()).st_size > limit or os.fstat(stderr.fileno()).st_size > limit:
                    raise RuntimeError('speech recognizer output exceeds 1 MiB')
                time.sleep(.02)
            if os.fstat(stdout.fileno()).st_size > limit or os.fstat(stderr.fileno()).st_size > limit:
                raise RuntimeError('speech recognizer output exceeds 1 MiB')
            stdout.seek(0); stderr.seek(0)
            return subprocess.CompletedProcess(command, child.returncode,
                stdout.read(limit).decode('utf-8', errors='replace'),
                stderr.read(limit).decode('utf-8', errors='replace'))
        finally:
            if own_group:
                try: os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError: pass
                except PermissionError:
                    # A denied cleanup of an exited process group must not
                    # replace the result/output-limit error of an exited
                    # recognizer with that cleanup error. Active denial is real.
                    if child.poll() is None:
                        child.kill(); child.wait()
                        raise
            elif child.poll() is None: child.kill()
            child.wait()


def _recognize(file, opts):
    """Runs only in a bounded child; speech ASR never uses script prompting."""
    from . import align
    engine, model, language = opts['engine'], opts.get('model'), opts.get('language')
    errors = []
    if engine in ('auto', 'faster-whisper'):
        try:
            from faster_whisper import WhisperModel
            name = model or ('tiny.en' if language == 'en' else 'tiny')
            if name.endswith('.en') and language not in (None, 'en'): raise RuntimeError('English-only ASR model cannot verify this language; select a multilingual model')
            recognizer = WhisperModel(name, device='cpu', compute_type='int8')
            if language not in (None, 'en') and not getattr(getattr(recognizer, 'model', None), 'is_multilingual', False): raise RuntimeError('English-only or unknown-capability ASR model cannot verify this language; select a multilingual model')
            segments, _ = recognizer.transcribe(str(file), language=language, word_timestamps=True)
            transcript = ' '.join(seg.text.strip() for seg in segments if seg.text.strip())
            return {'transcript': transcript, 'engine': 'faster-whisper', 'model': name, 'runtime': importlib.metadata.version('faster-whisper')}
        except Exception as exc:
            errors.append(f'faster-whisper: {exc}')
    if engine in ('auto', 'whisper-cpp'):
        try:
            binary = align._whisper_cpp_bin()
            if not binary: raise RuntimeError('whisper-cli is not on PATH')
            selected = model or align.WHISPER_CPP_MODEL
            model_file = Path(selected)
            if not model_file.is_file(): model_file = Path(os.environ.get('NAROVA_HOME', Path.home()/'.narova')) / 'models' / selected
            if not model_file.is_file(): raise RuntimeError('local ASR model is missing; select speech.model pointing to an acquired model')
            if re.search(r'\.en(?:[.\-]|$)', model_file.name, re.IGNORECASE) and language not in (None, 'en'): raise RuntimeError('English-only ASR model cannot verify this language')
            with tempfile.TemporaryDirectory(prefix='narova-speech-asr-') as d:
                base = Path(d)/'result'
                r = _bounded_run([binary, '-m', str(model_file), '-f', str(file), '-l', language or 'auto', '-oj', '-of', str(base)], 110, own_group=False)
                if r.returncode: raise RuntimeError(f'whisper-cli exited {r.returncode}: {r.stderr[-500:]}')
                result_file = base.with_suffix('.json')
                if result_file.stat().st_size > 1024*1024: raise ValueError('recognizer result exceeds 1 MiB')
                data = json.loads(result_file.read_text())
                if not isinstance(data,dict) or not isinstance(data.get('transcription'),list) or any(not isinstance(x,dict) or not isinstance(x.get('text'),str) for x in data['transcription']): raise ValueError('invalid whisper.cpp transcript result')
                model_info = data.get('model')
                if language not in (None, 'en') and (not isinstance(model_info, dict) or model_info.get('multilingual') is not True): raise RuntimeError('English-only or unidentified whisper.cpp model cannot verify this language; select a multilingual model')
            return {'transcript': ' '.join(x.get('text', '').strip() for x in data.get('transcription', [])), 'engine': 'whisper-cpp', 'model': str(model_file), 'runtime': digest(binary), 'modelSha256': digest(model_file)}
        except Exception as exc: errors.append(f'whisper-cpp: {exc}')
    raise RuntimeError('; '.join(errors) or 'no supported recognition engine selected')


def transcribe(file, opts):
    r = _bounded_run([sys.executable, '-m', 'narova_tts.speech_check', '--recognize', str(file), '--options', json.dumps(opts)], 120)
    if r.returncode: raise RuntimeError(r.stderr[-1000:] or 'recognizer failed; install optional faster-whisper or whisper.cpp and select speech.model')
    if len(r.stdout) > 1024*1024: raise RuntimeError('recognizer output exceeds 1 MiB')
    return json.loads(r.stdout)


def assess(file, expected, config, lang=None):
    result = {'expectedText': expected, 'audioSha256': digest(file), 'comparison': PROFILE, 'language': lang, 'transcript': None, 'differences': []}
    try:
        if config.get('narrationSource'): raise ValueError('speech check requires synthesized sentence takes; external narration is not retaken')
        observed = transcribe(file, options(config, lang))
        if not isinstance(observed.get('transcript'), str): raise ValueError('recognizer returned invalid transcript')
        result.update(observed)
        result.update(compare(expected, observed['transcript']))
    except Exception as exc: result.update(status='unavailable', reason=str(exc))
    return result


def report(turns):
    return {'schema': SCHEMA, 'turns': turns, 'counts': {k: sum(t['status'] == k for t in turns) for k in ('match', 'mismatch', 'unavailable')}, 'uncertainty': 'ASR transcript differences are evidence, not proof of a speech error.'}


def summary(row):
    text = f"speech: scene {row['sceneId']} turn {row['turn']} [{row['who']}] {row['status']}"
    if row['status'] == 'unavailable': return text + ': ' + row.get('reason', 'unavailable')
    for diff in row['differences']: text += f"; {diff['kind']} {' '.join(diff['expected'])!r} -> {' '.join(diff['observed'])!r}"
    return text


def _valid_history(history, selected):
    if not isinstance(history, list) or not 1 <= len(history) <= 11: return False
    for i, attempt in enumerate(history):
        if not isinstance(attempt, dict): return False
        if type(attempt.get('take')) is not int or attempt['take'] < 0: return False
        if attempt.get('status') not in ('match', 'mismatch', 'unavailable'): return False
        if not isinstance(attempt.get('audioSha256'), str) or not re.fullmatch(r'[0-9a-f]{64}', attempt['audioSha256']): return False
        if not isinstance(attempt.get('expectedText'), str): return False
        if i and (history[i-1]['status'] != 'mismatch' or attempt['take'] != history[i-1]['take']+1): return False
    return history[-1]['take'] == selected


def review(scenes, config, out):
    """Review verified sentence takes without modifying any project files."""
    index_error = None
    try:
        records = json.loads((out/'audio/takes.json').read_text()) if (out/'audio/takes.json').is_file() else []
        if not isinstance(records, list): raise ValueError('take index is not an array')
    except Exception:
        records = []; index_error = 'sentence take index is unreadable or invalid; synthesize first'
    rows = []
    from .pipeline import sentences, concat, make_silence, TIMING_DEFAULTS, BUILTIN_BACKENDS, sentence_cache_key, voice_cache_speaker, derived_seed, effective_take
    with tempfile.TemporaryDirectory(prefix='narova-speech-review-') as d:
        tmp = Path(d); gap = tmp/'gap.wav'
        timing = {**TIMING_DEFAULTS, **{k:v for k,v in (config.get('timing') or {}).items() if v is not None}}
        make_silence(timing['gapSentence'], gap)
        for scene in scenes:
            cursor = 0
            for ti, turn in enumerate(scene['segments']):
                row = {'sceneId': scene['id'], 'scene': scene['n'], 'turn': ti, 'who': turn['who'], 'expectedText': turn['text'], 'status': 'unavailable', 'transcript': None, 'differences': []}
                count = len(sentences(turn['text'])); needed = list(range(cursor, cursor+count)); cursor += count
                try:
                    if (scene.get('clipAudio') or {}).get('authority') == 'native' or config.get('narrationSource'): raise ValueError('speech review requires synthesized sentence takes')
                    if index_error: raise ValueError(index_error)
                    voice = config.get('voices', {}).get(turn['who'], {})
                    clean_sents = sentences(turn['text'])
                    chosen = []
                    for k, si in enumerate(needed):
                        found = [x for x in records if x['sceneId']==scene['id'] and x['si']==si and x['who']==turn['who']]
                        if len(found)!=1: raise ValueError('sentence take evidence missing or ambiguous; synthesize first')
                        take = found[0]; rel = take['file']
                        if type(take.get('si')) is not int or type(take.get('ti')) is not int or take['ti'] != ti or type(take.get('scene')) is not int or take['scene'] != scene['n']: raise ValueError('inconsistent sentence/turn/scene coordinates; synthesize first')
                        if not isinstance(take.get('cacheKey'), str) or not re.fullmatch(r'[0-9a-f]{40}', take['cacheKey']): raise ValueError('invalid sentence cache identity; synthesize first')
                        if type(take.get('take', 0)) is not int or take.get('take', 0) < 0: raise ValueError('invalid selected nonce; synthesize first')
                        history = take.get('speechAttempts')
                        if history is not None and not _valid_history(history, take.get('take', 0)): raise ValueError('invalid selection history; synthesize first')
                        kind = voice.get('backend') or take.get('backend')
                        if not isinstance(kind, str) or take.get('backend') != kind: raise ValueError('inconsistent sentence backend')
                        synth_sents = sentences(turn['synthesisText']) if kind not in BUILTIN_BACKENDS and turn.get('synthesisText') else clean_sents
                        if len(synth_sents) != len(clean_sents): synth_sents = clean_sents
                        if take.get('text') != synth_sents[k]: raise ValueError('sentence synthesis text does not bind current turn')
                        language = turn.get('lang') or voice.get('lang')
                        if take.get('lang') != language: raise ValueError('inconsistent sentence language')
                        context = take.get('context')
                        if context is not None and context != {'previousText':' '.join(synth_sents[:k]), 'nextText':' '.join(synth_sents[k+1:])}: raise ValueError('inconsistent sentence context')
                        nonce = take.get('take', 0)
                        key = sentence_cache_key(kind, voice_cache_speaker(voice, turn['who'], kind), synth_sents[k], float(timing['tempo']), lang=language, nonce=nonce if nonce > 0 else None, context=context)
                        if key != take['cacheKey']: raise ValueError('sentence cache identity does not bind current synthesis inputs')
                        if take.get('mode') in ('pinned', 'pinned+nonce') and (type(take.get('seed')) is not int or take['seed'] != derived_seed(key)): raise ValueError('inconsistent sentence seed')
                        if rel != f"audio/sentences/{scene['n']:02d}_{si:03d}.wav": raise ValueError('invalid sentence artifact path')
                        file = out/rel
                        if not file.is_file() or file.is_symlink() or file.stat().st_size > 64*1024*1024 or out.resolve() not in file.resolve().parents or digest(file)!=take.get('sha256'): raise ValueError('sentence artifact is missing, changed or escapes output')
                        chosen.append((file, take))
                    selected = chosen[0][1].get('take', 0)
                    if any(take.get('take', 0) != selected for _,take in chosen): raise ValueError('mixed selected nonces in one turn; synthesize first')
                    history = chosen[0][1].get('speechAttempts')
                    if any(take.get('speechAttempts') != history for _,take in chosen): raise ValueError('contradictory sentence selection histories; synthesize first')
                    if history is not None and (history[0]['take'] != (effective_take(turn.get('take')) or 0) or any(a['expectedText'] != turn['text'] for a in history)): raise ValueError('selection history does not bind authored starting nonce/text')
                    if history is not None and any(a.get('sceneId') != scene['id'] or type(a.get('scene')) is not int or a['scene'] != scene['n'] or type(a.get('turn')) is not int or a['turn'] != ti or a.get('who') != turn['who'] for a in history): raise ValueError('selection history identifies another scene/turn/voice')
                    if selected < (effective_take(turn.get('take')) or 0) or (selected != (effective_take(turn.get('take')) or 0) and history is None): raise ValueError('selected retake history is missing or inconsistent; synthesize first')
                    scene_file = out/'audio'/f"{scene['n']:02d}.wav"
                    if not scene_file.is_file() or scene_file.is_symlink() or out.resolve() not in scene_file.resolve().parents: raise ValueError('scene audio is missing or escapes output')
                    scene_digest = digest(scene_file)
                    if any(take.get('sceneAudioSha256') != scene_digest for _,take in chosen): raise ValueError('scene audio is changed or lacks bound evidence; synthesize with the current CLI')
                    row['sceneAudioSha256'] = scene_digest
                    # Bind expected clean text to the build's narration, independent of current voices.
                    original = json.loads((out/'narration.json').read_text())
                    old = next(s for s in original if s['id']==scene['id'])['segments'][ti]
                    if any(old.get(key) != turn.get(key) for key in ('who', 'text', 'synthesisText', 'lang', 'instruct', 'take', 'pauseAfter')): raise ValueError('authored speech turn changed since synthesis; synthesize first')
                    pieces = []
                    for file,_ in chosen:
                        if pieces: pieces.append(gap)
                        pieces.append(file)
                    wav = tmp/'turn.wav'; concat(pieces, wav, tmp)
                    row.update(assess(wav, turn['text'], config, turn.get('lang') or config.get('voices',{}).get(turn['who'],{}).get('lang')))
                    row['sources'] = [{'file':take['file'],'sha256':take['sha256'],'cacheKey':take['cacheKey']} for _,take in chosen]
                    row['selectedTake'] = chosen[0][1].get('take', 0)
                    history = chosen[0][1].get('speechAttempts')
                    if history is not None:
                        if history[-1]['audioSha256'] != row['audioSha256'] or history[-1]['expectedText'] != turn['text']: raise ValueError('selected retake history does not bind current turn audio/text')
                        row['attempts'] = history
                except Exception as exc: row.update(status='unavailable', reason=str(exc))
                rows.append(row)
    return report(rows)


def write_report(out, rows, complete=False):
    target = Path(out)/'speech-check.json'
    temporary = target.with_suffix('.json.pending')
    data = report(rows); data['complete'] = complete
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
    temporary.replace(target)
    return data


def enforce(rows, config):
    for row in rows:
        if row['status'] != 'match': print(summary(row), flush=True)
    if (config.get('speech') or {}).get('check') == 'fail' and any(row['status'] != 'match' for row in rows):
        raise RuntimeError('speech.check=fail: transcript mismatch or unavailable evidence; inspect speech-check.json and audition the affected turns')


def main():
    p = argparse.ArgumentParser();p.add_argument('--recognize',type=Path);p.add_argument('--options');p.add_argument('--review',type=Path);p.add_argument('--config',type=Path);p.add_argument('--narration',type=Path);ns=p.parse_args()
    if ns.recognize:
        # Libraries can print progress; keep the result channel pure.
        from contextlib import redirect_stdout
        with redirect_stdout(sys.stderr): result = _recognize(ns.recognize,json.loads(ns.options))
        print(json.dumps(result));return
    result = review(json.loads(ns.narration.read_text()),json.loads(ns.config.read_text()),ns.review)
    print(json.dumps(result,ensure_ascii=False))

if __name__ == '__main__': main()
