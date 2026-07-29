# Changelog

All notable changes to narova are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.12.0] - 2026-07-29

### Added

- **Versioned external TTS provider architecture** — Narova can now use
  explicitly registered executable workers speaking
  `narova-tts-provider/v1` as JSON Lines over stdin/stdout. Provider-specific
  code, authentication, models, endpoints, and dependencies remain outside
  the main skill.
- **Provider registry CLI** — `narova providers add|list|doctor|remove`
  validates normalized manifests under `~/.narova/providers/`, required
  environment variables, executable commands, and worker handshakes.
- **Generic external voice listing** — registered providers can implement
  `listVoices`, exposed through
  `narova voices list --backend <provider>`.
- **Optional `narova-elevenlabs` companion skill** — isolated stdlib HTTP
  worker with environment-only `ELEVENLABS_API_KEY`, ElevenLabs voice IDs,
  opaque provider options, WAV conversion, structured errors, and mocked
  tests that make no paid calls.
- External provider identity, protocol, implementation version, speaker,
  language, gain, tempo, and deterministically serialized options now
  participate in audio fingerprints and sentence-cache identity.

- **Urdu sentence punctuation support** — the Python `sentences()` and Node
  `countSentencesPerTurn()` functions now recognize Urdu full stop `۔` (U+06D4)
  and question mark `؟` (U+061F) as terminal punctuation, splitting
  multi-sentence Urdu turns into the same sentence-level units as English
  text. Previously, Urdu sentences joined by native punctuation were treated
  as one long sentence, which could cause incorrect word-to-turn assignment
  when merging timings.
- **`urdu-voice-director` skill delegation** — SKILL.md now instructs agents
  to use the `urdu-voice-director` skill before finalizing `vo` text in
  projects with meaningful Urdu dialogue. The skill improves conversational
  naturalness without adding provider-specific tags to Narova's config.
- **ElevenLabs performance-text boundary documented** — the ElevenLabs
  configuration now explains that `vo.text` serves both synthesis and captions;
  performance directions should use `providerOptions.voiceSettings` until a
  dual-text protocol field exists.
- **`synthesisText` — separate caption and synthesis text** — `vo` turns can
  now carry an optional `synthesisText` field. When present on an external
  provider, `synthesisText` is sent to TTS (allowing performance tags like
  `[whispering]`) while `text` remains the clean source for captions, SRT,
  and VTT. When absent, `text` is used for everything. Local backends always
  ignore `synthesisText`. Sentence-count mismatch between the two texts falls
  back safely to text-only with a warning.
- **Tests for Urdu sentence splitting** — Python: Urdu full stop, question
  mark, ellipsis behavior, mixed English/Urdu, English unchanged. Node:
  matching mergeTimings tests with word-level `si` assignment.

### Changed

- **Website refreshed through the current product surface** — accurate
  local-first/provider language, manifest planning, release gates, export
  profiles, current changelog entries, improved mobile layout, keyboard
  focus, reduced-motion behavior, and caption-track accessibility.
- `pipeline.py`: `sentences()` regex compiled once as module-level
  `_SENTENCE_RE`.
- `manifest.js`: `countSentencesPerTurn()` regex extracted to module-level
  `SENTENCE_SPLIT_RE` constant.
- ElevenLabs configuration: added performance-text/captions boundary note.

## [0.11.0] - 2026-07-29

### Added

- **URL-to-video boundary documented** — README quickstart now clearly separates
  AI agent responsibilities (reading, classifying, interpreting sources,
  writing scene scripts) from Narova's `ingest` command (mechanical pass:
  fetch HTML, extract up to five images, optional browser screenshot).
- **`--deliverables` documented in CLI reference** — `cli.md` now describes
  the flag, preset selection behavior, and the scale+pad (pillarbox/letterbox)
  limitation explicitly.
- **`--safe-area-guides` documented in CLI reference** — requires
  `--deliverables` to take effect; only applies to the `tiktok-1080p` preset.

### Changed

- **CLI reference accuracy fixes** (Codex-reviewed):
  - `--deliverables` (bare) renders `narova-standard` plus the platform's single
    canonical preset, not "all presets for the platform" — `youtube-4k` is
    never auto-selected.
  - `--safe-area-guides` has no effect on a bare `narova build`; documented
    that it requires `--deliverables`.
  - Only `youtube-4k` passes its resolution to HyperFrames; other presets
    render at the composition's natural size and are resized in ffmpeg.
- **`--deliverables` limitation added to SPEC.md flags section.**

## [0.10.0] - 2026-07-29

### Added

- **`narova check --strict`** — validates that every detected factual claim in
  `vo` actually appears in the `claims.md` ledger. Warns on unledgered claims
  but still exits 0.
- **`narova check --release`** — a build gate that fails (exit 1) on: remote
  dependencies (`<script>`, `<link>`, `<iframe>`), remote assets, unresolved
  local assets, missing claims in the ledger, unsupported HTML elements
  (`<canvas>`, `<web-component>`), and black/empty frames. Intended for CI
  pipelines and pre-build validation.
- **Claims ledger table parsing** — `readClaimsLedger()` now parses the
  Markdown table format generated by `narova ingest` (`| # | Claim ... |`),
  in addition to `## claim:` headings and bullet lists.
- **Silent voice-less projects** — `voices: {}` is now allowed when every
  scene is a silent scene (`vo: []` with a positive `dur`). The previous
  hard requirement for at least one declared voice is removed.
- **Version sync for SPEC.md** — `scripts/sync-version.js` now also updates
  the `## Status: … shipped` line in `SPEC.md`, ensuring the status line
  never drifts from the canonical version in `package.json`.

### Changed

- **SKILL.md version check** — changed from `curl | head -5` to
  `curl | grep 'version:' | head -1`, because the YAML frontmatter version
  field is beyond the first 5 lines.
- **Platform documentation** — `youtube` added to every platform list in
  `SKILL.md`, `cli.md`, `scene-script.md`, `SPEC.md`, and `narova.js` help,
  matching the YouTube support already registered in `util.js`.

### Fixed

- **Pexels API authentication** — `stock-assets.md` no longer claims Pexels
  works without an API key. All Pexels sections now document the required
  `Authorization` header. Pexels was demoted in the acquisition priority;
  no-key alternatives (Unsplash/Pixabay website, Coverr, Wikimedia) are
  promoted instead. The misleading "single-word query" 401 workaround has
  been removed.
- **Release asset gating** — remote and unresolved asset references now
  correctly populate the `errors` array in release mode, so `narova check
  --release` actually rejects them instead of warning.
- **Black-frame detection** — images, videos, and SVG elements are now
  recognized as visible content, so valid visual-only scenes no longer
  trigger a false black-frame error in release mode.
- **Clipped-audio heuristic removed** — the release gate no longer fails
  on short final utterances with `tail < 0.5s` (the pipeline appends tail
  after synthesis, so this was a false positive).
- **Platform duration bands** — remain warnings (not errors) in release
  mode, as they target recommended durations rather than correctness.

## [0.9.0] - 2026-07-28

### Added

- **Audio fingerprint for `--reuse`** — reuse now compares a full audio
  fingerprint (backend, speaker, sample-content hash, text, language, tempo,
  gain, instruct, exaggeration, cfg_weight, pipeline version) instead of
  only narration text. A voice swap, backend change, clone re-recording, or
  tempo change all now correctly invalidate stale audio.
- **Asset hash change detection in planner** — `narova plan` now compares
  asset hashes (bed files, SFX, clips, theme.css) in addition to the config
  hash. Replacing a file at the same path now correctly reports changes.
- **Pipeline stage granularity in planner** — the planner now distinguishes
  five pipeline stages: `tts`, `align`, `mix`, `compose`, `render`. A bed/SFX
  change triggers `mix → compose → render` without re-synthesizing speech.
  An alignment change triggers `align → mix → compose → render`.
- **Named releases as project snapshots** — `narova release save` now
  captures the full project snapshot: manifest, config file, theme.css,
  assets directory, claims.md, and sources.md. `restore` writes them back
  to the project directory.
- **Manifest-driven pipeline** — the manifest is now compiled first and
  written as the canonical intermediate representation. `narration.json`
  and `config.resolved.json` remain as compatibility projections for the
  Python TTS stage.
- **Canonical export preset registry** — the manifest now uses the same
  authoritative `PRESETS` catalog as the exporter. Preset names are unified
  (e.g., `tiktok-1080p` instead of `tiktok-preset`). The manifest deliverable
  records now include `loudness`, `safeArea`, and `thumbnail` metadata.
- **YouTube platform support** — `youtube` is now a valid `--platform` value
  (1920×1080, 0–720s band).
- **Dimension enforcement in ffmpeg** — `buildFfmpegArgs` now always inserts
  a `scale`+`pad` filter matching the preset dimensions, ensuring the
  rendered deliverable is exactly the declared size.
- **Release path containment** — `releasePath()` now validates that the
  resolved path stays inside the releases directory as defense-in-depth.

### Changed

- **TikTok safe areas are now authoring hints** — the drawbox overlay is
  only applied when `--safe-area-guides` is passed. It is no longer burned
  into the final deliverable by default. The `safeArea` property moved from
  `preset.enc.safeArea` to `preset.safeArea`.
- **Manifest stores portable paths** — `audio.bed.file`, `audio.sfx[].file`,
  and hash keys now use project-relative paths instead of absolute machine
  paths. The manifest no longer leaks local directory structures.
- **Release storage format** — releases are now directories under
  `~/.narova/releases/<name>/` containing `manifest.json` plus optional
  project snapshots. `list` now shows title and duration.

### Fixed

- Duplicate `changes.push('timing')` in the timing-change planner branch.
- `--deliverables` flag now prepares for list format (still boolean for now).
- Scene clip paths in build hashes now match the stored relative form.

## [0.8.3] - 2026-07-28

### Added

- **Render-path CSS compatibility lint** — `narova check` now warns on CSS
  properties that force HyperFrames into slow screenshot capture: `backdrop-filter`,
  `filter: blur()`, `filter: drop-shadow()`, `filter: brightness/saturate/contrast()`,
  and `mix-blend-mode`. Scans both `theme.css` and scene body HTML. See LEARNINGS #38.
- **Auto-loop b-roll clips** — `narova compose` now detects clips shorter than
  their scenes and auto-loops with ffmpeg `-stream_loop -1`. Handles both mp4
  (libx264) and webm (libvpx-vp9) input formats.
- **Wipe transition warning** — `check` warns when `wipe` transition is used on
  videos over 30s (wipe uses `clip-path`, another slow-capture trigger).
- 9 new check tests (7 CSS lint + 2 wipe transition).
- LEARNINGS #38: documented all known slow-path CSS and the auto-loop fix.

### Fixed

- Built-in `.broll` CSS removed `filter:brightness(.72)` (replaced with opacity)
  to avoid triggering the slow render path in narova's own generated output.
- Auto-loop ffmpeg command uses `libvpx-vp9` for webm sources (libx264 is
  incompatible with webm container).

## [0.8.2] - 2026-07-28

### Changed

- **`timeline.json` → `manifest.json`** — renamed to align with the roadmap's
  "canonical narova.manifest.json" vision. All references updated throughout
  the codebase: `manifest.js`, `manifest.test.js`, pipeline, CLI, SPEC, and
  reference docs.

### Added

- **Hash/immutability layer** — `manifest.json` now includes SHA-256 hashes
  for the resolved config, theme CSS, every file under `assets/`, and
  bed/sfx/clip files. An `environment` block captures the narova version,
  TTS backend, and compile timestamp.
- **`narova plan`** — compares the current project config against the last
  manifest and classifies the change: no-change, config-only (compose +
  render), visual-only (compose + render, no synth), script-changed (full
  synth), or full rebuild. Shows affected scenes and which pipeline stages
  will run.
- **`narova release`** — named release management in `~/.narova/releases/`:
  `save <name>` snapshots `manifest.json`, `list` shows all saved releases,
  `restore <name>` copies back to `out/manifest.json`, `remove <name>`
  deletes a release.
- `plan.test.js` (11 tests), `releases.test.js` (7 tests).

### Fixed

- Releases test suite uses isolated temp directories (not `~/.narova/`).
- Release names sanitized to alphanumeric + dots/dashes/underscores.

## [0.8.1] - 2026-07-28

### Added

- **Comprehensive export presets** — `skills/narova/tool/src/exports.js` defines
  platform-specific render + encode profiles: YouTube 1080p/4K, TikTok,
  Instagram Reels, YouTube Shorts, LinkedIn, X, and a narova-standard baseline.
  Each preset carries HyperFrames render flags (`--format`, `--quality`,
  `--resolution`), an ffmpeg post-processing profile (codec, bitrate, audio
  loudness normalization, safe-area guides, pixel format, `faststart`), and
  an optional thumbnail extraction point.
- `buildFfmpegArgs(input, output, preset)` — pure function for unit-testable
  ffmpeg argument construction.
- `postProcess` — loudness-normalize + h264 encode with safe-area drawbox.
- `generateThumbnail` — extract a thumbnail frame via ffmpeg.
- `renderDeliverable` — orchestrate HF render → ffmpeg post-process → thumbnail.
- `buildDeliverables` — render all applicable presets (standard first).
- `--deliverables` CLI flag on `narova build`.
- `PLATFORM_TO_PRESET` maps legacy platform keys to canonical preset ids.
- 19 unit tests with pure arg-level ffmpeg assertion.

### Fixed (codex review)

- **P1**: No in-place ffmpeg processing; use temp path → rename.
- **P2**: Extension stripped from output name before suffixing.
- **P2**: Removed `-crf` from bitrate-targeted encodes.
- **P2**: Tests assert ffmpeg args via pure `buildFfmpegArgs`.

## [0.8.0] - 2026-07-28

### Added

- **Versioned timeline intermediate representation** — `narova compile`
  produces `out/timeline.json`, a self-contained JSON document (schema
  version `1.0`) that captures every datum the pipeline needs: project
  metadata, format, voices, scenes with narration, asset inventory,
  deliverables, and variant definitions. The timeline is also written
  automatically during `synth`/`compose`/`build` and enriched with measured
  word timings after synthesis (`enrichTimeline`).
- `compile` command in CLI + help text.
- Timeline validation (`validate`/`isValid`) enforces the `narova` key,
  schema version compatibility, and structural integrity.
- `mergeTimings` merges `timings.json` word-level data into the timeline
  scene tree with correct sentence-to-turn distribution.
- `countSentencesPerTurn` utility for mapping synthesis sentence indices to
  VO turns.
- `walkAssets` recursively discovers all files in `assetsDir/` for the
  timeline asset inventory.
- 31 unit tests for timeline compilation, validation, merge, and round-trip.

### Changed

- `writeStageInputs` now also writes `timeline.json`.
- `synth` and `build` commands call `enrichTimeline` after TTS completes.
- Variants in the timeline carry full scene definitions (body, VO, transition)
  rather than just ids.
- SPEC.md: timeline IR section added; status bumped to 0.8.0.

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

- Version drift corrected: root `package.json` is now the canonical version
  source; `scripts/sync-version.js` stamps it into `SKILL.md`, `tool/package.json`,
  and `README.md` badge. `npm version` runs it automatically.

## [0.7.10] - 2026-07-28

### Added

- npx retry with fixed delay for DNS failures during renderer fetch.
- Stock assets reference documentation.

### Changed

- Doctor command now reports mismatched tool versions, venv health, and
  `agent-browser` availability (for stock footage acquisition).
- Python test suite: 10 alignment tests (`test_align.py`), 8 audio mix
  tests (`test_mix.py`) covering bed/sfx concatenation and scene-anchored
  positioning.

## [0.7.9] - 2026-07-27

### Added

- `captions.maxWords` config — limit words per caption line to prevent
  overcrowding.
- CSS custom property tokens for caption zone spacing (`--cap-pad`,
  `--cap-gap`).

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
- Voice sample management: `narova voice sample add/list/remove` for
  chatterbox voice cloning (`samples.js` — validation, auto-normalization:
  mono, 24 kHz, voice-range EQ, peak-safe loudness).

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

- **Full CLI command set** — `narova init <dir>` (project scaffolding),
  `narova check` (config validation), `narova shots` (per-scene QA snapshots
  via HyperFrames `snapshot`), `narova preview` (HyperFrames Studio with
  `--detach`/`--stop` lifecycle), `narova captions` (standalone SRT/VTT
  rewrite from timings.json), `narova voices list|get`, `narova doctor`
  (ffmpeg, python, venv, hyperframes checks), and `narova build` (full
  synth + compose + render pipeline).
- **Background bed + spot SFX** — `bed: {file, volume, fadeIn, fadeOut}` and
  `sfx: [{file, scene, at, volume}]` mixed into narration via ffmpeg.
  Bed changes don't require re-synthesis.
- **Caption style presets + keyword emphasis** — `captions: {preset: karaoke|slam|pop|rise, emphasis: [...]}`.
  Slam/pop use GSAP-only tweens (seek-safe); emphasis highlights matching words.
- **Per-platform size presets + duration-band lint** — `platform: tiktok|reels|shorts|linkedin|x` picks frame size
  and duration-band lint. `compose`/`build` write `captions.srt` + `captions.vtt` sidecars
  (`captions.js`: SRT/VTT export from timings.json).
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
- Core Node modules established: `config.js` (project discovery, ESM/CJS/JSON
  loader), `hf.js` (HyperFrames CLI access, pinned version, preview lifecycle),
  `util.js` (shared helpers: ffprobe, resolveSize, PLATFORMS, hexToRgba),
  `doctor.js` (environment checks), `init.js` (project scaffolding).
- Docs rewritten in plain language; tests moved into the skill.

## [0.3.0] - 2026-07-21

### Changed

- **Breaking:** `build`/`preview` run on the HyperFrames render engine;
  the old player/capture/assemble/serve pipeline is deleted.

### Added

- `narova compose` — HyperFrames composition generator
  (`compose/index.js`, `data.js`, `html.js`, `css.js`, `runtime.js`).
  Generates deterministic GSAP-timeline-driven HyperFrames projects
  with word-synced captions, cue-timed reveals, and data-* animators.
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

[Unreleased]: https://github.com/ammar-hasan/narova/compare/main...HEAD
[0.12.0]: https://github.com/ammar-hasan/narova/compare/be28b04...HEAD
[0.11.0]: https://github.com/ammar-hasan/narova/compare/ae2945d...be28b04
[0.10.0]: https://github.com/ammar-hasan/narova/compare/3c1e85f...ae2945d
[0.9.0]: https://github.com/ammar-hasan/narova/compare/ea7056a...3c1e85f
[0.8.3]: https://github.com/ammar-hasan/narova/compare/60295cc...ea7056a
[0.8.2]: https://github.com/ammar-hasan/narova/compare/13ee0f6...60295cc
[0.8.1]: https://github.com/ammar-hasan/narova/compare/943bedc...13ee0f6
[0.8.0]: https://github.com/ammar-hasan/narova/compare/ddc6829...943bedc
[0.7.11]: https://github.com/ammar-hasan/narova/compare/v0.7.10...v0.7.11
[0.7.10]: https://github.com/ammar-hasan/narova/commit/40723f9
[0.7.9]: https://github.com/ammar-hasan/narova/commit/ba9880c
[0.7.8]: https://github.com/ammar-hasan/narova/commit/b156c8d
[0.7.7]: https://github.com/ammar-hasan/narova/commit/0ed2efe
[0.7.6]: https://github.com/ammar-hasan/narova/commit/a4bef78
[0.7.5]: https://github.com/ammar-hasan/narova/commit/637258f
[0.7.4]: https://github.com/ammar-hasan/narova/commit/cab2a1a
[0.7.3]: https://github.com/ammar-hasan/narova/commit/b408b7c
[0.7.2]: https://github.com/ammar-hasan/narova/commit/be3ab29
[0.7.1]: https://github.com/ammar-hasan/narova/commit/e0acbca
[0.7.0]: https://github.com/ammar-hasan/narova/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/ammar-hasan/narova/commit/eeb373d
[0.5.0]: https://github.com/ammar-hasan/narova/commit/16f1c43
[0.4.0]: https://github.com/ammar-hasan/narova/commit/d00243f
[0.3.0]: https://github.com/ammar-hasan/narova/commit/eb361dd
[0.2.0]: https://github.com/ammar-hasan/narova/commit/a4f7d3b
[0.1.0]: https://github.com/ammar-hasan/narova/commit/9f21fa3
