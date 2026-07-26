"""TTS backends behind one interface: `synthesize(who, text, out_path) -> Path`.

Implementations:
  - PiperBackend: local ONNX voices via the `piper-tts` pip package (PiperVoice).
    Downloads the voice model on first use.
  - XttsBackend: coqui-tts XTTS-v2 (higher quality, slower). Imports the
    transformers shim BEFORE `from TTS.api import TTS`; runs on MPS or CPU.
  - QwenBackend: Qwen3-TTS CustomVoice presets.
  - ChatterboxBackend: Resemble AI Chatterbox for voice CLONING from a
    recording. It hard-pins torch==2.6 / transformers==5.2, which conflict with
    the other backends, so it lives in an ISOLATED venv and is driven as a
    subprocess worker (chatterbox_worker.py) — this class holds only stdlib.

Heavy deps (piper / TTS / torch) are imported lazily inside each backend's
constructor so the package stays importable without them installed.

`build_backends()` maps every `who` key to a backend instance, sharing one
instance per backend type (each model is loaded once).
"""
from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import wave
from pathlib import Path
from typing import Protocol


CLONE_EXTS = (".wav", ".mp3", ".flac", ".m4a")


def chatterbox_python() -> Path:
    """The Python of the isolated chatterbox venv (created by
    `setup.sh --chatterbox`). Mirrors setup.sh's default location."""
    env = os.environ.get("NAROVA_CHATTERBOX_VENV")
    if env:
        return Path(env) / "bin" / "python"
    home = Path(os.environ.get("NAROVA_HOME", Path.home() / ".narova"))
    return home / "venv-chatterbox" / "bin" / "python"


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
        dev = device or os.environ.get("XTTS_DEVICE", None)
        if dev is None:
            if torch.backends.mps.is_available():
                print("[xtts] mps detected but known-broken with XTTS — using cpu", flush=True)
            dev = "cpu"
        print(f"[xtts] loading XTTS-v2 on {dev} …", flush=True)
        self._tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
        if dev != "cpu":
            self._tts.to(dev)
        print("[xtts] speakers:", self._speakers, flush=True)

    def synthesize(self, who: str, text: str, out_path: Path) -> Path:
        # `speaker` may be a studio speaker name OR an ABSOLUTE path to a
        # short clean recording (wav/mp3/flac/m4a) — XTTS then clones that
        # voice. (Absolute because synth does not run in the project dir.)
        spk = self._speakers[who]
        kw: dict = {}
        p = Path(spk)
        if p.suffix.lower() in CLONE_EXTS:
            # It reads as a clone sample. Fail loudly rather than fall through
            # to a studio-name lookup (which raises an opaque XTTS error).
            if not p.is_absolute():
                raise ValueError(
                    f"voice {who!r}: clone sample {spk!r} must be an ABSOLUTE path "
                    f"— synth does not run in the project dir"
                )
            if not p.exists():
                raise ValueError(f"voice {who!r}: clone sample not found: {spk}")
            if not p.is_file():
                raise ValueError(f"voice {who!r}: clone sample is not a file: {spk}")
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


class ChatterboxBackend:
    """Resemble AI Chatterbox — voice CLONING from a recording. `speaker` in
    config is an ABSOLUTE path to a short clean sample (10–20s). Optional
    per-voice `exaggeration` (0.25–2.0) and `cfg_weight` (0.0–1.0) tune
    delivery; optional per-voice `lang` (e.g. "fr", "zh") switches synthesis to
    the Multilingual model (v3 checkpoint by default — see chatterbox_worker).
    Runs the model in an isolated venv via a persistent subprocess worker;
    this class only speaks the stdio JSON protocol (no torch here)."""

    def __init__(self, speakers: dict[str, str],
                 exaggerations: dict[str, float] | None = None,
                 cfg_weights: dict[str, float] | None = None,
                 langs: dict[str, str] | None = None,
                 venv_python: Path | None = None):
        self._speakers = dict(speakers)
        self._exg = self._validate_delivery(
            exaggerations or {}, "exaggeration", 0.25, 2.0)
        self._cfgw = self._validate_delivery(
            cfg_weights or {}, "cfg_weight", 0.0, 1.0)
        self._langs = {}
        for who, lang in (langs or {}).items():
            if not isinstance(lang, str) or not lang.strip():
                raise ValueError(
                    f"voice {who!r}: chatterbox lang must be a language code "
                    f"like \"fr\" or \"zh\", got {lang!r}")
            self._langs[who] = lang.strip()
        for who, spk in self._speakers.items():
            p = Path(spk)
            if p.suffix.lower() not in CLONE_EXTS:
                raise ValueError(
                    f"voice {who!r}: chatterbox clones from a recording — `speaker` "
                    f"must be a {'/'.join(CLONE_EXTS)} path, got {spk!r}")
            if not p.is_absolute():
                raise ValueError(
                    f"voice {who!r}: clone sample {spk!r} must be an ABSOLUTE path "
                    f"— synth does not run in the project dir")
            if not p.exists():
                raise ValueError(f"voice {who!r}: clone sample not found: {spk}")
            if not p.is_file():
                raise ValueError(f"voice {who!r}: clone sample is not a file: {spk}")

        py = Path(venv_python) if venv_python else chatterbox_python()
        if not py.exists():
            raise RuntimeError(
                f"chatterbox venv not found at {py} — install it once with:\n"
                f"  bash <skill>/tool/setup.sh --chatterbox")
        worker = Path(__file__).with_name("chatterbox_worker.py")
        print(f"[chatterbox] starting worker: {py} {worker.name}", flush=True)
        # stderr inherits the parent's (worker logs/progress reach the console);
        # stdout is the JSON protocol channel.
        self._proc = subprocess.Popen(
            [str(py), str(worker)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
        ready = self._recv()
        if not ready.get("ready"):
            raise RuntimeError(f"chatterbox worker failed to start: {ready}")
        print("[chatterbox] speakers:", self._speakers, flush=True)

    @staticmethod
    def _validate_delivery(values: dict[str, float], name: str,
                           minimum: float, maximum: float) -> dict[str, float]:
        normalized = {}
        for who, value in values.items():
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(
                    f"voice {who!r}: chatterbox {name} must be a number "
                    f"from {minimum} to {maximum}, got {value!r}")
            number = float(value)
            if not math.isfinite(number) or not minimum <= number <= maximum:
                raise ValueError(
                    f"voice {who!r}: chatterbox {name} must be from "
                    f"{minimum} to {maximum}, got {value!r}")
            normalized[who] = number
        return normalized

    def _recv(self) -> dict:
        line = self._proc.stdout.readline()
        if not line:
            raise RuntimeError(
                "chatterbox worker exited unexpectedly (see its log above) — "
                "check the chatterbox venv: bash <skill>/tool/setup.sh --chatterbox")
        try:
            return json.loads(line)
        except json.JSONDecodeError as e:
            raise RuntimeError(
                f"chatterbox worker returned an invalid response: {line.rstrip()!r}") from e

    def synthesize(self, who: str, text: str, out_path: Path) -> Path:
        req = {"text": text, "out": str(out_path), "ref": self._speakers[who]}
        if who in self._exg:
            req["exaggeration"] = self._exg[who]
        if who in self._cfgw:
            req["cfg_weight"] = self._cfgw[who]
        if who in self._langs:
            req["lang"] = self._langs[who]
        try:
            self._proc.stdin.write(json.dumps(req) + "\n")
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            raise RuntimeError(
                "chatterbox worker exited unexpectedly (see its log above) — "
                "check the chatterbox venv: bash <skill>/tool/setup.sh --chatterbox") from e
        resp = self._recv()
        if not resp.get("ok"):
            raise RuntimeError(f"chatterbox synth failed for {who!r}: {resp.get('error')}")
        return out_path

    def close(self) -> None:
        proc = getattr(self, "_proc", None)
        if proc and proc.poll() is None:
            try:
                proc.stdin.close()
            except Exception:
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:
                    proc.wait(timeout=5)
                except Exception:
                    pass
            except Exception:
                pass

    def __del__(self):
        self.close()


BACKENDS = {"piper": PiperBackend, "xtts": XttsBackend, "qwen": QwenBackend,
            "chatterbox": ChatterboxBackend}


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
        elif kind == "chatterbox":
            exg = {who: voices[who]["exaggeration"] for who in speakers
                   if voices[who].get("exaggeration") is not None}
            cfgw = {who: voices[who]["cfg_weight"] for who in speakers
                    if voices[who].get("cfg_weight") is not None}
            langs = {who: voices[who]["lang"] for who in speakers if voices[who].get("lang")}
            instances[kind] = ChatterboxBackend(speakers, exg, cfgw, langs)
        else:
            instances[kind] = BACKENDS[kind](speakers)

    router: dict[str, Backend] = {}
    for who, v in voices.items():
        router[who] = instances[v.get("backend", default_backend)]
    return router
