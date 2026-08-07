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

## Concept branching: try directions before committing

Before writing the final project, briefly sketch 2–3 meaningfully different
creative directions. Vary multiple orthogonal dimensions, not just palette.
The goal: surface the strongest approach before investing in scene-level detail.

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

Record the rationale for each direction and why you picked the final one.
This enables future "try the rejected surreal concept" requests.

For simple or short requests, a single direction is fine.

## Craft knowledge

Video craft is real and useful. But craft conventions are context-dependent —
they are tools useful in the right context, not universal laws of video.

When craft knowledge applies, use it. When it doesn't, don't.

For optional craft profiles that encode specific video-grammar conventions
(social-short hooks, explainer pacing, 3D quality, accessibility), run
`narova critique [profile]`. These are creative guidance, not correctness gates.

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
- **Media check before synth:** if the source has useful logos, product
  imagery, figures, diagrams, screenshots, or people and the video uses none
  of them, revisit the art direction.

For craft advice on hook, saveable end-frame, duration bands, 3D quality,
or accessibility, run `narova critique [profile]`. This is optional
guidance, not a gate — skip it when the work does not follow social-video
grammar.

## Casting the voices

The cast follows the shape (§Video shapes): a promo gets one narrator, a
duet-driven shape gets two hosts, one male + one female (piper
`en_US-ryan-high` + `en_US-hfc_female-medium`). More than two only when the
format needs it (a panel). Match the questioner/explainer roles to the
voices and keep the casting fixed for the whole video — and across revisions.

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

- **Snapshot to verify, preview to watch, render to ship.** Composing is
  cheap; rendering is the commitment. After `compose` (which prints every
  scene's start time), run `narova shots` and look at one frame per scene —
  that is the verification step (layout, overlap, contrast, framing).
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
Education (pmc.ncbi.nlm.nih.gov/articles/PMC5132380). Two-host casting:
github.com/zarazhangrui/personalized-podcast. Scene-as-unit model:
github.com/gyoridavid/short-video-maker.
