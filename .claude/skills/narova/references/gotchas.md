# Gotchas (condensed from LEARNINGS.md — read that file before touching pipeline code)

## Authoring

- **`caption` ≠ `vo`.** On-screen line vs spoken dialogue. Mirroring the
  transcript on screen is the #1 way to make the output look wrong.
- **Cues are 0-based turn indexes.** `data-cue="0"` = first turn. A cue that
  doesn't resolve to a turn reveals at scene entry (it doesn't error) — run
  `narova check`, it warns on exactly this.
- **Pauses are configured, not punctuated.** Neural TTS pauses inconsistently
  on punctuation; narova splices fixed gaps instead (`timing.gapSentence`,
  `gapTurn`, `lead`, `tail`). Don't fight pacing with commas/ellipses — tune
  `timing`.
- **Speed = `timing.tempo`** (pitch-preserving ffmpeg atempo, ~1.1–1.2 reads
  well). Never try to make XTTS itself speak faster — its `speed` param is
  broken (LEARNINGS #9).

## Running

- **`--reuse` only when `vo` is unchanged.** It replays old audio + timings; if
  any spoken text changed you'll get stale narration or desync. Visual-only
  edits (body, caption, theme) are exactly what it's for.
- **First runs download models**: piper fetches a voice per speaker on first
  use; xtts fetches ~1.9GB once. Don't mistake the download for a hang.
- **xtts extras**: needs `scripts/setup.sh --xtts`; the license gate needs
  `COQUI_TOS_AGREED=1` in the environment if prompted.
- **Word timing is derived, not measured** — synthesized per sentence, words
  distributed by length. It's karaoke-grade by design; don't chase per-word
  perfection.
- **Preview through `narova preview`, not `file://` or a naive server.** The
  bundled server does HTTP Range; Python's `http.server` doesn't, which breaks
  mp4 seeking (LEARNINGS #17).
- **Sync is guaranteed by the pipeline** (timings rescaled to real audio,
  asserted at build; LEARNINGS #1/#14). If captions drift, something upstream
  changed audio duration behind the pipeline's back — don't post-process
  `out/audio` and expect sync to hold.
- **Captions are baked into frames, not subtitle streams.** No libass/ffmpeg
  subtitle filters involved; a doctor warning about libass is informational.
- **Chrome capture is hardened** (45s timeout + retry of missing frames). A
  few retried frames in the log is normal, not a failure.
