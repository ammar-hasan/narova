# @narova/narova

The standalone CLI for [Narova](https://github.com/ammar-hasan/narova), a
deterministic scene-scripted video system with local speech, word-synced
captions, and local renderers.

The CLI and the Narova agent skill are separate artifacts. Installing this npm
package adds the `narova`, `narova-setup`, and `narova-uninstall` commands; it
does not install or modify agent instructions.

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

Published releases include npm provenance linking the package to its public
GitHub source and publishing workflow. Narova is available under the MIT
license.
