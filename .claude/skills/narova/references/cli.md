# CLI reference

Project-reading commands (`check`, `render`, `synth`, `build`, `preview`)
take `--project <dir>` (default `.`) and `--config <file>`; the ones that
write take `--out <dir>` (default `<project>/out`). `init` takes a positional
directory instead; `voices` and `doctor` need no config. Run from the project
directory or pass `--project`.

| Command | Does | Cost |
|---------|------|------|
| `narova init <dir>` | scaffold: config + one example scene + README + .gitignore (never overwrites) | instant |
| `narova check` | validate config + lint `data-cue` refs; no TTS/Chrome/writes; exit 1 on invalid | instant |
| `narova render` | scenes → `out/player.html`, `out/record.html`, `out/narration.json`, `out/config.resolved.json` | <1s |
| `narova synth` | narration → `out/audio/NN.{wav,mp3}` + `out/timings.json`, injected into player (Python TTS) | piper: ~real-time vs narration length; xtts: much slower + one-time ~1.9GB model |
| `narova build` | full pipeline → `out/video.mp4` + playable `out/player.html` | synth cost + capture (one Chrome shot per word onset; a minute-long video is a few hundred frames) + fast ffmpeg assemble |
| `narova preview` / `serve` | range-capable server for `out/` (seekable mp4, player, landing page) | stays alive; `--port N`, default 8080 |
| `narova voices list\|get` | list / download TTS voices (delegates to the Python module) | network on `get` |
| `narova doctor` | check ffmpeg, ffprobe, Chrome, python venv, narova_tts import; exit 1 if missing | instant |

## Flags

- `--backend piper|xtts` — override every voice's TTS backend. Default piper.
- `--reuse` — skip synthesis, reuse existing `out/audio` + `out/timings.json`.
  Use when only `body`/`caption`/theme changed and `vo` text did not.
- `--workers N` — capture parallelism (default 10).
- `--tempo N` — narration speed (pitch-preserving ffmpeg atempo, e.g. 1.18).
- `--size 16:9|1:1|9:16` — frame aspect override.
- `--voice-a <s>` / `--voice-b <s>` — map onto the first two declared voices.
- `--version` — print version (this skill needs >= 0.2.0).

## What lands in `out/` (all regenerated — never hand-edit)

```
out/
├── player.html            # interactive, self-contained (audio+timings embedded after synth)
├── record.html            # capture variant (empty audio, same timings)
├── narration.json         # scenes → the TTS contract
├── config.resolved.json   # the validated config the pipeline used
├── audio/NN.wav|mp3       # per-scene narration
├── timings.json           # word/turn timestamps, rescaled to real audio duration
├── frames/                # captured keyframes (build only)
└── video.mp4              # final render (build only)
```

## Typical loops

- Iterate on visuals: edit config → `check` → `render` → open `player.html`.
- Iterate on visuals after a full build: edit → `check` → `build --reuse`
  (skips TTS; re-captures and re-assembles).
- Change any `vo` text: full `build` (audio + timings must be re-made).
- Verify a finished build: `ffprobe -v error -show_entries format=duration -of
  default=noprint_wrappers=1:nokey=1 out/video.mp4` → nonzero seconds.
