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
import queue
import subprocess
import sys
import threading
import wave
from pathlib import Path
from typing import Callable, Protocol

from .providers import PROVIDER_PROTOCOL, load_provider


CLONE_EXTS = (".wav", ".mp3", ".flac", ".m4a")


# Languages supported by the XTTS-v2 multilingual model
# (tts_models/multilingual/multi-dataset/xtts_v2).
XTTS_LANGS = frozenset([
    "en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru",
    "nl", "cs", "ar", "zh-cn", "ja", "hu", "ko", "hi",
])


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

    def synthesize(self, who: str, text: str, out_path: Path, lang: str | None = None,
                   seed: int | None = None) -> Path: ...


def _provider_error(response: dict, fallback: str) -> str:
    error = response.get("error")
    if isinstance(error, str):
        return error
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return error["message"]
    return fallback


class _ProviderWorker:
    """Persistent JSONL subprocess channel for one registered provider."""

    def __init__(self, manifest: dict, startup_timeout: float, request_timeout: float):
        self.manifest = manifest
        self.startup_timeout = startup_timeout
        self.request_timeout = request_timeout
        self.process: subprocess.Popen | None = None
        self.lines: queue.Queue[str | None] = queue.Queue()
        self.provider_version = manifest.get("providerVersion", "")

    def _sanitize(self, message: str) -> str:
        clean = str(message)
        for name in self.manifest.get("requiredEnvironment", []):
            value = os.environ.get(name)
            if value:
                clean = clean.replace(value, "[redacted]")
        return clean

    def start(self) -> None:
        if self.process is not None and self.process.poll() is None:
            return
        missing = [
            name for name in self.manifest.get("requiredEnvironment", [])
            if not os.environ.get(name)
        ]
        if missing:
            raise RuntimeError(
                f"provider {self.manifest['name']!r} is missing required environment: "
                f"{', '.join(missing)}")
        try:
            # stderr intentionally inherits the parent terminal for provider
            # diagnostics; stdout remains exclusively the JSONL protocol.
            self.process = subprocess.Popen(
                self.manifest["command"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=None,
                text=True,
                encoding="utf-8",
                bufsize=1,
                shell=False,
            )
        except OSError as exc:
            raise RuntimeError(
                f"provider {self.manifest['name']!r} failed to start: {exc}") from exc
        assert self.process.stdout is not None

        def read_lines() -> None:
            try:
                for line in self.process.stdout:
                    self.lines.put(line)
            finally:
                self.lines.put(None)

        threading.Thread(
            target=read_lines,
            name=f"narova-provider-{self.manifest['name']}",
            daemon=True,
        ).start()
        response = self.exchange(
            {"operation": "hello", "protocol": PROVIDER_PROTOCOL},
            timeout=self.startup_timeout,
            operation="handshake",
        )
        if response.get("ok") is not True:
            message = self._sanitize(_provider_error(response, "unknown worker error"))
            self.terminate()
            raise RuntimeError(
                f"provider {self.manifest['name']!r} handshake failed: {message}")
        if response.get("protocol") != PROVIDER_PROTOCOL:
            actual = response.get("protocol")
            self.terminate()
            raise RuntimeError(
                f"provider {self.manifest['name']!r} uses unsupported protocol "
                f"{actual!r}; expected {PROVIDER_PROTOCOL}")
        if response.get("provider") != self.manifest["name"]:
            actual = response.get("provider")
            self.terminate()
            raise RuntimeError(
                f"provider handshake name mismatch: expected {self.manifest['name']!r}, "
                f"got {actual!r}")
        version = response.get("providerVersion")
        if not isinstance(version, str) or not version:
            self.terminate()
            raise RuntimeError(
                f"provider {self.manifest['name']!r} handshake omitted providerVersion")
        self.provider_version = version

    def exchange(self, request: dict, timeout: float | None = None,
                 operation: str = "request") -> dict:
        process = self.process
        if process is None:
            raise RuntimeError("provider worker has not started")
        if process.poll() is not None:
            raise RuntimeError(
                f"provider {self.manifest['name']!r} worker exited with "
                f"status {process.returncode}")
        assert process.stdin is not None
        try:
            process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
            process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise RuntimeError(
                f"provider {self.manifest['name']!r} worker exited while sending "
                f"{operation}") from exc
        try:
            line = self.lines.get(timeout=self.request_timeout if timeout is None else timeout)
        except queue.Empty as exc:
            self.terminate()
            raise RuntimeError(
                f"provider {self.manifest['name']!r} {operation} timed out") from exc
        if line is None:
            status = process.poll()
            raise RuntimeError(
                f"provider {self.manifest['name']!r} worker exited unexpectedly"
                f"{'' if status is None else f' with status {status}'}")
        try:
            response = json.loads(line)
        except json.JSONDecodeError as exc:
            self.terminate()
            raise RuntimeError(
                f"provider {self.manifest['name']!r} returned invalid JSON "
                f"during {operation}") from exc
        if not isinstance(response, dict):
            raise RuntimeError(
                f"provider {self.manifest['name']!r} returned a non-object response")
        return response

    def close(self) -> None:
        process = self.process
        if process is None:
            return
        if process.poll() is None:
            try:
                assert process.stdin is not None
                process.stdin.close()
            except (BrokenPipeError, OSError):
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.terminate()
        self._close_streams(process)
        self.process = None

    def terminate(self) -> None:
        process = self.process
        if process is None:
            return
        if process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
            except OSError:
                pass
        self._close_streams(process)

    @staticmethod
    def _close_streams(process: subprocess.Popen) -> None:
        for stream in (process.stdin, process.stdout):
            if stream is not None:
                try:
                    stream.close()
                except OSError:
                    pass


class ExternalProviderBackend:
    """Generic registered provider implementing Narova's raw-wav backend seam.

    The worker starts lazily on first synthesis and is shared by every voice
    that names this provider. Narova continues to own all post-processing.
    """

    def __init__(self, manifest: dict, speakers: dict[str, str],
                 provider_options: dict[str, dict] | None = None,
                 startup_timeout: float = 10.0, request_timeout: float | None = None):
        self.manifest = dict(manifest)
        # NAR-018-071/072: honor seeds only when the provider's registration
        # declares the family honored. Undeclared or other statuses keep the
        # provider's default behavior (mode recorded as provider-default).
        self.seed_capable = (
            (self.manifest.get("deliveryCapabilities") or {})
            .get("seed-stabilization") == "honored"
        )
        if self.manifest.get("protocol") != PROVIDER_PROTOCOL:
            raise ValueError(
                f"provider {self.manifest.get('name')!r}: unsupported protocol "
                f"{self.manifest.get('protocol')!r}")
        self._speakers = dict(speakers)
        self._options = {
            who: json.loads(json.dumps(options or {}))
            for who, options in (provider_options or {}).items()
        }
        request_timeout = request_timeout or float(
            os.environ.get("NAROVA_PROVIDER_TIMEOUT", "120"))
        self._startup_timeout = float(startup_timeout)
        self._request_timeout = float(request_timeout)
        self._worker: _ProviderWorker | None = None
        self._request_number = 0

    def _ensure_worker(self) -> _ProviderWorker:
        if self._worker is None:
            worker = _ProviderWorker(
                self.manifest, self._startup_timeout, self._request_timeout)
            worker.start()
            self._worker = worker
        return self._worker

    @staticmethod
    def _validate_output(path: Path) -> Path:
        if not path.is_absolute():
            raise ValueError("external provider output path must be absolute")
        if not path.parent.is_dir():
            raise ValueError(
                f"external provider output directory does not exist: {path.parent}")
        if os.path.lexists(path) and path.is_symlink():
            raise ValueError("external provider output path must not be a symlink")
        if path.exists() and not path.is_file():
            raise ValueError("external provider output path must be a regular file")
        path.unlink(missing_ok=True)
        return path

    @staticmethod
    def _validate_wav(path: Path) -> None:
        try:
            with wave.open(str(path), "rb") as audio:
                if audio.getnchannels() < 1 or audio.getsampwidth() < 1 \
                        or audio.getframerate() < 1 or audio.getnframes() < 1:
                    raise ValueError("empty or invalid WAV stream")
        except (OSError, EOFError, wave.Error, ValueError) as exc:
            raise RuntimeError(
                f"provider output is not a valid WAV file: {path}") from exc

    def synthesize(self, who: str, text: str, out_path: Path,
                   lang: str | None = None, seed: int | None = None) -> Path:
        output = self._validate_output(Path(out_path))
        worker = self._ensure_worker()
        self._request_number += 1
        request_id = f"request-{self._request_number}"
        # The derived seed rides in the request options COPY; the authored
        # providerOptions (and therefore cache identity) are never mutated.
        options = dict(self._options.get(who, {}))
        if seed is not None and self.seed_capable:
            options["seed"] = seed
        request = {
            "id": request_id,
            "operation": "synthesize",
            "text": text,
            "speaker": self._speakers[who],
            "language": lang,
            "output": str(output),
            "options": options,
        }
        response = worker.exchange(request, operation=f"synthesis {request_id}")
        if response.get("id") != request_id:
            raise RuntimeError(
                f"provider {self.manifest['name']!r} returned a mismatched request id")
        if response.get("ok") is not True:
            message = worker._sanitize(
                _provider_error(response, "unknown synthesis error"))
            raise RuntimeError(
                f"provider {self.manifest['name']!r} synthesis failed: {message}")
        response_output = response.get("output")
        if not isinstance(response_output, str) \
                or Path(response_output).resolve() != output.resolve():
            raise RuntimeError(
                f"provider {self.manifest['name']!r} returned an unexpected output path")
        if not output.is_file():
            raise RuntimeError(
                f"provider {self.manifest['name']!r} did not create the requested output file")
        self._validate_wav(output)
        return output

    @classmethod
    def list_voices(cls, manifest: dict, timeout: float = 10.0) -> list[dict]:
        if not manifest.get("capabilities", {}).get("voiceListing"):
            raise RuntimeError(
                f"provider {manifest.get('name')!r} does not support voice listing")
        worker = _ProviderWorker(manifest, timeout, timeout)
        try:
            worker.start()
            response = worker.exchange(
                {"operation": "listVoices"}, timeout=timeout,
                operation="voice listing")
            if response.get("ok") is not True:
                raise RuntimeError(
                    f"provider {manifest['name']!r} voice listing failed: "
                    f"{worker._sanitize(_provider_error(response, 'unknown worker error'))}")
            voices = response.get("voices")
            if not isinstance(voices, list):
                raise RuntimeError(
                    f"provider {manifest['name']!r} returned an invalid voice list")
            normalized = []
            for item in voices:
                if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                    raise RuntimeError(
                        f"provider {manifest['name']!r} returned an invalid voice entry")
                normalized.append({
                    "id": item["id"],
                    "name": item.get("name") if isinstance(item.get("name"), str) else item["id"],
                })
            return normalized
        finally:
            worker.close()

    def close(self) -> None:
        worker = getattr(self, "_worker", None)
        if worker is not None:
            worker.close()
            self._worker = None

    def __del__(self):
        self.close()


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

    def synthesize(self, who: str, text: str, out_path: Path, lang: str | None = None,
                   seed: int | None = None) -> Path:
        # Deterministic by construction: fixed syn_config, no sampling
        # variance. The seed is accepted for interface parity and unused.
        self.seed_capable = True  # deterministic by construction
        with wave.open(str(out_path), "wb") as wf:
            self._voices[who].synthesize_wav(text, wf, syn_config=self._cfg)
        return out_path


class XttsBackend:
    """coqui-tts XTTS-v2. `speaker` in config is a studio speaker name
    (e.g. "Damien Black"). NEVER use the XTTS `speed` param (LEARNINGS #9) —
    speed is applied downstream with ffmpeg atempo."""

    def __init__(self, speakers: dict[str, str], langs: dict[str, str] | None = None,
                 device: str | None = None):
        os.environ["COQUI_TOS_AGREED"] = "1"  # license gate (LEARNINGS #8)
        from . import xtts_compat  # noqa: F401  shim newest transformers (LEARNINGS #6)
        import torch
        from TTS.api import TTS

        self._speakers = dict(speakers)
        self._langs = dict(langs) if langs else {}
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
        self.seed_capable = True

    def synthesize(self, who: str, text: str, out_path: Path, lang: str | None = None,
                   seed: int | None = None) -> Path:
        # NAR-018-071: pin the sampling RNG when a derived seed is supplied so
        # an unchanged sentence reproduces its take.
        if seed is not None:
            import torch
            torch.manual_seed(seed)
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
        turn_lang = lang or self._langs.get(who)
        if turn_lang and turn_lang not in XTTS_LANGS:
            raise ValueError(
                f"voice {who!r}: XTTS does not support language {turn_lang!r}. "
                f"Supported: {', '.join(sorted(XTTS_LANGS))}"
            )
        self._tts.tts_to_file(
            text=text, language=turn_lang or "en", file_path=str(out_path), **kw
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
        dev = device or os.environ.get("QWEN_TTS_DEVICE", None)
        if dev is None:
            if torch.backends.mps.is_available():
                print("[qwen] mps detected but known-broken — using cpu", flush=True)
            dev = "cpu"
        print(f"[qwen] loading {self.MODEL} on {dev} …", flush=True)
        try:
            self._model = Qwen3TTSModel.from_pretrained(self.MODEL, device_map=dev, dtype=torch.float32)
        except Exception as e:
            print("[qwen] device fallback cpu:", e, flush=True)
            self._model = Qwen3TTSModel.from_pretrained(self.MODEL, device_map="cpu", dtype=torch.float32)
        print("[qwen] speakers:", self._speakers, flush=True)
        self.seed_capable = False

    def synthesize(self, who: str, text: str, out_path: Path, lang: str | None = None,
                   seed: int | None = None) -> Path:
        import soundfile as sf  # dep of qwen-tts
        # No seed hook in generate_custom_voice; declared unknown (capability
        # surface) — the seed is accepted and unused (provider-default mode).
        _ = seed

        turn_lang = lang or self._langs.get(who)
        wavs, sr = self._model.generate_custom_voice(
            text=text, speaker=self._speakers[who], language=turn_lang,
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
                f"  narova-setup --chatterbox")
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
                "check the chatterbox venv: narova-setup --chatterbox")
        try:
            return json.loads(line)
        except json.JSONDecodeError as e:
            raise RuntimeError(
                f"chatterbox worker returned an invalid response: {line.rstrip()!r}") from e

    def synthesize(self, who: str, text: str, out_path: Path, lang: str | None = None,
                   seed: int | None = None) -> Path:
        # Worker protocol has no seed field; declared unknown — accepted and
        # unused (provider-default mode).
        _ = seed
        req = {"text": text, "out": str(out_path), "ref": self._speakers[who]}
        if who in self._exg:
            req["exaggeration"] = self._exg[who]
        if who in self._cfgw:
            req["cfg_weight"] = self._cfgw[who]
        turn_lang = lang or self._langs.get(who)
        if turn_lang:
            req["lang"] = turn_lang
        try:
            self._proc.stdin.write(json.dumps(req) + "\n")
            self._proc.stdin.flush()
        except (BrokenPipeError, OSError) as e:
            raise RuntimeError(
                "chatterbox worker exited unexpectedly (see its log above) — "
                "check the chatterbox venv: narova-setup --chatterbox") from e
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


BUILTIN_BACKENDS = {
    "piper": PiperBackend,
    "xtts": XttsBackend,
    "qwen": QwenBackend,
    "chatterbox": ChatterboxBackend,
}
# Backwards-compatible module alias; the registry itself is authoritative.
BACKENDS = BUILTIN_BACKENDS


def build_backends(
        voices: dict[str, dict], default_backend: str,
        provider_loader: Callable[[str], dict | None] = load_provider,
) -> dict[str, Backend]:
    """Map each `who` -> a backend instance, one shared instance per backend
    type. `voices` is the config's voices block: {who: {backend?, speaker, lang?}}."""
    by_type: dict[str, dict[str, str]] = {}
    for who, v in voices.items():
        kind = v.get("backend", default_backend)
        if kind not in BUILTIN_BACKENDS and provider_loader(kind) is None:
            raise ValueError(
                f"voice {who!r}: external provider {kind!r} is not registered "
                f"(built-ins: {'|'.join(BUILTIN_BACKENDS)})")
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
        elif kind == "xtts":
            langs = {who: voices[who]["lang"] for who in speakers if voices[who].get("lang")}
            instances[kind] = XttsBackend(speakers, langs)
        elif kind in BUILTIN_BACKENDS:
            instances[kind] = BUILTIN_BACKENDS[kind](speakers)
        else:
            manifest = provider_loader(kind)
            if manifest is None:
                raise ValueError(f"external provider {kind!r} is not registered")
            for who in speakers:
                voices[who].setdefault("providerProtocol", manifest["protocol"])
                voices[who].setdefault(
                    "providerVersion", manifest.get("providerVersion", ""))
            options = {
                who: voices[who].get("providerOptions", {})
                for who in speakers
            }
            instances[kind] = ExternalProviderBackend(manifest, speakers, options)

    router: dict[str, Backend] = {}
    for who, v in voices.items():
        router[who] = instances[v.get("backend", default_backend)]
    return router


def close_backends(router: dict[str, Backend]) -> None:
    seen: set[int] = set()
    for backend in router.values():
        if id(backend) in seen:
            continue
        seen.add(id(backend))
        close = getattr(backend, "close", None)
        if callable(close):
            close()
