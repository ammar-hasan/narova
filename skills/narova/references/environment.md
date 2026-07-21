# Environment & preflight

The CLI is bundled in this skill (`<skill>/tool/bin/narova.js`) — there is no
install. `$NAROVA doctor` is the single source of truth — run it first; it
checks ffmpeg, ffprobe, the Python interpreter, whether `narova_tts` imports,
and whether `npx hyperframes` runs. Exit 0 = ready.

## The pieces

| Need | Why | Fix when missing |
|------|-----|------------------|
| Node >= 18 + npx | the CLI (zero npm deps) and the HyperFrames engine | install Node |
| ffmpeg + ffprobe | audio splicing, loudness, duration probes | `brew install ffmpeg` / `apt-get install ffmpeg` |
| Python 3.10+ | the TTS venv | `brew install python@3.12` (macOS system 3.9 is too old) |
| TTS venv | the `narova_tts` stage | nothing — first `synth` creates it at `~/.narova/venv`; add backends with `tool/setup.sh --xtts` / `--qwen` |
| HyperFrames CLI | preview (Studio) + render | nothing — `npx hyperframes@<pin>` downloads on first use |

Chrome is NOT needed anymore — HyperFrames provisions its own browser.

## How narova finds things

- **Python** (`findPython`): `$NAROVA_PYTHON` → `<project>/.venv` →
  `$NAROVA_VENV` / `~/.narova/venv` → a dev-checkout `.venv` → bare `python3`.
  The first `synth` runs `tool/setup.sh` automatically when none exists.
- **`narova_tts` is not pip-installed** — the CLI injects
  `PYTHONPATH=<skill>/tool/py` when invoking Python. If doctor says "not
  importable", run `tool/setup.sh` (it installs the *dependencies* into the
  venv).
- **HyperFrames** is version-pinned in `src/hf.js` and in every generated
  `out/hf/package.json`; all calls go through `npx --yes hyperframes@<pin>`.

## Invoking the CLI

`node <skill-dir>/tool/bin/narova.js <command>` — always, no PATH involved.
Env overrides: `$NAROVA_VENV` (venv path), `$NAROVA_HOME` (default
`~/.narova`), `$NAROVA_PYTHON` (skip venv discovery entirely).

## First-run downloads (need network, once)

- piper: one small ONNX voice per configured speaker, on first synth.
- xtts (optional): ~1.9GB model on first synth; deps via
  `tool/setup.sh --xtts`; set `COQUI_TOS_AGREED=1` if the license gate asks.
- HyperFrames CLI: downloaded by npx on the first `doctor`/`build`/`preview`.
