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
  SRT/VTT sidecar captions, 3D scenes (scene.three / scene.elements,
  with scene.threeModule as the raw Three.js/WebGL escape hatch),
  mixed 2D/3D compositing, AI clip generation (narova generate),
  or local neural TTS with no API keys. It turns a prompt or scene script
  into an MP4 with local
  piper/xtts/qwen/chatterbox voiceover, word-level captions, and
  speech-timed visuals rendered through local HyperFrames (2D HTML/CSS,
  3D Three.js/WebGL, SVG, video compositing) or the browserless
  no-browser Skia/FFmpeg provider. The full tool ships
  inside the skill. Also use whenever the user names narova or a
  reel.config file. For silent motion graphics without narration, use plain
  HyperFrames instead.
license: MIT
compatibility: >
  Requires Node.js 18+, Python 3.10+ and ffmpeg.
  First-time model setup and HyperFrames setup require internet access.
  Product walkthrough capture optionally requires agent-browser.
metadata:
  author: ammar-hasan
  version: "0.26.0"
---
# narova — video from scene scripts

**Write a scene script. Narova handles the rest.**

Narova has a deterministic timeline. Narration turns are one powerful timing
source — word-synced captions, voice-triggered reveals, and speaker-color
karaoke make speech-driven video exceptionally convenient. Named markers are
another source. Silent projects with explicit durations or marker-driven events
are first-class. The tool does not assume every project is narration-led.

The full tool ships bundled inside the skill. Nothing to install beyond
the machine prerequisites.

## Creative stance: you are the director

Narova owns timing, orchestration, rendering, caching, and delivery. You and the
user own creative authorship.

Narova is **zero-style by default.** The base scaffold gives you production
infrastructure (caption timing, timeline orchestration, render pipeline) but
no implicit visual identity:

- No topbar, counter, or progress bar (chrome is off by default; set `chrome: true`)
- No built-in layout classes (patterns is off by default; set `patterns: true`)
- No decorative grid background
- No recognizable navy/teal palette (default tokens are monochrome gray)
- Captions default to plain subtitle treatment (not karaoke; pick karaoke/slam/
  pop/rise deliberately via `captions.preset`)
- SRT/VTT sidecar captions always export for accessibility

Every aesthetic choice must be an explicit creative decision. The tool provides
capability — it does not provide accidental taste.

You write a **scene script**: a `reel.config.mjs` with `voices`, `theme`, and
`scenes`. Each scene has spoken dialogue (`vo`: a list of `{ who, text }` turns)
and either an HTML `body` or provider-neutral `visual` tree. Narova makes the
speech locally, derives word timings, and renders through HyperFrames (default)
or the no-browser provider to `out/video.mp4`. The speech drives everything:
captions light up word by word in each speaker's color, and any element with
`data-cue="k"` appears exactly when turn `k` starts.

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

0. **Concept branch** (when appropriate): sketch 2–3 distinct creative
   directions that differ in visual language and structure. Pick the strongest.
   See `references/prompt-to-video.md` §Concept branching.
1. **Intake** — `references/prompt-to-video.md` §Intake.
2. `doctor` — check the machine. Fix with `references/environment.md`.
2. `init generated/<slug>` + write `reel.config.mjs`. Format: `references/scene-script.md`.
   Creative direction: `references/prompt-to-video.md`. URL sources: `ingest <url>`
   first, then `references/url-to-source.md`.
3. Write `claims.md` — every factual claim must trace to a source.
4. `check` — fast validation (no TTS). Run after every config edit.
   For optional craft advice: `narova critique [social-short|explainer|presentation|accessibility]`.
5. `synth` — audio & word timings. Walkthroughs: follow with `walkthrough capture <id>`.
6. `compose` — generates the selected renderer project. Run `narova shots` for visual QA.
7. `preview --detach` — show HyperFrames Studio; no-browser preview writes a draft MP4.
8. `build` — renders `out/video.mp4`. Verify: audio `dur` by eye, then ffprobe.

## Key gotchas

- **No implicit visual style.** Narova is zero-style by default — no layout
  patterns, no decorative grid, no implicit dark/teal palette. Set
  `patterns: true` to include Narova's built-in layout classes when they
  serve your concept. Every aesthetic choice is yours to make.
- **No looping CSS in theme.css.** The renderer jumps between frames:
  `animation: ... infinite`, hover effects, and CSS transitions break.
  Motion comes from the timeline: `reveal`/`data-cue` entrances and
  `data-*` animators (`data-grow`, `data-draw`, `data-count`, `data-delay`).
  See `references/scene-script.md` §Motion.
- **SVG ids are namespaced per scene** at compose (`<sceneId>--<id>`). Keep
  ids unique within one scene; style with classes, not `#id` in theme.css.
  Reusable `<defs>` can repeat ids across scenes safely.
- **Never edit `out/hf/`.** Every compose regenerates it. Change the config.
- **No-browser never interprets HTML/CSS.** Give every no-browser scene a `visual`
  tree. Keep HyperFrames for unrestricted browser visuals; see
  `references/renderers.md` for the capability boundary and dual-authoring.
- **Sourcing is checked; balance is not.** `check` gates claims against
  `claims.md`, but a one-sided narrative built from sourced claims passes
  clean. For contested topics, ledger the major perspectives and re-read the
  script for framing — balance is the author's job.
- **Craft advice is opt-in.** Hook checks, saveable end-frames, platform
  duration bands, and 3D quality hints belong to `narova critique`, not
  `narova check`. `check` reports only correctness and reproducibility
  concerns. Run `narova critique` when you want optional craft guidance.

Read `references/gotchas.md` for the full list.

## Hard invariants

These are enforced by the tool. Do not circumvent them.

| Rule | Enforcement |
|------|-------------|
| Deterministic rendering: same input + seed → identical output | Checker + deterministic pipeline |
| Reproducible timing: `data-cue` resolves to measured turn starts | `cueTime()` uses `scenes[].turns[]` |
| No remote runtime dependencies | vendored GSAP + vendored Three.js |
| Source-grounded factual claims | `claims.md` validation on `check` |
| Config and manifest consistency | `plan` compares hashes |
| No silent feature degradation | unsupported semantic actions fail at validation |
| Frame seeking must not affect output | `check` flags `Math.random`, `Date`, etc. in choreography |
| GSAP loaded locally, not from CDN | vendored at `vendor/gsap/gsap.min.js` |

## Revisions

A revision changes only what the user asked for — everything else stays
byte-identical. Edit surgically. Visual-only edit → `build --reuse`.
Spoken-text edit → plain `build` (sentence cache re-synthesizes only changed
sentences; untouched scenes are byte-identical). See
`references/prompt-to-video.md` §Iterating.

## Read it to…

| Read…                          | to…                                                          |
|--------------------------------|--------------------------------------------------------------|
| `references/prompt-to-video.md` | intake, creative direction, iterating                       |
| `references/url-to-source.md`   | classify a source page and extract factual & visual evidence |
| `references/scene-script.md`   | write a `reel.config.mjs` (scenes, cues, voices, theme)      |
| `references/product-walkthroughs.md` | explore, capture, compose, and QA product demos         |
| `references/choreography.md`   | make something *happen* in a scene beyond the built-in cues   |
| `references/stock-assets.md`  | source photos, clips, music, SFX, fonts, icons from CLI      |
| `references/audio.md`          | background beds, spot SFX, forced word alignment             |
| `references/cli.md`            | every command, flag, `out/` file, and rough cost              |
| `references/gotchas.md`        | avoid the traps (tempo, reuse, sync, models, lint)          |
| `references/environment.md`    | fix `doctor` failures: ffmpeg, python, venv, hyperframes     |
| `references/renderers.md`      | choose HyperFrames/no-browser; portable visual nodes and limits |

For optional craft advice (hook, saveable end-card, platform duration band,
3D quality hints, accessibility), run `narova critique [profile]`. Profiles:
`social-short`, `explainer`, `presentation`, `accessibility`, or `all`. This is
creative guidance, not a correctness gate — skip it when the work does not need
social-video grammar.

For Urdu dialogue, use the `urdu-voice-director` skill before finalizing `vo` text.

Related: `out/hf-*` is a HyperFrames composition. `hyperframes-core` documents
its format; `hyperframes-cli` its commands. Narova owns that project — treat
it as read-only output.
