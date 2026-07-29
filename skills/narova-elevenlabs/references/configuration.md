# ElevenLabs provider configuration

## Install and register

Install the main `narova` skill and this `narova-elevenlabs` skill as separate
selected skills from the repository. Their installed directories do not need
to be adjacent.

```bash
npx skills add ammar-hasan/narova --skill narova
npx skills add ammar-hasan/narova --skill narova-elevenlabs
```

From the two independently located skill directories:

```bash
bash <narova-elevenlabs-skill-dir>/tool/setup.sh
export ELEVENLABS_API_KEY="..."
node <narova-skill-dir>/tool/bin/narova.js providers add \
  <narova-elevenlabs-skill-dir>/tool/provider.json
node <narova-skill-dir>/tool/bin/narova.js providers doctor elevenlabs
```

Registration resolves the worker path and stores a normalized manifest under
`~/.narova/providers/elevenlabs.json` (or `$NAROVA_HOME/providers/`). Narova
does not scan or execute unregistered skill files.

## Project configuration

Use the ElevenLabs voice ID as `speaker`:

```js
export default {
  voices: {
    narrator: {
      backend: "elevenlabs",
      speaker: "your-elevenlabs-voice-id",
      providerOptions: {
        model: "eleven_multilingual_v2",
        stability: 0.45,
        similarityBoost: 0.8
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
- `outputFormat` (default `mp3_44100_128`; converted to mono PCM WAV)
- `stability`, `similarityBoost`, `style`, `useSpeakerBoost`, `speed`
- `voiceSettings` using the API's snake_case voice-setting keys
- `applyTextNormalization`, `applyLanguageTextNormalization`, `seed`
- `requestTimeoutSeconds` from 1 to 300

Narova treats this object as opaque JSON. The companion worker validates and
maps it to ElevenLabs. Do not put API keys, authorization headers, tokens,
passwords, or other secrets in this object; Narova rejects secret-like keys.

The optional per-voice `lang`, or a turn's `lang`, is sent as the API
`language_code`. Model support determines whether it has an effect.

## Voice listing and synthesis

```bash
node <narova-skill-dir>/tool/bin/narova.js voices list --backend elevenlabs
node <narova-skill-dir>/tool/bin/narova.js synth --project <project-dir>
node <narova-skill-dir>/tool/bin/narova.js build --project <project-dir>
```

Voice listing returns `voice-id<TAB>display-name`. It uses the account
associated with `ELEVENLABS_API_KEY`.

The worker requests encoded audio from ElevenLabs and converts it to a valid
mono WAV with ffmpeg. Narova then applies its normal sentence cache, tempo,
gain, fades, resampling, loudness normalization, concatenation, alignment,
timing rescaling, captions, composition, and rendering.

## Errors

- `missing_environment`: set `ELEVENLABS_API_KEY` in the same environment that
  launches Narova.
- `authentication_failed`: verify the key and voice permissions.
- `rate_limited`: check account quota, subscription, and rate limits.
- `invalid_request` / `invalid_options`: check voice ID, model access, and
  provider options.
- `network_error`: connectivity failed. Narova does not automatically retry.
- `audio_conversion_failed`: verify ffmpeg and the downloaded audio format.

Run `narova providers doctor elevenlabs` to isolate registration, executable,
environment, and handshake failures from project configuration failures.

## Security and billing

- Store the key in the environment or a secret manager, never in
  `reel.config.mjs`, manifests, logs, screenshots, or generated files.
- The worker sends the key only in the `xi-api-key` request header and never
  prints it.
- Audio synthesis is a paid/network operation under the account's ElevenLabs
  terms. Check current plan pricing, model availability, voice permissions,
  and character quota before a large build.
- Synthesis is not automatically retried because a request can be billable
  even if the client loses the response.
- Narova's sentence cache reduces repeat calls. Changing synthesis inputs
  intentionally invalidates affected entries.

## Update, unregister, and uninstall

Provider implementation version is captured at registration for deterministic
cache identity. After updating this companion skill, unregister and register
it again:

```bash
node <narova-skill-dir>/tool/bin/narova.js providers remove elevenlabs
node <narova-skill-dir>/tool/bin/narova.js providers add \
  <narova-elevenlabs-skill-dir>/tool/provider.json
```

To stop using it, run `providers remove elevenlabs`, then remove the companion
skill through the skill manager. Existing local Narova backends remain
unchanged.

## Compatibility

Requires Narova with `narova-tts-provider/v1`, Python 3.10+, ffmpeg, network
access to the ElevenLabs API, and an ElevenLabs account/API key. The worker has
no third-party Python dependency and does not modify Narova's venv.
