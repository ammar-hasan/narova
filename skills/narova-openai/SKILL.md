---
name: narova-openai
description: >
  Use this optional Narova companion when the user explicitly requests OpenAI
  text-to-speech, an OpenAI voice such as marin or cedar, a custom OpenAI voice
  ID, gpt-4o-mini-tts, or steerable cloud narration through the OpenAI API. It
  installs and registers a separate OpenAI provider worker without adding
  cloud dependencies or credentials to the main Narova skill. Do not use it
  for ordinary local narrated-video requests; Narova remains local-first.
license: MIT
metadata:
  author: ammar-hasan
  version: "1.0.0"
---

# Narova + OpenAI

Use this skill as an optional external TTS provider for Narova. Keep every
OpenAI API detail in this companion and communicate with Narova through the
generic `narova-tts-provider/v1` JSONL protocol. Let Narova own sentence
caching and every downstream audio/video stage.

Requires the Narova skill, Python 3.10+, network access, an OpenAI Platform
project with speech-model access, and `OPENAI_API_KEY`.

## Setup

1. Install `narova` and `narova-openai` as independently selected skills from
   `ammar-hasan/narova`.
2. Locate this installed skill from the directory containing this `SKILL.md`;
   call it `<narova-openai-skill-dir>`.
3. Locate the main Narova skill from its own `SKILL.md`; call it
   `<narova-skill-dir>`. Do not assume the directories are adjacent.
4. Verify the worker:

   ```bash
   bash <narova-openai-skill-dir>/tool/setup.sh
   ```

5. Set the key in the environment that runs Narova. Never put it in
   `reel.config.mjs`:

   ```bash
   export OPENAI_API_KEY="..."
   ```

6. Explicitly register and verify the worker:

   ```bash
   node <narova-skill-dir>/tool/bin/narova.js providers add \
     <narova-openai-skill-dir>/tool/provider.json
   node <narova-skill-dir>/tool/bin/narova.js providers doctor openai
   node <narova-skill-dir>/tool/bin/narova.js voices list --backend openai
   ```

Read [references/configuration.md](references/configuration.md) before writing
the voice block. It documents current models, voices, instructions, custom
voices, errors, security, disclosure, billing, and removal.

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
