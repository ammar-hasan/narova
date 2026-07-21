# CLI reference

`narova` below means the bundled tool: `node <skill-dir>/tool/bin/narova.js`
(the `$NAROVA` shorthand from SKILL.md).

Commands read the project from the current folder, or from `--project <dir>`.
`--config <file>` picks an exact config. Output goes to `<project>/out`, or
`--out <dir>`.

| Command | Does | Cost |
|---------|------|------|
| `narova init <dir>` | new project: config + one scene + README + .gitignore. Never overwrites. | instant |
| `narova check` | validate config, lint cues / ids / theme CSS. No TTS, browser, or writes. Exit 1 if invalid. | instant |
| `narova synth` | Python TTS → `out/audio/*.wav`, `out/audio/full.wav`, `out/timings.json`. Creates the venv on first run. | piper: fast; xtts/qwen: slow + one-time 1–2GB model |
| `narova compose` | config + timings + audio → `out/hf/` (a HyperFrames project) | under 1s |
| `narova build` | synth + compose + `npx hyperframes render` → `out/video.mp4` | synth cost + render (~1–2x video length) |
| `narova preview` | compose, then open HyperFrames Studio | runs until Ctrl-C |
| `narova voices list\|get` | list or download TTS voices | network on `get` |
| `narova doctor` | check ffmpeg, python, venv, hyperframes. Exit 1 if something is missing. | first run downloads the HyperFrames CLI |

`narova render` was removed in 0.3.0. Use `compose` or `build`.

## Flags

- `--backend piper|xtts|qwen` — TTS backend for all voices. Default piper.
- `--reuse` — skip TTS, reuse `out/audio` + `out/timings.json`.
  Only when the spoken text did not change.
- `--tempo N` — speech speed (1.1–1.2 reads well).
- `--size 16:9|1:1|9:16` — frame shape.
- `--fps N`, `--quality draft|standard|high` — render settings.
- `--voice-a <s>`, `--voice-b <s>` — replace the first two voices.

## What lands in `out/` (never edit — regenerated every run)

```
out/
├── narration.json         # scenes → the TTS input
├── config.resolved.json   # the validated config
├── audio/NN.wav|mp3       # audio per scene
├── audio/full.wav         # all scenes joined — the narration track
├── timings.json           # word/turn times, scaled to the real audio
├── hf/                    # the generated HyperFrames project
│   ├── index.html         #   scenes, captions, timeline
│   ├── assets/narration.wav
│   └── package.json       #   pins the hyperframes version
└── video.mp4              # the final video (build only)
```

## Common loops

- Edit visuals: change config → `check` → `compose` → `preview`.
- Re-render after visual edits: `build --reuse` (skips TTS).
- Changed any spoken text: full `build`.
- Extra checks on the generated page, inside `out/hf`:
  `npx hyperframes lint`, `npx hyperframes check`,
  `npx hyperframes snapshot --at <t1,t2>` (pick word times from timings.json).
- Verify the result: mp4 length ≈ `out/audio/full.wav` length (±0.15s):
  `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <file>`
