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

## Running

- **`--reuse` only when the spoken text did not change.** It replays the old
  audio and timings. Use it for visual-only edits (body, theme). If any `vo`
  text changed, run a full `build`.
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
- **xtts extras**: install with `tool/setup.sh --xtts`. If a license prompt
  appears, set `COQUI_TOS_AGREED=1`.
- **Word timing is computed, not measured.** Speech is made per sentence and
  words are spread by length. Good for karaoke captions. Do not chase
  per-word perfection.
- **Never edit `out/hf/`.** Every `compose` regenerates it. Edits made in
  Studio during preview are lost — warn the user. Change the config instead.
- **Sync is guaranteed by the pipeline.** Timings are rescaled to the real
  audio and asserted. If captions drift, something changed `out/audio`
  behind the pipeline's back.
- **Render only after the user approves the preview.** (HyperFrames' own
  rule too.)
