# Narova — local-first prompt-to-video CLI

Narova is a deterministic, programmatic video CLI for AI agents. It turns
prompts and scene scripts into narrated or silent 2D/3D video with local TTS,
word-synced captions, speech-timed visuals, and product walkthrough capture.

The CLI and the Narova agent skill are separate artifacts. Installing this npm
package adds the `narova`, `narova-setup`, and `narova-uninstall` commands; it
does not install or modify agent instructions.

The skill pins one compatible CLI release. After the skill is updated, its next
session checks `narova --version` and reconciles this global package to that
exact version before use.

[Website](https://ammar-hasan.github.io/narova/) ·
[npm package](https://www.npmjs.com/package/@narova/narova) ·
[GitHub](https://github.com/ammar-hasan/narova) ·
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
voice backends into Narova-owned virtual environments.

## Quick start

```bash
narova init my-video
cd my-video
narova check
narova build --release
```

## What it makes

- Prompt-to-video and script-to-video explainers
- Narrated dialogue with local TTS and word-synced captions
- Deterministic 2D HTML/CSS/SVG and Three.js/WebGL scenes
- Real product walkthrough videos with timed browser actions
- Local MP4, SRT, and VTT deliverables without a render service

See the [project README](https://github.com/ammar-hasan/narova#readme) for the
scene-script format, renderer choices, product walkthroughs, source grounding,
and full workflow.

## Agent skill

Install the separate agent skill with:

```bash
npx skills add ammar-hasan/narova --skill narova -g
```

## Network and local data

Narova renders locally. First use can download the pinned HyperFrames CLI,
Python packages, and selected speech models. Optional stock providers, cloud
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
available under the MIT license.
