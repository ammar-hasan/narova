# Changelog

All notable changes to narova are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.7.0] - 2026-07-26

### Added

- **Music bed + spot SFX** — `music: {file, volume, fadeIn, fadeOut}` and
  `sfx: [{file, scene, at, volume}]` mixed into narration via ffmpeg.
  Music changes don't require re-synthesis.
- **Caption style presets + keyword emphasis** — `captions: {preset: karaoke|slam|pop|rise, emphasis: [...]}`.
  Slam/pop use GSAP-only tweens (seek-safe); emphasis highlights matching words.
- **Per-platform export matrix** — `platform: tiktok|reels|shorts|linkedin|x` picks frame size
  and duration-band lint. `compose`/`build` write `captions.srt` + `captions.vtt` sidecars.
- **Forced word alignment** — `align: true | {engine: "auto"|"faster-whisper"|"whisper-cpp"}`.
  Measured word timings replace estimates; per-scene graceful fallback on failure.
- **Chatterbox v3** — multilingual voice cloning with per-voice `lang`, watermarked output.
  v2 fallback for existing installs.
- **Scene transitions + hand-drawn annotations** — per-scene `transition: fade|wipe|slide|zoom`;
  `data-mark="underline|circle|box|highlight"` draws SVG annotations cued to the timeline.
- **Hook-variant generation** — `variants: [{id, scene}]` in config;
  `narova build --variant <id>` / `--variants` renders A/B hook tests.
- **`narova ingest <url>`** — fetches page, downloads top images, takes headless screenshot,
  appends `sources.md`, seeds `claims.md`, prints brand-color theme suggestions.
- **Hook enforcement in `narova check`** — warns on lead-in silence >200ms,
  scene 1 missing visible text for muted viewers, missing saveable end-card.
- **B‑roll per scene** — `clip: "assets/bg.mp4"` on any scene plays a looped video
  behind the HTML overlay (muted, dimmed).
- **Series/multi‑part mode** — `series: {part, total}` adds a "Part 2 / 5" badge overlay
  for multi-episode scripts.
- Interactive landing page (`docs/`, GitHub Pages) and `/changelog` subpage.
- Demo GIF, this changelog, `references/audio.md`.

### Changed

- README restructured around the demo: hook, GIF, why-bullets, install, quickstart.
- SPEC updated to the 0.7.0 contract; stale `examples/` references repointed to `generated/`.

### Fixed

- **Slam caption overlap** — `fromTo` scale tween parked every upcoming word at the
  from-state; rewritten as `.to()` tweens only (LEARNINGS #37).

## [0.6.0] - 2026-07-21

### Added

- Photo motion, scene transitions, XTTS voice cloning, and Qwen instruct control.
- Chatterbox voice-cloning TTS backend.
- narova skill showcase reel (`assets/narova-skill-reel.mp4`).

### Fixed

- Session friction from the us-iran-standoff build: motion glitches, scene ids,
  QA workflow, CLI edges.
- Review follow-ups: loud clone-path errors, drift lint, missing tests.
- Chatterbox validation and cache identity.

## [0.5.0] - 2026-07-21

### Added

- Example intro videos: Folio3, Careem, DeepLearning.AI, and the
  US–Iran standoff balanced briefing.
- Hardening against the failures found in the bazaartech retrospective.
- Skill exposed to `.agents`-standard agents at project scope.

### Changed

- Aligned versions and hardened config/argument edges from the skill review.

### Removed

- Legacy examples superseded by the generated intro projects.

## [0.4.0] - 2026-07-21

### Added

- Source-aware, asset-native pipeline: any URL becomes verified source
  material; local `assets/` ship inside the render bundle.
- Iteration-consistent synthesis: a sentence-level cache keeps unchanged
  turns byte-identical across revisions.
- Prompt-to-video craft references and anti-template visual-variety rules.
- Qwen3-TTS backend (`qwen`) and theme-from-intent skill rules.

### Changed

- **Breaking:** narova IS the skill — the tool is bundled under the standard
  `skills/` layout; SKILL.md + references are the product.
- Docs rewritten in plain language; tests moved into the skill.

## [0.3.0] - 2026-07-21

### Changed

- **Breaking:** `build`/`preview` run on the HyperFrames render engine;
  the old player/capture/assemble/serve pipeline is deleted.

### Added

- `narova compose` — HyperFrames composition generator.
- `audio/full.wav` — the concatenated narration track.
- Zero-dependency test suite for schema, lints, compose, and timings.
- Claude Code agent skill + installer (with per-project installs).

## [0.2.0] - 2026-07-20

### Added

- `narova check` — fast config validation with no synth or capture.
- `vkf-upgrade` example: a 7-scene 1:1 social announcement.

### Fixed

- `py/` and `scripts/` now ship in the published package files.

## [0.1.0] - 2026-07-15

### Added

- Initial release: a script-to-narrated-kinetic-video toolkit.

[Unreleased]: https://github.com/ammar-hasan/narova/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/ammar-hasan/narova/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ammar-hasan/narova/commit/eeb373d
[0.5.0]: https://github.com/ammar-hasan/narova/commit/16f1c43
[0.4.0]: https://github.com/ammar-hasan/narova/commit/d00243f
[0.3.0]: https://github.com/ammar-hasan/narova/commit/eb361dd
[0.2.0]: https://github.com/ammar-hasan/narova/commit/a4f7d3b
[0.1.0]: https://github.com/ammar-hasan/narova/commit/9f21fa3
