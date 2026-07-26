# Changelog

All notable changes to narova are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Interactive landing page (`docs/`, GitHub Pages): pointer-reactive WebGL hero,
  scroll-driven storytelling, karaoke caption demo, bento feature grid.
- Demo GIF (`assets/narova-demo.gif`) and video poster for the README.
- This changelog, and the `/changelog` page on the site.

### Changed

- README restructured around the demo: hook, GIF, why-bullets, install, quickstart.

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

[Unreleased]: https://github.com/ammar-hasan/narova/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/ammar-hasan/narova/commit/eeb373d
[0.5.0]: https://github.com/ammar-hasan/narova/commit/16f1c43
[0.4.0]: https://github.com/ammar-hasan/narova/commit/d00243f
[0.3.0]: https://github.com/ammar-hasan/narova/commit/eb361dd
[0.2.0]: https://github.com/ammar-hasan/narova/commit/a4f7d3b
[0.1.0]: https://github.com/ammar-hasan/narova/commit/9f21fa3
