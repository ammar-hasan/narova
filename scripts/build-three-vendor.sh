#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENTRY="$ROOT/tool/vendor/three/three.global.entry.js"
OUTPUT="$ROOT/tool/vendor/three/three.global.js"

npx --yes esbuild "$ENTRY" \
  --bundle \
  --minify \
  --format=iife \
  --alias:three="$ROOT/tool/vendor/three/three.module.js" \
  --outfile="$OUTPUT"

# Shader source is stored in JavaScript template literals. Preserve its
# meaningful indentation while removing line-end whitespace that would make
# the generated bundle fail `git diff --check`.
LC_ALL=C perl -pi -e 's/[ \t]+$//; s/^ +(\t+)/$1/' "$OUTPUT"
