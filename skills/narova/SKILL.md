---
name: narova
description: >
  Use narova for narration-first video: narrated or captioned explainers,
  multi-host dialogue (0 to N narrators), prompt/script/README-to-video, videos sourced from any
  URL (product site, article, paper, docs, repository, or general page),
  word-synced karaoke captions, voice-triggered reveals, music beds and
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

### 0 — INTAKE: Ask about what the prompt left out

**Never silently assume.** A one-sentence prompt is missing most of what
narova needs to produce the right video. Your job is to spot the gaps and
ask — not to fill them with guesses.

**The rule:** for every narova parameter below, if the prompt doesn't
already answer it AND choosing differently would change the video, ask.
If the parameter doesn't matter for this particular video, skip it.

**What narova can vary (scan the prompt against this):**
- **Voice:** TTS engine (piper/xtts/qwen/chatterbox), number of narrators (0–N), specific speaker names, voice cloning from a sample
- **Format:** platform (tiktok/reels/shorts/linkedin/x), target duration, aspect ratio
- **Audio:** background music, spot sound effects, forced word alignment
- **Look:** light/dark mode, accent color, mood/palette, transitions between scenes, hand-drawn annotations (`data-mark`)
- **Motion:** caption preset (karaoke/slam/pop/rise), keyword emphasis, b‑roll video clips behind scenes
- **Structure:** hook A/B variants, series episodes (`series: {part, total}`), scene count
- **Source:** URL to pull facts/imagery from (`narova ingest <url>`), claims ledger

**How to ask:**
- **Every question must stand alone.** The user has never heard of piper,
  xtts, or ryan-high. Explain each option in plain words right where you
  ask — what it sounds like, the trade-off, and what you recommend.
  Bad: *"Which backend?"* Good: *"Voice quality — fast & small (piper),
  richer & more natural but needs a one-time 1.9GB download (xtts), or
  clone your own voice from a short recording?"*
- For voices, list 3–4 concrete options with descriptions — *"a warm male
  voice (Ryan), a clear female voice (Serena), an energetic male (Eric)"* —
  don't make them run `narova voices list` to know what's available.
- Group related gaps into one message — don't fire 8 questions one by one.
- Offer the defaults so the user can just say "defaults" or "the first one."
- If the prompt is detailed, state what you inferred and ask only for
  confirmation: *"One male narrator, dark theme, TikTok format — ok?"*
- Skip parameters the prompt already nailed. Don't ask "which platform?"
  when they said "make a TikTok."
- Don't mention arcane features (alignment, b‑roll, series) unless the
  prompt hints at them; mention them only when they'd lift the output.

**After intake**, proceed to step 1.

### 1 — Check the environment

`doctor` — check the machine **before** writing a script.
Fix problems with `references/environment.md`.
2. **Create the project, then write the scene script.** In a repository, put
   generated projects under `generated/<descriptive-slug>/`, never loose at
   the repo root: `init generated/<slug>`. Keep editable source
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
   user gave, fill in the rest yourself, never ask for CSS. A light-brand
   site means `theme.mode: "light"` — never fight the dark base with
   `!important` overrides.
   `init <dir>` gives a start — the scaffold is a starting point, so
   replacing `reel.config.mjs` wholesale with your own is the normal flow.
3. **Ground every claim.** Before synth, write `claims.md` in the project:
   every stat, number, superlative, or factual assertion in the `vo`, tagged
   verbatim / paraphrase / inference against a source
   (`references/url-to-source.md` §Claims ledger). `check` sniffs for
   unledgered claims — an invented stat is a trust problem, not a polish one.
4. `check` — fast validation. No TTS, no browser, no writes.
   Exit 0 = valid. Run it after **every** config edit. The `ok:` line also
   prints an **estimated narration length** — if the user gave a target
   duration, tune word count and `timing.tempo` here, before any audio exists.
5. `synth` — makes the audio and word timings (piper by default).
6. `compose` — generates `out/hf/` and prints the per-scene start times.
   Run `npx hyperframes check` inside `out/hf`, then do the **visual QA
   pass**: `narova shots` snapshots one frame per scene into
   `out/hf/snapshots/review/` — actually look at them. Overlap lint misses
   oversized display type bleeding over neighbors and content sliding under
   the topbar/caption band; your eyes on real frames are the check.
7. `preview --detach` — keeps HyperFrames Studio alive and prints its
   exact URL, PID, and log path. Studio does NOT hot-reload, so `compose` and
   `build` **restart a live detached preview automatically** on the new build
   (same port). Snapshots verify; Studio is for watching.
   **Show the user before rendering.**
8. `build --reuse` — renders `out/video.mp4`, reusing the audio from
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
  or `xtts` for the final render when the user wants richer voices. Both are
  slow and download a 1–2GB model once. `narova voices list --backend piper`
  shows a spread of starter voices; `narova voices get <name> --backend piper`
  downloads any voice from the piper catalog.
- **Clone a specific voice with `--backend chatterbox`.** Set a voice's
  `speaker` to an ABSOLUTE path to a clean 10–20s recording; chatterbox speaks
  in that voice. Install once with `tool/setup.sh --chatterbox` (isolated
  venv — its torch/transformers pins conflict with xtts/qwen, so it runs as a
  subprocess). Optional per-voice `exaggeration` (0.25–2.0) and `cfg_weight`
  (0.0–1.0, lower = slower/more expressive). Slowest backend — the sentence
  cache still keeps unchanged lines from re-synthesizing.
- **Two hosts read better than one (but 0 to N are supported).** Default cast: one male + one female
  voice, trading questions and answers. One narrator only when the format
  calls for it (a short announcement); more than two only for a real panel.
- **No invented facts.** Every number, superlative, or market claim in the
  `vo` must exist in the project's `claims.md` with a source. If you cannot
  trace it, cut it or say it as opinion.
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
| `references/audio.md`          | music beds, spot SFX, forced word alignment, chatterbox v3   |
| `references/cli.md`            | see every command, flag, `out/` file, and rough cost         |
| `references/gotchas.md`        | avoid the traps (tempo, --reuse, sync, determinism)          |
| `references/environment.md`    | fix `doctor` failures: ffmpeg, python, venv, hyperframes     |

Related skills: `out/hf/` is a normal HyperFrames composition.
`hyperframes-core` documents its format; `hyperframes-cli` its commands.
narova owns that project — treat it as read-only output.
