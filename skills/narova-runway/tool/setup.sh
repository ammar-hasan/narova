#!/usr/bin/env bash
set -euo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 is required" >&2
  exit 1
fi

python3 -c 'import json, pathlib, tempfile, urllib.request'
echo "ok: Narova Runway video worker is ready (stdlib HTTP client; no packages installed)"
echo "next: set RUNWAYML_API_SECRET, then register tool/provider.json with Narova"
