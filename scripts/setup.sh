#!/usr/bin/env bash
# narova setup — bootstrap the Python venv used by the `synth` (TTS) stage.
#
#   scripts/setup.sh           # piper backend (default, fast, zero-config)
#   scripts/setup.sh --xtts    # also install the higher-quality xtts backend (~1.9GB model)
#
# Idempotent: safe to re-run. macOS (arm64) friendly. Node deps and the CLI are
# installed separately with `npm install`; this script only wires the Python side.
set -euo pipefail

WITH_XTTS=0
for arg in "$@"; do
  case "$arg" in
    --xtts) WITH_XTTS=1 ;;
    -h|--help)
      echo "usage: scripts/setup.sh [--xtts]"; exit 0 ;;
    *) echo "unknown option: $arg (see --help)"; exit 1 ;;
  esac
done

# Resolve repo root from this script's location (works from any cwd).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV="$ROOT/.venv"
REQ="$ROOT/py/requirements.txt"
REQ_XTTS="$ROOT/py/requirements-xtts.txt"

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; }

# --- system dependencies (checked, not installed — they live outside the venv) ---
say "Checking system dependencies"

check_bin() { # name  install-hint
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1 found ($(command -v "$1"))"
  else
    warn "$1 NOT found — $2"
    MISSING=1
  fi
}
MISSING=0
check_bin ffmpeg  "install with: brew install ffmpeg"
check_bin ffprobe "ships with ffmpeg: brew install ffmpeg"

# Google Chrome is used for headless frame capture (not a CLI on PATH by default).
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -x "$CHROME" ]; then
  ok "Google Chrome found"
elif command -v google-chrome >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1; then
  ok "Chrome/Chromium found on PATH"
else
  warn "Google Chrome NOT found — install from https://www.google.com/chrome/ (or: brew install --cask google-chrome)"
  MISSING=1
fi

if [ "$MISSING" = "1" ]; then
  warn "Some system deps are missing. Install them, then re-run — the venv step below still proceeds."
fi

# --- python venv ---
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but not found. Install Python 3.10+ and re-run." >&2
  exit 1
fi

say "Python virtual environment"
if [ -d "$VENV" ]; then
  ok "reusing existing venv at .venv"
else
  python3 -m venv "$VENV"
  ok "created venv at .venv"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --quiet --upgrade pip
ok "pip upgraded ($(python -m pip --version | awk '{print $2}'))"

# --- python packages ---
say "Installing piper backend deps (py/requirements.txt)"
if [ -f "$REQ" ]; then
  python -m pip install -r "$REQ"
  ok "piper deps installed"
else
  warn "py/requirements.txt not found — skipping (expected once the Python package lands)"
fi

if [ "$WITH_XTTS" = "1" ]; then
  say "Installing xtts backend deps (py/requirements-xtts.txt)"
  if [ -f "$REQ_XTTS" ]; then
    python -m pip install -r "$REQ_XTTS"
    ok "xtts deps installed (model downloads on first synth, ~1.9GB, one-time)"
  else
    warn "py/requirements-xtts.txt not found — skipping"
  fi
else
  echo "  (skip xtts — re-run with --xtts for the higher-quality backend)"
fi

say "Done"
echo "  Activate the venv:   source .venv/bin/activate"
echo "  Verify the toolchain: narova doctor"
echo "  Build the example:    cd examples/venture-factory && narova build"
