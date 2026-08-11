---
name: narova-stock-extensions
description: Use this optional Narova companion for broad, creative internet sourcing when the built-in stock adapters do not produce a suitable photo, video, audio file, font, 2D asset, 3D asset, texture, HDRI, map, scientific visual, or cultural object. Use it when the user requests exhaustive provider exploration, browser-sourced media, or an LLM-led search across changing websites. Work with the available web search, HTTP, or interactive browser capability; do not require a browser. Keep discovery flexible, inspect the selected item and rights, and return downloaded bytes through Narova's core asset lifecycle.
---

# Narova Stock Extensions

Use this skill as Narova's flexible discovery layer. Do not install another CLI
or implement stable provider APIs here. Narova core owns all repeatable search,
download, normalization, hashing, provenance, verification, and credits.

## Workflow

1. Run `narova assets providers`. Prefer a ready core adapter matching the
   required media kind. Missing optional credentials must not block other
   providers.
2. Search core with `narova assets search`, inspect candidates, and acquire only
   the chosen item with `narova assets acquire`.
3. If the results are creatively weak, read
   [references/providers.md](references/providers.md) and choose a small number
   of relevant loose providers.
4. Use the least complex capability currently available:
   - use web search/open or direct HTTP for readable public pages and files;
   - use an interactive browser for JavaScript search, item inspection, or an
     explicit download action;
   - without web access, work only from user-supplied pages/files or return a
     sourcing plan. Never pretend that an unvisited provider was checked.
5. Inspect the exact item page, file, dimensions or duration, creator, and
   item-level license. A homepage or thumbnail is discovery evidence only.
6. Finish through `narova assets download` for an official direct URL or
   `narova assets import` for bytes already downloaded by a browser or user.
   Record the provider, item ID, source page, and only rights actually shown.
7. Run `narova assets verify` and review `narova assets credits` before using
   the asset.

Keep search separate from acquisition so creative selection stays deliberate.
Never search during a build, bypass site controls, infer a license from a
provider-wide reputation, or claim a loose provider is mechanically supported.

## Core boundary

The built-in CLI includes Wikimedia Commons, Openverse, NASA, Internet Archive,
Iconify, Poly Haven, The Met, Cleveland Museum of Art, Library of Congress,
Pexels, Pixabay, and Freesound. Pexels, Pixabay, and Freesound become ready only
when their optional environment key is present.

Everything in the provider reference is LLM-led discovery. Some sources work
with ordinary search or HTTP; others require a browser. Their changing flows
remain intentionally outside core until a stable adapter can pass real search,
download, registry, and verification tests.
