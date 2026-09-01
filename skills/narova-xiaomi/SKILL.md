---
name: narova-xiaomi
description: >
  Use this optional Narova companion when the user explicitly requests Xiaomi
  MiMo speech generation, a MiMo preset voice, text-described voice design, or
  voice cloning from a reference recording for a Narova scene. It installs and
  registers a separate Xiaomi MiMo speech worker without adding cloud
  dependencies or credentials to the main Narova skill. Do not use it for
  ordinary local rendering or local voices; Narova remains local-first.
license: Apache-2.0
metadata:
  author: ammar-hasan
  version: "1.0.0"
checksum: ab56064d2d4a8595f0ed450b7de13f90e2f265e8cbe05093f5ffba262e1322d8
---

# Narova + Xiaomi MiMo (V2.5-TTS)

Use this skill as an optional external speech provider for Narova. Keep every
Xiaomi MiMo API detail in this companion and communicate through the generic
`narova-tts-provider/v1` JSONL protocol. Let Narova own staging, provenance,
generation recipes, the asset registry, caching, and rendering.

Requires the standalone Narova CLI, the Narova skill, Python 3.10+, network
access, a Xiaomi MiMo platform account with API access, and `MIMO_API_KEY`.

## Setup

1. Install the standalone Narova CLI as described by the `narova` skill, then
   install `narova` and `narova-xiaomi` as independently selected skills from
   `ammar-hasan/narova`.
2. Locate this installed skill from the directory containing this `SKILL.md`;
   call it `<narova-xiaomi-skill-dir>`.
3. Verify the worker:

   ```bash
   bash <narova-xiaomi-skill-dir>/tool/setup.sh
   ```

4. Set the key only in the environment that runs Narova:

   ```bash
   export MIMO_API_KEY="..."
   ```

5. Explicitly register the provider and verify:

   ```bash
   narova providers add \
     <narova-xiaomi-skill-dir>/tool/provider.json
   narova providers doctor mimo
   ```

Installing this skill registers no provider by itself. Unregistering the
provider does not remove the skill.

Read [references/configuration.md](references/configuration.md) before use. It
documents endpoint selection, the three model identities (preset voices, voice
design, voice cloning), option mapping, the voice-design anchor pattern, errors,
security, billing, AI-generation disclosure, and removal.

## Operating rules

- Treat synthesis as an explicit, billed network operation. The authored text
  is sent to Xiaomi MiMo.
- Keep `MIMO_API_KEY` only in the process environment or a user-managed
  secret store; never put it in `reel.config.mjs`.
- Do not add a Xiaomi SDK to Narova or modify Narova's setup. This worker uses
  the Python standard library.
- Do not copy this worker into the Narova skill. Registration composes two
  independently installed skills.
- Do not automatically retry a failed request. A lost response may still have
  been processed and billed.
- Let Narova publish synthesized audio only after worker success; worker
  failures leave assets and the registry unchanged.
- Disclose that speech output is AI-generated where that matters to the
  audience. Cloning a real person's voice is the author's consent and rights
  responsibility.
