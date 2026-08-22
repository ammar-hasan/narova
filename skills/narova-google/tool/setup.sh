#!/usr/bin/env bash
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required" >&2
  exit 1
fi

python3 -c 'import json, pathlib, tempfile, urllib.request, wave'
echo "ok: Narova Google speech and video workers are ready (stdlib HTTP client; no packages installed)"
echo "next: set GEMINI_API_KEY, then register tool/provider.json and/or tool/video-provider.json with Narova"
