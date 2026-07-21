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

## Video shapes

Pick the shape from the prompt, then follow its structure. Word budgets
assume ~140 wpm (see numbers below).

**Explainer** (60–90s, `16:9` or `1:1`) — hook (5–10s) → problem (~30% of
runtime) → solution + how it works (~40%) → proof → one CTA (5–10s). End on
the transformation, not a tagline. One idea per scene, one CTA per video.

**Short-form reel** (15–45s, `9:16`) — the hook owns the first 2–3 seconds;
viewers decide to stay or scroll there. Write the hook first: name the
viewer + their problem, open a curiosity gap, or make a bold claim. Script
the hook twice: spoken line AND on-screen text (many watch muted). Then one
core message, then the payoff. One idea per video — no exceptions.

**Teaching aid** (≤6 min; split longer topics into parts) — one concept per
scene (segment); put 2–3 key words on screen to flag what matters (signal);
cut anything that doesn't serve the learning goal (weed). Visuals must
complement the narration (the diagram of the thing being explained), never
duplicate it. Use "you/your", speak with energy, and ask a guiding question
before a hard beat so viewers process actively.

**Research-paper walkthrough** (2–4 min) — hook = the paper's surprising
result → the problem it attacks → the key idea in plain words → one worked
example → why it matters. Translate jargon; the moment a term appears, the
next turn explains it. A questioner/explainer duet shines here.

**Two-host dialogue** (any length) — one narova shape, not THE shape. Cast
asymmetric roles: one host is the curious questioner (proxies the audience),
the other the explainer (depth, wit). Questions are scene transitions
("So how does it actually work?") — they reset attention. Reactions and
light banter ("Wait, really?") are the glue, not the payload. Target: two
friends talking over coffee — not news anchors, not a lecture.

**Single-narrator promo** (30–90s) — the right default for a brand/product
URL. One confident voice, no duet: hook → what it is → three proof beats →
CTA. The duet's "what if / let me show you" formula on a brand site reads as
an ad template; a direct narrator lets the brand's own voice lead.

**Demo walkthrough** (30–120s) — show, then tell. Narration describes what
the screen is doing while `data-cue` reveals perform it: "Pick a category…
tap to order… it shows up at your door." Best for products whose UI or
flow is the proof. Second person, present tense, one action per turn.

**Myth vs fact / contrast** (30–60s) — the questioner states the comfortable
assumption ("Groceries online means compromise on freshness"), the explainer
breaks it with evidence. The duet earns its keep here because the tension IS
the structure. Verdict/contrast layouts (`.verdicts`, `.homes`) carry it.

Pick the shape deliberately per brief. Three videos in a row should not
share a script formula any more than they share a palette.

## Script craft: the numbers

- **Pace**: explainers 130–150 wpm, technical/teaching 110–130,
  conversational 140–160, high-energy social 160–180. Faster, enthusiastic
  narration keeps engagement even in education — don't slow to a crawl; add
  scene breaks instead.
- **Length → words**: 30s ≈ 60–80 words · 60s ≈ 130–160 · 90s ≈ 200–240 ·
  2min ≈ 260–300. Count the words in your `vo` before you synth.
- **Turns are short**: 1–3 sentences each. Long monologue turns kill the
  conversational rhythm. If a sentence needs a breath mid-way, split it.
- **Write for the ear**: second person, contractions, plain words. Read it
  aloud in your head — if it sounds written, rewrite it.
- **Show, don't tell**: never narrate what the screen already shows; the
  `body` carries the visual, `vo` carries the meaning. Fewer words on screen
  than spoken — the captions already show the transcript.

## Videography: never ship the template

The baseline failure mode: every video comes out dark-navy, teal accent,
centered title card on every scene. That is one video, re-skinned. Each
prompt gets its own visual language — you are the director, so direct:

- **Palette from evidence.** For a brand URL, use verified brand tokens. For
  an article/paper/docs URL, let the subject and source figures lead; publisher
  chrome is context, not automatically the theme. For a text brief, derive
  tokens from the stated brand or mood.
  not from habit. A fintech explainer is not a kids' reel is not a security
  postmortem. The stage glows, progress bar, and caption highlights all
  follow the tokens — a warm palette gets a warm stage automatically.
- **Format from the platform.** `9:16` for reels/shorts/TikTok, `1:1` for
  feed posts, `16:9` for explainers and teaching. Decide it from where the
  video will live (ask only if the prompt gives no hint).
- **Vary the layouts.** The built-in menu (`references/scene-script.md`
  §Built-in scene layouts) has cards, splits, big stats, quotes, steppers,
  flows, verdicts, ledgers, dials. A 5–8 scene video should use at least
  three or four distinct layouts. Match layout to beat: the shocking number
  gets `.stat`, the process gets `.flow`, the comparison gets `.verdicts` or
  `.homes`, the thesis gets `.bigquote`, the close gets `.s-close`.
- **Density follows energy.** Reels: one big element per beat, huge type,
  generous gaps. Teaching: denser, structured, numbered. Announcement: bold
  single statements. Pace (`timing`) follows too — a reel runs tighter gaps
  and a hotter tempo than a lecture.
- **A signature move per video.** One thing this video owns: a custom font
  stack or wordmark in `theme.css`, a recurring chip motif, a numbered-act
  convention, a repeated visual rhyme between hook and close. Small,
  deliberate, and it must not loop (`animation: infinite` breaks rendering).
- **Chrome is optional, and it's part of the look.** The topbar wordmark,
  NN / NN counter, and progress bar are byte-identical across every narova
  video — three videos in, they rhyme. Restyle them in `theme.css`, or cut
  what the video doesn't need: `chrome: false` strips them,
  `chrome: { counter: false }` keeps a wordmark-only topbar. A brand promo
  with the brand's own header treatment beats the default topbar.
- **Self-check before synth:** if this config could become someone else's
  video by swapping only the words, art-direct harder.
- **Media check before synth:** if the source has useful logos, product
  imagery, figures, diagrams, screenshots, or people and the video uses none
  of them, revisit the art direction. Use brand assets for brand-led videos;
  use source figures and subject-native visuals for articles and papers.

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
  audio and timings are replayed untouched.
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
  cheap; rendering is the commitment. After `compose`, snapshot one frame
  per scene and look at them — that is the verification step (layout,
  overlap, contrast). Studio preview is the live look for the user, and it
  does not hot-reload: re-run `preview --detach` to restart it on the new
  build. Show the preview, say what you made and why in two sentences,
  and offer the 2–3 most likely next moves ("shorter? punchier hook?
  different closer?") instead of an open "so what do you think?".
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
