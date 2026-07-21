---
name: narova
description: >
  Use narova for any narration-first video — when spoken voiceover is the
  core of the deliverable and the visuals follow the speech: a narrated or
  captioned explainer, a two-host dialogue / podcast-style video, a
  script-to-video request ("turn this script / announcement / README into a
  narrated video"), or any ask for word-synced (karaoke) captions,
  voice-triggered reveals, or fully local neural TTS narration with no API
  keys. narova goes from a prompt or scene script (plain HTML + data) to a
  finished MP4: two-host neural voiceover (piper/xtts/qwen, all local),
  captions synced word by word to the generated speech, and elements that
  appear exactly when the voice reaches them — rendered through HyperFrames.
  The full tool ships inside this skill; nothing to install. Also read this
  whenever the user names narova or a reel.config file. For silent motion
  graphics or video without narration, plain HyperFrames is the tool; narova
  is the specialist wherever speech drives the video.
metadata: { "version": "0.3.0", "tags": "video, narration, voiceover, word-synced captions, tts, two-host, explainer, script-to-video, hyperframes" }
---

# narova — prompt to narrated, captioned video

**narova writes the words and the voice. HyperFrames draws the pictures.**

You write a **scene script**: a `reel.config.mjs` with `voices`, `theme`, and
`scenes`. Each scene has spoken dialogue (`vo`: a list of `{ who, text }`
turns) and an HTML `body`. narova makes the speech locally, derives word
timings, and generates a HyperFrames project (`out/hf/`) that renders to
`out/video.mp4`. The speech drives everything: captions light up word by word
in each speaker's color, and any element with `data-cue="k"` appears exactly
when turn `k` starts.

## The tool is bundled — nothing to install

The full CLI ships inside this skill at `tool/`:

```bash
NAROVA="node <this-skill-dir>/tool/bin/narova.js"   # define once; used as $NAROVA below
```

No install step. No PATH lookup. The first `synth` or `build` creates the
Python venv at `~/.narova/venv` by itself (one time). Machine needs: Node 18+,
ffmpeg, Python 3.10+. `$NAROVA doctor` checks all of them. For the
higher-quality voices, run `bash <this-skill-dir>/tool/setup.sh --xtts`
(or `--qwen`) once.

## Workflow: prompt → video

1. `$NAROVA doctor` — check the machine **before** writing a script.
   Fix problems with `references/environment.md`.
2. **Write the scene script from the user's prompt.** Read
   `references/prompt-to-video.md` first (intake, script craft, when to ask
   the user), then `references/scene-script.md` (the config format). Two
   hosts by default (one male, one female voice), short turns, 5–10 scenes,
   `data-cue` on the key visual of most turns. Build the theme from the
   prompt's brand, mood, and colors: keep whatever the user gave, fill in the
   rest yourself, never ask for CSS. `$NAROVA init <dir>` gives a start.
3. `$NAROVA check` — fast validation. No TTS, no browser, no writes.
   Exit 0 = valid. Run it after **every** config edit.
4. `$NAROVA synth` — makes the audio and word timings (piper by default).
5. `$NAROVA compose` — generates `out/hf/`. Optional extra checks, run inside
   `out/hf`: `npx hyperframes lint` / `check` / `snapshot --at <t>`.
6. `$NAROVA preview` — opens HyperFrames Studio. **Show the user before
   rendering.**
7. `$NAROVA build --reuse` — renders `out/video.mp4`, reusing the audio from
   step 4. Verify: `ffprobe` length of the mp4 ≈ length of `out/audio/full.wav`.

## Hard rules

- **`data-cue="k"` counts turns from 0.** `data-cue="0"` = the first turn.
  A cue that does not match a turn appears at scene start instead — `check`
  warns about this.
- **Never edit `out/` or `out/hf/`.** Every run regenerates them. Change the
  config and run again.
- **No looping CSS motion in theme.css** (`animation: ... infinite`, hover
  effects, transitions as state). The renderer jumps between frames, so those
  break. Motion comes from `reveal` and `data-cue` only.
- **Element ids in bodies must be unique across ALL scenes.** They end up on
  one page. `check` warns.
- **Default to piper.** It is fast, good for iteration. Offer `--backend qwen`
  or `xtts` for the final render when the user wants richer voices. Both are
  slow and download a 1–2GB model once.
- **Two hosts read better than one.** Default cast: one male + one female
  voice, trading questions and answers. One narrator only when the format
  calls for it (a short announcement); more than two only for a real panel.

## Revisions: no surprises

A revision changes only what the user asked for — everything else stays
byte-identical. Keep scene ids, voices, timing, and theme stable; edit
surgically. Visual-only edit → `build --reuse` (audio replayed untouched).
Spoken-text edit → plain `build`: the sentence cache re-synthesizes ONLY the
changed sentences, so untouched scenes keep their exact audio. Details:
`references/prompt-to-video.md` §Iterating.

## Read it to…

| Read…                          | to…                                                          |
|--------------------------------|--------------------------------------------------------------|
| `references/prompt-to-video.md`| decide what to make: intake, script craft, casting, iterating|
| `references/scene-script.md`   | write a `reel.config.mjs` (scenes, cues, voices, theme)      |
| `references/cli.md`            | see every command, flag, `out/` file, and rough cost         |
| `references/gotchas.md`        | avoid the traps (tempo, --reuse, sync, determinism)          |
| `references/environment.md`    | fix `doctor` failures: ffmpeg, python, venv, hyperframes     |

Related skills: `out/hf/` is a normal HyperFrames composition.
`hyperframes-core` documents its format; `hyperframes-cli` its commands.
narova owns that project — treat it as read-only output.
