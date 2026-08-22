<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo.svg">
  <img src="docs/assets/logo.svg" alt="Narova" width="84" height="84">
</picture>

# Narova — open video production system for humans and agents

**Turn an idea, script, source, repository, or real product flow into video you
can direct, inspect, revise, reproduce, and ship.**

Narova is not a video-generation model and it does not impose a house style.
Your agent—or you—owns the creative decisions. Narova provides the production
system underneath them: structured scenes, deterministic timelines, local
speech and rendering, proof branches, incremental revisions, walkthrough
capture, provenance, release gates, and machine-readable inspection. Agents
calling the CLI directly can use the versioned
[`--json` protocol](AGENT_PROTOCOL.md) without parsing terminal prose.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.39.0-4fd9e8.svg)](./package.json)
[![npm](https://img.shields.io/npm/v/@narova/narova?color=f2418a&label=npm)](https://www.npmjs.com/package/@narova/narova)
[![Site](https://img.shields.io/badge/site-ammar--hasan.github.io%2Fnarova-f2418a.svg)](https://ammar-hasan.github.io/narova/)

<a href="https://raw.githubusercontent.com/ammar-hasan/narova-assets/9d560ca6a0229f1b7284d7c12a5d1fae0591f838/explore/narova-skill-reel/video.mp4">
  <img src="https://raw.githubusercontent.com/ammar-hasan/narova-assets/9d560ca6a0229f1b7284d7c12a5d1fae0591f838/demos/readme-preview/preview.gif" alt="narova demo — prompt, voice, motion" width="100%">
</a>

*This 30-second reel was made by Narova, about Narova. [Watch it with sound](https://raw.githubusercontent.com/ammar-hasan/narova-assets/9d560ca6a0229f1b7284d7c12a5d1fae0591f838/explore/narova-skill-reel/video.mp4) · [Explore the project](https://ammar-hasan.github.io/narova/explore/) · [Install from npm](https://www.npmjs.com/package/@narova/narova) · [View on skills.sh](https://skills.sh/ammar-hasan/narova) · [Live site](https://ammar-hasan.github.io/narova/)*

</div>

- [Why Narova exists](#why-narova-exists)
- [Mental model](#mental-model)
- [What makes it different](#what-makes-it-different)
- [What you can make](#what-you-can-make)
- [Try it — one command](#try-it-one-command)
- [Agent quickstart](#agent-quickstart)
- [Direct CLI workflow](#direct-cli-workflow)
- [Creative proofs and branches](#creative-proofs-and-branches)
- [Deterministic iteration and releases](#deterministic-iteration-and-releases)
- [Judge, assertions, and evidence](#judge-assertions-and-evidence)
- [Sources, assets, walkthroughs, and provenance](#sources-assets-walkthroughs-and-provenance)
- [Renderers and speech](#renderers-and-speech)
- [Machine protocol](#machine-protocol)
- [Architecture](#architecture)
- [Installation and reference](#installation-and-reference)
- [License](#license)

## Why Narova exists

Generating a video once is becoming easy. **Continuing to direct that video is
still hard.**

A generated clip usually throws away most of the production state that created
it. Changing one decision can mean starting over. Agents cannot reliably tell
what changed, what was actually rendered, which source supported a claim,
whether a previous experiment was better, or which artifacts belong to the
final release.

Narova treats video as an **evolving production project** instead of a
disposable generation. A project is a folder with a reviewable scene script and
the measured production state around it — manifest, timings, audio
fingerprints, a revision ledger, proof bundles, provenance registers, and named
releases. Every render is addressed by identity, so unchanged work is reused,
changed work is limited to exactly what changed, and the encoded result can be
inspected against the intent that produced it.

## Mental model

```
intent
  ↓
creative direction
  ↓
small visual proofs
  ↓
structured production
  ↓
preview + direction
  ↓
deterministic render
  ↓
inspect the encoded result
  ↓
revise / branch / release
```

A Narova project moves through: `source → brief → scene script → proof →
synthesis → compose → preview → build → judge → revision → release`. Each stage
remains inspectable and scriptable.

You (or your agent) own **creative authorship**: the script, the visuals, the
taste, the selection. Narova owns the production machinery underneath:
**timing, orchestration, rendering, caching, inspection, and delivery**. It is
zero-style by default — no implicit palette, layout, chrome, or camera grammar.
Every aesthetic choice is an explicit one.

## What makes it different

**Creative control without a built-in taste model.** Narova is zero-style by
default. It gives the creator and the agent a raw production canvas rather than
silently deciding layouts, palettes, camera language, typography, or visual
taste. Narova owns timing, orchestration, rendering, caching, inspection, and
delivery; creative authorship stays with you.

**Prove an idea before producing the whole thing.** For ambitious work, Narova
preserves several small, orthogonal visual proofs rather than generating several
complete videos. Each proof has a rationale and rendered evidence. Choose
deliberately, restore the selected production state, and expand only that
direction.

**Change the part you meant to change.** Narration, scenes, walkthrough takes,
and rendered outputs carry identities that let Narova reuse unchanged work. A
visual change does not require regenerating narration. A changed scene does not
require re-rendering every scene. Branches preserve experiments instead of
turning them into lost prompts.

**Inspect evidence, not an invented quality score.** `narova judge` examines the
encoded artifact against creator-authored assertions. It can measure timing,
motion, silence, captions, hierarchy, continuity evidence, and other observable
properties while keeping uncertainty explicit. It does not reduce creative work
to a universal score or automatically "fix" creative decisions.

**Built for agents without being dependent on one.** Humans get readable CLI
output. Agents can request the versioned `narova.result/1` JSON protocol, with
stable operations, diagnostics, exit classes, and artifact records. Narova works
through an agent skill or directly from the CLI, and the project remains
ordinary local files either way.

## What you can make

The system is not limited to one input or one output. Any of these are
first-class starting points or scene materials:

- Explainers and social video
- Product launch films
- Real browser walkthroughs
- Repository and technical overviews
- Research and source-grounded videos
- Multi-speaker dialogue
- Silent motion pieces and marker-driven events
- HTML/CSS/SVG motion design
- Three.js/WebGL 3D and mixed compositing
- AI-generated clips through explicitly selected providers (Sora, Runway)
- Stock, original, and generated media combined in one timeline
- Platform presets and SRT/VTT delivery

Nothing above requires a particular renderer, voice vendor, or cloud service.
Narova renders through either of its two local renderers, speaks through local
TTS or an explicitly registered hosted provider, and treats AI clip generation
as one optional source of scene media — not the product itself.

## Try it — one command

With Node 18+ as the only download prerequisite, the demo builds a real
narrated, captioned MP4 on your machine and leaves the project behind as a
working reference:

```bash
npx @narova/narova demo
```

The first run shows a readiness checklist with live progress, then fetches what
this machine is missing — a digest-verified ffmpeg (on pinned Linux platforms),
the pinned local voice, the renderer engine, and the Python speech environment —
into Narova user storage. No keys, no configuration, no decisions; nothing is
installed on system paths. The completion report states the measured
time-to-first-video and network bytes. Reference budget, advisory only: about a
minute on a modern laptop with a typical broadband link (measured 2026-08-19:
47 s cold on macOS arm64, 3 s warm; the clean-machine Linux CI job prints its
own measurement on every run). Re-running reuses everything.

On macOS, install ffmpeg yourself first (`brew install ffmpeg`) — Narova
auto-provisions it only where a digest-verified source is pinned.

## Agent quickstart

Install the CLI and the agent skill, then ask your agent for the video in
normal language:

```bash
npm install --global @narova/narova
npx skills add ammar-hasan/narova --skill narova -g
```

Narova supports different starting points:

- **Idea:** "Make a 45-second vertical explainer about why starting small makes
  habits easier to keep. Make it warm and practical, and show me a preview
  before rendering."
- **Product page:** "Turn this product page into a 30-second LinkedIn launch
  video: `[product URL]`. Lead with the user outcome and use the site's visual
  identity."
- **Product walkthrough:** "Explore our demo account, then make a 45-second
  sales walkthrough that creates a project and shows the finished result.
  Narrate it, add word-synced captions and a CTA, and show me the preview."
- **Research:** "Turn this paper into a 60-second explainer: `[paper URL]`.
  Separate the authors' findings from inference, cite the source on screen, and
  keep the language accessible."
- **Repository:** "Read this repository and make a 45-second technical
  overview: `[repository URL]`. Explain what it does, show the architecture,
  and end with how to get started."
- **Script or dialogue:** "Turn the script below into a fast two-host vertical
  reel. Keep the exchange natural, use distinct caption colors, and let the
  visuals change with each speaker."

The exact instruction the agent needs is: *"Make a 45-second launch video from
this product page. Show me a small proof of the visual direction before full
production, then let me direct the result."*

## Direct CLI workflow

The CLI is available when you want to inspect or automate each step yourself:

```bash
narova init generated/myreel && cd generated/myreel
# complete the medium-neutral creative brief; keep each direction to a small proof
narova check        # validate the config + estimate narration length
narova synth        # makes narration + word timings
narova compose && narova shots --motion --proof  # reject an invisible pilot
narova branch save proof-a --rationale "why this direction may serve the brief"
narova preview --detach   # direct the film in HyperFrames Studio
narova build --release    # fail-before-render final gate → out/video.mp4
narova judge        # inspect intent vs the encoded result; read-only, scoreless
```

You need: **Node 18+**, plus **ffmpeg** and **Python 3.10+** (the published
package self-provisions the Python speech environment and, on pinned platforms,
a digest-verified ffmpeg; a source checkout expects them on PATH).

## Creative proofs and branches

For ambitious work, your agent turns medium-neutral creative intent into 2–3
small proof branches, renders their decisive states, records why each might
work, and expands only the selected branch. You direct revisions in the same
conversation; deterministic timelines, sentence and scene caching, and explicit
branches keep bold exploration surgically editable.

```bash
narova branch save proof-a --rationale "why this direction may serve the brief"
# repeat for proof-b/proof-c; approve + restore one; record its proof identity
# in creative-brief.md, then expand only that config
narova branch compare proof-a proof-b   # actual evidence; Narova chooses nothing
```

Proof bundles are bound to their originating project, so a same-named global
branch cannot satisfy another project's final release gate. Saving a focused
proof also preserves the actual encoded bytes plus one assertion-linked
observation; comparing two or three verifies and displays the stored evidence in
requested order but never ranks, recommends, selects, restores, renders, or
mutates. Rejected and archived attempts remain inspectable creative memory;
branch status is the creator's explicit decision.

## Deterministic iteration and releases

Rebuilds are incremental and dependency-aware: `narova build` (and `--release`)
re-renders only the scenes whose audiovisual work actually changed, reuses the
rest, and re-places reused scenes when an earlier scene's duration shifts them.
Unchanged scenes cause zero renderer frame evaluation; one scene-referenced
asset edit invalidates only the scenes that reference it; an unused asset edit
invalidates nothing. The build prints what rebuilt, what reused, and why, plus
dirty-unit seconds and renderer invocation counts. Audio-only changes (bed/SFX
or a voice with unchanged timing) re-mux audio over reused spans without
re-rendering. If safe reuse cannot be proven, Narova rebuilds conservatively and
says why — it never serves a stale frame. The incremental result is
audiovisually equivalent to a forced-clean build (decoded frames, frame
counts/boundaries, audio/sync, captions, duration).

Revisions are recorded as changes in effective authored state. `narova diff`
reports the per-scene revision impact with predicted reuse and an honest render
estimate; `narova history` lists, annotates, and compares the append-only
project ledger; every successful base build binds a measured reuse record into
`out/revisions.jsonl`. Named releases (`narova release save/list/restore/remove`)
are content-hashed snapshots you can compare, restore, and remove.

## Judge, assertions, and evidence

`narova judge` is a read-only rendered-evidence mirror. It inspects the existing
encoded video against creator-authored assertions — explicit requirements,
unusual hypotheses, deliberate violations, continuity, accessibility, brand,
factual constraints — and exposes measured motion, silence, timing, spatial
hierarchy, and uncertainty, mapped back to production state. It emits no
universal score (`score: null`), changes no project validity, mutates nothing,
calls no hosted model, and accesses no network. Stillness, silence, darkness,
and abrupt change may be deliberate; uncertainty is preferable to an
unevidenced defect.

`narova judge --plan` adds plural, unranked intervention options for each
assertion-linked divergence or uncertainty — always including keeping the work
unchanged — without selecting or executing one. One deliberately bounded repair
is available for missing or invalid caption sidecars (`narova judge --repair`),
which publishes only an isolated, unapproved proof-branch candidate; creative
findings remain creator decisions. None of these surfaces emits a universal
quality score or quietly changes current production.

See the exact assertion, judge, plan, and repair contracts in
[`skills/narova/references/cli.md`](skills/narova/references/cli.md).

## Sources, assets, walkthroughs, and provenance

**Source-grounded claims.** Every factual claim in the narration must trace to
a source. Narova's `check` detects a supported class of numeric and superlative
claims and requires them to be ledged (`claims.md`); release checking fails
unledgered claims. Agents interpret selected sources; `ingest` handles the
mechanical pass — fetching the page metadata, extracting up to five images, and
optionally capturing a browser screenshot. This heuristic proves neither that
every claim was detected nor that a source is correct; for contested topics the
ledger should preserve the major relevant perspectives.

**Assets and provenance.** The small asset lifecycle stays explicit:

```bash
narova assets providers
narova assets search "home" --provider iconify --kind image --limit 5
narova assets acquire mdi:home --provider iconify --kind image \
  --output assets/home.svg
narova assets download "https://cdn.example/clip.mp4" --output assets/clip.mp4 \
  --origin stock --provider example --source-page "https://example/items/clip" \
  --license CC-BY-4.0 --attribution "Creator / Example"
narova assets import assets/logo.svg --origin original
narova assets verify
narova assets credits --format youtube   # or text|web|json
narova provenance                        # graded project trust report
```

`narova provenance` composes the evidence Narova already has into four read-only
sections: claim grounding, tracked media and rights buckets, AI generation, and
reproducibility. Every fact is labeled verified (artifact-backed), declared
(authored statement), or unknown; missing records stay visible instead of
becoming green checks. The report is advisory and offline. It does not prove
legal permission or exact used-asset closure, and it never changes the project.

Core owns every deterministic adapter: Wikimedia, Openverse, NASA, Internet
Archive, Iconify, Poly Haven, The Met, Cleveland Museum, Library of Congress,
Pexels, Pixabay, and Freesound. The first nine need no key; the other three are
optional and appear unavailable until their environment key is present. The
separate `narova-stock-extensions` skill is LLM-led discovery for long-tail
catalogues. Creative sourcing is not limited to the built-in catalogues: if an
agent finds a better asset through a browser, archive, or new source, it can use
`assets download` or `assets import` and preserve the same provenance record.
`ingest`, AI `generate`, and walkthrough capture register their outputs
automatically; builds consume local files only and never acquire media.

**AI clips as scene material.** When a project wants a generated shot, `narova
generate "<prompt>"` asks an explicitly registered video companion to produce
a clip, then commits it to the project asset registry with a generation recipe,
so it participates in the same provenance, cache identity, and release evidence
as any other media. Sora lives in `narova-openai`; Runway lives in the separate
`narova-runway` skill; Google Veo lives in the separate `narova-google` skill.
Vendor APIs and credentials never enter core. This is an
optional scene input, never the product itself, and the network is used only
when generation is invoked.

**Real product walkthroughs.** Explore a website/app semantically, record
cursor-guided actions on narration beats, frame or full-bleed the real UI, then
layer captions, callouts, branding, music, and SFX around it.

```bash
npm install -g agent-browser && agent-browser install  # optional adapter
narova walkthrough explore onboarding   # inspect real semantic controls
narova synth                             # establishes measured narration timing
narova walkthrough capture onboarding   # explicit live action + WebM/evidence
narova preview --detach
narova shots --beats
narova build --reuse --release
```

Recipes prefer roles, labels, test ids, and visible text over brittle
coordinates. Captures are invalidated when narration timing or actions change;
body/theme/window/full presentation edits reuse them. Authentication belongs in
a dedicated browser restore/profile, never a scripted password. See the full
[walkthrough contract](skills/narova/references/product-walkthroughs.md).

[Watch the complete 83-second narrated walkthrough generated by this workflow.](https://raw.githubusercontent.com/ammar-hasan/narova-assets/9d560ca6a0229f1b7284d7c12a5d1fae0591f838/demos/product-walkthrough/video.mp4)
[Watch the voiced, captioned real-browser click proof.](https://raw.githubusercontent.com/ammar-hasan/narova-assets/9d560ca6a0229f1b7284d7c12a5d1fae0591f838/demos/click-highlight-proof/video.mp4)

## Renderers and speech

Narova ships two free local renderers. HyperFrames is the default and
full-fidelity path: arbitrary scene HTML/CSS, the complete HyperFrames
component/effects surface, browser Studio, and captured walkthrough composition.
Narova No-Browser is the browserless path: it draws a provider-neutral
`scene.visual` tree with Skia and encodes it with FFmpeg. Both run on your
machine with no render service or fee.

```bash
narova renderers list
narova build --renderer no-browser
narova preview --renderer no-browser   # writes out/preview-no-browser.mp4
```

See the exact [renderer capability contract](skills/narova/references/renderers.md).

Local speech ships as built-in backends; optional hosted speech and video
providers are separate, explicitly registered companions — never dependencies.
Keep credentials in the provider's required environment variables, never in
the config.

| Backend | Quality | Speed | Setup | Notes |
|---------|---------|-------|-------|-------|
| `piper` | good | fast | none (default) | small local voices |
| `xtts`  | higher | slow | `narova-setup --xtts` | ~1.9GB model, 58 speakers |
| `qwen`  | high | slow | `narova-setup --qwen` | ~1.2GB model, Apache 2.0, 9 speakers |
| `chatterbox` | voice cloning | slowest | `narova-setup --chatterbox` | `speaker` = absolute path to a 10–20s recording; own venv, ~1GB model |

```bash
narova providers add <provider-manifest.json>
narova providers doctor <name>
npx skills add ammar-hasan/narova --skill narova-elevenlabs -g
npx skills add ammar-hasan/narova --skill narova-openai -g
npx skills add ammar-hasan/narova --skill narova-runway -g
npx skills add ammar-hasan/narova --skill narova-google -g
```

For authored 3D work that needs intentional subject/world representation or
specialist direction, install the independent
[`narova-3d-production`](skills/narova-3d-production/) companion:

```bash
npx skills add ammar-hasan/narova --skill narova-3d-production -g
```

It is a concise, high-freedom direction layer with conditional references; it
adds no CLI or project behavior, and core Narova works identically without it.

## Machine protocol

Agents are first-class API consumers. Every public operation honors `--json`
and returns exactly one versioned `narova.result/1` envelope on stdout — no
prose to parse. The protocol provides a stable exit-status vocabulary
(`success` / `operation-failure` / `usage-error` / `subject-non-pass`), a
stable diagnostic-code registry, declared artifact records for paths the
operation created or replaced, and additive-only schema evolution within schema
major version 1. Redaction is a protocol property: known secrets are redacted
from the envelope and from captured child-process boundaries.

```bash
narova check --json
narova build --json
narova judge --json
```

The canonical agent loop is inspect → modify authoring source → validate →
preview → critique → build → perceive the encoded result → verify. See
[`AGENT_PROTOCOL.md`](AGENT_PROTOCOL.md) for the full operation payloads,
diagnostic registry, and loop.

## Architecture

```
creative-brief.md
   │  2–3 small proof branches → rendered evidence → select one
   ▼
reel.config.mjs
   │
   ▼  synth      Python makes the speech and the word timings.
   │             Timings are scaled to match the real audio exactly.
   ▼  capture    Optional: agent-browser records declared product actions
   │             against measured narration anchors. Never runs in build.
   ▼  compose    narova writes the selected local renderer project:
   │             scene visuals, karaoke captions, reveals, one timeline.
   ▼  render     HyperFrames or No-browser renders the mp4 with audio inside.
   │
out/video.mp4
   │
   ▼  judge      read-only rendered evidence ↔ authored intent; no score or repair
```

`out/`, `out/hf-*`, and `out/no-browser-*` are build folders. Never edit them.
The config remains the render source of truth; the approved brief records why
the creative direction is ready to scale.

### The scene script

A project is a folder with `reel.config.mjs` as its render source of truth. New
projects also include `creative-brief.md`; approve its pilot gate before
releasing a non-trivial production.

```js
export default {
  title: "My Reel",
  renderer: "hyperframes",                    // default; or "no-browser"
  size: "16:9",                              // "16:9" | "1:1" | "9:16"
  safeLayout: true,                          // optional centering/gutters/max-width/caption reserve
  assets: "assets",                          // copied into out/hf/assets/
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#2ee6d6", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "host · B" },
  },
  provenance: {                              // optional authored declarations
    script: { authorship: "mixed", note: "agent draft, human review" },
    disclosure: "Contains AI-generated media",
  },
  assertions: [{                             // optional creator-owned Video CI intent
    id: "restrained-opening",
    class: "creative-hypothesis",
    expect: "The opening should feel restrained; only the cue reveal should move.",
    origin: { kind: "agent-hypothesis", ref: "opening proof" },
    scope: { scene: "title" },
    observe: [
      { metric: "video.static_ratio", operator: "gte", value: 0.7 },
      { metric: "video.cut_count", operator: "lte", value: 1 },
    ],
    riskyBecause: ["unconventional stillness"],
    questions: ["Did unintended motion weaken the restraint?"],
    related: { scene: "title", source: "reel.config.mjs", protected: ["camera rhythm"] },
  }],
  theme: { accent: "#2ee6d6", bg: "#080d16" },   // optional
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: 1.12 },
  scenes: [
    {
      id: "title",
      // For a generated clip with visibly synchronized dialogue, an agent can
      // choose the preserved source performance instead of synthesizing `vo`:
      // clip: "assets/title.mp4",
      // dur: 8,
      // clipAudio: {
      //   authority: "native", role: "dialogue",
      //   rationale: "The visible delivery requires lip sync.",
      //   wordTimings: "assets/title.words.json", // optional; one cue/vo turn
      // },
      vo: [                                   // what is SPOKEN, in order
        { who: "a", text: "This is narova." },
        { who: "b", text: "Scenes in, video out. Let's go." },
      ],
      body: `<div class="s-title">
        <h1 class="display reveal">narova</h1>
        <p class="lede cue" data-cue="1">scenes in, video out</p>
      </div>`,
    },
  ],
}
```

The rules:

- `vo` is the spoken dialogue. Each turn is `{ who, text }`.
- Direct clips remain visual-only unless `clipAudio` records a choice. Use
  `authority: "native"` when the source performance itself is authoritative
  (especially generated visible dialogue requiring lip sync), or
  `authority: "synthesis"` to document a deliberate replacement. How the file
  was downloaded is not a decision rule. Native authority requires `clip`, an
  explicit `dur`, and a non-empty rationale; native dialogue additionally
  requires the matching `vo` transcript. Native audio plays once and any
  remaining scene time is silence.
- `body` is HTML for the screen.
- `data-cue="1"` means: stay hidden until turn 1 starts. Counting starts at 0.
- `class="reveal"` means: animate in when the scene starts.
- You never set durations for spoken scenes — the real audio decides how long
  each scene is. Silent and some external-narration scenes use explicit
  authored/resolved durations, and named markers are another first-class timing
  source.
- Styling is optional. Set colors with `theme`, or add a CSS file with
  `theme: { css: "theme.css" }`. Do not use `animation: ... infinite` in that
  CSS. The renderer jumps between frames, so looping animations break.
- Put logos, images, and local fonts in `assets/`; scene HTML and theme CSS
  reference them as `assets/...`. Inline SVG and small data URIs also work.
  Remote render-time files do not.
- Word-level timing is estimated by default (distributed across the measured
  sentence duration) and becomes measured when the optional alignment path
  succeeds; captions and cue reveals follow the measured turn/sentence clock.

`assertions` describe what the creator intends to survive into the finished
artifact. Free-form expectations remain creator-owned prose; only explicit
`observe` probes are mechanically compared. Assertions do not change rendering,
cache identity, proof validity, or release eligibility.

### Product walkthroughs

Product demos add a driver-neutral `walkthroughs` recipe and point scenes at
it:

```js
export default {
  // voices, theme, …
  walkthroughs: {
    onboarding: {
      url: "https://app.example.com/projects",
      viewport: { w: 1440, h: 900 },
      ready: { text: "New project" },
      steps: [
        { at: { scene: "create", cue: 0, offset: 0.25 },
          action: "click",
          target: { role: "button", name: "New project" } },
        { at: { scene: "create", cue: 0, offset: 1.1 },
          action: "type",
          target: { label: "Project name" },
          value: "Launch plan" },
      ],
    },
  },
  scenes: [{
    id: "create",
    walkthrough: "onboarding", // or { id, layout: "full", fit: "cover" }
    vo: [{ who: "a", text: "Create a project and give it a clear name." }],
    body: `<p class="eyebrow reveal">From idea to workspace</p>`,
  }],
}
```

## Installation and reference

### The two-part install

Narova has two parts: the CLI and the agent skill. Install the CLI first from
the public npm package:

```bash
npm install --global @narova/narova
narova doctor
```

The npm package does not change agent skills. Releases from `0.31.1` onward
publish through npm Trusted Publishing with provenance linking the package to
this public repository and its release workflow. The manually bootstrapped
`0.31.0` release has an npm registry signature but no provenance attestation.

Then install the skill for any agent that supports skills. If the CLI is
missing or its version differs, the skill installs its exact matching published
npm version before use:

[![skills.sh](https://skills.sh/b/ammar-hasan/narova)](https://skills.sh/ammar-hasan/narova)

```bash
npx skills add ammar-hasan/narova --skill narova -g
# check for updates: npx skills update narova -g (only when you're ready — upgrading replaces the skill files)
```

The CLI and skill are distributed separately, but the skill is authoritative
for compatibility: after a skill update, its next session verifies
`narova --version` and reconciles the global CLI to the exact pinned release.
Installing another CLI version manually does not change the skill; the next
skill session restores the skill's pinned version.

### Update or remove

```bash
npm install --global @narova/narova@latest
```

Remove the CLI with `narova-uninstall` (it detects a custom install prefix
automatically; `--purge-tools` also removes the TTS venv, provisioned media
tools, and the voice cache — projects, media assets, and voice samples are
always kept). The skill is updated separately with `npx skills update narova -g`.

### Commands

```
narova init <dir>     new project
narova demo           build the one-command sample film end to end
narova pack           write a deterministic .narova project archive
narova open <archive> verify, inspect, or materialize an untrusted archive
narova remix <source> copy a local project/archive or public github: locator
narova ingest <url>   bounded mechanical source pass → sources.md/claims.md
narova check          validate the config (fast, no side effects) + claim sniffing
narova plan           compare config vs the last manifest; classify what changed
narova diff           per-scene revision impact vs the latest recorded revision
narova history        list/annotate/compare the append-only revision ledger
narova synth          make the audio + word timings
narova walkthrough    explore/capture/status narrated product demos
narova compose        make the selected renderer project
narova captions       rewrite SRT/VTT from existing timings
narova shots          snapshot QA frames per scene, motion sample, or narration beat
narova build          synth + compose + render -> out/video.mp4
narova preview        HyperFrames Studio, or a no-browser draft MP4
narova preview --detach   keep Studio alive; stop with preview --stop
narova judge          inspect the encoded result against creative assertions
narova judge --plan   add plural, unranked intervention options; change nothing
narova judge --repair create only a delegated caption-sidecar proof candidate
narova branch save    optionally preserve a rendered proof for one assertion
narova branch compare compare 2–3 preserved proofs; no ranking or selection
narova branch set     record the proof decision (approved/rejected/archived)
narova review         observability suite (contact sheets, silences, takes)
narova critique       optional craft guidance; not a correctness gate
narova generate       AI clip generation via an explicitly selected provider
narova voices         list or download voices
narova providers      add/list/remove/doctor external speech/video providers
narova renderers      list/doctor the two bundled local renderers
narova assets         import/download/search/acquire/verify/credits
narova provenance     graded project trust report (verified/declared/unknown)
narova release        save/list/restore/remove content-hashed named releases
narova doctor         check your machine
```

Commands find the project from any folder inside it (they walk up to the
nearest `reel.config.*`). `check` also prints an estimated narration length, so
a target duration can be tuned before any audio exists.

Useful flags: `--backend <built-in-or-registered-provider>`,
`--renderer hyperframes|no-browser`, `--reuse` (keep old audio),
`--tempo`, `--size`, `--fps`, `--quality draft|standard|high`,
`--video <file>` (`judge` only), `--deliverables` (per-platform export presets
via scale+pad), `--variants`, `--json` (machine protocol). See
[`skills/narova/references/cli.md`](skills/narova/references/cli.md) for the
full list.

### Repo layout

```
tool/              CLI package: installer, Node/Python runtime, vendors, tests
skills/narova/     agent instructions and references
skills/narova-*/   optional production, sourcing, and voice companions
docs/              the marketing site (GitHub Pages) + /changelog + /explore
docs/explore/projects/  local verification mirrors of reviewed Explore projects
docs/public-assets.json pinned mapping to the CC0 Narova asset repository
CHANGELOG.md       every notable change, version by version
AGENT_PROTOCOL.md  versioned JSON envelopes, exit codes, and the agent loop
VISION.md          the product vision, mapped to where each point is implemented
LEARNINGS.md       non-normative implementation notes for public maintainers
```

Run everything with `npm test`, or test the CLI independently with
`npm test --prefix tool`.

### Release version contract

The root `package.json` is the only canonical Narova version. Prepare a release
on a branch with `npm version patch|minor|major --no-git-tag-version`; the npm
version lifecycle runs `version:sync` and propagates that value to the CLI
package, lockfile, skill metadata, exact npm compatibility pin, badge, spec,
agent protocol, and website markers. Add the dated changelog entry, then require
`npm run release:check` and CI before merging.

After the release PR lands on `main`, tag that merge as `v<version>`. The tag
workflow rejects version drift and off-main tags, then publishes the matching
npm package through Trusted Publishing. skills.sh reads the skill from GitHub;
users receive it with `npx skills update narova -g`, and the updated skill
reconciles the CLI to its exact pinned npm release before use.

## License

Apache-2.0 — see [LICENSE](./LICENSE). Changes are tracked in
[CHANGELOG.md](./CHANGELOG.md) and on the
[changelog page](https://ammar-hasan.github.io/narova/changelog/).

First-party Explore projects and demo media are published separately under
[CC0 1.0](https://github.com/ammar-hasan/narova-assets) for unrestricted reuse;
no attribution or proof of use is required.
