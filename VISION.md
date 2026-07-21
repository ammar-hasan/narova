# narova — vision checklist

Every point of the product vision, mapped to where it is implemented.
Status legend: `[x]` implemented and verified · `[~]` implemented, needs
strengthening · `[ ]` gap.

## What narova is

- [x] **A skill, not a tool** — the product is `skills/narova/` (SKILL.md +
  references + bundled CLI), installed/used however people use skills.
  See `README.md` ("narova is a skill"), `SPEC.md` §Layout.
- [x] **Framework-neutral** — SKILL.md and references/ contain no
  framework-specific assumptions; works for any agent that reads skills
  (Kimi Code, Codex, Claude Code, opencode, agentic SDKs). Verified: only
  framework mention in the skill was a stale code comment (fixed).
  Install line mentions agents only as examples.
- [x] **Fully local stack** — HyperFrames + open-source TTS (piper/xtts/qwen)
  + ffmpeg. No API keys, no cloud. `README.md`, `references/environment.md`.

## What narova does

- [x] **Prompt → engaging video with voiceover + word-synced text
  highlighting** — scene script (`reel.config.mjs`) → synth → compose →
  render. Word-by-word karaoke captions per speaker color; `data-cue`
  elements appear exactly when the voice reaches them. `SPEC.md`,
  `skills/narova/tool/src/compose/`.
- [x] **One or more voices; default two (male + female)** — schema accepts
  any number of voices (`tool/src/schema.js`); the `init` scaffold and all
  docs default to two piper voices: `en_US-ryan-high` (male) +
  `en_US-hfc_female-medium` (female).
- [x] **The skill decides the creative direction from the prompt** — theme,
  script, scenes, story, structure, mood, pacing are inferred, not asked.
  `references/scene-script.md` §"Theme: build it from the prompt" +
  §"Writing scenes from a prompt"; `references/prompt-to-video.md`.
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

- [x] `npm test` exits 0 (52 JS + 12 Python tests).
- [x] End-to-end: a project written from a plain natural-language prompt
  builds to `out/video.mp4`; `ffprobe` duration ≈ `out/audio/full.wav`
  (±0.15s). See `examples/`.
- [x] Iteration consistency demo: one-turn edit → only that scene's audio
  changed (sha256 of every other scene wav identical across runs).
- [x] Multiple videos: three distinct example projects build end-to-end —
  `attention-is-all-you-need` (16:9 teal paper walkthrough), `vkf-upgrade`
  (1:1 violet announcement), `backlog-graveyard` (9:16 warm coral reel with
  stat/verdict/stepper layouts and a custom theme.css). Different formats,
  palettes, layouts, and pacing — not one template re-skinned.
