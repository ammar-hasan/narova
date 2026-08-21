#!/usr/bin/env python3
"""Hermetic narova-video-provider/v1 worker for core protocol tests."""
from __future__ import annotations

import json
import os
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
    if MODE == "empty":
        output.write_bytes(b"")
    elif MODE != "missing":
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
