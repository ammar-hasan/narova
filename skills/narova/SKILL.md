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
  finished MP4: two-host neural voiceover (piper/xtts/qwen, all local),
  word-level caption sync derived from the generated speech, and elements that
  reveal exactly when the voice reaches them — rendered through HyperFrames.
  The full tool ships inside this skill; nothing to install. Also read this
  whenever the user names narova or a reel.config file. For silent motion
  graphics or video without narration, plain HyperFrames is the tool; narova
  is the specialist wherever speech drives the video.
metadata: { "version": "0.3.0", "tags": "video, narration, voiceover, word-synced captions, tts, two-host, explainer, script-to-video, hyperframes" }
---

# narova — prompt to narrated, captioned video

**narova writes the words and the voice; HyperFrames draws the pictures.**

You write a **scene script**: a `reel.config.mjs` exporting `voices`, `theme`,
and `scenes`, where each scene has a spoken `vo` (an ordered list of
`{ who, text }` dialogue turns) and an HTML `body`. narova synthesizes the
speech locally, derives word/turn timings, and generates a HyperFrames project
(`out/hf/`) that renders to `out/video.mp4`. Speech drives everything: karaoke
captions highlight word-by-word in each speaker's color, and any body element
with `data-cue="k"` reveals exactly when the voice reaches turn index `k`.

## The tool is bundled — nothing to install

The whole narova CLI ships inside this skill at `tool/`:

```bash
NAROVA="node <this-skill-dir>/tool/bin/narova.js"   # define once; used as $NAROVA below
```

No install step, no PATH lookup. The first `synth`/`build` creates the Python
venv automatically at `~/.narova/venv` (piper backend, one-time). System
needs: Node 18+, ffmpeg, Python 3.10+ — `$NAROVA doctor` checks all of them.
For the higher-quality backends run
`bash <this-skill-dir>/tool/setup.sh --xtts` (or `--qwen`) once.

## Workflow: prompt → video

1. `$NAROVA doctor` — verify ffmpeg, Python, and `npx hyperframes` **before**
   investing in a script. Fix per `references/environment.md`.
2. **Draft the scene script from the user's prompt** — read
   `references/scene-script.md` first. Two hosts, short turns, 5–10 scenes,
   `data-cue` on the key visual of most turns. Derive the theme from the
   prompt's brand/mood/colors: respect any fragment the user gave, build the
   rest yourself, never ask for CSS. `$NAROVA init <dir>` gives a scaffold.
3. `$NAROVA check` — fast validation (no TTS, no browser, no writes). Exit 0 =
   valid; warnings still print. Run it after **every** config edit.
4. `$NAROVA synth` — audio + word timings (piper by default).
5. `$NAROVA compose` — generate `out/hf/`. Optionally validate it like any
   HyperFrames project: `npx hyperframes lint` / `check` / `snapshot --at <t>`
   in `out/hf`.
6. `$NAROVA preview` — opens HyperFrames Studio; **show the user before
   rendering**.
7. `$NAROVA build --reuse` — render `out/video.mp4` (reuses the synth from
   step 4). Verify: `ffprobe` duration of `out/video.mp4` ≈ `out/audio/full.wav`.

## Hard rules

- **`data-cue="k"` is a 0-based turn index** into that scene's `vo`
  (`data-cue="0"` = first turn). A cue that doesn't resolve reveals at scene
  entry instead — `check` warns.
- **Never edit `out/` or `out/hf/`** — both are regenerated every run. The
  reel.config is the single source of truth; change it and re-run.
- **No wall-clock CSS motion in theme.css** (`animation: … infinite`, hover,
  transition-driven state). HyperFrames renders by seeking frames. Motion
  belongs to narova's generated timeline (`reveal` / `data-cue`).
- **Element ids in scene bodies must be unique across ALL scenes** — the page
  is assembled into one composition. `check` warns.
- **Default to piper** (fast iteration). Offer `--backend qwen` or `xtts` for
  the final render when the user wants richer voices — both are slower and
  download a 1–2GB model once.
- **Two hosts read better than one.** Prefer two voices (`a`/`b`) trading
  lines with questions and banter over a single narrator monologue.

## Read it to…

| Read…                        | to…                                                       |
|------------------------------|-----------------------------------------------------------|
| `references/scene-script.md` | write a `reel.config.mjs` (scenes, cues, voices, theme)   |
| `references/cli.md`          | know every command, flag, `out/` artifact, and rough cost |
| `references/gotchas.md`      | avoid the traps (tempo, --reuse, sync, determinism)       |
| `references/environment.md`  | fix `doctor` failures: ffmpeg, python, venv, hyperframes  |

Related skills: the generated `out/hf/` is a standard HyperFrames composition —
`hyperframes-core` documents its contract, `hyperframes-cli` its commands.
narova owns the timeline in that project; treat it as read-only output.
