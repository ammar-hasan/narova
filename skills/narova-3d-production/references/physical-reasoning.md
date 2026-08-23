# Physical reasoning

Read this only when spatial motion, contact, support, a mechanism, or an
accuracy claim is a material risk. It helps decide what must be programmatic;
it does not prescribe a visual idea.

## Protect the premise first

Name the principal subjects and the relationship the viewer must receive. A
placeholder does not become a dog, person, vehicle, tool, or building because
the config labels it that way. If a final subject or relationship is missing,
acquire or make a suitable form, agree on an intentional abstraction, or stop.
Never assign one unrelated substitute to distinct principal roles and continue
as if the premise survived.

For relevant 3D work, establish only the facts the shot exposes:

- world axes, metric scale, support surfaces, clearance, and useful bounds;
- which subjects are fixed, dynamic, kinematic, articulated, or purely visual;
- which visual geometry needs a simpler collision proxy;
- which body owns root motion and how feet, wheels, or supports stay grounded;
  and
- whether the decisive action remains visible from the chosen camera.

## Describe interaction as a change

Recover the smallest causal chain the audience needs to see:

```text
initial state -> cause or intent -> approach/path -> contact or constraint
              -> response -> visibly changed state
```

Skip irrelevant links, but do not replace subject motion with camera motion or
call two nearby objects an interaction. For a reunion, separation must close
through approach and recognition/contact. For a strike, response follows
impact. For a bridge, loads precede deformation or reaction. For a mechanism,
coupled parts derive from one relationship rather than independent keyframes.

## Choose the execution level

Use the least complex honest route:

1. **Authored kinematics** for deliberate paths, performances, stylised
   anticipation, poses, or exaggerated motion where the author should control
   every beat. Check grounding and contact explicitly.
2. **Bounded rigid-body bake** when gravity, ballistic response, collision,
   stacking, support, or a fixed/revolute/prismatic constraint carries the
   meaning. Use the companion tool, then sample its baked state at canonical
   time. Do not run the solver inside the renderer.
3. **Specialist solver** for cloth, fluids, soft bodies, fracture, robotics,
   FEM/CFD, engineering verification, or any domain whose validity exceeds the
   built-in model. Record the solver's assumptions and claim only what it can
   establish.

Simulation is not automatically more realistic or more creative. It should
remove brittle mathematics from the authoring loop while leaving concept,
representation, exaggeration, staging, camera, and selection open.

## Author a bounded bake

Use metres, kilograms, seconds, a fixed step, and sample times aligned to that
step. Keep collision proxies simple even when visible geometry is rich. A
minimal recipe looks like:

```json
{
  "schema": "narova.3d-rigid-body/1",
  "units": "m-kg-s",
  "step": 0.008333333333333333,
  "duration": 3,
  "sampleRate": 30,
  "gravity": [0, -9.81, 0],
  "bodies": [
    { "id": "ground", "type": "fixed", "shape": { "kind": "box", "halfExtents": [4, 0.25, 4] }, "position": [0, -0.25, 0] },
    { "id": "subject", "type": "dynamic", "shape": { "kind": "sphere", "radius": 0.5 }, "position": [0, 3, 0] }
  ],
  "constraints": [],
  "actions": []
}
```

Bodies may be `fixed`, `dynamic`, or position-based `kinematic`; bounded shapes
are `box`, `sphere`, and `capsule`. Optional properties cover initial rotation/
velocities, density, friction, restitution, damping, and sleep. Supported
constraints are `fixed`, `revolute`, and `prismatic`, with two body IDs and
local anchors; the latter two add an axis and optional limits. Step-aligned
actions are `impulse`, `torqueImpulse`, or `kinematicPosition`.

The baker writes canonical JSON with engine and input identity, sampled body
state, contacts, and constraint state. In project author code, load that bake
before composition and use `sampleAt(bake, localTime)` from
`tools/sample-bake.js`, or translate its samples into scene-local timeline
sets. Do not parse or simulate it afresh per rendered frame.

## Keep execution and evidence separate

A simulation recipe and its baked transforms cause authored motion and are
execution inputs. `sceneState` is advisory evidence and must not drive the
render. If a final artifact needs a factual assertion, derive and attach an
appropriate task-specific observation separately; do not rename the bake as
evidence or claim it caused final pixels merely because both files exist.

Programmatic state should answer transforms, contacts, support, constraints,
and event ordering. Use artifact inspection for recognition, readability,
composition, emotion, and whether state reached the visible result. A
vision-capable critic may advise on those perceptual questions, but should not
replace available solver facts.

## Prove before the full scene

For a risky interaction, first render a short delivery-scale proof with the
chosen final subject form and decisive movement. Test a valid case and one
deliberately broken relation. Expand only when the artifact communicates the
premise and the relevant programmatic relationship holds. Neither result
proves taste; the creator still decides whether the work is worth continuing.
