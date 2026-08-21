---
name: narova-openai
description: >
  Use this optional Narova companion when the user explicitly requests OpenAI
  text-to-speech, an OpenAI voice such as marin or cedar, a custom OpenAI voice
  ID, gpt-4o-mini-tts, steerable cloud narration, or Sora video generation
  through the OpenAI API. It registers separate speech and video workers
  without adding cloud dependencies or credentials to the main Narova skill.
  Do not use it for ordinary local narrated-video requests; Narova remains
  local-first.
license: Apache-2.0
metadata:
  author: ammar-hasan
  version: "1.1.0"
checksum: c3a0e354616100b6751fcbd49dbdb1a86e594637364de7afe0ab13ff1157e619
---

# Narova + OpenAI

Use this skill for optional OpenAI speech or Sora video generation. Keep every
OpenAI API detail in this companion and communicate through Narova's generic
speech or video JSONL protocol. Let Narova own caching, staging, provenance,
captions, rendering, and every downstream media stage.

Requires the standalone Narova CLI, the Narova skill, Python 3.10+, network
access, an OpenAI Platform project with the requested model access, and
`OPENAI_API_KEY`.

## Setup

1. Install the standalone Narova CLI as described by the `narova` skill, then
   install `narova` and `narova-openai` as independently selected skills from
   `ammar-hasan/narova`.
2. Locate this installed skill from the directory containing this `SKILL.md`;
   call it `<narova-openai-skill-dir>`.
3. Verify the worker:

   ```bash
   bash <narova-openai-skill-dir>/tool/setup.sh
   ```

4. Set the key in the environment that runs Narova. Never put it in
   `reel.config.mjs`:

   ```bash
   export OPENAI_API_KEY="..."
   ```

5. Explicitly register and verify only the workers you need:

   ```bash
   narova providers add \
     <narova-openai-skill-dir>/tool/provider.json
   narova providers doctor openai
   narova voices list --backend openai
   narova providers add \
     <narova-openai-skill-dir>/tool/video-provider.json
   narova providers doctor sora
   ```

Read [references/configuration.md](references/configuration.md) before writing
a voice block. Read [references/video-generation.md](references/video-generation.md)
before using Sora, including its announced API shutdown date.

## Operating rules

- Default to `gpt-4o-mini-tts` with `marin` or `cedar`; use the dated model
  snapshot when a render must remain pinned.
- Put delivery direction in `providerOptions.instructions`, not visible
  caption text. Keep `vo.text` clean; reserve `synthesisText` for wording that
  should be spoken but not captioned.
- Keep `OPENAI_API_KEY` only in the process environment or a user-managed
  secret store.
- Do not add the OpenAI SDK to Narova's venv or modify Narova's setup.
- Do not copy this worker into the Narova skill. Registration composes two
  independently installed skills.
- Treat synthesis as a network operation that may be rate-limited or billed.
- Do not automatically retry synthesis failures. A request may be billed even
  when the connection fails before Narova receives it.
- Disclose to end users that the voice is AI-generated.
- Let Narova's sentence cache avoid repeat billing. Text, voice, language,
  tempo, gain, provider version, model, speed, or instructions changes
  invalidate the relevant cache entry.
- Treat Sora generation as an explicit, billed network operation. Do not retry
  a submission automatically; the remote job may already exist.
- Keep Sora's lifecycle warning visible. Its API is currently deprecated and
  scheduled to shut down on September 24, 2026.
