# Frame sequence encoding

This reference describes the bounded handoff from a committed PNG frame
directory to a local MP4. The companion exposes controls, consequences,
validation, and evidence. It does not rank, recommend, infer, or select a
creative choice. The authoring agent remains free to choose or experiment.

Core Narova still owns canonical time, narration, captions, music, final
audiovisual composition, judgment, release, and delivery.

## Request schema

Every creative field is required. Only execution safety bounds are optional.

| Field | Type | Required | Meaning |
|---|---|---:|---|
| `schema` | string | yes | `narova.3d-frame-encode/1` |
| `correlationId` | string | yes | Caller-supplied operation identifier |
| `input` | string | yes | Project-relative PNG-frame directory |
| `output` | string | yes | Project-relative `.mp4` destination |
| `inputFps` | number | yes | Intended source rate, from 1 through 240 |
| `outputFps` | number | yes | Encoded rate, from 1 through 240; the source duration must yield a whole output-frame count at this rate |
| `interpolation` | string | yes | `hold`, `blend`, or `motion-compensated` |
| `width` | number | yes | Output width, from 1 through 16384 |
| `height` | number | yes | Output height, from 1 through 16384 |
| `scale` | string | yes | `neighbor`, `bilinear`, `bicubic`, or `lanczos` |
| `codec` | string | yes | `libx264` produces H.264, which is widely decoded; `libx265` produces HEVC, which can reduce bytes for similar retained detail but can require more encode/decode work and has narrower playback support |
| `pixFmt` | string | yes | `yuv420p` subsamples chroma horizontally and vertically and is widely decoded; `yuv422p` retains full vertical chroma resolution; `yuv444p` does not subsample chroma. More chroma detail can increase bytes and narrow playback support |
| `crf` | number | yes | Codec quality factor from 0 through 51; lower values generally retain more encoded detail and usually increase size |
| `preset` | string | yes | x264/x265 speed preset from `ultrafast` through `veryslow`; slower presets generally spend more compute for compression efficiency |
| `timeoutMs` | number | no | Execution bound from 1 through 600000 milliseconds |
| `maxInputBytes` | number | no | Maximum accepted total input-frame bytes |
| `maxOutputBytes` | number | no | Maximum accepted encoded bytes |

`timeoutMs`, `maxInputBytes`, and `maxOutputBytes` bound execution; they do not
change the requested visual treatment. The receipt records the applied values,
including safety defaults when the request omits them.

## Interpolation consequences

These descriptions expose mechanics and possible observations only. They do
not express a preferred mode.

### `hold`

FFmpeg holds, drops, or duplicates source frames to reach `outputFps`. It does
not synthesize motion-estimated frames. Original source images remain the only
visual states, while motion can appear stepped when source and output rates
differ.

### `blend`

FFmpeg creates intermediate frames by blending adjacent source frames. Motion
can appear smoother. Moving edges can show temporal blur, doubled detail, or
ghosting.

### `motion-compensated`

FFmpeg estimates motion and synthesizes intermediate frames. Motion can appear
smoother with less blend blur. Occlusions, fast movement, fine patterns, and
shot changes can produce warped or invented detail.

## Scaling consequences

- `neighbor` copies the nearest source sample and can preserve hard pixel
  boundaries while producing jagged or block-like edges.
- `bilinear` combines nearby samples with low compute cost and can soften
  detail.
- `bicubic` uses a wider sample neighborhood and can retain more apparent
  detail while introducing ringing near strong edges.
- `lanczos` uses a wider sinc-based filter and can retain fine detail while
  producing halos or ringing near high-contrast edges.

## Invocation

```sh
node tools/frame-sequence-to-mp4.js /absolute/project encode-request.json encode-receipt.json
```

Example with explicitly selected values:

```json
{
  "schema": "narova.3d-frame-encode/1",
  "correlationId": "final-encode",
  "input": "production/scene-001/frames",
  "output": "assets/scene-001.mp4",
  "inputFps": 30,
  "outputFps": 30,
  "interpolation": "hold",
  "width": 1920,
  "height": 1080,
  "scale": "lanczos",
  "codec": "libx264",
  "pixFmt": "yuv420p",
  "crf": 18,
  "preset": "medium"
}
```

## Validation and receipt

The operation:

- rejects paths outside the project, including symbolic-link escapes;
- rejects aliases and unsafe nesting among the request, receipt, input frame
  directory, and output clip;
- requires one contiguous, equally padded PNG sequence with one filename
  prefix, rejects child-frame symbolic links, and validates every PNG signature;
- derives a literal-safe FFmpeg pattern from the actual prefix, extension case,
  and filename padding;
- records the aggregate input byte count and SHA-256 identity;
- rejects an input/output rate combination when the declared source duration
  cannot be represented by a whole number of output frames;
- stages and probes the encoded file before replacing an existing clip;
- validates one video stream, no audio stream, codec, pixel format, dimensions,
  exact frame count, frame rate, duration, and byte bounds;
- hashes large artifacts incrementally and records bounded FFmpeg/FFprobe build,
  resolved-path, and executable identity;
- keeps rollback bytes until the success receipt commits, so an ordinary
  receipt-publication failure restores the previous clip;
- cleans only the private staging directory created for that operation; and
- publishes the receipt atomically.

The `narova.3d-frame-encode-result/1` receipt records the exact choices,
measured input and output facts, bounded tool identities, timing, diagnostics,
warnings, and determinism limits. It does not interpret quality, taste, or
suitability; those remain part of ordinary Narova judgment and agent review.
Malformed requests receive a failure receipt when the requested receipt path is
safe. When that path aliases an input or output artifact, the operation refuses
to write it and reports the error through the process exit instead.
