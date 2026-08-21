#!/usr/bin/env python3
"""Runway worker for narova-video-provider/v1."""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


PROTOCOL = "narova-video-provider/v1"
PROVIDER = "runway"
PROVIDER_VERSION = "1.0.0"
API_BASE = "https://api.dev.runwayml.com"
API_VERSION = "2024-11-06"
DEFAULT_MODEL = "gen4.5"
DEFAULT_RATIO = "1280:720"
DEFAULT_DURATION = 5
DEFAULT_TIMEOUT = 600.0
POLL_INTERVAL = 5.0
MAX_PROMPT_LENGTH = 1000
MAX_VIDEO_BYTES = 1024 * 1024 * 1024
RATIO_RE = re.compile(r"^[1-9][0-9]{1,4}:[1-9][0-9]{1,4}$")
SIZE_RE = re.compile(r"^[1-9][0-9]{1,4}x[1-9][0-9]{1,4}$")


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str) -> None:
    print(f"[runway] {message}", file=sys.stderr, flush=True)


def send(value: dict) -> None:
    print(json.dumps(value, separators=(",", ":"), ensure_ascii=False), flush=True)


def api_key() -> str:
    value = os.environ.get("RUNWAYML_API_SECRET")
    if not value:
        raise ProviderError("missing_environment", "RUNWAYML_API_SECRET is not set in the Narova process environment")
    return value


def _safe_detail(body: bytes) -> str:
    try:
        value = json.loads(body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError:
        return ""
    if isinstance(value, dict):
        for key in ("error", "message"):
            detail = value.get(key)
            if isinstance(detail, str):
                return detail[:500]
            if isinstance(detail, dict) and isinstance(detail.get("message"), str):
                return detail["message"][:500]
    return ""


def _http_error(exc: urllib.error.HTTPError) -> ProviderError:
    try:
        detail = _safe_detail(exc.read(64 * 1024))
    except Exception:
        detail = ""
    if exc.code in {401, 403}:
        code, message = "authentication_failed", "Runway authentication or model access was rejected"
    elif exc.code == 429:
        code, message = "rate_limited", "Runway rate limit or credit quota was exceeded"
    elif 400 <= exc.code < 500:
        code, message = "invalid_request", f"Runway rejected the video request (HTTP {exc.code})"
    else:
        code, message = "service_error", f"Runway video service failed (HTTP {exc.code})"
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
        raise ProviderError("network_error", f"Runway network request failed: {type(reason).__name__}") from exc


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
    unknown = sorted(set(options) - {"model", "size", "ratio", "duration", "requestTimeoutSeconds"})
    if unknown:
        raise ProviderError("invalid_options", f"unsupported Runway provider option(s): {', '.join(unknown)}")
    if "size" in options and "ratio" in options:
        raise ProviderError("invalid_options", "Runway options size and ratio are mutually exclusive")
    model = options.get("model", DEFAULT_MODEL)
    if not isinstance(model, str) or not model.strip():
        raise ProviderError("invalid_options", "Runway model must be a non-empty string")
    ratio = options.get("ratio")
    if ratio is None:
        size = options.get("size")
        if size is None:
            ratio = DEFAULT_RATIO
        elif not isinstance(size, str) or not SIZE_RE.fullmatch(size):
            raise ProviderError("invalid_options", "Runway size must use WIDTHxHEIGHT")
        else:
            ratio = size.replace("x", ":")
    if not isinstance(ratio, str) or not RATIO_RE.fullmatch(ratio):
        raise ProviderError("invalid_options", "Runway ratio must use WIDTH:HEIGHT")
    duration = options.get("duration", DEFAULT_DURATION)
    duration = _number(duration, "duration", 1, 120)
    if not duration.is_integer():
        raise ProviderError("invalid_options", "Runway duration must be a whole number of seconds")
    timeout = _number(options.get("requestTimeoutSeconds", DEFAULT_TIMEOUT), "requestTimeoutSeconds", 1, 1800)
    return {"model": model.strip(), "promptText": prompt, "ratio": ratio, "duration": int(duration)}, timeout


def _api_request(key: str, path: str, timeout: float, payload: dict | None = None) -> dict:
    body = None if payload is None else json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {"Authorization": f"Bearer {key}", "X-Runway-Version": API_VERSION}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(API_BASE + path, data=body, headers=headers, method="POST" if body is not None else "GET")
    with _open(request, min(timeout, 60.0)) as response:
        raw = response.read(1024 * 1024 + 1)
    if len(raw) > 1024 * 1024:
        raise ProviderError("invalid_response", "Runway returned oversized task metadata")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ProviderError("invalid_response", "Runway returned invalid task metadata") from exc
    if not isinstance(value, dict):
        raise ProviderError("invalid_response", "Runway returned invalid task metadata")
    return value


def submit_video(key: str, payload: dict, timeout: float) -> dict:
    return _api_request(key, "/v1/text_to_video", timeout, payload)


def retrieve_task(key: str, task_id: str, timeout: float) -> dict:
    return _api_request(key, f"/v1/tasks/{task_id}", timeout)


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


def download_video(url: str, output: Path, timeout: float) -> None:
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ProviderError("invalid_response", "Runway returned an invalid output URL")
    temporary: Path | None = None
    try:
        with _open(urllib.request.Request(url), min(timeout, 120.0)) as response:
            declared = response.headers.get("content-length")
            if declared and int(declared) > MAX_VIDEO_BYTES:
                raise ProviderError("invalid_response", "Runway video exceeds the 1 GiB safety limit")
            total = 0
            with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".runway-", suffix=".mp4", delete=False) as destination:
                temporary = Path(destination.name)
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_VIDEO_BYTES:
                        raise ProviderError("invalid_response", "Runway video exceeds the 1 GiB safety limit")
                    destination.write(chunk)
        if total == 0:
            raise ProviderError("invalid_response", "Runway returned an empty video")
        temporary.replace(output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def generate(request: dict) -> dict:
    output = validate_output(request.get("output"))
    payload, timeout = build_request(request)
    key = api_key()
    deadline = time.monotonic() + timeout
    task = submit_video(key, payload, timeout)
    task_id = task.get("id")
    if not isinstance(task_id, str) or not task_id:
        raise ProviderError("invalid_response", "Runway did not return a task id")
    while str(task.get("status", "")).upper() not in {"SUCCEEDED", "FAILED", "CANCELED"}:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ProviderError("timeout", "Runway generation timed out; the remote task may still complete")
        time.sleep(min(POLL_INTERVAL, remaining))
        task = retrieve_task(key, task_id, max(1.0, deadline - time.monotonic()))
    status = str(task.get("status", "")).upper()
    if status != "SUCCEEDED":
        failure = task.get("failure") or task.get("failureCode")
        detail = failure[:500] if isinstance(failure, str) else f"Runway task ended with status {status}"
        raise ProviderError("generation_failed", detail)
    outputs = task.get("output")
    if not isinstance(outputs, list) or not outputs or not isinstance(outputs[0], str):
        raise ProviderError("invalid_response", "Runway succeeded without a video output URL")
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ProviderError("timeout", "Runway generation timed out before download")
    download_video(outputs[0], output, remaining)
    return {"id": request.get("id"), "ok": True, "output": str(output), "metadata": {
        "model": payload["model"],
        "params": {"model": payload["model"], "ratio": payload["ratio"], "duration": payload["duration"]},
        "sourceVideoUrl": outputs[0],
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
            send({"id": request_id, "ok": False, "error": {"code": "internal_error", "message": "unexpected Runway provider failure"}})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
