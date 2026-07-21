# CLI reference

`narova` below means the bundled tool: `node <skill-dir>/tool/bin/narova.js`
(the `$NAROVA` shorthand from SKILL.md).

Project-reading commands (`check`, `synth`, `compose`, `build`, `preview`)
take `--project <dir>` (default `.`) and `--config <file>`; the ones that
write take `--out <dir>` (default `<project>/out`). `init` takes a positional
directory instead; `voices` and `doctor` need no config. Run from the project
directory or pass `--project`.

| Command | Does | Cost |
|---------|------|------|
| `narova init <dir>` | scaffold: config + one example scene + README + .gitignore (never overwrites) | instant |
| `narova check` | validate config + lint cues/ids/theme animations; no TTS/browser/writes; exit 1 on invalid | instant |
| `narova synth` | Python TTS → `out/audio/NN.wav`, `out/audio/full.wav`, `out/timings.json`; creates the venv on first run | piper: ~real-time vs narration length; xtts/qwen: slower + one-time 1–2GB model |
| `narova compose` | timings + audio + config → `out/hf/` (a HyperFrames project) | <1s |
| `narova build` | synth + compose + `npx hyperframes render` → `out/video.mp4` | synth cost + render (~1-2x video length); first run downloads the HyperFrames CLI |
| `narova preview` | compose, then HyperFrames Studio on `out/hf` | stays alive until Ctrl-C |
| `narova voices list\|get` | list / download TTS voices (delegates to the Python module) | network on `get` |
| `narova doctor` | check ffmpeg, ffprobe, python venv, narova_tts import, npx hyperframes; exit 1 if missing | first run downloads the HyperFrames CLI |

`narova render` was removed in 0.3.0 (use `compose` or `build`).

## Flags

- `--backend piper|xtts|qwen` — override every voice's TTS backend. Default piper.
- `--reuse` — skip synthesis, reuse existing `out/audio` + `out/timings.json`.
  Use when only `body`/theme changed and `vo` text did not.
- `--tempo N` — narration speed (pitch-preserving ffmpeg atempo, e.g. 1.18).
- `--size 16:9|1:1|9:16` — frame aspect override.
- `--fps N` / `--quality draft|standard|high` — HyperFrames render settings.
- `--voice-a <s>` / `--voice-b <s>` — map onto the first two declared voices.

## What lands in `out/` (all regenerated — never hand-edit)

```
out/
├── narration.json         # scenes → the TTS contract
├── config.resolved.json   # the validated config the pipeline used
├── audio/NN.wav|mp3       # per-scene narration
├── audio/full.wav         # the concatenated narration track
├── timings.json           # word/turn timestamps, rescaled to real audio duration
├── hf/                    # the generated HyperFrames project
│   ├── index.html         #   composition (clips, captions, timeline)
│   ├── assets/narration.wav
│   └── package.json       #   pins the hyperframes version
└── video.mp4              # final render (build only)
```

## Typical loops

- Iterate on visuals: edit config → `check` → `compose` → `preview` (Studio).
- Re-render after visual-only edits: `build --reuse` (skips TTS).
- Change any `vo` text: full `build` (audio + timings must be re-made).
- Validate the generated project like any HyperFrames project (in `out/hf`):
  `npx hyperframes lint`, `npx hyperframes check`,
  `npx hyperframes snapshot --at <t1,t2>` (word midpoints from timings.json).
- Verify a finished build: `ffprobe -v error -show_entries format=duration -of
  default=noprint_wrappers=1:nokey=1 out/video.mp4` ≈ same for
  `out/audio/full.wav` (± 0.15s).
