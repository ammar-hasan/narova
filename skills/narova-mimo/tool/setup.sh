#!/usr/bin/env bash
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required" >&2
  exit 1
fi

python3 -c 'import json, pathlib, tempfile, urllib.request, wave, hashlib, base64'
echo "ok: Narova Xiaomi MiMo speech worker is ready (stdlib HTTP client; no packages installed)"
echo "next: set MIMO_API_KEY, then register tool/provider.json with Narova"
