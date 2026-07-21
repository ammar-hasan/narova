# narova — product spec (the contract)

> Working name: **narova**. Tagline: *"A scene script becomes a narrated, captioned video."*
> One line: **narova writes the words and the voice; HyperFrames draws the pictures.**

## What it is

A toolkit that turns a **declarative scene script** into a narrated MP4 with
word-synced karaoke captions and voice-triggered reveals. Since 0.3.0 the
render engine is **HyperFrames** (HTML → video, deterministic seek-based
rendering). narova owns the narration layer:

- two-host neural TTS (piper / xtts / qwen, fully local, no API keys),
- word/turn timing derivation, rescaled to the real audio,
- generating a complete HyperFrames project (composition + timeline + audio).

The end goal UX: an agent takes a user prompt, writes the scene script, and
`narova build` produces the video.

## Non-negotiables (from LEARNINGS.md)

- Caption timeline MUST equal the actual audio duration (rescale after loudnorm).
- The generated composition MUST obey the HyperFrames determinism contract:
  one synchronous paused GSAP timeline, no wall-clock CSS animations, no
  clocks/randomness/network at render time.
- Scene clip starts MUST chain exactly (cumulative sum of rounded durations) —
  HyperFrames lints same-track overlap.
- XTTS runs on current `transformers` via the shim + torchcodec (never downgrade).

## Architecture

Three layers — keep the boundaries:

- **Python** (`py/narova_tts`, managed venv): **TTS + timings only**.
  Contract is FROZEN: `narration.json` + `config.resolved.json` in →
  `audio/NN.wav`, `audio/NN.mp3`, `audio/full.wav` (concatenated narration
  track) + `timings.json` out.
- **Node** (`src/`, the `narova` CLI): config loading/validation, the
  **composition generator** (`src/compose/`), and orchestration.
- **HyperFrames** (via `npx hyperframes@<PIN>`, pinned in `src/hf.js`):
  preview (Studio), lint/check, and rendering the final MP4 (audio muxed).

**narova ships as an agent skill** — the tool lives inside the skill folder;
installing the skill IS installing narova. The repo is the dev home.

```
narova/                          # the repo (dev home; examples + tests)
├── skills/narova/               # THE PRODUCT — docs + tool in one folder
│   │                            #   (installable: npx skills add ammar-hasan/narova;
│   │                            #    .claude/skills/narova symlinks here for in-repo use)
│   ├── SKILL.md  references/    # what an agent reads
│   └── tool/                    # the bundled CLI
│       ├── bin/narova.js        # init check synth compose build preview voices doctor
│       ├── src/                 # config, schema, check, compose/, hf, pipeline, doctor, init, util
│       ├── py/narova_tts/       # TTS backends + timing (piper, xtts, qwen)
│       └── setup.sh             # venv provisioning (auto-run by first synth)
│       └── test/                # the tool test suite (npm test runs it)
└── examples/                    # sample projects
```

The TTS venv lives at `~/.narova/venv` ($NAROVA_VENV overrides) — outside the
skill folder so skill updates never destroy it. The first `synth` creates it
automatically.

## The pipeline

```
reel.config.mjs
   │  narova synth      writes narration.json + config.resolved.json, then Python:
   │                    per-scene wavs + full.wav + timings.json (rescaled)
   ▼
   │  narova compose    out/hf/: index.html + assets/narration.wav + package.json
   ▼
   │  narova build      = synth + compose + `npx hyperframes render` -> out/video.mp4
   ▼
out/video.mp4
```

`out/` and `out/hf/` are build artifacts — regenerated, never hand-edited.
The reel.config is the single source of truth. (Future work, not built: a
`--eject` that turns out/hf into a standalone editable HyperFrames project.)

## The scene script (author-facing API)

```js
// reel.config.mjs  (or .js / .json / .cjs)
export default {
  title: "The Venture Factory",
  size: "16:9",                           // "16:9" | "1:1" | "9:16" | {w,h}
  voices: {
    a: { backend: "xtts", speaker: "Damien Black",  color: "#2ee6d6", label: "narrator · A" },
    b: { backend: "xtts", speaker: "Sofia Hellen",  color: "#ff7eb6", label: "narrator · B" },
  },
  theme: { accent: "#2ee6d6", bg: "#080d16", css: "theme.css" },  // tokens + optional CSS file
  timing: { gapSentence: 0.28, gapTurn: 0.5, lead: 0.16, tail: 0.6, tempo: 1.18 },
  scenes: [
    {
      id: "title",
      vo: [ { who: "b", text: "Okay. What if your codebase could just build itself?" },
            { who: "a", text: "That's the Venture Factory. Let me show you." } ],
      body: `<div class="s-title">...<span class="cue" data-cue="1">...</span></div>`,
    },
    // ...
  ],
}
```

Rules:
- `vo` is an ordered list of `{who, text}` turns (single narrator = one who).
- `body` is HTML, dropped verbatim into the scene's clip. Elements with
  `data-cue="k"` reveal when the voice reaches turn index `k` (**0-based**
  into `vo`); elements with class `reveal` animate in at scene entry;
  everything else is static.
- `theme.css` must NOT use `animation: … infinite` (nondeterministic under
  frame rendering — `narova check` warns).
- Element ids inside bodies must be unique across ALL scenes (`check` warns).
- Legacy fields `caption` and `dur` are accepted and ignored (durations come
  from the measured audio).

## The generated composition (out/hf contract)

- `index.html` — standalone HyperFrames composition:
  - root `#root` (`data-composition-id="main"`, px-sized, `data-duration` = total),
  - `#bg` full-bleed background child (never on the root — producer can drop it),
  - one `<section class="clip scene">` per scene on track 1, starts chained
    exactly (`start[i+1] = start[i] + dur[i]`, 3-decimal rounding),
  - one overlay clip (track 2, full span): karaoke captions + progress bar,
  - `<audio src="assets/narration.wav">` as a direct root child (track 10),
  - one inlined `DATA` object + a synchronous paused GSAP timeline at
    `window.__timelines["main"]`.
- `DATA` shape: `{ total, scenes:[{id,start,dur,turns[]}], groups:[{who,label,start,end,words:[{w,t0,t1}]}] }`
  — `turns` scene-local, everything else global seconds; `groups` = one caption
  line per sentence (grouped by the timings `si` index).
- Karaoke = seek-safe `tl.set(el, {className}, t)` word-state flips
  (upcoming → active → past); reveals/cues = timeline tweens on the allowlist.
- `assets/narration.wav` — copy of `out/audio/full.wav`.
- `package.json` — pins `hyperframes` to the same version as `src/hf.js`.

## The Python contract (FROZEN)

`timings.json`: `{ <sceneId>: { dur, turns:[sec...], words:[{w,t0,t1,who,si}] } }`
— all times scene-local seconds, already rescaled to the measured post-loudnorm
audio. `audio/full.wav` duration equals `sum(dur)` within ~5ms/scene (asserted).

## CLI

```
narova init <dir>          scaffold a project (config + one example scene)
narova check               validate config fast (cues, ids, theme animations)
narova synth [--backend]   Python TTS -> out/audio/*, out/timings.json
narova compose             -> out/hf/ (HyperFrames project)
narova build               synth + compose + hyperframes render -> out/video.mp4
narova preview             compose + HyperFrames Studio
narova voices list|get     list / download TTS voices
narova doctor              ffmpeg, ffprobe, python venv, npx hyperframes
```

Flags: `--backend piper|xtts|qwen`, `--reuse`, `--tempo`, `--size`, `--fps`,
`--quality draft|standard|high`, `--out`, `--project`, `--config`,
`--voice-a`, `--voice-b`.

## Backends

- **piper** — default, zero-config, fast; downloads an ONNX voice on first use.
- **xtts** — coqui-tts + torch + torchcodec; MPS/CPU; ~1.9GB model; 58 studio
  speakers. Gated behind `scripts/setup.sh --xtts`.
- **qwen** — Qwen3-TTS 0.6B CustomVoice (Apache 2.0); MPS/CPU; ~1.2GB model;
  9 preset speakers; optional per-voice `lang`. Gated behind
  `scripts/setup.sh --qwen`. Override the model with `$NAROVA_QWEN_MODEL`.
- The backend interface (`synthesize(who, text) -> wav`) stays pluggable so
  `elevenlabs`, `kokoro`, or macOS `say` can be added later.

## Status: 0.3.0 shipped

`init && build` produces a synced MP4 via HyperFrames; lint/check pass on
generated projects; caption sync verified in snapshots; doctor covers the
toolchain; the skill walks prompt → script → check → synth → compose →
preview → build; the tool + tests ship inside the skill.

## Future work (not built — do not start without deciding to)

- `--eject`: turn out/hf into a standalone, Studio-editable project.
- Theme gallery: a few ready-made looks selectable by name.
- Qwen voice cloning (`speaker: {clone: "sample.wav"}`) and voice design.
- Vendor GSAP into out/hf/assets for fully offline rendering.
- npm publish (the skill layout already supports `npx skills add`).
