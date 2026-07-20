# Environment & preflight

`narova doctor` is the single source of truth — run it first; it checks ffmpeg,
ffprobe, Chrome, the Python interpreter, and whether `narova_tts` imports.
Exit 0 = ready.

## The pieces

| Need | Why | Fix when missing |
|------|-----|------------------|
| Node >= 18 | the CLI (zero npm deps) | install Node; `npm link` in the repo puts `narova` on PATH |
| ffmpeg + ffprobe | audio splicing, mp4 assemble, duration probes | `brew install ffmpeg` / `apt-get install ffmpeg` |
| Chrome / Chromium | headless keyframe capture | install Chrome, or point `$CHROME` at any Chromium binary |
| Python 3.10+ venv | the TTS stage (`narova_tts`) | `scripts/setup.sh` in the repo (add `--xtts` for the xtts backend) |

## How narova finds things

- **Python** (`findPython`): `$NAROVA_PYTHON` → `<project>/.venv/bin/python` →
  `<repo>/.venv/bin/python` → bare `python3`. `scripts/setup.sh` creates the
  repo venv, so after running it once no env var is needed.
- **`narova_tts` is not pip-installed** — the CLI injects `PYTHONPATH=<repo>/py`
  when invoking Python. Don't try to `pip install narova_tts`; if doctor says
  "not importable", run `scripts/setup.sh` (it installs the *dependencies* into
  the venv).
- **Chrome** (`detectChrome`): `$CHROME` wins, then standard macOS app paths,
  then `/usr/bin/google-chrome|chromium|chromium-browser`. In containers/CI,
  export `CHROME=/path/to/chromium`.

## Locating the repo / the CLI

If `narova` isn't on PATH (or is an older version): find the repo, then
re-link. This skill lives in a `.claude/skills/narova` folder (globally under
`~`, or inside a project). For a symlinked install `readlink` on that folder
reveals the repo; for a copied install the path is recorded in
`<skill-folder>/.narova-skill-source`. From the repo: `npm link`
(safe: zero dependencies), or invoke `node <repo>/bin/narova.js` directly —
every command works either way.

## First-run downloads (need network, once)

- piper: one small ONNX voice per configured speaker, on first synth.
- xtts (optional): ~1.9GB model on first synth; deps via
  `scripts/setup.sh --xtts`; set `COQUI_TOS_AGREED=1` if the license gate asks.
