---
name: narova
description: >
  Use narova for narration-first video: narrated or captioned explainers,
  multi-host dialogue (0 to N narrators), prompt/script/README-to-video,
  narrated product demos and sales walkthroughs with real browser actions,
  videos sourced from web pages and agent-readable sources (product sites,
  articles, docs, repositories), word-synced karaoke captions,
  voice-triggered reveals, background beds and sound effects, per-platform
  presets and comprehensive export profiles (TikTok/Reels/Shorts/LinkedIn/X/YouTube),
  SRT/VTT sidecar captions, hook A/B variants, or local neural TTS with no
  API keys. It turns a prompt or scene script into an MP4 with local
  piper/xtts/qwen/chatterbox voiceover, word-level captions, and
  speech-timed visuals rendered through HyperFrames. The full tool ships
  inside the skill. Also use whenever the user names narova or a
  reel.config file. For silent motion graphics without narration, use plain
  HyperFrames instead.
license: MIT
compatibility: >
  Requires Node.js 18+, Python 3.10+ and ffmpeg.
  First-time model and renderer setup requires internet access.
  Product walkthrough capture optionally requires agent-browser.
metadata:
  author: ammar-hasan
  version: "0.16.0"
---

# narova — prompt to narrated, captioned video

**narova writes the words and the voice. HyperFrames draws the pictures.**

Pinned to the version above — do NOT auto-update. Check for a newer release
without modifying anything:
`curl -s https://raw.githubusercontent.com/ammar-hasan/narova/main/skills/narova/SKILL.md | grep 'version:' | head -1`
Only upgrade on explicit user request.

You write a **scene script**: a `reel.config.mjs` with `voices`, `theme`, and
`scenes`. Each scene has spoken dialogue (`vo`: a list of `{ who, text }`
turns) and an HTML `body`. narova makes the speech locally, derives word
timings, and generates a HyperFrames project (`out/hf/`) that renders to
`out/video.mp4`. The speech drives everything: captions light up word by word
in each speaker's color, and any element with `data-cue="k"` appears exactly
when turn `k` starts.

Or bring your own recording with `narration.file` and `narration.wordTimings`.

## The tool ships bundled — nothing to install

```bash
node <this-skill-dir>/tool/bin/narova.js <command>
```

Agent shells don't persist environment variables between calls, so spell the
command out every time. No install step. First `synth` or `build` creates
`~/.narova/venv`. `doctor` checks requirements (Node 18+, ffmpeg, Python 3.10+).
For richer voices: `bash <this-skill-dir>/tool/setup.sh --xtts` (or `--qwen`,
`--chatterbox` for voice cloning).

External TTS providers are optional registered companion skills — see
`narova-elevenlabs`, `narova-openai`, or `references/cli.md` §providers.

## Workflow: prompt → video

0. **Intake** — `references/prompt-to-video.md` §Intake.
1. `doctor` — check the machine. Fix with `references/environment.md`.
2. `init generated/<slug>` + write `reel.config.mjs`. Format: `references/scene-script.md`.
   Creative direction: `references/prompt-to-video.md`. URL sources: `ingest <url>`
   first, then `references/url-to-source.md`.
3. Write `claims.md` — every factual claim must trace to a source.
4. `check` — fast validation (no TTS). Run after every config edit.
5. `synth` — audio & word timings. Walkthroughs: follow with `walkthrough capture <id>`.
6. `compose` — generates `out/hf/`. Run `narova shots` for visual QA.
7. `preview --detach` — show before rendering.
8. `build` — renders `out/video.mp4`. Verify: audio `dur` by eye, then ffprobe.

For step-by-step walkthroughs, loop through screens semantically
(`walkthrough explore <id>`) before writing action steps. Treat `walkthrough capture`
as a source step — compose/build never replay it. See
`references/product-walkthroughs.md`.

## Key gotchas

- **No looping CSS in theme.css.** The renderer jumps between frames:
  `animation: ... infinite`, hover effects, and CSS transitions break.
  Motion comes from the timeline: `reveal`/`data-cue` entrances and
  `data-*` animators (`data-grow`, `data-draw`, `data-count`, `data-delay`).
  See `references/scene-script.md` §Motion.
- **SVG ids are namespaced per scene** at compose (`<sceneId>--<id>`). Keep
  ids unique within one scene; style with classes, not `#id` in theme.css.
  Reusable `<defs>` can repeat ids across scenes safely.
- **Never edit `out/hf/`.** Every compose regenerates it. Change the config.
- **Sourcing is checked; balance is not.** `check` gates claims against
  `claims.md`, but a one-sided narrative built from sourced claims passes
  clean. For contested topics, ledger the major perspectives and re-read the
  script for framing — balance is the author's job.

Read `references/gotchas.md` for the full list (tempo tuning, Qwen runaway,
XTTS stretching, display-type overflow, walkthrough staleness, sentence cache,
agent-shell pitfalls, and more).

## Revisions

A revision changes only what the user asked for — everything else stays
byte-identical. Edit surgically. Visual-only edit → `build --reuse`.
Spoken-text edit → plain `build` (sentence cache re-synthesizes only changed
sentences; untouched scenes are byte-identical). See
`references/prompt-to-video.md` §Iterating.

## Read it to…

| Read…                          | to…                                                          |
|--------------------------------|--------------------------------------------------------------|
| `references/prompt-to-video.md` | intake, script craft, casting, iterating                    |
| `references/url-to-source.md`   | classify a source page and extract factual & visual evidence |
| `references/scene-script.md`   | write a `reel.config.mjs` (scenes, cues, voices, theme)      |
| `references/product-walkthroughs.md` | explore, capture, compose, and QA product demos       |
| `references/stock-assets.md`  | source photos, clips, music, SFX, fonts, icons from CLI      |
| `references/audio.md`          | background beds, spot SFX, forced word alignment             |
| `references/cli.md`            | every command, flag, `out/` file, and rough cost              |
| `references/gotchas.md`        | avoid the traps (tempo, reuse, sync, models, lint)          |
| `references/environment.md`    | fix `doctor` failures: ffmpeg, python, venv, hyperframes     |

For Urdu dialogue, use the `urdu-voice-director` skill before finalizing `vo` text.

Related: `out/hf/` is a HyperFrames composition. `hyperframes-core` documents
its format; `hyperframes-cli` its commands. narova owns that project — treat
it as read-only output.
