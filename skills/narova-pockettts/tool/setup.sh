#!/usr/bin/env bash
set -euo pipefail
POCKET_TOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POCKET_HOME="${NAROVA_HOME:-$HOME/.narova}"
POCKET_VENV="${NAROVA_POCKETTTS_VENV:-$POCKET_HOME/venv-pockettts}"
POCKET_PYTHON="${NAROVA_SETUP_PYTHON:-python3.12}"
"$POCKET_PYTHON" -c 'import sys; assert sys.version_info[:2] == (3, 12), "Pocket profile requires Python 3.12; set NAROVA_SETUP_PYTHON"'
if [ ! -x "$POCKET_VENV/bin/python" ]; then
  "$POCKET_PYTHON" -m venv "$POCKET_VENV"
fi
"$POCKET_VENV/bin/python" -c 'import sys; assert sys.version_info[:2] == (3, 12), "Existing Pocket venv must use Python 3.12"'
# Linux uses CPU wheels rather than pulling the CUDA runtime.
if [ "$(uname -s)" = Linux ]; then
  "$POCKET_VENV/bin/python" -m pip install 'torch==2.10.0' --index-url https://download.pytorch.org/whl/cpu
fi
"$POCKET_VENV/bin/python" -m pip install -r "$POCKET_TOOL_DIR/requirements.txt"
"$POCKET_VENV/bin/python" -m pip check
"$POCKET_VENV/bin/python" -c 'import torch; assert not torch.cuda.is_available(), "This companion supports CPU execution"'
echo 'Pocket runtime ready. Models are acquired on first doctor/synthesis use, not by setup.'
echo "Next: narova providers add $POCKET_TOOL_DIR/provider.json"
