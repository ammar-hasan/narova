# Audio: background bed, spot SFX, forced alignment, Chatterbox v3

Everything here is optional and configured in `reel.config.*`. The Python
synth stage (`narova_tts`) does the work; compose picks up the result.

## Background bed

```json
"bed": { "file": "assets/ambient.mp3", "volume": 0.14, "fadeIn": 0.5, "fadeOut": 1.5 }
```

- `file` is project-relative; the resolver stores an absolute path.
- The bed is looped or trimmed to the EXACT narration length, gained by
  `volume`, faded in/out with `afade`. Defaults shown above.
- 0.14 is a starting point, not a law. Voice-forward reels sit at 0.08–0.2.
- The legacy key `music` is also accepted (maps to `bed`).

## Spot SFX

```json
"sfx": [
  { "file": "assets/whoosh.wav", "scene": "hook", "at": 0.2, "volume": 0.8 },
  { "file": "assets/riser.wav",  "at": 12.5 }
]
```

- With `scene`: plays at that scene's start (its real, post-loudnorm timeline
  position) + `at` seconds. This is what you almost always want — it survives
  re-voicing that changes earlier scenes' lengths.
- Without `scene` (`"scene": null` or omitted): `at` is a global timeline
  time in seconds. Brittle across re-voicing; use for one-off fixes.
- `at` defaults to 0, `volume` to 0.8.

## How the mix behaves

- Output is `out/audio/mix.wav` = narration + bed + sfx, one ffmpeg pass
  (`adelay` + `amix normalize=0` + `alimiter`). Duration equals `full.wav`
  exactly (asserted within 50ms); a sfx tail past the end is cut.
- loudnorm is NOT re-applied — the narration is already loudnorm'd and a
  second pass would shift its level. `normalize=0` keeps the voice at full
  level; the limiter catches bed+sfx clipping. If you hear pumping, lower
  `bed.volume`, don't reach for loudnorm.
- Remove `bed`/`sfx` (or the legacy `music`) from the config and the next synth DELETES the stale
  `mix.wav` — compose falls back to `full.wav` automatically. Compose always
  prefers `mix.wav` when it exists.
- Mixing runs on `--reuse` too: you can audition beds without re-voicing.
- A missing/unreadable `file` fails the synth naming the file. Fix the path;
  there is no silent skip.

## Read-only mix and delivery proof

The existing level review can expose several exact evidence views without
changing authoring or media:

```bash
narova review --audio-levels --windows '[{"label":"opening","start":0,"end":2.4}]'
narova review --audio-levels --mix-map
narova review --audio-levels --delivered youtube.mp4
narova review --audio-levels --delivered multilingual.mkv --member 2
```

- `--windows` preserves the JSON array order and binds every row to one artifact
  digest. A short interval can report peak/sample facts while gated loudness or
  range is explicitly unavailable.
- `--mix-map` reports bed first, then SFX in authored order, with source digest,
  gain/fades, resolved scene/global anchor, global window, and facts measured
  over that interval of the finished mix. Those numbers describe the sum of all
  overlapping material; they do not isolate the named source or prove that it is
  audible, clear, masked, or balanced.
- `--delivered` measures the encoded member in the container itself. One member
  or one unique default can be selected automatically; otherwise pass the exact
  container stream index with `--member`. Intermediate `mix.wav` facts are never
  substituted for delivery evidence.
- These are literal advisory facts, never targets, scores, gates,
  recommendations, automatic normalization, or repair.

## External narration (pre-recorded audio)

When you already have voice audio from an external source (a cleaned
recording, a podcast clip, a speech), skip TTS entirely:

```js
narration: {
  file: "assets/voice-clean.wav",
  // optional: inject word-timed karaoke captions into the video
  wordTimings: "assets/captions-karaoke.json",
}
```

- `narration build` skips TTS synthesis — the file is copied directly as
  the narration track. No voices or TTS backend needed.
- When `wordTimings` is set, narova injects per-scene karaoke caption
  overlays at compose time. Each word gets its own timeline layer: the
  spoken word highlights in gold while the rest of the cue stays visible
  but transparent. The karaoke JSON format is:
  ```json
  [
    {
      "start": 0.0, "end": 2.5,
      "text": "first spoken phrase",
      "words": [
        { "text": "first", "start": 0.0, "end": 0.6 },
        { "text": "spoken", "start": 0.6, "end": 1.4 },
        { "text": "phrase", "start": 1.4, "end": 2.5 }
      ]
    }
  ]
  ```
- If `bed` or `sfx` are also configured, narova mixes them with the
  external narration automatically (same ffmpeg filter chain as the Python
  mix stage). No TTS venv needed.
- `narova check` reports the backend as `"external"`, not `"silent"`, and
  estimates duration from explicit scene `dur` values.
- Hook checks (lead-in silence, on-screen text) are skipped — the external
  recording defines its own pacing.

### Audio processing for external narration

When bringing your own recording, apply voice cleanup before mixing:

```js
narration: {
  file: "assets/voice.wav",
  process: {
    highpass: 75,                    // Hz — cut rumble below this
    lowpass: 14000,                  // Hz — cut hiss above this
    compressor: { threshold: 0.14, ratio: 2.5 },
    loudness: { target: -16, peak: -1.5, lra: 11 },
  },
}
```

- All process keys are optional; narova applies them with ffmpeg before mixing
  the bed/sfx on top.
- `loudness` runs a linear loudnorm pass (no second analysis — set reasonable
  target/peak/LRA values for your content).

### Generating karaoke JSON from external audio

Use `narova karaoke generate` to produce word-timed karaoke JSON from an
audio file — the same format `narration.wordTimings` expects:

```bash
narova karaoke generate assets/voice.wav --transcript corrected-transcript.txt
# writes: voice-karaoke.json + voice-captions.srt
```

- Requires `faster-whisper` (`pip install faster-whisper`) or `whisper-cpp`
  (`brew install whisper-cpp`). Falls back automatically.
- `--transcript`: a clean transcript text file. narova maps its tokens onto
  Whisper word timings using SequenceMatcher — this lets you fix spelling or
  transcription errors without breaking word alignment.
- `--max-words N`: words per karaoke cue (default 8).
- `--engine faster-whisper|whisper-cpp|auto`: pick a specific engine.

Then use the generated file in your config:

```js
narration: {
  file: "assets/voice.wav",
  wordTimings: "voice-karaoke.json",
}
```

### Auto-retiming scenes

When using external narration, scene durations must match the spoken beats.
Instead of trial-and-error, use `narova retime`:

```bash
narova retime reel.config.mjs voice-karaoke.json --apply
# reads word timings, snaps scene boundaries to cue ends, rewrites config
```

- Without `--apply`: prints a plan showing current vs proposed durations.
- Snaps scene ends to natural cue boundaries (end of the last phrase that fits).

## Forced word alignment

Word timings are estimated (words spread by length across each sentence) —
good enough for karaoke. `align` replaces them with measured ones:

```json
"align": true                                // engine: auto
"align": { "engine": "faster-whisper" }      // or "whisper-cpp"
```

- **faster-whisper**: `pip install faster-whisper` into the narova venv
  (`~/.narova/venv`). Not in requirements.txt — it's a heavy optional dep.
  Model `tiny.en` by default; `$NAROVA_WHISPER_MODEL=base.en` for a bit more
  accuracy at ~2× the time. For multilingual content (Arabic, French, etc.)
  use a non-`.en` model: `NAROVA_WHISPER_MODEL=small` — the `.en` models can
  only transcribe English and will misread non-English speech.
- **whisper.cpp**: install it so `whisper-cli` is on PATH
  (`brew install whisper-cpp`, or build ggerganov/whisper.cpp). The
  `ggml-tiny.en.bin` model auto-downloads once to `~/.narova/models/`.
- **auto**: faster-whisper if importable, else whisper.cpp. `narova doctor`
  reports which engines it can see.
- Alignment runs AFTER the loudnorm rescale, on the final scene wav, and only
  rewrites word `t0`/`t1` — scene `dur` and `turns` are untouched, so the
  caption-sync guarantee still holds. Works on `--reuse`.
- Results are cached by scene-wav sha1 at `~/.narova/cache/align/` — re-runs
  are free until the audio changes.
- **Failure is soft.** Engine missing/crashed, or aligned words don't match
  the script token-for-token (punctuation-stripped, case-insensitive): that
  scene keeps its estimates with a warning. Alignment never breaks a build.
- **Partial alignment** (`NAROVA_ALIGN_PARTIAL=1`): for mixed-language
  scenes (e.g. English narration + Arabic quotations), Whisper transcribes
  only the English words. Partial mode finds exact English anchors and
  interpolates timings for unrecognized spans instead of rejecting the
  whole scene. Essential for multilingual projects.

## Chatterbox Multilingual v3

- narova pins chatterbox to git master in `requirements-chatterbox.txt`:
  Multilingual **v3** (June 2026 — better speaker similarity, fewer
  hallucinations) is selected via `t3_model="v3"`, which the latest PyPI
  release (0.1.7) does not have. Re-run `narova-setup --chatterbox` to move
  an existing venv to the pin. `$NAROVA_CHATTERBOX_T3_MODEL=v2` forces the
  legacy checkpoint.
- Per-voice `lang` (e.g. `"fr"`, `"zh"`; 23 languages) switches that voice to
  the Multilingual model — loaded lazily on first use, so all-English builds
  never pay for it. `lang` joins `exaggeration`/`cfg_weight` in the sentence
  cache identity: changing it re-voices that speaker. The reference clip
  should match the target language (or set `cfg_weight: 0`).
- **All Chatterbox output is watermarked.** The library embeds Resemble's
  PerTh neural watermark by default — inaudible, survives mp3 compression
  (that's why `resemble-perth` is a hard dep and setuptools is pinned <81).
  Good for EU AI Act provenance; do not try to strip it.
