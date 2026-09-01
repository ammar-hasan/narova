# Configuration: Xiaomi MiMo companion

One independently registered worker lives in `tool/`:

| Provider | Protocol | Manifest | Worker |
|----------|----------|----------|--------|
| `mimo` | `narova-tts-provider/v1` | `tool/provider.json` | `tool/worker.py` |

The worker reads `MIMO_API_KEY` from the process environment. The manifest
stores the environment name only, never a value. The key is sent only in the
provider-specific `api-key` request header and never appears in URLs, project
config, responses, recipes, or error text; diagnostics redact it.

Target API: the hosted MiMo V2.5-TTS series through the OpenAI-compatible
`POST {base}/chat/completions` endpoint. The spoken text goes in the
`assistant` message; the `user` message carries direction that is not spoken
(style instructions, or the voice-design brief for the design model). The
worker always requests `audio.format: "wav"` and decodes base64 audio from
`choices[0].message.audio.data`.

## Endpoint selection

| `endpoint` option | Base URL | Use |
|---|---|---|
| `pay-as-you-go` (default) | `https://api.xiaomimimo.com/v1` | standard metered account |
| `token-plan-cn` | `https://token-plan-cn.xiaomimimo.com/v1` | Token Plan subscription, China cluster |
| `token-plan-sgp` | `https://token-plan-sgp.xiaomimimo.com/v1` | Token Plan subscription, Singapore cluster |
| `token-plan-ams` | `https://token-plan-ams.xiaomimimo.com/v1` | Token Plan subscription, Europe cluster |

Token Plan keys (`tp-…`) are cluster-scoped: a key is valid only on the cluster
shown in the console when the subscription was created (verified live
2026-08-25: a Singapore-cluster key is rejected by the China and Europe bases
with `Invalid API Key`). `MIMO_BASE_URL` overrides the option entirely when
set; it must be an `https` URL or the request fails with `invalid_options`
before any network call. The option participates in Narova's speech cache
identity like every other behavior-affecting input.

## Model identities

| `model` option | Voice source | Notes |
|---|---|---|
| `mimo-v2.5-tts` (default) | preset catalog; core `speaker` is the preset voice ID | only model that sings |
| `mimo-v2.5-tts-voicedesign` | generated from the required `design` brief (user message) | no `voice` field is sent; `instructions`/`style` are rejected — direction belongs in the brief or inline tags |
| `mimo-v2.5-tts-voiceclone` | cloned from a reference audio data URI | `speaker` must be an absolute path to a local `.mp3`/`.wav` file |

Preset catalog (returned by `listVoices` without network access): `mimo_default`
(cluster-dependent — CN clusters resolve to 冰糖, others to Mia; pin an explicit
voice ID for reproducible work), 冰糖 (Chinese, female), 茉莉 (Chinese,
female), 苏打 (Chinese, male), 白桦 (Chinese, male), Mia (English, female),
Chloe (English, female), Milo (English, male), Dean (English, male).

## Options

Unknown options are rejected before any network call.

| Option | Meaning |
|--------|---------|
| `model` (or legacy `modelId`) | One of the three model identifiers above. |
| `endpoint` | `pay-as-you-go` (default) or a Token Plan cluster (`token-plan-cn`, `token-plan-sgp`, `token-plan-ams`); overridden by `MIMO_BASE_URL`. |
| `instructions` (or legacy `style`) | Free-form delivery direction sent as the user message (preset and clone models). |
| `design` | Voice-design brief; required for `mimo-v2.5-tts-voicedesign`, at most 2000 characters. |
| `referenceDigest` | Optional 64-lowercase-hex SHA-256 of the clone reference file; a mismatch fails before any network call. |
| `requestTimeoutSeconds` | Per-request timeout, 1–600 seconds (default 120). |

Spoken text is limited to 8000 characters per request.

## Voice design

The `design` brief is a 1–4 sentence description in Chinese or English covering
gender/age, timbre/texture, emotion, and pace. Avoid contradictory traits,
post-processing terms (reverb, EQ), and vague terms. The brief is the durable
authored voice identity; it participates in cache identity like any other
option.

Repeated identical briefs are **not** guaranteed to produce a stable timbre.
For a multi-turn character, use the **consistency anchor pattern**:

1. Synthesize the character's first line with `mimo-v2.5-tts-voicedesign`.
2. Keep that WAV as a project asset.
3. Switch the voice config to `mimo-v2.5-tts-voiceclone` with that file as
   `speaker`, and record its SHA-256 in `referenceDigest`.
4. Drive all remaining turns of that character through the clone model.

The anchor is an explicit, author-chosen voice-config change; the worker never
silently reuses earlier output.

## Style control

All three models honor free-form natural-language direction in the user
message (`instructions`/`style` on preset and clone models) — multi-style
transitions within one utterance, compound emotions, word-level granularity.
Director Mode structures the same direction as 【角色/Character】【场景/Scene】
【指导/Direction】 sections covering persona, situation, pace, breath, pauses,
stress, resonance, and emotional arc.

Inline audio tags live in the **spoken text**: leading style tags such as
`(开心)` or `(唱歌)`, dialect tags `(东北话 四川话 河南话 粤语 台湾腔)`, role-play
tags `(孙悟空 林黛玉)`, and fine-grained tags anywhere in the line — `[吸气]`,
`[笑]`, `[哽咽]`, `[颤抖]`. Because tags are part of the spoken text, put them
in `synthesisText` and keep `vo.text` as the clean caption source.

## Language scope and singing

Chinese and English are first-class, plus the Chinese dialects listed above;
other languages are unproven. Singing works only on the preset model: lead the
spoken text with `(唱歌)` and prefer Chinese lyrics.

## Limits

- 8K-token output ceiling — keep utterances short; Narova's turn model already
  chunks narration.
- No true low-latency streaming — the worker uses the non-streaming WAV
  response; `stream` returns a single chunk after full inference.
- Rate limits: 100 RPM / 10M TPM per account per model.
- Pricing: the TTS series is free under a limited-time promotion at the time of
  writing — check current pricing before large builds.

## Voice cloning

The reference clip is authored project material: a local `.mp3` or `.wav` file
whose base64 encoding is at most 10 MB. The worker reads and validates it
(path, extension, size, optional `referenceDigest`) before any network call and
transmits it only inside the single synthesis request that uses it. Consent and
rights for cloning a real person's voice are the author's responsibility;
disclose AI-generated output where required.

## Output

A non-empty mono 16-bit PCM WAV written atomically to the absolute output path
supplied by core. Raw PCM responses (PCM16LE mono, 24 kHz) are wrapped into a
WAV container locally; no external converter or SDK is used.

## Errors

Provider-side codes: `missing_environment`, `authentication_failed` (401/403),
`rate_limited` (429), `invalid_options`, `invalid_request` (other 4xx and
client-side validation), `invalid_response` (bad JSON, missing or undecodable
audio, invalid WAV), `invalid_output`, `network_error`, `service_error` (5xx),
`unsupported_protocol`, `unsupported_operation`, `internal_error`. No automatic
retry ever happens.

## Security

- Credentials live only in declared environment variables.
- stdout carries JSONL protocol messages only; diagnostics go to stderr.
- Output paths must be absolute regular-file paths that are not symlinks.
- Core scans options, requests, responses, recipes, and error messages for the
  exact credential value; nothing secret is stored by this companion.

## Removal

Unregister the provider (`narova providers remove mimo`) and delete the skill
through your skill manager. The two actions are independent.
