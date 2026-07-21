#!/usr/bin/env bash
# narova setup — bootstrap the Python venv used by the `synth` (TTS) stage.
#
#   tool/setup.sh              # piper backend (default, fast, zero-config)
#   tool/setup.sh --xtts       # also install the xtts backend (~1.9GB model on first synth)
#   tool/setup.sh --qwen       # also install the Qwen3-TTS backend (~1.2GB model on first synth)
#
# Venv location: $NAROVA_VENV, else ~/.narova/venv (outside the skill folder,
# so skill updates never destroy it). The CLI runs this automatically on the
# first synth if no venv exists.
#
# Idempotent: safe to re-run. macOS (arm64) friendly. Node deps and the CLI are
# installed separately with `npm install`; this script only wires the Python side.
set -euo pipefail

WITH_XTTS=0
WITH_QWEN=0
for arg in "$@"; do
  case "$arg" in
    --xtts) WITH_XTTS=1 ;;
    --qwen) WITH_QWEN=1 ;;
    -h|--help)
      echo "usage: tool/setup.sh [--xtts] [--qwen]"; exit 0 ;;
    *) echo "unknown option: $arg (see --help)"; exit 1 ;;
  esac
done

# Resolve the tool root from this script's location (works from any cwd).
TOOL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="${NAROVA_VENV:-${NAROVA_HOME:-$HOME/.narova}/venv}"
REQ="$TOOL/py/requirements.txt"
REQ_XTTS="$TOOL/py/requirements-xtts.txt"
REQ_QWEN="$TOOL/py/requirements-qwen.txt"

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
check_bin npx     "install Node.js >= 18 (HyperFrames renders the video via npx)"

if [ "$MISSING" = "1" ]; then
  warn "Some system deps are missing. Install them, then re-run — the venv step below still proceeds."
fi

# --- python interpreter (the ML backends need 3.10+; macOS system python3 is 3.9) ---
find_python() {
  if [ -n "${NAROVA_SETUP_PYTHON:-}" ]; then echo "$NAROVA_SETUP_PYTHON"; return; fi
  for p in python3.12 python3.13 python3.11 python3.10; do
    if command -v "$p" >/dev/null 2>&1; then echo "$p"; return; fi
  done
  echo "python3"
}
PY="$(find_python)"
if ! command -v "$PY" >/dev/null 2>&1; then
  echo "python3 is required but not found. Install Python 3.10+ and re-run." >&2
  exit 1
fi
PYVER="$($PY -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
case "$PYVER" in
  3.9|3.8|3.7) warn "$PY is $PYVER — the TTS backends need 3.10+. Install a newer python (e.g. brew install python@3.12) or set NAROVA_SETUP_PYTHON." ;;
  *) ok "using $PY ($PYVER)" ;;
esac

say "Python virtual environment"
if [ -d "$VENV" ]; then
  ok "reusing existing venv at $VENV"
else
  mkdir -p "$(dirname "$VENV")"
  "$PY" -m venv "$VENV"
  ok "created venv at $VENV (python $PYVER)"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --quiet --upgrade pip
ok "pip upgraded ($(python -m pip --version | awk '{print $2}'))"

# --- python packages ---
say "Installing piper backend deps (py/requirements.txt)"
python -m pip install -r "$REQ"
ok "piper deps installed"

if [ "$WITH_XTTS" = "1" ]; then
  say "Installing xtts backend deps (py/requirements-xtts.txt)"
  python -m pip install -r "$REQ_XTTS"
  ok "xtts deps installed (model downloads on first synth, ~1.9GB, one-time)"
else
  echo "  (skip xtts — re-run with --xtts for that backend)"
fi

if [ "$WITH_QWEN" = "1" ]; then
  say "Installing Qwen3-TTS backend deps (py/requirements-qwen.txt)"
  python -m pip install -r "$REQ_QWEN"
  ok "qwen deps installed (model downloads on first synth, ~1.2GB, one-time)"
else
  echo "  (skip qwen — re-run with --qwen for that backend)"
fi

say "Done"
echo "  venv: $VENV"
echo "  Verify the toolchain with the narova doctor command."
