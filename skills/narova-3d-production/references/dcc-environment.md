# DCC environment and bounded operations

Use this reference only after the chosen authored form needs Blender-specific
scene inspection, proof/final-shot rendering, or editable `.blend` preservation.
Blender remains a separately installed optional target; this companion does not
make it a core renderer, hosted video provider, universal scene graph, or second
production lifecycle.

## Assess before committing

Create a project-contained request with schema `narova.3d-dcc-operation/1`, then
run:

```sh
node tools/blender-dcc.js /absolute/project assess-request.json assess-receipt.json
```

The versioned `narova.3d-operation-result/1` receipt separates target
availability, measured/declared/estimated/unknown machine and workload facts,
and per-operation suitability. Every decision is exactly `suitable`,
`unsuitable`, or `unknown`; unknown is not satisfied. Check the intended
dimensions, frame bounds, engine, deadline/resource budget, storage, memory,
CPU, and relevant GPU/backend before expensive work.

The target resolves in this order: explicit request override,
`NAROVA_BLENDER`, `PATH`, then documented common local application locations.
The adapter never downloads, installs, or selects a remote executor. Missing
Blender returns `needs-user-action`; any later managed-install workflow requires
its own scoped authority and verified acquisition design.

## Invoke only the supported operation

- `inspect-scene` reads structured metadata from the exact selected source
  without changing it. Optional explicit `workload.sampleFrames` and
  `inspection.objects` expose bounded shot-local camera, render enablement,
  light, color-management, world, and named-object facts.
- `render-proof-still` renders one reduced-resolution frame.
- `render-proof-sequence` renders either one contiguous interval of at most ten
  frames or at most ten explicit unique increasing `workload.sampleFrames`.
  Either proof operation may explicitly request bounded decoded-PNG facts with
  `evidence: { "pixelMeasurements": true }`.
- `render-final-shot` renders the declared bounded frame range and dimensions.
- `export` preserves editable `.blend` source.

Scene assembly/modification, arbitrary simulation, and managed installation are
explicitly unsupported in this adapter. Unsupported work stops before target
resolution with one next action; do not infer that prose or a receipt performed
the missing operation.

For sparse proof or inspection work, the caller chooses every sample frame. Do
not combine `sampleFrames` with `startFrame`/`endFrame`. Sparse samples expose
only their selected instants; they do not establish motion between samples,
useful framing, completeness, or smoothness. Inspect the actual shot `.blend`
that will render when shot-specific visibility or camera state differs from a
master source.

For every present requested object, sampled inspection also reports its coarse
normalized camera projection when an active camera and evaluated bounds make
that computable. The projection names its bottom-left origin, projectable and
behind-camera bound-corner counts, unclipped bounds, `[0,1]` frame intersection,
and projected bounds centre. It is not an occlusion test, pixel mask,
silhouette, screen-coverage measurement, recognition result, or framing
judgement; unavailable cases retain a literal reason.

Example shot inspection:

```json
{
  "schema": "narova.3d-dcc-operation/1",
  "correlationId": "inspect-shot-03",
  "operation": "inspect-scene",
  "input": "blend/shot-03.blend",
  "workload": { "sampleFrames": [1, 75, 150, 225, 300] },
  "inspection": { "objects": ["Camera", "PrincipalSubject"] }
}
```

Example sparse proof:

```json
{
  "schema": "narova.3d-dcc-operation/1",
  "correlationId": "proof-shot-03",
  "operation": "render-proof-sequence",
  "input": "blend/shot-03.blend",
  "output": "production/proofs/shot-03",
  "evidence": { "pixelMeasurements": true },
  "workload": {
    "width": 640,
    "height": 360,
    "sampleFrames": [1, 75, 150, 225, 300],
    "fps": 30,
    "engine": "BLENDER_EEVEE",
    "timeoutMs": 120000
  }
}
```

Requested pixel facts are calculated from the exact private staged PNG bytes
before atomic publication. The receipt names each output, repeats the exact
source PNG SHA-256 for same-receipt binding, and records decoded
8-bit RGB channels, Rec.709 luma range/mean/p05/p50/p95, HSV saturation
range/mean/p05/p50/p95, alpha coverage, and the fractions at the explicitly
recorded `16/255` near-dark and `235/255` near-bright thresholds. The profile is
limited to non-interlaced 8-bit RGB/RGBA PNG and at most 20,000,000 pixels per
request. Unsupported or oversized measurement fails before replacing prior
proof output. These facts do not label any value correct, exposed, colourful,
readable, visible, attractive, or in need of correction; the caller owns what
the current work means and whether to change it. There is no target band or
recommendation.

Input, output, request, and receipt paths stay inside the project. Lexical and
symbolic-link escapes are rejected. Target work is bounded by a timeout,
machine-readable liveness events, captured-output limits, declared secret
redaction, and owned-process cleanup. Rendered/exported artifacts stage
privately, validate for expected non-empty file/frame shape, and replace the
destination atomically. A failure leaves a previous valid destination intact.

## Choose alternatives without surrendering intent

Missing, unsuitable, or unsupported work may return zero or more unranked
caller-order routes. Each route discloses retained, lost, and unknown capability
plus known editability, physical/spatial/visual fidelity, time, cost, privacy,
and reversibility. A simple Three.js route is viable only when it preserves the
declared intent; the adapter does not select it. When no route preserves a
required subject, relationship, gravity/support/collision/constraint behavior,
or editable deliverable, use the explicit stop route before production.

After validation, hand the committed local asset, editable source, and receipt
to ordinary Narova. Do not claim cross-machine pixel or file equality without
target-specific evidence.

## Encoding committed frame sequences

The companion exposes `tools/frame-sequence-to-mp4.js` for a committed PNG
frame directory from `render-final-shot` or another source. This is not a
Blender operation: it uses FFmpeg/FFprobe and requires no DCC target. The agent
explicitly supplies every creative encoding choice. The operation validates
the input and encoded result, publishes atomically, and records measured facts;
it does not select or recommend a visual treatment. See
[frame encoding reference](frame-encoding.md) for the full request schema and
interpolation mode descriptions.
