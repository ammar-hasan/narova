# Changelog

All notable changes to narova are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/).

## [0.32.0] - 2026-08-20

### Added

- **Versioned agent machine protocol.** Every public operation honors an
  explicit machine-output request (`--json`) and emits exactly one versioned
  result envelope (`narova.result/1`) to standard output: operation name,
  success, data, diagnostics, and committed artifacts. A closed exit-status
  vocabulary separates usage errors (`2`), operation failures (`1`), and
  subject non-passes (`3`) from success (`0`); diagnostics carry fixed
  severities and stable dot-namespaced codes from a public registry; envelope
  schema evolution is additive within a major version. The shipped
  `AGENT_PROTOCOL.md` documents the inspect → modify → validate → preview →
  critique → build → verify loop for machine consumers.
- **Shareable project archives.** `narova pack` produces a deterministic
  byte-identical `.narova` archive (ZIP + `narova.archive.json` manifest)
  containing verified authoring closure and excluding outputs, history, and
  machine-local state. `narova open` verifies and safely materializes an
  archive — digest-checked, path-confined, non-executing, with a trust notice —
  and `narova inspect` validates without writing. `narova remix` materializes a
  local archive, directory, or bounded `github:` locator into a fresh project
  with its own identity, a recorded (not verified) provenance parent, and no
  inherited history. Fetched and archived bytes are never executed.
- **Explore gallery.** The website gains a static `/explore/` route of curated
  project entries, each offering **watch** (rendered video with captions and
  poster), **inspect** (publication-time static projection of the archive:
  manifest summary, authoring source, scene/narration inventory, provenance,
  and declared rights/credits), and **remix** (copyable `narova remix` command
  and archive download). No project content is executed or unpacked in the
  browser; entries are admission-reviewed and checked in.

### Changed

- **Public surface cleanup.** The monolithic `SPEC.md` and the checked-in
  `.claude`/`.agents` skill aliases are removed; the canonical core skill lives
  at exactly one repository location and agent discoverability uses the
  documented skill-install mechanism. Contributor-review tooling is private
  control-plane material, not a shipped product surface.
- **Relicensed to Apache-2.0.** Narova's code and first-party companion skills
  move from MIT to the Apache License 2.0, adding an explicit patent grant and
  retaliation clause for downstream adoption. A `NOTICE` file records third-
  party components. Previous releases (through 0.31.14) remain MIT; vendored
  Three.js and other third-party assets keep their own licenses.

## [0.31.14] - 2026-08-19

### Changed

- **Living center visuals for the demo.** The built-in demo project's
  scenes now animate a centered play-mark medallion (scene 1) and
  staggered popping dots (scene 2) over a subtle gradient, using only
  cross-renderer motion primitives (`enter`/`drift`, explicit heights,
  `textAlign`) so the browser and browserless profiles render identical
  geometry. Public-surface refresh under CHANGE-2026-029; no normative
  or pipeline change.

## [0.31.13] - 2026-08-19

### Added

- **One-command activation: `narova demo`.** A readiness checklist with live
  progress (upfront plan, byte-level transfer lines, bounded waits, 20-second
  stall timeout, non-interactive liveness) reconciles the machine first:
  find-what-exists, then digest-verified provisioning into `~/.narova` — a
  pinned piper voice on every platform and a pinned static ffmpeg on Linux
  (macOS and Windows fail closed to explicit install guidance until
  checksummed sources are recorded). The demo then runs the ordinary build
  pipeline — real synthesis, measured timing, render, encode — and finishes
  with a playable MP4, SRT/VTT captions, and the readable demo project left
  behind, reporting measured time-to-first-video and network bytes. Warm
  reruns reuse everything. A bare interactive `narova` runs the welcome flow:
  checklist, one creation-intent question recorded as draft-brief material,
  and consent-gated agent-skill installation. `doctor` prints the same
  readiness matrix, and `narova-uninstall --purge-tools` removes provisioned
  tooling on request. New clean-machine CI job proves the Linux path
  end to end on every change.

## [0.31.12] - 2026-08-19

### Added

- **Evidence-graded project provenance.** `narova provenance` composes existing
  project artifacts into Claims, Media, AI generation, and Reproducibility
  sections, with a matching `--json` form. Every fact is labeled verified,
  declared, or unknown; tampered and missing evidence stays visible while the
  advisory command succeeds. Rights buckets are display-only, not legal
  clearance, and exact used-asset closure is never implied. Projects may add an
  optional authored `provenance` declaration for script authorship and a
  disclosure note; declarations are never upgraded to verified evidence.
- **Portable credit formats and toolchain identity.** `narova assets credits
  --format text|youtube|web|json` renders the same deduplicated attribution set
  for each destination while preserving the prior default text output. Compile
  now records locally available renderer and speech-backend implementation
  versions in `manifest.json` (explicit null when unavailable) without running
  a provider or using the network; the provenance report consumes those facts.

## [0.31.11] - 2026-08-19

### Added

- **Revision ledger (advisory).** Every successful base build now records a
  revision to the append-only `out/revisions.jsonl` when — and only when —
  the effective resolved project state changed since the last recorded
  revision; an unchanged rebuild records nothing and says so. Each record
  carries the audio/timing fingerprints, per-scene identity digests, measured
  stage durations, and a measured reuse report for that build: per-scene
  audio byte-identity by content digest, render-span reuse vs identity
  re-render vs fallback, sentence-cache hit/fresh counts, and the shared
  artifacts rebuilt by design. Ratios state their basis and unit; missing
  evidence is "not applicable", never invented; fallback re-renders never
  count as reuse. Losing the ledger never fails anything (history restarts
  at v1); variants, deliverables, and standalone synth/compose/captions
  never record revisions.
- **`narova diff` and `narova history`.** `diff` predicts the revision
  impact of your current edits per scene (script / visual / timing /
  structural; narration-only edits keep other scenes' audio and visuals),
  with a predicted reuse summary that states its basis and unit and an
  estimated render time scaled from previously measured stage durations —
  omitted, with a plain statement, before any measurement exists. With no
  ledger yet, `diff` may compare against the last build manifest and names
  that baseline. `history` lists recorded revisions with one-line change
  summaries and measured reuse, annotates a free-text label (metadata
  only), and compares two revisions `a..b` producing the same report from
  the records alone. Both are advisory and produce no media.

## [0.31.10] - 2026-08-19

### Added

- **Creative-identity contract.** `narova check` gains advisory-only
  surfaces that counter unattended-mode visual convergence (agents reaching
  near-identical looks across unrelated briefs). A project with an authored
  `creative.md` rationale gets: citation resolvability (unresolvable cites
  warn); a deterministic multi-dimensional identity fingerprint computed
  from the config alone (palette, structure, layout, motion); an
  isolation-safe self-check that verifies the written claims against the
  measured identity and flags contradicted or under-authored identity (works
  with zero sibling history, i.e. sandboxed runs); and a sibling advisory
  against a local fingerprint-only ledger that names the nearest sibling
  with the brief-dependence caveat. `narova check --creative-identity` emits
  `out/creative-identity.json` with the fingerprint, claims, comparison
  basis, and per-dimension breakdown. None of these surfaces can fail any
  check level. Validated by a preregistered controlled comparison
  (NAR-EXP-2026-010): palette diversity ratios 4.24×/2.18× across regions,
  two fixation events fired, owner blind review confirmed improvement.

## [0.31.9] - 2026-08-18

### Added

- **ElevenLabs voice design.** The optional companion ships an explicitly
  invoked helper (`skills/narova-elevenlabs/tool/design.py`) that turns a
  text voice description into preview audio plus an audition index, from
  which a human picks a preview; a separate step creates the permanent
  voice and prints a ready-to-paste config fragment. The resulting voice
  ID is an ordinary `speaker` value, so everything downstream is
  unchanged. Seed makes the design request reproducible; `--remix`
  derives a new voice from an existing remixable one. Companion skill
  1.1.0; no core or provider-protocol change.

## [0.31.8] - 2026-08-18

### Fixed

- **Fresh-directory release builds pass.** Captions (or their recorded
  intentional omission) now publish before the post-synth release gate
  inside `narova build --release`. Previously a first-ever release build
  in a fresh directory always failed the gate on caption-sidecar absence,
  because captions published only later in the same flow — the
  workaround was an undocumented plain `build` first. Gate conditions,
  the pre-synth gate, and plain-build behavior are unchanged.

## [0.31.7] - 2026-08-18

### Added

- **Claim coverage reporting.** Every `check` level prints
  `claims: N of M vo turns look factual (heuristic)` — informational,
  never a warning. A gate that sees little is now a visible number
  instead of silence.

### Changed

- **Spoken-style figures are claims.** The grounding heuristic now
  classifies number-word quantities ("eighty percent", "eight
  percentage points", "three times") and numeric ratios ("fifteen of
  fifteen") — the natural authoring style for local TTS narration,
  previously invisible to the digits-only gate, which let unledgered
  spoken figures pass `check --release` clean.
- **Human claims ledgers match.** Ledger bullets count anywhere in
  `claims.md` (not only after `## claim:` headings), and a detected
  claim matches ledger quantity content across digit↔number-word
  spelling ("94%" ↔ "ninety-four percent", "3x" ↔ "three times") on top
  of the unchanged prefix rules. Matching is digit-boundary anchored:
  "8%" never satisfies a claim by landing inside a ledger's "48%".
- **Honest narration estimates.** The synthesis-free estimate accounts
  for per-sentence gaps exactly as narration assembly does, removing the
  tempo-correlated under-report (measured sweep: −17.0% error at tempo
  1.0 vs −17.1% at 1.3 — uniform per-voice calibration, no drift).
- **Local-first default fonts.** Default `--sans`/`--mono` token chains
  are generic-only (`system-ui`, `sans-serif`, `ui-monospace`,
  `monospace`); a project that names no font anywhere composes and
  renders with zero network font resolution — previously every default
  composition fetched Roboto and Consolas from Google Fonts. A
  `sans`/`mono` token override now genuinely replaces the default chain.

### Fixed

- `branch save` failure diagnostic names `narova shots --motion --proof`,
  the only command that writes the proof receipt it demands.

### Verified

- End-to-end: spelled-narration release builds refuse without a ledger
  and pass with a topic-organized digit-only one, where stock 0.31.6
  passed silently; default projects build complete videos with zero
  font-fetch lines across the whole pipeline.

## [0.31.6] - 2026-08-16

### Added

- **Optional compressed companion.** `narova build --companion [size]`
  requests a compressed copy of the video beside the untouched primary —
  an agent-owned iteration lever for quick review cuts (WhatsApp
  documents, email, fast glances) while the final deliverable stays the
  full-quality video. The size aim feeds deterministic derived encoding
  (aim − audio − container overhead ÷ duration, clamped to rate
  ceilings; documented 720p quick-review defaults without an aim), and
  every companion reports `aim/achieved/bitrate` as information — misses
  never fail anything; re-aiming is the requester's visible loop.
  Nothing is enforced and no preset commits to a size.

### Verified

- The seven-minute production that motivated the change produced a
  58.1MB companion from a 60MB aim (derived 1032k, 720p) with a single
  flag, replacing a hand-rolled two-pass ffmpeg escape.

## [0.31.5] - 2026-08-16

### Added

- **Agent observability surfaces.** Multi-clip render failures now name
  the render stage, the failing or candidate clips, and the retry count
  before the engine exit; project-global choreography or JS imports that
  downgrade HyperFrames caching to whole-video mode are announced at
  check time instead of degrading silently.
- **Advisory review evidence.** `narova review --coverage` summarizes
  per-clip usage across the reel, `--contact-sheet` produces one labeled
  still per scene from the encoded video, `--excerpt "term1,term2"` cuts
  word-timed audio excerpts for risky pronunciations, `--silences
  [threshold]` reports silence gaps in the mix, and `--takes` indexes
  every narration sentence with timing, file, and take identity. All are
  advisory — none gate a build.
- **Deterministic narration takes.** Synthesis pins an identity-derived
  seed so an unchanged sentence reproduces its take, matching the
  renderer's determinism. Verified for all bundled backends (piper by
  construction; xtts, qwen, and chatterbox via a pinned sampling seed —
  byte-identical double-generation tested). Authored variation remains
  first-class: per-voice `vary`, per-sentence `take` nonces that select
  reproducible alternative takes, and a project-level
  `speech.deterministicTakes: false` off-switch. Cached takes are never
  rewritten.
- **Take-identity records.** Every synthesized sentence records its
  backend, voice, determinism mode, seed or nonce, language routing, and
  model (when set) to `out/audio/takes.json`, with durable per-sentence
  takes in `out/audio/sentences/`.
- **Delivery-control capability disclosure.** `narova providers list`
  now shows which pronunciation and delivery mechanisms each backend
  honors (honored / ignored / unknown, never inferred). The ElevenLabs
  companion declares seed stabilization honored; the OpenAI companion
  declares delivery instructions honored and seeds ignored. Check warns
  when synthesis text carries a markup family the selected backend
  declares ignored, and a critique-only hint notes an unused
  `instruct` capability.

### Changed

- **Empty caption sidecars can no longer ship silently.** When caption
  derivation yields no sentences while narration audio exists, build
  omits the sidecars and records the reason
  (`out/captions-omitted.json`); release check fails an empty or absent
  published sidecar without a recorded reason.

### Verified

- Silence review on a real seven-minute production surfaced the exact
  owner-reported 2.7-second pause plus ten more gaps; the take index
  exposed the bilingual voice split behind a perceived multi-narrator
  drift. Qwen and chatterbox determinism verified by byte-identical
  double generation under pinned seeds.

## [0.31.4] - 2026-08-15

### Added

- **Optional 3D-production companion.** `narova-3d-production` adds an
  independently installable direction layer for intentional subject/world
  representation, capability routing, scene direction, and honest inspection.
  Its concise workflow loads at most three specialist references conditionally
  and adds no renderer, physics engine, preset, template, script, or core
  dependency.

### Changed

- **3D guidance leaves the core skill.** Core Narova retains every existing 3D
  authoring and rendering capability while specialist production direction now
  lives in the optional companion instead of a universal core checklist.
- **3D proof before scale.** The companion now prevents accidental placeholder
  promotion, keeps abstraction and realism equally available, separates
  artifact-only perception from structured fact checks, and proves a risky
  visual and movement premise before full production.

### Verified

- **Complete-film validation.** An owner-reviewed, 94-second procedural 3D
  story exercised the refined companion through visual proof, movement proof,
  release rendering, and encoded motion/black-frame audits. The result supports
  the bounded workflow while making no claim of model-independent creative
  quality.

## [0.31.3] - 2026-08-12

### Changed

- **Clear prompt-to-video positioning.** npm metadata and both READMEs now lead
  with Narova's product category, local-first workflow, agent audience, and
  concrete 2D/3D, TTS, caption, and walkthrough capabilities.
- **Website discoverability.** The site now has descriptive titles and headings,
  self-canonical URLs, complete Open Graph and X cards, a crawlable favicon,
  an XML sitemap, and evergreen `WebPage` plus `SoftwareApplication` JSON-LD.
- **Direct distribution links.** Website visitors can reach the npm CLI,
  skills.sh agent skill, GitHub repository, and issue tracker from descriptive
  links.

### Verified

- Integration checks require focused npm keywords, canonical/social metadata,
  valid structured data, and absolute canonical sitemap entries without ignored
  `priority` or `changefreq` hints.

## [0.31.2] - 2026-08-12

### Changed

- **Lockstep skill and CLI compatibility.** The skill now checks
  `narova --version` before use, reuses only the exact matching release, and
  installs its pinned npm package when the CLI is missing, older, or newer.
- **One compatibility pin.** The skill derives its expected runtime version
  from a single exact npm spec instead of maintaining a second shell version.

### Fixed

- npm installation failures retain their original exit status, and a
  successful install that still resolves to a stale CLI fails explicitly.

### Verified

- Release checks require exactly one canonical npm pin plus the runtime version
  reconciliation controls. Integration tests cover exact reuse, stale upgrades,
  PATH conflicts, npm failures, and unresolved post-install mismatches.

## [0.31.1] - 2026-08-11

### Changed

- **npm-only installation lifecycle.** Removed the superseded
  `tool/install.sh` GitHub installer. The packaged uninstaller now targets only
  `@narova/narova`; it no longer detects or removes the old unscoped layout.
- **Reliable version synchronization.** `version:sync` now updates both Narova
  skill metadata and its exact `@narova/narova` bootstrap pin.

### Fixed

- Node 18 now expands the JavaScript test files through the shell instead of
  receiving an unsupported quoted glob.

### Security

- npm publishing uses Trusted Publishing only, with no long-lived token
  fallback, and refuses tags whose commit is not reachable from `main`.

## [0.31.0] - 2026-08-11

### Added

- **Public npm distribution bootstrap.** The standalone CLI is available as
  the public `@narova/narova` package. This one-time release was published
  manually before Trusted Publishing was configured.
- **Packed-artifact release gate.** CI packs the exact npm tarball, installs it
  into a fresh prefix, exercises all three commands, scaffolds a project, and
  requires that project to pass `narova check`.

### Changed

- **Verifiable skill bootstrap.** The Narova skill installs an exact npm
  version instead of downloading and executing a mutable GitHub shell script.
- **Lean public artifact.** The npm tarball includes runtime code, local
  renderers, voice workers, setup, uninstall, license, and package docs while
  excluding the legacy GitHub installer and all development/generated files.

### Security

- The package declares its exact public repository and `tool/` source
  directory and has no npm install lifecycle scripts. The manually published
  bootstrap has a registry signature but no provenance attestation; later
  releases require OIDC Trusted Publishing and provenance.

## [0.30.0] - 2026-08-11

### Added

- **Verified creative-asset lifecycle.** `narova assets
  import|download|providers|search|acquire|list|untrack|verify|credits` keeps
  stock photos, clips, audio, 2D/3D assets, provenance, rights, hashes, and
  attribution in one provider-neutral project registry.
- **Core stock adapters.** Wikimedia Commons, Openverse, NASA, Internet
  Archive, Iconify, Poly Haven, The Met, Cleveland Museum, Library of Congress,
  Pexels, Pixabay, and Freesound now share one built-in CLI. The first nine need
  no key; the other three remain independently optional.
- **LLM sourcing companion.** The separate `narova-stock-extensions` skill is
  a flexible 101-source discovery catalogue across imagery, video, audio,
  fonts, 2D, 3D, culture, maps, science, and development placeholders. It works
  with available web search, HTTP, or browser capability and installs no CLI.

### Changed

- **Honest provider readiness.** Every deterministic adapter lives in core;
  loose sources remain LLM-led and are never presented as tested adapters.
  Missing optional credentials disable only their provider.
- **Creative judgment stays with the agent.** Code owns repeatable API,
  download, verification, and registry mechanics. The skill/LLM owns queries,
  candidate selection, item-level license review, and lawful browser fallback.
  Builds continue to consume local assets without searching the web.

### Verified

- Real search, byte download, and registry verification passed for every
  no-key core adapter. A live `agent-browser` Mixkit run
  searched, inspected item-level rights, downloaded a 720p H.264 clip, imported
  it, and verified it; the selected item's Restricted License correctly
  remained visible instead of being generalized as commercial-ready.

## [0.29.0] - 2026-08-10

### Added

- **CLI installer and uninstaller.** `tool/install.sh` installs `narova`,
  `narova-setup`, and `narova-uninstall` from a selected GitHub ref. Run the
  installer again to update. The uninstaller removes the CLI but keeps projects,
  models, caches, and skills.
- **Install lifecycle tests.** Tests cover installation, update, repeated
  uninstall, package contents, and skill-to-CLI use from temporary directories.

### Changed

- **Repository layout.** The CLI runtime, renderers, vendors, evals, and tests
  moved from `skills/narova/tool/` to `tool/`. `skills/narova/` now contains
  only `SKILL.md` and references.
- **Skill setup.** The skill finds `narova` on `PATH` or installs it when needed.
  Optional TTS setup now uses `narova-setup`.
- **Development commands.** Root scripts, tests, companion skills, specs, and
  docs now use the top-level `tool/` paths.

## [0.28.0] - 2026-08-08

### Added

- **Proof-oriented branch command.** `narova branch save <name> --rationale
  "..."` now snapshots the current small pilot and records candidate metadata
  in one step. The command requires a passing receipt bound to the exact config,
  manifest, timings, audited frames, and contact sheet, then preserves hashed
  evidence outside the authored snapshot namespace. The durable proof bundle
  retains byte-hashed resolved config, manifest, timings, contact sheets, every audited
  frame, the originating project identity, and hashes for the complete restorable snapshot. Saving rehashes current
  source assets, while release validation rejects any file outside the recorded
  proof inventory or duplicate proof/snapshot identities. The ambitious workflow
  creates 2–3 small proofs, approves one, records its exact identity as expansion
  lineage, and expands only the winner. Restores reapply proof-time CLI overrides.
  Branch replacement uses a per-name lock and compare-and-swap, stages the snapshot and proof bundle together, binds approval to
  the originating project, and preserves the previous approved branch if
  publication fails. Post-commit backup cleanup cannot roll a successful
  replacement back.
- **Pilot visibility audit.** `narova shots --motion --proof` scans the actual
  rendered pilot frames and fails when at least 75% are near-black or no visual
  evidence exists. Deliberate darkness remains possible because the gate is
  explicit and normal frame inspection remains authoritative.
- **Live creativity A/B.** A deliberately tiny runner executes the existing
  music-only and raw-shader adversarial briefs with the same capable model,
  with and without Narova guidance, across independent runs and renders every
  pilot. The eight-run result and limitations are recorded in
  `docs/experiments/0.28-creativity-ab.md`.

### Changed

- **Genuinely raw zero-style canvas.** Both bundled renderers now give authored
  visuals the full frame with no implicit content max-width, centering, gutter,
  or caption reserve. `safeLayout: true` restores conservative guardrails;
  patterns and chrome remain independent opt-ins. Restored pre-0.28 manifests
  retain their historical safe geometry unless the config explicitly opts out.
- **Medium-neutral creative intent.** New `creative-brief.md` scaffolds intended
  effect, unusual hypothesis, evidence, representation, temporal behavior,
  medium choice, proof branches, selection rationale, and observable rejection
  criteria. Camera, depth, lighting, performance, typography, and interaction
  are requested only when relevant to the chosen medium.
- **Ambitious release evidence.** An explicitly `Ambition: ambitious` approved
  brief must declare 2–3 intact, project-bound, rationale-backed proof branches,
  select one approved branch from that set, and include concrete rejection
  criteria, regardless of runtime. Routine briefs remain backward-compatible.

### Preserved

- Deterministic timelines, local-only render dependencies, surgical revisions,
  sentence caching, scene caching, release snapshots, and explicit branches
  remain strict. Creativity work did not loosen reproducibility or editability.

## [0.27.0] - 2026-08-08

### Added

- **Creative confidence loop.** Non-trivial projects now begin with an authored
  `creative-brief.md`: competing directions, a concrete visual contract, beat
  map, pilot gate, and rejection criteria. The skill workflow requires proving
  an establishing shot, close shot, and action/reveal before scaling a concept.
- **Narration-beat visual review.** `narova shots --beats` samples the arrival
  and resolved state of every narration group, both sides of named markers,
  and useful coverage for silent scenes. This closes the gap between sparse
  motion checks and reviewing the actual visual promises of a film.

### Changed

- **Creative release gate.** `critique creative` reports brief/pilot readiness,
  and `build --release` now runs the checker before synthesis, then rechecks
  measured production timing before compose/render. It refuses a non-trivial
  project whose brief is missing or still draft. Final workflows pair creative
  and cinematic critique with the encoded motion audit.
- **Camera-aware cinematic critique.** Raw Three.js productions are assessed
  using their directed internal camera cuts and moves, not only the number of
  top-level Narova scenes, so persistent-world films receive meaningful shot
  density feedback.

### Fixed

- **Release duration provenance.** Creative gating distinguishes schema fallback
  durations from explicitly authored runtime, and only trusts synthesized timing
  files whose timing fingerprint matches current scene topology and silent runtime.
  Short narrated projects no longer become non-trivial merely because of fallback
  scene timing, measured narration cannot cross the gate unnoticed, and `--reuse`
  cannot replay stale silent audio after a topology/duration change.
- **Complete release preflight.** `build --release --variant` checks the base and
  selected variant before writing; `--variants` checks the base and every declared
  variant before any render starts.
- **Raw Three.js shot accounting.** Cinematic critique recognizes helper calls,
  direct timeline camera operations, bounded inline callbacks, and named function,
  arrow, or function-expression callbacks. Mixed forms add correctly without
  counting helper implementations as extra shots.

## [0.26.1] - 2026-08-07

A narrowly scoped correctness pass on v0.26's per-scene (selective) rendering,
caching, and branch snapshot features. No new architecture was introduced; the
guiding rule was "fast when safe, full render when uncertain, never creatively
wrong."

### Fixed

- **HyperFrames selective-render timing (decoded-frame verified).** Isolated
  per-scene renders of a non-first scene now match a clean full render at the
  pixel level (new real-render equivalence test). Previously the scene's
  Three.js canvas never animated, marker-triggered elements never appeared,
  external karaoke overlays never showed, and scene-local turn cues fired late
  — all because the global-to-local rebasing was incomplete. Markers, the
  Three.js render driver + cue animations + the raw `threeModule` shell,
  scene-script `_scStart`, and karaoke overlays are rebased to the scene-local
  timeline; scene-local turns are no longer double-rebased.
- **`captions:false` cache invalidation.** Toggling the caption band off (or on)
  now changes the render-cache context hash, so a captioned span can no longer
  be served for a captions-off build (or vice versa).
- **`scene.cssFile` now applies.** The schema accepted it but compose silently
  ignored it; it is now merged into the stylesheet (full and per-scene) and
  included in the scene content hash.
- **Branch restore round-trip.** `release save` wrote scene file references
  under a `source/` prefix that `restore` copied back verbatim, leaving the
  restored config unable to resolve `bodyFile`/`cssFile`/`scriptFile`/
  `threeModule`/imports. Files now round-trip at their original project-relative
  paths, and the release saver uses Narova's real config loader
  (ESM/CJS/JSON) instead of a regex pseudo-parser.
- **Cache LRU retention bounds the count.** Pruning mutated the array while
  iterating it; with old protected spans the iterator terminated early and the
  cache could stay over its 100-span budget. Survivors are now tracked in plain
  counters.
- **Subtitle preset is genuinely neutral.** Active words no longer inherit
  speaker colors + glow (the voice rule was winning the equal-specificity tie),
  and the speaker label/equalizer is hidden in subtitle mode. Karaoke/slam/pop/
  rise keep the richer treatment.
- **Manifest theme defaults agree with runtime.** The canonical manifest no
  longer records legacy teal/navy defaults that contradicted the v0.26
  monochrome runtime palette.

### Changed

- **Selective-render safety gate.** Projects whose authored behavior can depend
  on the full project timeline (project choreography, `.js` imports) now
  transparently take a whole-video render for HyperFrames, with a stated reason,
  instead of attempting an unsafe per-scene isolate. `no-browser` is unaffected
  (its spans render the full project at absolute frame times by construction).
- **Docs.** Product position is "deterministic scene-scripted video with
  exceptionally strong narration synchronization, but narration is optional";
  the fixed male/female duet casting prescription was removed (casting serves
  the concept).

## [0.26.0] - 2026-08-07

### Changed

- **Chrome off by default.** Topbar, counter, and progress bar are no longer
  rendered unless explicitly enabled (`chrome: true` or individual keys).
  `chrome: false` is still valid but redundant — the absence of chrome is now
  the baseline, not a deviation.
- **Neutral default palette.** Base theme tokens are now monochrome gray
  (`#101010` bg, `#e8e8e8` ink, `#888888` accent) instead of the
  recognizable navy/teal identity. Light mode is similarly neutral. Narova
  no longer has an accidental house style.
- **Subtitles as default caption treatment.** `captions.preset` defaults to
  `subtitle` — plain, non-animated text that matches the speech timing without
  per-word color highlights or motion. SRT/VTT sidecars always export. Choose
  `karaoke`, `slam`, `pop`, or `rise` explicitly when the concept calls for
  word-by-word animation.
- **Skill instructions de-anchored.** Concept branching now uses orthogonal
  creative dimensions (temporal grammar, spatial metaphor, representation,
  audio relationship, etc.) instead of a fixed menu of five archetypes.
  Prescriptive craft rules ("one idea per video — no exceptions," mandatory
  hook/CTA/saveable end-card) moved to optional `narova critique` profiles.
  Product ontology shifted from "narration-first" to "deterministic timeline
  with narration as one powerful timing source."

### Fixed

- **HyperFrames selective-render equivalence.** Per-scene renders now apply
  transitions correctly (using `_firstScene` metadata instead of relying on
  non-zero `start` values). Scene-local DATA includes named markers, series
  badges, karaoke overlays, walkthrough shells, project choreography, scene
  choreography/script files, and imported JS modules — every element emitted
  by `composeDoc` has an equivalent in `composeSceneDoc`. Progress bar
  correctly respects `chrome.progress` setting.
- **Cache invalidation model.** `renderContextHash` now includes `markers`,
  `includePatterns`, `series`, `platform`, captions config, theme tokens,
  chrome state, tool version, renderer version, FPS, and quality. Scene hash
  captures all per-scene author content. Invalidation is conservative —
  changing a global input invalidates all spans.
- **Branch snapshots complete.** Releases now preserve all scene file
  references (`bodyFile`, `cssFile`, `choreographyFile`, `scriptFile`,
  `threeFile`, `threeModule`, `elementsFile`, `visualFile`) and
  `config.imports` entries alongside config, theme, assets, and ledgers.
- **Bounded cache retention.** Scene cache now uses LRU pruning (500 MB /
  100 spans) instead of aggressive deletion of all non-current entries.
  Returning to a recently explored visual treatment is often free.

## [0.25.0] - 2026-08-07

### Added

- **Per-scene HyperFrames render cache.** HyperFrames now renders each scene as
  its own independent project with a scene-local timeline, trimmed audio, and
  rebased captions — the same per-scene caching architecture no-browser has had.
  Only scenes whose content hash changed re-render; the rest reuse cached spans
  via ffmpeg concat + full-audio mux. "Try five versions of scene 4" is now
  cheap on both renderers. Whole-video fallback on any cache failure.
- **Named time markers.** `config.markers = { reveal: 2.5, zoom: 5.0 }` creates
  author-defined time anchors on the project timeline. Resolve them as
  `data-cue="marker:reveal"` in HTML or `at: { marker: "reveal" }` in 3D/animation
  specs. Decouples timing from narration turns — music beats, SFX anchors,
  walkthrough actions, and explicit creative beats all resolve on the same
  deterministic timeline. `check` lints unresolved marker references.
- **Creative branch system.** `narova branch set|list|show <name>` adds
  rationale, status (exploring/candidate/approved/rejected/archived), and
  parentage metadata to saved releases. Enables "bring back the rejected surreal
  concept" and cross-branch comparison workflows.
- **LLM creativity benchmark framework.** 10 adversarial test briefs (music-only,
  no-captions, one-continuous-shot, slow-opening, empty-final-frame,
  anti-CTA-brand, shader-piece, Urdu-typography, archival-collage,
  no-UI-metaphors) plus a diversity scorer that measures palette uniqueness,
  scene-count spread, caption-preset diversity, layout-class independence,
  escape-hatch usage, hook/CTA convergence, and chrome/patterns reliance.
  Fixture-based for deterministic CI; LLM-adapter substitution contract for
  real model evaluation.
- **`narova critique` command.** Runs optional craft heuristics by profile
  (`social-short`, `explainer`, `presentation`, `accessibility`, `all`). Prints
  structured advice; never fails the build. `narova check --critique` also runs
  critique after check.

### Changed

- **Zero-style by default.** `config.patterns` now defaults to `false` — built-in
  layout classes (`.s-title`, `.pane`, `.stat`, `.flow`, `.verdicts`, etc.) are
  no longer injected into every project. Set `patterns: true` to opt into them
  as a deliberate creative choice. The scaffold now describes Narova as
  production infrastructure, not an implicit visual language.
- **No decorative grid background.** The subtle background grid (`#bg::before`
  with `opacity: 0.02`) has been removed from the base stylesheet.
- **Craft checks moved from `check` to `critique`.** Hook enforcement (lead-in
  silence, visible text, saveable end-frame), platform duration bands, and 3D
  quality hints (shadow receivers, PBR/envMap) are now opt-in craft advice under
  `narova critique`. `narova check` reports only correctness and reproducibility.
  A slow opening, a blank final frame, or a film with no CTA is no longer warned.
- **Better capability error messages.** No-browser scene-composition errors now
  suggest the escape hatch (switch to HyperFrames or add a `visual` tree). Schema
  errors for missing scene content now point to the creative ladder (elements →
  three → threeModule → visual).
- **SKILL.md, prompt-to-video.md, scene-script.md** all updated to reflect the
  zero-style default, the critique system, and reduced prescriptive grammar.

### Fixed

- `releaseChecks()` no longer fails release builds on 3D shadow/PBR aesthetic
  hints — those are critique-only.
- All 503 tests pass.

## [0.24.0] - 2026-08-07

## [0.23.0] - 2026-08-07

### Added

- **Scene-level render cache** — `narova build` now reuses previously rendered
  output instead of re-rendering the whole video on every build. The cache keys
  each rendered span on a hash of its scene content, measured word/turn
  timings, and the shared render context (theme, format, fps, quality, voices,
  assets, choreography), so a cached span is reused only when reproducing it
  would yield perceptually-identical pixels.
  - **no-browser renderer:** full per-scene caching. Only the scenes whose key
    changed are re-rendered (as video-only spans), then concatenated with the
    single authoritative full audio track via ffmpeg (`setsar=1`, no per-splice
    audio drift). "Try five title sequences for scene 4" now costs five span
    renders, not five full renders.
  - **hyperframes renderer:** whole-video caching. HyperFrames renders the full
    timeline as one MP4 and exposes no frame-range option, so an isolated
    single-scene re-render is not possible without breaking chrome/counter/
    progress determinism. The cache reuses the whole MP4 when nothing changed
    (skipping the render entirely) and stores each successful render for next
    time. Declared explicitly rather than silently degrading.
  - **Graceful fallback:** a missing, empty, or wrong-duration cached span is
    re-rendered; any failure in the cached path falls back to a full
    `renderer.render()` and opportunistically repopulates the cache. Caching
    can never fail a build. `--reuse` (TTS) is unaffected — this is a separate,
    additive layer.
  - `build --plan` now also prints the scene-cache reuse decision (the same
    `scene-cache.plan()` the real build uses), so the change scope is legible
    before any work runs.
- **`sceneHash` now covers per-scene author JS** — the manifest's per-scene
  `hash` (the cache's content component) now includes `choreographyFile`,
  `scriptFile`, and `threeModule` contents, matching the determinism-scan set
  in `check`. Editing one of those files now invalidates only that scene's
  cached span (previously it was detected only at the project-config level).

### Changed

- **HyperFrames engine pinned to 0.7.96** (was 0.7.64).

## [0.22.0] - 2026-08-07

### Added

- **`scene.threeModule`** — raw Three.js / WebGL escape hatch beneath the
  declarative `scene.three` vocabulary. A project-relative JS file inlined into
  the deterministic 3D bootstrap with `THREE`, `scene`, `camera`, `renderer`,
  `tl` (GSAP timeline), `seed`, `size`, `duration`, `assets()`, `pending`,
  `onRender()`, and `narova` helpers in scope. Custom shaders, procedural
  geometry, post-processing, particle systems, and any 3D the declarative
  vocabulary cannot express now have a deterministic home. Same determinism
  contract as choreography (no `Date`/`Math.random`/`requestAnimationFrame`/
  `setTimeout`/`fetch`). Removes the largest creative-ceiling gap.
- **Generated-media provenance** — `narova generate` now writes a `.gen.json`
  spec sidecar next to every generated clip, capturing provider, model, prompt,
  params, source URL, artifact hash, and timestamp. A generated clip is now a
  living editable creative source, not an opaque MP4. `--regenerate <mp4>`
  re-runs a previous generation from its spec; `--model`/`--size`/`--duration`
  capture/override generation parameters.
- **`build --plan`** — print what a revision will rebuild (scope: which scenes,
  which steps) before doing the work. Advisory only. Makes change scope legible
  at build time so authors/agents can revise without fear of disturbing
  approved work.
- **Determinism scan now covers all inlined author JS** — per-scene
  `choreographyFile`, `scriptFile`, and `threeModule` are now linted for
  wall-clock/random/rAF/setTimeout/fetch hazards (previously only project-level
  `choreography` was scanned).

### Changed

- **`check` correctness category is now real** — the `correctness:` warning
  prefix is wired to genuine determinism/reproducibility issues (e.g. infinite
  CSS animation). Previously the helper supported the prefix but no rule used
  it, so correctness and quality warnings were indistinguishable.
- **`scene.three` documentation honest about its bounds** — removed the false
  claim that raw 3D was reachable via a "component-custom escape hatch" through
  choreography (no such mechanism existed). The real escape hatch is now
  `scene.threeModule`.

## [0.21.0] - 2026-08-07

### Added

- **`captions: false`** — disable the visual caption band entirely. Caption DOM,
  CSS padding, and presets are cleanly omitted. SRT/VTT sidecars always export
  for accessibility. Flows through the full stack: schema → check → compose →
  runtime.
- **`config.patterns`** — control Narova's built-in layout classes (`.s-title`,
  `.pane`, `.stat`, `.flow`, `.verdicts`, etc.). Defaults to `true` for backward
  compatibility. Set `patterns: false` when the project defines its own visual
  language in `theme.css`.
- **`scene.scriptFile`** — per-scene raw JavaScript escape hatch. A project-relative
  JS file inlined into the scene's animation context with access to the GSAP
  timeline, DOM, and Three.js globals. Runs in a scoped IIFE with the same
  determinism contract as project choreography.
- **Per-scene content hashes** — every scene now carries a `hash` field (sha256
  of id, vo, body, visual, three, clip, transition) in the manifest. `narova
  plan` shows per-scene hash diffs. Foundation for scene-level render caching.

### Changed

- **Layout patterns separated from production CSS** — 30+ built-in layout classes
  extracted to `patternsCss(t)`, opt-in via `config.patterns: true`. Default
  production CSS is now neutral infrastructure only: background, chrome,
  captions, walkthrough, marks, reveals, typography base.
- **Default background neutralized** — removed Narova-branded accent/pink/gold
  radial gradient glow blobs. Default is now a flat `var(--stage)` background
  with subtle 2% grid. A blank project is a canvas, not an implicit template.
- **Default scaffold neutralized** — `init` scaffold uses plain inline styles
  instead of `.s-title` / `.display` / `.lede` layout classes. Documents
  `captions`, `chrome`, and `patterns` options in comments.
- **Hook/CTA enforcement is context-aware** — skipped for silent projects (no
  voices), `captions: false` projects, and projects without spoken narration.
  Hook/CTA warnings tagged `craft:` to distinguish creative advice from
  production correctness.
- **Check warnings categorized** — `correctness:` prefix for determinism and
  asset integrity, `craft:` prefix for creative craft advice (hook timing,
  CTA conventions, platform bands). Warnings no longer masquerade as
  correctness failures.

### Fixed

- **Documentation honesty** — `scene.three` documented as "declarative Three.js
  scenes with supported primitives" (not "unlimited"). Creative-diversity eval
  reframed as schema conformance test (not LLM behavior benchmark).
- Removed `.grad` (gradient text) and `.hairline` (decorative divider) from
  default CSS — these were pure aesthetic opinions, not production infrastructure.

### Internal

- 14 files changed, 518 insertions, 473+ tests pass.
- Escape-hatch map and benchmark specification documented alongside the
  declarative 3D bounds.

## [0.20.0] - 2026-08-07

### Fixed

- **Theme token preservation** — custom theme tokens (stage, deep, halo, colw,
  user-defined) now survive the full manifest round-trip through all pipeline
  stages. Previously only accent and bg were preserved.
- **Measured cue timing for 3D** — animationTweens resolves `{ at: { cue: N } }`
  to actual measured turn start times from timings.json, not the previous
  `cue * 2` approximation. Planning estimates remain approximate; final
  rendering uses measured timings.
- **Semantic action validation** — `draw`, `speak`, `react`, `follow`, `transform`
  now produced clear validation errors instead of silently compiling to nothing.
  Supported actions: appear, disappear, move, rotate, scale, orbit, revolve.
- **Deterministic particle randomness** — mulberry32 seeded PRNG replaces
  `Math.random()` in Three.js particle generation. Same project + scene + object
  identity produces identical particle layouts across builds.
- **`data-grow` / `data-mark highlight` transformOrigin** — transformOrigin is
  now pre-seeded via `tl.set()` before the tween, avoiding the HyperFrames
  sub-composition timeline breakage under hyperframes@0.7.64.
- **GSAP vendored locally** — GSAP 3.14.2 ships in `vendor/gsap/`. Generated
  compositions have zero CDN dependencies at render time.
- **Release restore + `--reuse`** — releases now save `.audio-fingerprint` and
  `timings.json` so `--reuse` works after restore. `resolveReuse` also verifies
  audio file integrity before declaring a reuse match.
- **Version consistency** — all 7 version sources (root pkg, tool pkg, SKILL.md,
  README badge, SPEC.md, CLI --version, docs) now fail CI when they drift.

### Added

- **Creative modularity** — 6 file-reference types per scene: `bodyFile`,
  `cssFile`, `choreographyFile`, `threeFile`, `elementsFile`, `visualFile`.
  `config.imports` for reusable project-level modules (CSS/JS/JSON/HTML/SVG).
  All file contents are hashed for deterministic build invalidation.
- **Expanded variant model** — kind tags (hook, visual, narration, pacing,
  captions), `sceneOverrides` for any scene, theme/captions/timing overrides
  per variant. Backward-compatible with the legacy `{ scene: { body, vo } }` form.
- **Concept branching guidance** — SKILL.md and prompt-to-video.md encourage
  sketching 2-3 distinct creative directions before committing to the final project.
- **Creative-diversity evaluation suite** — 10 radically different briefs,
  11 convergence metrics, machine-readable similarity checks, human review
  checklist. Run via `node tool/evals/creative-diversity-eval.js`.
- **Revision guarantee tests** — 14 tests verifying audio fingerprint stability
  for visual-only edits, theme changes, caption changes, choreography changes,
  and bed/SFX changes (all safe — no TTS required). Text, voice, and tempo edits
  correctly invalidate the fingerprint.
- **Planner accuracy tests** — 7 tests verifying correct VISUAL/AUDIO/FULL/CONFIG
  classification for body, text, theme, structure, and transition edits.

### Changed

- **Skill reframed** — SKILL.md restructured into three categories: hard
  invariants (deterministic rendering, reproducible timing, source grounding),
  optional craft heuristics (hook formulas, casting conventions, pacing —
  presented as defaults, not rules), and creative mandate (encourages custom
  HTML/CSS/SVG/Three.js/choreography over built-in templates; removes or changes
  captions when the concept calls for it).
- **Neutral project scaffold** — one narrator, no default palette, no branded
  Narova text, replace-everything design. The old teal/pink/two-host scaffold
  is replaced.
- **`references/scene-script.md`** — added creative hierarchy (semantic elements
  → portable trees → HTML/CSS → choreography → explicit Three.js), hard
  invariants section, "tools not templates" guidance for built-in layouts.
- **`references/choreography.md`** — updated transformOrigin guidance to reflect
  the pre-seed fix; documents the `tl.set` + `tl.fromTo` pattern.
- **`references/gotchas.md`** — added revision guarantee matrix and resolved
  issues section documenting all 6 fixes.

## [0.19.0] - 2026-08-06

### Changed

- **Three.js upgraded from r149 UMD to r185 ESM** — the old UMD build was
  deprecated after r149 and removed at r161. r185 is the latest stable
  (July 2026), shipped as an esbuild-bundled global script that exposes
  `window.THREE` — no ESM import maps needed, no CDN probes, opaque to
  HyperFrames' compiler so the full namespace survives tree-shaking.
  GLTFLoader is compiled into the same bundle as `THREE.GLTFLoader`.
- **Tone mapping** — default ACES filmic (`outputColorSpace=SRGB`),
  configurable via `scene.three.toneMapping` (aces, agx, neutral, linear) and `exposure`.
- **Lighting** — r185 uses physically-correct lighting (`decay=2`, no legacy
  lights). Ambient/directional intensities of 2-4 are appropriate for typical
  scenes (r149's legacy model used ~0.5-1).
- **Template preset voices** in generated projects now use `en_US-lessac-medium`
  (a real piper voice) instead of stub names.

### Fixed

- **Group/character opacity** (`appear`/`disappear`) no longer targets `.material`
  on a `THREE.Group` (which has none — the old code silently killed the scene).
  It now walks descendants and drives every material's opacity deterministically
  from the GSAP timeline.
- **Material-cache opacity bleed** — meshes that animate opacity get an isolated
  material (same shader, own uniforms) so tweening one no longer fades every
  same-colored sibling sharing the cache.
- **animationTweens `from`** honored via `tl.fromTo` instead of dropped.
- **Boot poll bounded** (200 retries + `console.error` surface) instead of
  polling forever when THREE or the timeline is absent.
- **GLTF models are deterministic** — prefetched via `fetch`, parsed with
  `parseAsync`, and the first render is gated on `Promise.all(_pending)`.
  Wireframe fallback only on explicit load failure, never a silent pop-in.
- **GLTFLoader was silently broken** — the `examples/js/` UMD path 404'd
  for every pinned version. The loader is now compiled into the global bundle.

### Added

- **Project choreography hook (`choreography: "choreo.js"`)** — optional
  project-level file of GSAP timeline code, inlined into the composition after
  the built-in animators. `tl`, `DATA`, `gsap`, and `cueTime` are in scope;
  any turn-anchored tween is exactly as seek-safe as the built-in vocabulary.
- **Character abstraction** — built-in presets (cat, mouse, robot) compile to
  `THREE.Group` assemblies of relative parts. Scene use: one line per character.
  Config `characters.<id>` overrides or adds custom characters.
- **`instances` on primitives** — N copies of one primitive rendered as a single
  `THREE.InstancedMesh` (crowds, props, particles — one draw call).
- **Shared geometry/material cache** — identical primitives share one buffer
  and one program across all meshes, reduced draw calls.
- **`narova generate` command** — AI clip generation via Sora/Runway APIs,
  downloaded to `assets/` for use as `scene.clip`.
- **Ground/set convenience** — `type: "ground"` element → floor plane.
- **Primitive shorthand** — `type: "cube"` ≡ `3d-object` with kind cube.
- **`canvas3d`/`model3d` node types** in the portable visual tree.
- **6 new validation tests** added across the affected modules.

## [0.17.0] - 2026-08-03

### Added

- **Two bundled free local renderer providers** — HyperFrames remains the
  default, full browser/HTML/CSS provider; Narova No-Browser adds deterministic,
  browserless Skia frame drawing and FFmpeg media decode/encoding under the
  versioned `narova-renderer-provider/v1` boundary.
- **Provider-neutral `scene.visual` tree** — groups/stacks, text, rectangles,
  circles, lines, SVG paths, images, SVG, progress graphics, local fonts,
  shaped RTL text, gradients, borders, clipping, shadows, and flexible
  row/column layout. Visual-only scenes compile to HyperFrames HTML; a scene
  can keep a richer `body` beside its no-browser fallback.
- **Portable motion** — cue- or second-anchored entrances, deterministic
  keyframes, media drift, and fade/wipe/slide/zoom scene transitions.
- **No-browser media and delivery workflow** — full-frame per-scene video,
  word-synced captions, mixed custom narration/music/SFX, snapshots, draft
  preview MP4s, H.264/AAC builds, variants, and FFmpeg export deliverables.
- **Renderer CLI** — `--renderer hyperframes|no-browser`, `narova renderers list`,
  and `narova renderers doctor <name>` make capabilities and requirements
  explicit. No-browser rendering performs no network request.
- **Complex browserless production eval** — a real 16-second, four-scene video
  covers custom narration, word timings, audio processing/mixing, product
  playback, raster/SVG/font assets, multilingual text, charts, cartoon motion,
  captions, all four transitions, snapshots, and a contact sheet.

### Changed

- Renderer identity and portable visuals now survive config resolution,
  variants, the canonical manifest, planning fingerprints, composition, QA,
  preview, builds, and deliverables.
- `narova check` understands portable visual content and asset references.
  No-browser rejects HTML-only scenes and walkthroughs without an explicit clip fallback
  before writing frames instead of silently producing a lower-fidelity result.
- External narrator word timings are normalized into the shared timing
  contract before captions/manifests/rendering, so SRT/VTT and both renderers
  receive the same cues. External narration mixes now prefer `mix.wav` in the
  HyperFrames project as documented.
- Documentation and the landing page now explain the two local render paths,
  portable contract, installation, honest capability boundaries, and preview
  behavior without changing the site's established visual language.

### Fixed

- External narration compression uses FFmpeg's millisecond attack/release
  units and accepted ranges, restoring the intended voice-cleanup pass on
  current FFmpeg.
- No-browser raster and decoded-video frames use explicit RGBA transfer into Skia,
  avoiding lazy-decoder black frames; long karaoke lines wrap inside the safe
  caption band.
- No-browser Arabic-script text and captions now use FontKit OpenType shaping with
  a pinned free Noto Sans Arabic fallback, avoiding disconnected Urdu letters
  and missing-glyph boxes when an authored font has incomplete coverage.
- External word-timing transcripts must match the declared voiceover, and
  epsilon-safe scene boundaries no longer duplicate cues as zero-length
  subtitles. The complex eval now consumes the shipped reel's paired VTT
  instead of placing invented caption text over unrelated narration.
- No-browser now reserves the caption-safe lower band for scene content while
  keeping root backgrounds and full-frame clips edge-to-edge, preventing scene
  copy behind the karaoke overlay from looking like a second caption layer.
- The complex proof uses caption-free raster artwork, so only Narova's single
  karaoke layer appears in review frames.


## [0.16.0] - 2026-08-03

### Added

- **Optional `narova-openai` companion skill** — an isolated, dependency-free
  OpenAI Speech API worker that implements `narova-tts-provider/v1`, keeps
  `OPENAI_API_KEY` environment-only, requests validated WAV directly, and
  leaves caching, timing, captions, and rendering in Narova core.
- **Current OpenAI speech capabilities** — the provider explicitly supports
  `gpt-4o-mini-tts`, its `2025-12-15` snapshot, `tts-1`, and `tts-1-hd`;
  defaults to the steerable current alias; recommends `marin` and `cedar`;
  and supports delivery instructions, speed, BCP 47 language guidance, and
  eligible-customer custom voice IDs.
- **OpenAI provider tests** — mocked protocol, request mapping, model/option
  validation, credential isolation, direct-WAV safety, no-retry behavior, and
  built-in voice-list coverage now run in the main `npm test` command.

### Changed

- Documentation, specification, main skill pointers, CLI reference, README,
  landing page, and website changelog now present OpenAI and ElevenLabs as
  peer optional companions while keeping Narova local-first.

### Security

- `.env.local` is ignored. The OpenAI worker never accepts credentials in
  project configuration or writes them to protocol output, validates output
  paths and WAV responses, and does not automatically retry potentially
  billable synthesis requests.

## [0.15.0] - 2026-08-01

### Changed

- **Skill context re-engineered** — narova's SKILL.md reduced 339 → 127 lines
  (-62%) based on Anthropic's context engineering best practices for Claude 5
  models. The skill was over-constraining the agent: detailed intake scripts,
  redundant hard rules, and example dialogues have been replaced by progressive
  disclosure through the existing `references/` files.
- **Fewer, sharper gotchas** — ten "Hard Rules" replaced by four "Key Gotchas"
  limited to genuinely non-inferrable rendering details. Rules the agent can
  discover from tool output or context (voice defaults, number of narrators,
  theme mode conventions) are now in reference docs, not the skill frontmatter.
- **Workflow compressed** — eight detailed step sections (~150 lines) condensed
  to a numbered one-line-per-step list with file-pointer references.

### Added

- **AGENTS.md** — lightweight repo-level guidance (`CLAUDE.md` symlinks to it).
  Six gotchas specific to the narova project: cue indexing, CSS rules, SVG
  namespacing, output directory hygiene, agent-shell persistence, and ffmpeg
  `setsar=1` concat requirements.

## [0.14.0] - 2026-08-01

### Added

- **External narration** — `config.narration` lets you use pre-recorded audio
  instead of TTS. Set `narration.file` to skip synthesis entirely; narova
  copies the file as the narration track. No voices or TTS backend needed.
- **External karaoke captions** — `narration.wordTimings` accepts a JSON file
  of word-timed cues (`[{ start, end, words: [{ text, start, end }] }]`).
  Narova injects word-level karaoke overlays into every scene at compose
  time — the spoken word highlights in gold with no caption HTML in your
  scene bodies.
- **Auto bed/SFX mixing for external narration** — when `bed` or `sfx` are
  configured alongside `narration.file`, narova mixes them with the external
  audio using ffmpeg (same filter chain as the Python mix stage). No TTS
  venv needed.
- **Voice processing for external narration** — `narration.process` with
  optional `highpass`, `lowpass`, `compressor`, and `loudness` settings.
  Applied via ffmpeg before mixing.
- **`narova karaoke generate <audio>`** — transcribe an audio file to
  word-timed karaoke JSON + SRT using faster-whisper or whisper-cpp.
  `--transcript <file>` maps a clean transcript onto Whisper timings.
- **`narova retime <config> <karaoke.json>`** — auto-derive scene durations
  from word timing data. `--apply` rewrites the config in-place.
- **WhatsApp export preset** — `whatsapp-compressed`: 540×960, rate-controlled
  H.264 encode under 16 MB for messaging apps.
- **Port auto-detection for preview** — `narova preview` finds the next
  available port starting from 3002 instead of silently failing on conflicts.
  Explicit `--port` still validated before use.

### Changed

- **`narova check` now reports `"external"` backend** (not `"silent"`) when
  `config.narration` is set, and estimates duration from explicit scene `dur`
  values instead of word-count estimation.
- **`narova check` detects HyperFrames-reserved class names** (`.clip`,
  `.scene`, etc.) used as CSS selectors in `theme.css` — previously only
  checked HTML class attributes.
- **Hook checks skipped for external narration** — lead-in silence and
  on-screen text warnings don't apply when the recording defines its own
  pacing.

### Fixed

- **Preview port conflicts** — silent failover to different ports caused
  confusion when multiple previews were running. Now auto-detects or fails
  with a clear error.
- **`preset: "slow"` for WhatsApp encodes** — better compression ratio for
  rate-limited messaging app uploads.

## [0.13.0] - 2026-07-30

### Added

- **Narration-timed product walkthroughs** — declare reusable walkthroughs
  with semantic `role`, `label`, `text`, `placeholder`, `testid`, or CSS
  locators; anchor actions to absolute seconds or scene/cue speech timing.
- **Explore, capture, and status CLI** —
  `narova walkthrough explore|capture|status` uses optional agent-browser
  sessions for agent-readable exploration and explicit recording.
- **Real capture composition** — recordings can appear in generated browser
  windows or full-bleed, with trim offsets, contain/cover positioning,
  opacity, Narova overlays, narration, and word-synced captions.
- **Reproducibility and evidence** — each take stores `recording.webm`,
  redacted `capture.json`, action drift, media metadata, screenshots, and
  config/synthesis/timing/media/evidence hashes. Compose and release checks
  reject missing, changed, incomplete, or stale captures.
- **Variant-safe takes** — base and hook-variant walkthrough captures live at
  separate paths, so preparing one narration timing no longer overwrites
  another.
- **Authenticated exploration controls** — named sessions, storage-state
  restore, persistent profiles, domain containment, action-policy files,
  ready conditions, secret-redacted logs, and explicit mutation warnings.
- **Real browser-to-MP4 eval** — a local interactive product fixture exercises
  semantic actions, recording, evidence frames, composition, 1280×720 render,
  audio retention, timing drift, and black-frame detection.
- **Complete walkthrough showcase** — an 83-second narrated browser take
  demonstrates project creation and configuration, search, task assignment,
  automation, and teammate invitation with 24 timed operations and captions.

### Changed

- The rebuild planner now includes a capture stage. Narration/timing or
  walkthrough-action changes require recapture; presentation-only changes
  recompose without touching the browser. Capture freshness is evaluated
  independently of asset diffs, successful current takes clear recapture
  immediately, and pending alignment cannot be hidden by another change class.
- HyperFrames renders walkthrough projects with lossless PNG video-frame
  extraction to preserve UI text and fine product details.
- The isolated walkthrough cursor is reinstalled inside agent-browser's fresh
  recording context, and semantic clicks emit a 380 ms expanding, fading
  target ripple that is removed after each click. Cursor-enabled captures made
  with the previous renderer are marked stale so they cannot silently reuse the
  old persistent highlight.
- Documentation, CLI help, environment guidance, manifest specification, and
  the website now cover the complete explore → synth → capture → compose
  workflow.

### Security

- Typed values and URL query strings are redacted from capture logs and the
  portable manifest; embedded URL credentials are rejected and stripped
  defensively. The resolved config remains local and is documented as
  sensitive.
- Capture remains an explicit command; `compose` and `build` never replay
  browser actions. Mutating flows are intended for disposable demo data.
- Ready conditions are re-applied inside agent-browser's fresh recording
  context, early cursor travel must fit the configured pre-roll, and the
  recorded setup/trim map is content-hashed.

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

- **`timeline.json` → `manifest.json`** — renamed to make the manifest the
  canonical project model. All references updated throughout the codebase:
  `manifest.js`, `manifest.test.js`, pipeline, CLI, SPEC, and reference docs.

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

- **Comprehensive export presets** — `tool/src/exports.js` defines
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
[0.13.0]: https://github.com/ammar-hasan/narova/compare/v0.12.0...HEAD
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
