#!/usr/bin/env bash
# Install the standalone Narova CLI from GitHub into a user-owned npm prefix.
# The agent skill is intentionally not downloaded or installed by this script.
set -euo pipefail

REPOSITORY="${NAROVA_REPOSITORY:-ammar-hasan/narova}"
REF="${NAROVA_VERSION:-main}"
PREFIX="${NAROVA_PREFIX:-$HOME/.local}"
SOURCE_DIR=""
SKIP_OPTIONAL=0

usage() {
  cat <<'EOF'
usage: install.sh [--ref <git-ref>] [--prefix <dir>] [--source <tool-dir>] [--skip-optional]

Installs the standalone Narova CLI and narova-setup command. By default the
source is downloaded from ammar-hasan/narova at the main branch and installed
under ~/.local. Use --ref to pin a release tag or commit. --source is intended
for development and installation tests; it must point directly at tool/.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ref)
      [ "$#" -ge 2 ] || { echo "--ref needs a value" >&2; exit 1; }
      REF="$2"; shift 2 ;;
    --prefix)
      [ "$#" -ge 2 ] || { echo "--prefix needs a value" >&2; exit 1; }
      PREFIX="$2"; shift 2 ;;
    --source)
      [ "$#" -ge 2 ] || { echo "--source needs a value" >&2; exit 1; }
      SOURCE_DIR="$2"; shift 2 ;;
    --skip-optional)
      SKIP_OPTIONAL=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 1 ;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18+ is required (found $(node --version))" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/narova-install.XXXXXX")"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

if [ -n "$SOURCE_DIR" ]; then
  TOOL_SOURCE="$(cd "$SOURCE_DIR" && pwd)"
else
  command -v curl >/dev/null 2>&1 || { echo "curl is required for a GitHub install" >&2; exit 1; }
  command -v tar >/dev/null 2>&1 || { echo "tar is required for a GitHub install" >&2; exit 1; }
  ARCHIVE="$WORK_DIR/source.tar.gz"
  EXTRACTED="$WORK_DIR/source"
  mkdir -p "$EXTRACTED"
  echo "Downloading Narova CLI source from ${REPOSITORY}@${REF}..."
  curl --proto '=https' --tlsv1.2 -fsSL \
    "https://codeload.github.com/${REPOSITORY}/tar.gz/${REF}" \
    -o "$ARCHIVE"
  tar -xzf "$ARCHIVE" -C "$EXTRACTED"
  TOOL_SOURCE="$(find "$EXTRACTED" -mindepth 2 -maxdepth 2 -type d -name tool -print -quit)"
fi

if [ -z "${TOOL_SOURCE:-}" ] || [ ! -f "$TOOL_SOURCE/package.json" ] || [ ! -f "$TOOL_SOURCE/bin/narova.js" ]; then
  echo "Narova tool package not found in ${SOURCE_DIR:-${REPOSITORY}@${REF}}" >&2
  exit 1
fi

mkdir -p "$PREFIX"
PACK_DIR="$WORK_DIR/packed"
mkdir -p "$PACK_DIR"
PACK_NAME="$(npm pack "$TOOL_SOURCE" --pack-destination "$PACK_DIR" --silent | tail -n 1)"
PACK_ARCHIVE="$PACK_DIR/$PACK_NAME"
if [ ! -f "$PACK_ARCHIVE" ]; then
  echo "npm did not produce the expected package archive" >&2
  exit 1
fi

NPM_ARGS=(--global --prefix "$PREFIX" --omit=dev --no-audit --no-fund)
if [ "$SKIP_OPTIONAL" = "1" ]; then
  # `--omit=optional` still resolves optional package metadata on a cold npm
  # cache. Strip those declarations from a temporary package so installation
  # tests and explicitly minimal installs are genuinely network-free.
  STRIPPED_DIR="$WORK_DIR/stripped"
  STRIPPED_PACK_DIR="$WORK_DIR/stripped-pack"
  mkdir -p "$STRIPPED_DIR" "$STRIPPED_PACK_DIR"
  tar -xzf "$PACK_ARCHIVE" -C "$STRIPPED_DIR"
  node -e '
    const fs = require("node:fs");
    const file = process.argv[1];
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    delete pkg.optionalDependencies;
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  ' "$STRIPPED_DIR/package/package.json"
  STRIPPED_NAME="$(npm pack "$STRIPPED_DIR/package" --pack-destination "$STRIPPED_PACK_DIR" --silent | tail -n 1)"
  PACK_ARCHIVE="$STRIPPED_PACK_DIR/$STRIPPED_NAME"
fi
npm install "${NPM_ARGS[@]}" "$PACK_ARCHIVE"

CLI="$PREFIX/bin/narova"
if [ ! -x "$CLI" ]; then
  echo "installation completed without an executable at $CLI" >&2
  exit 1
fi

echo "Installed Narova $($CLI --version) to $CLI"
case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *) echo "Add $PREFIX/bin to PATH before running: narova doctor" ;;
esac
