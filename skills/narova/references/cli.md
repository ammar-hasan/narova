# CLI reference

`narova` below means the bundled tool, spelled out in full because agent
shells do not persist variables between calls:

```bash
node <skill-dir>/tool/bin/narova.js <command>
```

Commands read the project from the current folder **or any parent folder** —
the nearest ancestor holding a `reel.config.*` wins, so commands work from
inside `out/` and `out/hf` too. `--project <dir>` picks an exact starting
folder, `--config <file>` an exact config. Output goes to `<project>/out`, or
`--out <dir>`.

| Command | Does | Cost |
|---------|------|------|
| `narova init <dir>` | new project: config + assets/ + one scene + README + .gitignore. Never overwrites; replacing the scaffold wholesale is the normal flow. | instant |
| `narova check` | validate config, lint cues / ids / data-* attrs / theme CSS, sniff `vo` for unledgered stats & superlatives (warns when no `claims.md`). The `ok:` line ends with an **estimated narration length** at the configured tempo — the knob for hitting a target duration before any audio exists. No TTS, browser, or writes. Exit 1 if invalid. | instant |
| `narova synth` | Python TTS → `out/audio/*.wav`, `out/audio/full.wav`, `out/timings.json`. Creates the venv on first run. | piper: fast; xtts/qwen: slow + one-time 1–2GB model |
| `narova compose` | config + timings + audio → `out/hf/` (a HyperFrames project), and prints the per-scene start table. A live detached preview is restarted on the new build automatically. | under 1s |
| `narova shots` | snapshot one QA frame per scene (mid-scene) into `out/hf/snapshots/review/` via `hyperframes snapshot`. `--at t1,t2,…` picks explicit times (see the scene table from `compose`). | seconds (opens a browser) |
| `narova build` | synth + compose + `npx hyperframes render` → `out/video.mp4`. Restarts a live detached preview afterwards. | synth cost + render (~1–2x video length) |
| `narova preview` | compose, print the Studio URL, then run it in the foreground | runs until Ctrl-C |
| `narova preview --detach` | compose, keep Studio alive, print URL + PID + log. If one is already running it is restarted on the new build (same port) — Studio does not hot-reload. | until `preview --stop` |
| `narova voices list\|get` | list or download TTS voices. piper `list` shows a spread of starter voices; `get <name>` downloads any voice from the piper catalog. | network on `get` |
| `narova doctor` | check ffmpeg, python, venv, hyperframes. Exit 1 if something is missing. | first run downloads the HyperFrames CLI |

`narova render` was removed in 0.3.0. Use `compose` or `build`.

## Flags

- `--backend piper|xtts|qwen` — TTS backend for all voices. Default piper.
- `--reuse` — skip TTS, reuse `out/audio` + `out/timings.json`.
  Meant for visual-only edits; if the spoken text changed since the last
  synth, `--reuse` is ignored with a note and a full synth runs instead.
- `--tempo N` — speech speed (1.1–1.2 reads well).
- `--size 16:9|1:1|9:16` — frame shape.
- `--fps N`, `--quality draft|standard|high` — render settings.
- `--at t1,t2,…` — `shots`: explicit frame times in seconds.
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

`timings.json` is keyed by scene id, all times **scene-local** seconds:

```
{ "<sceneId>": { "dur": 8.42,                  # scene length in seconds
                 "turns": [0.16, 3.1],          # start time of each vo turn
                 "words": [{"w":"Hi","t0":0.16,"t1":0.5,"who":"a","si":0}] } }
```

Scene i's global start is the sum of `dur` over scenes 0..i-1 — or just read
the scene table `narova compose` prints, or let `narova shots` pick mid-scene
times for you.

## Common loops

- Edit visuals: change config → `check` → `compose` → `preview`.
- Re-render after visual edits: `build --reuse` (skips TTS).
- Changed any spoken text: full `build`. The sentence cache
  (`~/.narova/cache/sentences/`) re-synthesizes ONLY the changed sentences —
  untouched scenes keep byte-identical audio. This is the iteration
  consistency guarantee; don't reword lines the user didn't ask you to touch.
  (`--reuse` with changed text is caught and ignored, so the wrong command
  degrades to the right one.)
- Visual QA: `narova shots` snapshots one mid-scene frame per scene into
  `out/hf/snapshots/review/` (`--at t1,t2` for explicit times; the `compose`
  scene table lists every start). Then LOOK at the frames — box-based overlap
  lint misses oversized display type bleeding over neighbors and content
  sliding under the topbar/caption band.
- Extra checks on the generated page, inside `out/hf`:
  `npx hyperframes lint`, `npx hyperframes check`,
  `npx hyperframes snapshot --at <t1,t2> -o <directory>`. Snapshot `-o` /
  `--output` takes a **directory** — the frames land inside it — never
  `--out`.
- Studio preview does not hot-reload, so `compose` and `build` restart a live
  detached preview on the new build automatically (same port). Manual
  equivalent: `narova preview --detach`.
- Verify the result: mp4 length ≈ `out/audio/full.wav` length (±0.15s):
  `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <file>`
