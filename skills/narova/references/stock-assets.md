# Stock Assets for Narova

How to source every asset a narova project needs. Remote availability changes;
never treat an old HTTP check as proof that a provider works today. Prefer the
built-in adapters below because they exercise the current API and normalize its
result. The longer source catalogue remains a discovery reference and may need
a browser or a fresh endpoint check.

Sources are organized by category so an agent can jump straight to what it needs
for the current scene.

## Table of contents

1. [Acquisition priority](#acquisition-priority)
2. [Essential catalogue adapters](#essential-catalogue-adapters)
3. [Photos & images](#photos--images)
4. [Video clips](#video-clips)
5. [Music & background beds](#music--background-beds)
6. [Sound effects](#sound-effects)
7. [Fonts](#fonts)
8. [Icons](#icons)
9. [Illustrations & vector art](#illustrations--vector-art)
10. [3D models, HDRIs, textures](#3d-models-hdris-textures)
11. [Museum, archive & cultural collections](#museum-archive--cultural-collections)
12. [Maps & geography](#maps--geography)
13. [Science, space & nature data](#science-space--nature-data)
14. [Scene-by-scene search terms](#scene-by-scene-search-terms)
15. [DO NOT USE](#do-not-use)
16. [Licensing manifest](#licensing-manifest)
17. [Where to put assets](#where-to-put-assets)
18. [Attribution rules](#attribution-rules)

---

## Acquisition priority

Follow this order so the highest-quality, most reliable sources are used first:

1. **NASA API** — galaxies, Earth, scientific visuals (review each item's rights)
2. **Wikimedia Commons API** — diagrams, artwork, encyclopedic imagery
3. **Unsplash / Pixabay (website)** — contemporary photography (agent-browser)
4. **Mixkit / Coverr** — cinematic video clips (CLI, no key)
5. **Museum APIs** (Smithsonian, The Met, Cleveland, Wellcome, ARTIC) — art, culture
6. **Mixkit Music / Pixabay Music / Incompetech** — background score
7. **Google Fonts** — typography

---

## Core catalogue adapters

Use adapters for provider API mechanics; use judgment for relevance, rights,
model/property releases, and sensitive contexts.

```bash
# List all deterministic adapters and optional credential readiness.
narova assets providers

# Search without downloading. Add --json when another program will select.
narova assets search "meditation gong" --provider wikimedia --kind audio --json
narova assets search "home" --provider iconify --kind image --json
narova assets search "wooden crate" --provider poly-haven --kind model --json

# Resolve the selected item again, download it atomically, and register it.
narova assets acquire "File:Meditation Gong.ogg" --provider wikimedia \
  --kind audio --output assets/gong.ogg
```

| Pack | Provider | Kinds | Credential |
|---|---|---|---|
| essential | `wikimedia` | image, video, audio | none |
| essential | `openverse` | image, audio | none |
| essential | `nasa` | image, video, audio | none |
| essential | `internet-archive` | video, audio | none |
| essential | `iconify` | 2D SVG icons | none |
| essential | `poly-haven` | 3D FBX models | none |
| core | `met` | image | none |
| core | `cleveland-museum` | image | none |
| core | `loc` | image | none |
| core | `pexels` | image, video | `PEXELS_API_KEY` |
| core | `pixabay` | image, video | `PIXABAY_API_KEY` |
| core | `freesound` | audio | `FREESOUND_API_KEY` |

The separate `narova-stock-extensions` skill contains no adapters or launcher.
It is an LLM-led catalogue of 101 loose sources for creative discovery with web
search, direct HTTP, or a browser. Those sources are not mechanically ready by
definition. Finish every selected loose item through `narova assets download`
or `narova assets import` so hashing, verification, provenance, and credits stay
in the core lifecycle.

Optional keys stay in environment variables and are never written to the
project lock. A missing key disables only that core provider. Wikimedia's
current Core API supplies file URLs but not reliable per-file license metadata,
so acquisitions stay `rights.status: "unknown"` until the item page has been
reviewed and the license is supplied explicitly:

```bash
narova assets import assets/gong.ogg --license CC0-1.0 \
  --license-url https://creativecommons.org/publicdomain/zero/1.0/ \
  --creator "Example creator" --attribution "Example creator / Wikimedia Commons"
```

`search` and `acquire` are intentionally separate: an author or agent must
select a suitable result. Builds never search or download anything. The skill
may still use a browser, web research, or a long-tail source below when that
produces a better creative choice. Finish that path with `assets download` or
`assets import` so it receives the same provenance and verification treatment.

Run live API and byte-download checks explicitly from the repository root:

```bash
npm run test:stock-live
# Runs every no-key adapter; key-backed providers run when configured.
```

These are intentionally outside the ordinary deterministic unit suite.

---

## Photos & images

### Pexels Photos (API key required)

```
curl -H "Authorization: YOUR_API_KEY" -s "https://api.pexels.com/v1/search?query=ocean&per_page=5&orientation=landscape&size=large"
```

- **API key required.** Register at pexels.com (free, email only) for 200 req/hr.
  Unauthenticated requests return 401 — there is no anonymous access tier.
  Use `--header` with the key; the `--header` shown above passes Authorization.
- Response sizes: `original` (full-res), `large2x` (2× DPR, good for 4K),
  `large` (~940px), `landscape` (16:9 crop), `portrait` (9:16 crop).
- `total_results` capped at 8000. Use `&page=N`.
- **Prefer no-key alternatives first:** Unsplash/Pixabay (website via agent-browser),
  Openverse (API, no key), Wikimedia Commons (API, no key).

### NASA Images

```
curl -s "https://images-api.nasa.gov/search?q=nebula&media_type=image"
```

- No key, no rate limit. 40,000+ results for common space terms.
- Full-res: replace `~thumb.jpg` / `~small.jpg` / `~medium.jpg` with `~orig.jpg`.
- All file variants: `https://images-api.nasa.gov/asset/{nasa_id}`
- **NASA APOD (demo key):** `https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY`

### NASA Earth Observatory, JPL, other feeds

```
# JPL Small-Body Database (asteroids, comets):
curl -s "https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=ceres"

# ISS real-time position:
curl -s "https://api.wheretheiss.at/v1/satellites/25544"

# EONET natural events:
curl -s "https://eonet.gsfc.nasa.gov/api/v3/events"

# NEO feed (demo key):
curl -s "https://api.nasa.gov/neo/rest/v1/feed?start_date=2026-07-28&end_date=2026-07-28&api_key=DEMO_KEY"
```

### Wikimedia Commons

Use the MediaWiki action API for full results with license metadata:

```
curl -s "https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=galaxy&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|extmetadata&format=json&origin=*"
```

- No key. Millions of openly licensed images, diagrams, videos.
- `pages[].imageinfo[].extmetadata` has: `LicenseShortName`, `LicenseUrl`,
  `Artist`, `Credit`, `Attribution`, `ImageDescription`, `UsageTerms`.
- Full-res alternative: strip `/thumb/` and `/<size>px-<filename>` from
  thumbnail URL to get the original file.
- Also: `api.wikimedia.org/core/v1/commons/search/page?q=galaxy&limit=5`

### Openverse

```
curl -s "https://api.openverse.org/v1/images/?q=nature&page_size=5"
```

- No key. Aggregates CC-licensed images from Flickr, Wikimedia, etc.
- Filter by license: `&license=cc0,pdm,by`
- Returns `results[].url` with direct image URLs.

### Flickr (public API)

```
curl -s "https://www.flickr.com/services/rest/?method=flickr.photos.search&text=galaxy&per_page=5&format=json&nojsoncallback=1"
```

- No key needed for basic search. Returns photo metadata; construct image URL:
  `https://live.staticflickr.com/{server}/{id}_{secret}_{size}.jpg`
- Sizes: `t` (100px), `s` (240px), `n` (320px), `m` (500px), `z` (640px),
  `c` (800px), `b` (1024px), `h` (1600px), `k` (2048px).
- Licenses vary — check the `license` field against Flickr's license IDs.

### Unsplash (website, no key)

```
agent-browser --session us open "https://unsplash.com/s/photos/ocean"
```

- Website works without login. API needs key.
- Unsplash License: free commercial use, no attribution required. Do not
  redistribute unmodified images as a competing library.

### Pixabay (website, no key)

```
agent-browser --session pb open "https://pixabay.com/images/search/nature/"
```

- Website works without login. API needs key.
- Content License: free use, adaptation allowed. Avoid standalone resale.

### NOAA Media

- NOAA-produced images/video generally not copyrighted.
- Check each item for third-party material markings.
- Best for: oceans, weather, Earth systems, clouds, storms.

---

## Video clips

### Pexels Videos (API key required)

```
curl -H "Authorization: YOUR_API_KEY" -s "https://api.pexels.com/v1/videos/search?query=ocean&per_page=5"
```

- **API key required** — same 200 req/hr as photos. Unauthenticated requests
  return 401.
- `videos[].video_files[]` — direct MP4 download links. HD (1920×1080 or
  1280×720, 30fps), SD (640×360, 960×540). 60fps often available.

### Pexels Videos (website, fallback)

```
agent-browser --session px open "https://www.pexels.com/search/videos/galaxy/"
```

- Website is a fallback path when API quota is exhausted (browser automation).

### Mixkit Videos (CLI, no browser)

```
# Search results page links:
curl -s "https://mixkit.co/free-stock-video/?q=domino" | grep -o 'href="/free-stock-video/[^"]*"' | head -10

# Extract direct MP4 from a video page:
curl -s "https://mixkit.co/free-stock-video/domino-effect-5246/" | grep -o 'https://assets\.mixkit\.co/videos/[0-9]*/[0-9]*-720\.mp4' | head -1
```

- 720p MP4. Also grep for `-360\.mp4` for smaller variants.
- Free License: no attribution, commercial OK. Check for Restricted License badge.

### Coverr (API)

```
curl -s "https://coverr.co/api/videos?format=json&limit=20"
```

- Unlisted but functional REST API. Returns CC0 videos with metadata.
- Each hit has `title`, `duration`, `poster`, `tags`, and `base_filename`.
- Direct download URL pattern: navigate to video page via agent-browser.
- Coverr explicitly says no sign-up, no attribution, commercial use OK.
- Best for: cinematic nature, people contemplating, clouds, oceans, slow motion.

### Pixabay Videos (website)

```
agent-browser --session pb open "https://pixabay.com/videos/search/galaxy/"
```

- Website works without login. API needs key.

### NASA Videos (CLI)

```
# Search:
curl -s "https://images-api.nasa.gov/search?q=earth&media_type=video"

# Download (~orig.mp4):
ENCODED=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$NASA_ID',safe=''))")
curl -s "https://images-assets.nasa.gov/video/$ENCODED/$ENCODED~orig.mp4" -o assets/earth.mp4
```

- No key, no rate limit. 1920×1080 typical. Trim with `clipStart`/`clipDuration`.
- Also: `~orig.jpg` (poster), `~orig.srt` (captions).

### Wikimedia Commons Video

- Search `gsrnamespace=6` via MediaWiki action API (same as images).
- Returns Ogg/Theora and WebM videos. Link in `imageinfo[].url`.

### Internet Archive

```
# Search:
curl -s "https://archive.org/advancedsearch.php?q=mediatype%3Amovies+AND+subject%3Aastronomy&fl[]=identifier,title,licenseurl&rows=50&page=1&output=json"

# Item metadata + file listing:
curl -s "https://archive.org/metadata/{identifier}"

# Stock footage collection:
curl -s "https://archive.org/advancedsearch.php?q=collection%3Astock_footage&output=json"
```

- No key. Massive public domain archive.
- Archive.org does **not** validate uploader rights. Accept only items with
  clear PD/CC statements.

---

## Music & background beds

### Mixkit Music

```
curl -s "https://mixkit.co/free-stock-music/" | grep -o 'href="/free-stock-music/[^"]*"' | head -10
```

- No sign-up, no attribution. Free License items: commercial use OK.
- Search via URL: `https://mixkit.co/free-stock-music/?q=cinematic`

### Pixabay Music

```
agent-browser --session pb open "https://pixabay.com/music/search/cinematic/"
```

- Website works without login. API needs key.
- Content License: free use, generally no attribution.

### Incompetech (`incompetech.com`)

- Kevin MacLeod's library. Search by genre/mood on the website.
- CC BY: requires attribution. Royalty-free with credit.
- Direct MP3 downloads available from track pages (scrapeable).

### Free Music Archive (`freemusicarchive.org`)

- No account needed. Track licenses vary.
- Filter out NC (noncommercial) and ND (no derivatives) for monetized projects.
- Direct MP3 downloads from track pages.

### ccMixter (API)

```
curl -s "https://ccmixter.org/api/query?limit=10&f=json"
```

- No key. CC-licensed music with JSON API.
- Usually requires credit. Filter by license in query params.

### FreePD (`freepd.com`)

- Public domain music. No attribution. Direct MP3 downloads.
- Categories: cinematic, epic, classical, ambient, electronic.

### Purple Planet (`purple-planet.com`)

- Royalty-free music. Free for web/social media with credit.
- Direct MP3 downloads from category pages.

### TeknoAXE (`teknoaxe.com`)

- Royalty-free music. CC BY: requires attribution.
- Direct MP3 downloads. Genres: ambient, cinematic, electronic.

### Jamendo

```
curl -s "https://api.jamendo.com/v3.0/tracks/?client_id=YOUR_FREE_KEY&format=json&limit=5&tags=ambient"
```

- Free `client_id` via registration. CC-licensed music streaming API.
- Returns track URLs, artist info, license data.

### Liborio Conti (`no-copyright-music.com`)

- Free commercial use, no attribution. Save a copy of the stated license.
- Direct MP3 downloads.

### Recommended music parameters

```
Length: match video + 10s buffer
Instrumental only, no vocals
Slow or medium tempo, low percussion density
Mood: contemplative, cinematic, ambient, philosophical
Avoid: horror, triumphal religious music, aggressive trailer drums
```

Narova config:
```js
bed: { file: "assets/ambient-bed.mp3", volume: 0.14, fadeIn: 0.5, fadeOut: 1.5 }
```

---

## Sound effects

### Mixkit SFX

```
curl -s "https://mixkit.co/free-sound-effects/" | grep -o 'href="/free-sound-effects/[^"]*"' | head -10
```

- Whooshes, impacts, water, wind, clocks, transition risers.
- Free License. Same HTML-parse approach as Mixkit videos.

### Pixabay SFX

```
agent-browser --session pb open "https://pixabay.com/sound-effects/search/whoosh/"
```

- Water drops, impacts, space ambience, wind, chain sounds.

### Kenney Audio (`kenney.nl/assets`)

- Direct download, no account. All CC0.
- Clean UI sounds, impacts, transitions, simple effects.

### Freesound API

```
curl -H "Authorization: Token YOUR_FREE_TOKEN" -s \
  "https://freesound.org/apiv2/search/?query=nature&fields=id,name,url,username,license,previews,duration"
```

- Free token via registration. Massive CC-licensed sound library.
- Returns preview and download URLs.

### BBC Sound Effects (`sound-effects.bbcrewind.co.uk`)

- 16,000+ sounds. Personal/educational use only — **not for commercial video**.

### OpenGameArt (`opengameart.org`)

- Atmospheres, loops, particles, impacts. Filter to CC0 or CC BY.

### Internet Archive Audio

```
curl -s "https://archive.org/advancedsearch.php?q=mediatype%3Aaudio+AND+subject%3Anature&output=json"
```

- Historic recordings, mechanical sounds. Rights vary per item.

### NASA Audio

- Spacecraft sounds, mission comms, atmospheric texture.
- Public domain. Use sparingly as texture beneath narration.

Narova config:
```js
sfx: [{ file: "assets/whoosh.wav", scene: "hook", at: 0.15, volume: 0.65 }]
```

---

## Fonts

### Google Fonts

```
# API: list all fonts with download URLs
curl -s "https://fonts.google.com/download/list?family=Inter" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read()[5:])  # strip )]}' prefix
[print(f['url']) for f in d['manifest']['fileRefs']]
"

# Direct download (fonts.gstatic.com CDN):
curl -s "https://fonts.gstatic.com/s/inter/v18/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2" -o assets/fonts/inter.woff2

# CSS import for theme.css:
# @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
```

- All fonts OFL licensed. No key, no attribution.
- **Bunny Fonts** (GDPR-compliant CDN): `https://fonts.bunny.net/css?family=Inter`

### Fontsource (API + CDN)

```
# API: list all available fonts
curl -s "https://api.fontsource.org/v1/fonts"

# Single font metadata:
curl -s "https://api.fontsource.org/v1/fonts/inter"

# CDN CSS import (jsDelivr):
curl -s "https://cdn.jsdelivr.net/npm/@fontsource/inter/index.css"
```

- OFL licensed. No key.

### Font Squirrel (`fontsquirrel.com`)

- Curated free fonts. Each font page has a "Download" button (agent-browser).

### DaFont (`dafont.com`)

- Free fonts directory. Licenses vary per font — check each item.
- Direct download from font pages.

### Icon fonts (self-hosted)

```
# Bootstrap Icons:
curl -s "https://cdn.jsdelivr.net/npm/bootstrap-icons@1/font/bootstrap-icons.css"

# Remix Icon:
curl -s "https://cdn.jsdelivr.net/npm/remixicon@3/fonts/remixicon.css"

# Tabler Icons webfont:
curl -s "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2/tabler-icons.min.css"
```

### Recommended pairings

```
Philosophical / elegant:  Cormorant Garamond Semibold (headings) + Inter Regular (body)
Modern / tech:            Inter Medium (headings) + Inter Regular (body)
Classic / editorial:      Libre Baskerville (headings) + Source Sans 3 (body)
Cinematic:                Cinzel (display) + Cormorant Garamond (captions)
```

Maximum two font families per project.

---

## Icons

### Iconify API

```
curl -s "https://api.iconify.design/collection?prefix=mdi"
```

- No key. Returns icon metadata for 150,000+ icons across 100+ icon sets.
- Fetch individual icon SVG: `https://api.iconify.design/{prefix}/{icon}.svg`

### Simple Icons CDN

```
# Brand icon as SVG (no key):
curl -s "https://cdn.simpleicons.org/github" -o github.svg
# With color and size:
curl -s "https://cdn.simpleicons.org/github/00ff00" -o github.svg
```

- CC0. 3000+ brand icons. Use `?dark` for dark-mode variants.

### Individual icon sets (raw GitHub)

```
# Lucide (ISC):
curl -s "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/arrow-right.svg"

# Tabler (MIT):
curl -s "https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/world.svg"

# Ionicons (MIT):
curl -s "https://raw.githubusercontent.com/ionic-team/ionicons/main/src/svg/globe.svg"

# Boxicons (MIT):
curl -s "https://raw.githubusercontent.com/atisawd/boxicons/master/svg/regular/bx-world.svg"

# Octicons / GitHub (MIT):
curl -s "https://raw.githubusercontent.com/primer/octicons/main/icons/globe-16.svg"

# Feather Icons (MIT):
curl -s "https://raw.githubusercontent.com/feathericons/feather/main/icons/globe.svg"

# Phosphor Icons (MIT):
curl -s "https://raw.githubusercontent.com/phosphor-icons/core/main/assets/regular/globe.svg"
```

### Country flags

```
# FlagCDN (high-res PNG):
curl -s "https://flagcdn.com/w320/us.png"

# Country Flag Icons (SVG CDN):
curl -s "https://cdn.jsdelivr.net/npm/country-flag-icons/3x2/US.svg"

# Mapsicon (country silhouette PNG):
curl -s "https://raw.githubusercontent.com/djaiss/mapsicon/master/all/us/1024.png"
```

---

## Illustrations & vector art

### unDraw (`undraw.co`)

- Open-source SVG illustrations. MIT licensed.
- Browse category pages; SVG files have direct download URLs.
- Best for: tech concepts, teamwork, abstract ideas, onboarding.

### DrawKit (`drawkit.com`)

- Free illustrations. Some are free, some paid. Download links on category pages.

### Open Doodles (`opendoodles.com`)

- Free sketch-style people illustrations. CC0. Direct SVG downloads.
- Best for: casual, human-centric scenes.

### ManyPixels Gallery (`manypixels.co/gallery`)

- Free illustration gallery. Download individual SVGs from gallery pages.

### Lukasz Adam Illustrations (`lukaszadam.com/illustrations`)

- Free SVG illustrations. CC0. Direct download from the page.

### Bioicons (`bioicons.com`)

- Science/lab SVG illustrations. CC BY-SA.
- Best for: scientific explainers, biology/chemistry content.

### Isoflat (`isoflat.com`)

- Free isometric illustrations. Download from page.

---

## 3D models, HDRIs, textures

### Poly Haven (`polyhaven.com`)

- Everything CC0. Models, HDRIs, textures.
- Browse and download from item pages (agent-browser).

### ambientCG (API)

```
# PBR materials with direct download URLs:
curl -s "https://ambientcg.com/api/v2/full_json?type=Material&limit=10&offset=0"

# HDRIs:
curl -s "https://ambientcg.com/api/v2/full_json?type=HDRI&limit=10&offset=0"
```

- All CC0. REST API returns JSON with `downloadFolders` containing ZIP URLs.
- No key needed. Each item has: name, tags, dimensions, download URLs.

### Kenney 3D (`kenney.nl/assets`)

- Free game assets including 3D models. Asset-page downloads are CC0.

### Quaternius (`quaternius.com`)

- Free low-poly 3D models. CC0. Direct downloads from asset pages.

### OpenGameArt (`opengameart.org`)

- 3D models, textures, sounds. Mixed CC licenses. Filter to CC0.

### Sketchfab (CC0 subset)

- Filter Sketchfab search to "Downloadable" + "CC0" for free models.
- Requires agent-browser or manual download.

### NASA 3D Resources

- Public domain 3D models of spacecraft, asteroids, planets.
- Search: `nasa3d.arc.nasa.gov`

### Smithsonian Open Access 3D

- CC0 3D models of artifacts, scientific instruments.
- API: `https://api.si.edu/openaccess/api/v1.0/search?q=3d&rows=10`

---

## Museum, archive & cultural collections

### Smithsonian Open Access

```
curl -s "https://api.si.edu/openaccess/api/v1.0/search?q=astronomy&rows=5"
```

- 2.8M+ CC0 images and 3D models. No permission needed, commercial OK.

### The Met Open Access

```
# Search:
curl -s "https://collectionapi.metmuseum.org/public/collection/v1/search?q=creation&hasImages=true"

# Object details + primaryImage:
curl -s "https://collectionapi.metmuseum.org/public/collection/v1/objects/{id}"
```

- CC0 for Open Access works. Two-step: search → object detail.

### ARTIC (Art Institute of Chicago)

```
curl -s "https://api.artic.edu/api/v1/artworks/search?q=landscape&limit=5&fields=id,title,image_id,artist_title"
```

- Public API, no key. CC0. IIIF image URLs:
  `https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg`

### Cleveland Museum of Art

```
curl -s "https://openaccess-api.clevelandart.org/api/artworks/?q=landscape&limit=5"
```

- 30,000+ CC0 art images. REST API, no key. Returns image URLs directly.

### Wellcome Collection

```
curl -s "https://api.wellcomecollection.org/catalogue/v2/works?query=anatomy&pageSize=5"
```

- Medical and science history images. CC BY.
- IIIF images: `https://iiif.wellcomecollection.org/image/{id}.jpg/full/400,/0/default.jpg`

### Rijksmuseum

```
curl -s "https://www.rijksmuseum.nl/api/en/collection?key=YOUR_FREE_KEY&q=Rembrandt&ps=5"
```

- Free API key via registration. High-res Dutch Golden Age art.
- Returns `webImage.url` for direct download.

### National Gallery of Art (NGA)

- Open-access images at `nga.gov/artworks/free-images-and-open-access`.
- CC0. Agent-browser to download from open-access collection pages.

### SMK (National Gallery of Denmark)

```
curl -s "https://api.smk.dk/api/v1/art/search/?keys=*&offset=0&rows=5"
```

- Danish national art collection. CC0. REST API, no key.

### Europeana

```
curl -s "https://www.europeana.eu/api/v2/search.json?wskey=demo&query=landscape&rows=5"
```

- European cultural heritage aggregator. `wskey=demo` works without registration.
- Various licenses per item.

### Library of Congress

```
# Photos:
curl -s "https://www.loc.gov/photos/?q=stars&fo=json"

# General search:
curl -s "https://www.loc.gov/search/?q=astronomy&fo=json"

# Free to Use sets:
curl -s "https://www.loc.gov/free-to-use/?fo=json"
```

- Explicitly no API key. Public domain US historical material.
- High-res JPEG: `tile.loc.gov/storage-services/service/<path>/<id>v.jpg`
- Archival TIFF: same path with `u.tif` suffix.

### NYPL Digital Collections

- Massive digital collection. Many items public domain.
- API: `https://digitalcollections.nypl.org/items/{uuid}`

### Biodiversity Heritage Library

```
curl -s "https://www.biodiversitylibrary.org/api3.aspx?op=TitleSearch&title=botany&format=json"
```

- Historic natural history illustrations. Public domain / CC.
- Returns thumbnail and page URLs.

### V&A Museum (`collections.vam.ac.uk`)

- Victoria & Albert Museum collection. Many CC0 images.
- Search and browse via agent-browser.

### Te Papa Museum (New Zealand)

```
curl -s "https://collections.tepapa.govt.nz/API/v1/search?q=nature"
```

- Museum of New Zealand API. Various CC licenses.

### Science Museum Group (UK)

```
curl -s "https://collection.sciencemuseumgroup.org.uk/search/objects?q=astronomy"
```

- UK Science Museum collection. CC BY-NC-SA.

### Natural History Museum (London)

```
curl -s "https://data.nhm.ac.uk/api/3/action/package_search?q=dinosaurs"
```

- Natural history data portal. Various CC licenses.

---

## Maps & geography

### OpenStreetMap tiles

```
# Standard tiles:
curl -s "https://tile.openstreetmap.org/{z}/{x}/{y}.png" -o tile.png

# German OSM server:
curl -s "https://c.tile.openstreetmap.de/{z}/{x}/{y}.png"

# Wikimedia OSM tiles:
curl -s "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png"
```

- ODbL licensed. No key. Use for map backgrounds in explainers.

### Styled basemap tiles

```
# CartoDB light (CC BY):
curl -s "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"

# OpenTopoMap (CC BY-SA):
curl -s "https://a.tile.opentopomap.org/{z}/{x}/{y}.png"

# Thunderforest Landscape (CC BY-SA, free tier):
curl -s "https://tile.thunderforest.com/landscape/{z}/{x}/{y}.png"
```

### Satellite imagery

```
# ArcGIS/ESRI World Imagery (free tier):
curl -s "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
```

### Geocoding & geography data

```
# Nominatim (geocoding):
curl -s "https://nominatim.openstreetmap.org/search?q=Paris&format=json&limit=1"

# Country boundary GeoJSON:
curl -s "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"

# Natural Earth (public domain map data):
curl -s "https://naciscdn.org/naturalearth/110m/cultural/ne_110m_admin_0_countries.zip"

# GADM administrative boundaries:
curl -s "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_USA_0.json"
```

---

## Science, space & nature data

### Weather & environment

```
# Open-Meteo (no key, CC BY):
curl -s "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current_weather=true"

# NOAA Weather (US, public domain):
curl -s "https://api.weather.gov/points/38.9,-77.0"

# NOAA weather icons:
curl -s "https://api.weather.gov/icons/land/day/snow" -o weather.svg

# Sunrise/sunset:
curl -s "https://api.sunrise-sunset.org/json?lat=38.9&lng=-77.0"

# 7Timer astronomical forecast:
curl -s "https://www.7timer.info/bin/astro.php?lon=-77.0&lat=38.9&ac=0&unit=metric&output=json"
```

### Earthquakes & natural events

```
# USGS earthquakes (public domain):
curl -s "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson"
```

### Biodiversity & species

```
# Encyclopedia of Life (CC):
curl -s "https://eol.org/api/search/1.0.json?q=Panthera+leo"

# iNaturalist (CC BY-NC):
curl -s "https://api.inaturalist.org/v1/observations?per_page=5&photos=true&taxon_name=bear"

# GBIF species data (CC):
curl -s "https://api.gbif.org/v1/species/search?q=Panthera+leo"

# OBIS marine species (CC BY):
curl -s "https://api.obis.org/v3/occurrence/grid/3?size=5"
```

### Space, launches & astronomy

```
# ISS position:
curl -s "https://api.wheretheiss.at/v1/satellites/25544"

# Upcoming launches (The Space Devs):
curl -s "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=3"

# NASA EONET natural events:
curl -s "https://eonet.gsfc.nasa.gov/api/v3/events"

# JPL Small-Body DB (asteroids):
curl -s "https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=ceres"
```

---

## Placeholder / development images

For prototyping before real assets are sourced:

| Service | URL Pattern | License |
|---------|-------------|---------|
| Picsum Photos | `https://picsum.photos/{w}/{h}` | CC0 |
| LoremFlickr | `https://loremflickr.com/{w}/{h}/{keyword}` | CC |
| Placehold.co | `https://placehold.co/{w}x{h}/{bg}/{fg}?text=hello` | Free |
| DummyImage | `https://dummyimage.com/{w}x{h}/{bg}/{fg}` | Free |
| PlaceBear | `https://placebear.com/{w}/{h}` | Free |
| JSONPlaceholder | `https://jsonplaceholder.typicode.com/photos/{id}` | Free |

---

## DO NOT USE

- **Videezy** (`videezy.com`) — terms expressly prohibit automated or nonhuman
  access, even though it offers free assets. Do not scrape, curl, or
  browser-automate.
- **Any source that returns 403 or Cloudflare challenge from curl** — check
  with `curl -sI` first. If blocked, use agent-browser or skip.

---

## API key tier (optional registration)

These require free registration (email only, no payment). Pexels requires one for
all requests; the others have generous anonymous limits but authenticated tiers
have higher quotas:

| Service | Key needed | Rate limit | Best for |
|---------|------------|------------|----------|
| Pexels API | Yes | 200/hr | Photos + videos, multi-word queries |
| Unsplash API | Yes | 50/hr | Highest quality photography |
| Pixabay API | Yes | 100/min | Highest rate limit, photos + videos + music |
| Jamendo API | Yes | Free tier | CC-licensed music |
| Freesound API | Yes | Free tier | Sound effects library |
| Rijksmuseum API | Yes | Free tier | Dutch Golden Age art |

---

## Scene-by-scene search terms

### Space / cosmos / creation
```
nasa: galaxy, deep field, nebula, earth horizon, star field, supernova
pexels: galaxy, stars, space, night, universe, sky, light, abstract
pixabay: space loop, galaxy animation, nebula, particles, light
wikimedia: galaxy, nebula, hubble, james webb, cosmos
```

### Nature / Earth / life
```
pexels: ocean, forest, sunrise, mountain, river, beach, desert, waterfall
nasa: earth from space, ISS, blue marble, clouds
mixkit: nature, aerial, forest, ocean, waves, sky
coverr: nature, clouds, ocean, forest, sunrise
pixabay: nature aerial, forest river, mountain sunrise
```

### Human / contemplation / silhouette
```
pexels: silhouette, person, people, looking, contemplation
pixabay: human silhouette, person stars, contemplation
coverr: people contemplating, looking at stars
unsplash: silhouette, contemplation, looking up
```

### Causality / chains / dominoes
```
mixkit: domino, chain, gear, clock, mechanism, construction
pixabay: domino effect, chain reaction, gears, clock mechanism
  coverr: domino, chain, mechanism
  pexels: domino
```

### Light / abstract / transcendence
```
pexels: light, abstract, particles, glow, radiant, sun
pixabay: light particles, abstract light, glowing dust, energy
nasa: sun, solar flare, corona, light
coverr: abstract, light, particles, glow
```

### Historical / philosophical
```
wikimedia: aristotle, aquinas, creation, cosmology, philosophy
loc: astronomy, philosophy, creation, manuscript, cosmology
met: creation, genesis, divine light, cosmos
artic: creation, light, genesis, philosophy
cleveland: creation, philosophy, light
wellcome: philosophy, anatomy, creation
```

---

## Licensing manifest

Use Narova's asset commands for the mechanical download and provenance record:

```bash
narova assets download "https://cdn.example/earth.jpg" \
  --output assets/earth.jpg \
  --origin stock \
  --provider nasa \
  --item-id PIA00342 \
  --source-page "https://images.nasa.gov/details/PIA00342"
```

When a browser or provider-specific tool already downloaded the file, register
it afterward with the same metadata flags:

```bash
narova assets import assets/earth.jpg --origin stock --provider nasa \
  --item-id PIA00342
```

Both commands update the project-root `assets.lock.json`. `narova ingest`,
`narova generate`, and `narova walkthrough capture` register their own outputs
automatically. `narova assets verify` detects missing or modified bytes, and
`narova assets credits` prints deduplicated attribution lines. Release checks
verify tracked bytes. If an asset leaves the project intentionally, use
`narova assets untrack <file>`; it removes only the record, never the file.

The record shape is intentionally provider-neutral:

```json
{
  "file": "assets/earth.jpg",
  "kind": "image",
  "sha256": "...",
  "bytes": 1234567,
  "origin": {
    "mode": "stock",
    "provider": "nasa",
    "itemId": "PIA00342",
    "sourcePage": "https://images.nasa.gov/details/PIA00342"
  },
  "rights": {
    "status": "unknown"
  },
  "acquiredAt": "2026-08-10T00:00:00Z"
}
```

Keep `claims.md` exclusively for factual assertions in the narration. Asset
rights and attribution belong in `assets.lock.json`; content-source bibliography
belongs in `sources.md`.

### Import metadata flags and license vocabulary

The full set of metadata flags accepted by `assets import` and
`assets download`:

```bash
--origin <mode> --provider <name> --item-id <id> --source-page <url>
--license <id> --license-url <url> --creator <name> --attribution <text>
```

`--license` is free text — any nonempty value is stored exactly as supplied —
but the command prints an advisory warning when the value is not a recognized
form. Recognized forms:

- `public domain` spellings, e.g. `Public Domain (NASA)`
- `cc0`, e.g. `CC0-1.0`
- Familiar Creative Commons identifiers: `CC-BY`, `CC-BY-SA`, `CC-BY-NC`,
  `CC-BY-ND` (and combinations such as `CC-BY-NC-SA`), with an optional
  version suffix (`CC-BY-SA-4.0`) or `creativecommons.org` URL form

An unrecognized value such as `NASA-PD` is still stored verbatim; it simply
reports under the `unknown` rights bucket until restated in a recognized form.

### Re-importing a modified file

Re-importing a modified file at the same project-relative path retains the
prior structured `origin` and `rights` records and the original acquisition
time when no explicit origin/rights flags are supplied. Grading or otherwise
transforming an acquired file and re-importing it therefore keeps the
provider, item ID, source page, and license, and the refreshed bytes pass
`narova assets verify` — no hand-typed restatement is needed:

```bash
# Grade assets/glacier.jpg in place, then re-register the new bytes:
narova assets import assets/glacier.jpg
```

Supplying a flag replaces only that field. Note that an explicit
transform-of-record (`derivedFrom`) concept is not part of the current
ledger — the retained origin record continues to describe the source the
file was acquired from.

### Auto-reject when

- Rights field is missing or ambiguous
- Marked "editorial use only"
- CC BY-NC and the video may be monetized
- CC BY-ND and the agent will crop, animate, recolor, or edit it
- Contains an identifiable logo or trademark used suggestively
- Contains a recognizable person in a sensitive or misleading context
- The license cannot be attached to the final asset record
- Source is Videezy (automated access prohibited by terms)

---

## Where to put assets

Narova copies `assets/` into `out/hf/assets/` during compose:

```
project/
├── reel.config.mjs
├── assets/
│   ├── galaxy.mp4        ← video clip
│   ├── sunrise.jpg       ← photo
│   ├── ambient-bed.mp3   ← music
│   ├── whoosh.wav        ← SFX
│   └── fonts/            ← self-hosted fonts (optional)
└── out/
```

Reference in scene HTML: `src="assets/galaxy.mp4"`, `url("assets/fonts/brand.woff2")`.

---

## Attribution rules by source

- **Pexels / Mixkit / Coverr / Pixabay:** No attribution required (check item
  license for exceptions).
- **NASA:** Most content public domain. Credit "NASA" or specific mission.
- **Wikimedia Commons:** Check `LicenseShortName`. CC BY-SA requires attribution.
- **Smithsonian / The Met / NGA / ARTIC / Cleveland / SMK:** Open Access items
  are CC0; no attribution required.
- **Wellcome Collection:** CC BY; attribution required.
- **Internet Archive / LOC:** Varies by item. Many are public domain.
- **Europeana:** Varies per item and contributing institution.
- **Poly Haven / ambientCG / Kenney:** All CC0; no attribution.
- **Google Fonts / Fontsource:** OFL; no attribution.
- **Flickr:** License varies — check `license` field.
- **OpenStreetMap:** ODbL; attribution "© OpenStreetMap contributors".
- **CartoDB:** CC BY; attribution "© CARTO".
- **Incompetech / ccMixter:** Attribution required (CC BY).
- **BBC Sound Effects:** Personal/educational only — **not** for commercial video.

For narova projects, add required attribution text to the end card or scene
body. Keep source URLs and license records in `assets.lock.json`; use
`narova assets credits` to produce the deduplicated text.
