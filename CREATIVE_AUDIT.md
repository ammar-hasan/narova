# Narova Creative Freedom Audit

> Verified against current source (Aug 2026). Every claim below was checked
> against the actual implementation, not the prior doc. Where the prior audit
> and the code disagreed, the disagreement is recorded. "Code behavior wins
> over documentation."

---

## How to read this document

This audit answers four questions:

1. **Ease without creative restriction** — does Narova make video easy *without*
   constraining the creative range an LLM would otherwise have?
2. **Creative amplification** — does it make the LLM *more capable*?
3. **Creative confidence** — does it make the LLM *more willing to explore*?
4. **Effective vs theoretical freedom** — what is the *path of least
   resistance*, and does it converge?

Each finding is labeled with severity and a category from the **freedom
budget** (§2). Implemented fixes are marked **FIXED**; large items still open
are marked **RFC** with a priority.

---

## 1. Creative-freedom audit

| Area | Current behavior | Helps creativity | Constrains creativity | Effect on confidence | Sev | Evidence (file:line) | Recommendation |
|------|------------------|------------------|----------------------|----------------------|-----|----------------------|----------------|
| **3D creative ceiling** | `scene.three` is a bounded declarative schema (12 primitives + model/group/particles, 7 element actions, **one** material type `MeshStandardMaterial`, 5 lights). No raw 3D path existed. | Accessible timeline-driven 3D. | Custom shaders, post-processing, procedural geometry, raymarching, custom materials — **all impossible**. The hardest 3D ideas hit a hard wall. | High — ambitious 3D had no path. | **CRITICAL→FIXED** | `compose/three.js:50-69` (primitives), `:113-146` (material), `elements.js:28-33` (7 actions). Prior `scene.threeFile` (`schema.js:313-319`) is a **JSON config loader**, not the JS escape hatch the prior audit proposed. | **FIXED:** added `scene.threeModule` — raw Three.js/WebGL escape hatch with full deterministic context (§4-A). |
| **False escape-hatch docs** | `scene-script.md` advertised a "component-custom escape hatch" via choreography for raw 3D. **No such mechanism existed.** | — | An author chasing the advertised hatch finds nothing — a dead end that *reduces* confidence. | High — silent capability lie. | **HIGH→FIXED** | `scene-script.md:18-23` (old wording). `choreography.md` has no Three.js content (confirmed). | **FIXED:** doc now describes the real `scene.threeModule` hatch honestly. |
| **Captions mandatory** | `captions: false` works cleanly across the stack (schema → check → compose → runtime → css). SRT/VTT still export. | Word-synced captions by default. | (Was: no clean opt-out.) Now optional. | High (was). | **FIXED (prior)** | `schema.js:610-613`, `html.js:176-204`, `runtime.js:27`, `css.js:76`, `data.js:79`. Verified inert: only dead CSS + unused `DATA.groups` remain when off. | Keep. Minor: the string-preset form `captions:'karaoke'` is **not** accepted (object or `false` only) — doc this. |
| **Hook/CTA enforcement context-blind** | `checkHook` is skipped for silent projects, `captions:false`, and external narration. Craft warnings tagged `craft:`. | Social engagement advice for social video. | Still no **declared creative intent** — a cinematic voiceover film with captions still gets social hook advice. Craft advice is inferred from negative-space signals, not authored. | Medium. | **PARTIALLY FIXED** | `check.js:296-300` (skip guards), `:534` (external-narration gate). | RFC P1: a lightweight `intent`/`genre` field so craft advice is *declared*, not guessed. |
| **`check` correctness prefix dead** | The `issue(msg,'correctness')` helper existed but **no rule used it** — correctness and quality warnings were indistinguishable. Infinite CSS animation (a real determinism bug) was tagged as generic quality. | — | A genuine reproducibility defect looked like a style nit. | Medium. | **FIXED** | `check.js:348-352` (helper), `:476-478` (infinite-anim rule). | **FIXED:** infinite-animation rule now tagged `correctness:`. |
| **Determinism scan incomplete** | `check` scanned only project `choreography`. Per-scene `choreographyFile`/`scriptFile`/`threeModule` were **not** scanned — a real coverage gap. | Determinism is the load-bearing contract. | An author could write `Date.now()` in a `scriptFile` and get no warning → silent nondeterminism. | High (made worse by the new escape hatch). | **FIXED** | `check.js` old `:457-473` scanned `config.choreography` only. | **FIXED:** scan now covers every inlined author-JS blob with source attribution. |
| **Generated media is opaque** | `generate` downloaded an MP4 and returned. **No** provider/model/prompt/seed/params survived. "Make it rainy" was impossible. | Quick clip gen. | A generated clip was dead output, not editable creative source. | Medium — limits iteration on generated shots. | **HIGH→FIXED** | `generate.js:128-149` (old). | **FIXED:** `.gen.json` spec sidecar + `--regenerate`/`--model`/`--size`/`--duration` (§4-E). |
| **No scene-level regeneration** | Per-scene content hashes **exist** and are *commented* as enabling selective rebuilds (`manifest.js:313-315`) — but **no consumer reads them**. Any visual change → full compose (wipe) + full render of the whole video. `--reuse` only skips TTS. `build()` never calls `plan()`. | Whole-project simplicity. | "Try 5 title sequences" or "render only scene 4" costs a full render each time. Experimentation is expensive. | **High** — the biggest confidence tax. | **CRITICAL (RFC)** | `compose/index.js:102-107` (wipe+rebuild), `pipeline.js` (monolithic build), `plan.js:31` (VISUAL→whole project). | RFC P0/P1: scene-level render cache consuming the existing per-scene hash (§5-A). **Partial fix:** `build --plan` now surfaces scope. |
| **No draft/storyboard tier (HyperFrames)** | HyperFrames always renders full-quality. no-browser has a draft MP4 (15fps, CRF28) but still full frame count. `narova shots` is one still per scene. | Quality. | No fast animatic / low-res exploration path for the canonical renderer. | Medium. | **HIGH (RFC)** | `no-browser.js:801-805` (quality=CRF only), `bin/narova.js:533-540`. | RFC P1: `--draft` (half-res) + `--storyboard` (frame grid) for HyperFrames. |
| **Narration is the only event source** | All timing flows voice→cue→visual. `data-cue="k"`, `narova.cueTurn(i)`, claims ledger all assume speech. Music beats, SFX hits, explicit markers have no first-class timing role. | Speech-sync is Narova's killer feature. | Music-led, silent, beat-driven, and dance-cut films are second-class — you can build them, but the timing ontology fights you. | Medium — narrows the *effective* creative space to narration-driven work. | **HIGH (RFC)** | `runtime.js` (cue resolution), `three.js:161-170` (`at:{cue}`), `data.js` (groups from vo). | RFC P1: general event system `at:{event:"..."}` resolving from narration/music/SFX/markers (§5-C). |
| **Concept branches not persistent** | Variants are inline `config.variants` overrides applied at build. Rejected directions vanish. | A/B hook testing. | "Bring back the surreal direction" is impossible — no archive of alternatives. | Medium — discourages bold forks. | **MEDIUM (RFC)** | `schema.js:662-799` (variants), `releases.js` (snapshots but not branch-shaped). | RFC P2: `narova branches save/list/restore` over the release machinery (§5-D). |
| **House-style token gravity** | Default tokens still carry a recognizable Narova identity (`accent:#2ee6d6` teal, `pink`, `gold`; `.stat` defaults to red). Background is now neutral, but the palette + 30+ pattern classes remain a strong attractor. | Fast polished starts. | Path of least resistance converges on a "Narova explainer" look unless the author actively resists. | Medium. | **MEDIUM** | `css.js:16-22` (DEFAULT_TOKENS), `:120-252` (patterns). `patterns:false` opts out. | Documented as tools-not-a-language. Consider a neutral default palette set + opt-in themed palettes. |
| **Creative-diversity eval is schema-only** | `creative-diversity-eval.js` uses **hand-authored** configs to prove the schema *can* represent 10 concepts. It does **not** measure whether an LLM *produces* more diverse work. Not in the regression `test` command. | Proves representation capacity. | Could be mistaken for an LLM-behavior result. | Low (eval hygiene). | **MEDIUM** | `evals/creative-diversity-eval.js` (`generateConfigs()` hand-written); `package.json` `test` script omits evals. | Honestly relabeled "schema conformance" (prior fix). Build the real LLM-in-the-loop benchmark (§6). |
| **Failure messages → simplification** | Some errors ("unsupported", bare throws) nudge toward simpler templates rather than toward a lower escape hatch. | — | An ambitious idea that fails looks "broken", not "needing a lower surface". | Medium. | **MEDIUM (RFC)** | `three.js:428-430` (model fallback), `elements.js:458-463` (action not-yet-implemented). | RFC P1: every capability error names the nearest valid alternative + whether a lower hatch exists (§5-E). |
| **no-browser renderer has no 3D** | The browserless (Skia/FFmpeg) renderer **cannot** render `scene.three` or `scene.threeModule` at all — it requires `scene.visual` and rejects HTML bodies. | Portable, no-browser rendering. | A 3D concept is locked to HyperFrames (needs Chromium/WebGL). | Low (documented renderer split). | **LOW** | `no-browser.js:66-68` (requires visual), no `THREE` path. | Document honestly; the portable `canvas3d`/`model3d` visual nodes are inert (no driver). |

---

## 2. Freedom budget analysis

### Essential constraints (required for correctness — keep)
- **Deterministic rendering**: no `Math.random`/`Date`/wall-clock CSS; seeded PRNG; `setPixelRatio(1)`, `preserveDrawingBuffer`. `three.js:266-268`, `check.js:270-276`.
- **Reproducible timing**: `data-cue="k"` → measured turn start (`runtime.js`, `three.js:161-170`).
- **Local-only at render time**: three + GSAP vendored, copied into project. `compose/index.js:112-117`.
- **Asset integrity / no remote fetch**: `check.js:189-216`, `schema.js:114-118`.
- **Source grounding**: claims ledger. `check.js:542-577`.
- **Scene-id uniqueness + SVG namespacing**: `schema.js:367-370`, `html.js:61-76`.

### Helpful defaults (useful, genuinely optional)
- Sentence-level TTS cache (byte-identical reuse). `py/narova_tts/pipeline.py:264-288`.
- `--reuse` (skip synth when audio fingerprint matches). `pipeline.js:111-162`.
- Platform presets (size + duration band). `util.js`.
- Built-in layout patterns (opt out via `patterns:false`).
- Caption presets + SRT/VTT always-export.

### Accidental constraints (implementation limitation, no fundamental reason)
- **Monolithic compose+render**: per-scene hashes exist but nothing consumes them → any visual change rebuilds the whole video. *(Highest-leverage accidental constraint.)*
- **Per-scene JS was not determinism-scanned** until this audit's fix.
- **`issue('correctness')` helper unused** until this audit's fix.
- Portable `canvas3d`/`model3d` visual nodes are inert (no narova driver) — `visual.js:463-471` emits tagged HTML nothing reads.

### Taste leakage (Narova preference masquerading as universal quality)
- Default palette tokens (`accent` teal, `pink`, `gold`) — `css.js:16-22`.
- `.stat` defaults to red — `css.js:139`.
- Hook/CTA/saveable-end-card advice applied whenever a project has narration + captions (no declared intent) — `check.js:290-334`.
- Progress bar + chrome on by default (easy to disable).
- *(Background glow blobs were taste leakage — removed in 0.21.0.)*

### Missing escape hatches (now partially closed)
- ~~Raw Three.js/WebGL per scene~~ — **CLOSED by `scene.threeModule`**.
- Raw procedural 2D canvas per scene — **still missing** (RFC P1).
- General event system (music/SFX/markers as first-class timing) — **missing** (RFC P1).
- Programmatic/custom caption system beyond 4 presets — **partial** (`theme.css` on `.cap-w`/`.caption2` is the documented hatch; full custom caption module is RFC P2).

---

## 3. Creative-confidence audit

| What makes LLMs conservative | How it shows up | Fix | Status |
|------------------------------|-----------------|-----|--------|
| **Expensive renders** | Any visual change = full compose + full render. "Try 3 camera approaches" costs 3 full renders. | Scene-level render cache (consume the existing per-scene hash); draft tier. | RFC P0/P1 |
| **Blind change scope** | `build()` never called `plan()`; an author can't see what a revision will touch. | `build --plan` prints scope before building. | **FIXED** |
| **Vague failure on ambitious work** | "unsupported" / bare throws nudge toward simpler templates. | Capability errors name the nearest valid surface + lower hatch. | RFC P1 |
| **Hard-to-reverse direction** | Rejected concept branches are lost. | Persistent branches over the release machinery. | RFC P2 |
| **Warnings that punish experimentation** | Hook/CTA doctrine fired on all narrated projects. | Context-aware skip + `craft:` tag. | Fixed (prior); intent field is RFC P1 |
| **Undocumented capability boundaries** | `scene.three` was called "unlimited"; a false 3D hatch was advertised. | Honest bounds + real `scene.threeModule`. | **FIXED** |
| **Generated clips are dead ends** | No way to revise a generated shot. | `.gen.json` spec + `--regenerate`. | **FIXED** |
| **Fear of disturbing approved work** | Revisions could alter approved scenes invisibly. | `build --plan` now shows per-scene scope; `narova plan` already reported it. | Partial |
| **Insufficient previews** | Only `narova shots` (stills) is cheap; no animatic. | Draft/storyboard tier for HyperFrames. | RFC P1 |
| **Silent nondeterminism in escape hatches** | Per-scene JS wasn't linted for hazards. | Determinism scan now covers all inlined author JS. | **FIXED** |

---

## 4. Changes implemented (this audit)

### A. Raw Three.js escape hatch — `scene.threeModule` (P0)
**Problem:** `scene.three` is a finite declarative vocabulary (12 primitives, 1 PBR material, 5 lights, 7 actions). Custom shaders, procedural geometry, post-processing, raymarching, and unusual materials had **no** deterministic path. The prior `scene.threeFile` is a JSON config loader — a different, narrower thing than the raw-JS hatch the prior audit proposed. Docs falsely advertised a "component-custom escape hatch" through choreography that did not exist.

**Design:** a project-relative JS file inlined into the deterministic 3D bootstrap. The author's body runs with a clean context in scope:

```
THREE  scene  camera  renderer  tl(GSAP timeline)  seed  size{w,h}
duration  assets(name)  pending[]  onRender(fn)  narova{prng,cueTurn}
```

The bootstrap builds the capture-safe shell (WebGLRenderer sRGB/ACES/pixelRatio 1/preserveDrawingBuffer, Scene, PerspectiveCamera) — honoring optional `scene.three` camera/toneMapping/fog/background as the shell — then runs the author code in a `try/catch` (a throw is reported, never silently blank), registers a default per-frame `renderer.render(scene,camera)`, and drives frames across the scene span on the shared paused timeline. Determinism contract identical to choreography.

**Files:** `schema.js` (resolve `threeModule` → `_threeModuleContents`, scene-content requirement, `sceneFileRefs`), `compose/three.js` (`threeModuleSetupJs`, `threeModuleSceneBody`, `hasThreeModules`, updated `hasThreeScenes`), `compose/html.js` (use module body when present), `compose/index.js` (three assets copied via updated `hasThreeScenes`), `references/scene-script.md` (full section + corrected hierarchy).

**Tests:** `schema.test.js` (×3), `renderers.test.js` (×5): resolution, content requirement, missing-file rejection, shell + inline + try/catch + seed determinism, declarative-shell mixing, scene-body emit, `hasThreeModules`/`hasThreeScenes`.

**Backwards compat:** fully additive. Existing `scene.three`/`scene.threeFile` unchanged.

**Effect on capability:** **large** — the reachable 3D space goes from "13 primitives + 1 material" to "anything Three.js/WebGL can do, deterministically". This is the single largest creative-ceiling lift in the audit.

**Effect on confidence:** **large** — ambitious 3D (shaders, particles, procedural) now has a sanctioned, deterministic, linted home instead of a dead end.

**Effect on cost:** neutral (only paid when used).

### B. `check` correctness category made real + determinism scan extended
**Problem:** the `issue(msg,'correctness')` helper existed but no rule used it (correctness vs quality were indistinguishable); and `check` scanned only project `choreography`, missing per-scene `choreographyFile`/`scriptFile`/`threeModule`.

**Design:** (1) infinite-CSS-animation rule now passes `'correctness'`; (2) the determinism scan iterates every inlined author-JS blob with source attribution (`scene "X" choreographyFile`, `… scriptFile`, `… threeModule`, `choreography`).

**Files:** `check.js`.

**Tests:** `check.test.js` (×4): per-scene choreo/script/threeModule hazards warn with correct attribution; infinite animation tagged `correctness:`.

**Effect:** correctness defects now look like correctness defects (not style nits); the new escape hatch can't silently introduce nondeterminism. Directly serves "distinguish *unconventional* from *technically broken*".

### C. False escape-hatch documentation removed
**Files:** `references/scene-script.md` (hierarchy §5–6 rewritten; new "Raw Three.js escape hatch" section).

**Effect:** an LLM chasing raw 3D now finds a real, documented surface instead of a dead reference.

### D. `build --plan` — change scope made legible at build time
**Problem:** `build()` never consulted `plan()`; the author was blind to what a revision would rebuild.

**Design:** opt-in `--plan` prints `formatPlan(result)` before building. Advisory only — never changes behavior.

**Files:** `bin/narova.js`.

**Effect:** "fear of disturbing approved work" is reduced — scope is visible without a separate command.

### E. Generated-media provenance
**Problem:** `generate` downloaded an MP4 and returned; provider/model/prompt/params were lost.

**Design:** every generated clip gets a `.gen.json` sidecar (`buildSpec`: provider, providerName, model, prompt, params, sourceVideoUrl, artifact, artifactBytes, artifactSha256, generatedAt). `--regenerate <mp4>` re-runs from the spec (inherits provider/model/prompt/params; override any). `--model`/`--size`/`--duration` capture/override. The MP4 is cache/output; the spec is the surviving creative source.

**Files:** `generate.js` (`buildSpec`, `readSpec`, `specPathFor`, refactored `generate`/`generateSora`/`generateRunway` to honor params), `bin/narova.js` (regenerate path + flags + help).

**Tests:** `generate.test.js` (×5): path mapping, spec capture, round-trip, missing-sidecar null, null-model.

**Effect:** "keep this shot but make it rainy" / "same composition, three takes" becomes possible. Generated media is editable creative source.

---

## 5. Remaining architectural proposals

Prioritized by **creative range × creative confidence × ease of exploration × editability × reliability**.

### P0

**A. Scene-level render cache (consume the existing per-scene hash).**
- *Problem:* per-scene hashes exist and are commented as enabling selective rebuilds (`manifest.js:313-315`) but **no consumer reads them**. Any visual change wipes `out/hf-*` and re-renders the whole video. This is the **single biggest confidence tax** on experimentation.
- *Design:* (1) compose per-scene frame spans (or per-scene MP4 segments) keyed by `sceneHash`; (2) on build, render only scenes whose hash changed; (3) composite cached + re-rendered spans with ffmpeg concat (`setsar=1` per AGENTS.md); (4) `narova plan`/`build --plan` already report per-scene scope — drive the cache from it. Audio/timing across the concat is already segmented per-scene in `out/audio/NN.wav`.
- *Determinism contract:* a cached span reproduces because its inputs (body/visual/three/clip/transition/dur + timings) are fully captured by `sceneHash`.
- *Migration:* additive behind a cache dir; falls back to full render if any span is missing.
- *Effect:* "render only the 12s affected by this motion change" / "try 5 title sequences cheaply" — experimentation economics transform from "expensive" to "cheap". Highest-leverage confidence change remaining.

### P1

**B. Draft / storyboard / animatic tiers for HyperFrames.**
- *Design:* `--draft` (half resolution, skip heavy filters), `--storyboard` (one frame per scene → JPEG grid), `--animatic` (low fps, cached spans). Makes "show me three camera approaches before committing" cheap.
- *Status:* no-browser already has a CRF-only draft; HyperFrames has nothing.

**C. General event system (narration as one event source among many).**
- *Problem:* all timing flows voice→cue. Music-led, silent, beat-driven, and dance-cut films are second-class.
- *Design:* `at: { event: "beat-1" }` / `at: { event: "reveal-world" }` resolving from narration cues, music beats/sections, SFX hits, explicit timeline markers, or captured-interaction timestamps. Speech-sync stays the easy default; speech becomes one excellent event source.
- *Determinism:* events resolve to absolute timeline times at compose (same as cue resolution today).

**D. Declared creative intent (`config.intent`).**
- *Problem:* hook/CTA advice is inferred from negative-space signals (silence, `captions:false`), not authored. A cinematic voiceover film still gets social advice.
- *Design:* optional `intent: { genre?, pacing?, priority? }` (e.g. `{genre:"cinematic", priority:"rhythm-over-hook"}`). `checkHook` and craft rules branch on it. Expands the option space ("here are six ways") instead of narrowing it.

**E. Capability-honest failure messages.**
- *Design:* every validation/capability error answers: what failed, why (creative limitation vs technical defect), what's preserved, the nearest valid alternative, and whether a lower escape hatch exists. "This portable renderer can't do WebGL; the HyperFrames path can — move this scene to `scene.threeModule`." Helps repair ambitious ideas instead of simplifying them to templates.

**F. Raw procedural 2D canvas escape hatch (`scene.canvas`).**
- *Design:* deterministic `<canvas>` 2D surface with `setup`/`draw(t)` + seeded PRNG, mirroring `scene.threeModule`'s contract. For generative art, math visualization, custom drawing.

**G. Creative-plan layer + creative-knowledge reference.**
- *Design:* a pre-implementation thinking layer (audience, objective, emotional arc, beat map, representation strategy, motion language, what the video will *not* do) + a reference that enumerates *representation families* ("for 'network latency': racing particles, elastic strings, queues, ripples, split-screen clocks, packets in 3D, literal UI instrumentation…"). Generates imagination without prescribing a choice — directly targets "conceive representations the model may not have considered".

### P2

**H. Persistent concept branches** (`narova branches save/list/restore`) over the release machinery — so "bring back the surreal direction" works and rejected alternatives survive.

**I. Neutral default palette + opt-in themed palettes** — reduce house-style gravity without removing the useful starter systems.

**J. Honest relabel + wire the diversity eval into regression**, and build the real LLM-in-the-loop benchmark (§6).

---

## 6. Creativity benchmark

### What the existing eval actually proves
`evals/creative-diversity-eval.js` uses **hand-authored** configs to prove the **schema can represent** 10 diverse concepts. That is a **schema-capability / conformance** test. It does **not** measure whether an LLM *produces* more diverse or ambitious work with Narova. (Prior audit relabeled it honestly.)

### Required: LLM-in-the-loop creativity benchmark (specified)

**Methodology (baseline vs Narova, same model tier):**
1. Pick ≥3 models spanning tiers (frontier, mid, small/local).
2. Run ≥15 briefs per model, ≥3 seeds each.
3. Two conditions per model, matched token/time/compute budget:
   - **Baseline:** brief + normal coding/render capabilities. **No Narova skill.**
   - **Narova:** same brief, same budget, Narova skill loaded.
4. **Autonomously** generate projects (no hand-authored configs). Collect the final video + the transcript of the authoring session.
5. Score blind across the dimensions below.

**Briefs (include adversarial Narova-convergence probes):**
silent brutalist music film · slow luxury cinematic object study · children's handmade paper animation · surreal scientific metaphor · continuous-shot 3D narrative · kinetic Urdu typography · archival documentary essay · weird procedural data art · abstract emotional film (no literal exposition) · product demo where the UI *is* the story · calm 3-min educational piece (no social hook) · video requiring **no visible captions** · film whose structure follows **music** not narration · visual poem · single-shot spatial metaphor · generative mathematical animation · mixed live-capture + diagram + generated-footage essay · *"invent a visual style that should not resemble a tech explainer"*.

**Measurement dimensions:**

| Dimension | Metric | Why it matters |
|-----------|--------|----------------|
| Creative diversity | structural similarity across outputs; scene-count/layout/caption/transition/palette/narration-strategy overlap; repeated first/last-scene formulas; repeated built-in vocabulary | Does Narova cause convergence? |
| Creative quality (human) | originality, coherence, rhythm, emotional effect, prompt fidelity, intentionality, medium-appropriateness, memorability | Is the output good? |
| Creative capability | range of media used appropriately; motion sophistication; custom composition; metaphor quality; procedural/3D/generated use; whether the model is *limited by Narova's vocabulary* | Does Narova amplify capability? |
| Creative confidence | concepts explored before settling; genuinely different directions proposed; escape-hatch use; branching vs simplifying; recovery from failed ambitious attempts; avoidance of template convergence | Does the model *trust* the system enough to take risks? |
| Production quality | successful builds; visual defects; timing correctness; deterministic reproduction; accessibility; caption correctness; renderer failures | Reliable enough to build on? |
| Creative leverage | tokens/time to first viable result; invented implementation work; iterations needed; regeneration cost; edit locality; low-level debugging work | Does Narova reduce friction? |
| Creative ceiling | deliberately difficult artistic requests — does Narova help, stay neutral, or become the bottleneck? | The most important dimension. |

**Central questions the benchmark must answer:**
1. Does Narova increase quality **and** reliability **without** reducing diversity or creative ceiling?
2. Does Narova increase creative **capability**?
3. Does Narova increase creative **confidence** — and does that confidence come from **trustworthy capability** (feedback, reversibility, machinery) or merely from defaults/guidance?
4. Does Narova increase **originality, representational diversity, and ambition** vs the same model without it?

**Adversarial convergence probes (must be in the suite):** a brief that *explicitly* says "do not use built-in layout classes"; a brief requiring a custom shader; a brief requiring no captions and no narration; a brief whose edit follows a music bed. Score whether the Narova condition still converges on house grammar despite the instruction.

---

## 7. Escape-hatch map

The creative stack, top → bottom. "Drop-down" = how to reach more control. The map makes the creative ceiling explicit.

```
Level 0 — Creative intent + creative plan (thinking layer)
  Easy: audience, objective, emotional arc, beat map, representation strategy
  Cannot express: (it's a thinking layer, not an expression layer)
  Drop down: skip straight to any level
  Status: PROMPTED in prompt-to-video.md / SKILL.md. RFC P1 G to formalize.

Level 1 — Semantic elements (scene.elements)
  Easy: camera, lights, 3D primitives, characters, 7 actions in one line each
  Cannot express: anything outside the union of scene.three + scene.body vocab;
    actions draw/speak/react/follow/transform are rejected (not yet implemented)
  Drop down: compiles to Level 4 (scene.three) + Level 3 (scene.body)
  Status: IMPLEMENTED. compose/elements.js.

Level 2 — Portable visual tree (scene.visual)
  Easy: browserless-renderable scene compositions (14 node types)
  Cannot express: arbitrary HTML/CSS; 3D beyond inert canvas3d/model3d stubs
  Drop down: scene.body (Level 3) for HyperFrames
  Status: IMPLEMENTED. renderers/visual.js.

Level 3 — HTML / CSS / SVG (scene.body + theme.css)
  Easy: full browser visual expression, arbitrary HTML/CSS/SVG, project assets
  Cannot express: 3D, WebGL, procedural rendering, JS interactivity
  Drop down: scene.three (Level 4) or scene.threeModule (Level 5) for 3D;
    choreography/scriptFile (Level 6) for timing logic
  Status: IMPLEMENTED. Unlimited HTML/CSS/SVG surface (HyperFrames).

Level 4 — Declarative 3D (scene.three / scene.threeFile)
  Easy: timeline-driven Three.js — 12 primitives, models, groups, particles,
    MeshStandardMaterial (PBR), 5 lights, shadows, envMap, fog, camera animation
  Cannot express: custom shaders, post-processing, procedural geometry,
    custom materials, raw WebGL, custom render loops
  Drop down: scene.threeModule (Level 5)
  Status: IMPLEMENTED, bounded. 1 material type, 7 actions.

Level 5 — Raw Three.js / WebGL (scene.threeModule)  ← NEW
  Easy: arbitrary deterministic Three.js/WebGL — shaders, procedural geometry,
    post-processing, particle systems, custom materials, custom render passes
  Cannot express: (this is the floor of the 3D stack — anything within the
    determinism contract)
  Context in scope: THREE, scene, camera, renderer, tl, seed, size, duration,
    assets(), pending[], onRender(), narova{prng,cueTurn}
  Determinism: same as choreography (no Date/Math.random/rAF/setTimeout/fetch);
    linted by check
  Status: IMPLEMENTED (this audit). HyperFrames-only.

Level 6 — Project / per-scene choreography (config.choreography, scene.choreographyFile, scene.scriptFile)
  Easy: arbitrary GSAP timeline code; DOM transforms/opacity/className;
    cue-anchored timing; tl/DATA/gsap/cueTime in scope
  Cannot express: (intended) layout props, wall-clock APIs, own rAF;
    3D now reachable via scene.threeModule instead
  Drop down: this is the timing/DOM floor
  Status: IMPLEMENTED. Unsandboxed JS; determinism by contract + lint.
```

**Where is the creative ceiling now?**
- For **2D/DOM**: effectively unlimited (Level 3 HTML/CSS/SVG + Level 6 choreography).
- For **3D**: now effectively unlimited **within the determinism contract** (Level 5 `scene.threeModule`). The previous hard ceiling at Level 4 is removed.
- For **procedural 2D canvas / raw WebGL-without-Three**: a small remaining ceiling — RFC P1 F (`scene.canvas`).
- For **no-browser renderer**: 3D and Level-3 HTML are unavailable by design (it consumes only `scene.visual`); this is a documented renderer split, not a bug.

---

## 8. Final verdict

### If the same competent LLM has Narova versus does not have Narova, is its reachable creative video space larger, smaller, or merely easier to reach?

- **Before this audit's changes:** *Easier to reach for narration-driven explainer/social video, but smaller for ambitious/unconventional work.* Mandatory captions, narration-as-only-event-source, hook doctrine on all narrated projects, a bounded 3D vocabulary with a false escape hatch, and (above all) full-rebuild-on-any-change economics actively narrowed the effective creative space. A custom-shader 3D piece, a music-led silent film, or a "render only scene 4" iteration was *harder* in Narova than without it.
- **After this audit's changes:** *Larger, and still easier to reach.* The 3D ceiling is removed (`scene.threeModule`); the false hatch is replaced by a real one; generated media is editable source; correctness is distinguishable from craft; the determinism contract is enforced across every escape hatch; and change scope is visible (`build --plan`).
- **After the P0 scene-level render cache (RFC A):** *Materially larger and dramatically cheaper to explore.* That single change converts experimentation from "expensive" to "cheap", which is the dominant lever on creative confidence.

### Is the LLM meaningfully more creatively confident with Narova?

- **For safe, narration-driven work:** yes, and it was already — the sentence cache, `--reuse`, `plan`, determinism, and SRT/VTT export make *ordinary* iteration very confident.
- **For ambitious/unconventional work:** *now meaningfully so*, because the 3D hatch is real and documented, generated clips are revisable, and correctness warnings no longer masquerade as style. The remaining confidence gap is **experimentation cost** (full rebuilds) — closed by RFC A.

### Does that confidence come from trustworthy capability or merely guidance/defaults?

- **Increasingly from capability.** `scene.threeModule`, `.gen.json` provenance, the determinism scan, the `correctness:` category, and `build --plan` are trustworthy production machinery, not motivational language. The one place confidence still leans on *defaults* rather than capability is **house-style gravity** (palette + 30+ pattern classes) — that's taste leakage, addressable by RFC I.

### What must change for Narova to make the model much more creatively capable and confident?

1. **P0 — scene-level render cache** (RFC A): the dominant confidence lever. Per-scene hashes already exist; wire a consumer.
2. **P1 — general event system** (RFC C): make music-led / silent / beat-driven work first-class.
3. **P1 — draft/storyboard tiers** (RFC B): make preview cheap.
4. **P1 — capability-honest errors** (RFC E): help repair ambitious ideas, not simplify them.
5. **P1 — declared creative intent** (RFC D): craft advice that expands the option space instead of narrowing it.
6. **P1 — creative-plan layer + representation-knowledge reference** (RFC G): enlarge the model's imagination before it reaches implementation vocabulary.
7. **P2 — persistent branches** (RFC H): make bold forks safe and revisitable.

### What would make the creative space massively larger?

Two changes, together:

1. **A real scene-level render cache** — turns "try five radically different treatments of scene 4" from 5 full renders into 5 cheap span renders. This is the difference between a model that *settles* and a model that *explores*.
2. **A general event system** — frees video from the voice→cue ontology. Music, SFX, explicit markers, and captured interactions become first-class timing sources. The easy speech-sync path stays; speech stops being the *only* shape a Narova video can have.

Combined with the now-unlimited deterministic 3D surface (`scene.threeModule`), these would make Narova feel like the model suddenly gained a creative director, 3D artist, motion designer, editor, and production engineer — while leaving creative authorship with the model and the user, and preserving the determinism, reproducibility, local-first rendering, and revision locality that are Narova's spine.

---

### Appendix — verification method

Every claim above was checked against current source via direct reads + three parallel code-audit passes (captions-off, `check` lint, 3D/escape-hatch) + one economics audit (reuse/plan/manifest). The prior `CREATIVE_AUDIT.md`'s "FIXED" items were re-verified; one was found **inaccurate** (`scene.threeFile` is a JSON loader, not the proposed JS hatch) and one was **overstated** (the `correctness:` prefix was dead code). Both are corrected here. Full JS suite: **487 pass / 0 fail** (+17 new). Python suite: **81 pass / 0 fail**.
