#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin_dir="${NAROVA_BIN_DIR:-${HOME}/.local/bin}"

command -v node >/dev/null 2>&1 || { echo "Node.js 18+ is required" >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 18) process.exit(1)' \
  || { echo "Node.js 18+ is required" >&2; exit 1; }
mkdir -p "$bin_dir"
ln -sfn "$skill_dir/tool/narova-stock.js" "$bin_dir/narova-stock"
chmod +x "$skill_dir/tool/narova-stock.js"

echo "Installed narova-stock -> $bin_dir/narova-stock"
echo "Credentialed providers are optional; set only the keys you intend to use."

