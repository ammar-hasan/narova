# Shared series authoring

A series shares selected defaults, resources and authored context across
independent projects. Courses can share a teacher and terminology; vlogs can
share a host, visual package and music; drama can share cast references and
explicit story state. Each episode owns its script, scenes, timing and evidence.

## Start with two episodes

Use a ready Narova CLI, Node.js and the no-browser runtime. Start in an empty
working directory. This silent example needs no speech model, font download or
API key. It creates two independent lesson projects with one shared logo and a
local image in each. Run the complete block:

```sh
narova series init course --id course --title "My course"
node <<'NODE'
const fs = require('node:fs');
const write = (file, value) => {
  fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};
const svg = color => `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="${color}"/></svg>`;
write('course/media/logo.svg', svg('#00aa66'));
write('course/series.config.json', {
  format: 'narova.series/1', id: 'course', title: 'My course',
  resources: { logo: { file: 'media/logo.svg' } },
  episodes: ['intro', 'practice'].map(id => ({ id, title: id, project: `episodes/${id}` }))
});
for (const id of ['intro', 'practice']) {
  write(`course/episodes/${id}/assets/local.svg`, svg('#0066ff'));
  write(`course/episodes/${id}/reel.config.json`, {
    title: id, renderer: 'no-browser', size: { w: 320, h: 180 }, captions: false,
    scenes: [{ id: 'lesson', dur: 1, vo: [], visual: {
      type: 'group', style: { width: 320, height: 180, background: '#ffffff' },
      children: [
        { type: 'svg', src: '.narova-series/current/files/media/logo.svg',
          style: { x: 30, y: 60, width: 60, height: 60 } },
        { type: 'svg', src: 'assets/local.svg',
          style: { x: 230, y: 60, width: 60, height: 60 } }
      ]
    } }]
  });
}
NODE
narova series build course --episode intro --resources logo
```

Open `course/episodes/intro/out/video.mp4`: shared green logo on the left,
episode-owned blue image on the right. Practice has no binding or output yet.
`logo` is the catalog resource name; `media/logo.svg` is its source file. Selecting
it copies the file into Intro; the scene's `src` uses that saved copy. Creating
the catalog alone does not copy files or insert scenes. Before the first build,
a standalone `check` can report an unprepared retained reference: run the shown
`series build` to select and copy it. After binding, an unselected reference needs
an explicit resource-selection update; a corrupt saved file needs restoration
or explicit adoption. Keep using the documented retained path.

Change the green fill in `course/media/logo.svg`, then compare these commands:

```sh
# Keeps Intro's saved green logo, even though the original has changed.
narova series build course --episode intro --reuse
# Builds Practice for the first time using the changed shared original.
narova series build course --episode practice --resources logo
# Intentionally updates only Intro; its local blue image stays unchanged.
narova series build course --episode intro --update-shared --reuse
```

`--reuse` can speed up unchanged production; it never refreshes shared inputs.
No separate bind step is needed for this workflow. For CI, track the source files
and each episode's resource selection recipe; choose whether copies are derived
or frozen in [CI builds and Git tracking](#ci-builds-and-git-tracking).

Fonts and CSS are optional. A font name alone does not copy a font file, and
selecting a stylesheet alone does not apply it. Use the explicit file references
in [Mix shared and episode-owned material](#mix-shared-and-episode-owned-material)
when you need them. Context, incoming state and history below are optional too.

## Build one episode

Create the episode project and its catalog entry, then prepare and build it in
one command:

```sh
narova series build course --episode intro --resources logo
```

The first call copies and verifies the chosen shared files into the episode's
binding, then runs its ordinary build. Later calls keep that saved shared
revision. Repeating the same selectors is accepted, including a different list
order; changing selectors requires `--update-shared`.

```sh
# Refresh only this episode, keeping its current named selections.
narova series build course --episode intro --update-shared --reuse
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
| `series pin` | Retain the chosen closure once in the series store and save the catalog pin; do not change or build episode bindings. |
| `series bind` / `series adopt` | Prepare or update an episode separately, without building. |
| Ordinary `build` | Consume the existing binding; never infer membership or adopt the live series. |
| `series restore` | Restore exact verified retained history, without building. |

There are two copying boundaries. Initial binding or adoption copies selected
shared source bytes (or verified catalog-pinned store bytes) into `.narova-series/current/files/`. Composition then stages
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
builds together can use the combined command directly. With a catalog pin,
preparation uses its verified stored bytes; updates adopt that pin. Git already preserves
source versions; retained episode versions let episodes use different shared
revisions within the same checkout.

## CI builds and Git tracking

CI chooses which episodes to produce; Narova does not schedule changed episodes
or require a whole-series rebuild. Keep each episode's selection recipe in its catalog `shared` record or a
tracked script. After checkout and ordinary runtime/provider/model setup, run
one command for each selected episode:

```sh
narova series build course --episode intro --resources logo --reuse
```

| Policy | Commit to Git | Build the selected episode |
|---|---|---|
| Use shared sources from the checked-out commit | Catalog/shared originals, episode sources/assets/evidence and per-episode selection recipe. | In a fresh checkout, `series build` prepares and builds in one call. |
| Preserve pinned revisions with one series store | Catalog episode pins, complete `.narova-series-store/`, originals and episode sources/assets/evidence. Ignore episode membership/current files together. | `series build` verifies the pinned closure and prepares disposable episode files. |
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

For retained files stored in each episode, commit the complete membership/current-binding/files pair
and omit those two ignore patterns. History is optional unless you want local
`series restore`. Refresh one episode with `series build --update-shared`, inspect
and commit its new binding/files. Advanced `series compare` and `series adopt`
remain available for separate review before rendering; `series bind` rejects an
already bound project.

## Pin shared inputs once for a fresh CI checkout

A published daily brief can keep its old look while later days use a new one.
Use a catalog pin when you want that behavior without tracking shared file
copies in every episode. The pin saves the whole selected shared set: defaults,
resource declarations and dependency bytes, selected context and incoming state.
It is a revision of that selection, not just the stylesheet's hash.

For an existing catalog episode, select and pin current shared sources without
building or changing its working binding:

```sh
narova series pin course --episode intro --resources brand_style
```

Narova retains each distinct file content once under the series root's
`.narova-series-store/` and writes the pin into that episode's catalog entry:

```json
{
  "id": "intro",
  "title": "Introduction",
  "project": "episodes/intro",
  "shared": { "revision": "<exact revision SHA-256 printed by series pin>" }
}
```

The placeholder is explanatory; the command writes the actual digest for you.
Selected CSS keeps its source-relative paths, and its declared fonts, imports
and images are pinned too. Unchanged fonts share the same stored bytes across
new stylesheet versions. Live originals remain editable; rebuilding a pinned
episode reads the store, never silently substitutes current originals.

Commit the catalog, the complete `.narova-series-store/` and ordinary shared/
episode authoring sources. The episode membership/current files are generated
materialization for this workflow and can be ignored together using the patterns
above. Do not ignore the series store: it is retained authoring state, not a
build cache. In a fresh checkout, including a shallow CI checkout:

```sh
narova series build course --episode intro --reuse
```

No Git history fetch, extra pin flags or per-episode retained payload commits
are needed. Copies still appear locally during preparation and rendering; the
pin and series store are the reproducible source of truth. Git already stores
identical file contents once internally, so fewer tracked paths/checkout copies
are the clear benefit, rather than a guaranteed repository-size reduction.

When the live look changes, pin a later episode using the same resource names.
Published episodes keep their older pins. To deliberately update one pinned
episode, repin it, inspect its catalog change, then update its working binding:

```sh
# Omitted selectors keep this episode's prior catalog-selected names.
narova series pin course --episode intro
narova series build course --episode intro --update-shared --reuse
```

Pinning does not build or mutate any episode binding. A reused workspace whose
binding differs from the catalog pin needs `--update-shared`; a fresh checkout
prepares the pin directly. For a pinned episode, `--update-shared` adopts the
catalog pin, rather than refreshing from mutable originals. Changed selection
flags require repinning; flags repeating the pinned selection are accepted.
The pin does not support editing just one resource's saved hash inside a shared
snapshot. Choose the new complete selection explicitly, then pin it.

Migrate an already-frozen episode without adopting today's live shared bytes:

```sh
narova series pin course --episode intro --from-bound
```

This verifies and stores its existing binding. Omit selection flags; optional
`--project` explicitly chooses its existing project. After verifying and
committing the catalog/store, you can stop tracking the episode membership and
current files together. Keep that old revision available until the migration
is committed; pinning does not delete it or rewrite your Git tracking.

A missing/corrupt selected store member fails before production or reuse, even
when a working binding or live original exists. Restore the verified committed
store; no live fallback or automatic repair occurs. Missing unselected store
objects do not affect this episode. `series inspect course --json` reports pin
availability and reason without preparing or executing projects.

An unpinned catalog entry can also save a selection recipe:

```json
"shared": { "resources": ["brand_style"], "context": ["audience"], "incoming": "after_intro" }
```

Initial preparation uses omitted selectors from this recipe; explicit flags
replace the corresponding initial selectors. Existing bindings keep their
saved choices by default. A pinned `shared` record contains only `revision`;
its recipe is part of the verified stored snapshot. Pinning still selects files;
ordinary episode CSS/font/scene references decide how they are used.

Pack/open/remix and detach include the selected ordinary binding/bytes, so the
exported episode remains self-contained without the series store. Runtime,
provider, creative-evidence and explicit membership requirements stay ordinary.
No automatic store cleanup, sibling scheduling or story advancement is added.

## Optional defaults, context and continuity

Use a separate empty working directory for this larger example. Create the
source, then edit its data-only catalog and shared material:

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
not merge stylesheet source files as theme-token objects. Each authored CSS
source remains a separate stylesheet, so its leading `@import` stays valid.
Generated base styles load first, then the theme stylesheet, scene `cssFile`
sources in scene order, and configured CSS imports in declaration order.
Scene CSS uses ordinary global selectors; placing a file on a scene does not
scope its rules. Full and isolated rendering use the same ordered styles.
Select the shared stylesheet **and its font/image/import dependencies** before
building; imports apply retained files but do not select or copy extra files.
Local rules after the shared import can override shared rules at equal cascade
priority. CSS layers, specificity and `!important` still follow browser rules.
Keep `@import` before your own ordinary rules; Narova does not fix invalid CSS.
An episode-only font
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

`npm run test:series-pins` proves old/new look cohorts from an actual shallow Git
checkout, corruption-before-reuse, explicit repinning/update and archive/open/
detach after deleting both series stores. It uses ready HyperFrames/FFmpeg and
three local font fixtures (`NAROVA_PINS_FONT_DIR`), plus an independent browser
readback driver (`NAROVA_CSS_BROWSER_MODULE`/`NAROVA_CSS_BROWSER_PATH`). It
measures MP4 pixels, loaded faces and fetched image bytes, without speech, model
acquisition, paid providers or global installation.
