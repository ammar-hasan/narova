# Narova agent protocol

Narova release: **0.41.0**
Machine schema: **`narova.result/1`**

This is the shipped machine-interface guide for agents and integrations. It is
not the normative product specification. Human output remains the default;
pass `--json` to any public operation when the result will be consumed by a
program.

## Result envelope

With `--json`, stdout contains exactly one JSON object and no prose:

```json
{
  "schema": "narova.result/1",
  "operation": "check",
  "success": true,
  "exit": { "code": 0, "class": "success" },
  "data": {},
  "diagnostics": [],
  "artifacts": []
}
```

- `schema` identifies the envelope and all operation payloads.
- `operation` is the dispatched operation, including a subcommand where one
  exists. It can be `null` only when argument parsing could not identify an
  operation.
- `success` is true exactly when the process exits with code 0.
- `exit` gives both the stable numeric code and its stable class.
- `data` is the operation payload described below. It is always an object.
- `diagnostics` contains zero or more `{ severity, code, message, subject? }`
  objects. `message` is for people; branch only on `code`.
- `artifacts` contains `{ path, role }` for project-visible paths created or
  replaced by the operation. Read-only operations return an empty list.

Progress and human explanations may be written to stderr. Never parse them.
No envelope field contains credentials or environment values. Names of required
environment variables may appear because they are configuration, not secrets.

Consumers must ignore unknown fields. Within schema major version 1, fields may
only be added: existing fields and meanings will not be removed, retyped, or
repurposed. A breaking change uses a new schema identity and is documented here.

## Exit status

| Code | Class | Meaning |
|---:|---|---|
| 0 | `success` | The operation completed. An inspected subject may still be stale or absent when that state is advisory and is represented in `data`. |
| 1 | `operation-failure` | The operation could not complete its work, for example because source, a prerequisite, a provider, or a renderer failed. |
| 2 | `usage-error` | The invocation was rejected: unknown command or option, missing value, malformed argument, or conflicting options. |
| 3 | `subject-non-pass` | The inspection or gate ran correctly and the subject failed, for example a release gate, health check, proof audit, or motion audit. |

When `--json` is recognized but parsing fails, Narova still emits the minimal
envelope with exit class `usage-error`.

## Operation payloads

Fields marked “when present” are additive results of the selected mode. Every
operation may add fields in a later schema-1 release.

| Operation | `data` payload | Artifact roles when produced |
|---|---|---|
| `help` | `{}` | none |
| `version` | `{ version }` | none |
| `init` | `{ dir, created[], skipped[], projectCreated, assetDirectoryCreated }` | `project`, `asset-directory`, `authoring-source` when created |
| `demo` | `{ seconds, elapsedMs, networkBytes, projectDir, created }` | `project`, `authoring-source` when first created, `video`, `captions`, `manifest`, `timings`, `audio`, `revision-ledger`, `renderer-project` |
| `pack` | `{ path, members, bytes, sha256, manifest }` | `project-archive` |
| `open` | inspection: the archive manifest plus archive path and digest; extraction: `{ target, archive, archiveSha256, members, source, trust }` | `project` when extracted |
| `remix` | `{ target, origin, members, trust }` | `project`, `remix-lineage` |
| `ingest` | `{ url, slug, images, screenshot, claimsCreated }` | `asset`, `registry`, `source` |
| `compile` | `{ manifest, scenes }` | `manifest`, `stage-input`, `compatibility-state` |
| `check` | `{ level, warnings, errors, critique? }` | `report` when creative identity is requested |
| `critique` | `{ profile, advice }` | none |
| `judge` | `{ judgement }`; plus `{ interventionPlan }` for `--plan`, or `{ repairCandidate, repairCandidateIdentity, branch }` for successful caption repair | repair success: `archive`, `proof-metadata`; otherwise none |
| `plan` | the stage plan object | none |
| `provenance` | the provenance report object | none |
| `diff` | the revision-impact report, plus its named baseline when applicable | none |
| `synth` | `{ out, reused }` | `audio`, `timings`, `manifest` |
| `compose` | `{ scenes, total, renderer, cues }` | `renderer-project`, `captions` or `caption-omission`, `manifest` |
| `captions` | `{ cues }` | `captions` or `caption-omission` |
| `review` | the selected review report with `mode` | `contact-sheet` or `excerpt` when created |
| `shots` | `{ times[], frames, proof, proofReceipt? }` | `frames`, `receipt` |
| `build` | `{ mp4, seconds, renderer, deliverables[], companion, revision }`, or `{ builds[] }` for `--variants` | `video`, `captions` or `caption-omission`, `manifest`, `timings`, `audio`, `renderer-project`, `revision-ledger`, `deliverable`, `thumbnail`, `video-companion` |
| `preview` | `{ renderer, detached, url?, pid?, port?, stopped? }` | `renderer-project`, `preview-state`, `preview-log`, or draft `video` |
| `doctor` | `{ ok, checks[] }` | none |
| `generate` | `{ provider, providerProtocol, providerVersion, output, spec }` | `generated-media`, `generation-recipe`, `registry` |
| `retime` | `{ applied, scenes[] }` | `authoring-source` only with `--apply` |
| `karaoke generate` | `{ cues[] }` | `captions` |
| `assets providers` | `{ pack, providers[] }` | none |
| `assets search` | `{ provider, kind, query, results[] }` | none |
| `assets list` | `{ assets[] }` | none |
| `assets verify` | `{ ok, count, results[] }` | none |
| `assets credits` | `{ format, entries? , lines? }` | none |
| `assets import` | registered file facts | `registry` |
| `assets download`, `assets acquire` | acquired file facts | `asset`, `registry` |
| `assets untrack` | `{ file }` | `registry` |
| `walkthrough explore` | `{ id, session, snapshot }` | none |
| `walkthrough status` | `{ walkthroughs[] }`; stale is a successful inspection | none |
| `walkthrough capture` | captured IDs, media, and step counts | `recording`, `capture-manifest`, `registry` |
| `history list` | `{ revisions[] }` | none |
| `history annotate` | `{ ordinal, label }` | `ledger` |
| `history compare` | `{ from, to, ...revisionImpact }` | none |
| `release list` | `{ releases[] }` | none |
| `release save` | `{ name, files[] }` | `archive` |
| `release restore` | `{ name, restored[], conflicts[] }` | restored project artifacts and `manifest` |
| `release remove` | `{ name }` | none |
| `branch list` | `{ branches[] }` | none |
| `branch show` | the stored branch object | none |
| `branch save` | branch identity, status, rationale, proof fields, and optional `videoCi` focused experiment | `archive`, `proof-metadata` |
| `branch compare` | `{ comparison }`; schema is `narova.branch-comparison/1` | none |
| `branch set` | branch identity, status, and rationale | `branch-metadata` |
| `renderers list` | `{ renderers[] }` | none |
| `renderers doctor` | `{ renderer, ok, checks[] }` | none |
| `providers list` | `{ providers[], builtins[] }`, with additive provider `kind` and protocol-specific capabilities | none |
| `providers add` | `{ provider }` | `provider-registry` |
| `providers remove` | `{ name, removed }` | none |
| `providers doctor` | `{ name, hello: { protocol, provider, providerVersion }, missingEnvironment[] }` | none |
| `voices list`, `voices get` | `{ subcommand, backend, output }`; `output` is the delegated worker payload | none |
| `voice` | `{}`; namespace help for clone-sample management | none |
| `voice sample list` | `{ samples[] }` | none |
| `voice sample add` | `{ name, path }` | `voice-sample` |
| `voice sample remove` | `{ name, removed }` | none |

### Video CI judgement

`narova judge --json` inspects the existing encoded video and returns a
read-only rendered-evidence mirror. The default subject is `out/video.mp4`;
`--video <local-file>` selects another artifact. It never builds, downloads,
rewrites assertions, changes project validity, or publishes a report file.
The selected input must be one self-contained encoded media file; indirect
playlists and attached artwork are rejected, and media decoding cannot use
network protocols. Build-created `*.narova-ci.json` evidence receipts bind
shared manifest/timing/caption context to one artifact digest. Unbound optional
context is reported unavailable instead of being joined to an arbitrary video.
Receipt context sources use one shape: `path`, `bytes`, `sha256`, `available`,
optional `format`, optional `content`, and optional `reason`.
Observation outcomes do not affect exit success. Missing or undecodable video
and analysis failures are operation failures. Repair is limited to the explicit
caption candidate described below; every other repair remains unsupported.

The `judgement` object contains:

- `schema: "narova.judgement/1"`, `score: null`, `validityEffect: "none"`,
  and `mutation: "none"`;
- encoded artifact path, SHA-256, bytes, measured duration, and stream facts;
- resolved authored-config path/byte digest/effective digest and any matching
  build evidence-receipt identity;
- the deterministic bounded sampling basis, explicit local/replaceable
  perception implementation identities, and source-coverage grades;
- normalized authored assertions;
- exactly five ordered family summaries: intent/rendered correspondence,
  visual/narrative correspondence, entity continuity, attention/visual
  hierarchy, and temporal behavior; and
- ordered observations with a time range, assertion/intent, observed result,
  evidence, interpretation, confidence, principal classification, outcome,
  production-state mapping, and suggested questions.

`classification` is one of `MEASURED`, `INFERRED`, or `INTERPRETIVE`.
`outcome` is one of `ALIGNED`, `DIVERGED`, `OBSERVED`, or `UNCERTAIN`; these are
relationships to evidence, never artistic pass/fail states. Evidence records
keep their source, metric, value, unit, basis, and availability. Missing
semantic perception is explicit `UNCERTAIN`, not a guessed defect. Consumers
must not derive a universal quality score from these independent observations.

`narova judge --plan --json` retains the complete `judgement` and adds an
`interventionPlan`. It contains one option set for every assertion-linked
`DIVERGED` or `UNCERTAIN` observation. Sets preserve their time range and
production mapping, and every set includes `keep-unchanged`. Other stances
expand creative divergence, constraint inspection/alignment, or uncertainty
reduction. Options are deterministic and unranked; `selection` is null,
`mutation` is `none`, and the command invokes no branch, proof, model, network,
render, or repair work.

### Delegated caption repair candidate

`narova judge --repair --judge-assertion <id> --repair-branch <name> --json`
is the only supported repair invocation. Both value options are required. Its
only policy is `caption-sidecar-rebuild/v1`: the assertion must be mechanical
or accessibility intent with a `caption.word_count` probe; captions must be
enabled; the baseline observation must be `UNCERTAIN` only because captions are
missing or invalid; and the selected video, canonical evidence receipt, current
proof, and measured timing evidence must agree.

Narova stages the current proof snapshot, an exact video copy, derived SRT/VTT,
and a new artifact binding. It re-judges that candidate and publishes the named
proof branch only when the focused observation is `ALIGNED` and video, config,
manifest, timings, proof, snapshot source, and non-caption evidence identities
are unchanged. The current project and output are never edited. Failure removes
staging and preserves any prior destination branch.

Machine success retains the baseline `judgement` and adds a
`narova.repair-candidate/1` record with before/after observations, caption
artifact identities, protected-identity comparisons, and null approval and
selection. The result is an unapproved candidate; branch status remains the
creator's separate decision. Creative, narrative, continuity, experimental,
deliberate, brand, and factual findings cannot enter this policy. No source or
media repair, provider/model call, network work, ranking, approval, restoration,
or delivery occurs.

### Focused Video CI proof experiments

`narova branch save <name> --rationale <hypothesis> --judge-assertion <id>
--json` extends the existing proof save transaction. It requires the current
`shots --proof` receipt and a matching build-created Video CI evidence receipt,
judges the selected `--video` (default `out/video.mp4`), and preserves the
actual encoded bytes plus the one assertion-linked observation outside the
restorable authored snapshot. A missing/stale binding, unknown assertion, or
changed artifact is an operation failure and cannot replace the prior branch.

`narova branch compare <a> <b> [c] --json` accepts exactly two or three unique,
intact branches from the current project that focus on the same assertion. The
`comparison` payload retains requested order and contains `score: null`,
`ranking: null`, `selection: null`, and `mutation: "none"`, followed by each
branch's creator rationale, lifecycle status, proof/artifact identities, and
focused evidence. It does not rerun judgement, restore, render, call a model or
network, rank, recommend, select, or write state. Rejected and archived proofs
remain comparable; `branch set` is the creator's separate explicit decision.

The removed `render` spelling is a usage error and directs callers to
`compose` or `build`.

## Diagnostic code registry

Severity is one of `info`, `warning`, or `error`. Codes and meanings are stable
within `narova.result/1`.

| Code | Severity | Meaning |
|---|---|---|
| `usage.invalid` | error | Invocation rejected before or during dispatch. |
| `operation.failed` | error | The operation could not complete its own work. |
| `subject.non-pass` | error | Generic subject non-pass when no narrower code applies. |
| `check.warning` | warning | Advisory check finding. |
| `check.clip-truncation` | warning | A direct clip probes more than 50ms longer than its resolved scene; `minDur` can preserve the full clip. |
| `gate.release.captions-missing` | error | Narration exists but required caption publication evidence is absent. |
| `gate.release.asset-provenance` | error | Tracked asset provenance verification failed. |
| `gate.release.creative-brief` | error | Creative brief or required proof evidence is absent or invalid. |
| `gate.release.black-frame` | error | A scene has no visible content. |
| `gate.release.remote-dependency` | error | A scene uses a remote script, frame, or link dependency. |
| `gate.release.unsupported-html` | error | A scene uses HTML outside the deterministic supported surface. |
| `gate.release.scene-camera-missing` | error | A 3D scene has no camera. |
| `gate.release.remote-asset` | error | A remote asset reference must be localized. |
| `gate.release.walkthrough-stale` | error | A required walkthrough capture is absent or stale. |
| `gate.release.asset-location` | error | A referenced local asset is outside the project asset directory. |
| `gate.release.assets-dir-missing` | error | An asset is referenced but the project asset directory is absent. |
| `gate.release.asset-path-escape` | error | An asset path escapes the project asset directory. |
| `gate.release.asset-missing` | error | A referenced asset does not exist. |
| `gate.release.failure` | error | Generic release gate failure. |
| `audit.assets.verify` | error | A tracked asset failed hash, size, or media-kind verification. |
| `audit.proof.frames` | error | Proof frames were absent or predominantly near-black. |
| `audit.motion` | error | Encoded motion audit found frozen or black segments beyond tolerance. |
| `gate.proof.receipt` | error | Proof receipt creation or binding failed. |
| `health.doctor` | error | Core doctor found a required tool missing or unusable. |
| `health.renderer` | error | Renderer doctor found a failed local requirement. |
| `health.provider` | error | Provider doctor found a failed handshake or missing required environment. |
| `health.demo` | error | The machine was not ready to complete the demo. |

## Canonical agent loop

1. Inspect without parsing prose: `narova provenance --json`, `narova diff
   --json`, `narova plan --json` when a prior manifest exists, and
   `narova walkthrough status --json` when the project declares captures.
2. Modify only authoring sources such as `reel.config.mjs`, referenced scene
   files, the creative brief, claims ledger, and tracked local assets.
3. Validate: `narova check --json`; for release eligibility use `narova check
   --release --json`. Exit 3 means the check ran and the subject did not pass.
4. Preview: `narova preview --detach --json` for the browser renderer or
   `narova preview --json` for the browserless draft. Use the returned URL or
   video artifact; do not scrape stderr.
5. Critique when wanted: `narova critique all --json`. Craft advice is not a
   correctness gate.
6. Build: `narova build --json`, adding `--release` only after release checks
   pass. Use `artifacts` to locate videos, captions, and evidence.
7. Perceive the encoded result: `narova judge --json`. Compare observations to
   authored assertions; preserve intentional surprises and resolve uncertainty
   with direct review or a more capable explicit perceiver.
8. For a risky assertion, create a current `shots --motion --proof` receipt,
   save each rendered attempt with `branch save --judge-assertion`, and compare
   two or three with `branch compare --json`. Treat the output as evidence, not
   a ranking; keep rejected attempts as creative memory and choose explicitly.
9. Verify: inspect build artifacts, run `narova review --contact-sheet --json`
   and/or `narova shots --beats --json`, and use `--verify-motion` for the
   encoded audit. Treat exit 3 as a completed audit whose subject failed.

Every step terminates in one envelope. Free-form progress is never the final
result and is never part of the machine contract.
