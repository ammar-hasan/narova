# Narova — open video production system for humans and agents

<p align="center"><img src="logo.svg" alt="Narova" width="84" height="84"></p>

Narova is an open, local-first video production system for humans and agents.
It turns creative intent — a prompt, script, scene file, source, repository, or
real product flow — into directable, reproducible video: structured scenes,
deterministic timelines, local speech, word-synced captions, multiple local
renderers, AI clip generation, real product walkthroughs, revisions,
provenance, and release.

The CLI and the Narova agent skill are separate artifacts. Installing this npm
package adds the `narova`, `narova-setup`, and `narova-uninstall` commands; it
does not install or modify agent instructions.

What you build and publish with Narova is your choice, and you are fully
answerable for it — under law, by your own ethics, values, and conscience, and
by the religious or cultural commitments you hold. Narova gives you inspectable
sources, reviewable creative proofs, and explicit provider choice to support
that judgment; it does not verify legality, rights, or acceptability for you.

The skill pins one compatible CLI release. After the skill is updated, its next
session checks `narova --version` and reconciles this global package to that
exact version before use.

[Website](https://ammar-hasan.github.io/narova/) ·
[npm package](https://www.npmjs.com/package/@narova/narova) ·
[GitHub](https://github.com/ammar-hasan/narova) ·
[Machine protocol](AGENT_PROTOCOL.md) ·
[Agent skill](https://skills.sh/ammar-hasan/narova) ·
[Issues](https://github.com/ammar-hasan/narova/issues)

## Install

Narova supports macOS and Linux. Windows users should run it through WSL.
Node.js 18+, Python 3.10+, FFmpeg, and FFprobe are required.

```bash
npm install --global @narova/narova
narova doctor
```

The default local Piper voice environment is created on the first synthesis,
or explicitly with:

```bash
narova-setup
```

Optional `--xtts`, `--qwen`, `--chatterbox`, and `--pockettts` flags install larger local
voice backends into Narova-owned virtual environments. Optional hosted speech
(ElevenLabs, OpenAI) and video generation (Sora through OpenAI, Runway) are
separate companion skills registered explicitly; the core package stays
local-first and contains no vendor API adapter. The built-in `pockettts`
backend uses an optional isolated Python 3.12 CPU runtime installed with
`narova-setup --pockettts`; no provider registration is needed. List presets with
`narova voices list --backend pockettts`, inspect models with `narova pockettts catalog`,
check explicit model readiness with `narova pockettts doctor`, and save a voice
with `narova pockettts export-voice --speaker alba --output alba.safetensors`.
Model helpers print progress and default to a 120-second deadline (override
`NAROVA_POCKETTTS_TIMEOUT`); failed exports preserve the previous state file.
Pocket and external `providerFiles` bind local inputs to current byte hashes
before reuse; the current Pocket runtime profile also participates in identity.
See the [Pocket guide](https://github.com/ammar-hasan/narova/blob/main/skills/narova/references/pockettts.md).

## Quick start

```bash
npx @narova/narova demo    # one command to a finished MP4
narova init my-video
cd my-video
narova check
narova build --release
narova provenance
```

Projects can be exchanged as deterministic, digest-verified `.narova` files:

```bash
narova pack --project my-video --output my-video.narova
narova open my-video.narova --inspect
narova remix github:owner/repository#main --dir my-remix
```

See the [archive compatibility profile](https://github.com/ammar-hasan/narova/blob/main/PROJECT_ARCHIVES.md)
for the format, bounds, trust notice, and extraction rules.

## What it makes

- Prompt-to-video, script-to-video, and source-grounded explainers
- Narrated dialogue with local TTS and word-synced captions
- Silent and marker-driven motion pieces (narration is optional)
- Deterministic 2D HTML/CSS/SVG and Three.js/WebGL scenes
- AI clip generation through explicitly selected providers (Sora, Runway),
  with optional creator-owned character/object/place continuity
- Real product walkthrough videos with timed browser actions
- Local MP4, SRT, and VTT deliverables without a render service
- Deterministic shareable project archives with safe inspection and remix lineage
- Read-only evidence-graded provenance reports and text, YouTube, web, or JSON
  credit output

Narrated-series projects can anchor SFX to sentence or word cues, trim and fade
effects, keep alignment model/partial settings in the config, and hide visual
captions per scene while retaining SRT/VTT exports. Production mixes preserve
stereo. See the [audio controls](https://github.com/ammar-hasan/narova/blob/main/skills/narova/references/audio.md).

Two local renderers ship with the package. HyperFrames is the full browser
canvas (HTML/CSS, WebGL, Studio); No-Browser draws a portable scene tree with
Skia when a machine cannot launch a browser. Both run locally with no render
service or fee.

Agents can consume the versioned `narova.result/1` machine protocol (`--json`
on every operation) with stable exit classes, diagnostics, and artifact
records — no parsing of terminal prose.

For generated shots, an optional `continuity` block in `reel.config.*` names
entities and per-shot keep/change intent. Select it with `narova generate
"<prompt>" --continuity <shot-id>`. A shot may include one local image anchor
only when the selected provider declares reference-image support; otherwise the
command fails before provider work. Recipe version 3 records the exact selected
context and anchor identity for inspection and regeneration. Narova does not
infer entities, choose style/camera, rank results, or certify provider pixel
adherence.

See the [project README](https://github.com/ammar-hasan/narova#readme) for the
scene-script format, renderer choices, product walkthroughs, source grounding,
proof branches, judge/assertions, and full workflow.

## Agent skill

Install the separate agent skill with:

```bash
npx skills add ammar-hasan/narova --skill narova -g
```

## Network and local data

Narova renders locally. First use can download the pinned HyperFrames CLI,
Python packages, and selected speech models. Optional stock providers, AI clip
generation, browser capture, and external voice providers use the network only
when explicitly selected. Models, caches, saved voices, and provider manifests
live under `~/.narova` by default and are retained across CLI upgrades.

## Update or remove

```bash
npm install --global @narova/narova@latest
npm uninstall --global @narova/narova
```

Updating the npm package alone does not update agent instructions. Update the
skill with `npx skills update narova -g`; its next session enforces the matching
CLI version.

Releases from `0.31.1` onward use npm Trusted Publishing and include provenance
linking the package to its public GitHub source and publishing workflow. The
manually bootstrapped `0.31.0` release has no provenance attestation. Narova is
available under the Apache-2.0 license.

## Script-to-speech checks

`narova review --speech` reports per-turn transcripts and dropped, added or
replaced words from existing synthesized takes. Optional root
`speech: { check: 'warn', retakes: 1 }` checks builds and re-synthesizes only
mismatched turns with the next take nonce. Use `check: 'fail'` to stop before
rendering when speech differs or recognition is unavailable. Warn retains the
latest completed candidate when recognition becomes unavailable. Explicit checks
require current take records; replacing selected local model bytes with a positive
retake budget starts fresh selection while reusing eligible sentence audio. Review remains
advisory and read-only; optional local ASR tools are required. Transcripts can
mishear, so audition flagged turns. See the [speech check guide](https://github.com/ammar-hasan/narova/blob/main/skills/narova/references/audio.md#check-synthesized-speech-against-the-script).

## Multi-video series

Courses, daily vlogs and drama can share selected defaults, resources and authored
context while each episode owns its script, scenes, assets and evidence. Create
and catalog the episode, then run `narova series build <source> --episode <id>`.
It copies selected shared inputs and builds that episode in one command. Later
calls retain the saved version; `--update-shared` refreshes only that episode
before building. Ordinary `build` still uses an existing binding without refresh.
CI chooses episodes independently. Track originals and selection recipes, then
use the combined command in a fresh checkout; ignore membership/binding copies
together. Commit both membership and complete current binding/files to retain
an older episode selection. Reused CI workspaces require an explicit update to
pick up changed shared originals.

Mix shared fonts, stylesheets or images with local files and episode overrides.
Theme/caption properties merge by key; same-ID local voice/character records
replace whole shared records. Fonts/CSS are selected resources applied through
ordinary episode references, while shared theme defaults contain mode/tokens.
See the [series guide](https://github.com/ammar-hasan/narova/blob/main/skills/narova/references/series.md)
for copying stages, a mixed-assets/font/CSS example, explicit removals and
portable episode exchange. Installing this package does not install the skill.

## Portable speech and narration controls

`narova voice-cache export --out out --dir speech-cache` saves selected completed
sentence audio; `narova voice-cache import --dir speech-cache` validates and
restores it for matching keyless builds. Authored turns support `pauseAfter` and
`captions: false`. Root caption colors and `mix.loudness` provide explicit visual
and final mix choices. Literal word/occurrence selectors work in choreography
and SFX. See the [audio guide](https://github.com/ammar-hasan/narova/blob/main/skills/narova/references/audio.md)
for validation, reuse and measured-delivery limits.
