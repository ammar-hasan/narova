---
name: narova-3d-production
description: >
  Use this optional Narova companion when creating, directing, or repairing an
  authored 3D video whose principal subjects, world, asset path, spatial design,
  materials, lighting, camera, interaction, or inspection need specialist
  judgment. Use for abstract or realistic 3D, recognizable or articulated
  subjects, layered environments, mechanisms, camera-led scenes, and mixed
  2D/3D where authored 3D has an intentional role. Do not use it merely because
  a request says animation, cinematic, explainer, product video, Three.js, or
  render; ordinary 2D motion, browser walkthroughs, AI-generated clips, and
  direct render commands remain core Narova work.
license: Apache-2.0
metadata:
  author: ammar-hasan
  version: "0.6.0"
checksum: cad4c393fc11fb51c22fc16a70529f8f8a79fe094a855456098d3f627db8925a
---

# Narova 3D Production

Add a small expert lens to authored 3D work. Keep the `narova` skill in charge
of project authoring, assets, canonical time, rendering, review, release, and
delivery. This companion can optionally bake bounded local rigid-body motion;
it adds no core dependency, renderer, provider, hosted service, universal scene
graph, or second production lifecycle.

## Direct lightly

1. **Give 3D a job.** State what authored 3D lets the viewer perceive that a
   simpler or different medium would not. If it adds no material value, use the
   better Narova path and stop using this companion.
2. **Choose what the audience will receive.** Decide what the viewer should
   notice, understand, or feel, then choose intentional final forms for the
   principal subjects and world. A primitive, model, captured or generated
   element, and mixed composite are all valid. Do not silently turn a blockout
   or cheapest available shape into the final representation.
3. **Route the material risk.** Choose at most the one or two areas most likely
   to weaken the idea and read only their references:
   - read [subjects and assets](references/subjects-and-assets.md) when final
     representation, acquisition/generation, model readiness, rigging,
     animation, rights, or a missing production capability matters;
   - read [scene direction](references/scene-direction.md) when space,
     appearance, staging, camera, visibility, interaction, or compositing is
     uncertain; and
   - read [physical reasoning](references/physical-reasoning.md) when support,
     locomotion, collision, constraints, gravity, coupled motion, or scientific
     accuracy is a material risk; and
   - read [inspection](references/inspection.md) when the visual premise,
     movement, structured state, evidence limits, or a stop decision matters.
   A straightforward scene may need none. Do not perform a full-manual pass.
4. **Prove before scaling.** For risky work, show one delivery-scale visual
   target without its rationale. If motion or interaction carries the idea,
   next show a short sample using that accepted representation. Expand only a
   premise that reads from the artifact itself.
5. **Finish through core Narova.** Use available specialist capabilities only
   when the chosen form needs them, then hand assets, deterministic motion,
   rendering, review, release, and delivery to the ordinary Narova lifecycle.

## Bake rigid-body motion only when it helps

Prefer authored motion when timing, exaggeration, or expressive control carries
the idea. When gravity, support, collision, stacking, or a rigid constraint
carries the idea, install this companion's local tool dependency and bake an
explicit project-local recipe:

```sh
cd skills/narova-3d-production && npm ci --ignore-scripts
node tools/bake-rigid-body.js /absolute/project physics.json physics-bake.json
```

Sample the bake with `tools/sample-bake.js` at canonical local scene time; do
not advance a solver while rendering frames. The recipe and bake are execution
inputs, never `sceneState` evidence. The built-in baker is limited to bounded
rigid bodies and simple constraints. Route cloth, fluids, fracture, robotics,
or engineering/scientific verification to an appropriate specialist.

## Use an optional DCC target only when the chosen form needs it

For Blender-specific work, read [DCC environment and operations](references/dcc-environment.md).
Assess the installed target and workload; availability alone is not suitability.
Never install or transmit implicitly, pretend unsupported breadth is available,
or silently degrade a required subject, relationship, behavior, or deliverable.

Inspect the exact shot source that will render. Sparse frames expose shot-local
program facts. Explicit proof requests can expose decoded-pixel distributions
and coarse requested-object camera projection. Narova does not choose the frames,
set target bands, infer what the audience sees, declare completeness or
smoothness, or recommend a creative correction.

A committed DCC result enters ordinary Narova as an authored local media asset;
core still owns time, audio, composition, proof, release, and delivery. No house
template, style, camera, realism, or prior-project memory is imposed.

## Understand and encode a committed frame sequence

After an agent commits frames, the companion can encode a bounded MP4. It
explains observable effects without ranking or selecting; the agent supplies
every creative encoding value.

Interpolation modes and their observable consequences:

| Mode | What FFmpeg does | Observable effect |
|------|------------------|-------------------|
| `hold` | Holds, drops, or duplicates source frames to match output FPS | No motion-estimated frames; motion may appear stepped when rates differ |
| `blend` | Creates intermediate frames by blending adjacent source frames | Motion may appear smoother; blur or ghosting can appear |
| `motion-compensated` | Synthesizes intermediate frames from estimated motion | Motion may appear smoother; distortion can appear at occlusions, fast motion, or scene changes |

```sh
node tools/frame-sequence-to-mp4.js /absolute/project encode-request.json encode-receipt.json
```

Read [frame encoding reference](references/frame-encoding.md) for the complete
request, neutral consequence descriptions, validation, and receipt format.

## Keep confidence honest

Connect decisions to what was rendered or otherwise inspected. Keep factual
checks separate from perceptual judgment. Do not give the perceptual reviewer
the author's plan, symbol mapping, or run report. Treat an automated visual
critic as advice until it has agreed with independent owner judgments on this
kind of work. Render success does not prove recognition, collision, physical
simulation, target visibility, taste, or hidden scene state. Non-black frames,
motion, clearance, sightlines, render-enabled state, camera deltas, projected
bounds, decoded-pixel distributions, and sparse samples prove only their named
properties; [inspection](references/inspection.md) owns broader claims.

If the chosen form needs sourcing, generation, refinement, rigging, animation,
simulation, or inspection that no available capability supplies, change the
form with the user, name the gap, or stop. Never pretend this skill's prose
performed that operation.

## Preserve creative range

Do not default the work to a palette, realism level, low-poly language, material
system, lighting rig, camera move, shot list, density, pacing, duration,
narration, caption style, transition, platform, or aspect ratio. Minimal and
rich scenes, graphic abstraction and articulated realism are all valid when
intentional. Use hard constraints only where user intent, compatibility,
evidence, or visible correctness would otherwise break.

Do not persist or retrieve another project's concept, prompt, subjects, assets, world,
palette, camera, style, or owner disposition. Let agents grow through current-task reasoning, executable consequences, and bounded proofs without anchoring the next work to a sibling solution.
