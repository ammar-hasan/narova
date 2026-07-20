# Hard-won learnings (read before touching the pipeline)

These are real bugs we hit and fixed while building the reference implementation.
Every one cost time. Encode the fix into the product so it never comes back.

## Audio / timing

1. **`loudnorm` compresses duration (~2.9% per scene) → caption drift.**
   FFmpeg's `loudnorm` filter makes the output shorter than the input. Our word/frame
   timeline was computed from the *pre-loudnorm* pieces, so captions drifted further behind
   the voice as the video played (0 at start, ~11s off by the end of a 6-min video).
   **Fix (mandatory):** after building each scene's final (post-loudnorm) wav, measure its
   real duration and *rescale* that scene's word/turn timestamps by `actual/computed`. The
   compression is uniform per scene, so linear rescale is exact. See `rescale_timings()`.
   Verify: `sum(scene.dur in timings) == duration(concatenated audio)` to the millisecond.

2. **Karaoke word timing is derived, not measured.** We synthesize each *sentence*
   separately (known duration) and distribute words across it weighted by word length.
   Good enough for karaoke; no forced-alignment dependency. Keep this approach unless you
   add a real aligner.

3. **Control the pauses yourself.** Neural TTS pauses inconsistently on punctuation. We
   synth sentence-by-sentence and splice fixed silence gaps (sentence ~0.24–0.30s, speaker
   change ~0.44–0.52s, lead ~0.16s, tail ~0.6s). This makes pacing even instead of hit-or-miss.

4. **Add tiny fades (≈12ms) at every sentence splice** or you get audible clicks at the joins.

5. **Peak control:** raw XTTS peaks near 0 dBFS (clips). `loudnorm=I=-16:TP=-1.5:LRA=11`
   gives broadcast headroom AND consistent loudness across the two voices — but see #1, it
   changes duration, so the rescale is required. (A duration-preserving `alimiter` avoids the
   drift but doesn't equalize perceived loudness between speakers.)

## XTTS-v2 (coqui-tts) on a modern stack — use the NEW libs, don't downgrade

6. **`transformers` 5.x removed `isin_mps_friendly`** which coqui-tts's tortoise layer imports.
   Do NOT pin transformers old. Shim it back (it's ~5 lines) in `xtts_compat.py`, imported
   *before* `from TTS.api import TTS`. **The scalar case matters:** `test_elements` can be a
   0-dim tensor — `unsqueeze` it, or you get `IndexError: tuple index out of range` on MPS.

7. **torch ≥2.9 needs `torchcodec`** for audio IO (`pip install torchcodec`). Newer TTS
   `__init__` imports `is_torchcodec_available`.

8. **`COQUI_TOS_AGREED=1`** env var is required or the model won't load (license gate).

9. **XTTS `speed` param is broken/inverted** in the current build (speed=1.12 produced
   *longer* audio). Do not use it. Speed up with ffmpeg `atempo` instead (pitch-preserving),
   and account for the new duration in the timing computation (`probe(raw)/TEMPO`).

10. **XTTS runs on Apple MPS** once shimmed (loads from cache in ~17s, ~2–7s/sentence).
    Model download is ~1.87GB, one-time. 58 built-in studio speakers; pick two distinct ones
    for a two-host duet (we used "Damien Black" / "Sofia Hellen").

## Rendering the MP4 — HISTORICAL (superseded by HyperFrames in 0.3.0)

> #11–#17 describe the homemade renderer (player + Chrome screenshots + ffmpeg
> assemble + range server) that 0.3.0 deleted. HyperFrames now owns preview and
> render. They stay here because they explain WHY the timing rescale (#1) exists
> and what the old pipeline guaranteed. New rendering learnings: (a) a comment
> before `<!doctype html>` makes hyperframes lint treat the file as a fragment;
> (b) a background on the composition ROOT can render black — put it on a
> full-bleed child; (c) scene clip starts must chain as a cumulative sum of
> already-rounded durations or the same-track overlap lint trips; (d) CSS
> `animation: … infinite` and transitions are nondeterministic under seek-based
> frame rendering — all motion goes on the paused GSAP timeline.

11. *(historical)* **Homebrew ffmpeg often lacks libass** → the `subtitles`/`ass` filters don't exist.
    Don't rely on burning subtitles. Instead we render the MP4 *from the actual HTML player*:
    a deterministic "still at time T" mode (`window.VF_STILL(t)` / `?t=SECONDS`) renders the
    exact frame (captions highlighted to t, cues revealed up to their turn), and we screenshot
    keyframes with headless Chrome. Upside: the MP4 is pixel-identical to the interactive page.

12. *(historical)* **Capture at word onsets, not fixed fps.** The visual only changes when the active caption
    word or a reveal changes — both happen at word onsets. ~700–830 keyframes for a 6-min video
    instead of ~11,000. Each frame held for `next_onset - onset` via ffmpeg concat `duration`.

13. *(historical)* **Headless Chrome hangs after writing the screenshot.** A hung `chrome --screenshot`
    subprocess blocks the whole capture pool at 0% CPU forever. **Fix:** `timeout=45` +
    `start_new_session=True` on the subprocess; the PNG is written before it hangs. Then
    re-shoot any missing/zero-byte frames (a bad frame truncates the whole MP4 under `-shortest`).

14. *(historical)* **`-shortest` truncates to the shortest stream.** If the frame-concat total ≠ audio total,
    the MP4 is cut. After the timing rescale (#1) they match; assert it.

15. *(historical)* **Deterministic still render:** in still mode set `html[data-still]` so animations settle
    instantly (`.reveal`, `.cue.lit` → final state, no transition) while *un-lit* cues stay
    hidden — that's what makes the reveals reactive in the captured frame.

16. *(historical)* **Scene DOM order:** if you build scenes with `insertBefore(firstChild)` you reverse them;
    use `appendChild` and z-index the HUD/caption overlay above the scenes.

## Serving — HISTORICAL (HyperFrames Studio owns preview now)

17. *(historical)* **Python's `http.server` has no Range support** → video seeking is broken (returns 200,
    not 206). Ship a tiny range-capable handler (206 + `Accept-Ranges` + `Content-Range`),
    threaded, so browsers can scrub.

## Small stuff

18. Subprocess **stdout is block-buffered** when redirected to a file — progress lines don't
    appear until flush/exit. Not a bug; use `flush=True` or watch artifacts instead.
19. `ffprobe -of default=np=0:nk=1` short form is rejected on some builds — use the long form
    `default=noprint_wrappers=1:nokey=1`.
20. The `subtitles=` ffmpeg filter can't parse some absolute paths — run with `cwd` and a
    relative filename.
21. macOS `say` `--data-format` conflicts with `.aiff` output — omit it (only relevant if you
    keep a `say` backend as the zero-dep fallback).

## The scene model that worked

- Each scene separates **caption** (short on-screen line) from **voice** (the full spoken
  line / two-host dialogue turns). Modern-tutorial feel = big word-synced captions + a richer
  voiceover, not the transcript on screen.
- **Reactive reveals:** elements carry `data-cue="k"`; they pop in when the voice reaches
  **turn k** (turn start times come from the timing track). Un-cued elements are scene-entry.
- **Two hosts** (`who: 'm' | 'f'`) trading lines with questions/banter reads far better than a
  single narrator; color the active caption word by speaker.
