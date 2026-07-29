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
| `narova check` | validate config, lint cues / ids / data-* attrs / theme CSS, sniff `vo` for unledgered stats & superlatives (warns when no `claims.md`). The `ok:` line ends with an **estimated narration length** at the configured tempo — the knob for hitting a target duration before any audio exists. No TTS, browser, or writes. `--strict` checks that every claim has a ledger entry. `--release` adds a build gate: remote deps, missing claims, unsupported HTML, black frames, clipped audio. Exit 1 on release-mode failures. | instant |
| `narova compile` | compile `reel.config.*` → `out/manifest.json` (versioned project manifest). The manifest is a self-contained snapshot of every datum the pipeline needs — also written automatically by `synth`, `compose`, and `build`. | instant |
| `narova plan` | compare current `reel.config.*` against the last `out/manifest.json` and classify what changed. Prints change level (none/config/visual/audio/full), affected scenes, and which pipeline stages will rebuild. | instant |
| `narova synth` | Python TTS → `out/audio/*.wav`, `out/audio/full.wav`, `out/timings.json`. Creates the venv on first run. Writes and enriches `manifest.json` with measured word timings. | piper: fast; xtts/qwen/chatterbox: slow + one-time 1–2GB model |
| `narova compose` | config + timings + audio → `out/hf/` (a HyperFrames project) + `out/captions.srt`/`.vtt`, and prints the per-scene start table. A live detached preview is restarted on the new build automatically. | under 1s |
| `narova captions` | (re)write `out/captions.srt` + `out/captions.vtt` from the existing `out/timings.json` — one cue per sentence, global time. No recompose. | instant |
| `narova shots` | snapshot one QA frame per scene (mid-scene) into `out/hf/snapshots/review/` via `hyperframes snapshot`. `--at t1,t2,…` picks explicit times (see the scene table from `compose`). | seconds (opens a browser) |
| `narova build` | synth + compose + `npx hyperframes render` → `out/video.mp4` (+ captions). `--variant <id>` renders `out/video-<id>.mp4` instead; `--variants` renders the base plus one `out/video-<id>.mp4` per declared variant. Restarts a live detached preview afterwards. | synth cost + render (~1–2x video length) |
| `narova preview` | compose, print the Studio URL, then run it in the foreground | runs until Ctrl-C |
| `narova preview --detach` | compose, keep Studio alive, print URL + PID + log. If one is already running it is restarted on the new build (same port) — Studio does not hot-reload. | until `preview --stop` |
| `narova voices list\|get` | list or download TTS voices. piper `list` shows a spread of starter voices; `get <name>` downloads any voice from the piper catalog. | network on `get` |
| `narova doctor` | check ffmpeg, python, venv, hyperframes. Exit 1 if something is missing. | first run downloads the HyperFrames CLI |
| `narova release save <name>` | save `out/manifest.json` as a named release in `~/.narova/releases/`. Releases are content-hashed snapshots you can compare, restore, and remove. | instant |
| `narova release list` | list all saved releases with size and date. | instant |
| `narova release restore <name>` | copy a saved release back to `out/manifest.json`. | instant |
| `narova release remove <name>` | delete a saved release. | instant |

`narova render` was removed in 0.3.0. Use `compose` or `build`.

## Flags

- `--backend piper|xtts|qwen|chatterbox` — TTS backend for all voices. Default
  piper. `chatterbox` clones a voice: set each voice's `speaker` to an ABSOLUTE
  path to a clean 10–20s recording (install once: `tool/setup.sh --chatterbox`).
- `--reuse` — skip TTS, reuse `out/audio` + `out/timings.json`.
  Meant for visual-only edits; if the spoken text changed since the last
  synth, `--reuse` is ignored with a note and a full synth runs instead.
- `--tempo N` — speech speed (1.1–1.2 reads well).
- `--size 16:9|1:1|9:16` — frame shape.
- `--platform tiktok|reels|shorts|linkedin|x|youtube` — frame preset plus the target
  duration band `check` lints against. An explicit `--size` (or `config.size`)
  wins over the platform preset.
- `--variant <id>` — apply a declared hook variant (`config.variants`) as
  scene 1. Works with `check`, `synth`, `compose`, `build`; `build` renders
  `out/video-<id>.mp4` instead of `video.mp4`.
- `--variants` — `build` only: render the base `video.mp4` AND one
  `out/video-<id>.mp4` per declared variant, sequentially. The sentence-level
  TTS cache makes shared sentences free, so each extra pass only pays for the
  variant's scene-1 lines. With no variants declared it says so and builds
  just the base. Mutually exclusive with `--variant`.
- `--fps N`, `--quality draft|standard|high` — render settings.
- `--at t1,t2,…` — `shots`: explicit frame times in seconds.
- `--port N` — Studio port (default 3002).
- `--detach` / `preview --stop` — start or stop persistent Studio.
- `--voice-a <s>`, `--voice-b <s>` — replace the first two voices (add more voices directly in the config).
- `--deliverables` — `build` only: render per-platform export presets. The
  renderer produces the SAME composition at its authored aspect ratio; ffmpeg
  then scale+pads (pillarbox/letterbox) to each preset's target dimensions —
  this does NOT re-art-direct layouts. A 16:9 scene will appear as a
  letterboxed strip in a vertical deliverable. For true platform-specific
  compositions, render separate projects at each aspect ratio. Bare
  `--deliverables` renders `narova-standard` plus the single canonical preset
  for the configured platform (e.g. `youtube-1080p`, not 4K); use a
  comma-separated list of preset IDs (e.g. `youtube-1080p,reels-1080p`) to
  select specific profiles. Only `youtube-4k` passes its resolution to
  HyperFrames; all others render at the composition's natural size and are
  resized in ffmpeg.
- `--safe-area-guides` — `build` only, requires `--deliverables`: overlay
  TikTok safe-area zones as authoring hints on the TikTok deliverable (only
  the `tiktok-1080p` preset defines safe-area guides; a bare `narova build`
  ignores this flag).

## What lands in `out/` (never edit — regenerated every run)

```
out/
├── narration.json         # scenes → the TTS input
├── config.resolved.json   # the validated config
├── audio/NN.wav|mp3       # audio per scene
├── audio/full.wav         # all scenes joined — the narration track
├── timings.json           # word/turn times, scaled to the real audio
├── captions.srt|.vtt      # sentence-level captions, global time (compose/build/captions)
├── hf/                    # the generated HyperFrames project
│   ├── index.html         #   scenes, captions, timeline
│   ├── assets/            #   project assets + narration.wav
│   └── package.json       #   pins the hyperframes version
├── video.mp4              # the final video (build only)
└── video-<id>.mp4         # per-variant videos (build --variant/--variants)
```

`out/` is a single directory, so `synth`/`compose` reflect whichever variant
was selected last (plain = base, `--variant <id>` = that variant's scene 1).
Switching variants and re-running with `--reuse` is safe: the spoken text
differs, so `--reuse` is detected as stale, ignored with a note, and the
changed sentences re-synthesize (the sentence cache keeps the rest free).

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
