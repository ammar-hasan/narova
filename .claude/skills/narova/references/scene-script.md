# Writing the scene script (`reel.config.mjs`)

A project is a directory with a `reel.config.mjs` (also accepted: `.js`, `.json`,
`.cjs`) exporting one object. Full authority: `SPEC.md` and `README.md` in the
narova repo; `examples/venture-factory/` is a complete, runnable 14-scene script.

```js
export default {
  title: "The Venture Factory",
  size: "16:9",                     // "16:9" (1280x720) | "1:1" (1080x1080) | "9:16" (720x1280) | {w,h}
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#2ee6d6", label: "narrator · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "narrator · B" },
  },
  theme: {
    accent: "#2ee6d6", bg: "#080d16",   // token overrides (optional)
    css: "theme.css",                    // optional file with scene-layout classes, path relative to config
  },
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: 1.18 },
  scenes: [
    {
      id: "title",                                             // unique per scene
      caption: "A codebase that improves itself — safely.",    // short line shown ON SCREEN
      vo: [                                                    // the dialogue that is SPOKEN
        { who: "b", text: "Okay. What if your codebase could just build itself?" },
        { who: "a", text: "That's the Venture Factory. Let me show you." },
      ],
      body: `<div class="s-title">
        <h1 class="display reveal">The Venture Factory</h1>
        <p class="lede cue" data-cue="1">builds itself — safely.</p>
      </div>`,
      dur: 12,                                                 // fallback seconds if audio absent (optional)
    },
  ],
}
```

## Rules the renderer enforces (violations fail `narova check`)

- `voices` needs at least one entry; every `vo[].who` must name a declared voice.
- `scenes` non-empty; every scene needs a unique `id`, a `body` HTML string, and
  a non-empty `vo` where each turn has `who` and non-empty `text`.
- `theme.css`, if set, must exist (relative to the config file).

## Semantics that matter

- **`caption` vs `vo`**: `caption` is the short on-screen line; `vo` is what is
  actually spoken and what the karaoke captions render word-by-word. They are
  different on purpose — never mirror the transcript into `caption`.
- **Reveals**: `body` elements with `class="cue" data-cue="k"` pop in when the
  voice reaches turn index `k` (**0-based** into that scene's `vo`). Elements
  with `class="reveal"` (no cue) animate in on scene entry. A cue that doesn't
  resolve to a turn reveals at scene entry — `narova check` warns about these.
- **Two hosts**: two voices trading lines — questions, banter, handoffs — read
  far better than one narrator. Give each a distinct `color`; the active
  caption word is tinted by speaker.
- **Voices**: piper wants two distinct ONNX voices (e.g. `en_US-ryan-high` /
  `en_US-hfc_female-medium`); xtts wants two of its 58 studio speakers (e.g.
  `Damien Black` / `Sofia Hellen`). `narova voices list` enumerates them.
- **Styling**: base theme (player chrome, captions, reveal mechanics) is
  provided. Add scene-layout classes via `theme.css` and tune tokens via
  `theme`. Keep bodies plain HTML — no scripts, no external resources; the
  player must stay self-contained.
- **`dur`** is only a fallback for the audio-less preview; once synthesized,
  real audio duration drives everything. Omit it unless you care about the
  silent preview's pacing.
