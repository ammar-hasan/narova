#!/usr/bin/env python3
"""ElevenLabs worker for narova-tts-provider/v1.

All ElevenLabs-specific endpoints, authentication, models, and option mapping
live here, outside the main Narova skill. stdout is reserved for JSONL protocol
responses; diagnostics go to stderr.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path
from typing import Any


PROTOCOL = "narova-tts-provider/v1"
PROVIDER = "elevenlabs"
PROVIDER_VERSION = "1.0.0"
API_BASE = "https://api.elevenlabs.io"
DEFAULT_MODEL = "eleven_multilingual_v2"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"
DEFAULT_TIMEOUT = 60.0


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str) -> None:
    print(f"[elevenlabs] {message}", file=sys.stderr, flush=True)


def send(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=False), flush=True)


def api_key() -> str:
    value = os.environ.get("ELEVENLABS_API_KEY")
    if not value:
        raise ProviderError(
            "missing_environment",
            "ELEVENLABS_API_KEY is not set in the Narova process environment",
        )
    return value


def _safe_error_detail(body: bytes) -> str:
    try:
        value = json.loads(body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return ""
    detail = value.get("detail") if isinstance(value, dict) else None
    if isinstance(detail, dict):
        message = detail.get("message")
        if isinstance(message, str):
            return message[:500]
    if isinstance(detail, str):
        return detail[:500]
    return ""


def _http_error(exc: urllib.error.HTTPError) -> ProviderError:
    try:
        detail = _safe_error_detail(exc.read(64 * 1024))
    except Exception:
        detail = ""
    if exc.code in {401, 403}:
        message = "ElevenLabs authentication or voice permission was rejected"
        code = "authentication_failed"
    elif exc.code == 429:
        message = "ElevenLabs rate limit or account quota was exceeded"
        code = "rate_limited"
    elif 400 <= exc.code < 500:
        message = f"ElevenLabs rejected the synthesis request (HTTP {exc.code})"
        code = "invalid_request"
    else:
        message = f"ElevenLabs service failed (HTTP {exc.code})"
        code = "service_error"
    if detail:
        message += f": {detail}"
    return ProviderError(code, message)


def _open(request: urllib.request.Request, timeout: float):
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raise _http_error(exc) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise ProviderError(
            "network_error",
            f"ElevenLabs network request failed: {type(reason).__name__}",
        ) from exc


def request_json(path: str, key: str, timeout: float) -> dict:
    request = urllib.request.Request(
        API_BASE + path,
        headers={"Accept": "application/json", "xi-api-key": key},
        method="GET",
    )
    with _open(request, timeout) as response:
        try:
            value = json.loads(response.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ProviderError(
                "invalid_response", "ElevenLabs returned malformed JSON") from exc
    if not isinstance(value, dict):
        raise ProviderError("invalid_response", "ElevenLabs returned an invalid JSON response")
    return value


def download_speech(path: str, key: str, payload: dict, timeout: float) -> tuple[bytes, dict]:
    request = urllib.request.Request(
        API_BASE + path,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "Accept": "audio/*",
            "Content-Type": "application/json",
            "xi-api-key": key,
        },
        method="POST",
    )
    with _open(request, timeout) as response:
        audio = response.read()
        metadata = {
            "requestId": response.headers.get("request-id"),
            "characterCost": response.headers.get("character-cost"),
        }
    if not audio:
        raise ProviderError("invalid_response", "ElevenLabs returned an empty audio response")
    return audio, metadata


def _number(value: Any, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProviderError("invalid_options", f"provider option {name} must be a number")
    number = float(value)
    if not minimum <= number <= maximum:
        raise ProviderError(
            "invalid_options",
            f"provider option {name} must be from {minimum} to {maximum}",
        )
    return number


def build_request(request: dict) -> tuple[str, dict, float]:
    options = request.get("options") or {}
    if not isinstance(options, dict):
        raise ProviderError("invalid_options", "options must be a JSON object")
    known = {
        "model", "modelId", "outputFormat", "requestTimeoutSeconds",
        "stability", "similarityBoost", "style", "useSpeakerBoost", "speed",
        "voiceSettings", "applyTextNormalization",
        "applyLanguageTextNormalization", "seed",
    }
    unknown = sorted(set(options) - known)
    if unknown:
        raise ProviderError(
            "invalid_options",
            f"unsupported ElevenLabs provider option(s): {', '.join(unknown)}",
        )

    voice_settings = options.get("voiceSettings", {})
    if not isinstance(voice_settings, dict):
        raise ProviderError("invalid_options", "voiceSettings must be an object")
    voice_settings = dict(voice_settings)
    aliases = {
        "stability": "stability",
        "similarityBoost": "similarity_boost",
        "style": "style",
        "useSpeakerBoost": "use_speaker_boost",
        "speed": "speed",
    }
    for source, destination in aliases.items():
        if source in options:
            voice_settings[destination] = options[source]
    for key in ("stability", "similarity_boost", "style"):
        if key in voice_settings:
            voice_settings[key] = _number(voice_settings[key], key, 0.0, 1.0)
    if "speed" in voice_settings:
        voice_settings["speed"] = _number(voice_settings["speed"], "speed", 0.7, 1.2)
    if "use_speaker_boost" in voice_settings \
            and not isinstance(voice_settings["use_speaker_boost"], bool):
        raise ProviderError("invalid_options", "useSpeakerBoost must be a boolean")

    payload: dict[str, Any] = {
        "text": request.get("text"),
        "model_id": options.get("model", options.get("modelId", DEFAULT_MODEL)),
    }
    if not isinstance(payload["text"], str) or not payload["text"].strip():
        raise ProviderError("invalid_request", "synthesis text must be a non-empty string")
    if not isinstance(payload["model_id"], str) or not payload["model_id"]:
        raise ProviderError("invalid_options", "model must be a non-empty string")
    if voice_settings:
        payload["voice_settings"] = voice_settings
    language = request.get("language")
    if language is not None:
        if not isinstance(language, str) or not language.strip():
            raise ProviderError("invalid_request", "language must be a language-code string")
        payload["language_code"] = language.strip()
    if "applyTextNormalization" in options:
        payload["apply_text_normalization"] = options["applyTextNormalization"]
    if "applyLanguageTextNormalization" in options:
        payload["apply_language_text_normalization"] = options["applyLanguageTextNormalization"]
    if "seed" in options:
        payload["seed"] = options["seed"]

    output_format = options.get("outputFormat", DEFAULT_OUTPUT_FORMAT)
    if not isinstance(output_format, str) or not output_format:
        raise ProviderError("invalid_options", "outputFormat must be a non-empty string")
    timeout = options.get("requestTimeoutSeconds", DEFAULT_TIMEOUT)
    timeout = _number(timeout, "requestTimeoutSeconds", 1.0, 300.0)
    speaker = request.get("speaker")
    if not isinstance(speaker, str) or not speaker.strip():
        raise ProviderError("invalid_request", "speaker must be an ElevenLabs voice ID")
    voice_id = urllib.parse.quote(speaker.strip(), safe="")
    query = urllib.parse.urlencode({"output_format": output_format})
    return f"/v1/text-to-speech/{voice_id}?{query}", payload, timeout


def convert_to_wav(source: Path, output: Path, timeout: float = 60.0) -> None:
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp.wav")
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(source),
                "-ac", "1", "-c:a", "pcm_s16le", str(temporary),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            shell=False,
        )
        if result.returncode != 0:
            raise ProviderError(
                "audio_conversion_failed",
                "ffmpeg could not convert the ElevenLabs response to WAV",
            )
        with wave.open(str(temporary), "rb") as audio:
            if audio.getnframes() < 1:
                raise ProviderError(
                    "audio_conversion_failed", "converted ElevenLabs WAV is empty")
        temporary.replace(output)
    except FileNotFoundError as exc:
        raise ProviderError(
            "missing_dependency", "ffmpeg is required by the ElevenLabs provider") from exc
    except subprocess.TimeoutExpired as exc:
        raise ProviderError(
            "audio_conversion_failed", "ffmpeg conversion timed out") from exc
    finally:
        temporary.unlink(missing_ok=True)


def validate_output(value: Any) -> Path:
    if not isinstance(value, str):
        raise ProviderError("invalid_output", "output must be an absolute path")
    output = Path(value)
    if not output.is_absolute():
        raise ProviderError("invalid_output", "output must be an absolute path")
    if not output.parent.is_dir():
        raise ProviderError("invalid_output", "output directory does not exist")
    if os.path.lexists(output) and output.is_symlink():
        raise ProviderError("invalid_output", "output must not be a symlink")
    if output.exists() and not output.is_file():
        raise ProviderError("invalid_output", "output must be a regular file path")
    output.unlink(missing_ok=True)
    return output


def synthesize(request: dict) -> dict:
    output = validate_output(request.get("output"))
    path, payload, timeout = build_request(request)
    audio, metadata = download_speech(path, api_key(), payload, timeout)
    source_path = None
    try:
        with tempfile.NamedTemporaryFile(
                dir=output.parent, prefix=".elevenlabs-", suffix=".audio",
                delete=False) as source:
            source.write(audio)
            source_path = Path(source.name)
        convert_to_wav(source_path, output)
    finally:
        if source_path is not None:
            source_path.unlink(missing_ok=True)
    if metadata.get("characterCost"):
        log(f"generated {metadata['characterCost']} billable characters")
    return {"id": request.get("id"), "ok": True, "output": str(output)}


def list_voices() -> list[dict]:
    key = api_key()
    voices = []
    token = None
    while True:
        query = {"page_size": "100", "include_total_count": "false"}
        if token:
            query["next_page_token"] = token
        data = request_json(
            "/v2/voices?" + urllib.parse.urlencode(query),
            key,
            DEFAULT_TIMEOUT,
        )
        entries = data.get("voices")
        if not isinstance(entries, list):
            raise ProviderError("invalid_response", "ElevenLabs returned an invalid voice list")
        for item in entries:
            if isinstance(item, dict) and isinstance(item.get("voice_id"), str):
                voices.append({
                    "id": item["voice_id"],
                    "name": item.get("name") if isinstance(item.get("name"), str)
                    else item["voice_id"],
                })
        if not data.get("has_more"):
            return voices
        token = data.get("next_page_token")
        if not isinstance(token, str) or not token:
            raise ProviderError(
                "invalid_response", "ElevenLabs voice pagination omitted next_page_token")


def handle(request: dict) -> dict:
    operation = request.get("operation")
    if operation == "hello":
        if request.get("protocol") != PROTOCOL:
            raise ProviderError(
                "unsupported_protocol",
                f"expected {PROTOCOL}",
            )
        return {
            "ok": True,
            "protocol": PROTOCOL,
            "provider": PROVIDER,
            "providerVersion": PROVIDER_VERSION,
        }
    if operation == "synthesize":
        return synthesize(request)
    if operation == "listVoices":
        return {"ok": True, "voices": list_voices()}
    raise ProviderError("unsupported_operation", f"unsupported operation: {operation!r}")


def main() -> int:
    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ProviderError("invalid_request", "request must be a JSON object")
            request_id = request.get("id")
            send(handle(request))
        except json.JSONDecodeError:
            send({
                "id": request_id,
                "ok": False,
                "error": {"code": "invalid_json", "message": "request is not valid JSON"},
            })
        except ProviderError as exc:
            log(f"{exc.code}: {exc.message}")
            send({
                "id": request_id,
                "ok": False,
                "error": {"code": exc.code, "message": exc.message},
            })
        except Exception as exc:
            log(f"internal_error: {type(exc).__name__}")
            send({
                "id": request_id,
                "ok": False,
                "error": {
                    "code": "internal_error",
                    "message": "unexpected ElevenLabs provider failure",
                },
            })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
