#!/usr/bin/env bash
# Remove only the scoped Narova npm package from its npm prefix.
# Projects, downloaded models, caches, and separately installed skills are kept.
set -euo pipefail

PREFIX=""

PURGE_TOOLS=0

usage() {
  cat <<'EOF'
usage: narova-uninstall [--prefix <dir>] [--purge-tools]

Removes the @narova/narova package and its narova, narova-setup, and
narova-uninstall commands. Projects, downloaded models, caches, and the
separately installed agent skill are not removed.

--purge-tools  also remove Narova-provisioned tooling from user storage:
               the TTS venv(s), provisioned tools directory, and the piper
               voice cache. Your projects, media assets, and voice-clone
               samples are always kept.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix)
      [ "$#" -ge 2 ] || { echo "--prefix needs a value" >&2; exit 1; }
      PREFIX="$2"; shift 2 ;;
    --purge-tools)
      PURGE_TOOLS=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1 ;;
  esac
done

command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }

# An installed npm bin is a symlink into
# <prefix>/lib/node_modules/@narova/narova. Resolve it so custom-prefix installs
# can uninstall themselves without flags.
SCRIPT_PATH="${BASH_SOURCE[0]}"
while [ -L "$SCRIPT_PATH" ]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
  LINK_TARGET="$(readlink "$SCRIPT_PATH")"
  case "$LINK_TARGET" in
    /*) SCRIPT_PATH="$LINK_TARGET" ;;
    *) SCRIPT_PATH="$SCRIPT_DIR/$LINK_TARGET" ;;
  esac
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"

if [ -z "$PREFIX" ]; then
  case "$SCRIPT_DIR" in
    */lib/node_modules/@narova/narova)
      PREFIX="$(cd "$SCRIPT_DIR/../../../.." && pwd)" ;;
    *)
      PREFIX="$HOME/.local" ;;
  esac
fi

PACKAGE_DIR="$PREFIX/lib/node_modules/@narova/narova"
if [ ! -d "$PACKAGE_DIR" ]; then
  echo "Narova is not installed under $PREFIX; nothing to remove."
  exit 0
fi

npm uninstall --global --prefix "$PREFIX" --no-audit --no-fund --dry-run=false @narova/narova

if [ -d "$PACKAGE_DIR" ]; then
  echo "npm did not remove the Narova package at $PACKAGE_DIR" >&2
  exit 1
fi

echo "Uninstalled Narova from $PREFIX"

# NAR-021-007: complete removal also covers provisioned tools, runtimes,
# and models — but only on explicit request. Projects, media assets, and
# voice-clone samples are always kept.
if [ "$PURGE_TOOLS" -eq 1 ]; then
  NAROVA_HOME="${NAROVA_HOME:-$HOME/.narova}"
  PIPER_CACHE="${NAROVA_PIPER_DIR:-$HOME/.cache/narova}"
  for target in "$NAROVA_HOME/venv" "$NAROVA_HOME/venv-chatterbox" "$NAROVA_HOME/tools"; do
    if [ -e "$target" ]; then
      rm -rf "$target"
      echo "removed $target"
    fi
  done
  if [ -d "$PIPER_CACHE" ]; then
    rm -rf "$PIPER_CACHE"
    echo "removed $PIPER_CACHE"
  fi
  echo "Provisioned tooling removed. Projects, media assets, and voice samples were kept."
else
  echo "Projects, downloaded models, caches, and agent skills were kept."
  echo "To also remove provisioned tooling (venv, tools, voice cache): narova-uninstall --purge-tools"
fi
