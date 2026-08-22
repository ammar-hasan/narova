---
name: narova-google
description: >
  Use this optional Narova companion when the user explicitly requests Google
  speech generation (Gemini TTS), Google Veo video generation, or a
  Google-generated clip or voiceover for a Narova scene. It installs and
  registers separate Google speech and video workers without adding cloud
  dependencies or credentials to the main Narova skill. Do not use it for
  ordinary local rendering or local voices; Narova remains local-first.
license: Apache-2.0
metadata:
  author: ammar-hasan
  version: "1.0.0"
checksum: 905327d0708a4d4c060464a6e609329f435b01fd29124d6158b077d4981a737c
---

# Narova + Google (Gemini TTS and Veo)

Use this skill as an optional external speech and video-generation provider for
Narova. Keep every Google API detail in this companion and communicate through
the generic `narova-tts-provider/v1` and `narova-video-provider/v1` JSONL
protocols. Let Narova own staging, provenance, generation recipes, the asset
registry, caching, and rendering.

Requires the standalone Narova CLI, the Narova skill, Python 3.10+, network
access, a Google AI Studio account with Gemini API access, and `GEMINI_API_KEY`.

## Setup

1. Install the standalone Narova CLI as described by the `narova` skill, then
   install `narova` and `narova-google` as independently selected skills from
   `ammar-hasan/narova`.
2. Locate this installed skill from the directory containing this `SKILL.md`;
   call it `<narova-google-skill-dir>`.
3. Verify the workers:

   ```bash
   bash <narova-google-skill-dir>/tool/setup.sh
   ```

4. Set the key only in the environment that runs Narova:

   ```bash
   export GEMINI_API_KEY="..."
   ```

5. Explicitly register one or both providers and verify:

   ```bash
   narova providers add \
     <narova-google-skill-dir>/tool/provider.json
   narova providers add \
     <narova-google-skill-dir>/tool/video-provider.json
   narova providers doctor google
   narova providers doctor veo
   ```

Installing this skill registers neither provider by itself. Unregistering a
provider does not remove the skill.

Read [references/configuration.md](references/configuration.md) before use. It
documents option mapping, errors, security, billing, AI-generation and SynthID
disclosure, and removal.

## Operating rules

- Treat synthesis and generation as explicit, billed network operations. The
  authored text/prompt is sent to Google.
- Keep `GEMINI_API_KEY` only in the process environment or a user-managed
  secret store; never put it in `reel.config.mjs`.
- Do not add a Google SDK to Narova or modify Narova's setup. These workers use
  the Python standard library.
- Do not copy these workers into the Narova skill. Registration composes two
  independently installed skills.
- Do not automatically retry a failed request. A lost response may still have
  been processed and billed.
- Let Narova publish synthesized audio or generated clips only after worker
  success; worker failures leave assets and the registry unchanged.
- Disclose that speech output is AI-generated and that generated videos may be
  SynthID-watermarked where that matters to the audience.
