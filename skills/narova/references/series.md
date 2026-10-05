# Shared series authoring

A series shares selected defaults, resources and authored context across
independent projects. Courses can share a teacher and terminology; vlogs can
share a host, visual package and music; drama can share cast references and
explicit story state. Each episode owns its script, scenes, timing and evidence.

## Build one episode

Create the episode project and its catalog entry, then prepare and build it in
one command:

```sh
narova series build course --episode orbits \
  --resources orbit_diagram,brand_style --context audience,vocabulary \
  --incoming after_intro --reuse
```

The first call copies and verifies the chosen shared files into the episode's
binding, then runs its ordinary build. Later calls keep that saved shared
revision. Repeating the same selectors is accepted, including a different list
order; changing selectors requires `--update-shared`.

```sh
# Refresh only this episode, keeping its current named selections.
narova series build course --episode orbits --update-shared --reuse
```

Omitted update selectors retain existing choices; `--resources=`, `--context=`
and `--incoming=` explicitly clear them. Updating an unbound episode performs
its initial binding. Local scripts/assets/overrides remain authored by that
episode; sibling projects are never evaluated or built. Ordinary build options
such as renderer, fps, quality, variants, release and reuse work here; `--config`
is rejected because this operation uses the selected episode's root config.
Use `--project <directory>` to explicitly choose its target instead of the
catalog locator. The live data-only catalog identifies the series and episode;
a frozen episode without that source can still use `narova build --project ...`.

Preparation and rendering have separate commit points. Invalid selections,
identity mismatches and corrupt retained files fail before production. Once a
new binding has been published, a later config/render/release failure leaves it
saved for retry. It does not roll back the entire build. `--json` reports the
preparation action/revision and any committed binding even when rendering fails.

## When files are copied

| Operation | Shared inputs and copying |
|---|---|
| First `series build` | Retain selected files in the episode, then build it. |
| Repeated `series build` | Verify and use the retained selection; no refresh from live shared files. |
| `series build --update-shared` | Adopt selected current inputs, retain previous revision history, then build one episode. |
| `series bind` / `series adopt` | Prepare or update an episode separately, without building. |
| Ordinary `build` | Consume the existing binding; never infer membership or adopt the live series. |
| `series restore` | Restore exact verified retained history, without building. |

There are two copying boundaries. Initial binding or adoption copies selected
shared source bytes into `.narova-series/current/files/`. Composition then stages
those retained files into the generated renderer project alongside local assets;
verified build reuse may skip this staging. Editing shared originals alone does
not change a bound episode. Selected fonts/CSS keep their declared dependency
closure and source-relative meaning.

An episode owns its script, scenes, timing, local assets, creative brief and
proofs. It can use a few shared resources and a few of its own, override selected
shared defaults, or leave a resource unused. Selecting a resource retains it;
ordinary scene/font/theme/music references determine how it is applied.

Separate bind/adopt remains useful for inspecting a selection before rendering
or deliberately preserving an older shared version. A CI job that prepares and
builds together can use the combined command directly. Git already preserves
source versions; retained episode versions let episodes use different shared
revisions within the same checkout.

## CI builds and Git tracking

CI chooses which episodes to produce; Narova does not schedule changed episodes
or require a whole-series rebuild. Keep each episode's selection recipe in a
tracked script. After checkout and ordinary runtime/provider/model setup, run
one command for each selected episode:

```sh
narova series build course --episode orbits \
  --resources orbit_diagram,brand_style --context audience,vocabulary \
  --incoming after_intro --reuse
```

| Policy | Commit to Git | Build the selected episode |
|---|---|---|
| Use shared sources from the checked-out commit | Catalog/shared originals, episode sources/assets/evidence and per-episode selection recipe. | In a fresh checkout, `series build` prepares and builds in one call. |
| Preserve an episode's chosen shared revision | Episode sources, `series-membership.json`, current `binding.json` and all selected `current/files/` bytes. | `series build` keeps those inputs; ordinary `build` also works without the live series source. |

For checkout-derived selections, copies need not be committed. Ignore membership
and binding together, plus ordinary generated outputs:

```gitignore
**/.narova-series/
**/series-membership.json
**/out/
```

Do not commit membership alone: incomplete bindings fail rather than being
silently reconstructed. A reused CI workspace retains its earlier binding;
use `--update-shared` when that job deliberately wants current shared sources.
`--reuse` controls verified audiovisual reuse and never refreshes shared inputs.
A fresh checkout without a cache builds normally. Pin the intended CLI/runtime
versions and keep ordinary execution prerequisites ready.

For frozen episodes, commit the complete membership/current-binding/files pair
and omit those two ignore patterns. History is optional unless you want local
`series restore`. Refresh one episode with `series build --update-shared`, inspect
and commit its new binding/files. Advanced `series compare` and `series adopt`
remain available for separate review before rendering; `series bind` rejects an
already bound project.

## Create a series and build an episode

Create the source, then edit its data-only catalog and shared material:

```sh
narova series init course --id astronomy --title "Astronomy course"
narova init course/episodes/orbits
```

`course/series.config.json`:

```json
{
  "format": "narova.series/1",
  "id": "astronomy",
  "title": "Astronomy course",
  "defaults": {
    "voices": { "teacher": { "backend": "piper", "speaker": "en_US-amy-medium" } },
    "theme": { "accent": "#2ee6d6" },
    "captions": { "maxWords": 6 }
  },
  "resources": {
    "orbit_diagram": { "file": "media/orbit.svg" },
    "opening": { "file": "media/opening.mp4" },
    "brand_style": {
      "file": "styles/brand.css",
      "dependencies": ["fonts/BrandDisplay.ttf"]
    },
    "brand_font": { "file": "fonts/BrandDisplay.ttf" }
  },
  "context": {
    "audience": { "text": "Beginners; define each new term." },
    "vocabulary": { "file": "notes/vocabulary.md", "source": "course author" }
  },
  "states": {
    "after_intro": { "facts": { "introduced": ["planet", "star"] } }
  },
  "episodes": [
    { "id": "intro", "title": "Introduction" },
    {
      "id": "orbits",
      "title": "Orbits",
      "project": "episodes/orbits",
      "group": "Module 1",
      "relationships": [{ "type": "prerequisite", "episode": "intro" }]
    }
  ]
}
```

Use an installed voice/backend appropriate to the workspace. Membership neither
installs providers nor creates creative approval. Edit the episode's ordinary
config to declare its own scenes and voice IDs. A copied starter's existing
voice records override shared records with the same ID; remove unwanted starter
voices when adopting the shared cast.

```sh
narova series inspect course --json
narova series build course --episode orbits \
  --context audience,vocabulary --resources orbit_diagram --incoming after_intro --reuse
narova series inspect --project course/episodes/orbits --json
```

Optional selections are explicit. Bind defaults to no optional resources,
context or incoming state. Files required by shared voices/characters select
their matching resource declarations automatically. Shared default references
resolve relative to the series source; local episode references remain local.
Resources accept `dependencies: ["path", ...]` listing their complete transitive
local closure. Selected files must be contained regular files with portable
paths; symlinks, remote dependencies and incomplete supported closures fail.
Unselected files need not be available. Runtime files and their declared closure
materialize as ordinary `localResources` and `localResourceDependencies`; the
latter maps a listed primary path to its listed transitive dependency paths.
Those declarations remain in a detached project so consumed dependency edits
still invalidate the right consumers. Ordinary resource mounts use subdirectories
outside renderer-owned `assets/`, `audio/` and `spans/` mounts. Selected markup
with inline executable scripts has unavailable portable closure and is rejected;
keep that active code in ordinary episode-owned authoring sources.

Inspection reports each resource's `retainedFile`, such as
`.narova-series/current/files/media/orbit.svg`. Use that path explicitly through
ordinary `visual.src`, `bodyFile`, `clip`, music, providerFiles or import fields.
No intro, outro, music or scene is inserted automatically. Inlined selected
HTML/CSS and declarative visual documents preserve source-relative references.

## Mix shared and episode-owned material

One possible layout after binding (folder names outside managed binding paths
are author choices; membership comes from the catalog and command):

```text
course/
├── series.config.json
├── media/orbit.svg                  # shared source
├── styles/brand.css                 # shared stylesheet source
├── fonts/BrandDisplay.ttf           # shared font source
└── episodes/orbits/
    ├── reel.config.json             # episode script and explicit overrides
    ├── creative-brief.md            # this episode's evidence/approval
    ├── assets/orbit.svg             # this episode's own image
    ├── series-membership.json       # managed explicit association
    └── .narova-series/
        └── current/
            ├── binding.json        # frozen defaults, selection and identities
            └── files/              # actual copied selected bytes
                ├── media/orbit.svg
                ├── styles/brand.css
                └── fonts/BrandDisplay.ttf
```

The shared and local `orbit.svg` files do not overwrite each other. Use
`.narova-series/current/files/media/orbit.svg` for the retained shared image and
`assets/orbit.svg` for the episode-owned image. Matching filenames do not imply
replacement. Another episode keeps its own selection and overrides.

### Shared fonts and custom CSS

Shared `defaults.theme` supports mode and tokens, including font-family tokens
such as `sans`/`mono`; it does **not** accept `css`. A family name does not carry
font bytes. Declare local font files and custom stylesheets as resources, select
them, and apply their retained paths through ordinary episode authoring.
Custom CSS uses the HyperFrames renderer; portable visual-tree text uses the
explicit `style.fontFile`/`style.fontFamily` settings described below.

Create the shared `fonts/BrandDisplay.ttf` file and `styles/brand.css` from the
catalog above. The stylesheet references its own source-relative font path:

```css
@font-face {
  font-family: "Brand Display";
  src: url("../fonts/BrandDisplay.ttf") format("truetype");
}
.episode-title { color: var(--accent); }
```

`brand_style.dependencies` lists that font's path relative to the series root;
the selected stylesheet's relative URL is preserved when composed. Include the
complete transitive closure of any additional local imports/images/fonts. A
missing selected file or undeclared dependency fails binding/adoption.

For an already bound episode, select the diagram and stylesheet explicitly:

```sh
narova series adopt course --project course/episodes/orbits \
  --resources orbit_diagram,brand_style
```

To prepare without rendering, use `series bind course --episode orbits` for
first binding with the same `--resources` list. For preparation plus rendering,
use `series build` (add `--update-shared` when changing an existing selection). A font included as the stylesheet's declared dependency is
copied with it; it does not also need a separate selection. `brand_font` enables
independent selection when a portable text node uses the font without the CSS.

This complete `course/episodes/orbits/reel.config.json` uses a shared font/image,
a local image and episode-specific theme/caption/voice values:

```json
{
  "title": "Orbits",
  "renderer": "hyperframes",
  "size": { "w": 320, "h": 180 },
  "voices": {
    "teacher": { "backend": "piper", "speaker": "en_US-ryan-medium", "label": "Episode host" }
  },
  "theme": {
    "accent": "#d97706",
    "sans": "Brand Display,sans-serif",
    "css": ".narova-series/current/files/styles/brand.css"
  },
  "captions": { "plate": false },
  "scenes": [
    {
      "id": "diagram",
      "dur": 2,
      "vo": [],
      "body": "<h1 class=\"episode-title\">Orbits</h1><img src=\".narova-series/current/files/media/orbit.svg\" alt=\"Shared diagram\"><img src=\"assets/orbit.svg\" alt=\"Episode diagram\">"
    }
  ]
}
```

Use an available font file and voice suited to the workspace. The example is a
silent scene; adding narration retains the ordinary selected-backend/runtime/
model prerequisites. Set the episode's own creative brief
and proofs as required by its actual work. Then run the ordinary `build`.

To add episode-only CSS while retaining shared styles, point the episode's
`theme.css` at an episode-owned `theme.css` beside its config. Import the retained
shared stylesheet from that file, then author the local rules:

```css
@import url(".narova-series/current/files/styles/brand.css");
.episode-title { border-bottom: 2px solid var(--accent); }
```

Shared and local styles follow ordinary CSS ordering/specificity; Narova does
not merge stylesheet source files as theme-token objects. An episode-only font
can likewise live in `assets/fonts/` and be explicitly referenced by that
scene's `style.fontFile` or the episode's own `@font-face` rule.

For portable visual-tree text, select `brand_font` and apply the retained file:

```json
{
  "type": "text",
  "text": "Orbits",
  "style": {
    "fontFamily": "Brand Display",
    "fontFile": ".narova-series/current/files/fonts/BrandDisplay.ttf"
  }
}
```

This is a `scene.visual` node, usable with `no-browser` or HyperFrames; see
[renderer authoring](renderers.md). Keeping the stylesheet/font in the library
does not apply it to an episode; a font-family name alone does not bundle or
verify the local font bytes.

### Override and removal rules

| Episode authoring | Effective result |
|---|---|
| Omit a shared voice/character ID | Inherit that record. |
| Author the same voice/character ID | Replace the entire shared record, retaining its slot; provide all needed local settings. |
| Add a new voice/character ID | Keep shared records and add the episode-owned one; new voices append. |
| Set one theme token or caption property | That episode value wins; other shared properties remain inherited. |
| Set Boolean `captions` | Replace inherited caption settings. |
| Reference an episode-owned file | Use its ordinary episode-relative path; it does not replace a similarly named shared file. |
| Remove a supported inherited member | Use the explicit `seriesOverrides.remove` declaration below. |

In the example, orange `accent` overrides the shared accent, `plate: false`
coexists with inherited `maxWords: 6`, and the local `teacher` is a complete voice
record replacement. Local values survive adoption; a newly adopted shared value
does not displace an explicit episode override. Editing this episode does not
rewrite the shared source or another episode.

Precedence is product defaults, shared defaults, episode values, then ordinary
operation/variant selections. A local voice/character record replaces the
entire inherited record. Inherited voices keep their recorded order, including
replacement positions; new voices append in local declaration order. An
optional `voiceOrder` in the series source lists every shared voice exactly
once. Positional voice flags and default colors follow the resulting order.
Theme/caption properties merge by key. Caption objects can set `enabled`;
Boolean captions replace inherited settings. Remove inherited members before
local values with:

```js
seriesOverrides: {
  remove: { voices: ['guest'], theme: ['accent'], captions: ['maxWords'] }
}
```

Removing an unknown inherited member fails. Removing a caption property exposes
its ordinary product default if there is no local replacement.

Each episode retains its selected bytes and identities locally. Editing,
renaming or deleting the live series never updates an existing binding.
Updating is explicit:

```sh
narova series compare course --project course/episodes/orbits --json
narova series adopt course --project course/episodes/orbits
narova series restore <prior-revision-sha256> --project course/episodes/orbits
```

Compare/adopt keep the current named selection when flags are omitted. Pass an
explicitly empty flag, such as `--context=`, to clear an optional selection.
Compare reports candidate runtime changes and context changes; ordinary
`narova diff` and `build` determine affected consumers. Context prose alone
changes provenance without forcing audio/render work. Inspection and membership
operations never evaluate executable episode configurations; their effective
values are marked unavailable until an ordinary project operation resolves them.

Outgoing state is authored, identity-bound context, separate from rendered
facts. Record it explicitly and deliberately copy its `value` into a later
named series state before selecting it for another episode:

```sh
narova series handoff next-state.json --project course/episodes/orbits
```

Build/judge/release do not advance story or curriculum state. Catalog order and
relationships describe context; episode 2 can build before planned episode 1.
Selected generated-shot continuity still uses the ordinary explicit generation
command and its provider/anchor requirements.

Pack/open/remix transport only the current selected episode closure, excluding
series history, siblings and unselected context. They preserve source provenance
without modifying the original catalog. Opening/inspection need no provider;
ordinary resolution/build keep their provider, model and runtime prerequisites.

```sh
narova pack --project course/episodes/orbits --output orbits.narova
narova open orbits.narova --dir opened-orbits
narova series detach standalone-orbits --project course/episodes/orbits
```

Detach creates a fresh standalone project after source verification. It retains
effective defaults, ordinary `localResources`, context provenance and executable
project behavior; the original remains bound. Existing/overlapping targets and
pre-publication failures leave sources unchanged and publish no partial target.
A retained-input identity error stops before reuse; restore a verified prior
revision or repair the selected source explicitly. A busy mutation reports its
lock location for inspection and recovery; do not delete an active operation's
lock.

Every episode retains its own claim grounding, creative brief and project-bound
proof requirements. A series pilot is context, not another episode's proof.
These inputs make consistency inspectable; they do not score or prove semantic
or perceptual continuity.

The repository's `npm run test:series-production` repeats the real course/vlog/
drama, archive and detach checks in fresh temporary projects. It requires an
existing Piper runtime/voice (default `en_US-ryan-medium`), canvas and FFmpeg;
it checks prerequisites without installing models. `NAROVA_SERIES_TEST_VOICE`
selects another already available Piper voice. The printed evidence directory
retains videos, logs and the structured result inventory for inspection.
It also verifies real external-worker WAV cache invalidation in an isolated
temporary provider registry. `npm run test:series-browser` checks retained glTF
buffers and source-relative module imports through archive/open and detach,
using the ordinary HyperFrames/FFmpeg prerequisites and checking rendered pixels.
