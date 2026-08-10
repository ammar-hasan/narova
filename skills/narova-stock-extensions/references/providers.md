# Provider catalogue and routing

This is a discovery catalogue, not a promise that every website has a stable
API. Provider pages, terms, and remote availability change. A provider is
"verified" only when its automated live test searches and downloads bytes in
the current run.

## Deterministic providers

| Layer | Provider | Media | Credential | Rights behavior |
|---|---|---|---|---|
| essential/core | Wikimedia Commons | image, video, audio | none | per-item review; currently recorded unknown |
| essential/core | Openverse | image, audio | none | returned per-item CC metadata |
| essential/core | NASA Library | image, video, audio | none | per-item review; recorded unknown |
| essential/core | Internet Archive | video, audio | none | declared only when item returns a license |
| essential/core | Iconify | 2D SVG icons | none | icon-set SPDX metadata |
| essential/core | Poly Haven | 3D FBX models | none | CC0; API usage should identify Poly Haven |
| extension | The Metropolitan Museum of Art | images | none | adapter restricts search to public-domain image records; CC0 |
| extension | Cleveland Museum of Art | images | none | adapter restricts search to CC0 records |
| extension | Library of Congress | images | none | heterogeneous; recorded unknown pending item review |
| extension | Pexels | image, video | `PEXELS_API_KEY` | Pexels License |
| extension | Pixabay | image, video | `PIXABAY_API_KEY` | Pixabay Content License |
| extension | Freesound | audio previews | `FREESOUND_API_KEY` | returned per-sound CC license |

Credentialed rows are optional. `narova-stock providers` reports them as not
ready when a key is absent; it does not block any other provider.

ARTIC is intentionally not a deterministic adapter: API search succeeded in
the August 2026 verification, but its IIIF download returned HTTP 403 from the
test environment. Use the item page/browser workflow and do not claim automated
download support until a live search-and-download passes.

## Browser/agent discovery catalogue

Use this list when the deterministic sources are creatively insufficient. It
retains the long-tail choices from Narova's stock reference. The authoritative
structured list is `tool/browser-providers.js`; `narova-stock providers` emits
every entry with readiness `explore` and mode `llm-browser`. "Browser" means an
agent may search and inspect public pages; it does not authorize bypassing
authentication, anti-bot controls, rate limits, or license restrictions.

These entries are providers, not vague fallbacks. They are deliberately loose:
the LLM chooses queries and navigation, while the current item page determines
the downloadable file and rights. Do not mark one ready merely because its home
page opened.

### Photography and imagery

- Pexels website, NASA Earth Observatory/JPL feeds, Wikimedia Commons,
  Openverse, Flickr, Unsplash, Pixabay, and NOAA Media.
- Placeholder/development only: Lorem Picsum and placehold.co. Never ship a
  placeholder as final creative work.

### Stock video

- Pexels website, Mixkit, Coverr, Pixabay Video, NASA Library, Wikimedia
  Commons video, and Internet Archive stock-footage collections.
- Mixkit items can carry either its Free or Restricted stock-video license.
  Inspect the selected item: Restricted items are personal-project only and
  cannot be treated as general-purpose YouTube or commercial footage.

### Music and sound effects

- Music: Mixkit, Pixabay Music, Incompetech, Free Music Archive, ccMixter,
  FreePD, Purple Planet, TeknoAXE, Jamendo, and Liborio Conti.
- Sound effects: Mixkit, Pixabay SFX, Kenney Audio, Freesound, BBC Sound
  Effects, OpenGameArt, Internet Archive Audio, and NASA Audio.

### Fonts

- Google Fonts, Bunny Fonts, Fontsource, Font Squirrel, DaFont, Bootstrap Icons
  font, Remix Icon font, and Tabler Icons font. Prefer self-hosting or pinning
  downloaded files so renders do not depend on a live font request.

### Free 2D icons and illustration

- Essential adapter: Iconify, including its underlying open-source sets.
- Direct sets/CDNs: Simple Icons, Lucide, Tabler, Ionicons, Boxicons, Octicons,
  Feather, Phosphor, FlagCDN, Country Flag Icons, and Mapsicon.
- Illustration libraries: unDraw, DrawKit, Open Doodles, ManyPixels, Lukasz
  Adam, Bioicons, and Isoflat.
- Licenses differ by set and sometimes by individual asset. Preserve SVGs as
  source assets and record the exact collection/item page.

### Free 3D models, textures, and HDRIs

- Essential adapter: Poly Haven CC0 models (small standalone FBX acquisition).
- Browser extensions: Poly Haven textures/HDRIs, ambientCG, Kenney 3D,
  Quaternius, OpenGameArt, Sketchfab's downloadable CC0/CC subsets, NASA 3D
  Resources, and Smithsonian Open Access 3D.
- Prefer GLB or standalone FBX. A bare `.gltf` often references separate binary
  and texture files, so acquiring only that JSON file is usually incomplete.

### Museums, libraries, and cultural collections

- Smithsonian Open Access, The Met, Art Institute of Chicago (ARTIC),
  Cleveland Museum of Art, Wellcome Collection, Rijksmuseum, National Gallery
  of Art, SMK, Europeana, Library of Congress, NYPL Digital Collections,
  Biodiversity Heritage Library, V&A, Te Papa, Science Museum Group, and
  Natural History Museum London.

### Maps, geography, science, and nature

- Maps: OpenStreetMap, Wikimedia OSM tiles, CartoDB, OpenTopoMap,
  Thunderforest, ESRI World Imagery, Nominatim, Natural Earth, GADM, and country
  boundary GeoJSON sources.
- Weather/environment: Open-Meteo, NOAA Weather, NOAA icons, Sunrise-Sunset,
  and 7Timer.
- Earth/nature: USGS earthquakes, Encyclopedia of Life, iNaturalist, GBIF, and
  OBIS.
- Space/data: ISS position services, The Space Devs launch data, NASA EONET,
  NASA NEO/APOD, and JPL Small-Body Database.

## Flexible browser workflow

1. Search the smallest relevant category above with the available browser
   capability (for example `agent-browser` or the in-app browser skill).
2. Inspect the actual item page, download affordance, dimensions/duration, and
   item-level license. Do not infer rights from a search thumbnail.
3. Prefer an official direct download. If the site blocks automation, leave it
   as a candidate or download manually; do not work around the block.
4. Put the bytes through Narova's shared lifecycle:

   ```bash
   narova assets download "DIRECT_URL" --output assets/example.ext \
     --origin stock --provider "provider-id" --item-id "item-id" \
     --source-page "ITEM_PAGE" --license "LICENSE" \
     --license-url "LICENSE_URL" --creator "CREATOR" \
     --attribution "ATTRIBUTION"
   ```

   For a file already downloaded by the browser or user, use `narova assets
   import` with the same rights fields.
5. Run `narova assets verify` and review generated credits before building.

A browser smoke test passes only after all five stages succeed. A homepage open,
search-results page, or metadata-only response is discovery evidence, not a
verified acquisition.

If rights are unclear, omit license claims and keep the record unknown. Unknown
does not mean unusable; it means a human/agent must finish the rights review.
