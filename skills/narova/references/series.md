# Shared series authoring

A series shares selected defaults, resources and authored context across
independent projects. Courses can share a teacher and terminology; vlogs can
share a host, visual package and music; drama can share cast references and
explicit story state. Each episode owns its script, scenes, timing and evidence.

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
    "opening": { "file": "media/opening.mp4" }
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
narova series bind course --episode orbits \
  --context audience,vocabulary --resources orbit_diagram --incoming after_intro
narova series inspect --project course/episodes/orbits --json
narova build --project course/episodes/orbits --reuse
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
