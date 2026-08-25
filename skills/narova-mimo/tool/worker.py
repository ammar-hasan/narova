#!/usr/bin/env python3
"""Xiaomi MiMo TTS worker for narova-tts-provider/v1.

All Xiaomi MiMo API-specific endpoints, authentication, models, voices, and
option mapping live here, outside the main Narova skill. stdout is reserved
for JSONL protocol responses; diagnostics go to stderr.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
import wave
from pathlib import Path
from typing import Any


PROTOCOL = "narova-tts-provider/v1"
PROVIDER = "mimo"
PROVIDER_VERSION = "1.0.0"
API_BASES = {
    "pay-as-you-go": "https://api.xiaomimimo.com/v1",
    "token-plan-cn": "https://token-plan-cn.xiaomimimo.com/v1",
    "token-plan-sgp": "https://token-plan-sgp.xiaomimimo.com/v1",
    "token-plan-ams": "https://token-plan-ams.xiaomimimo.com/v1",
}
DEFAULT_ENDPOINT = "pay-as-you-go"
DEFAULT_MODEL = "mimo-v2.5-tts"
MODEL_VOICEDESIGN = "mimo-v2.5-tts-voicedesign"
MODEL_VOICECLONE = "mimo-v2.5-tts-voiceclone"
DEFAULT_TIMEOUT = 120.0
MAX_TEXT_LENGTH = 8000
MAX_INSTRUCTIONS_LENGTH = 2000
MAX_DESIGN_LENGTH = 2000
MAX_REFERENCE_BASE64 = 10 * 1024 * 1024
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
SUPPORTED_MODELS = {
    DEFAULT_MODEL,
    MODEL_VOICEDESIGN,
    MODEL_VOICECLONE,
}
PRESET_VOICES = (
    ("mimo_default", "MiMo default (cluster-dependent; pin an explicit voice for reproducible work)"),
    ("冰糖", "冰糖 (Chinese, female)"),
    ("茉莉", "茉莉 (Chinese, female)"),
    ("苏打", "苏打 (Chinese, male)"),
    ("白桦", "白桦 (Chinese, male)"),
    ("Mia", "Mia (English, female)"),
    ("Chloe", "Chloe (English, female)"),
    ("Milo", "Milo (English, male)"),
    ("Dean", "Dean (English, male)"),
)
REFERENCE_MIME = {".mp3": "audio/mpeg", ".wav": "audio/wav"}


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str) -> None:
    print(f"[mimo] {message}", file=sys.stderr, flush=True)


def send(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=False), flush=True)


def api_key() -> str:
    value = os.environ.get("MIMO_API_KEY")
    if not value:
        raise ProviderError(
            "missing_environment",
            "MIMO_API_KEY is not set in the Narova process environment",
        )
    return value


def redact(text: str) -> str:
    secret = os.environ.get("MIMO_API_KEY")
    if secret and text:
        return text.replace(secret, "[redacted]")
    return text


def _safe_error_detail(body: bytes) -> str:
    try:
        value = json.loads(body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return ""
    if isinstance(value, dict):
        error = value.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"][:500]
        message = value.get("message")
        if isinstance(message, str):
            return message[:500]
    return ""


def _http_error(exc: urllib.error.HTTPError) -> ProviderError:
    try:
        detail = _safe_error_detail(exc.read(64 * 1024))
    except Exception:
        detail = ""
    detail = redact(detail)
    if exc.code in {401, 403}:
        code = "authentication_failed"
        message = "Xiaomi MiMo authentication or model permission was rejected"
    elif exc.code == 429:
        code = "rate_limited"
        message = "Xiaomi MiMo rate limit or account quota was exceeded"
    elif 400 <= exc.code < 500:
        code = "invalid_request"
        message = f"Xiaomi MiMo rejected the speech request (HTTP {exc.code})"
    else:
        code = "service_error"
        message = f"Xiaomi MiMo speech service failed (HTTP {exc.code})"
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
            f"Xiaomi MiMo network request failed: {type(reason).__name__}",
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


def _base_url(options: dict) -> str:
    override = os.environ.get("MIMO_BASE_URL")
    if override:
        override = override.strip()
        if not override.startswith("https://"):
            raise ProviderError(
                "invalid_options",
                "MIMO_BASE_URL must be an https URL",
            )
        return override.rstrip("/")
    endpoint = options.get("endpoint", DEFAULT_ENDPOINT)
    if not isinstance(endpoint, str) or endpoint not in API_BASES:
        raise ProviderError(
            "invalid_options",
            f"endpoint must be one of: {', '.join(sorted(API_BASES))}",
        )
    return API_BASES[endpoint]


def _clone_reference(speaker: Any, options: dict) -> str:
    if not isinstance(speaker, str) or not speaker.strip():
        raise ProviderError(
            "invalid_request",
            "speaker must be an absolute path to a local .mp3 or .wav reference file "
            "for voice cloning",
        )
    reference = Path(speaker.strip())
    if not reference.is_absolute():
        raise ProviderError(
            "invalid_request",
            "speaker must be an absolute path to a local .mp3 or .wav reference file "
            "for voice cloning",
        )
    mime = REFERENCE_MIME.get(reference.suffix.lower())
    if mime is None:
        raise ProviderError(
            "invalid_request",
            "voice cloning reference must be a .mp3 or .wav file",
        )
    if not reference.is_file():
        raise ProviderError(
            "invalid_request",
            "voice cloning reference file does not exist",
        )
    data = reference.read_bytes()
    digest = options.get("referenceDigest")
    if digest is not None:
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ProviderError(
                "invalid_options",
                "provider option referenceDigest must be 64 lowercase hex characters",
            )
        if hashlib.sha256(data).hexdigest() != digest:
            raise ProviderError(
                "invalid_request",
                "voice cloning reference does not match referenceDigest",
            )
    encoded = base64.b64encode(data).decode("ascii")
    if len(encoded) > MAX_REFERENCE_BASE64:
        raise ProviderError(
            "invalid_request",
            "voice cloning reference exceeds the 10 MB base64 limit",
        )
    return f"data:{mime};base64,{encoded}"


def build_request(request: dict) -> tuple[str, dict, float]:
    options = request.get("options", {})
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise ProviderError("invalid_options", "options must be a JSON object")
    known = {
        "model", "modelId", "endpoint", "instructions", "style", "design",
        "referenceDigest", "requestTimeoutSeconds",
    }
    unknown = sorted(set(options) - known)
    if unknown:
        raise ProviderError(
            "invalid_options",
            f"unsupported Xiaomi MiMo provider option(s): {', '.join(unknown)}",
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
            f"unsupported Xiaomi MiMo speech model {model!r}; supported models: "
            + ", ".join(sorted(SUPPORTED_MODELS)),
        )

    speaker = request.get("speaker")
    audio: dict[str, Any] = {"format": "wav"}
    if model == MODEL_VOICEDESIGN:
        if options.get("instructions") is not None or options.get("style") is not None:
            raise ProviderError(
                "invalid_options",
                "instructions/style are not supported for mimo-v2.5-tts-voicedesign; "
                "put direction in the design brief or inline tags in the spoken text",
            )
        direction = _text(options.get("design"), "design", MAX_DESIGN_LENGTH)
        if speaker is not None and (not isinstance(speaker, str) or not speaker.strip()):
            raise ProviderError(
                "invalid_request",
                "speaker must be a non-empty string when provided",
            )
    elif model == MODEL_VOICECLONE:
        instructions = options.get("instructions") or options.get("style")
        direction = ""
        if instructions is not None:
            direction = _text(instructions, "instructions", MAX_INSTRUCTIONS_LENGTH)
        audio["voice"] = _clone_reference(speaker, options)
    else:
        if not isinstance(speaker, str) or not speaker.strip():
            raise ProviderError(
                "invalid_request",
                "speaker must be a Xiaomi MiMo preset voice ID",
            )
        instructions = options.get("instructions") or options.get("style")
        direction = ""
        if instructions is not None:
            direction = _text(instructions, "instructions", MAX_INSTRUCTIONS_LENGTH)
        audio["voice"] = speaker.strip()

    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "user", "content": direction},
            {"role": "assistant", "content": input_text},
        ],
        "audio": audio,
    }

    timeout = options.get("requestTimeoutSeconds", DEFAULT_TIMEOUT)
    timeout = _number(timeout, "requestTimeoutSeconds", 1.0, 600.0)
    return _base_url(options), payload, timeout


def _read_bounded(response, limit: int) -> bytes:
    chunks = []
    total = 0
    while True:
        chunk = response.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise ProviderError(
                "invalid_response",
                f"Xiaomi MiMo response exceeded the {limit} byte safety limit",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def download_speech(key: str, base_url: str, payload: dict, timeout: float) -> bytes:
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "api-key": key,
        },
        method="POST",
    )
    with _open(request, timeout) as response:
        body = _read_bounded(response, MAX_RESPONSE_BYTES)
    if not body:
        raise ProviderError("invalid_response", "Xiaomi MiMo returned an empty response")
    try:
        value = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ProviderError("invalid_response", "Xiaomi MiMo returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise ProviderError("invalid_response", "Xiaomi MiMo returned invalid response structure")

    choices = value.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ProviderError("invalid_response", "Xiaomi MiMo returned no choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ProviderError("invalid_response", "Xiaomi MiMo returned no message")
    audio = message.get("audio")
    if not isinstance(audio, dict) or not isinstance(audio.get("data"), str):
        raise ProviderError("invalid_response", "Xiaomi MiMo returned no audio data")
    try:
        return base64.b64decode(audio["data"])
    except ValueError as exc:
        raise ProviderError(
            "invalid_response", "Xiaomi MiMo returned undecodable audio data",
        ) from exc


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


def _pcm_to_wav(audio: bytes) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes(audio)
    return buffer.getvalue()


def write_wav(audio: bytes, output: Path) -> None:
    if not audio.startswith(b"RIFF"):
        if len(audio) < 2 or len(audio) % 2 != 0:
            raise ProviderError(
                "invalid_response",
                "Xiaomi MiMo returned raw PCM with a truncated final sample",
            )
        audio = _pcm_to_wav(audio)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
                dir=output.parent, prefix=".mimo-", suffix=".wav",
                delete=False) as destination:
            destination.write(audio)
            temporary = Path(destination.name)
        try:
            with wave.open(str(temporary), "rb") as source:
                if (source.getnchannels() != 1 or source.getsampwidth() != 2
                        or source.getnframes() < 1):
                    raise ProviderError(
                        "invalid_response",
                        "Xiaomi MiMo returned audio that is not non-empty mono 16-bit PCM",
                    )
        except (EOFError, wave.Error) as exc:
            raise ProviderError("invalid_response", "Xiaomi MiMo returned an invalid WAV") from exc
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def synthesize(request: dict) -> dict:
    output = validate_output(request.get("output"))
    base_url, payload, timeout = build_request(request)
    audio = download_speech(api_key(), base_url, payload, timeout)
    write_wav(audio, output)
    return {"id": request.get("id"), "ok": True, "output": str(output)}


def list_voices() -> list[dict]:
    return [{"id": voice_id, "name": name} for voice_id, name in PRESET_VOICES]


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
            log(redact(f"{exc.code}: {exc.message}"))
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
                    "message": "unexpected Xiaomi MiMo provider failure",
                },
            })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
