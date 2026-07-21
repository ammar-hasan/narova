# narova — the contract

> Working name: **narova**.
> One line: narova writes the words and the voice. HyperFrames draws the pictures.

## What it is

narova turns a scene script into a narrated mp4. The captions light up word
by word. Screen elements appear when the voice reaches them.

The work is split in three parts:

- **Python** (`skills/narova/tool/py/narova_tts`): speech and word timings. Nothing else.
- **Node** (`skills/narova/tool/src`): config validation and the composition generator.
- **HyperFrames** (`npx hyperframes@<pin>`): preview, lint, and the final render.

The goal: an agent takes a user prompt, writes the scene script, and
`narova build` makes the video.

## Rules that must never break

- Caption timings must equal the real audio length. Python rescales them
  after loudnorm (see LEARNINGS #1).
- The generated page must be deterministic: one paused GSAP timeline, built
  synchronously. No looping CSS animations. No clocks, randomness, or network
  calls at render time.
- Scene clips must chain exactly: `start[i+1] = start[i] + dur[i]`, rounded to
  3 decimals. HyperFrames rejects overlap on the same track.
- XTTS runs on current `transformers` through the shim. Never downgrade.

## Layout

narova ships as an agent skill. Installing the skill IS installing narova.

```
narova/                          # the repo
├── skills/narova/               # THE PRODUCT
│   │                            #   install: npx skills add ammar-hasan/narova
│   │                            #   (.claude/skills/narova is a symlink here)
│   ├── SKILL.md  references/    # what an agent reads
│   └── tool/                    # the CLI
│       ├── bin/narova.js        # entry point
│       ├── src/                 # config, schema, check, compose/, hf, pipeline, doctor, init, util
│       ├── py/narova_tts/       # TTS backends + timing
│       ├── setup.sh             # creates the venv (auto-run by first synth)
│       └── test/                # test suite (npm test)
└── examples/                    # sample projects
```

The venv lives at `~/.narova/venv` (override with `$NAROVA_VENV`). It sits
outside the skill folder so a skill update cannot delete it. The first
`synth` creates it.

## The pipeline

```
reel.config.mjs
   │  narova synth      Python: per-scene wavs + full.wav + timings.json
   ▼
   │  narova compose    out/hf/: index.html + assets/narration.wav + package.json
   ▼
   │  narova build      synth + compose + `npx hyperframes render`
   ▼
out/video.mp4
```

`out/` and `out/hf/` are build folders. Every run regenerates them. The
config file is the only source of truth.

## The scene script

```js
// reel.config.mjs  (also accepted: .js, .json, .cjs)
export default {
  title: "My Reel",
  size: "16:9",                           // "16:9" | "1:1" | "9:16" | {w,h}
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high", color: "#2ee6d6", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "host · B" },
  },
  theme: { accent: "#2ee6d6", bg: "#080d16", css: "theme.css" },  // optional
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: 1.12 },
  scenes: [
    { id: "title",
      vo: [ { who: "a", text: "This is narova." },
            { who: "b", text: "Scenes in, video out." } ],
      body: `<div class="s-title"><h1 class="reveal">narova</h1>
             <p class="cue" data-cue="1">scenes in, video out</p></div>` },
  ],
}
```

Rules:

- `vo` is the spoken dialogue, in order. One narrator = one `who`.
- `body` is HTML, placed into the scene clip as-is.
- `data-cue="k"`: hidden until turn `k` starts. `k` counts from 0.
- `class="reveal"` (no cue): animates in when the scene starts.
- Scene and voice ids must match `[A-Za-z][A-Za-z0-9_-]*`.
- Element ids in bodies must be unique across all scenes.
- No `animation: ... infinite` in theme.css.
- Old fields `caption` and `dur` are accepted and ignored.

`narova check` catches all of this.

## The generated page (out/hf contract)

`index.html` is a standard HyperFrames composition:

- Root `#root`: `data-composition-id="main"`, sized in px, `data-duration` = total.
- `#bg`: a full-size background child. Never put background on the root —
  the renderer can drop it (frame turns black).
- One `<section class="clip scene">` per scene on track 1, starts chained exactly.
- One overlay clip on track 2, full length: captions + progress bar.
- `<audio src="assets/narration.wav">` as a direct child of the root, track 10.
- One inline `DATA` object + one paused GSAP timeline at `window.__timelines["main"]`.

`DATA` shape:

```
{ total,
  scenes: [{ id, start, dur, turns[] }],        // turns are scene-local seconds
  groups: [{ who, label, start, end,            // one caption line per sentence
             words: [{ w, t0, t1 }] }] }        // global seconds
```

Captions use `tl.set(el, {className}, t)` per word: upcoming → active → past.
This is safe when the renderer jumps to any time. Reveals and cues are
timeline tweens (opacity, y, scale only).

Also in out/hf: `assets/narration.wav` (a copy of `out/audio/full.wav`) and
`package.json` (pins the hyperframes version from `tool/src/hf.js`).

## The Python contract (frozen)

In: `narration.json` + `config.resolved.json`.
Out: `audio/NN.wav`, `audio/NN.mp3`, `audio/full.wav`, `timings.json`.

`timings.json`:

```
{ <sceneId>: { dur, turns: [sec...], words: [{ w, t0, t1, who, si }] } }
```

All times are scene-local seconds, already rescaled to the real audio.
`full.wav` length equals the sum of all `dur` (asserted, ~5ms per scene).

## CLI

```
narova init <dir>     new project
narova check          validate the config (fast, no side effects)
narova synth          Python TTS -> out/audio/*, out/timings.json
narova compose        -> out/hf/
narova build          synth + compose + render -> out/video.mp4
narova preview        compose + HyperFrames Studio
narova voices         list or download voices
narova doctor         check ffmpeg, python, venv, hyperframes
```

Flags: `--backend piper|xtts|qwen`, `--reuse`, `--tempo`, `--size`, `--fps`,
`--quality draft|standard|high`, `--out`, `--project`, `--config`,
`--voice-a`, `--voice-b`.

## Backends

- **piper** — default. Fast, small, no setup. Downloads a voice on first use.
- **xtts** — higher quality, slow. ~1.9GB model, 58 speakers.
  Setup: `tool/setup.sh --xtts`.
- **qwen** — Qwen3-TTS 0.6B, Apache 2.0. High quality, slow. ~1.2GB model,
  9 speakers, optional per-voice `lang`. Setup: `tool/setup.sh --qwen`.
  Change the model with `$NAROVA_QWEN_MODEL`.

The backend interface is one function: `synthesize(who, text) -> wav`.
New backends plug in there.

## Status: 0.3.0 shipped

Build works end to end. Lint and check pass on generated pages. Caption sync
verified in snapshots. The skill goes prompt → script → check → synth →
compose → preview → build. The tool and tests ship inside the skill.

## Future work (decided, not started)

- `--eject`: make out/hf a standalone project you can edit in Studio.
- Theme gallery: ready-made looks, picked by name.
- Qwen voice cloning (`speaker: {clone: "sample.wav"}`).
- Bundle GSAP into out/hf so rendering works fully offline.
- Publish to npm.
