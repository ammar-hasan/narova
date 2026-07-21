---
name: narova
description: >
  Use narova for any narration-first video — whenever spoken voiceover is the
  spine of the deliverable and the visuals should follow the speech: a narrated
  or captioned explainer, a two-host dialogue / podcast-style video, a
  script-to-video request ("turn this script / announcement / README into a
  narrated video"), or any ask for word-synced (karaoke) captions,
  voice-triggered reveals, or fully local neural TTS narration with no API
  keys. narova goes from a prompt or scene script (plain HTML + data) to a
  finished MP4: two-host neural voiceover (piper/xtts, local), word-level
  caption sync derived from the generated speech, elements that reveal exactly
  when the voice reaches them — rendered through HyperFrames. Also read this
  whenever the user names narova or a reel.config file. For silent motion
  graphics or video without narration, plain HyperFrames is the tool; narova
  is the specialist wherever speech drives the video.
metadata: { "version": "0.3.0", "tags": "video, narration, voiceover, word-synced captions, tts, two-host, explainer, script-to-video, hyperframes" }
---

# narova — prompt to narrated, captioned video

## The model in one paragraph

You write a **scene script**: a `reel.config.mjs` exporting `voices`, `theme`,
and `scenes`, where each scene has a spoken `vo` (an ordered list of
`{ who, text }` dialogue turns) and an HTML `body`. narova synthesizes the
speech locally (piper by default — no API keys), derives word/turn timings,
and **generates a HyperFrames project** (`out/hf/`) that HyperFrames renders
to `out/video.mp4`. Speech drives everything: karaoke captions highlight
word-by-word in the speaker's color, and any body element with `data-cue="k"`
reveals exactly when the voice reaches turn index `k`.
**narova writes the words and the voice; HyperFrames draws the pictures.**

## The tool is bundled — nothing to install

The whole narova CLI ships inside this skill at `tool/`. Invoke it as:

```bash
NAROVA="node <this-skill-dir>/tool/bin/narova.js"   # define once, use everywhere
```

There is no install step and nothing to look for on PATH. On the first
`synth`/`build`, the CLI creates its Python venv automatically at
`~/.narova/venv` (piper backend, one-time). System needs: Node 18+, ffmpeg,
python3.10+ — `$NAROVA doctor` checks all of them. For the higher-quality
backends run `bash <this-skill-dir>/tool/setup.sh --xtts` / `--qwen` once.

## Workflow: prompt → video

1. `narova doctor` — verify ffmpeg, the Python venv, and `npx hyperframes`
   **before** investing in a script. Fix per `references/environment.md`.
2. **Draft the scene script from the user's prompt** — read
   `references/scene-script.md`. Two hosts, short turns, 5–10 scenes,
   `data-cue` on the key visual of most turns. Derive the theme from the
   prompt's brand/mood/colors (respect any fragment the user gave; build the
   rest on the fly — never ask for CSS). `narova init <dir>` gives a scaffold
   to start from.
3. `narova check` — fast validation (no TTS, no browser, no writes). Exit 0 =
   valid; warnings still print. Run it after **every** config edit.
4. `narova synth --backend piper` — audio + word timings.
5. `narova compose` — generate `out/hf/`. Optionally validate it like any
   HyperFrames project: `npx hyperframes lint` / `check` / `snapshot --at <t>`
   in `out/hf`.
6. `narova preview` — opens HyperFrames Studio; **show the user before
   rendering**.
7. `narova build --reuse` — render `out/video.mp4` (reuses the synth from
   step 4). Verify: `ffprobe out/video.mp4` duration ≈ `out/audio/full.wav`.

## Hard rules

- **`data-cue="k"` is a 0-based turn index** into that scene's `vo`
  (`data-cue="0"` = first turn). A cue that doesn't resolve reveals at scene
  entry instead — `narova check` warns.
- **Never edit `out/` or `out/hf/`** — both are regenerated every run. The
  reel.config is the single source of truth; change it and re-run.
- **No `animation: … infinite` (or hover/transition-driven state) in
  theme.css.** HyperFrames renders by seeking frames; wall-clock CSS motion is
  nondeterministic. Motion belongs to narova's generated timeline (`reveal` /
  `data-cue`).
- **Element ids in scene bodies must be unique across ALL scenes** — the page
  is assembled into one composition. `check` warns.
- **Default to piper.** xtts is higher quality but much slower and downloads a
  ~1.9GB model once; only choose it when the user asks for maximum voice
  quality and accepts the wait.
- **Two hosts read better than one.** Prefer two voices (`a`/`b`) trading
  lines with questions and banter over a single narrator monologue.

## Read it to…

| Read…                        | to…                                                      |
|------------------------------|----------------------------------------------------------|
| `references/scene-script.md` | write or edit a `reel.config.mjs` (scenes, voices, cues) |
| `references/cli.md`          | know every command, flag, `out/` artifact, and rough cost |
| `references/gotchas.md`      | avoid the traps (tempo, --reuse, sync, determinism)      |
| `references/environment.md`  | fix `doctor` failures: ffmpeg, venv, npx hyperframes     |

Related skills: the generated `out/hf/` is a standard HyperFrames composition —
`hyperframes-core` documents its contract, `hyperframes-cli` its commands.
narova owns the timeline in that project; treat it as read-only output.
