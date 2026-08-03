#!/usr/bin/env python3
"""OpenAI worker for narova-tts-provider/v1.

All OpenAI-specific endpoints, authentication, models, voices, and option
mapping live here, outside the main Narova skill. stdout is reserved for JSONL
protocol responses; diagnostics go to stderr.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
import wave
from pathlib import Path
from typing import Any


PROTOCOL = "narova-tts-provider/v1"
PROVIDER = "openai"
PROVIDER_VERSION = "1.0.0"
API_BASE = "https://api.openai.com"
SPEECH_PATH = "/v1/audio/speech"
DEFAULT_MODEL = "gpt-4o-mini-tts"
DEFAULT_TIMEOUT = 60.0
MAX_TEXT_LENGTH = 4096
MAX_INSTRUCTIONS_LENGTH = 4096
SUPPORTED_MODELS = {
    "gpt-4o-mini-tts",
    "gpt-4o-mini-tts-2025-12-15",
    "tts-1",
    "tts-1-hd",
}
LEGACY_MODELS = {"tts-1", "tts-1-hd"}
BUILTIN_VOICES = (
    ("marin", "Marin (recommended)"),
    ("cedar", "Cedar (recommended)"),
    ("alloy", "Alloy"),
    ("ash", "Ash"),
    ("ballad", "Ballad"),
    ("coral", "Coral"),
    ("echo", "Echo"),
    ("fable", "Fable"),
    ("nova", "Nova"),
    ("onyx", "Onyx"),
    ("sage", "Sage"),
    ("shimmer", "Shimmer"),
    ("verse", "Verse"),
)


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str) -> None:
    print(f"[openai] {message}", file=sys.stderr, flush=True)


def send(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=False), flush=True)


def api_key() -> str:
    value = os.environ.get("OPENAI_API_KEY")
    if not value:
        raise ProviderError(
            "missing_environment",
            "OPENAI_API_KEY is not set in the Narova process environment",
        )
    return value


def _safe_error_detail(body: bytes) -> str:
    try:
        value = json.loads(body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return ""
    error = value.get("error") if isinstance(value, dict) else None
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return error["message"][:500]
    return ""


def _http_error(exc: urllib.error.HTTPError) -> ProviderError:
    try:
        detail = _safe_error_detail(exc.read(64 * 1024))
    except Exception:
        detail = ""
    if exc.code in {401, 403}:
        code = "authentication_failed"
        message = "OpenAI authentication or model/voice permission was rejected"
    elif exc.code == 429:
        code = "rate_limited"
        message = "OpenAI rate limit or project quota was exceeded"
    elif 400 <= exc.code < 500:
        code = "invalid_request"
        message = f"OpenAI rejected the speech request (HTTP {exc.code})"
    else:
        code = "service_error"
        message = f"OpenAI speech service failed (HTTP {exc.code})"
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
            f"OpenAI network request failed: {type(reason).__name__}",
        ) from exc


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


def _text(value: Any, name: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProviderError("invalid_options", f"provider option {name} must be a non-empty string")
    value = value.strip()
    if len(value) > maximum:
        raise ProviderError(
            "invalid_options",
            f"provider option {name} must be at most {maximum} characters",
        )
    return value


def _voice(value: Any) -> str | dict[str, str]:
    if not isinstance(value, str) or not value.strip():
        raise ProviderError(
            "invalid_request",
            "speaker must be an OpenAI built-in voice name or custom voice ID",
        )
    value = value.strip()
    if value.startswith("voice_"):
        return {"id": value}
    return value


def build_request(request: dict) -> tuple[dict, float]:
    options = request.get("options") or {}
    if not isinstance(options, dict):
        raise ProviderError("invalid_options", "options must be a JSON object")
    known = {"model", "modelId", "instructions", "speed", "requestTimeoutSeconds"}
    unknown = sorted(set(options) - known)
    if unknown:
        raise ProviderError(
            "invalid_options",
            f"unsupported OpenAI provider option(s): {', '.join(unknown)}",
        )

    input_text = request.get("text")
    if not isinstance(input_text, str) or not input_text.strip():
        raise ProviderError("invalid_request", "synthesis text must be a non-empty string")
    if len(input_text) > MAX_TEXT_LENGTH:
        raise ProviderError(
            "invalid_request",
            f"synthesis text must be at most {MAX_TEXT_LENGTH} characters",
        )

    model = options.get("model", options.get("modelId", DEFAULT_MODEL))
    if not isinstance(model, str) or not model.strip():
        raise ProviderError("invalid_options", "model must be a non-empty string")
    model = model.strip()
    if model not in SUPPORTED_MODELS:
        raise ProviderError(
            "invalid_options",
            f"unsupported OpenAI speech model {model!r}; supported models: "
            + ", ".join(sorted(SUPPORTED_MODELS)),
        )

    instructions = options.get("instructions")
    if instructions is not None:
        instructions = _text(instructions, "instructions", MAX_INSTRUCTIONS_LENGTH)

    language = request.get("language")
    if language is not None:
        if not isinstance(language, str) or not language.strip():
            raise ProviderError("invalid_request", "language must be a language-code string")
        language = language.strip()
        if model not in LEGACY_MODELS:
            language_instruction = f'Speak the supplied text in the language indicated by BCP 47 tag "{language}".'
            instructions = (
                f"{language_instruction}\n{instructions}" if instructions
                else language_instruction
            )
            if len(instructions) > MAX_INSTRUCTIONS_LENGTH:
                raise ProviderError(
                    "invalid_options",
                    f"combined language guidance and instructions must be at most {MAX_INSTRUCTIONS_LENGTH} characters",
                )

    if instructions and model in LEGACY_MODELS:
        raise ProviderError(
            "invalid_options",
            f"instructions are not supported by OpenAI model {model}",
        )

    payload: dict[str, Any] = {
        "model": model,
        "voice": _voice(request.get("speaker")),
        "input": input_text,
        "response_format": "wav",
    }
    if instructions:
        payload["instructions"] = instructions
    if "speed" in options:
        payload["speed"] = _number(options["speed"], "speed", 0.25, 4.0)

    timeout = options.get("requestTimeoutSeconds", DEFAULT_TIMEOUT)
    timeout = _number(timeout, "requestTimeoutSeconds", 1.0, 300.0)
    return payload, timeout


def download_speech(key: str, payload: dict, timeout: float) -> tuple[bytes, dict]:
    request = urllib.request.Request(
        API_BASE + SPEECH_PATH,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "Accept": "audio/wav",
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with _open(request, timeout) as response:
        audio = response.read()
        metadata = {"requestId": response.headers.get("x-request-id")}
    if not audio:
        raise ProviderError("invalid_response", "OpenAI returned an empty audio response")
    return audio, metadata


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


def write_wav(audio: bytes, output: Path) -> None:
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
                dir=output.parent, prefix=".openai-", suffix=".wav",
                delete=False) as destination:
            destination.write(audio)
            temporary = Path(destination.name)
        try:
            with wave.open(str(temporary), "rb") as source:
                if source.getnchannels() < 1 or source.getnframes() < 1:
                    raise ProviderError("invalid_response", "OpenAI returned an empty WAV")
        except (EOFError, wave.Error) as exc:
            raise ProviderError("invalid_response", "OpenAI returned an invalid WAV") from exc
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def synthesize(request: dict) -> dict:
    output = validate_output(request.get("output"))
    payload, timeout = build_request(request)
    audio, metadata = download_speech(api_key(), payload, timeout)
    write_wav(audio, output)
    if metadata.get("requestId"):
        log(f"generated speech request {metadata['requestId']}")
    return {"id": request.get("id"), "ok": True, "output": str(output)}


def list_voices() -> list[dict]:
    return [{"id": voice_id, "name": name} for voice_id, name in BUILTIN_VOICES]


def handle(request: dict) -> dict:
    operation = request.get("operation")
    if operation == "hello":
        if request.get("protocol") != PROTOCOL:
            raise ProviderError("unsupported_protocol", f"expected {PROTOCOL}")
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
                    "message": "unexpected OpenAI provider failure",
                },
            })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
