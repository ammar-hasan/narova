# Prompt → video: intake, script craft, iteration

How to go from a user's plain-language request to a great narova video.
The mechanics of the config file live in `references/scene-script.md` — read
that after this one. This file is about judgment: what to make, how it
should sound, and how to revise it without surprising the user.

The stance: **you are the video's director.** The user brings a topic and a
vibe; you bring the script, structure, pacing, casting, and look. Make the
process feel like a delight, not a form to fill out.

## Intake: decide, don't interrogate

Pull from the prompt, in order: topic, audience, goal (teach / sell /
announce / entertain), format (`16:9` explainer vs `9:16` reel), length,
mood/brand (words like "playful", "dark", brand colors, a product name).
Whatever the prompt says or implies is decided — never re-ask it.

**A URL is source material, not a mood hint.** Before choosing copy, claims,
colors, fonts, or imagery, follow `references/url-to-source.md`. Classify it
first: product/brand site, article, paper, documentation, repository, or
general page. Do not art-direct or script from a search snippet, WebFetch
summary, metadata-only synopsis, or memory. Preserve exact names, titles,
claims, and taglines; never silently “improve” them. Every stat, superlative,
or factual assertion you put in the `vo` goes into the project's `claims.md`
(verbatim / paraphrase / inference + source) before synth — if you cannot
trace it, cut it.

### When to ask

Ask only when a gap would change the whole video and you cannot guess it
well. The short list:

- **Audience** that changes the script's level ("for kids" vs "for CFOs").
- **Goal** when the same topic cuts both ways (teach the paper vs hype it).
- **Hard requirements**: must-include content, names, a length limit.

Everything else — colors, fonts, voices, pacing, scene count, structure —
is your call. If you do ask: one short batch of at most 2–3 questions, each
with a default you'd pick ("I'll go with X unless you say otherwise"). Then
never ask again unless the user changes direction.

## Concept branching: prove directions before committing

Before writing the final project, form 2–3 meaningfully different creative
directions. Vary multiple orthogonal dimensions, not just palette. For an
ambitious or difficult brief, turn each direction into only the smallest visual
proof that can settle its risky claim, save it as a branch with rationale, then
choose. Do not generate three complete videos.

Vary at least two of these dimensions between concepts:

- **Temporal grammar** — continuous shot, fragmented montage, slow build, rapid edits
- **Spatial metaphor** — fixed frame, camera-led exploration, diagrammatic, physical space
- **Representation** — literal/evidence, symbolic/abstract, metaphorical
- **Visual material** — photography, type, 3D, illustration, UI/screen, code, raw data
- **Camera logic** — static, orbiting, dolly/zoom, none (type-centric), simulated handheld
- **Typography role** — information vehicle, physical material, absent, the entire visual
- **Information density** — sparse/breathing, dense/saturated, progressive, static
- **Audio relationship** — speech-led, music-led, SFX-led, silent, counterpoint
- **Narrative voice** — first person, second person, institutional, none, poetic
- **Diegetic vs designed** — real screen evidence, constructed graphics, mixed
- **Stability vs flux** — one stable composition system, transforming spaces
- **Repetition vs progression** — rhythmic loop, linear journey, fractal

For non-trivial briefs, generate at least one concept that deliberately rejects
the most obvious format archetype. Ask internally: "If the obvious explainer/
reel structure were forbidden, what would still communicate this brilliantly?"
The concept must still serve the brief.

Save each proof with its rationale:

```bash
narova synth && narova compose
narova shots --motion --proof
narova branch save proof-a --rationale "the procedural field makes accumulation tangible"
# Repeat for proof-b/proof-c after replacing only the small pilot config.
narova branch set proof-b --status approved
narova branch set proof-a --status rejected
narova branch show proof-b  # copy proofIdentity into creative-brief.md
narova release restore proof-b --overwrite
# Expand only now; record proof-b + its exact identity in the two lineage fields.
```

`shots --proof` writes an identity receipt only after the visibility audit
passes. `branch save` rejects stale frames or any config, manifest, timing, or
evidence change made afterward; rerun the small proof instead of attaching old
evidence to new source.

Record why the selected direction won. This enables future "try the rejected
surreal concept" requests without paying for three full productions.

Do not choose a direction merely because it is cheaper, faster, or fixes the
last version's most obvious defect. Select against the user's ambition and the
whole visual contract. "More cuts" does not repair a sparse world; "uses
Three.js" does not establish production value.

For simple or short requests, a single direction is fine.

## Creative confidence loop

Use this loop for non-trivial, reference-driven, expensive, or ambitious 3D
work. It lets the agent be bold without gambling a full production on an
unproven visual assumption.

1. **Diverge** — form 2–3 structurally different hypotheses.
2. **Specify** — fill `creative-brief.md`: intended effect, unusual hypothesis,
   evidence, constraints, representation, temporal behavior, medium choice,
   and observable rejection criteria. Carry decisive finished-artifact intent
   into root `assertions`; use measurable probes only for facts the metric
   actually represents. Add camera, depth, light, performance, or interaction
   fields only when the chosen medium actually uses them.
3. **Prove separately** — give each direction only the smallest decisive proof:
   a representative state plus the risky transition/detail/interaction, or an
   equivalent 8–12 second sequence. Save each as a branch with rationale.
4. **Commit** — run `narova judge` over each encoded proof when available, then
   compare the 2–3 rendered proofs directly with the evidence, reference, and
   written intent. Treat the report as expanded perception rather than a vote;
   `UNCERTAIN` is a prompt for direct inspection, and an intentional divergence
   may be exactly the discovery worth keeping. Approve one branch; reject or archive the others. Set
   `Status: approved` only when the selected proof passes.
5. **Expand once** — restore the approved branch, record its exact proof identity
   in the brief's expansion-lineage fields, then build the complete work from
   it. Saved CLI overrides such as `--variant` are reapplied automatically.
   Preserve its coherent rules without drifting scene by scene.
6. **Reject observably** — run beat-level QA and Video CI over the encoded
   output. Reject only against the declared, medium-specific intent and
   evidence: invisible change, lost evidence, ambiguous interaction, broken
   continuity, or reference mismatch. Creative interpretation remains with the
   directing agent; no universal pacing, clarity, or engagement rule applies.

The brief is a creative launchpad, not paperwork. It gives the model enough
specificity to make confident decisions without collapsing into generic defaults.

## Craft knowledge

Video craft is real and useful. But craft conventions are context-dependent —
they are tools useful in the right context, not universal laws of video.

When craft knowledge applies, use it. When it doesn't, don't.

For optional craft profiles that encode specific video-grammar conventions
(social-short hooks, explainer pacing, 3D quality, accessibility), run
`narova critique [profile]`. These are creative guidance, not correctness gates.

Use `narova critique creative` to challenge production readiness and pilot
approval. Combine profiles when useful, for example
`narova critique creative,cinematic` for a long 3D film.

Some conventions that are useful in the right context but NOT universal:

- A social reel might benefit from a fast hook, visible on-screen text for
  muted viewers, and a saveable end-frame.
- A meditation aid might open with silence and end intimately.
- A brand film might deliberately ask a question instead of issuing a CTA.
- A music video needs no narration, no captions, no CTA.
- A cinematic scene might use one continuous shot with no text at all.

The right grammar serves the film. That's the only rule.

## Video formats

Pick the shape from the prompt. These are starting points, not templates.

**Explainer** — a journey from question to understanding. Typically has
structure (hook → problem → insight → impact) but vary proportions
deliberately.

**Short-form reel** — one core message, delivered in the grammar of the
platform. Fast hooks and clear payoffs matter here.

**Teaching aid** — one concept per scene, supplemental visuals. Segments,
signals, and active engagement beats help retention.

**Research walkthrough** — hook with the surprising result, then explain
the key idea in plain terms. Translate jargon as you introduce it.

**Two-host dialogue** — asymmetric roles: curious questioner + deep explainer.
Conversational glue (banter, reactions, questions) holds it together.

**Single-narrator promo** — one confident voice carrying a brand/product
story. Hook → proof beats → transformation.

**Demo walkthrough** — show the product doing the work, narrate what matters.
Second person, present tense, one action per beat.

**Myth vs fact** — the tension IS the structure. Pair a comfortable assumption
with evidence that breaks it.

**Silent / music-driven** — the timeline is the clock, not the voice.
Markers, scene durations, and motion carry the structure.

**Abstract / experimental** — shape, color, rhythm, and feeling. The brief
determines whether the result is literal, metaphorical, or procedural.

Choose the cast, density, pacing, and visual language per brief.

## Script craft: the numbers

- **Pace**: explainers 130–150 wpm, technical/teaching 110–130,
  conversational 140–160, high-energy social 160–180. Faster, enthusiastic
  narration keeps engagement even in education — don't slow to a crawl; add
  scene breaks instead.
- **Length → words**: 30s ≈ 60–80 words · 60s ≈ 130–160 · 90s ≈ 200–240 ·
  2min ≈ 260–300. Count the words in your `vo` before you synth — `narova
  check` prints the estimated narration length (word count × tempo plus the
  fixed gaps), so tune words and `timing.tempo` against the user's target
  duration before any audio exists, not after measuring three renders.
- **Turns are short**: 1–3 sentences each. Long monologue turns kill the
  conversational rhythm. If a sentence needs a breath mid-way, split it.
- **Write for the ear**: second person, contractions, plain words. Read it
  aloud in your head — if it sounds written, rewrite it.
- **Show, don't tell**: never narrate what the screen already shows; the
  `body` carries the visual, `vo` carries the meaning. Fewer words on screen
  than spoken — the captions already show the transcript.
- **Framing is a choice; own it.** On contested topics, accurate claims can
  still add up to a one-sided story. Ledger the major perspectives
  (`references/url-to-source.md` §3), attribute contested assertions to
  their claimants, and re-read the finished `vo` asking "whose framing is
  this?" No lint catches bias — this read is the gate.

## Videography: never ship the template

The baseline failure mode: every video comes out dark-navy, teal accent,
centered title card on every scene. That is one video, re-skinned. Each
prompt gets its own visual language — you are the director, so direct:

- **Palette from evidence.** For a brand URL, use verified brand tokens. For
  an article/paper/docs URL, let the subject and source figures lead; publisher
  chrome is context, not automatically the theme. For a text brief, derive
  tokens from the stated brand or mood. Default picks nothing — the base is
  production infrastructure only. Set `theme: { accent, bg, ... }` for a
  deliberate palette.
- **Format from the platform.** `9:16` for reels/shorts/TikTok, `1:1` for
  feed posts, `16:9` for explainers and teaching. Decide it from where the
  video will live.
- **Vary the layouts or build your own.** The built-in menu (opt-in via
  `patterns: true`) has cards, splits, big stats, quotes, steppers, flows,
  verdicts, ledgers, dials. Use them when they serve the beat. Write custom
  HTML/CSS/SVG when the concept needs an original visual voice.
- **Density follows energy.** Reels: one big element per beat, huge type,
  generous gaps. Teaching: denser, structured, numbered. Announcement: bold
  single statements.
- **A signature move per video.** One thing this video owns: a custom font
  stack or wordmark in `theme.css`, a recurring chip motif, a numbered-act
  convention, a repeated visual rhyme between hook and close.
- **Chrome is optional.** `chrome: false` strips the topbar, counter, and
  progress bar. `chrome: { counter: false }` keeps a wordmark-only topbar.
  A brand promo with the brand's own header treatment beats the default topbar.
- **Caption treatment is a creative choice.** `captions: false` removes the
  visual band (SRT/VTT still export). Pick a preset (karaoke/slam/pop/rise)
  or write your own CSS. Captions can be hidden, restyled, or removed
  entirely — not every work needs word-by-word karaoke.
- **Self-check before synth:** if this config could become someone else's
  video by swapping only the words, art-direct harder.
- **Creative-identity contract (unattended mode):** when no human will review
  the look, write a short `creative.md` in the project before authoring,
  declaring per style family (palette/theme, transitions, animations,
  graphics/layout) the chosen direction and its provenance — `brief` (quote
  the clause), `brand` (verified token), `source` (evidence file), or
  `invented`. Add the machine-readable claims block so `narova check` can
  verify it:
  ```markdown
  palette: <tone family, e.g. "dark cool navy" or "light cream warm">
  provenance: <brief | brand | source | invented>
  structure: <grammar, e.g. "montage" | "linear journey" | "single shot">
  motion: <vocabulary, e.g. "reveal + draw" | "kinetic type" | "none">
  ```
  `narova check` then verifies the claims against the measured identity
  (flagging contradicted or under-authored choices) and compares against the
  local fingerprint-only ledger of your recent projects (flagging
  near-identical siblings — legitimate for a brand series, a defect for
  unrelated briefs). `narova check --creative-identity` also writes
  `out/creative-identity.json` as a readable record. These surfaces are
  advisory only: they never fail the build. Use them whenever the same
  author runs many briefs unattended — this is the mechanism that keeps each
  prompt from becoming one re-skinned video.
- **Media check before synth:** if the source has useful logos, product
  imagery, figures, diagrams, screenshots, or people and the video uses none
  of them, revisit the art direction.
- **Proof check before scale:** for costly or ambitious work, do not author the
  whole timeline until 2–3 small proof branches have been rendered, compared,
  and one selected against the declared intent and rejection criteria.

For craft advice on hook, saveable end-frame, duration bands, 3D quality,
or accessibility, run `narova critique [profile]`. This is optional
guidance, not a gate — skip it when the work does not follow social-video
grammar.

## Casting the voices

Casting serves the concept, not a default formula. Pick the number of voices
and the specific speakers that fit the piece: a solo narrator for a promo or
essay, two hosts when the work is a conversation or debate, more only when the
format needs it (a panel). Match roles (questioner/explainer, protagonist/foil)
to voices that read the way the characters should sound, and keep the casting
fixed for the whole video — and across revisions. There is no prescribed
male/female duet; choose voices on suitability, not on a default pairing.

## Iterating: no surprises

The consistency contract: **a revision changes only what the user asked
for.** Everything else — every other line, scene, voice, color, timing —
stays identical, and narova's machinery backs you up:

- Keep the config stable: same scene `id`s, same voices, same `timing`,
  same theme. Edit surgically — the exact turn or body the user named,
  nothing "improved" alongside.
- **Visual-only edit** (body HTML, theme, cues): `narova build --reuse` —
  audio and timings are replayed untouched. `--reuse` is guarded: if the
  spoken text did change, it is ignored with a note and the changed
  sentences re-synthesize, so picking the wrong command cannot ship stale
  audio.
- **Spoken-text edit**: plain `narova build`. The sentence cache
  (`~/.narova/cache/sentences/`) re-synthesizes ONLY the changed sentences —
  untouched scenes come out byte-identical. Never reword unchanged lines
  "for flow"; that re-voices them.
- Before re-rendering, run `narova check` and sanity-check the new shape:
  scene count, word budget, cue targets.
- Run HyperFrames `check` on the composed project and fix real layout and
  contrast findings in source. Do not dismiss them as pipeline noise; only the
  known generated-contract warnings should disappear at the generator level.
- After the build, tell the user exactly what changed and what provably
  stayed the same. That sentence is the trust this whole tool runs on.

## Working with the user

- **Pilot to commit, beat snapshots to verify, preview to watch, render to
  ship.** Composing is cheap; rendering is the commitment. After `compose`,
  run `narova shots --beats` for narration/marker-driven work and inspect both
  the arriving and resolved state of every beat. Use `shots --motion` for
  scene-level coverage. Judge composition, action, depth, light, continuity,
  and the written visual contract—not only layout and technical correctness.
  Studio preview is the live look for the user; it does not hot-reload, so
  `compose`/`build` restart a live detached preview on the new build
  automatically. Show the preview, say what you made and why in two
  sentences, and offer the 2–3 most likely next moves ("shorter? punchier
  hook? different closer?") instead of an open "so what do you think?".
- Guide wholeheartedly, then get out of the way. Suggest once, don't push.
  When the user gives a direction, that's the direction.
- Celebrate the artifact, not yourself. "Here's your video" beats "I did X".

## Sources

The rules above are distilled from public video-scripting guidance and
comparable script-to-video projects. Word counts and WPM: soundbrandingideas.com,
prepublish.ai, mypromovideos.com. Explainer beats: wpswings.com, gisteo.com.
Hook window: scriptstorm.ai, ltx.io, inro.social. Teaching principles
(segment/signal/weed, ≤6 min, modality): Brame 2016, CBE—Life Sciences
Education (pmc.ncbi.nlm.nih.gov/articles/PMC5132380). Multi-host podcast
casting: github.com/zarazhangrui/personalized-podcast. Scene-as-unit model:
github.com/gyoridavid/short-video-maker.
