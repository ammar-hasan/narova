# narova

> Working name. The final name is not decided yet.

**You give a prompt or a scene script. narova makes a narrated video.**

<div align="center">
  <video src="assets/narova-skill-reel.mp4" width="100%" controls playsinline title="Narova — prompt, voice, motion"></video>
  <p><a href="assets/narova-skill-reel.mp4">Watch the 30-second Narova overview</a></p>
</div>

The video has:

- Two voices talking to each other (neural TTS, runs on your machine).
- Captions that light up word by word, in each speaker's color.
- Elements that appear exactly when the voice reaches them.
- No API keys. No cloud.

narova makes the speech. [HyperFrames](https://www.npmjs.com/package/hyperframes)
draws the pictures and renders the mp4.

## narova is a skill

The whole tool lives inside one folder: `skills/narova/`. An AI agent
(Claude Code, Codex, Cursor, ...) reads it and can build videos for you.
To install it:

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
narova synth        # makes narration + timings
narova preview --detach   # keeps Studio alive and prints its review URL
narova build --reuse      # after approval, makes out/video.mp4
```

You need: **ffmpeg**, **Node 18+**, **Python 3.10+**.

The first `build` downloads a few things one time: it creates a Python venv
at `~/.narova/venv`, gets a voice model, and gets the HyperFrames CLI.
This can take a minute. It is not stuck.

Without `npm link`, run `node skills/narova/tool/bin/narova.js` instead of `narova`.

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

Useful flags: `--backend piper|xtts|qwen`, `--reuse` (keep old audio),
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
examples/          sample projects (incl. one built from a plain-language prompt)
generated/         agent-created projects; source kept, out/ and build/ ignored
SPEC.md            the contract
VISION.md          the product vision, mapped to where each point is implemented
LEARNINGS.md       bugs we hit and fixed — read before changing the pipeline
```

Run the tests: `npm test` (no extra deps).

## License

MIT — see [LICENSE](./LICENSE).
