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
│       ├── src/                 # config, schema, check, compose/, hf, pipeline,
│       │                        #   timeline, exports, doctor, init, ingest, captions, util
│       ├── py/narova_tts/       # TTS backends + timing
│       ├── setup.sh             # creates the venv (auto-run by first synth)
│       └── test/                # test suite (npm test)
├── skills/narova-elevenlabs/    # optional, separately installable provider
│   ├── SKILL.md  references/    # ElevenLabs-only setup/configuration
│   └── tool/                    # provider manifest + isolated HTTP worker
└── generated/                   # agent-created sample projects (narova-skill-reel is the flagship)
```

The venv lives at `~/.narova/venv` (override with `$NAROVA_VENV`). It sits
outside the skill folder so a skill update cannot delete it. The first
`synth` creates it.

## The pipeline

```
reel.config.mjs
   │  narova compile     out/manifest.json (versioned intermediate representation)
   ▼
   │  narova synth       Python: per-scene wavs + full.wav + timings.json
   ▼
   │  narova compose     out/hf/: index.html + assets/narration.wav + package.json
   ▼
   │  narova build       synth + compose + `npx hyperframes render`
   ▼
out/video.mp4
```

synth caches every processed sentence (`~/.narova/cache/sentences/`, keyed by
backend + speaker + text + tempo) so a revision re-synthesizes only the
changed sentences — untouched scenes keep byte-identical audio. This is the
iteration-consistency contract.

`out/` and `out/hf/` are build folders. Every run regenerates them. The
config file is the only source of truth.

## The scene script

```js
// reel.config.mjs  (also accepted: .js, .json, .cjs)
export default {
  title: "My Reel",
  size: "16:9",                           // "16:9" | "1:1" | "9:16" | {w,h}
  assets: "assets",                       // optional; copied into out/hf/assets/
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high", color: "#2ee6d6", label: "host · A", gainDb: 0 },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "host · B" },
  },
  theme: { accent: "#2ee6d6", bg: "#080d16", css: "theme.css" },  // optional; mode: "light" flips the base palette
  chrome: { topbar: true, counter: true, progress: true },        // optional; false strips all page furniture
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: 1.12 },
  platform: "tiktok",                     // optional: tiktok|reels|shorts|linkedin|x|youtube — size preset + duration-band lint
  captions: { preset: "karaoke",          // optional: karaoke|slam|pop|rise
              emphasis: ["narova"],       //   words auto-highlighted in every caption line
              maxWords: 5 },             //   optional: cap words per caption line
  bed: { file: "assets/ambient.mp3", volume: 0.14, fadeIn: 0.5, fadeOut: 1.5 },  // optional background bed (legacy key: music)
  sfx: [ { file: "assets/pop.wav", scene: "title", at: 0.5, volume: 0.8 } ],   // optional spot SFX
  align: false,                           // true | { engine: "auto"|"faster-whisper"|"whisper-cpp" } — measured word timings
  variants: [ { id: "cold-open",          // optional hook variants for A/B tests (narova build --variants)
                scene: { vo: [ { who: "a", text: "Different opener." } ], body: `<div class="s-title"><h1>Hook B</h1></div>` } } ],
  series: { part: 1, total: 5 },           // optional: multi-episode badge "Part 1 / 5"
  scenes: [
    { id: "title",
      transition: "wipe",                 // optional: fade (default) | wipe | slide | zoom
      clip: "assets/bg.mp4",              // optional: b-roll video behind the scene
      vo: [ { who: "a", text: "This is narova." },
            { who: "b", text: "Scenes in, video out.", lang: "en" } ],  // lang: optional per-turn TTS language
      body: `<div class="s-title"><h1 class="reveal">narova</h1>
             <p class="cue" data-cue="1">scenes in, <span data-mark="underline">video out</span></p></div>` },
  ],
}
```

Rules:

- `vo` is the spoken dialogue, in order. One narrator = one `who`. Sentence
  segmentation recognizes English terminal punctuation plus Urdu full stop
  `۔` and question mark `؟`, so synthesis, timings, and caption groups stay
  aligned for Urdu and mixed-language turns.
- `body` is HTML, placed into the scene clip as-is.
- `data-cue="k"`: hidden until turn `k` starts. `k` counts from 0.
- `class="reveal"` (no cue): animates in when the scene starts.
- Timeline animators: `data-grow` (scaleX 0→1 from the left), `data-draw`
  (SVG stroke-dash self-draw), `data-count="N"` (+ optional
  `data-count-suffix`), `data-delay="s"` (added to the cue/entry trigger).
  `data-mark="underline|circle|box|highlight"` draws a hand-drawn-style
  annotation around the element at its cue time.
- Scene and voice ids must match `[A-Za-z][A-Za-z0-9_-]*`.
- Element ids in bodies are namespaced per scene at compose
  (`<sceneId>--<id>`; the body's own `url(#…)` / `href="#…"` / `for` /
  aria references are rewritten). Ids must be unique only within one scene,
  so reusable SVG `<defs>` can repeat across scenes. theme.css must not use
  `#id` selectors for body elements (`check` warns).
- Project `assets/` are source and are copied into generated `out/hf/assets/`.
  Inline SVG and data URIs are supported; remote render-time dependencies are
  rejected by the authoring workflow and warned by `narova check`.
- No `animation: ... infinite` in theme.css.
- `theme.mode` is `"dark"` (default) or `"light"` — a directive, not a color
  token; `"light"` swaps the built-in surface/ink/chrome-token defaults,
  which explicit tokens still override.
- `chrome` is `false` or an object with boolean `topbar` / `counter` /
  `progress` keys (all default true).
- Stats and superlatives in `vo` belong in the project's `claims.md` with a
  source; `check` warns when claim-looking lines have no ledger.
- `captions.preset` is `karaoke` (default), `slam`, `pop`, or `rise`;
  `captions.emphasis` words are matched case-insensitively,
  punctuation-stripped, and highlighted in every preset.
- `platform` picks the frame size when `size` is unset (`--size` beats the
  preset) and makes `check` warn when the estimated narration length falls
  outside the platform's target duration band.
- `bed` and `sfx` are mixed into the narration track by the synth stage
  (`references/audio.md`). SFX anchor to `scene` + scene-local `at`, or to
  the global timeline when `scene` is omitted. Files are resolved relative
  to the project. Music changes do not require re-synthesis.
- `align: true` replaces estimated word timings with measured ones
  (faster-whisper or whisper.cpp; `references/audio.md`). Off by default.
- `variants` are alternate scene-1 definitions for hook A/B tests;
  `narova build --variant <id>` / `--variants` render them.
- Old fields `caption` and `dur` are accepted and ignored.

`narova check` catches all of this. `narova check --strict` also verifies
that every detected claim actually appears in `claims.md`. `narova check
--release` adds a build gate: remote dependencies, unresolved assets, missing
claims, unsupported HTML, black frames, and clipped audio all fail the check.

## The generated page (out/hf contract)

`index.html` is a standard HyperFrames composition:

- Root `#root`: `data-composition-id="main"`, sized in px, `data-duration` = total.
- `#bg`: a full-size background child. Never put background on the root —
  the renderer can drop it (frame turns black).
- One `<section class="clip scene">` per scene, starts chained exactly; scene
  tracks contain at most three clips to keep Studio's timeline readable.
- One overlay clip on track 1000, full length: captions + progress bar.
- `<audio src="assets/narration.wav">` as a direct child of the root, track
  1001; HyperFrames infers its intrinsic duration.
- One inline `DATA` object + one paused GSAP timeline at `window.__timelines["main"]`.

`DATA` shape:

```
{ total,
  preset,                                        // caption style preset name
  scenes: [{ id, start, dur, turns[],            // turns are scene-local seconds
             transition? }],                     // fade|wipe|slide|zoom (absent = fade)
  groups: [{ who, label, start, end,             // one caption line per sentence
             words: [{ w, t0, t1, kw? }] }] }    // global seconds; kw=1 = emphasis word
```

Captions use `tl.set(el, {className}, t)` per word: upcoming → active → past.
This is safe when the renderer jumps to any time. Reveals and cues are
timeline tweens (opacity, y, scale); `data-grow`/`data-draw` are property
tweens (scaleX, stroke-dashoffset); `data-count` is stepped `tl.set` on
textContent. An animated SVG element carrying a `transform` attribute is
wrapped in a fresh `<g>` at load and the tween targets the wrapper, so the
attribute survives GSAP's CSS transform. The canvas reserves the caption
band's height; the content column is `var(--colw, 1000px)`.

Also in out/hf: the copied project `assets/`, `assets/narration.wav` (a copy
of `out/audio/mix.wav` when a bed/SFX mix was made, else
`out/audio/full.wav`), and `package.json` (pins the HyperFrames version).

## The Python contract (frozen)

In: `narration.json` + `config.resolved.json`.
Out: `audio/NN.wav`, `audio/NN.mp3`, `audio/full.wav`, `timings.json`, and
`audio/mix.wav` when `bed`/`sfx` is configured (full.wav + background bed + spot
SFX, same duration; narration is NOT re-loudnorm'd).

`timings.json`:

```
{ <sceneId>: { dur, turns: [sec...], words: [{ w, t0, t1, who, si }] } }
```

All times are scene-local seconds, already rescaled to the real audio.
`full.wav` length equals the sum of all `dur` (asserted, ~5ms per scene).
With `align` on, word `t0`/`t1` come from measured forced alignment instead of
length-weighted estimates (per-scene fallback to estimates on any mismatch).

## CLI

```
narova init <dir>     new project
narova ingest <url>   fetch a source page: images -> assets/, Chrome screenshot,
                      sources.md entry, claims.md skeleton (references/url-to-source.md)
narova compile        reel.config.* -> out/manifest.json (versioned project
                      manifest; also written automatically by synth/compose/build)
narova plan           compare current config against last manifest; classify
                      what changed and predict which stages will rebuild
narova check          validate the config (fast, no side effects); prints an
                       estimated narration length for target-duration tuning
                       --strict: verify every claim in the claims.md ledger
                       --release: strict + fail on remote deps, missing claims,
                       unsupported HTML, black frames, clipped audio (exit 1)
narova synth          Python TTS -> out/audio/*, out/timings.json
narova compose        -> out/hf/ + out/captions.srt|.vtt; prints per-scene start times
narova captions       (re)write out/captions.srt + out/captions.vtt from timings.json
narova shots          snapshot one QA frame per scene -> out/hf/snapshots/
narova build          synth + compose + render -> out/video.mp4
narova preview        compose + HyperFrames Studio; prints the exact URL
narova preview --detach   persistent Studio (PID/log); --stop ends it
narova voices         list or download voices
narova providers      add/list/remove/doctor explicitly registered external
                      TTS workers in ~/.narova/providers/
narova release        save/list/restore/remove named manifest snapshots
                      in ~/.narova/releases/
narova doctor         check ffmpeg, python, venv, hyperframes
```

Commands find the config by walking up from the current directory, so they
work from inside `out/` and `out/hf`. A detached Studio preview left running
is restarted automatically whenever `compose`/`build` replaces `out/hf`.

Flags: `--backend <built-in-or-registered-provider>`, `--reuse` (ignored automatically when the
spoken text changed since the last synth), `--tempo`, `--size`,
`--platform tiktok|reels|shorts|linkedin|x|youtube` (frame preset + duration-band
lint; `--size` wins), `--variant <id>` / `--variants` (hook-variant builds;
each variant renders `out/video-<id>.mp4`), `--deliverables` (multi-render
with per-platform export presets + ffmpeg post-processing + thumbnails;
renders the SAME composition at each preset's aspect ratio via scale+pad —
this does NOT re-art-direct layouts; for truly platform-specific compositions,
render separate projects at each aspect ratio), `--fps`, `--quality draft|standard|high`, `--at` (shots), `--out`, `--project`,
`--config`, `--voice-a`, `--voice-b`.

## Backends

- **piper** — default. Fast, small, no setup. Downloads a voice on first use.
- **xtts** — higher quality, slow. ~1.9GB model, 58 speakers.
  Setup: `tool/setup.sh --xtts`.
- **qwen** — Qwen3-TTS 0.6B, Apache 2.0. High quality, slow. ~1.2GB model,
  9 speakers, optional per-voice `lang`. Setup: `tool/setup.sh --qwen`.
  Change the model with `$NAROVA_QWEN_MODEL`.
- **chatterbox** — voice cloning. Set the voice's `speaker` to an ABSOLUTE
  path to a clean 10–20s recording. Slowest backend. Runs in its own venv
  (`~/.narova/venv-chatterbox`, override `$NAROVA_CHATTERBOX_VENV`) because
  its torch/transformers pins conflict with xtts/qwen. ~1GB model, optional
  per-voice `exaggeration` / `cfg_weight`. Setup: `tool/setup.sh --chatterbox`.
  Pinned to git master for Chatterbox Multilingual v3 (per-voice `lang`;
  outputs carry Resemble's PerTh watermark by default).

The backend interface is
`synthesize(who, text, out_path, lang=None) -> Path`.

Built-ins are resolved from one in-skill registry. Optional external backends
are never imported: the user explicitly registers a manifest under
`~/.narova/providers/`, then Narova spawns its command as an argument array
and speaks the versioned `narova-tts-provider/v1` JSON Lines protocol. External
workers produce one raw WAV utterance; Narova retains sentence caching, tempo,
gain, fades, resampling, loudness normalization, concatenation, alignment,
timing rescaling, captions, composition, and rendering. Provider-specific
code, credentials, dependencies, endpoints, models, and configuration rules
remain in self-contained companion skills such as `skills/narova-elevenlabs/`.

## Status: 0.12.0 shipped

Build works end to end. Lint and check pass on generated pages. Caption sync
verified in snapshots. The skill goes prompt → script → check → synth →
compose → preview → build. The tool and tests ship inside the skill.

Since 0.6.0: background bed + spot SFX mixing, forced word alignment (optional),
caption style presets + keyword emphasis, per-scene transitions, `data-mark`
annotations, `--platform` presets with duration-band lint, SRT/VTT caption
sidecars, hook-variant builds (`--variant`/`--variants`), `narova ingest <url>`,
Chatterbox v3 (git pin, per-voice `lang`).

Since 0.7.0: per-turn `lang` for multilingual TTS, voice sample management,
silent scenes, per-voice `gainDb`, b-roll as HyperFrames-native clips,
partial word alignment for mixed-language scenes, RTL captions, CSS
externalization, `captions.maxWords`, XTTS multilingual `lang` support,
version sync automation, platform qualification, and documentation remediation
across all surfaces.

Since 0.8.0: versioned manifest intermediate representation beneath the
friendly `reel.config.*` surface.

Since 0.8.1: comprehensive export profiles with per-platform render presets,
ffmpeg post-processing (loudness normalization, h264 encode, safe-area
guides, thumbnails), and `--deliverables` multi-render builds.

## Timeline intermediate representation

`narova compile` converts `reel.config.*` → `out/manifest.json`, a versioned
JSON document that captures every datum the pipeline needs in one self-contained
file. The timeline is also written automatically during `synth` and `build`,
and enriched with measured word timings after synthesis.

**Versioning:** `narova` (tool version) and `version` (schema `"1.0"`) keys
enable forward-compatible consumers to gate on schema changes.

**Schema (top-level keys):** `narova`, `version`, `project`, `format`, `theme`,
`chrome`, `voices`, `timing`, `audio`, `captions`, `align`, `assets`, `scenes`,
`variants`, `series`, `variant`, `environment`, `hashes`, `deliverables`.

- `project` — title, creation timestamp, platform target.
- `format` — width, height, fps, sampleRate, colorSpace.
- `voices` — every voice with label, color, backend, speaker, gainDb, lang,
  instruct, exaggeration, cfg_weight.
- `scenes` — id, index, start/duration (filled post-synth), transition, vo
  turns (who, text, lang, start, words), body HTML, clip, dur (silent scenes),
  per-scene sfx anchors.
- `variants` — hook variant ids with their full scene definitions (body, vo,
  transition).
- `assets` — all file dependencies discovered from `assetsDir/`, bed, sfx,
  and b-roll clips.
- `deliverables` — render presets: at least a `default` entry plus one per
  platform when `platform` is set. Entries carry width, height, fps, codec,
  bitrate, sampleRate.
- `stages.synth` — ISO timestamp set after synthesis completes.
- `environment` — narova version, TTS backend, and compile timestamp.
- `hashes` — SHA-256 content hashes for config, theme CSS, assets/ tree,
  and bed/sfx/clip source files.

**Consumers:** `validate(manifest)` checks schema compliance; `mergeTimings()`
merges `out/timings.json` word-level data into the scene tree; `narova plan`
compares manifests to classify changes; future tooling reads the manifest as
the canonical project snapshot.

## Future work (decided, not started)

- `--eject`: make out/hf a standalone project you can edit in Studio.
- Theme gallery: ready-made looks, picked by name.
- Qwen voice cloning (`speaker: {clone: "sample.wav"}`).
- Bundle GSAP into out/hf so rendering works fully offline.
- Publish to npm.
