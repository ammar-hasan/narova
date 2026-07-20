#!/usr/bin/env bash
# Install the narova agent skill into ~/.claude/skills so Claude Code can use
# narova from any directory (inside this repo it is auto-discovered already).
#
#   scripts/install-skill.sh           # symlink (updates ride along with `git pull`)
#   scripts/install-skill.sh --copy    # copy instead of symlink
set -euo pipefail

MODE=link
for arg in "$@"; do
  case "$arg" in
    --copy) MODE=copy ;;
    -h|--help) echo "usage: scripts/install-skill.sh [--copy]"; exit 0 ;;
    *) echo "unknown option: $arg (see --help)"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/.claude/skills/narova"
DEST="$HOME/.claude/skills/narova"

[ -d "$SRC" ] || { echo "skill not found at $SRC" >&2; exit 1; }
mkdir -p "$HOME/.claude/skills"

if [ -L "$DEST" ]; then
  rm "$DEST"                       # replacing our own (or a stale) symlink is fine
elif [ -e "$DEST" ]; then
  echo "refusing to overwrite existing non-symlink $DEST — remove it and re-run" >&2
  exit 1
fi

if [ "$MODE" = copy ]; then
  cp -R "$SRC" "$DEST"
  echo "copied skill -> $DEST (re-run after updating the repo)"
else
  ln -s "$SRC" "$DEST"
  echo "linked skill -> $DEST -> $SRC"
fi

# Put the CLI on PATH (zero runtime deps, so npm link is safe). Non-fatal:
# node <repo>/bin/narova.js works without it.
if (cd "$ROOT" && npm link --silent >/dev/null 2>&1); then
  echo "narova CLI linked onto PATH (narova --version: $(narova --version 2>/dev/null || echo '?'))"
else
  echo "note: npm link failed — use: node $ROOT/bin/narova.js <command>"
fi

echo "done. New Claude Code sessions can now trigger the narova skill anywhere."
