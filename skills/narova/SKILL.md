---
name: narova
description: >
  Use narova for narration-first video: narrated or captioned explainers,
  two-host dialogue, prompt/script/README-to-video, videos sourced from any
  URL (product site, article, paper, docs, repository, or general page),
  word-synced karaoke captions, voice-triggered reveals, or local neural TTS
  with no API keys. It turns a prompt or scene script into an MP4 with local
  piper/xtts/qwen voiceover, word-level captions, and speech-timed visuals
  rendered through HyperFrames. The full tool ships inside the skill. Also
  use whenever the user names narova or a reel.config file. For silent motion
  graphics without narration, use plain HyperFrames instead.
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
2. **Create the project, then write the scene script.** In a repository, put
   generated projects under `generated/<descriptive-slug>/`, never loose at
   the repo root: `$NAROVA init generated/<slug>`. Keep editable source
   (`reel.config.mjs`, `theme.css`, `assets/`) and ignore `out/`.
   If the prompt names a URL, first read and follow
   `references/url-to-source.md`; classify the page before deciding whether
   brand, editorial, research, or technical evidence should drive the video.
   A search result or prose page summary is not source evidence. Then read
   `references/prompt-to-video.md` (intake and
   script craft) and `references/scene-script.md` (the config format). Two
   hosts by default (one male, one female voice), short turns, 5–10 scenes,
   `data-cue` on the key visual of most turns. Build the theme from the
   classified source evidence or the prompt's mood/colors: keep whatever the
   user gave, fill in the rest yourself, never ask for CSS.
   `$NAROVA init <dir>` gives a start.
3. `$NAROVA check` — fast validation. No TTS, no browser, no writes.
   Exit 0 = valid. Run it after **every** config edit.
4. `$NAROVA synth` — makes the audio and word timings (piper by default).
5. `$NAROVA compose` — generates `out/hf/`. Run `npx hyperframes check`
   inside `out/hf`; use `snapshot --at <t> -o <dir>` for visual checks.
6. `$NAROVA preview --detach` — keeps HyperFrames Studio alive and prints its
   exact URL, PID, and log path. Open the printed URL; use
   `$NAROVA preview --stop` afterward. **Show the user before rendering.**
7. `$NAROVA build --reuse` — renders `out/video.mp4`, reusing the audio from
   step 4. Verify: `ffprobe` length of the mp4 ≈ length of `out/audio/full.wav`.

## Hard rules

- **`data-cue="k"` counts turns from 0.** `data-cue="0"` = the first turn.
  A cue that does not match a turn appears at scene start instead — `check`
  warns about this.
- **Never edit `out/` or `out/hf/`.** Every run regenerates them. Change the
  config and run again.
- **Keep visual source in project `assets/`.** `compose` copies its contents
  to `out/hf/assets/`; use `src="assets/logo.svg"` or
  `url("assets/fonts/brand.woff2")`. Inline SVG and small `data:` URIs are
  also valid. Never depend on a remote URL during preview or render.
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
| `references/url-to-source.md`   | classify any URL and extract the right factual and visual evidence|
| `references/scene-script.md`   | write a `reel.config.mjs` (scenes, cues, voices, theme)      |
| `references/cli.md`            | see every command, flag, `out/` file, and rough cost         |
| `references/gotchas.md`        | avoid the traps (tempo, --reuse, sync, determinism)          |
| `references/environment.md`    | fix `doctor` failures: ffmpeg, python, venv, hyperframes     |

Related skills: `out/hf/` is a normal HyperFrames composition.
`hyperframes-core` documents its format; `hyperframes-cli` its commands.
narova owns that project — treat it as read-only output.
