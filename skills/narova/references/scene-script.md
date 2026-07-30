# Writing the scene script (`reel.config.mjs`)

A project is a folder with one config file: `reel.config.mjs` (also accepted:
`.js`, `.json`, `.cjs`). It exports one object. Full contract: `SPEC.md` in
the repo. Full example: `generated/us-iran-standoff/` (11 scenes;
`generated/narova-skill-reel/` is the flagship demo).

```js
export default {
  title: "The Venture Factory",
  size: "16:9",                     // "16:9" (1280x720) | "1:1" (1080x1080) | "9:16" (720x1280) | {w,h}
  assets: "assets",                 // optional project-local dir; copied to out/hf/assets/
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#2ee6d6", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "host · B" },
  },
  theme: {
    mode: "light",                         // "dark" (default) | "light" — flips the base palette
    accent: "#2ee6d6", bg: "#080d16",   // color tokens (optional)
    css: "theme.css",                    // extra CSS file (optional, path relative to config)
  },
  chrome: { topbar: true, counter: true, progress: true },  // or false to strip all page furniture
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: 1.12 },
  platform: "tiktok",                // optional: tiktok|reels|shorts|linkedin|x|youtube — picks the frame size
                                     // (when size is unset) and a target duration band for `check`
  captions: {
    preset: "karaoke",               // karaoke (default) | slam | pop | rise — the caption word style
    emphasis: ["factory"],           // words to auto-highlight wherever they are spoken
  },
  scenes: [
    {
      id: "title",                       // unique, [A-Za-z][A-Za-z0-9_-]*
      transition: "wipe",                // optional: fade (default) | wipe | slide | zoom
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
- At least one scene. Every scene needs a unique `id` and a `body` string.
  - `vo` is normally a non-empty list of `{ who, text }` turns.
  - Each turn may optionally set `lang` (a language code string, e.g. `"ur"`)
    for per-turn language override.
  - Each turn may optionally set `synthesisText` — when present and the voice
    uses an external provider, this text is sent to TTS (allowing performance
    tags like `[whispering]`) while `text` remains the clean caption source.
    Local backends ignore `synthesisText`.
  - **Silent scenes**: `vo: []` with an explicit positive `dur` (e.g. `dur: 2`
    for a 2-second reference screen). The synth stage generates silence.
- Per-voice `gainDb` (-24 to +24): trim a quieter voice (e.g. Arabic) up
  against louder ones after loudnorm. Included in the sentence cache identity.
- Per-scene `clip`: a project-relative video file played as a full-bleed
  background behind the HTML overlay (looped, dimmed to 52%, seek-safe).
- Per-scene `walkthrough`: a declared product capture id, or
  `{ id, layout, fit, opacity, position }`. It cannot be combined with
  `clip`. See [product-walkthroughs.md](product-walkthroughs.md) for semantic
  actions, narration anchors, authentication, capture, and stale-media rules.
- If `theme.css` is set, the file must exist.
- Old fields `caption` and `dur` are ignored. Do not write them.

## How the pieces behave

- **Cues**: `class="cue" data-cue="k"` appears when turn `k` starts.
  `k` counts from 0. A cue that does not match a turn appears at scene start —
  `check` warns.
- **Reveals**: `class="reveal"` (no cue) animates in at scene start.
- **Photo motion**: `data-drift="in|out|left|right|up|pano"` on a media
  element (an `<img>` inside an overflow-hidden pane, or a full-bleed
  background div) gives it a slow Ken Burns move spanning the whole scene:
  push-in, pull-back, wide lateral pan, tilt-up sweep. `pano` sweeps
  `background-position` across an ultra-wide panorama image edge to edge.
  Never combine `data-drift` with `.reveal`/`.cue` on the SAME element —
  those tween transform channels of their own; put the cue on a wrapper.
- **Transitions**: set `transition` on a scene — `fade` (default; dips up from
  dark over its first 0.7 s), `wipe` (clip-path sweep in from the right),
  `slide` (slides in from the right with a fade), `zoom` (settles from 1.08×
  with a fade). Every scene after the first transitions in automatically; the
  first scene enters clean. An unknown value falls back to `fade` — `check`
  warns and names the valid set.
- **Caption presets**: `captions.preset` restyles the word-by-word captions.
  `karaoke` (default) flips each active word to the speaker's color. `slam`
  lands the active word big and heavy, settling back once spoken. `pop` dims
  upcoming words further and pops the active word up into place. `rise` lifts
  the active word with an underline in the speaker's color. All presets are
  seek-safe (class flips plus short timeline tweens — no CSS transitions).
- **Emphasis keywords**: `captions.emphasis` lists words that get a standing
  accent underline and slight size bump wherever they appear in the captions —
  product names, the one number that matters. Matching is case-insensitive and
  ignores surrounding punctuation (`"Factory."` matches `factory`), and it
  composes with every preset.
- **Platform targets**: `platform: "tiktok" | "reels" | "shorts" | "linkedin" | "x"`
  picks the frame size when `size` is unset and gives `check` a target
  duration band — it warns when the estimated narration falls outside it
  (`x` only warns above 140 s). A warning, never an error.
- **Two hosts**: voices trading lines — question, answer, handoff — sound much
  better than one narrator. Give each a different `color`; the active caption
  word takes that color.
- **Voices**: piper uses ONNX voice names (`en_US-ryan-high`). xtts has 58
  named speakers (`Damien Black`). qwen has 9 (`Ryan`, `Serena`).
  Voice cloning (xtts): `speaker` may instead be an ABSOLUTE path to a short
  clean recording (wav/mp3/flac/m4a, ~15–30 s) — the voice is cloned from
  it; re-record under a NEW filename (the cache keys on the path), and clone
  only a voice whose owner has consented. Delivery direction (qwen): an
  optional per-voice `instruct` string directs the performance (e.g.
  `instruct: "warm, energetic travel vlogger, never flat"`); changing it
  re-synthesizes that voice's lines.
  List them: `narova voices list --backend piper` shows a spread of starter
  voices (male/female, US/UK); `narova voices get <name> --backend piper`
  downloads any voice from the piper catalog
  (github.com/rhasspy/piper/blob/master/VOICES.md) — you are not limited to
  the listed ones.
- **Optional external TTS**: an explicitly registered provider name is also a
  valid `backend`. Set its service voice ID in `speaker` and put only
  JSON-compatible, non-secret synthesis settings in `providerOptions`.
  Provider credentials stay in environment variables. Install, register, and
  configure it from its companion skill; Narova remains local-first.
- **Styling**: the base look ships built in (background, top bar, captions,
  progress bar) plus a menu of scene-layout classes (below). Add your own
  classes in `theme.css`. Bodies are plain HTML with no scripts. Inline SVG,
  small `data:` URIs, and files from project `assets/` are supported; remote
  render-time files are not.

## Motion

All motion lives on the render timeline (a paused GSAP timeline the renderer
seeks through) — never wall-clock CSS. The vocabulary:

- `class="reveal"` — fade + small slide-up at scene entry. Elements without
  `data-cue` stagger in DOM order, 0.1s apart.
- `class="cue" data-cue="k"` — fade + slide + scale when turn `k` starts.
- `data-delay="0.3"` — seconds added to either trigger, for ordering within a
  turn or a tighter/looser stagger.
- `data-grow` — the element scales horizontally 0→full (transform origin left)
  at its trigger. Author the bar at full width; combine with `data-cue` to
  grow on a spoken beat.
- `data-draw` — an SVG `path`/`line`/`polyline`/`circle` draws itself
  (stroke-dash walk) at its trigger. Put it on the path element itself.
- `data-count="42"` — the element's text counts 0→42 over ~0.9s as stepped
  timeline sets (seek-safe). Optional `data-count-suffix="%"`; one decimal is
  kept when the target has one (`data-count="4.5"`). Pair with
  `class="cue" data-cue="k"` so the element is hidden until the count starts.
- `data-mark="underline|circle|box|highlight"` — a rough hand-drawn
  annotation drawn around/under the element at its trigger (same
  `data-cue`/`data-delay` timing as every other animator). `underline`,
  `circle`, and `box` sketch two slightly offset strokes that self-draw like
  `data-draw`; `highlight` sweeps a semi-transparent accent wash in from the
  left, behind the text, like a marker. The stroke color is the theme
  `accent`. Unknown kinds are ignored — `check` warns.

Example — underline the verdict when the host delivers it:

```html
<p class="vname cue" data-cue="2" data-mark="underline">Ship it.</p>
```

Example — a stat that counts up when the host says the number:

```html
<div class="stat cue" data-cue="2" data-count="21" data-count-suffix="%">0%</div>
```

SVG notes:

- **Reveals on transformed SVG groups are safe.** `class="reveal"` on a
  `<g transform="translate(x,y)">` used to teleport the group to the origin
  (GSAP's transform replaces the attribute). The runtime now detects this and
  tweens an auto-created wrapper `<g>` instead — write the natural markup.
- **Ids can repeat across scenes.** Compose namespaces each body's ids to
  `<sceneId>--<id>` and rewrites the body's own `url(#…)`, `href="#…"`,
  `for="…"`, and `aria-labelledby/describedby` references, so one inline SVG
  with gradient/filter `<defs>` can be pasted into every scene. Keep ids
  unique within a single scene, and style with classes — a `#id` selector in
  `theme.css` will not match after namespacing (`check` warns).

## Layout: the safe area

- Scenes center content in a fixed frame with a topbar above and the caption
  band overlaid at the bottom. The canvas reserves the caption band's height,
  but nothing auto-fits: **cap the height of tall visuals** (maps, big SVGs)
  yourself — a full-bleed map can still reach the topbar. `narova shots` +
  eyeballs is the verification step.
- The content column defaults to 1000px wide. Wide infographics and maps can
  widen it with a theme token: `theme: { colw: "1180px" }`.
- Box-based overlap lint misses glyphs that paint outside their box (big
  display type, map markers). Trust snapshot frames, not `0 layout issues`.
- HyperFrames contrast lint may flag decorative glyphs (flag emblems, icons)
  as if they were text. Those are warnings, not errors — judge by eye.

## Images, logos, and fonts

Put durable visual source beside the config in `assets/` (or set top-level
`assets: "another-local-dir"`). `compose` copies the directory contents into
`out/hf/assets/`, so source and generated paths match:

```html
<img class="brand-logo reveal" src="assets/logo.svg" alt="">
<div class="hero cue" data-cue="1"></div>
```

```css
@font-face{font-family:"Brand Serif";src:url("assets/fonts/brand.woff2") format("woff2")}
.hero{background-image:url("assets/hero.webp")}
```

Prefer an inline SVG for simple marks and local files for photos or fonts.
Use a `data:` URI only for a genuinely small asset. Do not base64-pack large
images or fonts into `theme.css`; it makes the source hard to inspect and
diff. Do not use `http(s)` URLs: `check` warns and offline renders can fail.
When bundling a brand font, list only that family plus generic fallbacks such
as `serif` or `sans-serif`; named fallbacks such as Georgia or Times New Roman
can make HyperFrames fetch additional font families.

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
- **Oversized type overflows its box.** Big `vw` display fonts with
  `line-height` < 1 paint outside their element box, so box-based overlap
  lint does NOT catch them bleeding over eyebrows or captions. Give giant
  type `line-height >= 1` or extra margin, and always eyeball it in a
  snapshot before rendering (see `references/gotchas.md`).
- **Determinism**: no `animation: ... infinite`, no hover effects, no
  transitions-as-state in `theme.css`. The renderer jumps between frames.
  Static styles are fine. Motion comes from the timeline: `reveal`,
  `data-cue`, and the `data-*` animators (§Motion).
- **Ids**: reuse freely across scenes — compose namespaces them per scene.
  Keep them unique within one scene; style with classes, not `#id`.

## Theme: build it from evidence

The user never writes CSS. You build the look from what they say. In order:

1. **URL given → classify and inspect it first.** Follow `url-to-source.md`.
   A brand page can drive tokens and typography; an article or paper mainly
   drives claims, figures, and subject-native visuals. Do not turn publisher
   chrome into the theme unless the publisher itself is the subject.
2. **Otherwise keep what the user gave.** A hex code, a brand name, "dark", "warm",
   "playful" — whatever appears in the prompt stays. Never ask for CSS.
3. **Fill in the rest.** Tokens: `bg, stage, panel, line, ink, muted, faint,
   accent, accent-dim, pink, gold, green, red, amber`, plus the
   chrome/support tokens `deep, halo, chip, capidle, onaccent, track` and
   `colw` (content-column max-width, default `1000px` — widen for maps and
   dense infographics).
   Typical mapping:
   main/brand color → `accent`; mood → `bg` and `stage`; extra brand colors →
   the `pink` / `gold` slots.
4. **Light-brand site → `mode: "light"`.** One switch flips the base palette
   (white field, dark ink, light caption idle words and progress track); your
   tokens still override it. Do NOT keep the dark base and fight `#bg` with
   `!important` — that is how you get white-on-bright-blue cards and
   accent-as-text contrast failures.
5. **Use `theme.css` only when tokens are not enough** (gradients, custom
   layouts, a special font). Keep it small.
6. **Nothing given → use the base look.** `theme` is optional (dark).

Give each host a `color` that fits the palette.

## Chrome: restyle it or cut it

The generated page furniture — topbar wordmark, `NN / NN` counter, progress
bar — is identical across every narova video. It is plain CSS (`.topbar`,
`.wordmark`, `.counter`, `.progress`), so `theme.css` can restyle it. Or cut
it in the config:

```js
chrome: false,                              // no topbar, no counter, no progress bar
chrome: { counter: false },                 // wordmark-only topbar
chrome: { topbar: false, progress: true },  // minimal: progress only
```

Omitting `chrome` keeps all three. `narova check` validates the keys.

## Writing scenes from a prompt

- 5–10 scenes for a 60–90 second video. One idea per scene.
- Short turns: 1–2 sentences. Alternate the speakers.
- Put `data-cue` on the visual that matches each key turn, so the screen
  reacts while the point is spoken.
- Fewer words on screen than words spoken — the captions already show the
  transcript word by word.
- Use `var(--muted)` for small text, not `var(--faint)` — faint text fails
  the contrast check.
