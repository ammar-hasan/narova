<div align="center">

# Narova — prompt-to-video CLI and agent skill

**Local-first, deterministic video generation for AI agents.**

Narova combines an agent skill for Claude Code, Codex, Cursor, and Kimi Code
with a programmatic video CLI. Together they turn prompts, scene scripts,
source material, and real product walkthroughs into narrated or silent 2D/3D
video with local TTS, word-synced captions, and deterministic rendering.
Agents calling the CLI directly can use the versioned
[`--json` protocol](AGENT_PROTOCOL.md) without parsing terminal prose.

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.32.1-4fd9e8.svg)](./package.json)
[![npm](https://img.shields.io/npm/v/@narova/narova?color=f2418a&label=npm)](https://www.npmjs.com/package/@narova/narova)
[![Site](https://img.shields.io/badge/site-ammar--hasan.github.io%2Fnarova-f2418a.svg)](https://ammar-hasan.github.io/narova/)

<a href="assets/narova-skill-reel.mp4">
  <img src="assets/narova-demo.gif" alt="narova demo — prompt, voice, motion" width="100%">
</a>

*This 30-second reel was made by Narova, about Narova. [Watch it with sound](assets/narova-skill-reel.mp4) · [Explore the project](https://ammar-hasan.github.io/narova/explore/) · [Install from npm](https://www.npmjs.com/package/@narova/narova) · [View on skills.sh](https://skills.sh/ammar-hasan/narova) · [Live site](https://ammar-hasan.github.io/narova/)*

</div>

## Why narova

- **Two voices, one conversation** — local-first neural TTS dialogue, with optional registered providers when a project needs them. Give each speaker a color; narova writes the banter and the timing.
- **Karaoke captions** — every word lights up exactly as it's spoken, in the speaker's color. No manual timing, ever.
- **Cue-timed reveals** — elements stay hidden until the voice reaches them. Visuals land on the beat.
- **Creative confidence before render cost** — ambitious projects save 2–3
  small, orthogonal proof branches with rationale, select one against explicit
  rejection criteria, and expand only the winner—not three complete videos.
- **A genuinely raw canvas** — zero-style scenes own the full frame with no
  implicit centering, max-width, gutter, or caption reserve. Patterns, chrome,
  and `safeLayout` are independent opt-ins; captions remain a default-on overlay
  and can be disabled with `captions: false`.
- **Beat-level visual QA** — deterministic snapshots cover the arrival and resolved
  state of every narration beat, both sides of named markers, and silent scenes.
- **Two free local renderers** — keep unrestricted HTML/CSS and Studio in
  HyperFrames, or select Narova No-Browser for deterministic Skia + FFmpeg output
  on machines where no browser is available. No render service or fee.
- **Real product walkthroughs** — explore a website/app semantically, record
  cursor-guided actions on narration beats, frame or full-bleed the real UI,
  then layer captions, callouts, branding, music, and SFX around it.
- **Urdu-aware dialogue** — native `۔` and `؟` punctuation split sentence audio and timing correctly. For meaningful Urdu scripts, Narova can delegate dialogue polishing to the optional [`urdu-voice-director`](https://github.com/ammar-hasan/urdu-voice-director) skill.
- **Local-first, extensible by choice.** — ffmpeg, rendering, and the four built-in TTS backends run on your machine. Optional cloud voices execute only after explicit provider registration. Model downloads, stock assets, HyperFrames, and external providers need network access when used.

## Install

### Try it first — one command

With Node 18+ as the only prerequisite, the demo builds a real narrated,
captioned MP4 on your machine and leaves the project behind as a working
reference:

```bash
npx @narova/narova demo
```

The first run shows a readiness checklist with live progress, then fetches
what this machine is missing — a digest-verified ffmpeg (Linux), the pinned
local voice, the renderer engine, and the Python speech environment — into
Narova user storage. No keys, no configuration, no decisions; nothing is
installed on system paths. The completion report states the measured
time-to-first-video and network bytes. Reference budget, advisory only:
about a minute on a modern laptop with a typical broadband link (measured
2026-08-19: 47 s cold on macOS arm64, 3 s warm; the clean-machine Linux CI
job prints its own measurement on every run). Re-running reuses everything.

On macOS, install ffmpeg yourself first (`brew install ffmpeg`) — Narova
auto-provisions it only where a digest-verified source is pinned.

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

### Update or remove

Update the package normally. This replaces the installed program but keeps your
projects and voice data:

```bash
npm install --global @narova/narova@latest
```

Remove the CLI with:

```bash
narova-uninstall
```

The command detects a custom install prefix automatically. You can also pass
`--prefix <dir>`. It removes the Narova package and its three commands. It does
not remove projects, downloaded models, caches, or the agent skill. To also
remove Narova-provisioned tooling (the TTS venv, provisioned media tools, the
voice cache), use `narova-uninstall --purge-tools` — projects, media assets,
and voice samples are always kept.

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

## Quickstart

Once the skill is installed, ask your agent for the video in normal language.
Narova supports different starting points:

- **Idea:** “Make a 45-second vertical explainer about why starting small makes
  habits easier to keep. Make it warm and practical, and show me a preview
  before rendering.”
- **Product page:** “Turn this product page into a 30-second LinkedIn launch
  video: `[product URL]`. Lead with the user outcome and use the site's visual
  identity.”
- **Product walkthrough:** “Explore our demo account, then make a 45-second
  sales walkthrough that creates a project and shows the finished result.
  Narrate it, add word-synced captions and a CTA, and show me the preview.”
- **Research:** “Turn this paper into a 60-second explainer: `[paper URL]`.
  Separate the authors' findings from inference, cite the source on screen, and
  keep the language accessible.”
- **Repository:** “Read this repository and make a 45-second technical
  overview: `[repository URL]`. Explain what it does, show the architecture,
  and end with how to get started.”
- **Script or dialogue:** “Turn the script below into a fast two-host vertical
  reel. Keep the exchange natural, use distinct caption colors, and let the
  visuals change with each speaker.”

For URL-based prompts (product pages, articles, repos), the AI agent reads the
source, classifies it, extracts evidence, and writes the scene script. Narova's
`ingest` command handles the mechanical pass — fetching the HTML page, extracting
up to five images, and optionally capturing a browser screenshot — but
interpretation, repository analysis, PDF reading, and content selection remain
the agent's responsibility. Acquired images are recorded in `assets.lock.json`
with their source URL, byte size, and SHA-256 hash.

For assets acquired another way, the small asset lifecycle stays explicit:

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
narova assets credits
narova assets credits --format youtube   # or web|json
narova provenance                        # graded project trust report
narova provenance --json
```

`narova provenance` composes the evidence Narova already has into four
read-only sections: claim grounding, tracked media and rights buckets, AI
generation, and reproducibility. Every fact is labeled verified, declared, or
unknown; missing records stay visible instead of becoming green checks. The
report is advisory and offline. It does not prove legal permission or exact
used-asset closure, and it never changes the project.

Core owns every deterministic adapter: Wikimedia, Openverse, NASA, Internet
Archive, Iconify, Poly Haven, The Met, Cleveland Museum, Library of Congress,
Pexels, Pixabay, and Freesound. The first nine need no key. The other three are
optional and appear unavailable until their environment key is present; they
never block the rest. `--pack essential` remains available as the original
six-provider no-key subset. Catalogue search is explicit and builds stay
offline.

The separate `narova-stock-extensions` skill is now purely LLM-led discovery.
Its 101-source long-tail catalogue helps an agent explore changing sites with
web search, direct HTTP, or a browser, then return selected bytes through
`narova assets download` or `narova assets import`.

Adapters own repeatable API work. The Narova skills still own creative
search terms, selection, license judgment, and fallback discovery. If an agent
finds a better asset through a browser, archive, or new source, it can use
`assets download` or `assets import` and preserve the same provenance record;
creative sourcing is not limited to the built-in catalogues.

`ingest`, AI `generate`, and walkthrough capture register their outputs
automatically. Builds still consume local files only; they never acquire media.

For ambitious work, your agent turns medium-neutral creative intent into 2–3
small proof branches, renders their decisive states, records why each might work,
and expands only the selected branch. You direct revisions in the same
conversation; deterministic timelines, sentence and scene caching, and explicit
branches keep bold exploration surgically editable. Proof bundles are bound to
their originating project, so a same-named global branch cannot satisfy another
project's final release gate.

## Direct CLI control

The CLI is available when you want to inspect or automate each step yourself:

```bash
git clone https://github.com/ammar-hasan/narova.git && cd narova/tool
npm install
npm link            # optional: installs the three Narova commands
cd ..
narova doctor       # core tools + optional agent-browser walkthrough adapter

narova init generated/myreel && cd generated/myreel
# complete the medium-neutral creative brief; keep each direction to a small proof
narova critique creative
narova synth        # makes narration + word timings
narova provenance   # inspect claims/media/AI/reproducibility evidence
narova walkthrough capture   # product demos only: explicit, timed browser take
narova compose && narova shots --motion --proof  # reject an invisible pilot
narova branch save proof-a --rationale "why this direction may serve the brief"
# repeat for proof-b/proof-c; approve + restore one; record its proof identity
# in creative-brief.md, then expand only that config
narova preview --detach   # direct the film in HyperFrames Studio
narova build --reuse --release  # fail-before-render final gate → out/video.mp4
```

You need: **Node 18+**, plus **ffmpeg** and **Python 3.10+** (the published
package self-provisions the Python speech environment and, on pinned
platforms, a digest-verified ffmpeg; a source checkout expects them on PATH).

The first default `build` downloads a few things one time: it creates a Python venv
at `~/.narova/venv`, gets a voice model, and gets the HyperFrames CLI.
This can take a minute. It is not stuck.

The published npm package includes the optional no-browser dependencies by
default. In a source checkout, run `npm install --prefix tool` from the
repository root, then verify with `narova renderers doctor no-browser`.

Without `npm link`, run `node tool/bin/narova.js` from the repository root.

## The scene script

A project is a folder with `reel.config.mjs` as its render source of truth. New
projects also include `creative-brief.md`; approve its pilot gate before releasing
a non-trivial production.

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
  theme: { accent: "#2ee6d6", bg: "#080d16" },   // optional
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: 1.12 },
  scenes: [
    {
      id: "title",
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
- `body` is HTML for the screen.
- `data-cue="1"` means: stay hidden until turn 1 starts. Counting starts at 0.
- `class="reveal"` means: animate in when the scene starts.
- You never set durations. The real audio decides how long each scene is.
- Styling is optional. Set colors with `theme`, or add a CSS file with
  `theme: { css: "theme.css" }`. Do not use `animation: ... infinite` in
  that CSS. The renderer jumps between frames, so looping animations break.
- Put logos, images, and local fonts in `assets/`; scene HTML and theme CSS
  reference them as `assets/...`. Inline SVG and small data URIs also work.
  Remote render-time files do not.

### Two local renderer providers

HyperFrames remains the default and full-fidelity path: arbitrary scene
HTML/CSS, the complete HyperFrames component/effects surface, browser Studio,
and captured walkthrough composition. Narova No-Browser is the free browserless
path: it draws a provider-neutral `scene.visual` tree with Skia and encodes it
with FFmpeg. Both run on your machine.

```js
{
  id: "title",
  vo: [{ who: "a", text: "One project, two local render paths." }],
  visual: {
    type: "stack",
    style: { direction: "column", padding: 56, gap: 18, background: "#080d16" },
    children: [
      { type: "text", text: "TWO LOCAL RENDERERS",
        style: { color: "#fff", fontSize: 64, fontWeight: 800 },
        enter: { type: "rise", at: { cue: 0 } } },
      { type: "progress", value: 1, fill: "#2ee6d6",
        style: { height: 10, background: "#243248", radius: 5 },
        animate: [{ property: "progress", from: 0, to: 1,
          at: 0.5, duration: 1.2, ease: "out" }] },
    ],
  },
}
```

A visual-only scene renders through either provider; Narova compiles the tree
to HTML for HyperFrames. A scene can also carry both `body` and `visual`:
HyperFrames uses the richer `body`, while no-browser requires and uses `visual`.
No-browser deliberately errors on HTML-only scenes instead of silently lowering
them. It supports stacks/groups, text, shapes, SVG paths, local raster/SVG
assets and fonts, OpenType-shaped RTL text (including Urdu/Arabic), full-frame
scene video, cue/keyframe motion, four transitions, captions, audio, snapshots,
and deliverables. It does not
claim parity for arbitrary HTML/CSS/JS, browser walkthrough framing, nested
video, shaders, 3D, particles, Lottie, or maps.

```bash
narova renderers list
narova build --renderer no-browser
narova preview --renderer no-browser   # writes out/preview-no-browser.mp4
```

See the exact [renderer capability contract](skills/narova/references/renderers.md).

### Optional 3D-production direction

Core Narova includes its complete authored-3D and mixed-compositing surface
without another skill. For work that needs intentional subject/world
representation, asset or production-capability routing, scene direction, or
rationale-isolated inspection, install the
independent [`narova-3d-production`](skills/narova-3d-production/) companion:

```bash
npx skills add ammar-hasan/narova --skill narova-3d-production -g
```

It is a concise, high-freedom direction layer with conditional references. It
can keep an intentional abstraction or route an available generation, model,
rigging, animation, or inspection capability when the chosen form needs one; it
does not supply those operations itself. It is not a renderer, physics
simulator, preset pack, required dependency, or guarantee of taste. It adds no
CLI or project behavior, and core Narova works identically without it.

### Product walkthroughs

[Watch the complete 83-second narrated walkthrough generated by this workflow.](assets/narova-product-walkthrough-demo.mp4)

The shipped showcase is one continuous browser take: create and configure a
project, search and reopen it, add and assign a task, enable an automation, and
invite a teammate. The local voiceover, karaoke captions, semantic actions,
cursor movement, and evidence frames all share the measured narration clock.

When the walkthrough cursor is enabled, semantic clicks now emit a short,
high-contrast ripple at the real target. It expands, fades, and disappears in
under half a second. [Watch the voiced, captioned real-browser click proof.](assets/narova-click-highlight-proof.mp4)

Product demos add a driver-neutral `walkthroughs` recipe and point scenes at
it. Narova uses optional `agent-browser` for the live exploration/capture pass,
then treats the WebM as a hashed source asset—ordinary builds never replay web
actions.

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
Hook variants keep separate captures: synth and capture the base plus each
walkthrough-bearing `--variant <id>` before `build --variants`.

## Voices

| Backend | Quality | Speed | Setup | Notes |
|---------|---------|-------|-------|-------|
| `piper` | good | fast | none (default) | small local voices |
| `xtts`  | higher | slow | `narova-setup --xtts` | ~1.9GB model, 58 speakers |
| `qwen`  | high | slow | `narova-setup --qwen` | ~1.2GB model, Apache 2.0, 9 speakers |
| `chatterbox` | voice cloning | slowest | `narova-setup --chatterbox` | `speaker` = absolute path to a 10–20s recording; own venv, ~1GB model |

Pick voices that sound clearly different. Give each a `color`.
List voices with `narova voices list --backend <name>`.

### Optional external TTS

External services are separate companion skills, not Narova dependencies.
Narova only runs providers explicitly registered from a manifest:

```bash
narova providers add <provider-manifest.json>
narova providers doctor <name>
narova voices list --backend <name>
```

Use the registered name as a voice's `backend` and pass an opaque
`providerOptions` object. Keep credentials in the provider's required
environment variables—never in `reel.config.mjs`. Install only the companion
you want:

```bash
npx skills add ammar-hasan/narova --skill narova-elevenlabs -g
npx skills add ammar-hasan/narova --skill narova-openai -g
```

- [`narova-elevenlabs`](skills/narova-elevenlabs/) uses ElevenLabs voice IDs
  and account voice listing.
- [`narova-openai`](skills/narova-openai/) uses OpenAI's Speech API, defaults
  to steerable `gpt-4o-mini-tts`, recommends `marin` or `cedar`, accepts
  existing custom voice IDs, and requests lossless WAV directly.

## Commands

```
narova init <dir>     new project
narova pack           write a deterministic .narova project archive
narova open <archive> verify, inspect, or materialize an untrusted archive
narova remix <source> copy a local project/archive or public github: locator
narova check          validate the config (fast, no side effects)
narova synth          make the audio + word timings
narova compose        make the selected renderer project
narova walkthrough    explore/capture/status narrated product demos
narova shots          snapshot QA frames per scene, motion sample, or narration beat
narova build          synth + compose + render -> out/video.mp4
narova preview        HyperFrames Studio, or a no-browser draft MP4
narova preview --detach   keep Studio alive; stop with preview --stop
narova voices         list or download voices
narova providers      add/list/remove/doctor external TTS providers
narova renderers      list/doctor the two bundled local renderers
narova doctor         check your machine
```

Commands find the project from any folder inside it (they walk up to the
nearest `reel.config.*`). `check` also prints an estimated narration length,
so a target duration can be tuned before any audio exists.

See [Narova project archives](PROJECT_ARCHIVES.md) for the public archive
format, safety boundary, deterministic normalization, and remote locator grammar.

Useful flags: `--backend <built-in-or-registered-provider>`,
`--renderer hyperframes|no-browser`, `--reuse` (keep old audio),
`--tempo`, `--size`, `--fps`, `--quality draft|standard|high`,
`--deliverables` (per-platform export presets via scale+pad — see
[`references/cli.md`](skills/narova/references/cli.md) for the full list).

## How it works

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
```

`out/`, `out/hf-*`, and `out/no-browser-*` are build folders. Never edit them.
The config remains the render source of truth; the approved brief records why the
creative direction is ready to scale.

## Repo layout

```
tool/              CLI package: installer, Node/Python runtime, vendors, tests
skills/narova/     agent instructions and references
skills/narova-*/   optional production, sourcing, and voice companions
docs/              the marketing site (GitHub Pages) + /changelog
generated/narova-skill-reel/  flagship sample project (built from a plain-language prompt; more in generated/)
generated/         agent-created projects; source kept, out/ and build/ ignored
CHANGELOG.md       every notable change, version by version
AGENT_PROTOCOL.md  versioned JSON envelopes, exit codes, and the agent loop
VISION.md          the product vision, mapped to where each point is implemented
LEARNINGS.md       non-normative implementation notes for public maintainers
```

Run everything with `npm test`, or test the CLI independently with
`npm test --prefix tool`.

## Release version contract

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

Apache-2.0 — see [LICENSE](./LICENSE). Changes are tracked in [CHANGELOG.md](./CHANGELOG.md) and on the [changelog page](https://ammar-hasan.github.io/narova/changelog/).
