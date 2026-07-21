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
- **No invented facts.** A stat, superlative, or market claim in the `vo` that
  is not in the project's `claims.md` (with a source) does not ship. `check`
  sniffs for unledgered claims, but the ledger is the real gate
  (`references/url-to-source.md` §3).
- **Oversized display type escapes overlap lint.** Big `vw` fonts with
  `line-height` < 1 paint outside their element box — a giant `RS.1000` can
  bleed over the eyebrow above it while every box-based check passes. Give
  display type `line-height >= 1` (or extra margin) and verify with a
  snapshot frame, not just `npx hyperframes check`.
- **Light-brand site → `theme.mode: "light"`.** Do not override `#bg` with
  `!important` and then chase caption/progress/contrast failures — the one
  switch flips the base palette and chrome tokens; your tokens override it.

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
- **Do not shell-background foreground preview.** Agent shells may reap it.
  Use `narova preview --detach`, give the user the printed Studio URL, and
  stop it with `narova preview --stop` when review is done. If the default
  browser hits a macOS Local Network permission prompt, open the printed URL
  in Chrome/Chromium manually; the server itself is still usable.
- **Studio does not hot-reload.** `compose` deletes and recreates `out/hf`,
  so a preview left running shows the OLD build — or an empty
  `00:00 / 00:00` canvas that a browser refresh cannot fix. Re-run
  `narova preview --detach`: it restarts the server on the new build (same
  port). `compose`/`build` warn when a stale preview is still running.
- **Snapshots verify; Studio watches.** The reliable visual-QA loop is
  `npx hyperframes snapshot --at <t1,t2,…> -o snapshots/review` inside
  `out/hf` plus actually viewing the frames. `-o` takes a **directory**
  (frames land inside it), not a file path.
- **Agent shells don't persist variables.** Spell out
  `node <skill-dir>/tool/bin/narova.js` in every call — a `NAROVA=...`
  assignment from an earlier call is gone (exit 127).
