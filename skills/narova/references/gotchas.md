# Gotchas

Short version of the public implementation-maintainer notes in `LEARNINGS.md`.
Read those notes before changing pipeline code; they are not product authority.

## Writing

- **Cues count from 0.** `data-cue="0"` = the first turn. A cue that does not
  match a turn appears at scene start. It does not error — `check` warns.
- **Pauses come from config, not punctuation.** Neural TTS pauses randomly on
  punctuation, so narova inserts fixed gaps instead. Tune `timing.gapSentence`,
  `gapTurn`, `lead`, `tail`. Do not fight pacing with commas.
- **Speed = `timing.tempo`** (around 1.1–1.2 reads well). Never use the XTTS
  `speed` option — it is broken (LEARNINGS #9).
- **No looping CSS animation, hover, or transition state in theme.css.** The
  renderer jumps between frames; those break. `check` warns. Take it seriously.
  Motion comes from the timeline: `reveal`/`data-cue` entrances, `data-grow`
  (bars), `data-draw` (SVG paths), `data-count` (count-ups), `data-delay`
  (nudge any trigger). See `references/scene-script.md` §Motion.
- **Reveal on transformed SVG is handled, but know why.** GSAP's transform
  replaces an SVG element's `transform` attribute; the runtime wraps any
  animated SVG element that carries one in a fresh `<g>` and tweens the
  wrapper. You no longer need to hand-wrap — but if a marker ever lands at
  the top-left origin, this mechanism is where to look.
- **SVG ids can repeat across scenes.** Compose namespaces body ids to
  `<sceneId>--<id>` and rewrites local `url(#…)`/`href` references, so one
  SVG with gradient `<defs>` works in every scene. Keep ids unique within a
  scene; style with classes (`#id` in theme.css won't match — `check` warns).
- **No invented facts.** A stat, superlative, or market claim in the `vo` that
  is not in the project's `claims.md` (with a source) does not ship. `check`
  sniffs for unledgered claims, but the ledger is the real gate
  (`references/url-to-source.md` §3).
- **Qwen runs away on spelled-out numbers.** "Fourteen to twenty-seven
  degrees" can synthesize as 45 seconds of drone for four words. Write
  digits ("14 to 27 degrees", "8,611 meters") — qwen reads them naturally
  and they look better in captions too. Scan `out/timings.json` for
  sentences whose seconds-per-word exceeds ~0.9: that's a runaway.
- **XTTS (incl. cloned voices) stretches very short sentences.** "Hello
  everyone!" or "So keep it simple." can come out drawn and unnatural.
  Merge short bursts into longer flowing sentences before synth.
- **Oversized display type escapes overlap lint.** Big `vw` fonts with
  `line-height` < 1 paint outside their element box — a giant `RS.1000` can
  bleed over the eyebrow above it while every box-based check passes. Give
  display type `line-height >= 1` (or extra margin) and verify with a
  snapshot frame, not just `npx hyperframes check`.
- **Lint misses real collisions; frames don't.** Tall content can slide under
  the topbar or the caption band while `hyperframes check` reports 0 layout
  issues. The raw canvas deliberately reserves nothing: optional chrome and
  captions overlay it. Author that relationship explicitly, or opt into
  `safeLayout: true`, then verify with `narova shots`. Contrast lint can also
  false-positive on decorative glyphs (flag emblems, icons) — warnings, not
  errors; judge by eye.
- **Safe layout is opt-in.** Raw `.scenebody` fills the frame. Only
  `safeLayout: true` adds centering, gutters, caption reserve, and a 1000px
  column; when using it, widen with `theme: { colw: "1180px" }`.
- **Target duration is tuned before synth, not after.** `narova check`
  estimates narration length from word count + tempo (≈170 wpm × tempo plus
  fixed gaps, calibrated against real piper builds). Adjust words and
  `timing.tempo` until the estimate lands near the target;
  `out/timings.json` `dur` fields give exact post-synth numbers.
- **Light-brand site → `theme.mode: "light"`.** Do not override `#bg` with
  `!important` and then chase caption/progress/contrast failures — the one
  switch flips the base palette and chrome tokens; your tokens override it.

## Running

- **`--reuse` is for visual-only edits — and it's guarded.** It replays the
  old audio and timings. If the `vo` text changed since the last synth,
  `--reuse` is ignored with a note and a full synth runs, so the wrong
  command degrades to the right one. Voice/backend/tempo changes with
  unchanged text still replay the old audio by design — use a full `build`
  to re-voice.
- **Spoken-text edits re-voice only the changed sentences.** synth caches
  each processed sentence (backend + speaker + text + tempo) at
  `~/.narova/cache/sentences/`. Untouched scenes are byte-identical across
  runs — so never "improve" lines the user didn't ask you to change; that
  re-voices them. Voice/tempo changes invalidate the cache: everything is
  re-synthesized.
- **First runs download things.** The first `synth` creates the venv at
  `~/.narova/venv`. piper gets a voice per speaker. xtts gets ~1.9GB once.
  qwen gets ~1.2GB once. chatterbox gets ~1GB once (in its own venv). `npx
  hyperframes` gets the CLI once. None of these are hangs.
- **piper has far more than the default two voices.** `narova voices list
  --backend piper` shows a starter spread; `narova voices get <name>
  --backend piper` downloads any voice from the piper catalog
  (github.com/rhasspy/piper/blob/master/VOICES.md). Enough distinct voices
  for a multi-host panel without the heavy xtts/qwen backends.
- **xtts extras**: install with `narova-setup --xtts`. If a license prompt
  appears, set `COQUI_TOS_AGREED=1`.
- **chatterbox is voice cloning, in its own venv.** Install once with
  `narova-setup --chatterbox`. It hard-pins torch==2.6 / transformers==5.2,
  which conflict with xtts/qwen, so it gets a SEPARATE venv
  (`~/.narova/venv-chatterbox`, override `$NAROVA_CHATTERBOX_VENV`) and narova
  drives it as a subprocess. Set the voice's `speaker` to an ABSOLUTE path to a
  clean 10–20s recording. Optional per-voice `exaggeration` / `cfg_weight`. If
  synth errors with "chatterbox venv not found", you skipped the `--chatterbox`
  setup. It is the slowest backend — expect ~4× xtts — but the sentence cache
  spares unchanged lines.
- **qwen needs Python ≥ 3.10.** On a machine whose default python3 is 3.9,
  `setup.sh --qwen` fails resolving deps. Install a newer python and rebuild
  the venv: `NAROVA_SETUP_PYTHON=python3.12 narova-setup --qwen`
  (move `~/.narova/venv` aside first).
- **Voice-clone sample paths must be absolute.** The synth process does not
  run in the project directory, so a relative `speaker: "voice/me.wav"` can't
  be found. Any `speaker` ending in a clone extension (wav/mp3/flac/m4a) is
  treated as a sample path and validated: a relative or missing path now
  errors loudly ("must be an ABSOLUTE path" / "clone sample not found")
  instead of falling through to a studio-name lookup. Use the absolute path.
- **Post-processing the render with ffmpeg concat needs `setsar=1`.** The
  rendered mp4 carries a non-square sample aspect ratio (e.g. 6401:6400);
  concat with freshly scaled clips fails with "parameters do not match"
  until every video chain ends in `setsar=1`.
- **Word timing is computed, not measured.** Speech is made per sentence and
  words are spread by length. Good for karaoke captions. Do not chase
  per-word perfection. If measured word times are genuinely needed (tight
  word-level effects), that is what `align` is for — see
  `references/audio.md`; it needs faster-whisper or whisper.cpp installed and
  never breaks a build when they aren't.
- **Music/SFX go through `out/audio/mix.wav`, never a re-loudnorm.** The mix
  keeps narration at full level and limits the rest (`references/audio.md`).
  Anchor sfx to a `scene` — a bare `at` is a global timeline second and
  silently lands early/late after any re-voicing that changes scene lengths.
  Removing `music`/`sfx` from the config deletes the stale mix on next synth.
- **Running `python -m narova_tts` by hand: pass an ABSOLUTE `--out`.** The
  concat demuxer resolves the relative wav paths in its list file against the
  list file's own directory, so `--out out` fails with "Impossible to open
  'out/.tmp/out/audio/01.wav'". The CLI always passes an absolute path; only
  manual invocations hit this.
- **Never edit `out/hf/`.** Every `compose` regenerates it. Edits made in
  Studio during preview are lost — warn the user. Change the config instead.
- **Commands work from anywhere inside the project.** The config is found by
  walking up from the current directory, so running narova from `out/hf`
  (after a `cd` for hyperframes) works — no "No config found" trap.
- **Sync is guaranteed by the pipeline.** Timings are rescaled to the real
  audio and asserted. If captions drift, something changed `out/audio`
  behind the pipeline's back.
- **Render only after the user approves the preview.** (HyperFrames' own
  rule too.)
- **Do not shell-background foreground preview.** Agent shells may reap it.
  Use `narova preview --detach`, give the user the printed Studio URL, and
  stop it with `narova preview --stop` when review is done. If the default
  browser hits a macOS Local Network permission prompt, open the printed URL
  in Chrome/Chromium manually; the server itself is still usable.
- **Studio does not hot-reload — so compose/build restart it for you.**
  `compose` deletes and recreates `out/hf`; a detached preview left running
  is automatically restarted on the new build (same port) by `compose`,
  `build`, and `preview --detach` itself. Manual restart is only a fallback.
- **Snapshots verify; Studio watches.** The reliable visual-QA loop is
  `narova shots --beats` for the arriving and resolved state of every narration
  or marker beat, `shots --motion` for scene coverage, and `--at` for explicit
  times, plus actually viewing the frames. Snapshots land in
  `out/hf/snapshots/review/`. Manual equivalent inside `out/hf`:
  `npx hyperframes snapshot --at <t1,t2,…> -o snapshots/review` — `-o` takes
  a **directory**, not a file path.
- **A technically successful pilot can still be invisible.** Use `narova shots
  --motion --proof` while proving a direction. It fails when most sampled
  frames are near-black or no frame exists. Deliberate black frames are valid;
  the threshold allows a minority, and direct contact-sheet judgment remains
  authoritative. A passing run binds a receipt to the current config, manifest,
  timings, audited frames, and contact sheet; any later edit requires new proof
  shots before `branch save`. The branch keeps the full receipt-bound proof set
  outside the authored snapshot namespace and validates it again at release.
  Restore the approved proof before expansion and record its exact
  `proofIdentity` in the brief; proof-time CLI overrides reapply automatically.
- **Agent shells don't persist variables.** Use `narova` in every call, or
  `$HOME/.local/bin/narova` when that user-owned bin directory is not on
  `PATH`. A `NAROVA=...` assignment from an earlier call is gone (exit 127).
- **Balance is on you, not the tool.** `check` gates claims against
  `claims.md`, but a one-sided narrative built from sourced claims passes
  clean. For contested topics, ledger the major perspectives and re-read the
  script for framing before synth (`references/url-to-source.md` §3).

## Revision guarantees

Narova's contract: a revision changes only what the user asked for.

| Edit type | What rebuilds | `--reuse` behavior |
|---|---|---|
| Scene body HTML | Compose + render only | Audio replayed verbatim |
| Theme tokens / theme.css | Compose + render only | Audio replayed verbatim |
| Captions preset / emphasis | Compose + render only | Audio replayed verbatim |
| Choreography | Compose + render only | Audio replayed verbatim |
| Chrome (topbar/counter/progress) | Compose + render only | Audio replayed verbatim |
| `safeLayout` | Compose + render only | Audio replayed verbatim |
| Transition style | Compose + render only | Audio replayed verbatim |
| Bed / SFX | Re-mix + compose + render | Audio replayed, bed/SFX re-mixed |
| Voiceover text | Full re-synth | Sentence cache re-synthesizes only changed sentences |
| Voice speaker/backend/gainDb | Re-synth affected voice | Other voices replayed from cache |
| Tempo / timing gaps | Re-synth all sentences | All sentences re-processed |
| Scene added/removed/renamed | Full rebuild | Structure change invalidates timings |
| Walkthrough capture stale | Re-capture + compose + render | Audio replayed |
| Release restore | Full synth | Sentence cache serves identical audio, fast rebuild |

Two identities protect reuse: `out/.audio-fingerprint` covers synthesized speech,
while `out/.timings-fingerprint` adds scene topology and silent durations. A
visual-only edit changes neither; text, scene structure, or silent runtime changes
force the appropriate rebuild.

## Resolved issues (version 0.17.0+)

- **`data-grow` / `data-mark highlight` transformOrigin**: Previously, these
  animators included `transformOrigin` inside GSAP tweens, which could break
  the sub-composition timeline under hyperframes@0.7.64. Now transformOrigin
  is pre-seeded via `tl.set()` before the tween — safe and functional.
- **Theme token preservation**: Custom theme tokens (`stage`, `deep`, `halo`,
  `colw`, user-defined tokens, etc.) now survive the manifest round-trip
  through all pipeline stages. Previously only `accent` and `bg` were preserved.
- **3D cue timing**: Cues on 3D animations (`{ at: { cue: N, offset } }`)
  now resolve to measured turn start times after synthesis. Previously used
  `cue * 2` approximation.
- **GSAP vendored locally**: No CDN dependency at render time. GSAP 3.14.2
  ships in `vendor/gsap/gsap.min.js`.
- **Particle randomness is seeded**: Same project + scene + object produces
  identical particle layouts across builds.
- **Unsupported semantic actions fail validation**: `draw`, `speak`, `react`,
  `follow`, `transform` now produce clear validation errors instead of
  silently compiling to nothing.
