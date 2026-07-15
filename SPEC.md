# narova — product spec (the contract)

> Working name: **narova** (the research agent proposes final names; keep the package name a
> single token, lowercase). Tagline: *"A scene script becomes a narrated, captioned, kinetic
> explainer video."*

## What it is

A toolkit that turns a **declarative scene script** into:
1. an **interactive self-contained HTML player** (word-synced kinetic captions, reactive
   reveals, speaker indicator, play/step controls, embedded neural narration), and
2. a **rendered MP4** that is pixel-identical to the player (captions + reveals + motion baked
   in), with a two-host neural voiceover.

Think "Remotion, but the narration and word-synced captions are first-class and automatic, and
you write scenes as plain HTML+data instead of React." The killer feature is **automatic
word-level caption sync to generated speech** and **visuals that react to the voiceover**.

## Non-negotiables (from LEARNINGS.md)

- Caption/frame timeline MUST equal the actual audio duration (rescale after loudnorm).
- MP4 is rendered by capturing the real player at word onsets (no libass dependency).
- Chrome capture is hang-proof (timeout + retry).
- The served video supports HTTP Range (seeking).
- XTTS runs on current `transformers` via the shim + torchcodec (never downgrade).

## Architecture

Two clean language boundaries — keep them:

- **Node** (`src/`, the `narova` CLI): renderer (scenes → player/record HTML + narration.json),
  capture (headless Chrome), assemble (ffmpeg), serve (range server), and orchestration.
- **Python** (`py/`, a small package invoked via a managed venv): **TTS only** — narration.json
  → per-scene wav/mp3 + `timings.json` (word/turn timestamps, rescaled to real audio). Backends:
  `piper` (local ONNX, fast, zero-config) and `xtts` (coqui-tts, higher quality).

Node calls Python for the `synth` stage via subprocess; everything else is Node + `ffmpeg` +
`chrome`. The reference implementation currently has both stages fused in `pipeline.build_video.py`
— split them: Python owns audio+timings, Node owns render/capture/assemble/serve.

```
narova/
├── package.json            # bin: narova ; deps minimal (commander/yargs ok)
├── bin/narova.js          # CLI entry
├── src/
│   ├── render/             # scenes -> player.html, record.html, narration.json
│   │   ├── scene-schema.*  # the scene/config schema + validation
│   │   ├── css.*           # base theme (tokens), overridable
│   │   ├── player.*        # interactive player template (from renderer.build.js)
│   │   └── still.*         # ?t= / VF_STILL deterministic still mode
│   ├── capture/            # headless-chrome keyframe capture (timeout+retry)
│   ├── assemble/           # ffmpeg variable-duration frames + audio -> mp4
│   ├── serve/              # range-capable static server (from serve.py, or node http)
│   └── pipeline.*          # orchestrates the stages
├── py/
│   ├── narova_tts/        # synth: piper + xtts backends, timing, rescale, atempo, fades
│   │   ├── xtts_compat.py  # transformers shim (verbatim from reference)
│   │   └── ...
│   └── requirements*.txt
├── examples/
│   └── venture-factory/    # a real sample project (port our 14-scene script)
├── scripts/                # setup.sh (venv + deps + voice download), doctor
├── docs/                   # README-level docs, RESEARCH.md (from research agent)
├── SPEC.md  LEARNINGS.md  README.md  .gitignore  LICENSE
└── reference/              # the proven scratchpad code (extraction source; can delete later)
```

## The scene script (author-facing API)

A project is a directory with a config that exports **voices**, **theme**, and **scenes**.

```js
// reel.config.js  (or .json / .mjs)
export default {
  title: "The Venture Factory",
  size: { w: 1280, h: 720 },              // 16:9 default; support 1:1 and 9:16
  voices: {
    a: { backend: "xtts", speaker: "Damien Black",  color: "#2ee6d6", label: "narrator · A" },
    b: { backend: "xtts", speaker: "Sofia Hellen",  color: "#ff7eb6", label: "narrator · B" },
  },
  theme: { accent: "#2ee6d6", bg: "#080d16", /* token overrides */ },
  timing: { gapSentence: 0.28, gapTurn: 0.5, lead: 0.16, tail: 0.6, tempo: 1.18 },
  scenes: [
    {
      id: "title",
      caption: "A codebase that improves itself — safely.",   // short, on-screen
      vo: [ { who: "b", text: "Okay. What if your codebase could just build itself?" },
            { who: "a", text: "That's the Venture Factory. Let me show you." } ],
      body: `<div class="s-title">...<span data-cue="1">...</span></div>`,  // HTML; data-cue=k
      dur: 12,                                                  // fallback if audio absent
    },
    // ...
  ],
}
```

Rules the renderer enforces:
- `vo` is an ordered list of `{who, text}` turns (single narrator = one who).
- `caption` is what shows on screen; `vo` is what's spoken. They are different on purpose.
- `body` is HTML. Elements with `data-cue="k"` reveal when the voice reaches turn `k`
  (turn start from the timing track); others reveal on scene entry.
- The base CSS/theme is provided; authors add scene-specific styles via the theme or inline.

## CLI

```
narova init <dir>          scaffold a project (config + one example scene + theme)
narova render              scenes -> out/player.html, out/record.html, out/narration.json
narova synth [--backend]   narration.json -> out/audio/*, out/timings.json   (Python)
narova build               full pipeline -> out/video.mp4 + out/player.html   (render+synth+capture+assemble)
narova preview | serve     range server for out/ (player + mp4 + landing page)
narova voices list|get     list / download TTS voices
narova doctor              check ffmpeg, chrome, python venv, voices, ffprobe range, libass note
```

Flags: `--backend piper|xtts`, `--reuse` (skip synth, reuse audio+timings), `--workers N`
(capture parallelism), `--tempo`, `--size 9:16|1:1|16:9`, `--out <dir>`, `--voice-a`, `--voice-b`.

## Backends

- **piper** — default, zero-config, fast; downloads an ONNX voice on first use. Two voices for
  the duet (e.g. `en_US-ryan-high` / `en_US-hfc_female-medium`).
- **xtts** — coqui-tts + torch + torchcodec; MPS/CPU; the transformers shim; 58 studio speakers.
  Higher quality, slower, ~1.9GB model. Gated behind `scripts/setup.sh --xtts`.
- Design the backend as an interface (`synthesize(who, text) -> wav`) so `elevenlabs`, `kokoro`,
  or macOS `say` can be added later.

## Milestone for v0.1 (what "done" means)

1. `narova init myreel` scaffolds a runnable project.
2. `narova build` on the bundled `examples/venture-factory` produces a synced MP4 + player.
3. Caption/audio sync verified: `timings total == audio duration` (assert in the pipeline).
4. `narova serve` hosts it with working seek.
5. `narova doctor` passes on a fresh macOS with ffmpeg+chrome+python.
6. README with quickstart; LEARNINGS encoded as code, not just prose.

## Porting note

Almost everything exists in `reference/` and works. This is primarily an **extraction and
generalization** job: parameterize the hard-coded scene array into the config-driven schema,
split synth (Python) from render/capture/assemble (Node), wrap in a CLI, and keep every fix in
LEARNINGS.md intact. Do not regress the sync fix or the capture hardening.
