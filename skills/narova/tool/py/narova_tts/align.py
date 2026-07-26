"""Forced word alignment: replace ESTIMATED word t0/t1 with MEASURED ones.

Off by default; enabled with config.align (`true` or {engine}). Two engines,
both optional and never installed by narova itself:

  - faster-whisper: `pip install faster-whisper` into the narova venv.
      Word timestamps via the `faster_whisper` package; model "tiny.en" by
      default (override with $NAROVA_WHISPER_MODEL, e.g. "base.en").
  - whisper.cpp: a `whisper-cli` (or `whisper-cpp` / `main`) binary on PATH.
      Uses the ggml-tiny.en model at $NAROVA_HOME/models/ggml-tiny.en.bin,
      auto-downloaded once from huggingface.co/ggerganov/whisper.cpp.

config.align.engine is "auto" (faster-whisper first, then whisper.cpp) or one
specific engine.

Alignment NEVER breaks a build: any engine failure or word mismatch keeps the
estimated timings for that scene with a warning. Only word t0/t1 change (the
estimates are already on the final, post-rescale scene timeline); scene `dur`
and `turns` are untouched, so the _verify_total caption-sync guarantee holds.

Results are cached in CACHE_DIR keyed by sha1 of the scene wav — re-runs are
free until the audio changes.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable

_base = os.environ.get("NAROVA_CACHE")
CACHE_DIR = (
    (Path(_base).parent / "align")
    if _base
    else Path(os.environ.get("NAROVA_HOME", Path.home() / ".narova")) / "cache" / "align"
)

WHISPER_CPP_MODEL = "ggml-tiny.en.bin"
WHISPER_CPP_MODEL_URL = (
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"
)

# Tokens are compared case-insensitively with punctuation stripped; anything
# left over must match exactly or the scene keeps its estimates.
_PUNCT = re.compile(r"[^\w']+")


def _norm(tok: str) -> str:
    return _PUNCT.sub("", tok.lower())


# ---- engines -------------------------------------------------------------------

_FW_MODEL: tuple[str, Any] | None = None  # (name, model) — loaded once per process


def _faster_whisper_words(wav: Path) -> list[dict]:
    global _FW_MODEL
    from faster_whisper import WhisperModel  # optional dep — see module docstring

    name = os.environ.get("NAROVA_WHISPER_MODEL", "tiny.en")
    if _FW_MODEL is None or _FW_MODEL[0] != name:
        print(f"[align] loading faster-whisper {name} …", flush=True)
        _FW_MODEL = (name, WhisperModel(name, device="cpu", compute_type="int8"))
    segments, _ = _FW_MODEL[1].transcribe(str(wav), language="en", word_timestamps=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            if w.word.strip():
                words.append({"w": w.word.strip(),
                              "t0": round(float(w.start), 3),
                              "t1": round(float(w.end), 3)})
    return words


def _whisper_cpp_bin() -> str | None:
    for name in ("whisper-cli", "whisper-cpp", "main"):
        p = shutil.which(name)
        if p:
            return p
    return None


def _whisper_cpp_model() -> Path:
    model = Path(os.environ.get("NAROVA_HOME", Path.home() / ".narova")) / "models" / WHISPER_CPP_MODEL
    if not model.exists():
        model.parent.mkdir(parents=True, exist_ok=True)
        print(f"[align] downloading {WHISPER_CPP_MODEL} (one-time) -> {model}", flush=True)
        urllib.request.urlretrieve(WHISPER_CPP_MODEL_URL, model)
    return model


def _whisper_cpp_words(wav: Path) -> list[dict]:
    bin = _whisper_cpp_bin()
    if not bin:
        raise RuntimeError("no whisper.cpp binary on PATH (want whisper-cli)")
    model = _whisper_cpp_model()
    # -ojf = --output-json-full; -ml 1 = one token per segment -> word-level
    # offsets. whisper.cpp writes <out>.json next to the -of path.
    out_base = wav.parent / f"_{wav.stem}_align"
    out_json = out_base.with_suffix(".json")
    out_json.unlink(missing_ok=True)
    r = subprocess.run(
        [bin, "-m", str(model), "-f", str(wav), "-l", "en",
         "-ojf", "-ml", "1", "-of", str(out_base)],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"whisper.cpp exited {r.returncode}: {r.stderr.strip()[-300:]}")
    try:
        data = json.loads(out_json.read_text())
    finally:
        out_json.unlink(missing_ok=True)
    words = []
    for item in data.get("transcription", []):
        text = item.get("text", "").strip()
        off = item.get("offsets", {})
        if text:
            words.append({"w": text,
                          "t0": round(off.get("from", 0) / 1000, 3),
                          "t1": round(off.get("to", 0) / 1000, 3)})
    return words


def _candidates(engine: str) -> list[tuple[str, Callable[[Path], list[dict]]]]:
    """Engines to try, in order, limited to what's actually installed."""
    cands = []
    if engine in ("auto", "faster-whisper") and importlib.util.find_spec("faster_whisper"):
        cands.append(("faster-whisper", _faster_whisper_words))
    if engine in ("auto", "whisper-cpp") and _whisper_cpp_bin():
        cands.append(("whisper-cpp", _whisper_cpp_words))
    return cands


# ---- cache ----------------------------------------------------------------------

def _cached_words(wav: Path, engine: str, fn: Callable[[Path], list[dict]]) -> list[dict]:
    """Alignment keyed by the wav's contents: identical audio re-aligns free."""
    h = hashlib.sha1()
    h.update(f"v1|{engine}|{os.environ.get('NAROVA_WHISPER_MODEL', 'tiny.en')}".encode())
    with wav.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    cached = CACHE_DIR / f"{h.hexdigest()}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    words = fn(wav)
    if not words:
        raise RuntimeError(f"{engine} returned no words")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(words))
    return words


# ---- mapping aligned words onto the expected token sequence ----------------------

def apply_alignment(measured: list[dict], words: list[dict]) -> str | None:
    """Overwrite word t0/t1 from measured words. Returns None on full success,
    a 'partial N/M exact anchors' string on partial success, or a failure
    description. On full failure nothing is touched (estimates stay).

    When exact match fails and NAROVA_ALIGN_PARTIAL=1, uses SequenceMatcher to
    find exact word anchors between expected and measured tokens, then
    interpolates timings for unrecognized spans. Essential for mixed
    Arabic/English scenes where Whisper transcribes English but not Arabic."""
    # 1 — try exact match
    if len(measured) == len(words) and all(
        _norm(m["w"]) == _norm(e["w"]) for m, e in zip(measured, words)
    ):
        for m, e in zip(measured, words):
            t0 = max(0.0, m["t0"])
            e["t0"] = round(t0, 3)
            e["t1"] = round(max(t0, m["t1"]), 3)
        return None

    # 2 — partial alignment (opt-in via NAROVA_ALIGN_PARTIAL=1)
    if os.environ.get("NAROVA_ALIGN_PARTIAL") != "1":
        if len(measured) != len(words):
            return f"word count differs: aligned {len(measured)} vs expected {len(words)}"
        for i, (m, e) in enumerate(zip(measured, words)):
            if _norm(m["w"]) != _norm(e["w"]):
                return f"word {i} differs: aligned {m['w']!r} vs expected {e['w']!r}"
        return None  # unreachable but keeps linter happy

    expected_norm = [_norm(e["w"]) for e in words]
    measured_norm = [_norm(m["w"]) for m in measured]
    matcher = SequenceMatcher(a=expected_norm, b=measured_norm, autojunk=False)
    anchors: list[tuple[int, int]] = []
    for block in matcher.get_matching_blocks():
        for offset in range(block.size):
            anchors.append((block.a + offset, block.b + offset))
    if not anchors:
        return (f"partial alignment found no exact anchors: aligned {len(measured)} "
                f"vs expected {len(words)}")

    original = [(float(e["t0"]), float(e["t1"])) for e in words]
    for ei, mi in anchors:
        t0 = max(0.0, float(measured[mi]["t0"]))
        words[ei]["t0"] = round(t0, 3)
        words[ei]["t1"] = round(max(t0, float(measured[mi]["t1"])), 3)

    # Interpolate unrecognized spans between anchors.
    anchored = {ei for ei, _ in anchors}
    boundaries = [(-1, None), *anchors, (len(words), None)]
    for (left_i, _), (right_i, _) in zip(boundaries, boundaries[1:]):
        start_i = left_i + 1
        end_i = right_i
        if start_i >= end_i:
            continue
        if any(i in anchored for i in range(start_i, end_i)):
            continue
        left_t = (float(words[left_i]["t1"]) if left_i >= 0
                  else original[start_i][0])
        right_t = (float(words[right_i]["t0"]) if right_i < len(words)
                   else original[end_i - 1][1])
        if right_t <= left_t:
            continue
        weights = [max(1, len(expected_norm[i]) + 1) for i in range(start_i, end_i)]
        total = float(sum(weights))
        clock = left_t
        for i, weight in zip(range(start_i, end_i), weights):
            dur = (right_t - left_t) * (weight / total)
            words[i]["t0"] = round(clock, 3)
            words[i]["t1"] = round(clock + dur, 3)
            clock += dur

    return f"partial {len(anchors)}/{len(words)} exact anchors"


# ---- entry point -------------------------------------------------------------------

def align_scenes(scenes: list[dict], timings: dict[str, Any],
                 audio_dir: Path, engine: str = "auto") -> None:
    """Align every scene's final (post-loudnorm, post-rescale) wav in place.
    Never raises: a scene that can't be aligned keeps its estimated timings."""
    cands = _candidates(engine)
    if not cands:
        print(f"align: no engine available for {engine!r} — keeping estimated word timings\n"
              "  install one of: `pip install faster-whisper` (narova venv), or\n"
              "  whisper.cpp so `whisper-cli` is on PATH (see references/audio.md)",
              flush=True)
        return
    for s in scenes:
        nn = f"{s['n']:02d}"
        wav = audio_dir / f"{nn}.wav"
        words = timings[s["id"]].get("words") or []
        if not words:
            continue
        for name, fn in cands:
            try:
                measured = _cached_words(wav, name, fn)
            except Exception as e:  # engine failure: try the next engine
                print(f"align: scene {nn} [{s['id']}] {name} failed: {e}", flush=True)
                continue
            why = apply_alignment(measured, words)
            if why is None:
                print(f"align {nn} [{s['id']:>9}] {len(words)} words measured ({name})",
                      flush=True)
            elif why.startswith("partial "):
                print(f"align {nn} [{s['id']:>9}] {why} ({name})", flush=True)
            else:
                print(f"align: scene {nn} [{s['id']}] {name} mismatch: {why}"
                      " — keeping estimates", flush=True)
            break
        else:
            print(f"align: scene {nn} [{s['id']}] every engine failed — keeping estimates",
                  flush=True)
