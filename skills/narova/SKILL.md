---
name: narova
description: >
  Use narova whenever the user names Narova or reel.config, or wants a
  deterministic scene-scripted video: narrated/captioned explainers,
  multi-host dialogue, prompt/script/README-to-video, product walkthroughs
  with real browser actions, or source-grounded videos from sites, articles,
  docs, and repositories. Supports optional local neural TTS, word-synced
  captions and reveals, music/SFX, platform export presets, SRT/VTT, 2D
  HTML/CSS/SVG, Three.js/WebGL 3D, mixed compositing, AI clips, and silent
  marker-driven work. It turns a scene script into MP4 through HyperFrames or
  the browserless Skia/FFmpeg provider; scene.threeModule is the raw 3D escape
  hatch. Use plain HyperFrames for unrelated silent motion graphics.
license: MIT
metadata:
  author: ammar-hasan
  version: "0.29.0"
---
# narova — video from scene scripts

**Write a scene script. Narova handles the rest.**

Narova has a deterministic timeline. Narration turns are one powerful timing
source — word-synced captions, voice-triggered reveals, and speaker-color
karaoke make speech-driven video exceptionally convenient. Named markers are
another source. Silent projects with explicit durations or marker-driven events
are first-class. The tool does not assume every project is narration-led.

The skill and CLI are deliberately separate. This directory contains only
instructions and references; executable code is installed from the standalone
top-level `tool/` package when needed.

## Creative stance: you are the director

Narova owns timing, orchestration, rendering, caching, and delivery. You and the
user own creative authorship.

Narova is **zero-style by default.** The base scaffold gives you production
infrastructure (caption timing, timeline orchestration, render pipeline) but
no implicit visual identity:

- No topbar, counter, or progress bar (chrome is off by default; set `chrome: true`)
- No built-in layout classes (patterns is off by default; set `patterns: true`)
- No implicit max-width, centering, gutter, or caption reserve. Scene bodies own
  the full frame; set `safeLayout: true` only when those guardrails help.
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
or the no-browser provider to `out/video.mp4`. When there is speech, it drives
the visuals: captions light up word by word in each speaker's color, and any
element with `data-cue="k"` appears exactly when turn `k` starts. Narration is
optional — silent projects, marker-driven events, and music-driven pieces are
first-class and use the same scene/timeline model.

Or bring your own recording with `narration.file` and `narration.wordTimings`.

## Standalone CLI boundary and bootstrap

Requires Node.js 18+, Python 3.10+, and FFmpeg. First-time model and
HyperFrames setup requires internet access. Product walkthrough capture can
optionally use agent-browser.

Before the first Narova command in a session, detect the standalone CLI on
`PATH` or at the installer's default user-owned location. If neither exists,
install only the CLI package. The installer downloads the repository, packs
only `tool/`, and installs it under `~/.local`; it does not install or modify
skills:

```bash
if command -v narova >/dev/null 2>&1; then
  command -v narova
elif [ -x "$HOME/.local/bin/narova" ]; then
  printf '%s\n' "$HOME/.local/bin/narova"
else
  (
    set -e
    installer="$(mktemp "${TMPDIR:-/tmp}/narova-install.XXXXXX")"
    trap 'rm -f "$installer"' EXIT
    curl --proto '=https' --tlsv1.2 -fsSL \
      https://raw.githubusercontent.com/ammar-hasan/narova/main/tool/install.sh \
      -o "$installer"
    bash "$installer"
  )
fi
```

Use `narova <command>` for every workflow step. If `~/.local/bin` is not on
`PATH`, spell out `$HOME/.local/bin/narova <command>` instead; agent shells do
not preserve a one-off `PATH` assignment between calls. First `synth` or
`build` creates `~/.narova/venv`. `doctor` checks Node 18+, ffmpeg, and Python
3.10+. For richer voices, run `narova-setup --xtts` (or `--qwen`,
`--chatterbox` for voice cloning).

Skill updates and CLI updates are independent. Re-run the CLI installer to
upgrade the tool; re-run the skills installer only to update these instructions.
`narova-uninstall` removes the standalone CLI package and commands, but keeps
projects, downloaded models, caches, and this separately installed skill.

External TTS providers are optional registered companion skills — see
`narova-elevenlabs`, `narova-openai`, or `references/cli.md` §providers.

## Workflow: prompt → video

0. **Creative contract**: for difficult, reference-driven, or ambitious work,
   fill `creative-brief.md` around creative intent rather than a default film
   grammar. Build 2–3 *small* visual proofs, save each with `branch save <name>
   --rationale "..."`, compare their rendered evidence, approve one, and expand
   only that winner. Restore the winner (its saved CLI overrides are reapplied),
   then copy the branch and exact `proofIdentity` from `branch show <name>` into
   the brief's `Expanded from proof branch` and `Expanded proof identity` fields.
   Proof selection is project-bound; never reuse another
   project's same-named branch. Never build three complete videos. Camera, depth, lighting,
   dialogue, and typography fields are conditional on the chosen medium. Set
   `Status: approved` only when the selected proof meets the written intent and
   rejection criteria. See `references/prompt-to-video.md` §Creative confidence loop.
1. **Intake** — `references/prompt-to-video.md` §Intake.
2. `doctor` — check the machine. Fix with `references/environment.md`.
2. `init generated/<slug>` + write `reel.config.mjs`. Format: `references/scene-script.md`.
   Creative direction: `references/prompt-to-video.md`. URL sources: `ingest <url>`
   first, then `references/url-to-source.md`.
3. Write `claims.md` — every factual claim must trace to a source.
4. `check` — fast validation (no TTS). Run after every config edit.
   For optional craft advice: `narova critique [creative|social-short|explainer|presentation|cinematic|accessibility]`.
5. `synth` — audio & word timings. Walkthroughs: follow with `walkthrough capture <id>`.
6. `compose` — generates the selected renderer project. Run `narova shots --beats`
   for narration/marker-driven work, or `shots --motion` for scene coverage.
7. `preview --detach` — show HyperFrames Studio; no-browser preview writes a draft MP4.
8. `build --release` — preflights strict checks before synthesis, rechecks
   measured timing before compose/render, writes `out/video.mp4`, then runs the
   temporal audit. Verify the encoded contact sheet against the approved brief.

## Key gotchas

- **No implicit visual style.** Narova is zero-style by default — no layout
  patterns, no decorative grid, no implicit dark/teal palette, and no centered
  max-width safe area or caption reserve. Set `safeLayout: true` to opt into
  those layout guardrails. Set
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
- **Three.js is a renderer, not an art direction.** Do not infer "cinematic",
  "detailed", or "premium" from the presence of 3D. For an ambitious 3D film,
  write a production brief that explicitly covers geometry/prop density,
  foreground-midground-background layering, material variation, lighting and
  atmosphere, character blocking, camera language, motion beats, and final
  compositing. A few low-poly primitives can be technically correct Three.js
  and still look like a moving diorama. Use `critique creative,cinematic` and
  `shots --beats`, then judge the rendered frames against the reference.

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
| `references/prompt-to-video.md` | creative contract, pilot gate, intake, direction, iteration |
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
3D quality hints, cinematic shot/action density, accessibility), run `narova critique [profile]`. Profiles:
`creative`, `social-short`, `explainer`, `presentation`, `cinematic`, `accessibility`, or `all`. This is
creative guidance, not a correctness gate — skip it when the work does not need
social-video grammar.

For Urdu dialogue, use the `urdu-voice-director` skill before finalizing `vo` text.

Related: `out/hf-*` is a HyperFrames composition. `hyperframes-core` documents
its format; `hyperframes-cli` its commands. Narova owns that project — treat
it as read-only output.
