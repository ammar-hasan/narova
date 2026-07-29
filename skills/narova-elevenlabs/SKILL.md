---
name: narova-elevenlabs
description: >
  Use this optional Narova companion when the user explicitly requests
  ElevenLabs, an ElevenLabs voice or voice ID, or hosted/premium cloud TTS for
  a Narova project. It installs and registers a separate ElevenLabs provider
  worker without adding cloud dependencies or credentials to the main Narova
  skill. Do not use it for ordinary local narrated-video requests; Narova
  remains local-first.
license: MIT
compatibility: >
  Requires the narova skill, Python 3.10+, ffmpeg, network access, an
  ElevenLabs account, and ELEVENLABS_API_KEY.
metadata:
  author: ammar-hasan
  version: "1.0.0"
---

# Narova + ElevenLabs

This skill is an optional external TTS provider for Narova. It owns all
ElevenLabs API details and speaks the generic `narova-tts-provider/v1` JSONL
protocol over stdin/stdout. Narova owns sentence caching and every downstream
audio/video stage.

## Setup

1. Install `narova` and `narova-elevenlabs` as independently selected skills
   from `ammar-hasan/narova`.
2. Locate this installed skill from the directory containing this `SKILL.md`;
   call that absolute directory `<narova-elevenlabs-skill-dir>`.
3. Locate the separately installed main Narova skill from its own `SKILL.md`;
   call that `<narova-skill-dir>`. Do not assume the two skill directories are
   adjacent.
4. Verify this worker:

   ```bash
   bash <narova-elevenlabs-skill-dir>/tool/setup.sh
   ```

5. Set the key in the environment used to run Narova. Never put it in
   `reel.config.mjs`:

   ```bash
   export ELEVENLABS_API_KEY="..."
   ```

6. Explicitly register this installed worker:

   ```bash
   node <narova-skill-dir>/tool/bin/narova.js providers add \
     <narova-elevenlabs-skill-dir>/tool/provider.json
   ```

7. Verify registration and authentication:

   ```bash
   node <narova-skill-dir>/tool/bin/narova.js providers doctor elevenlabs
   node <narova-skill-dir>/tool/bin/narova.js voices list --backend elevenlabs
   ```

Read [references/configuration.md](references/configuration.md) before writing
the voice block. It documents supported provider options, synthesis, errors,
security, billing, and removal.

## Operating rules

- Treat `speaker` as an ElevenLabs voice ID, not a display name.
- Keep `ELEVENLABS_API_KEY` only in the process environment or a user-managed
  secret store.
- Do not add ElevenLabs packages to Narova's venv or modify Narova's setup.
- Do not copy this worker into the Narova skill. Registration composes the two
  independently installed skills.
- Voice listing and synthesis are network operations and may be subject to
  account permissions, rate limits, and charges.
- Do not automatically retry synthesis failures. A response may have been
  billed even when the connection failed before Narova received it.
- Narova's sentence cache avoids billing again for unchanged sentences. A
  change to text, voice ID, language, tempo, gain, provider version, or
  `providerOptions` invalidates the relevant cache entry.
