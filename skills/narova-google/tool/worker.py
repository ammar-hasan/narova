#!/usr/bin/env python3
"""Google Gemini TTS worker for narova-tts-provider/v1.

All Google API-specific endpoints, authentication, models, voices, and option
mapping live here, outside the main Narova skill. stdout is reserved for JSONL
protocol responses; diagnostics go to stderr.
"""
from __future__ import annotations

import base64
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
PROVIDER = "google"
PROVIDER_VERSION = "1.0.0"
API_BASE = "https://generativelanguage.googleapis.com"
API_VERSION = "v1beta"
DEFAULT_MODEL = "gemini-3.1-flash-tts-preview"
DEFAULT_TIMEOUT = 60.0
MAX_TEXT_LENGTH = 4096
MAX_INSTRUCTIONS_LENGTH = 4096
MAX_RESPONSE_BYTES = 64 * 1024 * 1024
SUPPORTED_MODELS = {
    "gemini-3.1-flash-tts-preview",
}
BUILTIN_VOICES = (
    ("Kore", "Kore"),
    ("Puck", "Puck"),
    ("Zephyr", "Zephyr"),
    ("Charon", "Charon"),
    ("Fenrir", "Fenrir"),
    ("Leda", "Leda"),
    ("Orus", "Orus"),
    ("Aoede", "Aoede"),
)


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str) -> None:
    print(f"[google] {message}", file=sys.stderr, flush=True)


def send(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=False), flush=True)


def api_key() -> str:
    value = os.environ.get("GEMINI_API_KEY")
    if not value:
        raise ProviderError(
            "missing_environment",
            "GEMINI_API_KEY is not set in the Narova process environment",
        )
    return value


def redact(text: str) -> str:
    secret = os.environ.get("GEMINI_API_KEY")
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
        message = "Google authentication or model/voice permission was rejected"
    elif exc.code == 429:
        code = "rate_limited"
        message = "Google rate limit or project quota was exceeded"
    elif 400 <= exc.code < 500:
        code = "invalid_request"
        message = f"Google rejected the speech request (HTTP {exc.code})"
    else:
        code = "service_error"
        message = f"Google speech service failed (HTTP {exc.code})"
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
            f"Google network request failed: {type(reason).__name__}",
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


def _voice(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProviderError(
            "invalid_request",
            "speaker must be a Google voice name",
        )
    return value.strip()


def build_request(request: dict) -> tuple[dict, float]:
    options = request.get("options", {})
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise ProviderError("invalid_options", "options must be a JSON object")
    known = {"model", "modelId", "instructions", "style", "requestTimeoutSeconds"}
    unknown = sorted(set(options) - known)
    if unknown:
        raise ProviderError(
            "invalid_options",
            f"unsupported Google provider option(s): {', '.join(unknown)}",
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
            f"unsupported Google speech model {model!r}; supported models: "
            + ", ".join(sorted(SUPPORTED_MODELS)),
        )

    instructions = options.get("instructions") or options.get("style")
    if instructions is not None:
        instructions = _text(instructions, "instructions", MAX_INSTRUCTIONS_LENGTH)

    voice = _voice(request.get("speaker"))

    language = request.get("language")
    if language is not None:
        if not isinstance(language, str) or not language.strip():
            raise ProviderError("invalid_request", "language must be a language-code string")
        language = language.strip()

    text = input_text
    if instructions:
        text = f"[{instructions}]\n{text}"

    payload: dict[str, Any] = {
        "contents": [
            {"role": "user", "parts": [{"text": text}]}
        ],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {"voiceName": voice}
                }
            },
        },
    }
    if language:
        payload["generationConfig"]["speechConfig"]["languageCode"] = language

    timeout = options.get("requestTimeoutSeconds", DEFAULT_TIMEOUT)
    timeout = _number(timeout, "requestTimeoutSeconds", 1.0, 300.0)
    return payload, timeout


def _api_url(model: str) -> str:
    return f"{API_BASE}/{API_VERSION}/models/{model}:generateContent"


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
                f"Google response exceeded the {limit} byte safety limit",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def download_speech(key: str, model: str, payload: dict, timeout: float) -> tuple[bytes, dict]:
    request = urllib.request.Request(
        _api_url(model),
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-goog-api-key": key,
        },
        method="POST",
    )
    with _open(request, timeout) as response:
        body = _read_bounded(response, MAX_RESPONSE_BYTES)
    if not body:
        raise ProviderError("invalid_response", "Google returned an empty response")
    try:
        value = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ProviderError("invalid_response", "Google returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise ProviderError("invalid_response", "Google returned invalid response structure")

    candidates = value.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise ProviderError("invalid_response", "Google returned no candidates")
    candidate = candidates[0]
    if not isinstance(candidate, dict):
        raise ProviderError("invalid_response", "Google returned invalid candidate")
    content = candidate.get("content")
    if not isinstance(content, dict):
        raise ProviderError("invalid_response", "Google returned no content")
    parts = content.get("parts")
    if not isinstance(parts, list) or not parts:
        raise ProviderError("invalid_response", "Google returned no audio parts")

    audio: bytes | None = None
    mime_type: str | None = None
    for part in parts:
        if not isinstance(part, dict):
            continue
        inline_data = part.get("inlineData")
        if isinstance(inline_data, dict):
            data = inline_data.get("data")
            if isinstance(data, str):
                audio = base64.b64decode(data)
                mime_type = inline_data.get("mimeType")
                break

    if audio is None:
        raise ProviderError("invalid_response", "Google returned no inline audio data")

    metadata: dict[str, Any] = {}
    if mime_type:
        metadata["mimeType"] = mime_type
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


def _pcm_to_wav(audio: bytes, mime_type: str | None) -> bytes:
    sample_rate = 24000
    if mime_type:
        match = re.search(r"rate=(\d+)", mime_type)
        if match:
            sample_rate = max(8000, min(int(match.group(1)), 192000))
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(audio)
    return buffer.getvalue()


def write_wav(audio: bytes, mime_type: str | None, output: Path) -> None:
    if not audio.startswith(b"RIFF"):
        if len(audio) < 2 or len(audio) % 2 != 0:
            raise ProviderError(
                "invalid_response",
                "Google returned raw PCM with a truncated final sample",
            )
        audio = _pcm_to_wav(audio, mime_type)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
                dir=output.parent, prefix=".google-", suffix=".wav",
                delete=False) as destination:
            destination.write(audio)
            temporary = Path(destination.name)
        try:
            with wave.open(str(temporary), "rb") as source:
                if (source.getnchannels() != 1 or source.getsampwidth() != 2
                        or source.getnframes() < 1):
                    raise ProviderError(
                        "invalid_response",
                        "Google returned audio that is not non-empty mono 16-bit PCM",
                    )
        except (EOFError, wave.Error) as exc:
            raise ProviderError("invalid_response", "Google returned an invalid WAV") from exc
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def synthesize(request: dict) -> dict:
    output = validate_output(request.get("output"))
    payload, timeout = build_request(request)
    options = request.get("options", {})
    if not isinstance(options, dict):
        options = {}
    model = options.get("model", options.get("modelId", DEFAULT_MODEL))
    audio, metadata = download_speech(api_key(), model, payload, timeout)
    write_wav(audio, metadata.get("mimeType"), output)
    if metadata.get("mimeType"):
        log(f"generated speech with mime type {metadata['mimeType']}")
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
                    "message": "unexpected Google provider failure",
                },
            })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
