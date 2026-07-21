# CLI reference

`narova` below means the bundled tool, spelled out in full because agent
shells do not persist variables between calls:

```bash
node <skill-dir>/tool/bin/narova.js <command>
```

Commands read the project from the current folder, or from `--project <dir>`.
`--config <file>` picks an exact config. Output goes to `<project>/out`, or
`--out <dir>`.

| Command | Does | Cost |
|---------|------|------|
| `narova init <dir>` | new project: config + assets/ + one scene + README + .gitignore. Never overwrites. | instant |
| `narova check` | validate config, lint cues / ids / theme CSS, sniff `vo` for unledgered stats & superlatives (warns when no `claims.md`). No TTS, browser, or writes. Exit 1 if invalid. | instant |
| `narova synth` | Python TTS → `out/audio/*.wav`, `out/audio/full.wav`, `out/timings.json`. Creates the venv on first run. | piper: fast; xtts/qwen: slow + one-time 1–2GB model |
| `narova compose` | config + timings + audio → `out/hf/` (a HyperFrames project). Warns if a detached preview is still serving the old build. | under 1s |
| `narova build` | synth + compose + `npx hyperframes render` → `out/video.mp4` | synth cost + render (~1–2x video length) |
| `narova preview` | compose, print the Studio URL, then run it in the foreground | runs until Ctrl-C |
| `narova preview --detach` | compose, keep Studio alive, print URL + PID + log. If one is already running it is restarted on the new build (same port) — Studio does not hot-reload. | until `preview --stop` |
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
- `--port N` — Studio port (default 3002).
- `--detach` / `preview --stop` — start or stop persistent Studio.
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
│   ├── assets/            #   project assets + narration.wav
│   └── package.json       #   pins the hyperframes version
└── video.mp4              # the final video (build only)
```

## Common loops

- Edit visuals: change config → `check` → `compose` → `preview`.
- Re-render after visual edits: `build --reuse` (skips TTS).
- Changed any spoken text: full `build`. The sentence cache
  (`~/.narova/cache/sentences/`) re-synthesizes ONLY the changed sentences —
  untouched scenes keep byte-identical audio. This is the iteration
  consistency guarantee; don't reword lines the user didn't ask you to touch.
- Extra checks on the generated page, inside `out/hf`:
  `npx hyperframes lint`, `npx hyperframes check`,
  `npx hyperframes snapshot --at <t1,t2> -o <directory>` (pick word times
  from timings.json). Snapshot `-o` / `--output` takes a **directory** — the
  frames land inside it — never `--out`. Box-based overlap lint misses
  oversized display type bleeding over neighbors; the snapshot pass is what
  catches it.
- Studio preview does not hot-reload. After any `compose`/`build`, re-run
  `narova preview --detach` — it restarts the detached server on the new
  build (same port) instead of failing or serving the old one.
- Verify the result: mp4 length ≈ `out/audio/full.wav` length (±0.15s):
  `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <file>`
