<div align="center">

# narova

**You write a prompt. narova makes the video.**

A skill your AI agent reads — Claude Code, Codex, Cursor, Kimi Code — that turns
prompts, scripts, and any URL into narrated, captioned video. Rendered on your machine.

[![License: MIT](https://img.shields.io/badge/license-MIT-d6f94c.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.6.0-4fd9e8.svg)](./package.json)
[![Site](https://img.shields.io/badge/site-ammar--hasan.github.io%2Fnarova-f2418a.svg)](https://ammar-hasan.github.io/narova/)

<a href="assets/narova-skill-reel.mp4">
  <img src="assets/narova-demo.gif" alt="narova demo — prompt, voice, motion" width="100%">
</a>

*This 30-second reel was made by narova, about narova. [Watch it with sound](assets/narova-skill-reel.mp4) · [Live site](https://ammar-hasan.github.io/narova/)*

</div>

## Why narova

- **Two voices, one conversation** — neural TTS dialogue synthesized locally. Give each speaker a color; narova writes the banter and the timing.
- **Karaoke captions** — every word lights up exactly as it's spoken, in the speaker's color. No manual timing, ever.
- **Cue-timed reveals** — elements stay hidden until the voice reaches them. Visuals land on the beat.
- **No API keys. No cloud.** — ffmpeg, local TTS, and [HyperFrames](https://www.npmjs.com/package/hyperframes). Nothing leaves your machine.

## Install

narova is a **skill** — the whole product lives in `skills/narova/`, and any agent
that reads skills can use it:

```bash
npx skills add ammar-hasan/narova
# or copy skills/narova/ into ~/.claude/skills/
```

## Quickstart

```bash
git clone https://github.com/ammar-hasan/narova.git && cd narova
npm link            # optional: gives you the `narova` command
narova doctor       # checks ffmpeg, python, hyperframes

narova init generated/myreel && cd generated/myreel
narova synth        # makes narration + word timings
narova preview --detach   # review it in HyperFrames Studio
narova build --reuse      # after approval → out/video.mp4
```

You need: **ffmpeg**, **Node 18+**, **Python 3.10+**.

The first `build` downloads a few things one time: it creates a Python venv
at `~/.narova/venv`, gets a voice model, and gets the HyperFrames CLI.
This can take a minute. It is not stuck.

Without `npm link`, run `node skills/narova/tool/bin/narova.js` instead of `narova`.

Or skip the terminal entirely — once the skill is installed, just ask your agent
for a video. Point it at a product site, an article, a paper, or a repo, and it
writes the script, picks the voices, and builds the visual language itself.

## The scene script

A project is a folder with one config file: `reel.config.mjs`.

```js
export default {
  title: "My Reel",
  size: "16:9",                              // "16:9" | "1:1" | "9:16"
  assets: "assets",                          // copied into out/hf/assets/
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#2ee6d6", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "host · B" },
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

## Voices

| Backend | Quality | Speed | Setup | Notes |
|---------|---------|-------|-------|-------|
| `piper` | good | fast | none (default) | small local voices |
| `xtts`  | higher | slow | `skills/narova/tool/setup.sh --xtts` | ~1.9GB model, 58 speakers |
| `qwen`  | high | slow | `skills/narova/tool/setup.sh --qwen` | ~1.2GB model, Apache 2.0, 9 speakers |
| `chatterbox` | voice cloning | slowest | `skills/narova/tool/setup.sh --chatterbox` | `speaker` = absolute path to a 10–20s recording; own venv, ~1GB model |

Pick two voices that sound clearly different. Give each a `color`.
List voices with `narova voices list --backend <name>`.

## Commands

```
narova init <dir>     new project
narova check          validate the config (fast, no side effects)
narova synth          make the audio + word timings
narova compose        make the HyperFrames project (out/hf/)
narova shots          snapshot one QA frame per scene
narova build          synth + compose + render -> out/video.mp4
narova preview        open HyperFrames Studio and print its URL
narova preview --detach   keep Studio alive; stop with preview --stop
narova voices         list or download voices
narova doctor         check your machine
```

Commands find the project from any folder inside it (they walk up to the
nearest `reel.config.*`). `check` also prints an estimated narration length,
so a target duration can be tuned before any audio exists.

Useful flags: `--backend piper|xtts|qwen|chatterbox`, `--reuse` (keep old audio),
`--tempo`, `--size`, `--fps`, `--quality draft|standard|high`.

## How it works

```
reel.config.mjs
   │
   ▼  synth      Python makes the speech and the word timings.
   │             Timings are scaled to match the real audio exactly.
   ▼  compose    narova writes a HyperFrames project into out/hf/:
   │             scene clips, karaoke captions, reveals, one timeline.
   ▼  render     HyperFrames renders the mp4 with the audio inside.
   │
out/video.mp4
```

`out/` and `out/hf/` are build folders. Never edit them.
The config file is the only source of truth.

## Repo layout

```
skills/narova/     the product: SKILL.md + references/ + tool/ (CLI, TTS, tests)
docs/              the marketing site (GitHub Pages) + /changelog
generated/narova-skill-reel/  flagship sample project (built from a plain-language prompt; more in generated/)
generated/         agent-created projects; source kept, out/ and build/ ignored
CHANGELOG.md       every notable change, version by version
SPEC.md            the contract
VISION.md          the product vision, mapped to where each point is implemented
LEARNINGS.md       bugs we hit and fixed — read before changing the pipeline
```

Run the tests: `npm test` (no extra deps).

## License

MIT — see [LICENSE](./LICENSE). Changes are tracked in [CHANGELOG.md](./CHANGELOG.md) and on the [changelog page](https://ammar-hasan.github.io/narova/changelog/).
