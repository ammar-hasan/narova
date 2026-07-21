# Gotchas

Short version of LEARNINGS.md. Read that file before changing pipeline code.

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
- **Oversized display type escapes overlap lint.** Big `vw` fonts with
  `line-height` < 1 paint outside their element box — a giant `RS.1000` can
  bleed over the eyebrow above it while every box-based check passes. Give
  display type `line-height >= 1` (or extra margin) and verify with a
  snapshot frame, not just `npx hyperframes check`.
- **Lint misses real collisions; frames don't.** Tall content can slide under
  the topbar or the caption band while `hyperframes check` reports 0 layout
  issues. The canvas reserves the caption band's height, but there is no
  auto-fit: cap the height of tall maps/SVGs yourself and verify with
  `narova shots`. Contrast lint can also false-positive on decorative glyphs
  (flag emblems, icons) — warnings, not errors; judge by eye.
- **Wide visuals: widen the column, don't fight it.** `.scenebody` defaults
  to 1000px; set `theme: { colw: "1180px" }` for maps/infographics.
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
  qwen gets ~1.2GB once. `npx hyperframes` gets the CLI once. None of these
  are hangs.
- **piper has far more than the default two voices.** `narova voices list
  --backend piper` shows a starter spread; `narova voices get <name>
  --backend piper` downloads any voice from the piper catalog
  (github.com/rhasspy/piper/blob/master/VOICES.md). Enough distinct voices
  for a multi-host panel without the heavy xtts/qwen backends.
- **xtts extras**: install with `tool/setup.sh --xtts`. If a license prompt
  appears, set `COQUI_TOS_AGREED=1`.
- **Word timing is computed, not measured.** Speech is made per sentence and
  words are spread by length. Good for karaoke captions. Do not chase
  per-word perfection.
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
  `narova shots` (one mid-scene frame per scene into
  `out/hf/snapshots/review/`, `--at` for explicit times) plus actually
  viewing the frames. Manual equivalent inside `out/hf`:
  `npx hyperframes snapshot --at <t1,t2,…> -o snapshots/review` — `-o` takes
  a **directory**, not a file path.
- **Agent shells don't persist variables.** Spell out
  `node <skill-dir>/tool/bin/narova.js` in every call — a `NAROVA=...`
  assignment from an earlier call is gone (exit 127).
- **Balance is on you, not the tool.** `check` gates claims against
  `claims.md`, but a one-sided narrative built from sourced claims passes
  clean. For contested topics, ledger the major perspectives and re-read the
  script for framing before synth (`references/url-to-source.md` §3).
