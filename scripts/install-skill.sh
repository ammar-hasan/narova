#!/usr/bin/env bash
# Install the narova agent skill for Claude Code.
#
#   scripts/install-skill.sh                     # global (~/.claude/skills), symlinked
#   scripts/install-skill.sh --copy              # global, copied (re-run after repo updates)
#   scripts/install-skill.sh --project <dir>     # into <dir>/.claude/skills, copied —
#                                                #   committable, so teammates get it on clone
#   scripts/install-skill.sh --project <dir> --link   # project install as a symlink instead
set -euo pipefail

MODE=""
PROJECT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --copy|--link)
      WANT="${1#--}"
      if [ -n "$MODE" ] && [ "$MODE" != "$WANT" ]; then
        echo "--copy and --link are mutually exclusive" >&2; exit 1
      fi
      MODE="$WANT" ;;
    --project)
      [ $# -ge 2 ] || { echo "--project needs a directory" >&2; exit 1; }
      PROJECT="$2"; shift ;;
    -h|--help)
      echo "usage: scripts/install-skill.sh [--copy|--link] [--project <dir>]"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)"; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT/skills/narova"
MARKER=".narova-skill-source"   # written into copies; records the source repo

[ -d "$SRC" ] || { echo "skill not found at $SRC" >&2; exit 1; }

if [ -n "$PROJECT" ]; then
  [ -d "$PROJECT" ] || { echo "project dir not found: $PROJECT" >&2; exit 1; }
  DEST_BASE="$(cd "$PROJECT" && pwd)/.claude/skills"
  # Copy by default: a symlink would dangle for anyone else who clones the project.
  [ -n "$MODE" ] || MODE=copy
else
  DEST_BASE="$HOME/.claude/skills"
  [ -n "$MODE" ] || MODE=link
fi
DEST="$DEST_BASE/narova"
mkdir -p "$DEST_BASE"

# Replace anything this installer previously created (a symlink, or a copy
# carrying our marker); refuse to touch a directory we didn't make.
if [ -L "$DEST" ]; then
  rm "$DEST"
elif [ -d "$DEST" ] && [ -f "$DEST/$MARKER" ]; then
  rm -rf "$DEST"
elif [ -e "$DEST" ]; then
  echo "refusing to overwrite $DEST — not created by this installer; remove it and re-run" >&2
  exit 1
fi

if [ "$MODE" = copy ]; then
  cp -R "$SRC" "$DEST"
  printf '%s\n' "$ROOT" > "$DEST/$MARKER"
  echo "copied skill -> $DEST (source repo recorded in $MARKER; re-run after updating the repo)"
  [ -n "$PROJECT" ] && echo "tip: commit $DEST so everyone who clones the project gets the skill"
else
  ln -s "$SRC" "$DEST"
  echo "linked skill -> $DEST -> $SRC"
fi

# Put the CLI on PATH (zero runtime deps, so npm link is safe). Non-fatal:
# node <repo>/bin/narova.js works without it.
if (cd "$ROOT" && npm link --silent >/dev/null 2>&1); then
  echo "narova CLI linked onto PATH (narova --version: $(narova --version 2>/dev/null || echo '?'))"
else
  echo "note: npm link failed — use: node $SRC/tool/bin/narova.js <command>"
fi

echo "done. Claude Code sessions can now trigger the narova skill."
