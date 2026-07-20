# narova

> Working name — the final package name is still being chosen.

**A scene script becomes a narrated, captioned, kinetic explainer video.**

narova turns a declarative scene script into two things: an interactive, self-contained HTML
player with word-synced captions and reactive reveals, and a rendered MP4 that is pixel-identical
to that player. Both carry a two-host neural voiceover. Think "Remotion, but the narration and
word-synced captions are first-class and automatic, and you write scenes as plain HTML + data
instead of React." The point of the tool is automatic word-level caption sync to generated
speech, plus visuals that react to the voiceover.

## 60-second quickstart

```bash
git clone <repo-url> narova && cd narova
npm install                      # Node CLI + deps
scripts/setup.sh                 # Python venv for TTS (add --xtts for the higher-quality backend)
narova doctor                   # check ffmpeg, Chrome, venv, voices

cd examples/venture-factory
narova build                    # render + synth + capture + assemble -> out/video.mp4 + out/player.html
narova serve                    # range-capable server: player, mp4, landing page
```

You need **ffmpeg** and **Google Chrome** installed (`scripts/setup.sh` checks and tells you how).
The first `build` downloads a voice model; xtts also downloads a ~1.9GB model, once.

## The scene script

A project is a directory with a `reel.config.mjs` (or `.js` / `.json`) that exports
`title`, `size`, `voices`, `theme`, `timing`, and `scenes`.

```js
export default {
  title: "The Venture Factory",
  size: { w: 1280, h: 720 },                 // 16:9 default; 1:1 and 9:16 supported
  voices: {
    a: { backend: "xtts", speaker: "Damien Black", color: "#2ee6d6", label: "narrator · A" },
    b: { backend: "xtts", speaker: "Sofia Hellen", color: "#ff7eb6", label: "narrator · B" },
  },
  theme: { accent: "#2ee6d6", bg: "#080d16" },
  timing: { gapSentence: 0.28, gapTurn: 0.5, lead: 0.16, tail: 0.6, tempo: 1.18 },
  scenes: [
    {
      id: "title",
      caption: "A codebase that improves itself — safely.",   // short line shown ON SCREEN
      vo: [                                                    // the two-host dialogue that's SPOKEN
        { who: "b", text: "Okay. What if your codebase could just build itself?" },
        { who: "a", text: "That's the Venture Factory. Let me show you." },
      ],
      body: `<div class="s-title">
        <h1 class="display reveal">The Venture Factory</h1>
        <p class="lede cue" data-cue="1">builds itself — safely.</p>
      </div>`,                                                 // HTML; data-cue="k" reveals on turn index k (0-based)
      dur: 12,                                                 // fallback duration if audio is absent
    },
    // ...more scenes
  ],
}
```

Rules the renderer enforces:

- `vo` is an ordered list of `{ who, text }` turns. Two hosts (`a`, `b`) trading lines read
  better than one narrator; a single narrator is just one `who`.
- `caption` is what shows on screen; `vo` is what's spoken. They are different on purpose —
  big word-synced captions beat putting the full transcript on screen.
- `body` is HTML. An element with `data-cue="k"` reveals when the voice reaches the turn
  with index `k` — a **0-based** index into that scene's `vo` (`data-cue="0"` = first turn).
  Un-cued elements reveal on scene entry.
- The base theme (tokens + player/caption/reveal mechanics) is provided; add scene-specific
  styles via `theme` tokens or a referenced CSS file (see `examples/venture-factory/theme.css`).

See `examples/venture-factory/` for a complete, runnable 14-scene script.

## TTS backends

Voice synthesis runs in a small Python package behind a managed venv. Pick a backend per voice
(`voices.a.backend`) or globally with `--backend`.

| Backend | Quality | Speed | Setup | Notes |
|---------|---------|-------|-------|-------|
| `piper` | good | fast | default | local ONNX; zero-config; downloads a voice on first use |
| `xtts`  | higher | slower | `scripts/setup.sh --xtts` | coqui-tts on MPS/CPU; ~1.9GB model; 58 studio speakers |

**Picking voices.** For piper use two distinct ONNX voices, e.g. `en_US-ryan-high` (a) and
`en_US-hfc_female-medium` (b). For xtts pick two of the 58 studio speakers, e.g. `Damien Black`
(a) and `Sofia Hellen` (b). Set them per host in `voices`, or override at the CLI with
`--voice-a` / `--voice-b`. Give each host a `color` so the active caption word is tinted by speaker.

## CLI

```
narova init <dir>     scaffold a project (config + one scene + theme)
narova check          validate config fast — no TTS, no Chrome, no writes
narova render         scenes -> out/player.html, out/record.html, out/narration.json
narova synth          narration.json -> out/audio/*, out/timings.json   (Python TTS)
narova build          full pipeline -> out/video.mp4 + out/player.html
narova preview|serve  range server for out/ (player + mp4 + landing page)
narova voices         list | get (download) TTS voices
narova doctor         check ffmpeg, chrome, python venv, voices, ffprobe range
```

Common flags: `--backend piper|xtts`, `--reuse` (skip synth, reuse audio+timings),
`--workers N` (capture parallelism), `--tempo`, `--size 9:16|1:1|16:9`, `--out <dir>`.

## Agent skill

The repo ships a Claude Code skill (`.claude/skills/narova/`) that teaches AI agents when to
reach for narova (narration-first video: word-synced captions, two-host voiceover,
script-to-video) and how to drive the CLI — including `narova check`, a fast config validator
built for that loop. Working inside this repo, Claude Code discovers it automatically. To use
narova from anywhere:

```bash
scripts/install-skill.sh                   # global: symlink into ~/.claude/skills + npm link the CLI
scripts/install-skill.sh --project <dir>   # selective: copy into <dir>/.claude/skills (committable —
                                           # teammates get the skill when they clone the project)
```

`--copy` / `--link` override the default mode (global installs symlink, project installs copy;
re-run the installer after updating the repo to refresh a copy).

## How it works

```
scene script (reel.config)
      │
      ▼
  render      scenes -> player.html + record.html + narration.json          (Node)
      │
      ▼
  synth       narration.json -> per-scene wav + timings.json                 (Python TTS)
      │        neural speech, sentence-by-sentence, word timing derived by
      │        word length, then rescaled so timings == real audio duration
      ▼
  capture     headless Chrome screenshots one keyframe per word onset,       (Node + Chrome)
      │        each frame = the real player at "still time T" (?t=SECONDS)
      ▼
  assemble    ffmpeg holds each frame for next_onset − onset, muxes audio    (Node + ffmpeg)
      │
      ▼
  out/video.mp4  (pixel-identical to the player)  +  out/player.html
```

The MP4 is captured from the actual player, so what you scrub in the browser is exactly what
renders. Captions stay locked to the voice because word/turn timestamps are rescaled to the
real post-processing audio duration.

## Learnings

The pipeline encodes a set of hard-won fixes (caption drift after loudnorm, Chrome capture
hangs, XTTS on a modern stack, HTTP Range for seeking, and more). Read
[LEARNINGS.md](./LEARNINGS.md) before changing the pipeline. The contract lives in
[SPEC.md](./SPEC.md).

## License

MIT — see [LICENSE](./LICENSE).
