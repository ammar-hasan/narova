"""TTS backends behind one interface: `synthesize(who, text, out_path) -> Path`.

Two implementations:
  - PiperBackend: local ONNX voices via the `piper-tts` pip package (PiperVoice).
    Downloads the voice model on first use.
  - XttsBackend: coqui-tts XTTS-v2 (higher quality, slower). Imports the
    transformers shim BEFORE `from TTS.api import TTS`; runs on MPS or CPU.

Heavy deps (piper / TTS / torch) are imported lazily inside each backend's
constructor so the package stays importable without them installed.

`build_backends()` maps every `who` key to a backend instance, sharing one
instance per backend type (the XTTS model is loaded once).
"""
from __future__ import annotations

import os
import subprocess
import sys
import wave
from pathlib import Path
from typing import Protocol


class Backend(Protocol):
    """A backend synthesizes one utterance for one speaker to a raw wav."""

    def synthesize(self, who: str, text: str, out_path: Path) -> Path: ...


class PiperBackend:
    """Local Piper ONNX voices. `speaker` in config is a Piper voice name
    (e.g. "en_US-ryan-high"); the model is downloaded on first use."""

    def __init__(self, speakers: dict[str, str], data_dir: Path | None = None):
        from piper import PiperVoice, SynthesisConfig  # lazy

        self._cfg = SynthesisConfig(length_scale=1.06)
        self._data_dir = data_dir or Path(
            os.environ.get("NAROVA_PIPER_DIR", Path.home() / ".cache" / "narova" / "piper")
        )
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._voices = {}
        for who, name in speakers.items():
            onnx = self._ensure_voice(name)
            self._voices[who] = PiperVoice.load(str(onnx))

    def _ensure_voice(self, name: str) -> Path:
        onnx = self._data_dir / f"{name}.onnx"
        if not onnx.exists():
            print(f"[piper] downloading voice {name} -> {self._data_dir}", flush=True)
            subprocess.run(
                [sys.executable, "-m", "piper.download_voices", name, "--data-dir", str(self._data_dir)],
                check=True,
            )
        return onnx

    def synthesize(self, who: str, text: str, out_path: Path) -> Path:
        with wave.open(str(out_path), "wb") as wf:
            self._voices[who].synthesize_wav(text, wf, syn_config=self._cfg)
        return out_path


class XttsBackend:
    """coqui-tts XTTS-v2. `speaker` in config is a studio speaker name
    (e.g. "Damien Black"). NEVER use the XTTS `speed` param (LEARNINGS #9) —
    speed is applied downstream with ffmpeg atempo."""

    def __init__(self, speakers: dict[str, str], device: str | None = None):
        os.environ["COQUI_TOS_AGREED"] = "1"  # license gate (LEARNINGS #8)
        from . import xtts_compat  # noqa: F401  shim newest transformers (LEARNINGS #6)
        import torch
        from TTS.api import TTS

        self._speakers = dict(speakers)
        dev = device or os.environ.get(
            "XTTS_DEVICE", "mps" if torch.backends.mps.is_available() else "cpu"
        )
        print(f"[xtts] loading XTTS-v2 on {dev} …", flush=True)
        self._tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
        try:
            self._tts.to(dev)
        except Exception as e:  # MPS can fail on some ops; fall back to CPU
            print("[xtts] device fallback cpu:", e, flush=True)
            self._tts.to("cpu")
        print("[xtts] speakers:", self._speakers, flush=True)

    def synthesize(self, who: str, text: str, out_path: Path) -> Path:
        # `speaker` may be a studio speaker name OR an ABSOLUTE path to a
        # short clean recording (wav/mp3/flac/m4a) — XTTS then clones that
        # voice. (Absolute because synth does not run in the project dir.)
        spk = self._speakers[who]
        kw: dict = {}
        p = Path(spk)
        if p.suffix.lower() in (".wav", ".mp3", ".flac", ".m4a") and p.exists():
            kw["speaker_wav"] = str(p)
        else:
            kw["speaker"] = spk
        self._tts.tts_to_file(
            text=text, language="en", file_path=str(out_path), **kw
        )
        return out_path


class QwenBackend:
    """Qwen3-TTS (Apache 2.0). `speaker` in config is one of the 9 preset
    CustomVoice speakers (e.g. "Ryan", "Serena"). Model: 0.6B by default,
    override with $NAROVA_QWEN_MODEL. Optional per-voice `lang` in the config
    is passed through; default lets the model auto-detect."""

    MODEL = os.environ.get("NAROVA_QWEN_MODEL", "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice")

    def __init__(self, speakers: dict[str, str], langs: dict[str, str] | None = None,
                 instructs: dict[str, str] | None = None, device: str | None = None):
        import torch  # lazy
        from qwen_tts import Qwen3TTSModel

        self._speakers = dict(speakers)
        self._langs = dict(langs or {})
        self._instructs = dict(instructs or {})
        dev = device or os.environ.get(
            "QWEN_TTS_DEVICE", "mps" if torch.backends.mps.is_available() else "cpu"
        )
        print(f"[qwen] loading {self.MODEL} on {dev} …", flush=True)
        try:
            self._model = Qwen3TTSModel.from_pretrained(self.MODEL, device_map=dev, dtype=torch.float32)
        except Exception as e:
            print("[qwen] device fallback cpu:", e, flush=True)
            self._model = Qwen3TTSModel.from_pretrained(self.MODEL, device_map="cpu", dtype=torch.float32)
        print("[qwen] speakers:", self._speakers, flush=True)

    def synthesize(self, who: str, text: str, out_path: Path) -> Path:
        import soundfile as sf  # dep of qwen-tts

        wavs, sr = self._model.generate_custom_voice(
            text=text, speaker=self._speakers[who], language=self._langs.get(who),
            instruct=self._instructs.get(who),
        )
        sf.write(str(out_path), wavs[0], sr)
        return out_path


BACKENDS = {"piper": PiperBackend, "xtts": XttsBackend, "qwen": QwenBackend}


def build_backends(voices: dict[str, dict], default_backend: str) -> dict[str, Backend]:
    """Map each `who` -> a backend instance, one shared instance per backend
    type. `voices` is the config's voices block: {who: {backend?, speaker, lang?}}."""
    by_type: dict[str, dict[str, str]] = {}
    for who, v in voices.items():
        kind = v.get("backend", default_backend)
        if kind not in BACKENDS:
            raise ValueError(f"voice {who!r}: unknown backend {kind!r} (want {'|'.join(BACKENDS)})")
        speaker = v.get("speaker")
        if not speaker:
            raise ValueError(f"voice {who!r}: missing 'speaker'")
        by_type.setdefault(kind, {})[who] = speaker

    instances: dict[str, Backend] = {}
    for kind, speakers in by_type.items():
        if kind == "qwen":
            langs = {who: voices[who]["lang"] for who in speakers if voices[who].get("lang")}
            instructs = {who: voices[who]["instruct"] for who in speakers if voices[who].get("instruct")}
            instances[kind] = QwenBackend(speakers, langs, instructs)
        else:
            instances[kind] = BACKENDS[kind](speakers)

    router: dict[str, Backend] = {}
    for who, v in voices.items():
        router[who] = instances[v.get("backend", default_backend)]
    return router
