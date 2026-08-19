# Writing the scene script (`reel.config.mjs`)

A project is a folder with one config file: `reel.config.mjs` (also accepted:
`.js`, `.json`, `.cjs`). It exports one object. The full shipped public
interface guide is `SPEC.md` in the repo. Full example:
`generated/us-iran-standoff/` (11 scenes;
`generated/narova-skill-reel/` is the flagship demo).

## Creative hierarchy: pick the right level

Narova gives you a ladder from fast shared work to unrestricted expression.
Start at the highest level that serves your concept; drop down only when you
need more control.

1. **Semantic elements** (`scene.elements`) — fastest for common 3D work
2. **Portable visual trees** (`scene.visual`) — when browserless portability matters
3. **Arbitrary HTML, CSS, SVG, assets** (`scene.body` + `theme.css`) — for unique visual design
4. **Project choreography** — for timing behavior beyond the built-in animators
5. **Explicit Three.js** (`scene.three`) — declarative Three.js scenes with
   primitives, models, lights, and timeline-driven animation. Bounded by the
   supported primitive types, lighting, and animation vocabulary.
6. **Raw Three.js / WebGL** (`scene.threeModule`) — the escape hatch beneath
   `scene.three`. A project-relative JS file whose body runs inside the
   deterministic 3D bootstrap with `THREE`, `scene`, `camera`, `renderer`,
   `tl`, `seed`, `size`, `duration`, `assets()`, `pending`, `onRender()`, and
   `narova` helpers in scope. Use it for custom shaders, procedural geometry,
   post-processing, particle systems, or any 3D the declarative vocabulary
   cannot express. Same determinism contract as choreography (no `Date`,
   `Math.random`, `requestAnimationFrame`, `setTimeout`, `fetch`). See
   [§Raw Three.js escape hatch](#raw-threejs-escape-hatch-scenethreemodule).

The choice is yours. Do not use built-in layouts merely because they exist.
Use custom HTML, CSS, SVG, Three.js, assets, and choreography where they
improve the concept. Remove Narova chrome when it does not belong. Change or
remove captions when the work does not need karaoke captions. Use one narrator,
many narrators, external narration, or silence according to the concept.
Prefer HyperFrames when full browser creativity matters; prefer no-browser
when browserlessness or portability is an actual requirement.

## Hard invariants

These are enforced by the tool:

- **Deterministic rendering**: same config + seed → identical output. No
  `Math.random`, `Date`, wall-clock CSS in `theme.css`. Particles use
  seeded randomness.
- **Reproducible timing**: `data-cue="k"` resolves to the measured start of
  turn `k`. GSAP is vendored and loaded locally.
- **Source grounding**: every factual claim must trace to `claims.md`.
- **Valid assets**: all referenced files must exist; URLs validated.
- **No silent feature degradation**: unsupported semantic actions fail at
  validation with clear errors. The currently supported actions are:
  `appear`, `disappear`, `move`, `rotate`, `scale`, `orbit`, `revolve`.

```js
export default {
  title: "The Venture Factory",
  size: "16:9",                     // "16:9" (1280x720) | "1:1" (1080x1080) | "9:16" (720x1280) | {w,h}
  assets: "assets",                 // optional project-local dir; copied to out/hf/assets/
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#2ee6d6", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "host · B" },
  },
  provenance: {                         // optional; never inferred by Narova
    script: { authorship: "mixed", note: "agent draft, human review" },
    disclosure: "Contains AI-generated media",
  },
  theme: {
    mode: "light",                         // "dark" (default) | "light" — flips the base palette
    accent: "#2ee6d6", bg: "#080d16",   // color tokens (optional)
    css: "theme.css",                    // extra CSS file (optional, path relative to config)
  },
  chrome: { topbar: true, counter: true, progress: true },  // or false to strip all page furniture
  safeLayout: true,                    // optional centered max-width content + gutters + caption reserve
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

`provenance` is an optional authored statement-of-record block for facts the
project artifacts cannot prove. `script.authorship` is any non-empty string;
`agent`, `human`, and `mixed` are recognized display values, while other values
are preserved as written. `note` and `disclosure` are optional non-empty text.
`narova provenance` always labels these values declared, never verified, and
reports an absent block as "not declared" without warning or failure.

## 3D scenes and the element model

narova renders 3D through HyperFrames' browser WebGL (Three.js). There are two
ways to author a 3D scene — start with **elements** (the semantic, agent-friendly
surface), drop to **scene.three** (explicit Three.js) only when you need direct
control.

### `scene.elements` — describe intent, not mechanics

An element is one line. narova expands it. The author says *what* the scene is
("a cat chases a mouse across the floor"); narova decides *how* to build it.

```js
{
  id: "chase",
  vo: [{ who: "a", text: "Go go go! The chase is on!" }],
  elements: [
    { type: "camera", position: [0, 3.2, 6.5], lookAt: [0, 0.6, 0] },
    { type: "light", kind: "ambient", color: "#404060", intensity: 0.7 },
    { type: "light", kind: "directional", position: [4, 6, 4] },
    { type: "effect", kind: "background", color: "#1b2438" },
    { type: "ground" },                                   // a floor, one line
    { type: "character", kind: "cat", position: [-2.2, 0, 0.3],
      actions: [{ type: "move", to: [0.4, 0, 0.3], duration: 4.6 }] },
    { type: "character", kind: "mouse", position: [2.2, 0, 0],
      actions: [{ type: "move", to: [-1.8, 0, 0], duration: 4.6 }] },
  ],
  body: `<span class="cue" data-cue="0" style="font-size:48px;font-weight:900;color:#fff">CAT vs MOUSE</span>`,
}
```

**Element types**

| type | what it becomes |
|------|-----------------|
| `camera` | the 3D camera (`position`, `lookAt`, `fov`) |
| `light` | a light (`kind`: ambient/directional/point/spot/hemisphere) |
| `cube`/`sphere`/`cylinder`/`plane`/`torus`/`cone`/… | a primitive (shorthand for `3d-object` with `kind`) |
| `3d-object` | a primitive by `kind`, e.g. `{ type: "3d-object", kind: "cube" }` |
| `model` | a `.glb`/`.gltf` file by `src` |
| `character` | a whole character — see below |
| `ground` | a floor plane (optional `color`, `size`) |
| `effect` | fog (`{ kind: "fog", color, near, far }`) or background (`{ kind: "background", color }`) |
| `text`/`shape`/`image`/`video` | 2D overlay on top of the 3D scene |
| `group` | nested elements that inherit transforms |

**Characters** are the point of the abstraction. A character is a reusable
assembly of relative parts; instancing it is one line. Three built-in presets
ship: `kind: "cat"`, `kind: "mouse"`, `kind: "robot"`. `actions` on the
character apply to the whole assembly (move the cat, not its 10 parts).

```js
{ type: "character", kind: "cat", position: [-2.2, 0, 0.3],
  actions: [{ type: "move", to: [0.4, 0, 0.3], duration: 4.6 }] }
```

Define your own characters under `config.characters` (parts are primitives in
local coordinates; feet near y=0). A config character overrides a preset of the
same name. Model characters use `model`/`src` instead of `parts`:

```js
characters: {
  hero: { parts: [
    { type: "cube", size: [0.4, 0.5, 0.3], color: "#46d98a", position: [0, 0.25, 0] },
    { type: "sphere", size: 0.18, color: "#2ee6d6", position: [0, 0.75, 0] },
  ]},
  avatar: { model: "assets/avatar.glb" },
}
```

**Actions** are semantic: `appear`, `disappear`, `move` (with `to: [x,y,z]`),
`rotate` (with `axis` + `to` radians), `scale`, `orbit`/`revolve`. Timing binds
to narration cues: `at: { cue: 0 }` fires when turn 0 starts, `at: 0.5` is a
scene-time offset.

**Repeated objects (crowds, props, particles)** use `instances` — N copies of
one primitive rendered as a single `THREE.InstancedMesh` (one draw call, shared
geometry/material) instead of N meshes:

```js
{ type: "sphere", size: 0.3, color: "#46d98a",
  instances: [
    { position: [0, 0.3, 0] },
    { position: [1, 0.3, 0] },
    { position: [2, 0.3, 0], scale: [1.5, 1.5, 1.5] },
  ] }
```

Three.js best practices are applied automatically: identical geometries and
materials are deduplicated through a per-scene cache (one buffer, one program;
materials that animate opacity are isolated so tweening one mesh never fades a
same-colored sibling), `preserveDrawingBuffer` + `setPixelRatio(1)` keep
captures deterministic, and rendering is driven by the GSAP timeline — not
`requestAnimationFrame`, which would be non-deterministic under frame seeking.
`.glb`/`.gltf` models are prefetched and parsed before frame 0 (no mid-scene
pop-in), and output is tone-mapped (ACES filmic by default) to sRGB for video.

Note on the version: narova pins three.js **r185** — shipped as a vendored
global script (`vendor/three/three.global.js`) that exposes `window.THREE`.
GLTF loading uses the vendored GLTFLoader. All rendering dependencies are
local; no CDN is needed at render time.

### `scene.three` — explicit Three.js

For direct control, `scene.three` is the compiled target: `camera`, `lights`,
`objects` (primitives, `model`, or `group` with relative `children`), `fog`,
`background`. Each object takes `position`/`rotation`/`scale` and an `animate`
list of `{ property: "position.x" | "rotation.y" | "scale", from, to, duration,
ease, at }`. Everything is driven by the GSAP timeline, so frames are
deterministic and seek-safe.

```js
three: {
  camera: { position: [0, 0, 5], fov: 45 },
  cameraAnimate: orbitCamera(0, 8, { target: [0, 0, 0] }), // move the camera
  lights: [
    { type: "ambient", intensity: 0.5 },
    { type: "directional", position: [5, 5, 5], shadow: true },  // cast shadows
  ],
  toneMapping: "aces",        // optional: aces (default) | agx | neutral | linear
  exposure: 1,                // optional: tone-mapping exposure
  envMap: { src: "assets/sky.hdr", intensity: 0.8 },  // IBL environment
  objects: [{
    type: "cube", color: "#2ee6d6", size: 1.2,
    roughness: 0.4, metalness: 0.8,                      // PBR surface
    map: "assets/wood.png", normalMap: "assets/wood-n.png",  // textures
    castShadow: true, receiveShadow: true,
    animate: { property: "rotation.y", from: 0, to: Math.PI * 2, duration: 6, loop: true },
  }],
}
```

### Object material properties (PBR)

Every primitive object supports:
- `roughness` (0–1), `metalness` (0–1) — PBR surface properties
- `emissive` (hex string), `emissiveIntensity` (number) — self-illuminating glow
- `map`, `normalMap`, `roughnessMap`, `metalnessMap`, `emissiveMap`, `aoMap` — texture maps (asset file paths)
- `castShadow`, `receiveShadow` (boolean) — shadow interaction
- `playAnimations: true` on `model` objects plays the first animation clip from the glTF file

### Camera animation (`scene.three.cameraAnimate`)

An array of animate specs that move the camera during the scene:

```js
cameraAnimate: [
  { property: "position.x", to: 3, duration: 4, ease: "power2.inOut" },
  { property: "lookAt.z", to: 2, duration: 4 },
  { property: "fov", from: 45, to: 20, duration: 3 },
]
```

Camera animation DSL helpers are available at
`tool/src/compose/camera-dsl.js` — `orbitCamera()`, `dollyCamera()`,
`panCamera()`, `boomCamera()`, `lookAtPan()`.

### Animation chaining

Each animate spec also supports:
- `wait` (number) — seconds of delay before the tween starts
- `loop: true` — repeat the tween continuously within the scene duration

### Shadows

Set `shadow: true` on a directional, point, or spot light. Use `shadowMapSize`
and `shadowCamera` (directional) to tune quality. Objects need `castShadow: true`
and/or `receiveShadow: true` to participate.

### Environment maps (IBL)

Set `envMap: { src: "assets/sky.hdr", intensity: 0.8, background: false }` on
the three config. Loads an equirectangular image, generates a prefiltered PMREM,
and sets it as `scene.environment` for PBR reflectance. Set `background: true` to
also use it as the scene background.

### Particles

Add `{ type: "particles", count: 500, spread: [8, 4, 8], color: "#ffaa44", size: 0.08 }`
to `objects`. Particles use additive blending and auto-rotate.

Notes:
- Three.js (r185) and GSAP (3.14.2) are vendored in the tool (`vendor/three/`,
  `vendor/gsap/`) and copied to `out/hf-*/assets/` at compose time. Rendering
  and preview have zero CDN dependencies. The GLTFLoader ships vendored too.
- `.glb`/`.gltf` models are copied from the project, prefetched, and parsed
  before frame 0 so they never pop in mid-scene.
- 2D `body` HTML overlays the 3D canvas, so mix text/captions over 3D freely.

## Raw Three.js escape hatch (`scene.threeModule`)

`scene.three` is a bounded declarative vocabulary — 12 primitives, models,
groups, particles, one PBR material, 5 lights, fixed animation axes. When a
concept needs something that vocabulary cannot express (custom shaders,
procedural geometry, post-processing, raymarching, data-driven geometry,
unusual materials, custom render passes), drop to `scene.threeModule`: a
project-relative JS file whose body is inlined into the deterministic 3D
bootstrap.

```js
// reel.config.mjs
scenes: [
  { id: "shader", dur: 8, vo: [], threeModule: "caustic-shader.js" },
]
```

```js
// caustic-shader.js — your body runs with these names in scope:
//   THREE        the Three.js library (r185)
//   scene        the THREE.Scene — add your objects to it
//   camera       the THREE.PerspectiveCamera — move it freely
//   renderer     the THREE.WebGLRenderer (sRGB, ACES, pixelRatio 1)
//   sceneTl      scene-local GSAP timeline; position 0 is this scene's start
//   timeline     alias of sceneTl
//   tl           composition-global timeline (advanced/backward compatibility)
//   start        measured global scene start; at(t) converts local -> global
//   seed         deterministic integer (project + scene hash) — derive PRNGs from it
//   size         { w, h } render size in pixels
//   duration     scene duration in seconds
//   assets(name) resolves a project asset filename to "assets/<name>"
//   pending      push Promises for async loads (textures, models); the resting
//                frame waits for all of them before painting
//   onRender(fn) / onBeforeRender(fn) run before WebGL paints on every seek
//   onAfterRender(fn) runs after WebGL paints
//   narova       cueTurn/cueSentence/cueWord/cueMarker return local seconds;
//                atTurn/atSentence/atWord/atMarker return global tl positions
var geo = new THREE.PlaneGeometry(2, 2);
var mat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(size.w, size.h) } },
  vertexShader: "void main(){gl_Position=vec4(position.xy,0.,1.);}",
  fragmentShader: "uniform float uTime;uniform vec2 uRes;void main(){vec2 uv=gl_FragCoord.xy/uRes;gl_FragColor=vec4(uv,sin(uTime)*.5+.5,1.);}",
});
var quad = new THREE.Mesh(geo, mat);
scene.add(quad);
camera.position.set(0, 0, 1);
// Drive the uniform from the timeline so the render reproduces exactly.
sceneTl.to(mat.uniforms.uTime, { value: duration, duration: duration, ease: "none" }, 0);
```

Determinism contract (enforced by `check`, same as choreography): no `Date`,
`Math.random`, `requestAnimationFrame`, `setTimeout`, or `fetch`. Use `seed`
+ `narova.prng()` for any randomness and register scene motion on `sceneTl`.
Use `tl` only for deliberately composition-global choreography, with `at()` or
the `narova.at*()` helpers. Given the same project state + seed + assets,
output reproduces exactly.

`scene.three` config (camera, toneMapping, fog, background, lights) is still
honored as the shell when both are present, so you can mix declarative scene
setup with raw code. `scene.threeModule` and `scene.threeFile` (a JSON
declarative-config file) are different things: `threeFile` externalizes the
declarative config; `threeModule` is the raw-JS escape hatch.

### 3D production quality

Using Three.js proves only that the scene is rendered in 3D; it does not make
the result detailed, cinematic, realistic, or physically correct. Core Narova
deliberately supplies no 3D house style. Use the optional, independently
installed `narova-3d-production` companion when a project needs specialist
subject/asset, scene-direction, or inspection judgment; it loads that depth
conditionally, separates accepted representations from blockouts, and hands
authoring and rendering back here. The complete 3D surface above remains
available without it.

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
- **External narration**: use pre-recorded audio instead of TTS. Set
  `narration: { file: "assets/voice.wav" }`. narova skips synthesis, copies
  the file as the narration track, and mixes any configured `bed`/`sfx` on
  top. Optional `wordTimings: "assets/captions-karaoke.json"` injects
  word-level karaoke caption overlays into every scene at compose time
  (gold highlight advancing word by word on a dark pill at the bottom).
  Format: `[{ start, end, text, words: [{ text, start, end }] }]`.
  See [audio.md](audio.md) §External narration.
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
- **Casting is a creative choice.** The number and style of voices follows
  the concept. One narrator, two hosts, a panel, or silence — match the
  cast to the work. Give each active voice a `color`; the active caption
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
- **Styling**: the default scene body owns the full frame with no implicit
  centering, max-width, gutter, or caption reserve. Captions and optional chrome
  overlay that canvas. Set `safeLayout: true` to opt into conservative content
  geometry, and `patterns: true` for the separate layout-class menu below. Add
  your own classes in `theme.css`. Bodies are plain HTML with no scripts. Inline
  SVG, small `data:` URIs, and files from project `assets/` are supported;
  remote render-time files are not.

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

## Layout: raw canvas and opt-in safe area

- By default `.canvas` and `.scenebody` are absolute and full-frame. There is no
  content max-width, centering, outer gutter, or reserved caption band. Optional
  captions and chrome overlay the same coordinate space. This is the raw path.
- Set top-level `safeLayout: true` when conventional guardrails serve the work.
  It restores centered flex layout, responsive outer gutters, a caption reserve,
  and a 1000px content column. Widen that helper with
  `theme: { colw: "1180px" }`.
- `patterns: true` and `chrome: true` do not imply `safeLayout`; all three are
  independent creative choices.
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
can make HyperFrames fetch additional font families. The built-in theme
defaults are generic-only (`system-ui`, `sans-serif`, `ui-monospace`,
`monospace`), so a project that never names a font composes and renders with
no network font fetch; naming a family anywhere opts that family into the
renderer's own resolution.

## Built-in scene layouts

These are tools, not templates. Use them when they serve the concept; build
custom layouts when the video needs an original visual language. A video
where every scene is a centered title card is one video, re-skinned.

**Built-in layouts are opt-in.** Set `patterns: true` at the top level of your
config to include them. The default (`patterns` omitted or `false`) ships no
layout classes — every scene gets only the production infrastructure
(captions, chrome, reveal/cue animation mechanics). Add `patterns: true` when
you deliberately choose to use `.s-title`, `.pane`, `.stat`, etc.

Mix these deliberately (craft guidance: `narova critique`):

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
   `colw` (the opt-in safe-layout content max-width, default `1000px`).
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

- Scene count follows the concept. An explainer might use 5–10 scenes for a
  60–90 second video; a slow meditative piece might use 2–3; a reel might use
  one scene. One concept per scene.
- Short turns: 1–2 sentences each. Alternate speakers when using multiple voices.
- Put `data-cue` on the visual that matches each key turn, so the screen
  reacts while the point is spoken.
- Fewer words on screen than words spoken — the captions already show the
  transcript word by word.
