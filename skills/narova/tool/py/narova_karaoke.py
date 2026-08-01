#!/usr/bin/env python3
"""Standalone word-level transcription for external audio files.

Used by `narova karaoke generate` to produce word-timed JSON from an audio
file + optional transcript. Unlike the main pipeline (which operates on
already-synthesised scene WAVs), this reads arbitrary audio and uses
faster-whisper or whisper-cpp for word-level timestamps.

When a clean transcript is provided, SequenceMatcher maps its tokens onto
the Whisper tokens so corrections don't break word-timing alignment.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import cast


def faster_whisper_words(wav_path: Path, model: str = "tiny") -> list[dict]:
    """Word-level timestamps via faster-whisper."""
    try:
        from faster_whisper import WhisperModel  # type: ignore[import-untyped]
    except ImportError:
        raise RuntimeError("faster-whisper not installed — pip install faster-whisper into the narova venv")

    model = WhisperModel(model, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(str(wav_path), word_timestamps=True)
    words: list[dict] = []
    for seg in segments:
        for w in (seg.words or []):
            words.append({"w": w.word.strip(), "t0": round(w.start, 3), "t1": round(w.end, 3)})
    return words


def whisper_cpp_words(wav_path: Path, model: str = "tiny.en") -> list[dict]:
    """Word-level timestamps via whisper.cpp (whisper-cli)."""
    import subprocess
    import tempfile

    model_path = _ensure_whisper_cpp_model(model)
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        subprocess.run(
            ["whisper-cli", "-m", str(model_path), "-f", str(wav_path),
             "-ojf", "-ml", "1", "-of", str(tmp_path.with_suffix(""))],
            check=True, capture_output=True, text=True,
        )
        data = json.loads(tmp_path.read_text())
        words: list[dict] = []
        for seg in data.get("transcription", []):
            for w in seg.get("tokens", []):
                w_text = w.get("text", "").strip()
                if w_text and not w_text.startswith("[") and not w_text.startswith("<"):
                    words.append({
                        "w": w_text,
                        "t0": round(float(w.get("t0", 0)) / 100, 3),
                        "t1": round(float(w.get("t1", 0)) / 100, 3),
                    })
        return words
    finally:
        tmp_path.unlink(missing_ok=True)


def _ensure_whisper_cpp_model(model: str) -> Path:
    """Download the ggml model if missing, return its path."""
    models_dir = Path.home() / ".narova" / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    model_path = models_dir / f"ggml-{model}.bin"
    if model_path.exists():
        return model_path
    import urllib.request
    url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin"
    print(f"downloading whisper model {model}...", flush=True)
    urllib.request.urlretrieve(url, model_path)
    return model_path


def tokenize(text: str) -> list[str]:
    """Split text into word tokens (whitespace + punctuation-stripped)."""
    return [t for t in re.split(r"\s+", text.strip()) if t]


def map_transcript(source_words: list[dict], clean_text: str) -> list[dict]:
    """Map a clean transcript onto Whisper word timings using SequenceMatcher."""
    clean_tokens = tokenize(clean_text)
    source_tokens = [w["w"] for w in source_words]
    if len(clean_tokens) == len(source_tokens) and all(
        ct.lower() == st.lower() for ct, st in zip(clean_tokens, source_tokens)
    ):
        # No mapping needed — just replace the word text.
        for i, w in enumerate(source_words):
            w["w"] = clean_tokens[i]
        return source_words

    # Align word sequences and interpolate timings.
    sm = SequenceMatcher(None,
        [t.lower() for t in source_tokens],
        [t.lower() for t in clean_tokens],
    )
    aligned: list[dict] = []
    si = 0  # cursor in source_words

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag in ("equal", "replace"):
            # Map each clean token to the corresponding source word's timing.
            for j in range(j1, j2):
                src_idx = si + (j - j1) if si + (j - j1) < len(source_words) else si
                aligned.append({
                    "w": clean_tokens[j],
                    "t0": source_words[src_idx]["t0"],
                    "t1": source_words[src_idx]["t1"],
                })
            si += (i2 - i1) if tag == "equal" else max(i2 - i1, j2 - j1)
        elif tag == "delete":
            # Source had words not in clean transcript — skip them.
            si += i2 - i1
        elif tag == "insert":
            # Clean transcript has words not in source — interpolate.
            prev_t = aligned[-1]["t1"] if aligned else 0.0
            next_t = source_words[si]["t0"] if si < len(source_words) else prev_t + 0.5
            span = max(0.05, (next_t - prev_t) / (j2 - j1 + 1))
            for k, j in enumerate(range(j1, j2)):
                t0 = round(prev_t + k * span, 3)
                t1 = round(t0 + span * 0.9, 3)
                aligned.append({"w": clean_tokens[j], "t0": t0, "t1": t1})

    return aligned


def transcribe(audio_path: str, engine: str = "auto", transcript_path: str | None = None) -> list[dict]:
    """Get word timings, optionally mapped to a clean transcript."""
    wav = Path(audio_path)
    if not wav.is_file():
        raise FileNotFoundError(f"audio file not found: {wav}")

    # Get word timestamps via whisper.
    if engine == "faster-whisper":
        words = faster_whisper_words(wav)
    elif engine == "whisper-cpp":
        words = whisper_cpp_words(wav)
    else:
        # auto
        try:
            words = faster_whisper_words(wav)
        except (ImportError, RuntimeError):
            try:
                words = whisper_cpp_words(wav)
            except Exception:
                raise RuntimeError(
                    "no whisper engine available — install faster-whisper "
                    "(pip install faster-whisper) or whisper-cpp (brew install whisper-cpp)"
                )

    if not words:
        raise RuntimeError("whisper returned no word timings")

    # Map to clean transcript if provided.
    if transcript_path:
        clean = Path(transcript_path).read_text()
        words = map_transcript(words, clean)

    return words


def main() -> None:
    p = argparse.ArgumentParser(description="Word-level transcription for narova karaoke.")
    p.add_argument("--audio", required=True, help="Path to audio file (wav, mp3, etc.)")
    p.add_argument("--out", default=".", help="Output directory")
    p.add_argument("--transcript", help="Optional clean transcript text file")
    p.add_argument("--engine", default="auto", choices=["auto", "faster-whisper", "whisper-cpp"])
    args = p.parse_args()

    try:
        words = transcribe(args.audio, args.engine, args.transcript)
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    # Print one JSON object per line (parsed by karaoke.js parseWordTimings).
    for w in words:
        print(json.dumps(w, ensure_ascii=False))
    print()  # trailing newline


if __name__ == "__main__":
    main()
