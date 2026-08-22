# Configuration: Google companion

Two independently registered workers live in `tool/`:

| Provider | Protocol | Manifest | Worker |
|----------|----------|----------|--------|
| `google` | `narova-tts-provider/v1` | `tool/provider.json` | `tool/worker.py` |
| `veo` | `narova-video-provider/v1` | `tool/video-provider.json` | `tool/video-worker.py` |

Both read `GEMINI_API_KEY` from the process environment. The manifests store
the environment name only, never a value. The key is sent only in the
provider-specific `x-goog-api-key` request header and never appears in URLs,
project config, responses, recipes, or error text.

## Speech provider: `google`

Target API: Gemini text-to-speech through the Gemini API
(`generativelanguage.googleapis.com`) using the `generateContent` endpoint with
audio response modality. Model identifiers are Google-side concerns and change;
the worker ships with a supported set that can be updated in the companion
without touching core.

Options (unknown options are rejected before any network call):

| Option | Meaning |
|--------|---------|
| `model` (or legacy `modelId`) | Gemini TTS model identifier from the supported set. |
| `instructions` (or legacy `style`) | Delivery direction prepended to the spoken text. |
| `requestTimeoutSeconds` | Per-request timeout, 1–300 seconds. |

The core-supplied `speaker` is mapped to the Google prebuilt voice name and
`language`, when provided, to the request's language field. Tempo control stays
with Narova core; this worker does not accept a speed option.

Output: a non-empty mono 16-bit PCM WAV written atomically to the absolute
output path supplied by core. Google-returned raw PCM (`audio/L16;…;rate=…`)
is wrapped into a WAV container locally; no external converter or SDK is used.

Voice listing returns the built-in voice catalog without network access.

Errors use provider-side codes (`missing_environment`, `authentication_failed`,
`rate_limited`, `invalid_options`, `invalid_request`, `invalid_response`,
`invalid_output`, `network_error`, `service_error`, `unsupported_protocol`,
`unsupported_operation`, `internal_error`). No automatic retry ever happens.

Billing and disclosure: synthesis sends text to Google and may be billed or
rate-limited; check current pricing, quotas, and regional availability before
large builds. Speech output is AI-generated and may be watermarked (SynthID)
by Google; disclose that to audiences where required.

## Video provider: `veo`

Target API: Veo video generation through the Gemini API `generateContent`
endpoint with video response modality. Model availability, resolutions,
durations, and aspect ratios are Google-side concerns; the worker validates a
documented allowlist (`durationSeconds` of 4, 6, or 8 and a supported aspect
ratio) before any network call.

Options:

| Option | Meaning |
|--------|---------|
| `model` | Veo model identifier from the supported set. |
| `durationSeconds` | 4, 6, or 8 seconds. |
| `aspectRatio` | Requested aspect ratio from the supported set. |
| `seed` | Integer seed where the model honors reproducibility. |
| `requestTimeoutSeconds` | Per-request timeout, 1–1200 seconds. |

Lifecycle: exactly one creation submission per invocation; no polling loop,
resubmission, or automatic retry. The completed video bytes are placed at the
exact private staged path core supplies; core owns validation, publication,
provenance, and registration.

Metadata returned on success names the resolved model and normalized
parameters. Generated videos may be SynthID-watermarked by Google; disclose AI
generation where required. Generation may be billed or rate-limited; check
current pricing and model access first.

## Security

- Credentials live only in declared environment variables.
- stdout carries JSONL protocol messages only; diagnostics go to stderr.
- Output paths must be absolute regular-file paths that are not symlinks.
- Core scans options, requests, responses, recipes, and error messages for the
  exact credential value; nothing secret is stored by this companion.

## Removal

Unregister each provider independently (`narova providers remove google`,
`narova providers remove veo`) and delete the skill through your skill manager.
The two actions are independent.
