# Writing the scene script (`reel.config.mjs`)

A project is a folder with one config file: `reel.config.mjs` (also accepted:
`.js`, `.json`, `.cjs`). It exports one object. Full contract: `SPEC.md` in
the repo. Full example: `examples/venture-factory/` (14 scenes).

```js
export default {
  title: "The Venture Factory",
  size: "16:9",                     // "16:9" (1280x720) | "1:1" (1080x1080) | "9:16" (720x1280) | {w,h}
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#2ee6d6", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "host · B" },
  },
  theme: {
    accent: "#2ee6d6", bg: "#080d16",   // color tokens (optional)
    css: "theme.css",                    // extra CSS file (optional, path relative to config)
  },
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: 1.12 },
  scenes: [
    {
      id: "title",                       // unique, [A-Za-z][A-Za-z0-9_-]*
      vo: [                              // what is SPOKEN, in order
        { who: "b", text: "What if your codebase could build itself?" },
        { who: "a", text: "That's the Venture Factory. Let me show you." },
      ],
      body: `<div class="s-title">
        <h1 class="display reveal">The Venture Factory</h1>
        <p class="lede cue" data-cue="1">builds itself — safely.</p>
      </div>`,
    },
  ],
}
```

## What `check` enforces (errors)

- At least one voice. Every `vo[].who` must be a declared voice.
- At least one scene. Every scene needs a unique `id`, a `body` string, and
  a non-empty `vo` with `who` + `text` in every turn.
- Scene and voice ids: letters, digits, `_`, `-`. Must start with a letter.
- If `theme.css` is set, the file must exist.
- Old fields `caption` and `dur` are ignored. Do not write them.

## How the pieces behave

- **Cues**: `class="cue" data-cue="k"` appears when turn `k` starts.
  `k` counts from 0. A cue that does not match a turn appears at scene start —
  `check` warns.
- **Reveals**: `class="reveal"` (no cue) animates in at scene start.
- **Two hosts**: voices trading lines — question, answer, handoff — sound much
  better than one narrator. Give each a different `color`; the active caption
  word takes that color.
- **Voices**: piper uses ONNX voice names (`en_US-ryan-high`). xtts has 58
  named speakers (`Damien Black`). qwen has 9 (`Ryan`, `Serena`).
  List them: `$NAROVA voices list --backend <name>`.
- **Styling**: the base look ships built in (background, top bar, captions,
  progress bar) plus a menu of scene-layout classes (below). Add your own
  classes in `theme.css`. Bodies are plain HTML — no scripts, no external
  files.

## Built-in scene layouts

Don't center a title on every scene — that is the template look. Mix these
(videography judgment: `references/prompt-to-video.md` §Videography):

- **Title/closing**: `.s-title` + `.display` + `.lede`; `.s-close` +
  `.close-line` + `.close-tags` + `.close-sign`.
- **Cards / split**: `.s-two` grid of `.pane` (`.pane.center` centers
  inside); `.owners` (3-up people/roles); `.planes` (3-up named cards with
  `.pname`/`.pdesc`/`.pnever`).
- **Big number**: `.stat` (+`.pct`) with `.stat-cap` — a single damning or
  delightful metric filling the screen.
- **Quote**: `.s-center` + `.bigquote` + `.small` attribution.
- **Process**: `.stepper` (`.step` + `.sep`); `.flow` of `.lane` connected
  by `.conn` (`.carr` arrow, `.clab` label); `.stack` of `.layer`
  (`.ly-id`/`.ly-nm`/`.ly-do`).
- **Verdicts**: `.verdicts` grid of `.verdict.green|red|amber` with
  `.vname`/`.vact`.
- **Lists**: `.flags` (warning bullets); `.ledger` of `.rec`.
- **Tuning/comparison**: `.dials` of `.dial` (`.dscale span.on` marks the
  setting); `.homes` two-way compare with `.authority` between.
- **Furniture**: `.eyebrow`, `.s-head`, `.s-foot` (`.ok`/`.warn`),
  `.hairline`, `.grad` (gradient text), `.accent`, `.loop-chip`, `.badge`,
  `.referee` (seal + `.rnotes`), `.desk` (`.ask` rows + `.wait` pills).

All sizes scale with `vw`, so the same classes work in 16:9, 1:1, and 9:16.
- **Determinism**: no `animation: ... infinite`, no hover effects, no
  transitions-as-state in `theme.css`. The renderer jumps between frames.
  Static styles are fine. Motion comes from `reveal` and `data-cue`.
- **Ids**: element ids in bodies must be unique across all scenes.

## Theme: build it from the prompt

The user never writes CSS. You build the look from what they say. In order:

1. **Keep what the user gave.** A hex code, a brand name, "dark", "warm",
   "playful" — whatever appears in the prompt stays. Never ask for CSS.
2. **Fill in the rest.** Tokens: `bg, stage, panel, line, ink, muted, faint,
   accent, accent-dim, pink, gold, green, red, amber`. Typical mapping:
   main/brand color → `accent`; mood → `bg` and `stage` (dark by default);
   extra brand colors → the `pink` / `gold` slots.
3. **Use `theme.css` only when tokens are not enough** (gradients, custom
   layouts, a special font). Keep it small.
4. **Nothing given → use the base look.** `theme` is optional.

Give each host a `color` that fits the palette.

## Writing scenes from a prompt

- 5–10 scenes for a 60–90 second video. One idea per scene.
- Short turns: 1–2 sentences. Alternate the speakers.
- Put `data-cue` on the visual that matches each key turn, so the screen
  reacts while the point is spoken.
- Fewer words on screen than words spoken — the captions already show the
  transcript word by word.
- Use `var(--muted)` for small text, not `var(--faint)` — faint text fails
  the contrast check.
