# Choreography: local by default, global when intentional

The built-in animators (`reveal`/`cue`, `data-grow`, `data-draw`, `data-count`,
`data-mark`, `data-drift`) all express one idea: elements appearing in sync with
the voice. When one scene needs something to physically *happen* — a tile
falling off a bar, a camera dip, a palette shift over time — attach the file to
that scene:

```js
export default {
  scenes: [{
    id: "overflow",
    // body, vo, ...
    choreographyFile: "overflow.choreo.js",
  }],
}
```

Scene-local choreography is rebased with its scene during isolated browser
rendering and belongs to that scene's cache identity. A later change to this
scene can therefore re-render its span while unchanged sibling scenes remain
eligible for reuse.

Locality is an authoring promise, not a sandbox. In a full composition a scene
file can technically see every scene in `DATA`; keep its reads, selectors, and
effects within the owning scene so the isolated render has the same meaning.

Use top-level project choreography when the behavior genuinely reads,
schedules, selects, or coordinates across scenes:

```js
export default {
  choreography: "cross-scene.choreo.js",
  scenes: [/* ... */],
}
```

Project choreography can inspect the full composition `DATA` and address any
scene. Because an isolated browser renderer cannot prove that arbitrary author
JavaScript is local, this form conservatively uses whole-video reuse. That is a
performance consequence, not a creative or validity judgement: the global
escape hatch remains unrestricted. Do not misrepresent genuinely global work
as local merely to gain speed, and do not move local work global without an
intentional cross-scene reason.

Both forms are read at compose time and inlined immediately after the built-in
animators are registered. They are local files, never fetched — the same trust
model as `theme.css`.

`narova check`, compose, shots, and build compile the exact browser script
shape without executing it. A syntax error stops before rendering and names
the logical source plus its line and column when the parser provides them.
Project and scene choreography plus JavaScript imports remain classic-script
code; `scene.scriptFile` retains its existing function body. Narova does not
rewrite, sandbox, infer locality, size-gate, or judge selectors and programming
style. This preflight is only the confidence boundary between executable and
non-executable code.

## What is in scope

| Name | What it is |
|---|---|
| `tl` | the paused GSAP timeline the renderer seeks |
| `DATA` | `{ total, scenes: [{ id, start, dur, turns, sentences, transition }] }`; all scenes in a full composition, only the rebased owning scene during an isolated scene render |
| `gsap` | the GSAP global |
| `cueTime(sc, el, i)` | the same turn resolution the built-in animators use |
| `sentenceCue(sc, sentenceIndex)` | a copied resolved sentence timing span |
| `wordCue(sc, sentenceIndex, wordIndex)` | a copied resolved word timing span |

## Anchor to turns, never to wall-clock

Narration length changes every time the script changes, so absolute seconds go
stale immediately. Resolve the scene and offset from its turns:

```js
var sc = DATA.scenes.find(function (s) { return s.id === "overflow"; });
var T = function (k, d) { return sc.start + sc.turns[k] + (d || 0); };

tl.to("#scene-overflow .evict", { y: 1050, rotation: -80, scale: 1.22,
  duration: 1.7, ease: "power2.in" }, T(1, 1.45));
```

When a visual event must follow a particular resolved sentence or word rather
than a whole voice turn, address the timing evidence by index:

```js
var sc = DATA.scenes.find(function (s) { return s.id === "assembly"; });
var phrase = sentenceCue(sc, 2);
var adjective = wordCue(sc, 2, 1);

tl.set("#scene-assembly .first-link", { opacity: 1 }, phrase.start);
tl.to("#scene-assembly .second-link", { x: 0, duration: 0.5 }, adjective.start);
tl.set("#scene-assembly .compound", { opacity: 1 }, adjective.end + 0.1);
```

Both results contain millisecond-rounded `start`, `end`, `duration`, `scene`,
and `sentenceIndex`; a word result also contains `wordIndex`, `token`, and
`speaker`. Full renders use global composition seconds. An isolated scene uses
the equivalent scene-local seconds, so the same choreography retains its
internal timing. These lookups remain available when visible captions are off.

Indices are deliberate: Narova does not search or normalize text, decide which
word matters, infer a semantic beat, bind an element, or choose an animation.
Missing, invalid, or untimed evidence throws with the scene and indices instead
of silently returning scene entry. Resolve the correct index from the current
timing artifact, then choose the motion and any offset yourself.

The values are called *resolved timing*. They may be estimated, supplied, or
acoustically aligned according to the project's existing timing source. The
lookup does not upgrade that evidence or claim acoustic alignment.

Register everything at absolute times on `tl`. Do not create your own timeline,
and do not use `setTimeout`, `requestAnimationFrame`, `Date`, `Math.random`, or
`fetch` — frames are rendered by seeking a paused timeline, so anything that
reads wall-clock time or schedules its own work will not reproduce. `check`
warns when it sees these.

## Select by class, scoped to the scene

Ids inside a scene body are namespaced to `<sceneId>--<id>` at compose time.
Select by class under `#scene-<id>` instead:

```js
var S = function (sel) { return "#scene-overflow " + sel; };
tl.to(S(".evict"), { rotation: -14, duration: 0.5 }, T(1, 0.95));
```

## Animate transforms, opacity, and class sets

Layout properties (`width`, `top`, `margin`) are slow under seek and can hit
renderer edge cases. Prefer `x`/`y`/`rotation`/`scale`, `opacity`, and
`className` sets.

## Two things that will bite you

**Pre-seed identity transforms.** An element GSAP has touched computes
`transform: matrix(1,0,0,1,0,0)`; one it has never touched computes
`transform: none`. They are geometrically identical but rasterize with
different antialiasing, so a frame's pixels depend on which frames were
rendered before it. Renderers seek out of order, so seed every element the
timeline will ever transform:

```js
gsap.set([S(".bar"), S(".seg"), S(".cam")], { x: 0, y: 0, rotation: 0, scale: 1 });
```

Without this, a shuffled-seek pass and a sequential pass differ by a few dozen
pixels on moving text edges. With it, they are identical.

**Do not tween `transformOrigin`.** Under `hyperframes@0.7.64` a tween carrying
`transformOrigin` on the `fromTo` or `to` side times out the sub-composition
timeline script (`sub_timeline_script_failure`), and the whole composition
renders static — no choreography, and no captions either. The built-in
`data-grow` animator now pre-seeds `transformOrigin` via a `tl.set()` before
tweening `scaleX` alone, which avoids this failure. For custom choreography
that needs a transform origin, declare it statically in `theme.css` or use
a `tl.set()` before the tween:

```css
.evict { transform-origin: 30% 100%; }
```

## What `check` enforces

- every declared `choreography`/`choreographyFile` path must exist
- every emitted choreography, JavaScript import, scene script, and raw Three.js
  module must compile in its actual browser context; syntax failures name the
  source and fail ordinary check as well as render paths
- references to `Date`, `Math.random`, `requestAnimationFrame`, `setTimeout`,
  or `fetch` warn
- a top-level `choreography` file over 32KB warns — choreography that large is
  usually logic that belongs in the tool
