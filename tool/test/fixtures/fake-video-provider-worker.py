#!/usr/bin/env python3
"""Hermetic narova-video-provider/v1 worker for core protocol tests."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path


PROTOCOL = "narova-video-provider/v1"
MODE = sys.argv[1] if len(sys.argv) > 1 else "ok"
NAME = sys.argv[2] if len(sys.argv) > 2 else "fake-video"


def send(value: object) -> None:
    print(json.dumps(value, separators=(",", ":")), flush=True)


for line in sys.stdin:
    request = json.loads(line)
    operation = request.get("operation")
    if operation == "hello":
        if MODE == "stdout-overflow":
            sys.stdout.write("x" * (1024 * 1024 + 1))
            sys.stdout.flush()
            continue
        if MODE == "stderr-overflow":
            sys.stderr.write("x" * (64 * 1024 + 1))
            sys.stderr.flush()
            time.sleep(60)
            continue
        if MODE == "handshake-failure":
            send({"ok": False, "error": {"message": "unavailable"}})
        else:
            send({
                "ok": True,
                "protocol": "narova-video-provider/v999" if MODE == "wrong-protocol" else PROTOCOL,
                "provider": NAME,
                "providerVersion": "1.2.3",
            })
        continue
    if operation != "generate":
        send({"id": request.get("id"), "ok": False, "error": {"message": "unsupported operation"}})
        continue
    if MODE == "generation-failure":
        send({"id": request.get("id"), "ok": False, "error": {"code": "service_error", "message": "safe provider failure"}})
        continue
    if MODE == "hang":
        time.sleep(60)
        continue
    output = Path(request["output"])
    if MODE == "require-continuity":
        continuity = request.get("continuity")
        reference = request.get("reference")
        if not isinstance(continuity, dict) or continuity.get("shot") != "arrival":
            send({"id": request.get("id"), "ok": False, "error": {"message": "missing continuity"}})
            continue
        if not isinstance(reference, dict) or reference.get("kind") != "image" or not Path(reference.get("path", "")).is_file():
            send({"id": request.get("id"), "ok": False, "error": {"message": "missing image reference"}})
            continue
    if MODE in {"require-continuity", "real-video"}:
        made = subprocess.run([
            "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
            "-i", "color=c=blue:s=16x16:d=0.2:r=5", "-an", "-c:v", "libx264",
            "-pix_fmt", "yuv420p", str(output),
        ], check=False)
        if made.returncode != 0:
            send({"id": request.get("id"), "ok": False, "error": {"message": "fixture ffmpeg failed"}})
            continue
    if MODE == "empty":
        output.write_bytes(b"")
    elif MODE not in {"missing", "require-continuity", "real-video"}:
        output.write_bytes(b"fake-video-bytes")
    options = dict(request.get("options") or {})
    options.setdefault("model", "fake-video-1")
    response_output = str(output)
    if MODE == "wrong-path":
        response_output = str(output.with_name("wrong.mp4"))
    elif MODE == "alias-path":
        response_output = str(output.parent / "unused" / ".." / output.name)
    send({
        "id": "wrong-id" if MODE == "wrong-id" else request.get("id"),
        "ok": True,
        "output": response_output,
        "metadata": {
            "model": options["model"],
            "params": options,
            "sourceVideoUrl": "https://cdn.example/video.mp4?signature=secret",
        },
    })
