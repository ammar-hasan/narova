# Environment

The CLI is bundled in this skill: `node <skill-dir>/tool/bin/narova.js`.
There is nothing to install. Run `doctor` first — it checks
everything below. Exit 0 = ready.

## What the machine needs

| Need | Why | If missing |
|------|-----|------------|
| Node 18+ (with npx) | the CLI and HyperFrames | install Node |
| ffmpeg + ffprobe | audio work and duration checks | `brew install ffmpeg` |
| Python 3.10+ | the TTS venv | `brew install python@3.12` (macOS system 3.9 is too old) |
| TTS venv | speech synthesis | nothing — the first `synth` creates it at `~/.narova/venv` |
| HyperFrames CLI | preview + render | nothing — `npx` downloads it on first use |

Chrome is not needed. HyperFrames brings its own browser.

## How the CLI finds Python

Order: `$NAROVA_PYTHON` → `<project>/.venv` → `$NAROVA_VENV` or
`~/.narova/venv` → a dev checkout `.venv` → plain `python3`.
If no venv exists, the first `synth` runs `tool/setup.sh` and creates one.

`narova_tts` is not pip-installed. The CLI sets `PYTHONPATH=<skill>/tool/py`
when calling Python. If doctor says "not importable", run `tool/setup.sh`.

HyperFrames is version-pinned in `tool/src/hf.js` and in every generated
`out/hf/package.json`. All calls go through `npx --yes hyperframes@<pin>`.

## Env overrides

- `$NAROVA_VENV` — venv path (default `~/.narova/venv`).
- `$NAROVA_HOME` — base folder (default `~/.narova`).
- `$NAROVA_CACHE` — sentence synthesis cache (default
  `~/.narova/cache/sentences`). Delete it to force fresh voices everywhere.
- `$NAROVA_PYTHON` — use this Python, skip venv discovery.
- `$NAROVA_QWEN_MODEL` — a different Qwen3-TTS model.

## First-run downloads (network, one time each)

- venv: created by the first `synth`.
- piper: one small voice file per speaker.
- xtts: ~1.9GB model (`tool/setup.sh --xtts` first; `COQUI_TOS_AGREED=1` if asked).
- qwen: ~1.2GB model (`tool/setup.sh --qwen` first).
- HyperFrames CLI: fetched by npx on the first doctor / build / preview.
