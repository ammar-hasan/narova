# Narova roadmap

**Strategy date:** 2026-08-07

This is a sequence of enablement and product-risk gates, not a calendar
promise. Each release must prove the behavior in its exit criteria before the
next layer expands.

**Shipped foundation (0.17):** rendering is now a versioned provider boundary
with two free local implementations. HyperFrames remains the broad browser
surface; Narova No-Browser covers the portable Skia/FFmpeg subset when no browser
can run. Further no-browser breadth expands against real-project fixtures without
turning unsupported HyperFrames features into silent approximations.

**Shipped 3D visual system (0.19):** declarative 3D authoring through
`scene.three` and `scene.elements` — cameras, lights, primitives, models,
GSAP-driven animations, characters as reusable groups with built-in presets,
instanced meshes for crowds, and AI clip generation (`narova generate`).
Three.js upgraded to r185 ESM (esbuild-bundled global script, opaque to
HyperFrames' compiler so the full namespace survives), tone-mapped output with
ACES filmic default, and deterministic GLTF loading.

**Shipped creative quality and modularity (0.20):** 15 correctness and
architecture improvements. Creative modularity with 6 file-reference types per
scene and `config.imports` for reusable modules. Expanded variant model with
scene overrides and theme/captions/timing overrides. Neutral project scaffold.
Concept branching workflow. Measured cue timing for 3D. Theme token preservation
through pipeline round-trips. Deterministic seeded particles. `data-grow`/`data-mark`
transformOrigin fix. GSAP vendored locally (zero CDN). Semantic action validation
with clear errors for unsupported actions. `--reuse` audio integrity check.
Release restore with fingerprint+timings for reuse. Creative-diversity eval suite
(10 briefs, 11 metrics). 470+ unit + 6 eval tests.

## North star

Narova gives every person and every intelligence the creative power to make
remarkable video, regardless of expertise, budget, hardware, or model
sophistication.

The product must therefore:

- make a simple LLM substantially more capable as a video creator;
- encode creative direction, production craft, and quality evaluation in the
  system rather than expecting the model or user to supply them;
- adapt vocabulary, questions, explanations, and controls to the operator's
  video fluency, technical fluency, and desired involvement;
- keep the default path local and inexpensive;
- preserve creative range instead of collapsing into repetitive templates;
- keep every result editable and owned by the user;
- make requested changes precise and preserve unrelated approved work;
- support organization, reuse, review, variants, and distribution when the
  work grows.

Generation, direction, changeability, maintenance, and management are product
functions in service of this north star.

## Current baseline: 0.20.0

Narova 0.20 is the generation, compilation, rendering, and creative orchestration engine:

- All 0.7 capabilities (prompt-to-video, TTS, captions, cues, audio, sources,
  ledgers, deterministic HyperFrames, validation, preview, QA, rendering)
- Dual local renderers with provider-neutral `scene.visual` tree
- Declarative 3D authoring (`scene.three`, `scene.elements`) with character
  presets, PBR, shadows, instanced meshes, tone mapping
- Creative modularity: 6 file-reference types per scene, project-level imports
- Expanded variant model with per-scene overrides
- Project choreography hook, AI clip generation
- Product walkthrough capture with agent-browser
- Named releases with fingerprint+timings for `--reuse` after restore
- Neutral scaffold, concept branching, creative diversity evals
- Sentence-level TTS cache, visual-only edit reuse, planner change classification

## 0.8 — Creative kernel and durable projects

**Goal:** a lightweight LLM can direct a distinctive, high-quality first video,
and every build is explainable, reproducible, comparable, and minimally
rebuildable.

**Indicative founder effort:** 6–8 weeks.

### Scope

- define a reference lightweight LLM and a repeatable brief suite;
- define a shared adaptive-experience contract:
  - guided, collaborative, director, and automation interactions;
  - separate video fluency, technical fluency, control preference, and
    explanation depth;
  - task-scoped inference with explicit override and reset;
  - outcome-language to production-decision translation;
- structured creative plan covering:
  - audience and intended response;
  - story and beat map;
  - art direction and composition system;
  - motion and transition language;
  - voice, music, sound, and pacing direction;
- composable visual and motion primitives with tested variation ranges;
- critique and repair passes for hierarchy, clarity, distinctiveness, rhythm,
  density, captions, and platform fit;
- creative controls that remain understandable as ordinary language;
- quality comparison against the same reference model without Narova;
- one golden journey across skill and CLI:
  - describe intent;
  - receive a creative recommendation;
  - generate a fast storyboard/animatic;
  - direct a bounded revision;
  - build and inspect the complete local project;
- automatic capability detection that selects a viable local path and explains
  missing capabilities in ordinary language;
- machine-readable errors with a clear human explanation and recovery action;
- canonical `narova.manifest.json` schema;
- stable IDs for projects, sources, scenes, turns, voices, assets, variants,
  locales, builds, and releases;
- immutable build manifest containing:
  - source and input hashes;
  - config and theme hashes;
  - installed Narova and renderer versions;
  - model/provider and relevant settings;
  - generated artifact hashes;
  - elapsed time and estimated/actual external cost;
- dependency graph from sources and configuration to artifacts;
- `narova plan`:
  - classifies the proposed change;
  - shows affected and protected artifacts;
  - estimates external cost and work before execution;
- `narova diff <a> <b>`:
  - source, claim, script, scene, visual, audio, duration, and artifact views;
- content-addressed caches for all safe intermediate artifacts;
- `narova build --plan <file>` to execute an inspected plan;
- named local releases, restore, and release notes;
- migration for existing `reel.config.mjs` projects without breaking them.

### Exit criteria

- the reference lightweight LLM completes every benchmark brief without
  hand-authored scene implementation;
- a first-time user completes the guided flow without encountering unexplained
  production or implementation terminology;
- an intermediate user can move from outcome-level feedback to scene-level
  control without restarting or editing code;
- an expert can inspect and override the exact production decisions without
  Narova simplifying them away;
- an agent can perform the same workflow through a deterministic structured
  contract;
- one project can move among all four interactions without conversion or
  information loss;
- at least 7/10 target users judge the Narova result better than what they
  could make with their current skill, time, and budget;
- official benchmark outputs are recognizably distinct rather than one
  template with new colors and words;
- a visual-only edit invokes no TTS and rebuilds no unrelated scene;
- changing one sentence synthesizes only affected sentences;
- changing a shared brand token rebuilds all and only dependent visuals;
- a clean checkout can reproduce a release with matching hashes where the
  declared environment is deterministic;
- a user can inspect why every rebuilt artifact changed;
- 10 fixture projects pass impact and preservation tests;
- existing 0.7 projects continue to build.

### Explicitly out of scope

- hosted collaboration;
- source monitoring;
- automatic rewriting;
- enterprise identity;
- full visual editor.

## 0.9 — The maintenance loop

**Goal:** a changing source can safely produce an updated video family without
recreating approved work.

**Indicative founder effort:** 6–8 weeks after 0.8.

### Scope

- source registry with snapshot, retrieval time, license/rights notes, and
  refresh policy;
- `narova source check` for stale, unavailable, and meaningfully changed
  sources;
- source-passage → claim → script-turn → scene dependency mapping;
- semantic impact classification:
  - no content impact;
  - metadata-only;
  - visual refresh;
  - script review required;
  - regeneration required;
- `narova update` produces a reviewable change proposal;
- preservation contracts for every update:
  - may change;
  - must change;
  - must not change;
- claim revalidation and generated release notes;
- root/variant relationship for platform and hook variants;
- initial locale-family model with translation status;
- QA comparison bundle: contact sheets, waveform/duration changes, captions,
  claims, and plan-versus-result;
- stable local publish aliases and destination registry;
- rollback to the last approved release.

### Exit criteria

- a changed source identifies all affected projects in test fixtures;
- a meaningful source change proposes only affected script turns and scenes;
- an approved update rebuilds every selected derivative and no unrelated
  derivative;
- no release can publish with an unresolved changed claim;
- a stable alias can move to a new approved release and roll back;
- five real pilot users complete a source-change-to-release workflow;
- median short-video update time is below 15 minutes;
- at least 90% of protected elements remain unchanged.

### Explicitly out of scope

- autonomous publishing without approval;
- continuous cloud crawling;
- full translation vendor suite;
- organization-wide asset management.

## 1.0 — Usable public release

**Goal:** turn releases, repositories, docs, and product pages into a
maintainable video program for a repeat user, not a one-time demo.

**Indicative founder effort:** 8–12 weeks after the maintenance primitives,
guided by pilots.

### Scope

- first-class workflows:
  - release/changelog to launch video;
  - pull request to narrated walkthrough;
  - docs or README to explainer;
  - product page to platform-specific launch family;
  - source change to reviewed update;
- brand profiles with enforced tokens and rules;
- reusable tested scene components;
- project-family commands for platform, audience, campaign, and locale
  variants;
- pronunciation dictionary and governed voice profiles;
- asset registry with origin, rights, usage, and hash metadata;
- expanded quality gates:
  - safe areas, overlap, contrast, captions, loudness, motion, duration;
  - source freshness, disclosure, brand, and rights checks;
- packaged installer and environment repair;
- local Studio as the primary visual interface for:
  - intent and creative recommendation;
  - storyboard/animatic;
  - scene and timeline preview;
  - natural-language and direct visual revision;
  - sources, builds, releases, diffs, and QA when the user asks for detail;
- Create, Direct, and Inspect views over the same project, with automatic
  progressive disclosure and explicit user override;
- GitHub/repository integration focused on release and PR triggers;
- explicit, off-by-default diagnostic sharing limited to installation, build
  performance, and errors, with the payload visible before sending;

### Exit criteria

- 10 active design partners complete both a first build and a real update;
- at least 6/10 return for a second project or update inside 30 days;
- at least 5/10 bring a second real project, invite a collaborator, or
  recommend Narova to someone with the same need;
- at least 4/10 would be very disappointed if Narova disappeared;
- first useful preview is under 10 minutes at the median;
- users cite output quality relative to effort and cost as a reason to adopt,
  with direction, reuse, or changeability contributing to retention;
- installation success exceeds 90% on supported clean machines;
- all official examples are reproducible and carry current source/build
  manifests.

### Learning gate

If users love first generation but do not return to update or multiply videos,
do not expand into organization-wide management. Revisit the initial workflow,
output quality, or creative range. The second build tests whether Narova
transfers durable capability rather than producing a one-time novelty.

## 1.1 — Shared creation and content operations

**Goal:** let multiple people safely operate a shared video system.

**Build only after the 1.0 retention gate.**

### Scope

- portable review package and optional review links;
- scene/time-coded comments and structured change requests;
- roles for author, reviewer, approver, and publisher;
- approval states and audit trail;
- shared brand, voice, asset, component, and project-family libraries;
- compare, branch, merge, restore, and release controls appropriate to
  nontechnical users;
- campaign/client workspaces;
- batch matrices and queued execution;
- optional remote renderer while preserving the local path.

### Exit criteria

- an author, reviewer, and approver complete a release without exchanging
  files manually;
- every published artifact is traceable to an approved release;
- an organization can enumerate current and stale assets;
- a team can update a brand rule across dependent projects through an
  inspectable plan;
- teams repeatedly use the shared workflow because it reduces coordination,
  rework, and uncertainty.

## 1.2 — Automation and ecosystem

**Goal:** make Narova the creative infrastructure layer other agents,
applications, and content systems build on.

### Scope

- stable SDK, API, MCP, webhooks, scheduled jobs, and CI actions;
- adapters for LLMs, TTS, image/video generation, avatars, renderers, storage,
  publishers, and analytics;
- capability discovery and fallback policy;
- remote worker protocol and distributed cache;
- component and workflow registry with tests and compatibility metadata;
- observability for cost, latency, failures, and output lineage;
- private and offline deployment controls when open-source users demonstrate
  concrete governance or security needs.

### Exit criteria

- an external developer can build, update, review, and publish without shell
  orchestration;
- adapters can be replaced without changing the durable project model;
- jobs are idempotent and resumable;
- external applications can subscribe to source and release events;
- external applications show repeated production volume with predictable
  compute, latency, and failure behavior.

## Cross-release workstreams

### Open-source enablement

- no account required for the complete local workflow;
- one open project format across the skill, CLI, Studio, SDK, and MCP;
- stable schemas, migration tools, and compatibility tests;
- contributor documentation for creative components, adapters, voices,
  renderers, source types, and publishing targets;
- public fixtures for every important bug and creative failure;
- examples record prompt, model tier, hardware tier, duration, and build time;
- diagnostics remain off by default and inspectable;
- MIT licensing and local ownership remain clear in the interface and docs.

### UX

- measure clean-install success and time to first useful preview continuously;
- test the same golden path with video-unaware users, intermediate creators,
  expert video practitioners, developers, and autonomous agents;
- maintain separate video-fluency and technical-fluency test matrices;
- measure confusion, unexplained terminology, questions before preview, and
  successful movement between interaction depths;
- keep advanced configuration available without making it a prerequisite;
- do not reduce creative quality, format support, or project portability in the
  guided experience;
- never permanently label a person as a beginner or expert;
- store inferred preferences locally, visibly, and with a one-action reset;
- every error includes cause, impact, and one recommended recovery;
- preview before expensive work and show the scope of a requested change;
- make accessibility part of defaults and automated checks;
- ensure a project can move between two machines or agents without hidden
  state.

### Creative quality

Every release must add regression examples and quality evaluation. Cheap and
easy cannot mean generic. Track hook clarity, information hierarchy, motion
purpose, typography, pacing, caption readability, audio quality, source trust,
emotional effect, distinctiveness, and platform fit. Keep a reference-model
benchmark so improvements measure how much intelligence Narova adds rather than
how much a frontier model can hide.

### Cost

- preserve a zero-marginal-cost local base path;
- estimate paid provider cost before execution;
- report actual cost by source, scene, model, and artifact;
- cache aggressively and never charge by local render minute;
- test quality tiers so a simple LLM can direct a strong deterministic system.

### Compatibility

The project graph and release manifest are Narova's durable assets. LLMs,
speech engines, footage models, and renderers must remain adapters. Do not let a
provider-specific feature leak into the canonical model without a portable
fallback.

### Trust

Maintain the source and claims ledger, add rights/disclosure metadata, and make
every release auditable. Generated media should be identifiable where
platforms or policies require it.

### Distribution

Ship complete examples for the repeated jobs Narova wants to own. The signature
demo is always:

1. create from a real changing source;
2. modify the source;
3. inspect the impact;
4. rebuild only what changed;
5. verify protected content;
6. update the published release.

## Immediate next 14 days

1. Interview five technical content creators about their last real video and
   its revisions.
2. Define the lightweight-model creative benchmark and five representative
   briefs.
3. Specify the creative-plan contract alongside the stable ID and manifest
   model.
4. Implement a read-only prototype of `narova plan` from hashes already
   available in the pipeline.
5. Build one canonical repository-release demo with two successive product
   versions.
6. Measure creative preference, first-build time, update time, external cost,
   artifacts touched, and unwanted drift.
7. Lead the next landing-page iteration with creative possibility; use the
   change demonstration as proof that the result remains controllable.
