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
- `at` defaults to 0, `volume` to 0.8. To follow speech inside a scene,
  use `at: { sentence: 0, word: 2, offset: -0.05 }`. Indices match
  `wordCue(scene, sentence, word)`; omit `word` to use the sentence's first
  word. `offset` is signed seconds, and the resolved global time must stay
  non-negative. Missing timing or indices fail with attribution. External
  narration needs supplied word timings for these anchors.
- `start` selects a source offset in seconds; `duration` optionally limits the
  selected audio. `fadeIn` and `fadeOut` apply to that selected interval before
  placing it on the timeline. Start/fades default to zero; duration defaults
  to all remaining source audio. Fades are bounded by the selected length;
  a start at/beyond source end is an error. These work on both audio routes.

```js
sfx: [{ file: "assets/riser.wav", scene: "hook",
  at: { sentence: 0, word: 2, offset: -0.05 },
  start: 1.5, duration: 0.8, fadeIn: 0.05, fadeOut: 0.2, volume: 0.6 }]
```


## How the mix behaves

- Output is `out/audio/mix.wav`, 48 kHz stereo PCM = narration + bed + sfx, one ffmpeg pass
  (`adelay` + `amix normalize=0` + `alimiter`). Duration equals `full.wav`
  exactly (asserted within 50ms); a sfx tail past the end is cut.
- loudnorm is NOT re-applied — the narration is already loudnorm'd and a
  second pass would shift its level. `normalize=0` keeps the voice at full
  level; the limiter catches bed+sfx clipping. If you hear pumping, lower
  `bed.volume`, don't reach for loudnorm.
- Mono inputs are centered at unity before the declared gains and limiter; stereo
  inputs retain left/right separation. Canonical speech stays 22.05 kHz mono.
  Existing projects adopt stereo on their next synth/build, including reuse.
- Remove `bed`/`sfx` (or the legacy `music`) from the config and the next synth/build, including external audio, deletes the stale
  `mix.wav` — compose falls back to `full.wav` automatically. Compose always
  prefers `mix.wav` when it exists.
- Old mixes become ineligible before replacement; only a completed mix is
  published. External processing/mixing failures warn and use the current raw
  source, so stale or partial audio cannot shadow it.
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
"align": { "engine": "faster-whisper", "model": "base.en", "partial": true }
```

- Project `model` and `partial` override environment defaults, including
  `partial: false`. Omit them to retain `NAROVA_WHISPER_MODEL` and
  `NAROVA_ALIGN_PARTIAL` compatibility. Keeping them in the config makes
  the project's chosen alignment settings travel with it.
- **faster-whisper**: `pip install faster-whisper` into the narova venv
  (`~/.narova/venv`). Not in requirements.txt — it's a heavy optional dep.
  Model `tiny.en` by default; `$NAROVA_WHISPER_MODEL=base.en` for a bit more
  accuracy at ~2× the time. For multilingual content (Arabic, French, etc.)
  use a non-`.en` model: `NAROVA_WHISPER_MODEL=small` — the `.en` models can
  only transcribe English and will misread non-English speech.
- **whisper.cpp**: install it so `whisper-cli` is on PATH
  (`brew install whisper-cpp`, or build ggerganov/whisper.cpp). The
  `ggml-tiny.en.bin` model auto-downloads once to `~/.narova/models/`.
  Its optional `model` selects an existing local model file: use a
  project-relative path or a filename already in the Narova model store.
- **auto**: faster-whisper if importable, else whisper.cpp. `narova doctor`
  reports which engines it can see.
- Alignment runs AFTER the loudnorm rescale, on the final scene wav, and only
  rewrites word `t0`/`t1` — scene `dur` and `turns` are untouched, so the
  caption-sync guarantee still holds. Works on `--reuse`.
- Raw measured results are cached by scene audio, engine and effective model
  identity at `~/.narova/cache/align/`. Changing partial mode reapplies mapping
  to those raw words; changing model selects a different cache entry.
- **Failure is soft.** Engine missing/crashed, or aligned words don't match
  the script token-for-token (punctuation-stripped, case-insensitive): that
  scene keeps its estimates with a warning. Alignment never breaks a build.
- Hyphenated authored words such as `one-to-one` also match the consecutive
  measured words `one`, `to`, `one` while retaining one clean caption token.
  Other strict mismatches keep estimates; partial mode can retain exact
  anchors around a misheard word such as `One` transcribed as `1`.
- **Partial alignment** (`align: { partial: true }`, or `NAROVA_ALIGN_PARTIAL=1`): for mixed-language
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

## Unit tempo and scene captions

At `timing.tempo: 1`, synthesis bypasses time stretching and still applies gain,
fades and canonical conversion. Use exactly one for unchanged pacing.

Set `captions: false` on an individual scene to hide its visual caption overlay
in either renderer, including the dedicated external-word overlay. SRT/VTT and
indexed choreography cues retain that scene's words. Omit the field or use true
to inherit the root standard-caption setting.

## Turn pauses and caption visibility

```js
vo: [
  { who: 'a', text: 'Let that sink in.', pauseAfter: 1.2 },
  { who: 'a', text: 'A spoken aside.', captions: false },
]
```

`pauseAfter` adds non-negative seconds of silence after a synthesized turn,
including the last turn. The usual turn gap and scene tail still apply. It
changes measured timing, while the synthesized sentence clips remain reusable.
External and native performances reject non-zero pauses; author those pauses
in the source performance instead. `minDur` continues to pad only scene end.

A turn's `captions: false` hides its visual words in both renderers and the
external-word overlay. Its words stay in SRT/VTT and choreography cues. True
inherits the scene/root setting; it cannot re-enable a disabled overlay.

For supported caption styling, use the root configuration rather than reserved
internal classes:

```js
captions: { preset: 'karaoke', size: 28, plate: true, maxWords: 8,
            emphasis: ['remember'], color: '#ffffff', activeColor: '#ffd56a',
            pastColor: '#cccccc', plateColor: '#101820' }
```

Presets are `subtitle`, `karaoke`, `slam`, `pop`, and `rise`; size is 10–120
composition pixels, maxWords is 1–30, plate is boolean, and emphasis matches
clean words ignoring case and surrounding punctuation. These controls have
matching browser and browserless behavior and participate in render identity.
Optional color, activeColor, pastColor and plateColor use six-digit RGB hex;
color supplies unspecified word states and plateColor applies only to an enabled
plate. Omit them to retain each preset’s defaults.

## Portable synthesized sentences

The normal sentence cache already survives deleting `out/`: it lives under
`$NAROVA_CACHE` or `$NAROVA_HOME/cache/sentences`. To carry the exact current
sentence takes to another machine:

```bash
narova synth --out out
narova voice-cache export --out out --dir speech-cache
# Copy the project and speech-cache to the receiving machine.
narova voice-cache import --dir speech-cache
narova build --out out
```

Export creates a new directory with `manifest.json` and keyed canonical WAVs.
The bundle carries byte hashes, format and duration facts, without credentials
or worker configuration. Import validates the whole bundle before publication;
corrupt, escaping, duplicate or symlink entries fail. Different existing cache
bytes require `--overwrite`; identical entries are kept. Failed publication
restores prior entries. Limits are 10,000 entries, 64 MiB per WAV and 512 MiB total.
If your project ignores WAVs, explicitly add this selected durable bundle or
store it beside the project in an artifact store.

The receiving machine still needs the same explicitly registered provider
identity and project inputs. Matching imported clips do not start a worker or
require its key. A text, voice, model, language, direction, context or take
change can require synthesis again. Export takes made with the current CLI;
older `takes.json` files lack cache keys. A bundle verifies byte integrity, not
whether the spoken performance matches your creative intent.

## Optional final mix loudness

```js
mix: { loudness: { target: -16, peak: -1.5, lra: 11 } }
```

This explicitly selected two-pass normalization runs after voice processing,
background beds and SFX, including a soundtrack with no layers. It writes a
48 kHz stereo `audio/mix.wav`, preserving channel separation, narration source,
measured duration and word timing. Changing it reuses speech. Without the option,
the existing mix policy applies. Target is -70..-5 LUFS, peak is -9..0 dBTP,
and lra is 1..50 LU; peak/lra default to the values above. Silent input remains
silent; arbitrary content and peak constraints can limit the achieved target.
A processing failure fails the operation and removes the incomplete mix.
Measure the encoded delivery with `narova review --audio-levels --delivered`
when checking the final result; a WAV target is not proof of encoded loudness.

Literal SFX word selectors also work:

```js
sfx: [{ file: 'assets/hit.wav', scene: 'hook',
        at: { sentence: 0, word: { text: 'remember', occurrence: 1 }, offset: 0.05 } }]
```

Occurrence is zero-based within the named sentence. Omit it only for a unique
match. Matching ignores case and surrounding Unicode punctuation; missing or
ambiguous tokens fail rather than guess. Numeric word indices remain supported.


## Optional Pocket TTS and provider files (unreleased)

The built-in `pockettts` backend uses an optional isolated CPU runtime. Run
`narova-setup --pockettts`; no separate skill or registration is needed. It exposes
released multilingual presets, reference cloning, saved states and generation
controls; see the [configuration guide](pockettts.md).
Pocket supplies raw audio. Narova retains segmentation, resampling, processing,
alignment, captions, mixing and reuse. No native word timings are advertised.

Declare local provider dependencies under `voices.<id>.providerFiles`, for example
`{ referenceAudio: 'assets/authorized.wav' }`. Keep non-file controls under
`providerOptions`. Files must be readable local regular files; names must be
safe option identifiers and cannot overlap options or reserved `seed`.
Resolved `providerFileInputs` evidence is recomputed from current bytes before
reuse, preserved in manifests, and passed as `{ path, sha256 }` option values.
Workers verify it before use. Project archives reject dependencies outside the
project and retain existing archive size limits. The current released CLI 0.51.0
predates these bindings; use the matching source checkout until release.
