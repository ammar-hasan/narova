#!/usr/bin/env python3
"""ElevenLabs voice-design audition helper (NAR-010-014).

Explicitly invoked, companion-side only: turns a text voice description
into saved preview audio plus an audition index; a separate step creates
the permanent voice from a human-chosen preview. Never touches project
or core state, registers nothing, and synthesizes no build audio.

Design calls are network operations billed against the hosted account —
check current pricing/quota before generating many previews. There are
no automatic retries: a lost response may still be billed.

Usage:
  python3 design.py "A warm Urdu-speaking grandmother, gentle and unhurried" \
      [--text PREVIEW_TEXT] [--out DIR] [--seed N] [--model ID] \
      [--language CODE] [--loudness -1..1] [--guidance-scale 0..20] \
      [--enhance] [--timeout SECONDS] [--remix VOICE_ID]
  python3 design.py --create GENERATED_VOICE_ID --name "Dadi" \
      [--description "..."] [--timeout SECONDS]

Environment: ELEVENLABS_API_KEY (same key the provider worker uses).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://api.elevenlabs.io"
DEFAULT_MODEL = "eleven_multilingual_ttv_v2"
DEFAULT_TIMEOUT = 120.0
PREVIEW_TEXT_MIN = 100
PREVIEW_TEXT_MAX = 1000
DESIGN_MODELS = {"eleven_multilingual_ttv_v2", "eleven_ttv_v3"}


class DesignError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        raise DesignError(
            "missing_credentials",
            "ELEVENLABS_API_KEY is not set — export it first (never put it in project files)",
        )
    return key


def _safe_error_detail(body: bytes) -> str:
    try:
        detail = json.loads(body.decode("utf-8", "replace"))
    except (ValueError, UnicodeDecodeError):
        return body[:300].decode("utf-8", "replace") or "empty response body"
    if isinstance(detail, dict) and isinstance(detail.get("detail"), dict):
        detail = detail["detail"]
    return str(detail.get("message") or detail.get("detail") or detail)[:300]


def _http_error(exc: urllib.error.HTTPError) -> DesignError:
    body = exc.read() if hasattr(exc, "read") else b""
    if exc.code in (401, 403):
        return DesignError("authentication", f"ElevenLabs rejected the key or capability ({exc.code}): {_safe_error_detail(body)}")
    if exc.code == 429:
        return DesignError("rate_limited", f"ElevenLabs rate/quota limit reached: {_safe_error_detail(body)}")
    if exc.code == 422:
        return DesignError("invalid_request", f"ElevenLabs rejected the design request: {_safe_error_detail(body)}")
    if 500 <= exc.code < 600:
        return DesignError("service", f"ElevenLabs service error ({exc.code}): {_safe_error_detail(body)}")
    return DesignError("invalid_request", f"ElevenLabs request failed ({exc.code}): {_safe_error_detail(body)}")


def _open(request: urllib.request.Request, timeout: float):
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        raise _http_error(exc) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise DesignError("network", f"could not reach ElevenLabs: {exc}") from exc


def request_json(path: str, payload: dict, key: str, timeout: float) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        API_BASE + path, data=body, method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    with _open(request, timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    if not isinstance(data, dict):
        raise DesignError("invalid_response", "ElevenLabs returned a non-object design response")
    return data


def _number(value, name: str, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise DesignError("invalid_options", f"{name} must be a number")
    if not minimum <= number <= maximum:
        raise DesignError("invalid_options", f"{name} must be from {minimum} to {maximum}")
    return number


def build_design_payload(args) -> dict:
    if not args.description or not args.description.strip():
        raise DesignError("invalid_request", "a voice description is required")
    if args.model not in DESIGN_MODELS:
        raise DesignError("invalid_options", f"model must be one of: {', '.join(sorted(DESIGN_MODELS))}")
    payload: dict = {
        "voice_description": args.description.strip(),
        "model_id": args.model,
    }
    text = (args.text or "").strip()
    if text:
        if not PREVIEW_TEXT_MIN <= len(text) <= PREVIEW_TEXT_MAX:
            raise DesignError(
                "invalid_request",
                f"preview text must be {PREVIEW_TEXT_MIN}-{PREVIEW_TEXT_MAX} characters (got {len(text)}); "
                "omit --text to let ElevenLabs generate suitable preview lines",
            )
        payload["text"] = text
    else:
        # The API rejects a design request that carries neither text nor
        # auto_generate_text (observed live, 2026-08-18).
        payload["auto_generate_text"] = True
    if args.language:
        payload["language_code"] = args.language
    if args.seed is not None:
        try:
            payload["seed"] = int(args.seed)
        except (TypeError, ValueError):
            raise DesignError("invalid_options", "seed must be an integer")
    if args.loudness is not None:
        payload["loudness"] = _number(args.loudness, "loudness", -1.0, 1.0)
    if args.guidance_scale is not None:
        payload["guidance_scale"] = _number(args.guidance_scale, "guidance-scale", 0.0, 20.0)
    if args.enhance:
        payload["should_enhance"] = True
    if args.remix:
        payload["previous_voice_id"] = args.remix
    return payload


def write_previews(response: dict, payload: dict, out_dir: Path) -> list[dict]:
    previews = response.get("previews")
    if not isinstance(previews, list) or not previews:
        raise DesignError("invalid_response", "ElevenLabs returned no voice previews")
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for index, preview in enumerate(previews, start=1):
        generated_id = str(preview.get("generated_voice_id") or "")
        audio = preview.get("audio_base_64")
        if not generated_id or not isinstance(audio, str) or not audio:
            raise DesignError("invalid_response", f"preview {index} is missing audio or its generated voice id")
        suffix = "mp3"
        media_type = str(preview.get("media_type") or "audio/mpeg")
        if media_type.lower() == "audio/mpeg":
            suffix = "mp3"
        elif "/" in media_type and media_type.split("/")[1].isalnum():
            suffix = media_type.split("/")[1]
        name = f"preview-{index:02d}-{generated_id}.{suffix}"
        (out_dir / name).write_bytes(base64.b64decode(audio))
        rows.append({
            "file": name,
            "generated_voice_id": generated_id,
            "duration_secs": preview.get("duration_secs"),
            "media_type": media_type,
            "language": preview.get("language"),
        })
    record = {
        "request": payload,
        "returned_text": response.get("text"),
        "previews": rows,
    }
    (out_dir / "design.json").write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    lines = ["# Voice design previews", ""]
    lines.append(f"- description: {payload['voice_description']}")
    if payload.get("seed") is not None:
        lines.append(f"- seed: {payload['seed']} (request seed; preview identities are NOT guaranteed stable across calls — audition each run)")
    lines += ["", "| # | file | generated voice id | duration |", "|---|---|---|---|"]
    for row in rows:
        duration = row["duration_secs"]
        duration_text = f"{duration:.1f}s" if isinstance(duration, (int, float)) else "unknown"
        lines.append(f"| {rows.index(row) + 1} | {row['file']} | `{row['generated_voice_id']}` | {duration_text} |")
    lines += [
        "",
        "Listen, pick one, then create the permanent voice:",
        "",
        "```bash",
        f'python3 design.py --create <generated-voice-id> --name "Your voice name"',
        "```",
        "",
        "Full parameters: design.json",
    ]
    (out_dir / "index.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return rows


def build_create_payload(args) -> dict:
    if not args.create or not args.create.strip():
        raise DesignError("invalid_request", "--create needs the generated voice id you chose from the audition index")
    if not args.name or not args.name.strip():
        raise DesignError("invalid_request", "--name is required when creating a voice")
    description = (args.voice_description or "").strip()
    if len(description) < 20:
        raise DesignError(
            "invalid_request",
            f"a voice description of at least 20 characters is required when creating a voice "
            f"(the API enforces it; got {len(description)})",
        )
    return {
        "voice_name": args.name.strip(),
        "generated_voice_id": args.create.strip(),
        "voice_description": description,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="ElevenLabs voice-design audition helper (design previews or create a voice; never picks for you)")
    parser.add_argument("description", nargs="?", help="voice description for the design step (omit when using --create)")
    parser.add_argument("--text", help=f"preview text, {PREVIEW_TEXT_MIN}-{PREVIEW_TEXT_MAX} characters; omit to auto-generate")
    parser.add_argument("--out", default="out/voice-design", help="directory for previews, index, and parameters (default out/voice-design)")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"design model (default {DEFAULT_MODEL})")
    parser.add_argument("--seed", type=int, help="seed: passed to the API (request-reproducible; preview identities are not guaranteed stable)")
    parser.add_argument("--language", help="language code for the preview generation")
    parser.add_argument("--loudness", type=float, help="preview loudness, -1 (quiet) to 1 (loud)")
    parser.add_argument("--guidance-scale", type=float, dest="guidance_scale", help="prompt adherence, 0 (freer) to 20 (stricter; high values can sound robotic)")
    parser.add_argument("--enhance", action="store_true", help="let ElevenLabs expand the description with more detail")
    parser.add_argument("--remix", metavar="VOICE_ID", help="design by remixing an existing remixable voice (designed/IVC/PVC or library voice with infinite notice)")
    parser.add_argument("--create", metavar="GENERATED_VOICE_ID", help="create the permanent voice from the preview you chose")
    parser.add_argument("--name", help="name for the created voice (required with --create)")
    parser.add_argument("--description", dest="voice_description", help="optional description for the created voice (min 20 chars)")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT, help=f"request timeout in seconds (default {DEFAULT_TIMEOUT:.0f})")
    args = parser.parse_args(argv)

    try:
        timeout = _number(args.timeout, "timeout", 1.0, 300.0)
        key = api_key()
        if args.create:
            payload = build_create_payload(args)
            created = request_json("/v1/text-to-voice", payload, key, timeout)
            voice_id = str(created.get("voice_id") or "")
            if not voice_id:
                raise DesignError("invalid_response", "ElevenLabs created the voice but returned no voice id")
            name = payload["voice_name"]
            print(f"voice created: {voice_id}  ({name})")
            print()
            print("Paste into reel.config.mjs voices:")
            print(f'  {{ backend: "elevenlabs", speaker: "{voice_id}", label: "{name}" }}')
            print()
            print("Then: narova voices list --backend elevenlabs   # confirm it appears")
            return 0

        payload = build_design_payload(args)
        response = request_json("/v1/text-to-voice/design", payload, key, timeout)
        rows = write_previews(response, payload, Path(args.out))
        log(f"{len(rows)} preview(s) -> {args.out}")
        for row in rows:
            log(f"  {row['file']}  id={row['generated_voice_id']}")
        log(f"audition index -> {args.out}/index.md  (listen, pick one, then --create)")
        return 0
    except DesignError as error:
        log(f"error [{error.code}]: {error.message}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
