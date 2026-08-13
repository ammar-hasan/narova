# narova — vision and implementation

## Vision

Give every person and every intelligence the creative power to make remarkable
video—regardless of expertise, budget, hardware, or model sophistication.

Narova is MIT-licensed open-source software. It should transfer capability:
someone with an idea, limited production knowledge, and even a simple LLM
should be able to make work far beyond what their tools or skills previously
allowed.

Experience is part of that capability transfer. Narova should meet each person
at their current video fluency, technical fluency, and desired level of
involvement. It should hide unfamiliar production language when that language
would create friction, then reveal deeper reasoning and precise controls as the
person asks for or demonstrates greater control. Simplicity must never mean a
lower creative ceiling.

## Mission

Build an open and efficient creative system that lets a person or agent turn
intent into exceptional video, then direct, evolve, organize, and reuse that
work without production friction.

Adaptive experience, generation, direction, changeability, maintenance,
management, provenance, and distribution are functions that make the vision
practical. They are not the vision itself.

## Implementation checklist

The currently shipped product capabilities, mapped to where they are
implemented.
Status legend: `[x]` implemented and verified · `[~]` implemented, needs
strengthening · `[ ]` gap.

## What narova is

- [x] **A skill plus a standalone tool** — `skills/narova/` contains only the
  agent-readable direction, while independently installed `tool/` owns all
  executable code and dependencies. The skill detects and bootstraps the CLI
  without making executable code part of skill installation. See `README.md`
  and the public interface guide in `SPEC.md` §Layout.
- [x] **Framework-neutral** — SKILL.md and references/ contain no
  framework-specific assumptions; works for any agent that reads skills
  (Kimi Code, Codex, Claude Code, opencode, agentic SDKs). Verified: only
  framework mention in the skill was a stale code comment (fixed).
  Install line mentions agents only as examples.
- [x] **Local rendering and speech** — HyperFrames + open-source TTS (piper/xtts/qwen)
  + ffmpeg. Local rendering and speech, with optional network-dependent
  setup and sourcing. `README.md`, `references/environment.md`.

## What narova does

- [x] **Prompt → engaging video with voiceover + word-synced text
  highlighting** — scene script (`reel.config.mjs`) → synth → compose →
  render. Word-by-word karaoke captions per speaker color; `data-cue`
  elements appear exactly when the voice reaches them. Public interface guide
  `SPEC.md`,
  `tool/src/compose/`.
- [x] **One or more voices; zero voices for silent** — schema accepts
  any number of voices; the `init` scaffold defaults to a single neutral
  narrator. Zero voices works for silent scenes with explicit durations.
- [x] **The skill decides the creative direction from the prompt** — theme,
  script, scenes, story, structure, mood, pacing are inferred, not asked.
  `references/scene-script.md` §"Theme: build it from evidence" +
  §"Writing scenes from a prompt"; `references/prompt-to-video.md`.
- [x] **Any URL becomes verified source material** — the skill first
  classifies product/brand sites, articles, papers, docs, repositories, and
  general pages, then extracts the right factual and visual evidence. Local
  project `assets/` are copied into the render bundle.
  `references/url-to-source.md`, `tool/src/schema.js`,
  `tool/src/compose/index.js`.
- [x] **Real product walkthroughs** — a driver-neutral action recipe can be
  explored and explicitly captured through agent-browser, timed from measured
  narration, then framed with voiceover and word-synced captions. Semantic
  locators, evidence screenshots, action-drift measurements, content hashes,
  per-variant takes, and release gates keep the result reproducible without
  replaying mutating browser actions during a build.
  `references/product-walkthroughs.md`, `tool/src/walkthrough.js`.
- [x] **Asks the user only when genuinely ambiguous** — intake guidance with
  a short list of decision-critical questions; otherwise the skill decides.
  `references/prompt-to-video.md` §"When to ask".
- [x] **Use cases covered** — patterns for explainer, social-media reel,
  teaching aid, research-paper walkthrough, two-host dialogue.
  `references/prompt-to-video.md` §"Video shapes".
- [x] **Not a template machine** — each video gets its own visual language:
  palette derived from the brief (stage glows, progress bar, and caption
  highlights all follow theme tokens — `tool/src/compose/css.js`), format
  from the platform, varied layouts from a built-in menu
  (`references/scene-script.md` §"Built-in scene layouts"), density matched
  to energy, one signature move per video, and a pre-synth anti-template
  self-check. `references/prompt-to-video.md` §"Videography".
- [x] **Script writing informed by research** — hook/pacing/turn-length rules
  distilled from public video-scripting guidance and existing
  script-to-video projects (sources in `references/prompt-to-video.md`).
- [x] **Empathetic guidance without overdoing it** — show the preview before
  rendering, offer concrete next steps, never interrogate.
  `references/prompt-to-video.md` §"Working with the user";
  SKILL.md workflow step 6 (preview before build).

## Iteration consistency

- [x] **A revision changes only what was asked** — sentence-level synthesis
  cache (`~/.narova/cache/sentences/`, keyed by backend+speaker+text+tempo):
  unchanged spoken text is never re-synthesized, so unchanged turns/scenes
  keep byte-identical audio. Visual-only edits use `--reuse` (no TTS at all).
  `tool/py/narova_tts/pipeline.py` (`synth_sentence` cache),
  `references/prompt-to-video.md` §"Iterating".
- [x] **Verified by hash** — editing one turn in one scene leaves all other
  scene wavs, timings for those scenes, and the compose output for those
  scenes byte-identical (see "Proof" below).

## Proof (all verified on this machine)

- [x] `npm test` exits 0 (470+ JS tests + 80+ Python tests).
- [x] Real walkthrough eval: a local demo product is explored and recorded,
  semantic actions stay within the timing-drift budget, the capture manifest
  and evidence frames validate, and the resulting 1280×720 MP4 passes media and
  black-frame checks. `tool/evals/walkthrough-eval.js`.
- [x] End-to-end: a project written from a plain natural-language prompt
  builds to `out/video.mp4`; `ffprobe` duration ≈ `out/audio/full.wav`
  (±0.15s). See `generated/`.
- [x] Iteration consistency demo: one-turn edit → only that scene's audio
  changed (sha256 of every other scene wav identical across runs).
- [x] Multiple videos: distinct example projects build end-to-end across
  varied formats, palettes, layouts, and creative approaches —
  see `generated/` for the full set including walkthrough showcases,
  product intros, and research explainers.
