# narova

> Working name — the final package name is still being chosen.

**You write a scene script. narova turns it into a narrated video with word-synced captions.**

You get two things from one script:

1. An interactive HTML player. One self-contained file. Captions highlight word by word.
2. An MP4 video. It looks exactly like the player, frame for frame.

Both have a neural voiceover with two hosts talking to each other.
Everything runs on your machine. No API keys. No cloud.

Think of it like Remotion, with two differences: the narration and word-synced
captions are automatic, and you write scenes as plain HTML + data instead of React.

## Quickstart (60 seconds)

```bash
git clone https://github.com/ammar-hasan/narova.git && cd narova
npm install                      # Node CLI
scripts/setup.sh                 # Python venv for TTS (add --xtts for higher-quality voices)
narova doctor                    # checks ffmpeg, Chrome, venv, voices

cd examples/venture-factory
narova build                     # makes out/video.mp4 + out/player.html
narova serve                     # opens a local server with the player and the mp4
```

You need **ffmpeg** and **Google Chrome** installed. `scripts/setup.sh` checks
both and tells you how to get them. The first `build` downloads a voice model.
With xtts, it downloads a ~1.9GB model once.

## The scene script

A project is a folder with a `reel.config.mjs` (or `.js` / `.json`).
It exports `title`, `size`, `voices`, `theme`, `timing`, and `scenes`.

```js
export default {
  title: "The Venture Factory",
  size: { w: 1280, h: 720 },                 // 16:9 default; 1:1 and 9:16 also work
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
      vo: [                                                    // the dialogue that is SPOKEN
        { who: "b", text: "Okay. What if your codebase could just build itself?" },
        { who: "a", text: "That's the Venture Factory. Let me show you." },
      ],
      body: `<div class="s-title">
        <h1 class="display reveal">The Venture Factory</h1>
        <p class="lede cue" data-cue="1">builds itself — safely.</p>
      </div>`,                                                 // HTML; data-cue="1" shows when turn 1 starts (0-based)
      dur: 12,                                                 // fallback length if there is no audio
    },
    // ...more scenes
  ],
}
```

The rules:

- `vo` is a list of `{ who, text }` turns, in order. Two hosts (`a`, `b`) trading
  lines sound better than one narrator. One narrator also works: use one `who`.
- `caption` and `vo` are different on purpose. `caption` is the short line on
  screen. `vo` is the full spoken text. Big word-synced captions read better
  than a full transcript on screen.
- `body` is HTML. An element with `data-cue="k"` stays hidden until the voice
  reaches turn `k`. The index is **0-based**: `data-cue="0"` means the first turn.
  Elements without a cue show when the scene starts.
- The base theme (tokens, player, captions, reveals) is built in. Add your own
  scene styles with `theme` tokens or a CSS file
  (see `examples/venture-factory/theme.css`).

See `examples/venture-factory/` for a full 14-scene script you can build.

## Voices (TTS backends)

Speech runs in a small Python package inside a managed venv.
Pick a backend per voice (`voices.a.backend`) or for all voices with `--backend`.

| Backend | Quality | Speed | Setup | Notes |
|---------|---------|-------|-------|-------|
| `piper` | good | fast | default | local ONNX; zero config; downloads a voice on first use |
| `xtts`  | higher | slower | `scripts/setup.sh --xtts` | coqui-tts on MPS/CPU; ~1.9GB model; 58 studio speakers |

**Picking voices.** Use two clearly different voices.
For piper: `en_US-ryan-high` (a) and `en_US-hfc_female-medium` (b).
For xtts: pick two of the 58 studio speakers, e.g. `Damien Black` and `Sofia Hellen`.
Set them in `voices`, or override with `--voice-a` / `--voice-b`.
Give each host a `color` — the active caption word gets that color.

## CLI

```
narova init <dir>     start a new project (config + one scene + theme)
narova check          validate the config fast — no TTS, no Chrome, no writes
narova render         scenes -> out/player.html, out/record.html, out/narration.json
narova synth          narration.json -> out/audio/*, out/timings.json   (Python TTS)
narova build          full pipeline -> out/video.mp4 + out/player.html
narova preview|serve  local server for out/ (player + mp4 + landing page)
narova voices         list or download TTS voices
narova doctor         check ffmpeg, Chrome, python venv, voices
```

Common flags: `--backend piper|xtts`, `--reuse` (keep existing audio + timings),
`--workers N` (capture parallelism), `--tempo`, `--size 9:16|1:1|16:9`, `--out <dir>`.

## Agent skill

The repo ships a Claude Code skill (`.claude/skills/narova/`). It teaches AI
agents when to use narova (narration-first video: word-synced captions,
two-host voiceover, script-to-video) and how to drive the CLI. `narova check`
exists for that loop: agents can validate a config in under a second.

Inside this repo, Claude Code finds the skill by itself. To use it anywhere:

```bash
scripts/install-skill.sh                   # global: symlink into ~/.claude/skills + npm link the CLI
scripts/install-skill.sh --project <dir>   # per project: copy into <dir>/.claude/skills
                                           # (commit it — teammates get the skill too)
```

`--copy` / `--link` override the default mode. After a `git pull`, re-run the
installer to refresh a copied skill (a symlinked one updates by itself).

## How it works

```
scene script (reel.config)
      │
      ▼
  render      scenes -> player.html + record.html + narration.json           (Node)
      │
      ▼
  synth       narration.json -> per-scene wav + timings.json                 (Python TTS)
      │        speech is made sentence by sentence; word timings are
      │        rescaled so they match the real audio length exactly
      ▼
  capture     headless Chrome takes one screenshot per word onset            (Node + Chrome)
      │        each frame = the real player frozen at time T (?t=SECONDS)
      ▼
  assemble    ffmpeg holds each frame until the next word, adds the audio    (Node + ffmpeg)
      │
      ▼
  out/video.mp4  (same pixels as the player)  +  out/player.html
```

The MP4 is captured from the real player. What you scrub in the browser is
exactly what renders. Captions never drift, because word timestamps are
rescaled to the final audio length.

## Learnings

The pipeline encodes many hard-won fixes: caption drift after loudness
normalization, Chrome capture hangs, XTTS on a modern stack, HTTP Range for
seeking, and more. Read [LEARNINGS.md](./LEARNINGS.md) before changing the
pipeline. The contract lives in [SPEC.md](./SPEC.md).

## License

MIT — see [LICENSE](./LICENSE).
