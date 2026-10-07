"""Literal pronunciation on the core utterance boundary; no caption rewriting."""
import re
import unicodedata

def sentences(text):
    return [p for p in re.split(r"(?<=[.!?۔؟])\s+", text.strip()) if p]

def word(char):
    return char == '_' or bool(char) and unicodedata.category(char)[0] in 'LMN'

def apply(text, mapping):
    keys = sorted(mapping or {}, key=len, reverse=True)
    out, pairs, i = [], [], 0
    while i < len(text):
        key = next((k for k in keys if text.startswith(k, i) and not word(text[i-1] if i else '') and not word(text[i+len(k)] if i+len(k) < len(text) else '')), None)
        if key:
            out.append(mapping[key]); pairs.append((key, mapping[key])); i += len(key)
        else:
            out.append(text[i]); i += 1
    return ''.join(out), pairs

def sentence_pairs(turn, backend, mapping=None, warn=None):
    from .backends import BUILTIN_BACKENDS
    clean = sentences(turn['text'])
    synth = sentences(turn['synthesisText']) if backend not in BUILTIN_BACKENDS and turn.get('synthesisText') else clean
    if len(synth) != len(clean):
        if warn: warn(f"synthesisText sentence count ({len(synth)}) != text count ({len(clean)}) — falling back to text-only")
        synth = clean
    return [(apply(s, mapping)[0], c) for s, c in zip(synth, clean)]

def expected(turn, mapping=None, backend='piper'):
    # Preserve legacy clean-text checking unless a pronunciation was applied to
    # the selected provider input. Never invent pairs from unused clean text.
    pairs = sentence_pairs(turn, backend)
    applied = [apply(s, mapping) for s, _ in pairs]
    changed = any(mapped != original for (mapped, _), (original, _) in zip(applied, pairs))
    aliases = list(dict.fromkeys(pair for _, found in applied for pair in found)) if changed else []
    return (' '.join(s for s, _ in applied) if changed else turn['text']), aliases
