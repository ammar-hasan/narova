# CLI reference

`narova` below means the independently installed standalone CLI:

```bash
narova <command>
```

If the installer reports that `~/.local/bin` is not on `PATH`, use the full
`$HOME/.local/bin/narova` path in each agent shell call.

Commands read the project from the current folder **or any parent folder** —
the nearest ancestor holding a `reel.config.*` wins, so commands work from
inside `out/` and renderer project folders too. `--project <dir>` picks an exact starting
folder, `--config <file>` an exact config. Output goes to `<project>/out`, or
`--out <dir>`.

| Command | Does | Cost |
|---------|------|------|
| `narova init <dir>` | new project: config + assets/ + one scene + README + .gitignore. Never overwrites; replacing the scaffold wholesale is the normal flow. | instant |
| `narova pack [--output <file.narova>]` | validate and write a byte-deterministic, digest-manifested project archive without synthesis, rendering, or network access. The default filename is derived from the title or directory. | instant, local I/O |
| `narova open <file.narova> --inspect` | verify and summarize an untrusted archive without extracting or executing it. | instant, local I/O |
| `narova open <file.narova> [--dir <target>]` | fully verify, then atomically materialize a project and print the execution-trust notice plus exact `check`/`build` next steps. Occupied targets require `--overwrite`. | instant, local I/O |
| `narova remix <source> [--dir <target>]` | copy a local project/archive or bounded `github:<owner>/<repo>[#ref]` source into a fresh project with `.narova-remix.json` lineage and no build history. Never executes fetched content. | local I/O; network only for `github:` |
| `narova ingest <url>` | fetch page metadata, save up to five useful images and a screenshot, update `sources.md`/`claims.md`, and register acquired files in `assets.lock.json`. | network + optional browser screenshot |
| `narova assets import <file>` | register an existing project-local file with its content hash and optional origin/license/attribution metadata. | instant |
| `narova assets download <url> --output assets/<file>` | bounded atomic HTTP(S) download into the configured asset directory, followed by provenance registration. Existing bytes survive failed downloads. | network |
| `narova assets providers [--pack core\|essential]` | list every core adapter and credential readiness; `essential` selects the original six no-key providers. | instant |
| `narova assets search <query> --provider <name> --kind <kind>` | search a core provider and print normalized candidates; `--limit 1..20` and `--json` are supported. | provider API request |
| `narova assets acquire <id> --provider <name> --kind <kind> --output assets/<file>` | resolve a selected catalogue item, then use the same bounded download, atomic publication, and provenance registration as `assets download`. | provider API + media download |
| `narova assets list\|verify\|credits` | list tracked assets, detect missing/modified bytes, or print deduplicated attribution from `assets.lock.json`. Credits accepts `--format text\|youtube\|web\|json`; text remains the default, web escapes recorded text, and JSON uses null for absent fields. Release checks also verify tracked bytes. | instant |
| `narova assets untrack <file>` | remove a provenance record without deleting the local file. | instant |
| `narova provenance [--json]` | read-only, offline project report with Claims, Media, AI generation, and Reproducibility sections. Every fact is graded verified (artifact-backed), declared (authored statement), or unknown; missing/tampered evidence is shown without failing. Rights buckets are not legal clearance and exact used-asset closure is not claimed. | instant |

Core owns all deterministic adapters. Wikimedia, Openverse, NASA, Internet
Archive, Iconify, Poly Haven, The Met, Cleveland Museum, and Library of Congress
need no key; Pexels, Pixabay, and Freesound use optional environment keys. The
separate `narova-stock-extensions` skill is the LLM-led discovery path for
changing sites. Run `npm run test:stock-live` for every available core adapter;
absent optional keys are reported as skips.
| `narova check` | validate config, lint cues / ids / data-* attrs / theme CSS, sniff `vo` for unledgered stats & superlatives, and report walkthrough freshness. The `ok:` line ends with an **estimated narration length** at the configured tempo — the knob for hitting a target duration before any audio exists. No TTS, browser, or writes. `--strict` checks that every claim has a ledger entry. `--release` adds a build gate: remote deps, missing claims, unsupported HTML, black frames, stale walkthrough captures, and missing/draft creative approval for non-trivial work. Exit 3 on release-mode non-pass findings. | instant |
| `narova judge [--video <file>] [--plan] [--json]` | read-only Video CI mirror over one self-contained encoded artifact (default `out/video.mp4`). Joins explicit creative assertions to measured frame, motion, timing, audio, caption, hierarchy-proxy, and production-state evidence; build receipts bind shared sidecars/timing to the matching video digest, while unbound context stays unavailable. Indirect playlists and attached artwork are rejected. Accounts for five perception families and marks unavailable semantic perception `UNCERTAIN`. `--plan` adds plural, unranked options for assertion-linked divergence/uncertainty, always including keeping unchanged; it selects and executes nothing. No universal score, taste gate, mutation, or network access. | bounded local decode |
| `narova judge --repair --judge-assertion <id> --repair-branch <name> [--video <file>]` | explicitly delegated `caption-sidecar-rebuild/v1` only. Requires a current proof and one mechanical/accessibility `caption.word_count` observation that is `UNCERTAIN` solely because receipt-bound captions are missing or malformed. Derives SRT/VTT from measured timings in isolation, preserves the exact video and protected identities, re-judges the candidate, and atomically publishes only an unapproved `ALIGNED` proof branch. Current production is unchanged; creative and general repair remain unsupported. | bounded local decode + copy |
| `narova compile` | compile `reel.config.*` → `out/manifest.json` (versioned project manifest). It records the selected renderer and speech-backend implementation versions when they are available locally, otherwise explicit nulls; no provider is executed to obtain them. The manifest is also written automatically by `synth`, `compose`, and `build`. | instant |
| `narova plan` | compare current `reel.config.*` against the last `out/manifest.json` and classify what changed. Prints change level (none/config/visual/walkthrough-capture/audio/full), affected scenes, and which pipeline stages will rebuild. | instant |
| `narova diff` | per-scene revision impact vs the latest recorded revision: each scene `unchanged` / `script changed` / `visual changed` / `timing changed` / `structural`, derived impacts (narration regenerated, captions retimed, spans reused/re-rendered), predicted reuse with basis and unit, and an estimated render time scaled from recorded measured stage durations (omitted with a plain statement before any measurement exists). No ledger: may compare against the last build manifest, naming that baseline; states plainly when nothing is recorded. Pass the same `--fps`/`--quality`/`--renderer` flags as the build so the render-context comparison matches. | instant |
| `narova history` | `list` recorded revisions (ordinal, timestamp, change summary, measured reuse, optional label); `annotate <v> "label"` (metadata only); `compare <a>..<b>` — the same impact report computed from the records alone. Missing/empty ledger states so plainly and exits 0. | instant |
| `narova synth` | Python TTS → `out/audio/*.wav`, `out/audio/full.wav`, `out/timings.json`. Creates the venv on first run. Writes and enriches `manifest.json` with measured word timings. **Skipped automatically when `config.narration.file` is set** — external audio is copied directly and mixed with bed/sfx. | built-ins are local; external-provider cost depends on its service |
| `narova generate "<prompt>" [--provider <name>]` | ask one explicitly registered `narova-video-provider/v1` worker to create a staged clip, then transactionally publish the validated media, versioned generation recipe, hashes, and asset-registry entry. Defaults to provider name `sora`; a missing registration fails before network use. | provider-defined billed network operation |
| `narova walkthrough explore <id>` | open a declared URL in an isolated agent-browser session and print its interactive accessibility snapshot. The session stays open so an author/agent can inspect real roles, labels, text, and test ids before scripting. | browser startup |
| `narova walkthrough capture [id]` | execute declared semantic actions on measured narration anchors and write a WebM, capture manifest, and evidence PNGs under project assets. Omit id (or use `all`) for every declaration. Explicit only; build never runs actions. | live walkthrough duration + browser startup |
| `narova walkthrough status [id]` | report whether each capture is fresh, missing, recipe-stale, timing-stale, or modified. | instant |
| `narova compose` | config + timings + audio → the selected renderer project (`out/hf-*` or `out/no-browser-*`) + SRT/VTT, then prints the scene table. HyperFrames also consumes fresh walkthrough captures and restarts a live detached Studio. | usually under 1s |
| `narova captions` | (re)write `out/captions.srt` + `out/captions.vtt` from the existing `out/timings.json` — one cue per sentence, global time. No recompose. | instant |
| `narova shots` | snapshot one QA frame per scene (mid-scene) with the selected renderer. `--at t1,t2,…` picks explicit times. No-browser needs no browser. | seconds |
| `narova build` | synth + compose + selected local renderer → `out/video.mp4` (+ captions). Variants and deliverables work with both providers. | synth cost + local render |
| `narova preview` | HyperFrames: compose and open Studio. No-browser: render `out/preview-no-browser.mp4` at draft quality. | Studio until Ctrl-C, or local draft render |
| `narova preview --detach` | compose, keep Studio alive, print URL + PID + log. If one is already running it is restarted on the new build (same port) — Studio does not hot-reload. | until `preview --stop` |
| `narova preview --scene <id>` | preview one isolated scene; required instead of a full Studio document when a film exceeds the safe WebGL context budget. | Studio until Ctrl-C |
| `narova voices list\|get` | list or download TTS voices. piper `list` shows a spread of starter voices; `get <name>` downloads any voice from the piper catalog. | network on `get` |
| `narova providers add <manifest>` | validate, handshake with, and explicitly register an external speech or video worker under `~/.narova/providers/`. Provider names are globally unique across protocol kinds. | instant; starts the worker for its handshake |
| `narova providers list` | list explicitly registered external providers and their speech/video kind. | instant |
| `narova providers doctor <name>` | verify manifest, executable, required environment, and protocol handshake. | provider startup |
| `narova providers remove <name>` | unregister a provider; does not delete its companion skill. | instant |
| `narova renderers list` | list the bundled local `hyperframes` and `no-browser` renderer providers. | instant |
| `narova shots --motion` | capture start/middle/end frames for every scene; WebGL scenes are isolated to avoid browser context limits. | browser snapshot pass |
| `narova shots --beats` | capture arrival and resolved frames for every narration sentence, both sides of named markers, and motion coverage for silent scenes. Use this as the visual-production gate for internally directed long scenes. | browser snapshot pass |
| `narova shots --motion --proof` | capture pilot coverage and fail when at least 75% of sampled frames are near-black or no frames render. This narrow visibility gate complements, but never replaces, direct creative review. | browser snapshot pass + local FFmpeg frame scan |
| `narova build --verify-motion` | render, then fail when FFmpeg detects a ≥2s frozen or ≥0.5s black segment. | build + verification pass |
| `narova build --release` | preflight strict source/creative checks, recheck measured duration before rendering, then fail on frozen or black encoded intervals. Use for final delivery. | build + release verification |
| `narova renderers doctor <name>` | verify provider-local dependencies; no-browser explicitly reports that a browser is unnecessary. | instant |
| `narova doctor` | check ffmpeg, python, venv, optional agent-browser, and HyperFrames. Exit 3 if a required core tool is missing; missing optional adapters/backends are reported separately. | first run downloads the HyperFrames CLI |
| `narova release save <name>` | save `out/manifest.json` as a named release in `~/.narova/releases/`. Releases are content-hashed snapshots you can compare, restore, and remove. | instant |
| `narova release list` | list all saved releases with size and date. | instant |
| `narova release restore <name>` | copy a saved release back to `out/manifest.json`. | instant |
| `narova release remove <name>` | delete a saved release. | instant |
| `narova branch save <name> --rationale "…"` | require a current passing `shots --proof` receipt, then transactionally publish the editable snapshot plus a durable, project-bound proof bundle containing byte-hashed resolved config, manifest, timings, contact sheets, every audited frame, candidate status, rationale, stable semantic identities, and proof-time CLI overrides. Another project's same-named branch cannot satisfy the release gate. Ambitious release requires 2–3 content-distinct branches, one approved selection, and exact expansion lineage in the brief. Later added/edited snapshot files, timing, frame, receipt, or evidence changes invalidate selection; locked compare-and-swap replacement preserves the prior branch on failure or a concurrent stale save. | instant |
| `narova branch save <name> --rationale "…" --judge-assertion <id> [--video <file>]` | focused Video CI proof save: additionally judge one receipt-bound encoded artifact and preserve its actual bytes plus the assertion-linked observation in the same branch transaction. The rationale is the creator's hypothesis. Missing/stale binding, unknown focus, or changed evidence fails before replacement. | bounded local decode + copy |
| `narova branch compare <a> <b> [c]` | verify and display 2–3 unique current-project proof branches focused on one assertion. Preserves requested order and exposes each hypothesis, status, artifact identity, observation, evidence, interpretation, confidence, classification, and production mapping. Read-only and offline: no judgement rerun, render, score, ranking, recommendation, selection, restore, or mutation. Rejected/archived attempts remain comparable. | instant + stored-byte hashing |
| `narova branch set <name> --status approved|rejected|archived` | record the proof decision before expanding one selected branch. | instant |
| `narova branch list|show` | inspect saved proof directions, rationale, status, parentage, and stored focused experiment metadata when present. | instant |

`narova render` was removed in 0.3.0. Use `compose` or `build`.
Walkthrough config, auth, semantic locator, security, timing, and layout details:
[`product-walkthroughs.md`](product-walkthroughs.md).

Optional cloud companions are installed and registered separately. Use
`narova-elevenlabs` for ElevenLabs speech, `narova-openai` for OpenAI speech
and Sora, or `narova-runway` for Runway video generation; none is a dependency
of the main Narova skill. Sora and Runway use `narova-video-provider/v1`; the
core owns staging and provenance while each companion owns its vendor API.
Renderer providers are different: both are bundled, local, and free. See
[`renderers.md`](renderers.md) for the portable scene tree and capability matrix.

## Flags

- `--backend <name>` — TTS backend for all voices: a built-in
  (`piper|xtts|qwen|chatterbox`) or an explicitly registered external
  provider. Default piper. `chatterbox` clones a voice: set each voice's `speaker` to an ABSOLUTE
  path to a clean 10–20s recording (install once: `narova-setup --chatterbox`).
- `--renderer hyperframes|no-browser` — renderer provider. HyperFrames is the
  default; no-browser is browserless and requires `scene.visual` on every scene.
- `--video <file>` — `judge` or focused `branch save`: inspect this local,
  self-contained encoded video instead of `<project>/out/video.mp4`. Indirect
  playlists are not video artifacts; optional shared output context is used
  only when a matching build evidence receipt binds it to the selected bytes.
- `--reuse` — skip TTS, reuse `out/audio` + `out/timings.json`.
  Meant for visual-only edits; if spoken text, scene topology, or silent runtime
  changed since the last synth, `--reuse` is ignored with a note and the needed
  audio/timing rebuild runs instead.
- `--tempo N` — speech speed (1.1–1.2 reads well).
- `--size 16:9|1:1|9:16` — frame shape.
- `--platform tiktok|reels|shorts|linkedin|x|youtube` — frame preset plus the target
  duration band `check` lints against. An explicit `--size` (or `config.size`)
  wins over the platform preset.
- `--variant <id>` — apply a declared hook variant (`config.variants`) as
  scene 1. Works with `check`, `synth`, `compose`, `build`; `build` renders
  `out/video-<id>.mp4` instead of `video.mp4`.
- `--variants` — `build` only: render the base `video.mp4` AND one
  `out/video-<id>.mp4` per declared variant, sequentially. The sentence-level
  TTS cache makes shared sentences free, so each extra pass only pays for the
  variant's scene-1 lines. With no variants declared it says so and builds
  just the base. Mutually exclusive with `--variant`. Walkthrough takes are
  namespaced per variant. Prepare the base and each walkthrough-bearing
  variant with `synth` then `walkthrough capture --variant <id>` before using
  `build --variants`; the build remains read-only and never records implicitly.
- `--fps N`, `--quality draft|standard|high` — render settings.
- `--at t1,t2,…` — `shots`: explicit frame times in seconds.
- `--motion` — `shots`: start/middle/end of each scene.
- `--beats` — `shots`: arrival/resolved state of every narration sentence,
  both sides of named markers, and scene coverage for silent work. Mutually
  exclusive with `--at` and `--motion`.
- `--port N` — Studio port (default 3002; auto-detects next available if 3002 is in use).
- `--detach` / `preview --stop` — start or stop persistent Studio.
- `--voice-a <s>`, `--voice-b <s>` — replace the first two voices (add more voices directly in the config).
- `--deliverables` — `build` only: render per-platform export presets. The
  renderer produces the SAME composition at its authored aspect ratio; ffmpeg
  then scale+pads (pillarbox/letterbox) to each preset's target dimensions —
  this does NOT re-art-direct layouts. A 16:9 scene will appear as a
  letterboxed strip in a vertical deliverable. For true platform-specific
  compositions, render separate projects at each aspect ratio. Bare
  `--deliverables` renders `narova-standard` plus the single canonical preset
  for the configured platform (e.g. `youtube-1080p`, not 4K); use a
  comma-separated list of preset IDs (e.g. `youtube-1080p,reels-1080p`) to
  select specific profiles. `whatsapp-compressed` produces a 540×960
  rate-controlled encode under 16 MB for messaging apps. Only `youtube-4k`
  passes its resolution to HyperFrames; all others render at the composition's
  natural size and are resized in ffmpeg.
- `--safe-area-guides` — `build` only, requires `--deliverables`: overlay
  TikTok safe-area zones as authoring hints on the TikTok deliverable (only
  the `tiktok-1080p` preset defines safe-area guides; a bare `narova build`
  ignores this flag).

## What lands in `out/` (never edit — regenerated every run)

Project source stays outside `out/`. In particular, `assets.lock.json` is the
machine-managed creative-asset provenance ledger; it is saved with releases but
is not copied into the renderer's public `assets/` directory. `claims.md`
remains the narration claims ledger, while `sources.md` is the content-source
bibliography.

```
out/
├── manifest.json          # project IR + compile-time renderer/backend versions
├── narration.json         # scenes → the TTS input
├── config.resolved.json   # the validated config
├── audio/NN.wav|mp3       # audio per scene
├── audio/full.wav         # all scenes joined — the narration track
├── timings.json           # word/turn times, scaled to the real audio
├── captions.srt|.vtt      # sentence-level captions, global time (compose/build/captions)
├── hf-<project>/          # the generated HyperFrames project (when selected)
│   ├── index.html         #   scenes, captions, timeline
│   ├── assets/            #   project assets + narration.wav
│   └── package.json       #   pins the hyperframes version
├── no-browser-<project>/      # the generated browserless project (when selected)
│   ├── project.json       #   portable visual tree + measured timeline
│   ├── assets/            #   copied local media/fonts
│   └── audio/narration.wav
├── video.mp4              # the final video (build only)
├── video-<id>.mp4         # per-variant videos (build --variant/--variants)
└── revisions.jsonl        # append-only revision ledger (advisory; build only)
```

`revisions.jsonl` records one entry per successful base build whose effective
resolved state changed since the last entry (an unchanged rebuild records
nothing and prints so). Each entry holds the audio/timing fingerprints,
per-scene identity digests, measured stage durations, and a measured reuse
report: per-scene audio byte-identity vs the previous revision (by digest),
render-span reuse vs identity re-render vs fallback, sentence-cache hit/fresh
counts, and shared artifacts rebuilt by design (full mix, encoded video,
deliveries). Ratios state basis and unit; missing evidence is "not
applicable"; fallback re-renders never count as reuse. Deleting the ledger is
safe — history restarts at v1 on the next state-changing build.

`out/` is a single directory, so `synth`/`compose` reflect whichever variant
was selected last (plain = base, `--variant <id>` = that variant's scene 1).
Switching variants and re-running with `--reuse` is safe: the spoken text
differs, so `--reuse` is detected as stale, ignored with a note, and the
changed sentences re-synthesize (the sentence cache keeps the rest free).

`timings.json` is keyed by scene id, all times **scene-local** seconds:

```
{ "<sceneId>": { "dur": 8.42,                  # scene length in seconds
                 "turns": [0.16, 3.1],          # start time of each vo turn
                 "words": [{"w":"Hi","t0":0.16,"t1":0.5,"who":"a","si":0}] } }
```

Scene i's global start is the sum of `dur` over scenes 0..i-1 — or just read
the scene table `narova compose` prints, or let `narova shots` pick mid-scene
times for you.

## Common loops

- Edit visuals: change config → `check` → `compose` → `preview`.
- Re-render after visual edits: `build --reuse` (skips TTS).
- Changed any spoken text: full `build`. The sentence cache
  (`~/.narova/cache/sentences/`) re-synthesizes ONLY the changed sentences —
  untouched scenes keep byte-identical audio. This is the iteration
  consistency guarantee; don't reword lines the user didn't ask you to touch.
  (`--reuse` with changed text is caught and ignored, so the wrong command
  degrades to the right one.)
- Product walkthrough: declare → `walkthrough explore <id>` → script/check →
  synth → `walkthrough capture <id>` → compose/shots/preview → release check →
  `build --reuse --release`. A narration/action change needs recapture; body/theme or
  window/full presentation edits reuse the recording.
- Visual QA: use `narova shots --beats` for narration/marker-driven work and
  `shots --motion` for scene coverage (`--at t1,t2` remains available for a
  custom shot plan). After encoding, run `narova judge` to expose assertion
  correspondence, temporal behavior, and uncertainty, then LOOK at the evidence
  against `creative-brief.md`. Judgement is a mirror, not a substitute for the
  directing agent's taste or a universal definition of quality.
- Extra checks on the generated page, inside `out/hf`:
  `npx hyperframes lint`, `npx hyperframes check`,
  `npx hyperframes snapshot --at <t1,t2> -o <directory>`. Snapshot `-o` /
  `--output` takes a **directory** — the frames land inside it — never
  `--out`.
- Studio preview does not hot-reload, so `compose` and `build` restart a live
  detached preview on the new build automatically (same port). Manual
  equivalent: `narova preview --detach`.
- Verify the result: mp4 length ≈ `out/audio/full.wav` length (±0.15s):
  `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 <file>`
