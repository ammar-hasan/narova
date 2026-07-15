# narova_tts

The Python half of narova: **TTS + timing only**. It turns `narration.json` into
per-scene audio plus a word/turn timing track that is rescaled to the *real* audio
duration. Node owns render, capture, assemble, and serve — this package does not.

## Install

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt            # piper (default)
pip install -r requirements-xtts.txt       # optional: xtts (higher quality)
```

`ffmpeg` and `ffprobe` must be on `PATH`.

## How Node invokes it

```bash
python -m narova_tts \
  --narration <out>/narration.json \
  --config    <reel.config.json> \
  --out       <out> \
  --backend   piper            # default backend; per-voice config.backend overrides
  [--reuse]                    # skip synth, rescale existing timings to existing wavs
```

Prints one line of JSON to stdout:

```json
{"totalDuration": 212.34, "scenes": 14, "out": "out"}
```

## Input contract

**`--narration`** — a JSON array of scenes:

```json
[{ "n": 1, "id": "title",
   "segments": [{ "who": "a", "text": "..." }, { "who": "b", "text": "..." }] }]
```

`who` is any voice key present in the config (`a`, `b`, `m`, `f`, …).

**`--config`** — voices + timing:

```json
{
  "voices": {
    "a": { "backend": "xtts", "speaker": "Damien Black" },
    "b": { "backend": "piper", "speaker": "en_US-hfc_female-medium" }
  },
  "timing": { "gapSentence": 0.28, "gapTurn": 0.5, "lead": 0.16, "tail": 0.6, "tempo": 1.18 }
}
```

- `backend` per voice is optional; falls back to `--backend`.
- `speaker` is a Piper voice name (piper) or an XTTS studio speaker name (xtts).
- `timing` is optional; missing keys use defaults shown above.

## Output contract

```
<out>/audio/NN.wav      # per scene, final (post-loudnorm), NN = zero-padded scene n
<out>/audio/NN.mp3
<out>/timings.json
```

`timings.json`:

```json
{
  "title": {
    "dur": 12.482,
    "turns": [0.16, 6.31],
    "words": [{ "w": "Okay.", "t0": 0.16, "t1": 0.44, "who": "b", "si": 0 }]
  }
}
```

`dur` equals the measured duration of `NN.wav`. The pipeline asserts
`sum(scene.dur) == duration(concatenated audio)` within a few ms.

## Backends

Behind one interface — `synthesize(who, text, out_path) -> Path` (see `backends.py`):

| Backend | Package | `speaker` means | Notes |
|---------|---------|-----------------|-------|
| `piper` | `piper-tts` | ONNX voice name | zero-config; downloads voice on first use |
| `xtts`  | `coqui-tts` | studio speaker name | ~1.9GB model; MPS/CPU; imports `xtts_compat` first |

Voices with different backends can coexist in one project; one model instance is
loaded per backend type.

## Key behaviors (from LEARNINGS.md)

- Synthesize sentence-by-sentence; splice fixed silence gaps; ~12ms fades at each
  sentence edge.
- Speed via ffmpeg `atempo` (pitch-preserving), never the XTTS `speed` param.
- `loudnorm` per scene, then **rescale** each scene's timings to the measured wav
  duration — loudnorm compresses ~2.9%, so this is the caption-sync fix.

## Self-test / import check

The heavy deps are imported lazily, so the package imports without piper/coqui:

```bash
python -c "import narova_tts; print(narova_tts.__version__)"
python -m narova_tts --help
```

A real run needs a backend installed and `ffmpeg`/`ffprobe` on `PATH`.
