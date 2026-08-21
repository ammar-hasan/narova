---
name: narova-runway
description: >
  Use this optional Narova companion when the user explicitly requests Runway
  video generation, a Runway model such as gen4.5, or a Runway-generated clip
  for a Narova scene. It installs and registers a separate Runway video worker
  without adding cloud dependencies or credentials to the main Narova skill.
  Do not use it for ordinary local rendering; Narova remains local-first.
license: Apache-2.0
metadata:
  author: ammar-hasan
  version: "1.0.0"
checksum: efc196b58925b919472482875a4a336fcc59b20e25c96398d54bb3de76ac8f1b
---

# Narova + Runway

Use this skill as an optional external video-generation provider for Narova.
Keep every Runway API detail in this companion and communicate through the
generic `narova-video-provider/v1` JSONL protocol. Let Narova own staging,
provenance, generation recipes, the asset registry, caching, and rendering.

Requires the standalone Narova CLI, the Narova skill, Python 3.10+, network
access, a Runway API account with model access, and `RUNWAYML_API_SECRET`.

## Setup

1. Install the standalone Narova CLI as described by the `narova` skill, then
   install `narova` and `narova-runway` as independently selected skills from
   `ammar-hasan/narova`.
2. Locate this installed skill from the directory containing this `SKILL.md`;
   call it `<narova-runway-skill-dir>`.
3. Verify the worker:

   ```bash
   bash <narova-runway-skill-dir>/tool/setup.sh
   ```

4. Set the key only in the environment that runs Narova:

   ```bash
   export RUNWAYML_API_SECRET="..."
   ```

5. Explicitly register and verify the worker:

   ```bash
   narova providers add \
     <narova-runway-skill-dir>/tool/provider.json
   narova providers doctor runway
   ```

Read [references/configuration.md](references/configuration.md) before
generating. It documents option mapping, errors, security, billing, and
removal.

## Operating rules

- Treat generation as an explicit, billed network operation. The authored
  prompt is sent to Runway.
- Keep `RUNWAYML_API_SECRET` only in the process environment or a user-managed
  secret store; never put it in `reel.config.mjs`.
- Do not add the Runway SDK to Narova or modify Narova's setup. This worker uses
  the Python standard library.
- Do not copy this worker into the Narova skill. Registration composes two
  independently installed skills.
- Do not automatically retry a failed submission. The remote task may already
  exist and may be billed even if the connection fails before Narova sees it.
- Let Narova publish the generated clip and its recipe only after worker
  success; worker failures leave the final asset and registry unchanged.
