# Writing the scene script (`reel.config.mjs`)

A project is a directory with a `reel.config.mjs` (also accepted: `.js`, `.json`,
`.cjs`) exporting one object. Full authority: `SPEC.md` in the narova repo;
`examples/venture-factory/` is a complete 14-scene script.

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
      vo: [                                                    // the dialogue that is SPOKEN
        { who: "b", text: "Okay. What if your codebase could just build itself?" },
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

## Rules the pipeline enforces (violations fail `narova check`)

- `voices` needs at least one entry; every `vo[].who` must name a declared voice.
- `scenes` non-empty; every scene needs a unique `id`, a `body` HTML string, and
  a non-empty `vo` where each turn has `who` and non-empty `text`.
- `theme.css`, if set, must exist (relative to the config file).
- Legacy fields `caption` and `dur` are accepted and **ignored** — do not write
  them. Scene length always comes from the measured audio.

## Semantics that matter

- **Reveals**: `body` elements with `class="cue" data-cue="k"` pop in when the
  voice reaches turn index `k` (**0-based** into that scene's `vo`). Elements
  with `class="reveal"` (no cue) animate in on scene entry. A cue that doesn't
  resolve to a turn reveals at scene entry — `narova check` warns.
- **Two hosts**: two voices trading lines — questions, banter, handoffs — read
  far better than one narrator. Give each a distinct `color`; the active
  caption word is tinted by speaker.
- **Voices**: piper wants two distinct ONNX voices (e.g. `en_US-ryan-high` /
  `en_US-hfc_female-medium`); xtts wants two of its 58 studio speakers (e.g.
  `Damien Black` / `Sofia Hellen`); qwen wants two of its 9 presets (e.g.
  `Ryan` / `Serena`). `narova voices list --backend <b>` enumerates them.
- **Styling**: the base theme (background, chrome, karaoke captions, scene
  classes like `.s-title`, `.display`, `.lede`, `.pane`, `.owners`) is
  provided. Add your own classes via `theme.css`, tune tokens via `theme`.
  Keep bodies plain HTML — no scripts, no external resources.
- **Determinism**: no `animation: … infinite`, no hover effects, no
  transition-driven state in `theme.css` — HyperFrames renders by seeking
  frames. Static styles are fine; motion belongs to `reveal`/`data-cue`.
- **Ids**: element ids in bodies must be unique across ALL scenes (they are
  assembled into one page). `check` warns on duplicates.

## Theme from intent (build it on the fly)

The user never provides "theme things". You derive the look from the prompt
and build it yourself. Rules, in priority order:

1. **Respect what the user gave, verbatim.** A hex code, a brand name, a logo
   color, "dark", "warm", "playful" — whatever fragment appears in the prompt
   is law. Never override it, never ask for CSS.
2. **Derive the rest.** Available tokens: `bg, stage, panel, line, ink, muted,
   faint, accent, accent-dim, pink, gold, green, red, amber`. Typical mapping:
   brand/main color → `accent` (+ a darker `accent-dim`); mood → `bg`/`stage`
   (dark default; lighten for "clean/minimal"); secondary brand colors →
   `pink`/`gold` slots (they're just extra accents).
3. **Escalate to `theme.css` only when tokens can't express it** (gradients,
   custom scene layouts, a display font). Keep it small; no `animation: …
   infinite`, no hover state (the renderer seeks frames).
4. **Nothing given → use the base look as-is.** It ships built-in; `theme` is
   optional.

Give each host a `color` that fits the palette — the active caption word is
tinted by speaker.

## Drafting from a prompt (the agent's job)

- 5–10 scenes for a 60–90 second video; one idea per scene.
- Prefer `var(--muted)` over `var(--faint)` for readable text — faint text
  trips `npx hyperframes check`'s WCAG contrast warnings.
- Keep turns short: 1–2 sentences each. Alternate speakers; let one ask, the
  other answer.
- Put `data-cue` on the visual that illustrates each key turn, so the screen
  reacts as the point is spoken.
- Words on screen should be FEWER than words spoken — the karaoke captions
  already show the transcript word-by-word.
