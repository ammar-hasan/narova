---
name: narova
version: 0.7.9
description: >
  Use narova for narration-first video: narrated or captioned explainers,
  multi-host dialogue (0 to N narrators), prompt/script/README-to-video, videos sourced from any
  URL (product site, article, paper, docs, repository, or general page),
  word-synced karaoke captions, voice-triggered reveals, background beds and
  sound effects, per-platform exports (TikTok/Reels/Shorts/LinkedIn/X),
  SRT/VTT sidecar captions, hook A/B variants, or local neural TTS
  with no API keys. It turns a prompt or scene script into an MP4 with local
  piper/xtts/qwen/chatterbox voiceover, word-level captions, and speech-timed
  visuals rendered through HyperFrames. The full tool ships inside the skill.
  Also use whenever the user names narova or a reel.config file. For silent
  motion graphics without narration, use plain HyperFrames instead.
---

# narova — prompt to narrated, captioned video

**narova writes the words and the voice. HyperFrames draws the pictures.**

**Before you start:** check that this skill is up to date. Run
`npx skills update narova -g` — it re-fetches from GitHub, no risk to
existing work. If the version in the frontmatter above is older than what's
on `main`, you're running stale code and bugs you hit may already be fixed.
You can check the live version at any time:
`curl -s https://raw.githubusercontent.com/ammar-hasan/narova/main/skills/narova/SKILL.md | head -5`

You write a **scene script**: a `reel.config.mjs` with `voices`, `theme`, and
`scenes`. Each scene has spoken dialogue (`vo`: a list of `{ who, text }`
turns) and an HTML `body`. narova makes the speech locally, derives word
timings, and generates a HyperFrames project (`out/hf/`) that renders to
`out/video.mp4`. The speech drives everything: captions light up word by word
in each speaker's color, and any element with `data-cue="k"` appears exactly
when turn `k` starts.

## The tool is bundled — nothing to install

The full CLI ships inside this skill at `tool/`. Agent shells do NOT persist
environment variables between calls, so spell the command out every time
(a `NAROVA=...` assignment will be gone by the next call):

```bash
node <this-skill-dir>/tool/bin/narova.js <command>
```

No install step. No PATH lookup. The first `synth` or `build` creates the
Python venv at `~/.narova/venv` by itself (one time). Machine needs: Node 18+,
ffmpeg, Python 3.10+. `... doctor` checks all of them. For the
higher-quality voices, run `bash <this-skill-dir>/tool/setup.sh --xtts`
(or `--qwen`) once. To clone a specific voice from a recording, install the
chatterbox backend once: `bash <this-skill-dir>/tool/setup.sh --chatterbox`.

## Workflow: prompt → video

### 0 — INTAKE: Recommend, don't interrogate

The user came to you for a video, not a questionnaire. Your job is to
make it great — pick the right defaults, recommend what will lift the
output, and only ask when there's a genuine trade-off the user should
weigh in on.

**The mindset:** You are a consultant, not a menu. Analyze the prompt
deeply. For every narova parameter, decide the best value for THIS
particular video — then state it as your recommendation with a short
why. The user should only need to say "yes" or tweak one thing.

**How to recommend (not ask):**
- *"For a product launch on TikTok, I'd use a single energetic female
  narrator (Serena, xtts for richer quality) with a dark theme and your
  brand's blue as the accent. The hook should land in the first 200ms
  so I'll keep the intro tight. Want me to go with that?"*
- Only ask the user when two genuinely good paths exist and the
  trade-off is subjective — e.g. formal vs casual tone, one narrator
  vs a dialogue. Even then, give your pick: *"I'd go with a dialogue
  here — two voices trading lines keeps the pace up on Shorts. But a
  single narrator is cleaner if you prefer. Which way?"*
- If the user's prompt is a single vague sentence, recommend the most
  likely great setup and ask for confirmation — don't dump options.

**What to consider when deciding (scan the prompt against this):**
- **Voice:** engine quality (piper is fast & fine, xtts/qwen are richer,
  chatterbox clones a specific person), narrator count (0 for silent
  motion graphics, 1 for monologue, 2 for dialogue), which concrete
  voices fit the tone (warm, energetic, authoritative, calm)
- **Format:** platform dimensions + duration band, target length
- **Audio:** background bed (always worth suggesting — it lifts
  production value dramatically), sound effects for key moments
- **Look:** light/dark mode, accent color from brand/prompt, mood,
  caption animation style (slam for punchy, karaoke for explainers),
  transitions between scenes
- **Motion:** b‑roll clips behind scenes if the prompt suggests
  visual richness, hand-drawn annotations for explainer content
- **Structure:** hook variants if the user cares about social reach,
  series if the script is naturally long

**Don't:**
- Second-guess what the user explicitly chose. If they said "piper" or
  "30 seconds" or "dark background," use it — don't suggest they switch
  to xtts or a different length. Only push back if their choice is
  genuinely broken (a voice that doesn't exist, a 5-second video for a
  2-minute script, a platform/size mismatch that will fail at render).
- Ask the user what piper/xtts/qwen is — just pick and explain inline.
- List every possible option — recommend one and mention the alternative
  only if it's a real contender.
- Ask about features the prompt doesn't need (no b‑roll for a podcast,
  no series for a 30s clip).
- Make the user run commands or read docs to understand your suggestion.

**After intake**, write a short summary of the key decisions (engine, voice
names, narrator count, theme mode, accent color, platform/dimensions,
target length, bed, caption style) as a comment block at the top of
`reel.config.mjs` when you create it in step 2. Proceed to step 1.

### 1 — Check the environment

`doctor` — check the machine **before** writing a script.
Fix problems with `references/environment.md`.

### 2 — Create the project & write the scene script

In a repository, put generated projects under `generated/<descriptive-slug>/`,
never loose at the repo root: `init generated/<slug>`. `init` creates a
minimal `reel.config.mjs` + `theme.css` skeleton — replacing it wholesale
with your own is the normal flow. Keep editable source
(`reel.config.mjs`, `theme.css`, `assets/`) and ignore `out/`.
   If the prompt names a URL, first run `ingest <url>` for the mechanical
   pass (images into `assets/`, page screenshot, `sources.md` entry,
   `claims.md` skeleton), then read and follow
   `references/url-to-source.md`; classify the page before deciding whether
   brand, editorial, research, or technical evidence should drive the video.
   A search result or prose page summary is not source evidence. Then read
   `references/prompt-to-video.md` (intake and
   script craft) and `references/scene-script.md` (the config format).
   Use the voice/engine/count decisions from the intake step. Short turns,
   `data-cue` on the key visual of most turns. Build the theme from the
   classified source evidence or the prompt's mood/colors: keep whatever the
   user gave, fill in the rest yourself, never ask for CSS.
   Set `theme.mode` based on the intake decision (see Hard Rules).

### 3 — Ground every claim

Before synth, write `claims.md` in the project:
   every stat, number, superlative, or factual assertion in the `vo`, tagged
   verbatim / paraphrase / inference against a source
   (`references/url-to-source.md` §Claims ledger). `check` sniffs for
   unledgered claims — an invented stat is a trust problem, not a polish one.

### 4 — `check` — fast validation

No TTS, no browser, no writes.
   Exit 0 = valid. Run it after **every** config edit. The `ok:` line also
   prints an **estimated narration length** — if the user gave a target
   duration, tune word count and `timing.tempo` here, before any audio exists.

### 5 — `synth` — audio & word timings

### 6 — `compose` — generate HyperFrames project

Generates `out/hf/` and prints the per-scene start times.
   Run `npx hyperframes check` inside `out/hf`, then do the **visual QA
   pass**: `narova shots` snapshots one frame per scene into
   `out/hf/snapshots/review/` — actually look at them. Overlap lint misses
   oversized display type bleeding over neighbors and content sliding under
   the topbar/caption band; your eyes on real frames are the check.

### 7 — `preview` — show before rendering

`preview --detach` keeps HyperFrames Studio alive and prints its
   exact URL, PID, and log path. Studio does NOT hot-reload, so `compose` and
   `build` **restart a live detached preview automatically** on the new build
   (same port). Snapshots verify; Studio is for watching.
   **Show the user before rendering.**

### 8 — `build` — render the MP4

`build --reuse` renders `out/video.mp4`, reusing the audio from
   step 5. (`--reuse` is ignored automatically if the spoken text changed.)
   Verify: `ffprobe` length of the mp4 ≈ length of `out/audio/full.wav`.

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
  break. Motion comes from the timeline: `reveal`/`data-cue` entrances plus
  the `data-*` animators — `data-grow` (bar grows horizontally), `data-draw`
  (SVG path draws itself), `data-count="42"` (number counts up, optional
  `data-count-suffix="%"`), `data-delay="0.3"` (nudge any trigger).
  Details: `references/scene-script.md` §Motion.
- **Ids are namespaced per scene at compose** (`<sceneId>--<id>`), so reusable
  SVG (gradient/filter `<defs>`, `<symbol>`) can repeat the same ids in every
  scene — `url(#…)`, `href="#…"`, `for`, and aria references are rewritten to
  match. Keep ids unique WITHIN one scene, and style with classes, never `#id`
  selectors in theme.css (`check` warns). Reveal/cue on an SVG element with a
  `transform` attribute is safe: the runtime wraps it and tweens the wrapper.
- **Default to piper unless the intake step chose otherwise.** It is fast, good
  for most videos. Switch to `xtts` or `qwen` for the final render when the
  user wants richer voices. Both are slow and download a 1–2GB model once.
  `narova voices list --backend piper` shows a spread of starter voices;
  `narova voices get <name> --backend piper` downloads any voice from the
  piper catalog.
- **Clone a specific voice with `--backend chatterbox`.** Set a voice's
  `speaker` to an ABSOLUTE path to a clean 10–20s recording; chatterbox speaks
  in that voice. Install once with `tool/setup.sh --chatterbox` (isolated
  venv — its torch/transformers pins conflict with xtts/qwen, so it runs as a
  subprocess). Optional per-voice `exaggeration` (0.25–2.0) and `cfg_weight`
  (0.0–1.0, lower = slower/more expressive). Slowest backend — the sentence
  cache still keeps unchanged lines from re-synthesizing.
- **0 to N narrators are supported.** The intake step chooses the right count
  for this specific video. A dialogue (typically one male + one female
  voice trading turns) adds energy for social clips; a single narrator is
  cleaner for explainers and monologues. More than two only for a real panel.
- **Sourcing is checked; balance is not.** `check` gates claims against the
  ledger, but it cannot see a one-sided narrative built from sourced claims.
  For contested topics (politics, conflicts, disputes), ledger the major
  perspectives and re-read the script for framing before synth — balance is
  the author's job (`references/url-to-source.md` §3).
- **Light-brand sites get `theme.mode: "light"`.** Do not override `#bg`
  with `!important` and chase contrast failures — one switch flips the
  background, captions, and chrome tokens.

## Revisions: no surprises

A revision changes only what the user asked for — everything else stays
byte-identical. Keep scene ids, voices, timing, and theme stable; edit
surgically. Visual-only edit → `build --reuse` (audio replayed untouched;
if the `vo` text did change, `--reuse` is ignored with a note and the
changed sentences re-synthesize). Spoken-text edit → plain `build`: the
sentence cache re-synthesizes ONLY the changed sentences, so untouched
scenes keep their exact audio. Details:
`references/prompt-to-video.md` §Iterating.

## Read it to…

| Read…                          | to…                                                          |
|--------------------------------|--------------------------------------------------------------|
| `references/prompt-to-video.md`| decide what to make: intake, script craft, casting, iterating|
| `references/url-to-source.md`   | classify any URL and extract the right factual and visual evidence|
| `references/scene-script.md`   | write a `reel.config.mjs` (scenes, cues, voices, theme)      |
| `references/audio.md`          | background beds, spot SFX, forced word alignment, chatterbox v3   |
| `references/cli.md`            | see every command, flag, `out/` file, and rough cost         |
| `references/gotchas.md`        | avoid the traps (tempo, --reuse, sync, determinism)          |
| `references/environment.md`    | fix `doctor` failures: ffmpeg, python, venv, hyperframes     |

Related skills: `out/hf/` is a normal HyperFrames composition.
`hyperframes-core` documents its format; `hyperframes-cli` its commands.
narova owns that project — treat it as read-only output.
