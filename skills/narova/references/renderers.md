# Local renderer providers

Narova ships exactly two renderer providers. Both run locally and are free.
The renderer choice is independent of the voice/TTS provider choice.

```js
export default {
  renderer: "hyperframes", // default; or "no-browser"
  // ...
}
```

Every rendering command also accepts `--renderer hyperframes|no-browser`. The CLI
override wins over the config. Inspect local requirements with:

```bash
narova renderers list
narova renderers doctor hyperframes
narova renderers doctor no-browser
```

## Which one to use

| Capability | HyperFrames | No-Browser |
|---|---:|---:|
| Runs locally, no render fee | yes | yes |
| Works without a browser | no | yes |
| Arbitrary scene HTML and CSS | yes | no |
| Portable `scene.visual` tree | yes, compiled to HTML | yes, drawn by Skia |
| Local raster images and SVG | yes | yes |
| Local fonts and shaped RTL text | browser font engine | FontKit OpenType shaping + Skia paths |
| Full-frame scene video (`scene.clip`) | yes | yes |
| Word-synced captions | yes | yes |
| Cue/keyframe motion | full GSAP/data-* surface | portable enter/keyframe surface |
| Scene transitions | fade, wipe, slide, zoom | fade, wipe, slide, zoom |
| HyperFrames components, shaders, 3D, particles | yes | no |
| Browser Studio | yes | no; draft MP4 + snapshots |
| Product walkthrough framing/cursor composition | yes | not yet; use a full-frame `scene.clip` |

Use HyperFrames for the broadest visual surface and normal local work. Use the
no-browser renderer when the machine has Node and FFmpeg but cannot launch a
browser. No-browser does not parse HTML or approximate CSS. It fails before
rendering when a scene has no portable visual, so an approved composition
cannot silently degrade.

## Author once, retain an escape hatch

`scene.visual` is a provider-neutral JSON tree. A visual-only scene works with
both providers. For maximum range, a scene may carry both representations:

```js
{
  id: "result",
  vo: [{ who: "a", text: "One project, two local render paths." }],

  // Full-fidelity HyperFrames art direction.
  body: `<section class="result-card reveal">...</section>`,

  // Browserless fallback. No-browser always uses this tree.
  visual: {
    type: "stack",
    style: { direction: "column", padding: 56, gap: 18, background: "#080d16" },
    children: [
      { type: "text", text: "TWO LOCAL RENDERERS",
        style: { color: "#fff", fontSize: 64, fontWeight: 800 },
        enter: { type: "rise", at: { cue: 0 } } },
      { type: "progress", value: 1, fill: "#2ee6d6",
        style: { height: 10, background: "#243248", radius: 5 },
        animate: [{ property: "progress", from: 0, to: 1,
          at: 0.5, duration: 1.2, ease: "out" }] },
    ],
  },
}
```

HyperFrames prefers `body` when both are present. No-browser requires and uses
`visual`. A visual-only scene is converted to HTML for HyperFrames. Project
`theme.css` remains available to the HyperFrames body and is deliberately
ignored by no-browser; put every fallback style in `visual`.

## Portable visual contract

Nodes: `group`, `stack`, `rect`, `circle`, `line`, `path`, `text`, `image`,
`svg`, and `progress`.

- `group` is a relative canvas; children use `style.x/y/width/height`.
- `stack` lays children in a `row` or `column`; use `padding`, `gap`, fixed
  dimensions, or `flex`.
- Numeric dimensions are pixels. Percentage strings such as `"50%"` are
  relative to the parent.
- Common styles include background (solid or linear gradient), color,
  opacity, radius, borders, shadow, overflow/clip, font properties, text
  alignment/direction, and image `fit: "cover"|"contain"|"fill"`.
- `style.fontFile` must point to a local asset. Pair it with
  `style.fontFamily`; no-browser registers that file explicitly. Set
  `direction: "rtl"` for RTL text. No-browser shapes it with the font's GSUB/GPOS
  tables and falls back to the bundled Noto Sans Arabic when an Urdu/Arabic
  glyph is missing, rather than drawing disconnected letters or a tofu box.
- `image.src` and `svg.src` point to `assets/...`; SVG may instead use local
  inline `markup`. `path.d` accepts SVG path data plus `viewBox`.

Entrances are deterministic and seek-safe:

```js
enter: "fade" // none|fade|rise|slide-left|slide-right|zoom|pop
enter: { type: "pop", at: { cue: 1, offset: 0.1 }, duration: 0.55 }
```

Keyframes animate `x`, `y`, `scale`, `rotate`, `opacity`, `width`, `height`,
or `progress`. Each item needs numeric `from`, `to`, `duration`, optional
`at` (seconds or a 0-based cue anchor), and `ease` (`linear`, `in`, `out`,
`in-out`, or `back`). Media can use `drift: "in"|"out"|"left"|"right"|"up"`.

## Outputs and preview

- HyperFrames compose: `out/hf-<project>/`; snapshots live below it.
- No-browser compose: `out/no-browser-<project>/project.json`; snapshots live below it.
- `narova preview --renderer no-browser` writes `out/preview-no-browser.mp4` at draft
  quality. No-browser preview does not accept `--detach` because there is no
  browser server.
- `narova build`, variants, custom narration, beds/SFX, captions, and export
  deliverables work through either renderer.
- Both renderers reserve the lower caption-safe band for scene content. No-browser
  keeps the root background and `scene.clip` full-frame while laying out root
  visual children above the karaoke overlay.

No-browser installs the pinned MIT-licensed `@napi-rs/canvas` Skia binding and
FontKit shaping engine plus the OFL-licensed Noto Sans Arabic fallback as
optional package dependencies. It uses Narova's existing FFmpeg requirement
for media decode and MP4 encoding and makes no network request while rendering.

For external narration, every timing cue must include transcript text matching
the aggregate scene voiceover. This catches internally inconsistent caption
files. The audio and transcript must still be a genuinely paired source; the
complex eval demonstrates this with the shipped reel and its companion VTT.

## Deliberate limits

The no-browser provider currently rejects or omits the parts of the HyperFrames
surface that have no honest browserless equivalent: arbitrary HTML/CSS/JS,
DOM measurement, nested/PiP video nodes, WebGL shader effects, 3D, particles,
Lottie, maps, and captured walkthrough browser framing. Keep `renderer:
"hyperframes"` for those projects, or author a separate `visual` fallback.
For a walkthrough scene, an explicit full-frame `scene.clip` can serve as the
no-browser fallback while HyperFrames retains the walkthrough metadata.
These are capability boundaries, not automatic downgrade paths.
