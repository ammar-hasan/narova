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

Optional `--xtts`, `--qwen`, and `--chatterbox` flags install larger local
voice backends into Narova-owned virtual environments. Optional hosted speech
(ElevenLabs, OpenAI) and video generation (Sora through OpenAI, Runway) are
separate companion skills registered explicitly; the core package stays
local-first and contains no vendor API adapter.

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
- AI clip generation through explicitly selected providers (Sora, Runway)
- Real product walkthrough videos with timed browser actions
- Local MP4, SRT, and VTT deliverables without a render service
- Deterministic shareable project archives with safe inspection and remix lineage
- Read-only evidence-graded provenance reports and text, YouTube, web, or JSON
  credit output

Two local renderers ship with the package. HyperFrames is the full browser
canvas (HTML/CSS, WebGL, Studio); No-Browser draws a portable scene tree with
Skia when a machine cannot launch a browser. Both run locally with no render
service or fee.

Agents can consume the versioned `narova.result/1` machine protocol (`--json`
on every operation) with stable exit classes, diagnostics, and artifact
records — no parsing of terminal prose.

Use `narova witness` to inspect an existing encoded artifact, or explicitly run
`narova build --witness` to add the same atomic `out/witness.json` evidence
bundle after a successful primary build. Witness decodes pixels locally and
returns structured facts, so the directing agent does not need its own vision
capability. Evidence is advisory and creative-neutral; plain builds and all
primary/cache/receipt identities remain unchanged.

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
