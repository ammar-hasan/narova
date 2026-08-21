#!/usr/bin/env python3
"""OpenAI Sora worker for narova-video-provider/v1.

Vendor submission, polling, authentication, and content download stay in this
companion. stdout is reserved for JSONL protocol responses.
"""
from __future__ import annotations

import json
import os
import secrets
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


PROTOCOL = "narova-video-provider/v1"
PROVIDER = "sora"
PROVIDER_VERSION = "1.0.0"
API_BASE = "https://api.openai.com"
DEFAULT_MODEL = "sora-2"
DEFAULT_SIZE = "1280x720"
DEFAULT_DURATION = 4
DEFAULT_TIMEOUT = 300.0
POLL_INTERVAL = 3.0
MAX_PROMPT_LENGTH = 32000
MAX_VIDEO_BYTES = 1024 * 1024 * 1024
SUPPORTED_MODELS = {"sora-2", "sora-2-pro"}
SUPPORTED_SIZES = {"720x1280", "1280x720", "1024x1792", "1792x1024"}
SUPPORTED_DURATIONS = {4, 8, 12}


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str) -> None:
    print(f"[sora] {message}", file=sys.stderr, flush=True)


def send(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=False), flush=True)


def api_key() -> str:
    value = os.environ.get("OPENAI_API_KEY")
    if not value:
        raise ProviderError("missing_environment", "OPENAI_API_KEY is not set in the Narova process environment")
    return value


def _safe_detail(body: bytes) -> str:
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
        detail = _safe_detail(exc.read(64 * 1024))
    except Exception:
        detail = ""
    if exc.code in {401, 403}:
        code, message = "authentication_failed", "OpenAI authentication or Sora model access was rejected"
    elif exc.code == 429:
        code, message = "rate_limited", "OpenAI rate limit or project quota was exceeded"
    elif 400 <= exc.code < 500:
        code, message = "invalid_request", f"OpenAI rejected the video request (HTTP {exc.code})"
    else:
        code, message = "service_error", f"OpenAI video service failed (HTTP {exc.code})"
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
        raise ProviderError("network_error", f"OpenAI network request failed: {type(reason).__name__}") from exc


def _number(value: Any, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProviderError("invalid_options", f"provider option {name} must be a number")
    number = float(value)
    if not minimum <= number <= maximum:
        raise ProviderError("invalid_options", f"provider option {name} must be from {minimum} to {maximum}")
    return number


def build_request(request: dict) -> tuple[dict, float]:
    prompt = request.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ProviderError("invalid_request", "generation prompt must be a non-empty string")
    prompt = prompt.strip()
    if len(prompt) > MAX_PROMPT_LENGTH:
        raise ProviderError("invalid_request", f"generation prompt must be at most {MAX_PROMPT_LENGTH} characters")
    options = request.get("options") or {}
    if not isinstance(options, dict):
        raise ProviderError("invalid_options", "options must be a JSON object")
    unknown = sorted(set(options) - {"model", "size", "duration", "requestTimeoutSeconds"})
    if unknown:
        raise ProviderError("invalid_options", f"unsupported Sora provider option(s): {', '.join(unknown)}")
    model = options.get("model", DEFAULT_MODEL)
    size = options.get("size", DEFAULT_SIZE)
    duration = options.get("duration", DEFAULT_DURATION)
    if model not in SUPPORTED_MODELS:
        raise ProviderError("invalid_options", f"unsupported Sora model {model!r}")
    if size not in SUPPORTED_SIZES:
        raise ProviderError("invalid_options", f"unsupported Sora size {size!r}")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or int(duration) != duration or int(duration) not in SUPPORTED_DURATIONS:
        raise ProviderError("invalid_options", "Sora duration must be 4, 8, or 12 seconds")
    timeout = _number(options.get("requestTimeoutSeconds", DEFAULT_TIMEOUT), "requestTimeoutSeconds", 1, 1200)
    return {"model": model, "prompt": prompt, "size": size, "seconds": str(int(duration))}, timeout


def _multipart(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = "narova-" + secrets.token_hex(12)
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            value.encode("utf-8"), b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), boundary


def _read_json(response, label: str) -> dict:
    body = response.read(1024 * 1024 + 1)
    if len(body) > 1024 * 1024:
        raise ProviderError("invalid_response", f"OpenAI returned oversized {label} metadata")
    try:
        value = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ProviderError("invalid_response", f"OpenAI returned invalid {label} metadata") from exc
    if not isinstance(value, dict):
        raise ProviderError("invalid_response", f"OpenAI returned invalid {label} metadata")
    return value


def submit_video(key: str, payload: dict, timeout: float) -> dict:
    body, boundary = _multipart({key: str(value) for key, value in payload.items()})
    request = urllib.request.Request(API_BASE + "/v1/videos", data=body, headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }, method="POST")
    with _open(request, min(timeout, 60.0)) as response:
        return _read_json(response, "video job")


def retrieve_video(key: str, video_id: str, timeout: float) -> dict:
    request = urllib.request.Request(API_BASE + f"/v1/videos/{video_id}", headers={"Authorization": f"Bearer {key}"})
    with _open(request, min(timeout, 60.0)) as response:
        return _read_json(response, "video status")


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


def download_video(key: str, video_id: str, output: Path, timeout: float) -> None:
    request = urllib.request.Request(API_BASE + f"/v1/videos/{video_id}/content", headers={"Authorization": f"Bearer {key}"})
    temporary: Path | None = None
    try:
        with _open(request, min(timeout, 120.0)) as response:
            content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            if content_type and not (content_type.startswith("video/") or content_type in {"application/octet-stream", "application/mp4"}):
                raise ProviderError("invalid_response", f"OpenAI returned unexpected video content type {content_type!r}")
            declared = response.headers.get("content-length")
            if declared and int(declared) > MAX_VIDEO_BYTES:
                raise ProviderError("invalid_response", "OpenAI video exceeds the 1 GiB safety limit")
            total = 0
            with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".sora-", suffix=".mp4", delete=False) as destination:
                temporary = Path(destination.name)
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_VIDEO_BYTES:
                        raise ProviderError("invalid_response", "OpenAI video exceeds the 1 GiB safety limit")
                    destination.write(chunk)
        if total == 0:
            raise ProviderError("invalid_response", "OpenAI returned an empty video")
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def generate(request: dict) -> dict:
    output = validate_output(request.get("output"))
    payload, timeout = build_request(request)
    key = api_key()
    deadline = time.monotonic() + timeout
    job = submit_video(key, payload, timeout)
    video_id = job.get("id")
    if not isinstance(video_id, str) or not video_id:
        raise ProviderError("invalid_response", "OpenAI did not return a video job id")
    while job.get("status") not in {"completed", "failed"}:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ProviderError("timeout", "OpenAI video generation timed out; the remote job may still complete")
        time.sleep(min(POLL_INTERVAL, remaining))
        job = retrieve_video(key, video_id, max(1.0, deadline - time.monotonic()))
    if job.get("status") != "completed":
        detail = job.get("error") if isinstance(job.get("error"), dict) else {}
        message = detail.get("message") if isinstance(detail.get("message"), str) else "OpenAI video generation failed"
        raise ProviderError("generation_failed", message[:500])
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ProviderError("timeout", "OpenAI video generation timed out before download")
    download_video(key, video_id, output, remaining)
    params = {"model": payload["model"], "size": payload["size"], "duration": int(payload["seconds"])}
    return {"id": request.get("id"), "ok": True, "output": str(output), "metadata": {
        "model": payload["model"], "params": params,
        "sourceVideoUrl": API_BASE + f"/v1/videos/{video_id}/content",
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
            log(f"{exc.code}: {exc.message}")
            send({"id": request_id, "ok": False, "error": {"code": exc.code, "message": exc.message}})
        except Exception as exc:
            log(f"internal_error: {type(exc).__name__}")
            send({"id": request_id, "ok": False, "error": {"code": "internal_error", "message": "unexpected OpenAI Sora provider failure"}})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
