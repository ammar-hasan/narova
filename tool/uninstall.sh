#!/usr/bin/env bash
# Remove only the standalone Narova CLI package from its npm prefix.
# Projects, downloaded models, caches, and separately installed skills are kept.
set -euo pipefail

PREFIX=""

usage() {
  cat <<'EOF'
usage: narova-uninstall [--prefix <dir>]

Removes the standalone Narova CLI package and its narova, narova-setup, and
narova-uninstall commands. Projects, downloaded models, caches, and the
separately installed agent skill are not removed.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prefix)
      [ "$#" -ge 2 ] || { echo "--prefix needs a value" >&2; exit 1; }
      PREFIX="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1 ;;
  esac
done

command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }

# An installed npm bin is a symlink into <prefix>/lib/node_modules/narova.
# Resolve it so custom-prefix installs can uninstall themselves without flags.
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
    */lib/node_modules/narova)
      PREFIX="$(cd "$SCRIPT_DIR/../../.." && pwd)" ;;
    *)
      PREFIX="$HOME/.local" ;;
  esac
fi

PACKAGE_DIR="$PREFIX/lib/node_modules/narova"
if [ ! -d "$PACKAGE_DIR" ]; then
  echo "Narova is not installed under $PREFIX; nothing to remove."
  exit 0
fi

npm uninstall --global --prefix "$PREFIX" --no-audit --no-fund narova

if [ -d "$PACKAGE_DIR" ]; then
  echo "npm did not remove the Narova package at $PACKAGE_DIR" >&2
  exit 1
fi

echo "Uninstalled Narova from $PREFIX"
echo "Projects, downloaded models, caches, and agent skills were kept."
