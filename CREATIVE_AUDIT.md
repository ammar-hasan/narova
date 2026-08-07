# Narova Creative Freedom Audit

## 1. Creative-freedom audit

| Area | Current behavior | How it helps creativity | How it constrains creativity | Effect on creative confidence | Severity | Code/docs evidence | Recommended change |
|------|-----------------|-------------------------|------------------------------|-------------------------------|----------|-------------------|-------------------|
| **Captions mandatory** | Captions always rendered with karaoke preset. No `captions: false` path. | Easy access to word-synced captions by default. | Cannot remove the visual caption band. All videos get the caption DOM, caption-safe canvas padding, and `capzone` overlay. Forces every video into caption-bearing form. | High — LLM cannot author captionless videos cleanly. Must override generated CSS internals to "hide" them. | **CRITICAL** | `schema.js:589` — always `karaoke`. `html.js` — `.capzone` always in DOM. `runtime.js` — always builds caption DOM. `css.js` — always reserves caption padding. | **FIXED:** Added `captions: false` support throughout schema/check/html/css/runtime. |
| **Hook/CTA enforcement universal** | Every project checked for hook ≤200ms, first-scene text, saveable end-card. | Helps social-media videos optimize for engagement. | Applies identical hook doctrine to silent films, music visualizers, cinematic pieces, educational content. Non-social videos get irrelevant craft advice. | Medium — unconventional video gets "warnings" for deliberate artistic choices (no hook text, long silence). | **HIGH** | `check.js:286-340` — `checkHook()` runs unconditionally except for external narration. | **FIXED:** Made context-aware — skipped for silent projects and `captions: false`. Warnings tagged `craft:` instead of correctness. |
| **Default background aesthetic** | Background has radial gradient with accent/pink/gold "stage lights" + grid overlay + glow blobs. | Quick, polished default for explainer videos. | Every project defaults to a recognizable "Narova look" — dark navy with teal/pink/gold glows. | Medium — first impression of a blank project is already style-opinionated. | **HIGH** | `css.js:55-63` — `#bg` radial gradient + `::after` glow blobs. | **FIXED:** Removed accent/pink/gold glow blobs and gradient. Default is now a clean flat `var(--stage)` background with subtle grid. |
| **Built-in layout vocabulary** | 30+ named CSS classes: `.s-title`, `.pane`, `.stat`, `.verdicts`, `.flow`, `.dials`, `.stepper`, `.s-two`, `.owners`, `.planes`, `.homes`, `.ledger`, `.referee`, `.desk`, `.s-close`, etc. | Fast composition from known visual patterns. | Strong attractor toward Narova-shaped visual grammar. An LLM can use these for everything and never build custom layouts. | Medium — easy path converges on card/chip/stat grammar. | **HIGH** | `css.js:139-252` — extensive layout vocabulary. | Documented: layouts are tools, use deliberately per concept. No code change (layouts are genuinely useful). Added note in scaffold config. |
| **Caption preset system** | 4 presets: `karaoke`, `slam`, `pop`, `rise` — hardcoded enum. | Fast visual variety within the caption band. | Captions cannot be custom-styled without reaching into generated CSS internals (`.cap-w`, `.caption2`). | Low — author can add custom CSS in `theme.css`. | **MEDIUM** | `schema.js:16` — `CAPTION_PRESETS` Set. `css.js:114-118` — preset styles. | Captions can now be disabled entirely. Custom caption styling via `theme.css` targeting `.cap-w`, `.caption2`, `.capzone` is documented as the escape hatch. |
| **Chrome defaults to all-on** | Topbar wordmark, counter, progress bar always generated. | Provides structural furniture for explainer/documentary videos. | Every video starts with recognizable Narova chrome. Must explicitly `chrome: false` to opt out. | Low — easy to remove (`chrome: false`). | **LOW** | `schema.js:144` — defaults `{topbar:true,counter:true,progress:true}`. | Documented opt-out path. Scaffold now shows `chrome: false` comment. |
| **`scene.three` described as "unlimited"** | Documentation says "unlimited 3D scenes." Code is bounded declarative (13 primitive types, fixed action vocabulary). | Provides accessible, timeline-driven 3D. | Cannot express custom shaders, post-processing, raycasting, procedural geometry, or custom render loops. | Medium — author may believe 3D surface is larger than it is. | **HIGH** | `three.js:55-69` — fixed primitive switch. `scene-script.md:5` — claimed "unlimited." | **FIXED:** Updated documentation to "declarative Three.js scenes with supported primitives." Noted choreography as lower escape hatch. |
| **`narova generate` is artifact-only** | Downloads MP4 from Sora/Runway, saves to assets. No generative specification persisted. | Works for quick clip generation. | Cannot "regenerate with tweaks," cannot retrieve the prompt/seed/model later, cannot version generations. | Medium — generated media is opaque output, not editable creative source. | **HIGH** | `generate.js` — only `downloadFile()` to disk, no manifest entry. | **PROPOSED P1:** Persist generative spec (provider, model, prompt, seed, params) in manifest. Track lineage. |
| **Scene.three is the only 3D surface** | No raw Three.js/WebGL/canvas escape hatch. Choreography has timeline access but no Three.js scene creation. | Guaranteed determinism through declarative config. | Cannot express custom procedural 3D, custom shaders, or unusual rendering. | High — ambitious 3D idea hits a hard ceiling at declarative config. | **CRITICAL** | `three.js` — all scene setup is generated from config, no user-authored JS. | **PROPOSED P0:** Add `scene.threeFile` for user-authored Three.js module with deterministic contract. |
| **Creative-diversity eval tests schema, not LLM** | Uses manually-authored configs to test representational capacity. | Verifies schema extensibility. | Does not measure whether an LLM with Narova produces more diverse/ambitious video. | Low — eval is useful but misdescribed. | **MEDIUM** | `creative-diversity-eval.js` — `generateConfigs()` returns hand-written configs. | **FIXED:** Rephrased eval description to honestly state it's a schema conformance test, not an LLM behavior test. |
| **Concept branching not persistent** | Variants are declared in config, applied at build time. No first-class persistent concept alternatives. | Enables A/B testing of hook variants. | Cannot "bring back the surreal direction we rejected" — history is lost. | Medium — experimentation without archiving discourages bold exploration. | **MEDIUM** | `schema.js:639-775` — variants are inline overrides only. | **PROPOSED P2:** Add `narova branches save/list/restore` with snapshot manifests. |

## 2. Freedom budget analysis

### Essential constraints (required for correctness)
- Deterministic rendering (no `Math.random`, `Date`, wall-clock CSS)
- Reproducible timing (`data-cue` → measured turn times)
- Seeded randomness for particles
- Local-only dependencies (no CDN at render time)
- Asset integrity (files must exist, no remote URLs)
- Scene id uniqueness and namespacing
- Source grounding (claims ledger)

### Helpful default (useful but genuinely optional)
- Default voice colors (assigns palette automatically)
- Timing defaults (gapSentence, gapTurn, lead, tail)
- Caption data generation (always computed for SRT/VTT export)
- Platform presets (size + duration bands)
- Built-in scene layout classes (.pane, .stat, .flow, etc.)

### Accidental constraint (implementation limitation, no fundamental reason)
- Visual caption band uncoditionally rendered (FIXED: now `captions: false`)
- Hook enforcement applied to all projects (FIXED: now context-aware)
- No per-scene render cache (full compose + render on any change)

### Taste leakage (Narova preference masquerading as universal quality)
- Default background glow effects (FIXED: removed accent/pink/gold glows)
- Default scaffold using `.s-title` layout (FIXED: neutral inline styles)
- Hook/CTA doctrine as universal advice (FIXED: tagged `craft:` and context-aware)
- Progress bar by default (remains on by default, easy to disable)
- Grid background texture (reduced to 0.04 opacity, still present as subtle production default)

### Missing escape hatches
- Raw Three.js/WebGL/canvas per-scene (P0 — proposed `scene.threeFile` or `scene.customRender`)
- Custom procedural rendering (P1 — proposed `scene.canvas` / `scene.webgl` escape hatch)
- Programmatic caption control (P1 — runtime exposed to custom caption systems)
- Sound-reactive/beat-reactive timing (P1 — general event system beyond narration cues)

## 3. Creative-confidence audit

| Issue | How it makes LLMs conservative | Recommended fix | Status |
|-------|-------------------------------|-----------------|--------|
| **Expensive renders** | Full compose + render on any change discourages experimentation. | Per-scene render caching, scene-level compose, draft-quality renders. | Proposed P1 |
| **Hard-to-reverse decisions** | No way to fork a project direction and compare. | `narova branches save/list/restore` with snapshot manifests. | Proposed P2 |
| **Insufficient previews** | `narova shots` shows one frame per scene; no real-time review of motion. | Animatic/preview with draft quality, scene-only renders. | Proposed P1 |
| **Fragile low-level paths** | Choreography is powerful but error messages are cryptic. Failures encourage simplification. | Better error messages with suggested repair paths, not just "X failed." | Proposed P1 |
| **Undocumented capability boundaries** | scene.three claimed "unlimited" but is bounded. Author hits wall unexpectedly. | Documented honestly now. | FIXED |
| **Warnings punish experimentation** | Hook/CTA warnings fire on ALL projects regardless of creative intent. | Category-tagged warnings (`craft:` vs `correctness:`). | FIXED |
| **Captions cannot be removed** | Author must override generated CSS internals to hide them. | `captions: false` disables the visual band cleanly. | FIXED |
| **Default palette is an aesthetic opinion** | First impression of "blank project" has recognizable Narova glow. | Neutral flat background. | FIXED |
| **Fear of disturbing approved work** | Revisions could alter approved scenes. Plan already detects change scope; could be more visible. | `narova plan` output already shows what will rebuild. Works well. | N/A (adequate) |

## 4. Changes implemented

### Problem 1: Captions cannot be removed
**Problem:** No `captions: false` path existed. Caption DOM, CSS padding, and presets were always generated, forcing every video into the caption-bearing form.

**Design:** Added `captionsEnabled` flag through the full stack:
- `schema.js`: Accepts `captions: false`. Sets `captionsEnabled = false`.
- `html.js`: Skips `.capzone` and `.cap-preset-*` class when disabled.
- `runtime.js`: Guards caption DOM building behind `if (PRESET && stage && DATA.groups.length)`.
- `css.js`: Removes caption-safe canvas padding when captions disabled.
- `compose/data.js`: Returns `preset: false` when disabled (signals runtime to skip).
- `captions.js`: Unaffected — SRT/VTT sidecars always export.

**Files changed:** `schema.js`, `html.js`, `runtime.js`, `css.js`, `compose/data.js`, `compose/index.js`, `init.js`

**Tests:** All existing pass. Runtime test updated to include `preset` in DATA.

**Backwards compatibility:** Fully compatible. `captions` defaults to `{preset:'karaoke'}` when omitted. Only `captions: false` (explicit boolean) disables.

**Creative capability:** Large increase — author can freely express captionless, silent, and non-social grammar.

**Creative confidence:** Large increase — no longer punished for choosing no captions.

### Problem 2: Hook/CTA enforcement is context-blind
**Problem:** `checkHook()` ran for ALL projects except external narration, advising social-media hook tactics to silent films, cinematic reveals, and teaching videos.

**Design:**
- Skip hook enforcement when project has no voices and no synthesis (silent/motion projects).
- Skip when `captions: false` (author explicitly opted out of social grammar).
- Tag hook/CTA warnings with `craft:` prefix to distinguish from correctness issues.

**Files changed:** `check.js`

**Creative capability:** Medium — non-social concepts no longer get irrelevant craft advice.

**Creative confidence:** Medium — deliberate artistic choices (long silence, no hook text) don't look like warnings.

### Problem 3: Default scaffold and background carry Narova aesthetic
**Problem:** Default background had radial gradient halo + accent/pink/gold glow blobs that gave every project a recognizable Narova look. Scaffold used `.s-title` layout.

**Design:**
- Background: flat `var(--stage)` with subtle 4% opacity grid. No more branded glows.
- Scaffold: neutral inline styles instead of `.s-title`/`.display`/`.lede`.
- Scaffold comments mention captions/chrome as configurable options.

**Files changed:** `css.js`, `init.js`

**Creative capability:** Small — blank project is now a clean canvas, not an implicit template.

**Creative confidence:** Small — first impression doesn't suggest a "right" visual style.

### Problem 4: Documentation misrepresents scene.three capability
**Problem:** Scene-script claimed "unlimited 3D scenes" but implementation is bounded declarative (13 primitives, fixed actions).

**Design:** Updated to "declarative Three.js scenes with supported primitives, models, lights, and timeline-driven animation." Noted choreography as lower escape hatch.

**Files changed:** `scene-script.md`

### Problem 5: Creative-diversity eval described as LLM behavior test
**Problem:** Eval uses manually-authored configs but was presented as a general creative diversity test.

**Design:** Added honest preface: "SCHEMA CONFORMANCE test. NOT an LLM-in-the-loop benchmark."

**Files changed:** `creative-diversity-eval.js`

## 5. Remaining architectural proposals

### P0 (critical — creative ceiling)

**A. scene.threeFile / scene.customRender — raw Three.js/WebGL escape hatch**
- Problem: Declarative `scene.three` cannot express custom shaders, post-processing, procedural geometry, or unusual rendering.
- Design: `scene.threeFile: "my-scene.js"` — user-authored module with deterministic contract: `export function createScene({ THREE, timeline, seed, size, duration, assets })`. Runs in a scoped sandbox with the same GSAP timeline. Must be deterministic (seeded PRNG, no wall-clock).
- Migration: Additive. Existing `scene.three` unchanged.
- Determinism contract: Same as choreography — no `Date`, `Math.random`, `requestAnimationFrame`, `fetch`.
- This is the single most important missing escape hatch. Without it, ambitious 3D/WebGL ideas hit a hard ceiling.

**B. scene.canvas — procedural 2D canvas escape hatch**
- Problem: No way to do procedural 2D rendering (generative art, mathematical visualization, custom drawing).
- Design: `scene.canvas: { setup, draw(t) }` — deterministic canvas API with seeded PRNG and timeline-driven time parameter.

### P1 (important — creative range × exploration)

**C. Per-scene render caching and scene-level build**
- Problem: Any change triggers full compose + render. Experimentation is expensive.
- Design: Hash each scene independently. Compose/render only changed scenes. Composite cached frames with ffmpeg concat.
- Effect: Makes "try 5 title sequences" or "show 3 camera approaches" cheap.

**D. Draft/preview quality tiers**
- Problem: No fast "animatic" or "storyboard" mode.
- Design: `--draft` flag: half resolution, skip complex filters, faster render. `--storyboard`: one frame per scene, JPEG grid.

**E. Generated media provenance tracking**
- Problem: `narova generate` downloads MP4 but loses the prompt, model, seed, etc.
- Design: Persist generative spec in manifest: provider, model, prompt, shot intent, seed, params, version. MP4 is cache/output; spec survives.

**F. General event system beyond narration cues**
- Problem: All timing currently flows through "voice turn → cue." Music-led, silent, and beat-driven projects feel second-class.
- Design: `at: { event: "beat-1" }`, `at: { event: "reveal-world" }`. Events resolve from narration, music, SFX, or explicit timeline markers. Preserves easy speech-sync while making speech one event source among many.

**G. Better error messages with repair guidance**
- Problem: When ambitious ideas fail, errors say "unsupported" or throw cryptic exceptions.
- Design: Every validation error should answer: what failed, why (creative limitation vs technical defect), what remains preserved, nearest valid alternative, and whether a lower escape hatch exists. "This portable renderer cannot execute the requested WebGL effect. The HyperFrames path can. Switch to `renderer: 'hyperframes'` and use `scene.threeFile` for raw Three.js."
- Effect: Helps LLM repair the ambitious idea, not simplify back to a template.

### P2 (valuable — creative confidence × polish)

**H. Persistent concept branches**
- Problem: Variants are runtime overrides. Rejected creative directions are lost.
- Design: `narova branches save <name>`, `narova branches list`, `narova branches restore <name>`. Stores full project state snapshot including theme, scenes, voices, and creative rationale. Survives across sessions.

**I. Creative knowledge as possibility generation**
- Problem: Small models lack spontaneous representation vocabulary.
- Design: Reference guide mapping creative intent → possible visual strategies. "For 'network latency,' consider: racing particles, elastic strings, physical queues, ripples, split-screen clocks, distorted typography, packets in 3D space, literal UI instrumentation." Generates imagination without prescribing a choice.

## 6. Creativity benchmark specification

### Schema conformance (existing — `creative-diversity-eval.js`)
- Tests: Can Narova's schema represent 10 diverse video concepts?
- Method: Manually-authored configs matching 10 creative briefs.
- Measures: Scene count, palette, layout vocabulary, caption preset, voice count, 3D usage, custom CSS, choreography.
- Status: **Implemented.** Honest about what it measures.

### LLM-in-the-loop creativity benchmark (proposed — not yet implemented)

**Methodology:**
1. Select 3+ models: frontier (Claude 4/GPT-5), mid-tier (Claude Haiku/GPT-4o-mini), small (local).
2. Run 10+ briefs per model, 3 seeds each.
3. Two conditions per model:
   - **Baseline:** Model receives brief + normal capabilities. No Narova skill loaded.
   - **Narova:** Same brief, same token budget, same external tools. Narova skill loaded.
4. Autonomously generate project configs. Do NOT manually author.
5. Measure output diversity, creative ambition, and convergence.

**Benchmark briefs (include adversarial ones):**
- Silent brutalist music film
- Slow luxury cinematic object study
- Children's handmade paper animation
- Surreal scientific metaphor
- Continuous-shot 3D narrative
- Kinetic Urdu typography
- Archival documentary essay
- Weird procedural data art
- Abstract emotional film with no literal exposition
- Product demo where UI itself is the story
- Calm 3-minute educational piece with no social hook
- Video explicitly requiring no visible captions
- Film whose structure follows music rather than narration
- Visual poem
- Instruction to invent a visual style that should not resemble a tech explainer

**Measurement dimensions:**

| Dimension | How measured | Why it matters |
|-----------|-------------|----------------|
| Creative diversity | Structural similarity, vocabulary overlap, palette convergence, caption-style repetition | Does Narova cause convergence? |
| Creative quality | Human evaluation: originality, coherence, emotional effect, prompt fidelity, intentionality | Does output look good? |
| Creative capability | Range of media used, sophistication of motion, 3D/procedural usage, custom composition | Can Narova amplify capability? |
| Creative confidence | Concept exploration count, genuinely different directions proposed, use of escape hatches, avoidance of template convergence | Does the model trust the system enough to take risks? |
| Creative leverage | Tokens to first result, iteration count, regeneration cost, edit locality, debugging work | Does Narova reduce production friction? |
| Creative ceiling | Can the model execute deliberately difficult artistic requests? Does Narova help or become the bottleneck? | Does Narova extend or limit reachable space? |

**Central benchmark questions:**
1. Does Narova increase quality AND reliability without reducing diversity or creative ceiling?
2. Does Narova increase creative capability?
3. Does Narova increase creative confidence?
4. Does Narova increase originality, representational diversity, and ambition compared with the same model without Narova?

## 7. Escape-hatch map

```
Level 1: Creative intent + story structure
  Makes easy: Thinking about audience, objective, emotional arc, beat map
  Cannot express: (N/A — this is a thinking layer, not an expression layer)
  Escape hatch: Skip to any lower level directly
  Status: PRESENT in prompt-to-video.md + SKILL.md workflow. Concept branching documented.

Level 2: Semantic elements (scene.elements)
  Makes easy: Camera, lights, 3D primitives, characters, actions in one line each
  Cannot express: Custom shaders, post-processing, procedural geometry, custom render loops
  Escape hatch: scene.three (declarative config), scene.choreography (timeline code)
  Status: IMPLEMENTED. Actions: appear, disappear, move, rotate, scale, orbit, revolve. Characters: 3 built-in presets.

Level 3: Portable visual trees (scene.visual)
  Makes easy: Browserless-renderable scene compositions
  Cannot express: Complex HTML/CSS, WebGL, 3D, arbitrary DOM
  Escape hatch: scene.body (full HTML/CSS/SVG) for HyperFrames
  Status: IMPLEMENTED. Both renderers consume this tree.

Level 4: HTML/CSS/SVG (scene.body + theme.css)
  Makes easy: Full browser visual expression
  Cannot express: 3D, WebGL, procedural rendering
  Escape hatch: scene.three (declarative 3D), scene.choreography (timeline behavior)
  Status: IMPLEMENTED. Unlimited HTML/CSS/SVG surface for HyperFrames.

Level 5: Declarative 3D (scene.three)
  Makes easy: Timeline-driven Three.js with primitives, models, lights, PBR, env maps, shadows
  Cannot express: Custom shaders, post-processing, procedural geometry, raw WebGL, custom render loops
  Escape hatch: **NONE** (choreography has timeline access but no Three.js scene creation)
  Status: IMPLEMENTED but bounded. 13 primitive types. Model animation: first clip only.
  Gap: scene.threeFile / scene.customRender (P0 proposal)

Level 6: Project choreography (config.choreography)
  Makes easy: Arbitrary timeline-driven DOM manipulation via GSAP
  Cannot express: Three.js/WebGL scene creation, canvas drawing
  Escape hatch: **NONE** — this is the current lowest determinisitc surface
  Status: IMPLEMENTED. Access to tl, DATA, gsap, cueTime(). Local, inlined, deterministic.

Level 7: (Proposed) Raw procedural rendering (scene.threeFile / scene.customRender)
  Makes easy: Arbitrary Three.js, WebGL, canvas with deterministic contract
  Cannot express: (This is the floor — anything is possible within determinism contract)
  Escape hatch: N/A (lowest level)
  Status: NOT IMPLEMENTED. Proposed design: export function createScene({ THREE, timeline, seed, size, duration, assets })
```

### Current creative ceiling
The hardest creative ceiling is at Level 5 → Level 6. Choreography has no Three.js/WebGL access. Any 3D idea beyond the 13 supported primitives, fixed material system, and 7 action types cannot be expressed. A story that needs a custom water shader, particle simulation, or unusual camera behavior has no path forward within Narova's determinism contract.

## 8. Final verdict

### If the same competent LLM has Narova versus does not have Narova, is its reachable creative video space larger, smaller, or merely easier to reach?

**Before changes:** Easier to reach, but **smaller.** Narova made explainer/social video dramatically easier but actively constrained the creative ceiling through mandatory captions, hook enforcement on all projects, branded aesthetic defaults, and the absence of a raw 3D/WebGL escape hatch. A narrator-less abstract film, a camera-less music visualizer, or a custom-shader 3D piece was actually harder to express in Narova than without it.

**After changes made in this audit:** Easier to reach AND the creative ceiling has been raised. Captions can be removed, hook advice is not forced on non-social projects, the default canvas is neutral, and the bounded nature of scene.three is honestly documented. However, the raw 3D/WebGL escape hatch (P0) is still missing — this remains a significant ceiling for ambitious 3D work.

**After P0 implementation (scene.threeFile):** Larger — Narova's production infrastructure (local TTS, timeline sync, deterministic rendering, caching, revision locality) combined with a raw WebGL/Three.js escape hatch would make the reachable space larger than without Narova.

### Is the LLM meaningfully more creatively confident with Narova?

**Before changes:** Mixed. Narova's defaults, enforcement, and "Narova look" bred complacency. The LLM converged on familiar templates because the path of least resistance was heavily shaped. But Narova's fast iteration, sentence cache, `--reuse`, and `plan` made _safe_ iteration very confident.

**After changes:** Yes. Removing the forced caption band, making hook advice context-aware, and providing a neutral canvas reduces the sense that "Narova has a shape and you should fit it." The LLM can now author a captionless, chrome-less, silent project without fighting the tool.

### Does that confidence come from trustworthy capability or merely guidance/defaults?

**More from capability now.** Key changes — `captions: false`, neutral defaults, category-tagged warnings — are trustworthy production capabilities, not mere guidance. The remaining area where defaults still shape behavior is the built-in layout vocabulary (30+ CSS classes) — these remain a strong attractor. The next step is to make the LLM _aware_ it should design custom layouts from its creative plan, not just pick from the menu.

### What must change for Narova to make the model much more creatively capable and confident?

1. **P0: scene.threeFile / scene.customRender** — the raw 3D/WebGL escape hatch. This single change removes the biggest creative ceiling.
2. **P1: Per-scene render caching** — makes experimentation cheap enough to be fearless.
3. **P1: General event system** — makes music-led, beat-driven, and silent projects first-class.
4. **P1: Draft/preview quality tiers** — makes iteration faster.
5. **P1: Better error recovery** — helps LLM repair ambitious ideas instead of simplifying to templates.
6. **P2: Persistent concept branches** — makes exploration safe and revisitable.
7. **P2: Creative knowledge as possibility generation** — helps smaller models imagine more.

### What would make the creative space massively larger?

**A deterministic raw WebGL/Three.js module surface per scene.** This is the single highest-leverage change. Currently, 3D is bounded to the declarative `scene.three` config. The gap between "I want a custom water shader with caustics" and what Narova can express is total. No workaround exists. The choreography escape hatch has GSAP timeline access but cannot create Three.js scenes or WebGL contexts.

The design: `scene.threeFile: "my-scene.js"` where the file exports:

```js
export function createScene({ THREE, timeline, seed, size, duration, assets, events }) {
  // arbitrary deterministic Three.js authoring
  // timeline is the GSAP timeline — register all tweens on it
  // seed is a project+scene deterministic seed for PRNG
  // assets resolves to local asset paths
  // events: { narration: [{ at, text, speaker }], music: [{ at, beat }], markers: [...] }
}
```

Same determinism contracts as choreography. This makes the reachable 3D space essentially unlimited while preserving local rendering, reproducibility, timeline seeking, and project ownership.

Combined with:
- `scene.canvas` for 2D procedural rendering
- The general event system for music/beat/sfx-driven timing
- Draft rendering for fast exploration

...these changes would make the LLM's reachable creative space dramatically larger than without Narova — giving the model the capabilities of a creative director, 3D artist, motion designer, and production engineer while keeping creative authorship with the LLM and user.
