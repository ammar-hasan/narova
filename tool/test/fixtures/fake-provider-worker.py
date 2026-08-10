#!/usr/bin/env python3
"""Hermetic narova-tts-provider/v1 worker used by Node and Python tests."""
from __future__ import annotations

import json
import sys
import time
import wave
from pathlib import Path


PROTOCOL = "narova-tts-provider/v1"
MODE = sys.argv[1] if len(sys.argv) > 1 else "ok"
PROVIDER = sys.argv[2] if len(sys.argv) > 2 else "fake"


def send(value) -> None:
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def wav(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(22050)
        out.writeframes(b"\0\0" * 2205)


for line in sys.stdin:
    request = json.loads(line)
    operation = request.get("operation")
    if operation == "hello":
        if MODE == "malformed-hello":
            sys.stdout.write("not json\n")
            sys.stdout.flush()
        elif MODE == "handshake-failure":
            send({"ok": False, "error": {"code": "not_ready", "message": "worker unavailable"}})
        else:
            protocol = "narova-tts-provider/v999" if MODE == "wrong-protocol" else PROTOCOL
            send({
                "ok": True,
                "protocol": protocol,
                "provider": PROVIDER,
                "providerVersion": "1.2.3",
            })
        continue

    if operation == "listVoices":
        send({
            "ok": True,
            "voices": [
                {"id": "voice-a", "name": "Voice A"},
                {"id": "voice-b", "name": "Voice B"},
            ],
        })
        continue

    if operation != "synthesize":
        send({"id": request.get("id"), "ok": False, "error": {"code": "bad_operation", "message": "unsupported"}})
        continue

    if MODE == "malformed":
        sys.stdout.write("{broken\n")
        sys.stdout.flush()
    elif MODE == "structured-error":
        send({"id": request.get("id"), "ok": False, "error": {"code": "synthesis_failed", "message": "synthetic failure"}})
    elif MODE == "crash":
        raise SystemExit(7)
    elif MODE == "timeout":
        time.sleep(5)
    elif MODE == "missing-output":
        send({"id": request.get("id"), "ok": True, "output": request.get("output")})
    else:
        output = Path(request["output"])
        wav(output)
        capture = request.get("options", {}).get("capture")
        if capture:
            Path(capture).write_text(json.dumps(request, sort_keys=True))
        send({"id": request.get("id"), "ok": True, "output": str(output)})
