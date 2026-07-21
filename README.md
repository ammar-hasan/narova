# narova

> Working name — the final package name is still being chosen.

**You write a scene script. narova turns it into a narrated video with word-synced captions.**

One line: **narova writes the words and the voice; HyperFrames draws the pictures.**

- narova makes the speech: two hosts talking, neural voices, word timings.
- [HyperFrames](https://www.npmjs.com/package/hyperframes) renders the video: real animation, preview studio, mp4 with audio.
- The captions highlight word by word, in each speaker's color.
- Elements on screen appear exactly when the voice reaches them.
- Everything runs on your machine. No API keys. No cloud.

## Quickstart (60 seconds)

narova ships as an **agent skill** — the whole tool lives inside
`skills/narova/`. Nothing to install beyond cloning:

```bash
git clone https://github.com/ammar-hasan/narova.git && cd narova
npm link                         # optional: puts `narova` on PATH (zero deps)
narova doctor                    # checks ffmpeg, python, npx hyperframes

narova init myreel && cd myreel
narova build                     # makes out/video.mp4 (first run sets up the TTS venv itself)
narova preview                   # opens HyperFrames Studio to scrub and review
```

You need **ffmpeg**, **Node.js 18+**, and **Python 3.10+**. The first `build`
creates the TTS venv (at `~/.narova/venv`), downloads a voice model, and the
HyperFrames CLI — one-time waits, not hangs. Without `npm link`, use
`node skills/narova/tool/bin/narova.js` instead of `narova`.

## The scene script

A project is a folder with a `reel.config.mjs` (or `.js` / `.json`).

```js
export default {
  title: "The Venture Factory",
  size: "16:9",                              // "16:9" | "1:1" | "9:16"
  voices: {
    a: { backend: "xtts", speaker: "Damien Black", color: "#2ee6d6", label: "narrator · A" },
    b: { backend: "xtts", speaker: "Sofia Hellen", color: "#ff7eb6", label: "narrator · B" },
  },
  theme: { accent: "#2ee6d6", bg: "#080d16" },
  timing: { gapSentence: 0.28, gapTurn: 0.5, lead: 0.16, tail: 0.6, tempo: 1.18 },
  scenes: [
    {
      id: "title",
      vo: [                                   // the dialogue that is SPOKEN
        { who: "b", text: "Okay. What if your codebase could just build itself?" },
        { who: "a", text: "That's the Venture Factory. Let me show you." },
      ],
      body: `<div class="s-title">
        <h1 class="display reveal">The Venture Factory</h1>
        <p class="lede cue" data-cue="1">builds itself — safely.</p>
      </div>`,                                // HTML; data-cue="1" shows when turn 1 starts (0-based)
    },
    // ...more scenes
  ],
}
```

The rules:

- `vo` is a list of `{ who, text }` turns, in order. Two hosts trading lines
  sound better than one narrator. One narrator also works: use one `who`.
- `body` is HTML. An element with `data-cue="k"` stays hidden until the voice
  reaches turn `k` (**0-based**: `data-cue="0"` is the first turn). An element
  with class `reveal` animates in when the scene starts.
- Scene length comes from the real audio. You do not set durations.
- Add your own styles with `theme` tokens or a CSS file (`theme: { css: "theme.css" }`).
  One rule: no `animation: … infinite` in your CSS — the renderer seeks frames,
  so wall-clock animations break. `narova check` warns about this.

## Voices (TTS backends)

Speech runs in a small Python package inside a managed venv.

| Backend | Quality | Speed | Setup | Notes |
|---------|---------|-------|-------|-------|
| `piper` | good | fast | default | local ONNX; zero config; downloads a voice on first use |
| `xtts`  | higher | slower | `tool/setup.sh --xtts` | coqui-tts on MPS/CPU; ~1.9GB model; 58 studio speakers |
| `qwen`  | high | slower | `tool/setup.sh --qwen` | Qwen3-TTS 0.6B (Apache 2.0); 9 preset speakers; MPS/CPU |

Use two clearly different voices. For piper: `en_US-ryan-high` and
`en_US-hfc_female-medium`. For xtts: e.g. `Damien Black` and `Sofia Hellen`. For qwen: e.g. `Ryan` and `Serena`.
Give each host a `color` — the active caption word gets that color.

## CLI

```
narova init <dir>     start a new project (config + one scene)
narova check          validate the config fast — no TTS, no browser, no writes
narova synth          Python TTS -> out/audio/*, out/timings.json
narova compose        timings + audio -> out/hf/ (a HyperFrames project)
narova build          synth + compose + hyperframes render -> out/video.mp4
narova preview        open HyperFrames Studio on out/hf
narova voices         list or download TTS voices
narova doctor         check ffmpeg, python venv, npx hyperframes
```

Common flags: `--backend piper|xtts|qwen`, `--reuse` (keep existing audio + timings),
`--tempo`, `--size`, `--fps`, `--quality draft|standard|high`, `--out <dir>`.

## Agent skill

narova IS a Claude Code skill — `skills/narova/` contains the docs an
agent reads AND the full tool (`tool/`). An agent goes from **a prompt to a
finished video**: it writes the scene script, runs `check`, builds, and shows
you the preview. To install the skill anywhere:

```bash
npx skills add ammar-hasan/narova          # cross-agent (Claude Code, Codex, Cursor, ...)
scripts/install-skill.sh                   # or: symlink into ~/.claude/skills + npm link the CLI
scripts/install-skill.sh --project <dir>   # or: copy into <dir>/.claude/skills
```

## How it works

```
reel.config.mjs
      │
      ▼
  synth       Python TTS: speech sentence by sentence, word timings      (narova)
      │        rescaled so they match the real audio length exactly
      ▼
  compose     generates a HyperFrames project in out/hf/:                (narova)
      │        scene clips + karaoke captions + reveals on one
      │        GSAP timeline, narration as the audio track
      ▼
  render      HyperFrames renders the mp4, audio muxed in                (hyperframes)
      │
      ▼
out/video.mp4
```

`out/` and `out/hf/` are build folders. Never edit them — the reel.config is
the source of truth, and every build regenerates them.

## Repo layout

```
skills/narova/     the product: SKILL.md + references/ + tool/ (CLI, TTS, tests)
examples/          two full sample projects
scripts/           install-skill.sh (copy/symlink the skill elsewhere)
SPEC.md            the contract
LEARNINGS.md       hard-won fixes — read before changing the pipeline
```

Run the tests with `npm test` (Node + Python, no extra deps).

## License

MIT — see [LICENSE](./LICENSE).
