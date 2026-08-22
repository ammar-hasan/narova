#!/usr/bin/env python3
"""Google Veo video-generation worker for narova-video-provider/v1.

Vendor submission, authentication, and content download stay in this companion.
stdout is reserved for JSONL protocol responses.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


PROTOCOL = "narova-video-provider/v1"
PROVIDER = "veo"
PROVIDER_VERSION = "1.0.0"
API_BASE = "https://generativelanguage.googleapis.com"
API_VERSION = "v1beta"
DEFAULT_MODEL = "veo-3.1-generate-001"
DEFAULT_DURATION = 8
DEFAULT_TIMEOUT = 300.0
MAX_PROMPT_LENGTH = 32000
MAX_VIDEO_BYTES = 1024 * 1024 * 1024
MAX_RESPONSE_BYTES = (MAX_VIDEO_BYTES + 1) * 2
SUPPORTED_MODELS = {
    "veo-3.1-generate-001",
    "veo-3.1-fast-generate-preview",
    "veo-3.1-lite-generate-preview",
}
SUPPORTED_DURATIONS = {4, 6, 8}
SUPPORTED_RATIOS = {"16:9", "9:16", "1:1", "4:3", "3:4"}


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str) -> None:
    print(f"[veo] {message}", file=sys.stderr, flush=True)


def send(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=False), flush=True)


def api_key() -> str:
    value = os.environ.get("GEMINI_API_KEY")
    if not value:
        raise ProviderError("missing_environment", "GEMINI_API_KEY is not set in the Narova process environment")
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
        code, message = "authentication_failed", "Google authentication or Veo model access was rejected"
    elif exc.code == 429:
        code, message = "rate_limited", "Google rate limit or project quota was exceeded"
    elif 400 <= exc.code < 500:
        code, message = "invalid_request", f"Google rejected the video request (HTTP {exc.code})"
    else:
        code, message = "service_error", f"Google video service failed (HTTP {exc.code})"
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
        raise ProviderError("network_error", f"Google network request failed: {type(reason).__name__}") from exc


def _number(value: Any, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProviderError("invalid_options", f"provider option {name} must be a number")
    number = float(value)
    if not minimum <= number <= maximum:
        raise ProviderError("invalid_options", f"provider option {name} must be from {minimum} to {maximum}")
    return number


def build_request(request: dict) -> tuple[dict, float, dict]:
    prompt = request.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ProviderError("invalid_request", "generation prompt must be a non-empty string")
    prompt = prompt.strip()
    if len(prompt) > MAX_PROMPT_LENGTH:
        raise ProviderError("invalid_request", f"generation prompt must be at most {MAX_PROMPT_LENGTH} characters")
    options = request.get("options", {})
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise ProviderError("invalid_options", "options must be a JSON object")
    unknown = sorted(set(options) - {"model", "durationSeconds", "aspectRatio", "seed", "requestTimeoutSeconds"})
    if unknown:
        raise ProviderError("invalid_options", f"unsupported Veo provider option(s): {', '.join(unknown)}")

    model = options.get("model", DEFAULT_MODEL)
    if not isinstance(model, str) or not model.strip():
        raise ProviderError("invalid_options", "Veo model must be a non-empty string")
    model = model.strip()
    if model not in SUPPORTED_MODELS:
        raise ProviderError("invalid_options", f"unsupported Veo model {model!r}; supported models: " + ", ".join(sorted(SUPPORTED_MODELS)))

    duration = options.get("durationSeconds", DEFAULT_DURATION)
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or int(duration) != duration or int(duration) not in SUPPORTED_DURATIONS:
        raise ProviderError("invalid_options", "Veo durationSeconds must be 4, 6, or 8")
    duration = int(duration)

    aspect_ratio = options.get("aspectRatio")
    if aspect_ratio is not None:
        if not isinstance(aspect_ratio, str) or aspect_ratio not in SUPPORTED_RATIOS:
            raise ProviderError("invalid_options", f"Veo aspectRatio must be one of {', '.join(sorted(SUPPORTED_RATIOS))}")

    timeout = _number(options.get("requestTimeoutSeconds", DEFAULT_TIMEOUT), "requestTimeoutSeconds", 1, 1200)

    text = prompt
    if aspect_ratio:
        text = f"Generate a {aspect_ratio} aspect ratio video.\n{text}"

    payload: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["VIDEO"],
            "responseMimeType": "video/mp4",
            "durationSeconds": duration,
        },
    }

    params: dict[str, Any] = {"model": model, "durationSeconds": duration}
    if aspect_ratio:
        params["aspectRatio"] = aspect_ratio
    if "seed" in options:
        seed = options["seed"]
        if isinstance(seed, bool) or not isinstance(seed, (int, float)) or float(seed) != int(seed):
            raise ProviderError("invalid_options", "Veo seed must be an integer")
        seed = int(_number(seed, "seed", 0, 2_147_483_647))
        params["seed"] = seed
        payload["generationConfig"]["seed"] = seed

    return payload, timeout, params


def _api_url(model: str) -> str:
    return f"{API_BASE}/{API_VERSION}/models/{model}:generateContent"


def _read_bounded(response, limit: int) -> bytes:
    chunks = []
    total = 0
    while True:
        chunk = response.read(1024 * 1024)
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


def generate_video(key: str, model: str, payload: dict, timeout: float) -> tuple[bytes, dict]:
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
        raise ProviderError("invalid_response", "Google returned no video parts")

    video: bytes | None = None
    mime_type: str | None = None
    for part in parts:
        if not isinstance(part, dict):
            continue
        inline_data = part.get("inlineData")
        if isinstance(inline_data, dict):
            data = inline_data.get("data")
            if isinstance(data, str):
                video = base64.b64decode(data)
                mime_type = inline_data.get("mimeType")
                break

    if video is None:
        raise ProviderError("invalid_response", "Google returned no inline video data")
    if len(video) > MAX_VIDEO_BYTES:
        raise ProviderError(
            "invalid_response",
            f"Google video exceeded the {MAX_VIDEO_BYTES} byte safety limit",
        )

    metadata: dict[str, Any] = {}
    if mime_type:
        metadata["mimeType"] = mime_type
    return video, metadata


def validate_output(value: Any) -> Path:
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ProviderError("invalid_output", "output must be an absolute path")
    output = Path(value)
    if not output.parent.is_dir():
        raise ProviderError("invalid_output", "output directory does not exist")
    if os.path.lexists(output) and output.is_symlink():
        raise ProviderError("invalid_output", "output must not be a symlink")
    if output.exists() and not output.is_file():
        raise ProviderError("invalid_output", "output must be a regular file path")
    output.unlink(missing_ok=True)
    return output


def write_video(video: bytes, output: Path) -> None:
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".veo-", suffix=".mp4", delete=False) as destination:
            temporary = Path(destination.name)
            destination.write(video)
        if temporary.stat().st_size == 0:
            raise ProviderError("invalid_response", "Google returned an empty video")
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def generate(request: dict) -> dict:
    output = validate_output(request.get("output"))
    payload, timeout, params = build_request(request)
    key = api_key()
    model = params["model"]
    video, metadata = generate_video(key, model, payload, timeout)
    write_video(video, output)
    return {"id": request.get("id"), "ok": True, "output": str(output), "metadata": {
        "model": model,
        "params": params,
    }}


def handle(request: dict) -> dict:
    operation = request.get("operation")
    if operation == "hello":
        if request.get("protocol") != PROTOCOL:
            raise ProviderError("unsupported_protocol", f"expected {PROTOCOL}")
        return {"ok": True, "protocol": PROTOCOL, "provider": PROVIDER, "providerVersion": PROVIDER_VERSION}
    if operation == "generate":
        return generate(request)
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
            send({"id": request_id, "ok": False, "error": {"code": "invalid_json", "message": "request is not valid JSON"}})
        except ProviderError as exc:
            log(redact(f"{exc.code}: {exc.message}"))
            send({"id": request_id, "ok": False, "error": {"code": exc.code, "message": exc.message}})
        except Exception as exc:
            log(f"internal_error: {type(exc).__name__}")
            send({"id": request_id, "ok": False, "error": {"code": "internal_error", "message": "unexpected Google Veo provider failure"}})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
