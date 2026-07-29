#!/usr/bin/env bash
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg is required to convert ElevenLabs audio to WAV" >&2
  exit 1
fi

python3 -c 'import json, pathlib, urllib.request, wave'
echo "ok: Narova ElevenLabs provider is ready (stdlib HTTP client; no packages installed)"
echo "next: set ELEVENLABS_API_KEY, then register tool/provider.json with Narova"
