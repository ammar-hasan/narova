---
name: narova-stock-extensions
description: Use this optional Narova companion when a video needs stock photos, stock video, sound effects, cultural media, free 2D illustrations/icons, free 3D models, textures, HDRIs, or a provider beyond Narova's essential Wikimedia, Openverse, NASA, Internet Archive, Iconify, and Poly Haven adapters. It adds deterministic Met, Cleveland Museum, Library of Congress, Pexels, Pixabay, and Freesound adapters, while preserving a flexible browser/LLM route for long-tail public sources. Use it when the user requests stock extensions, broad provider exploration, browser-sourced media, or exhaustive creative-asset sourcing. Do not require optional API keys and do not treat a search result as proof of downloadable bytes or rights.
---

# Narova Stock Extensions

This skill extends Narova's essential stock pack. It does not replace Narova's
asset registry: all downloads return through core for atomic publication,
hashing, provenance, rights, verification, and credits.

## Start

Use the repository script directly, or install the small launcher:

```bash
bash skills/narova-stock-extensions/tool/setup.sh
narova-stock providers
```

The launcher delegates essential providers to `narova` and handles extension
provider API translation itself. Missing `PEXELS_API_KEY`, `PIXABAY_API_KEY`, or
`FREESOUND_API_KEY` disables only that provider.

## Workflow

1. Read [references/providers.md](references/providers.md) when choosing a
   provider, using 2D/3D sources, or leaving the deterministic list.
2. Run `narova-stock providers`. Prefer a ready deterministic provider that
   fits the scene and media kind.
3. Search, inspect the normalized candidates, then acquire the selected ID:

   ```bash
   narova-stock search "our lady" --provider met --kind image --limit 5 --json
   narova-stock acquire 764091 --provider met --kind image \
     --output assets/met-artwork.jpg --project .
   ```

4. Run `narova assets verify` and review `narova assets credits`.
5. If deterministic results are creatively weak, use the browser workflow in
   the provider reference. Search public pages, inspect the real item/license,
   and finish with `narova assets download` or `narova assets import`.

Search and acquisition must stay separate so an agent can make a creative
choice. Never search during a build. Never claim a provider works merely because
its search endpoint returned metadata: automated support requires a real byte
download and registry verification in the live suite.

## Provider boundaries

- Essential/core: Wikimedia, Openverse, NASA, Internet Archive, Iconify (free
  2D SVG), and Poly Haven (free CC0 3D models).
- No-key extensions: The Met, Cleveland Museum of Art, and Library of Congress.
- Optional-key extensions: Pexels, Pixabay, and Freesound.
- Browser/LLM extensions: the larger discovery catalogue in the provider
  reference, including free illustration, 3D, music, SFX, museum, map, and
  science sources.

The browser path is deliberately loose for creative discovery but strict at the
boundary: record the exact item page, do not bypass site controls, do not invent
a license, and import/download through Narova before using the asset.

## Testing

Unit tests are deterministic:

```bash
npm run test:stock-extensions
```

The explicit live test performs real searches and downloads for essential and
no-key extension providers. Credentialed providers run only when their key is
present and otherwise report a skip:

```bash
npm run test:stock-live:extensions
```
