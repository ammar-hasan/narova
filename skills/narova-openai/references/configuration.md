# OpenAI provider configuration

## Contents

- [Install and register](#install-and-register)
- [Recommended configuration](#recommended-configuration)
- [Current model choices](#current-model-choices)
- [Voices](#voices)
- [Synthesis behavior](#synthesis-behavior)
- [Performance text and captions](#performance-text-and-captions)
- [Errors](#errors)
- [Security, billing, and disclosure](#security-billing-and-disclosure)
- [Update, unregister, and uninstall](#update-unregister-and-uninstall)
- [Compatibility](#compatibility)

## Install and register

Install the main `narova` skill and this companion as separate selected skills:

```bash
npx skills add ammar-hasan/narova --skill narova
npx skills add ammar-hasan/narova --skill narova-openai
```

From the independently located skill directories:

```bash
bash <narova-openai-skill-dir>/tool/setup.sh
export OPENAI_API_KEY="..."
narova providers add \
  <narova-openai-skill-dir>/tool/provider.json
narova providers doctor openai
```

Registration resolves the worker path and stores a normalized manifest under
`~/.narova/providers/openai.json` (or `$NAROVA_HOME/providers/`). Narova does
not scan or execute unregistered skill files.

## Recommended configuration

Use an OpenAI built-in voice name as `speaker`. The live OpenAI TTS guide
recommends `marin` or `cedar` for best quality:

```js
export default {
  voices: {
    narrator: {
      backend: "openai",
      speaker: "marin",
      providerOptions: {
        model: "gpt-4o-mini-tts",
        instructions: "Warm, natural documentary narration. Confident, not salesy.",
        speed: 1.04
      },
      color: "#2ee6d6",
      label: "Narrator"
    }
  },
  // timing, scenes, theme…
}
```

Supported `providerOptions`:

- `model` or `modelId`
- `instructions` (up to 4096 characters; steer accent, emotional range,
  intonation, pace, tone, and whispering)
- `speed` from `0.25` to `4.0`
- `requestTimeoutSeconds` from 1 to 300

Narova treats this object as opaque JSON. The companion validates and maps it
to OpenAI. Do not put API keys, authorization headers, tokens, passwords, or
other secrets in this object; Narova rejects secret-like keys.

The optional per-voice or per-turn `lang` becomes explicit BCP 47 language
guidance for steerable models. The input text still determines pronunciation,
and OpenAI notes that built-in voices are currently optimized for English.

## Current model choices

The Speech API currently accepts:

- `gpt-4o-mini-tts` — default and current guide recommendation; supports
  delivery instructions.
- `gpt-4o-mini-tts-2025-12-15` — latest fixed snapshot; use when reproducible
  behavior matters more than following the moving alias.
- `tts-1-hd` — legacy higher-quality TTS; does not support instructions.
- `tts-1` — legacy lower-latency TTS; does not support instructions.

The provider rejects other model names early. GPT-Realtime and GPT-Live are
for interactive speech conversations, not Narova's completed-utterance file
contract. OpenAI's July 2026 GPT-Live announcement says API availability is
forthcoming, so those models are not exposed here.

Current sources, checked 2026-08-03:

- <https://developers.openai.com/api/docs/guides/text-to-speech>
- <https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create>
- <https://developers.openai.com/api/docs/models/gpt-4o-mini-tts>
- <https://openai.com/index/introducing-gpt-live/>

## Voices

List the 13 built-in voices without making a paid API request:

```bash
narova voices list --backend openai
```

The current built-ins are `alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`,
`nova`, `onyx`, `sage`, `shimmer`, `verse`, `marin`, and `cedar`. Use `marin`
or `cedar` first for quality.

Eligible OpenAI customers can use an already-created custom voice ID as the
`speaker`, for example `voice_1234`. The worker sends such IDs using the API's
custom-voice object shape. Voice creation is intentionally outside this
provider: OpenAI requires a separate consent recording and matching sample,
limits samples to 30 seconds and 10 MiB, and applies supplemental terms.

## Synthesis behavior

```bash
narova synth --project <project-dir>
narova build --project <project-dir>
```

The worker requests WAV directly from `POST /v1/audio/speech`, validates it,
and atomically publishes one utterance file. Requesting WAV avoids an SDK and
an unnecessary lossy encode/decode step. Narova then applies its normal
sentence cache, tempo, gain, fades, resampling, loudness normalization,
concatenation, alignment, timing rescaling, captions, composition, and render.

The endpoint supports streamed transfer, but Narova's provider protocol waits
for a completed utterance file. Realtime playback would not improve the
offline render pipeline and would complicate validation and cache atomicity.

The API reference limits one speech request to 4096 input characters. Narova
normally sends one sentence at a time, keeping requests well below that limit.

## Performance text and captions

Keep visible words in `vo.text`. Put delivery direction in
`providerOptions.instructions`:

```js
providerOptions: {
  instructions: "Speak with restrained excitement, precise diction, and a gentle final cadence."
}
```

If spoken wording must differ from captions, put the caption-safe wording in
`vo.text` and the spoken wording in `vo.synthesisText`. Do not embed directions
such as `[whispering]` in `vo.text`; they will appear in SRT, VTT, and karaoke
captions.

## Errors

- `missing_environment`: set `OPENAI_API_KEY` in the environment that launches
  Narova.
- `authentication_failed`: verify the key, project, model, and custom-voice
  permissions.
- `rate_limited`: check project quota, spend limits, and rate limits.
- `invalid_request` / `invalid_options`: check model, voice, text length,
  instructions, speed, and project access.
- `network_error`: connectivity failed. Narova does not automatically retry.
- `invalid_response`: OpenAI returned empty or malformed WAV audio.

Run `narova providers doctor openai` to isolate registration, executable,
environment, and handshake failures from project configuration failures.

## Security, billing, and disclosure

- Store the key in the environment or a secret manager, never in
  `reel.config.mjs`, manifests, logs, screenshots, or generated files.
- The worker sends the key only in the bearer authorization header and never
  prints it.
- Synthesis is a billed API operation under the OpenAI Platform project.
  Review current pricing, access, quota, and rate limits before a large build.
- Synthesis is not automatically retried because a request can be billable
  even if the client loses the response.
- Narova's sentence cache reduces repeat calls. Changing synthesis inputs
  intentionally invalidates affected entries.
- OpenAI requires clear disclosure to end users that TTS output is
  AI-generated and not a human voice.

## Update, unregister, and uninstall

Provider implementation version is captured at registration for deterministic
cache identity. After updating this companion, register it again:

```bash
narova providers remove openai
narova providers add \
  <narova-openai-skill-dir>/tool/provider.json
```

To stop using it, remove the registration and then remove the companion skill.
Existing local Narova backends remain unchanged.

## Compatibility

Requires Narova with `narova-tts-provider/v1`, Python 3.10+, network access to
the OpenAI API, an OpenAI Platform project/API key, and access to the selected
speech model or custom voice. The worker uses only Python's standard library
and does not modify Narova's venv.
