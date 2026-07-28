# Changelog

All notable changes to narova are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned (0.7.12)

- **Comprehensive export profiles** — codec, bitrate, frame-rate,
  audio-loudness normalization, safe-area guides, color-space tagging,
  file-size budgeting, and thumbnail generation per platform. Currently
  `platform` selects frame dimensions and a target duration band only.

## [0.7.11] - 2026-07-28

### Added

- **XTTS language support** — XTTS-v2 backend now accepts per-turn and
  per-voice `lang`, resolving it against the model's 17 supported languages
  instead of hardcoding `"en"`. `build_backends()` extracts `langs` from
  voice configs for XTTS (matching qwen/chatterbox). Six unit tests cover
  resolution, validation, and passthrough.
- Release automation: `scripts/sync-version.js` stamps the canonical version
  (root `package.json`) into `SKILL.md`, `tool/package.json`, and `README.md`.
  `npm version` runs it automatically; `npm run version:sync` for manual sync.

### Changed

- Skill description narrowed from "any URL" to "web pages and agent-readable
  sources" (matches the ingest implementation).
- SKILL.md frontmatter restructured: version moved into `metadata`, added
  `license`, `compatibility`, and `metadata.author`.
- "No API keys. No cloud." replaced with qualified claims about local
  rendering and speech, noting network-dependent setup and sourcing.
- Agent is now instructed to check for updates read-only (no auto-update).
- Platform support documented as size/duration presets (not comprehensive
  export profiles); full export system planned for 0.7.12.
- VISION.md test counts updated; stale version badges corrected.

### Fixed

- Version drift across five presentation surfaces (SKILL.md, two
  package.json files, README badge, CHANGELOG). Root `package.json` is now
  the canonical version source.

## [0.7.10] - 2026-07-28

### Added

- npx retry with exponential backoff for DNS failures during renderer fetch.
- Stock assets reference documentation.

### Changed

- Doctor command now reports mismatched tool versions and venv health.

## [0.7.9] - 2026-07-27

### Added

- `captions.maxWords` config — limit words per caption line to prevent
  overcrowding.
- CSS custom property tokens for caption zone height (`--captions-zone-h`).

## [0.7.8] - 2026-07-26

### Fixed

- Restored b-roll `data-duration` attribute for reliable HyperFrames seek
  and playback. Scene-bounded clipping prevents b-roll from bleeding into
  the next scene.

## [0.7.7] - 2026-07-26

### Fixed

- B-roll StaticGuard: removed `data-duration` + clip class to prevent
  b-roll clips from persisting across scene boundaries.

## [0.7.6] - 2026-07-26

### Fixed

- `gainDb` now works for all backends (was applied only to piper).
  Also applies to xtts, qwen, and chatterbox voice outputs.

## [0.7.5] - 2026-07-26

### Added

- **Silent scenes** — vo-less scenes with a fixed `dur` (seconds) for
  visual-only segments (title cards, separators, end cards).

### Fixed

- Caption end time now capped at the scene boundary, preventing words
  from rendering into the next scene's visual space.

## [0.7.4] - 2026-07-26

### Added

- **Per-voice gain control** — `gainDb` on any voice, range –24 to +24 dB.
  Applied in the synth stage after TTS, before audio mixing.
- B-roll clips are now root-level HyperFrames clip nodes, keeping them
  out of the scene DOM for cleaner composition.

## [0.7.3] - 2026-07-26

### Changed

- Renamed config key `music` → `bed` (the old key is still accepted).
  "Background bed" better describes the ambient audio layer.

### Fixed

- Studio preview project naming: compose and build now assign unique
  HyperFrames project names per narova project, preventing collision
  when multiple projects are open.

## [0.7.2] - 2026-07-26

### Added

- **Partial word alignment for mixed-language scenes** — alignment now
  falls back gracefully on per-word mismatch, keeping estimates for
  words that cannot be measured.
- B-roll videos are now HyperFrames-native clip nodes (seek-safe,
  no more frame-dropping on timeline scrub).

### Fixed

- Per-turn language cache key now uses `sentence_cache_key()` for
  stable identity; previously joined voice/speaker/text/tempo by raw
  pipe, producing different keys for the same inputs.
- Arabic and Urdu captions now render right-to-left (RTL).
- Unique Studio project names per narova project (prevents preview
  collision when switching between projects).
- Generated CSS externalized to its own file to keep each scene's HTML
  body under HyperFrames' 500-line lint threshold.

## [0.7.1] - 2026-07-26

### Added

- **Per-turn language for multilingual TTS** — `lang` on any turn in
  `reel.config.mjs` selects the TTS language for chatterbox and qwen
  backends (e.g. `vo: [{ who: "a", text: "مرحباً", lang: "ar" }]`).
- Voice sample management: `narova voice add/list/remove` for
  chatterbox voice cloning.

### Changed

- Agent intake step: agents must ask before picking defaults. Questions
  are self-explanatory to a first-time user; intake is a dynamic
  principle, not a fixed checklist.

### Fixed

- Chatterbox voice samples are auto-normalized on import (mono, 24 kHz,
  voice-range EQ, peak-safe loudness).
- Force CPU on Apple Silicon for XTTS, Qwen, and Chatterbox — MPS
  backend has known conv1d breakage with these models.
- `narova check` now warns when scene body HTML uses HyperFrames-
  reserved class names (e.g. `.scene`, `.container`).
- Landing page redesigned around video-first workflow; 0-to-N narrator
  messaging corrected (multi-speaker was previously described as
  "two-host" only).

## [0.7.0] - 2026-07-26

### Added

- **Background bed + spot SFX** — `bed: {file, volume, fadeIn, fadeOut}` and
  `sfx: [{file, scene, at, volume}]` mixed into narration via ffmpeg.
  Bed changes don't require re-synthesis.
- **Caption style presets + keyword emphasis** — `captions: {preset: karaoke|slam|pop|rise, emphasis: [...]}`.
  Slam/pop use GSAP-only tweens (seek-safe); emphasis highlights matching words.
- **Per-platform size presets + duration-band lint** — `platform: tiktok|reels|shorts|linkedin|x` picks frame size
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
