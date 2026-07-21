# Hard-won learnings (read before touching the pipeline)

These are real bugs we hit and fixed. Every one cost time.
Keep the fixes in the code so they never come back.

## Audio / timing

1. **`loudnorm` shortens audio (~2.9% per scene) → captions drift.**
   We computed word times from the audio pieces BEFORE loudnorm. The final
   audio was shorter, so captions fell more and more behind the voice.
   **Fix (mandatory):** after making each scene's final wav, measure its real
   length and multiply all word/turn times by `real / computed`. loudnorm
   shrinks the whole scene evenly, so one factor is exact. See
   `rescale_timings()`. Verify: sum of scene durations == length of the
   joined audio, within a few ms.

2. **Word timing is computed, not measured.** We synthesize each sentence
   alone (so we know its length) and spread the words across it, weighted by
   word length. Good enough for karaoke captions. No forced-aligner needed.

3. **Control the pauses yourself.** Neural TTS pauses randomly on
   punctuation. We synthesize sentence by sentence and insert fixed silence:
   sentence gap ~0.24–0.30s, speaker change ~0.44–0.52s, lead ~0.16s,
   tail ~0.6s. This makes pacing even.

4. **Add tiny fades (~12ms) at every splice point** or you hear clicks.

5. **Loudness: use `loudnorm=I=-16:TP=-1.5:LRA=11`.** Raw XTTS peaks near
   0 dBFS (clips), and the two voices differ in loudness. loudnorm fixes
   both — but it changes duration, so the rescale in #1 is required.

## XTTS-v2 (coqui-tts) on a modern stack — use the NEW libs, do not downgrade

6. **`transformers` 5.x removed `isin_mps_friendly`**, which coqui-tts
   imports. Do NOT pin transformers old. Shim it (~5 lines) in
   `xtts_compat.py`, imported BEFORE `from TTS.api import TTS`. Edge case:
   `test_elements` can be a 0-dim tensor — `unsqueeze` it, or MPS throws
   `IndexError: tuple index out of range`.

7. **torch ≥2.9 needs `torchcodec`** for audio IO (`pip install torchcodec`).

8. **`COQUI_TOS_AGREED=1`** must be set or the model will not load.

9. **The XTTS `speed` option is broken** (1.12 made audio LONGER). Never use
   it. Speed up with ffmpeg `atempo` instead, and compute duration as
   `probe(raw) / tempo`.

10. **XTTS runs on Apple MPS** once shimmed (~17s load, 2–7s per sentence).
    Model download is ~1.87GB, one time. 58 built-in speakers; pick two
    different ones for the duet.

## Rendering — HISTORICAL (replaced by HyperFrames in 0.3.0)

> Items #11–#17 describe the old homemade renderer (own player + Chrome
> screenshots + ffmpeg + a serve command). 0.3.0 deleted it; HyperFrames owns
> preview and render now. The items stay because they explain WHY the rescale
> in #1 exists. New rendering learnings:
> (a) a comment before `<!doctype html>` makes hyperframes lint reject the
>     file as a fragment;
> (b) a background on the composition ROOT can render black — put it on a
>     full-size child;
> (c) scene clip starts must be a running sum of already-rounded durations,
>     or the overlap lint fires;
> (d) CSS `animation: ... infinite` and transitions break under seek-based
>     rendering — all motion goes on the paused GSAP timeline.

11. *(historical)* Homebrew ffmpeg often lacks libass, so subtitle filters
    are unavailable. We rendered the mp4 from the HTML player itself: a
    deterministic "still at time T" mode plus headless-Chrome screenshots.
12. *(historical)* Capture one frame per word start, not fixed fps. The
    screen only changes at word starts. ~800 frames instead of ~11,000.
13. *(historical)* Headless Chrome can hang after writing the screenshot.
    Fix: 45s timeout + own process group + re-shoot empty frames.
14. *(historical)* ffmpeg `-shortest` cuts the mp4 if frame total ≠ audio
    total. After the #1 rescale they match; assert it.
15. *(historical)* Still mode set `html[data-still]` so animations settle
    instantly while un-fired cues stay hidden.
16. *(historical)* Build scene DOM with `appendChild` (not
    `insertBefore(firstChild)`, which reverses order).
17. *(historical)* Python's `http.server` has no Range support, so video
    seeking breaks. We shipped a 206-capable server. Gone in 0.3.0.

## Small stuff

18. Subprocess stdout is block-buffered when piped to a file. Progress lines
    appear late. Use `flush=True`.
19. `ffprobe -of default=np=0:nk=1` (short form) fails on some builds. Use
    the long form: `default=noprint_wrappers=1:nokey=1`.
20. The ffmpeg `subtitles=` filter cannot parse some absolute paths. Run with
    `cwd` set and a relative filename.
21. macOS `say --data-format` conflicts with `.aiff` output — omit it.
22. **espeak-ng (inside piper) breaks on long install paths** (~160-char
    internal buffer). A venv deep in a temp folder fails with
    `Error processing file '.../phontab'`; the same install at a short path
    works. The default `~/.narova/venv` is short on purpose.
23. **A detached Studio preview serves stale output after `compose`.** Studio
    holds `out/hf` open; compose deletes and recreates that directory, so the
    preview shows the old build or an empty `00:00 / 00:00` canvas — and a
    browser refresh does NOT recover it. Fix: `preview --detach` restarts a
    running server on the new build (port remembered in `preview.port`), and
    `compose`/`build` warn when a preview is live. Snapshots are the
    verification tool; Studio is for watching.
24. **Light themes need tokenized chrome, not `#bg` overrides.** The base
    stylesheet hardcoded dark values (`#0c1526` chips, `#5f6f8e` caption idle
    words, teal `rgba(46,230,214,…)` glows) outside the theme tokens, so a
    light-brand site meant `!important` on `#bg` plus a cascade of contrast
    failures. Fix: every surface value is a token (`deep, halo, chip,
    capidle, onaccent, track`) and `theme.mode: "light"` swaps the set.
25. **Box-based overlap lint misses oversized display type.** A big `vw`
    font with `line-height` < 1 paints outside its element box; lint compares
    boxes, not glyphs, so a giant stat can overlap the eyebrow above it and
    pass. Verify display type with snapshot frames; keep `line-height >= 1`.
26. **Grounding needs a gate, not prose.** "Match the source" guidance alone
    did not stop fabricated stats (an invented hook number, an inflated
    "leading"/"2,000+"). Fix: a `claims.md` ledger (verbatim / paraphrase /
    inference + source) is required before synth, and `check` sniffs `vo`
    for stats/superlatives with no ledger present.

## Usability fixes (0.6.0, from a real customer session)

27. **GSAP tweens destroy SVG `transform` attributes.** A `.reveal`/`.cue` on
    `<g transform="translate(x,y)">` renders the group at the origin — GSAP's
    CSS transform replaces the presentation attribute. Fix: at load, the
    runtime wraps any animated SVG element carrying `transform` in a fresh
    `<g>`, moves the animation classes/attrs to the wrapper, and tweens that
    (`shieldSvgTransform` in compose/runtime.js).
28. **Entrance-only motion limited infographics.** There was no way to grow a
    bar, draw a path, or count a number. Fix: timeline animators `data-grow`
    (scaleX tween), `data-draw` (stroke-dashoffset tween), `data-count`
    (stepped `tl.set` on textContent — a callback-driven tween is NOT used
    because seeks suppress events), plus `data-delay` to control stagger.
    All seek-safe; CSS animation stays banned.
29. **Page-wide id uniqueness blocked reusable SVG.** Gradient `<defs>` ids
    collided across scenes on the single page, forcing flat fills. Fix:
    compose namespaces every body id to `<sceneId>--<id>` and rewrites the
    body's own `url(#…)` / `href="#…"` / `for` / aria references
    (compose/html.js `namespaceIds`). Ids must be unique only within a scene;
    theme.css `#id` selectors silently stop matching, so `check` warns on them.
30. **Fixed chrome + no auto-fit = manual collisions.** Tall scenes slid under
    the topbar/caption band while box-lint reported 0 issues. Fix: the canvas
    reserves the caption band height (`padding-bottom:clamp(84px,15vh,170px)`)
    and the column width is a token (`--colw`, default 1000px). There is still
    no auto-fit — cap tall visuals by hand and trust `narova shots` frames,
    not lint. Contrast lint also false-positives on decorative glyphs.
31. **`--reuse` correctness was author-tracked.** Stale audio shipped if you
    reused after editing `vo`. Fix: `resolveReuse()` compares the new
    narration against the `narration.json` the last synth consumed and
    silently upgrades to a full synth on any difference.
32. **cwd broke commands.** Running narova from `out/hf` (after a hyperframes
    `cd`) failed with "No config found". Fix: `findConfig` walks up to the
    nearest ancestor holding a `reel.config.*`.
33. **Stale detached previews needed manual restarts.** Studio serves the
    deleted `out/hf` (LEARNINGS #23). Fix: `compose`/`build` now restart a
    live detached preview on the new build automatically (same port); the
    warning is only a fallback if the restart fails.
34. **Duration was emergent, not targetable.** Length was unknown until audio
    existed. Fix: `narova check` prints an estimated narration length
    (~170 wpm × tempo + fixed gaps, calibrated against real piper builds)
    so word count/tempo can be tuned to a target duration before synth.
35. **The piper starter list read as "3 voices".** Any piper catalog voice
    works via `voices get`; the list now shows a spread of 9 (gender/accent)
    so multi-host casts don't reach for the heavy backends by default.
36. **Sourcing was gated, framing was not.** A one-sided narrative of sourced
    claims passed every check. Fix is procedural, not code: `claims.md` must
    cover the major perspectives on contested topics, and the script gets a
    "whose framing is this?" read before synth (url-to-source.md §3).

## The scene model that worked

- Big word-synced captions + a richer voiceover. Do not put the transcript
  on screen.
- Reactive reveals: elements with `data-cue="k"` appear when turn `k` starts.
  Everything else appears at scene start.
- Two hosts trading lines, with questions and banter, read far better than
  one narrator. Color the active caption word by speaker.
