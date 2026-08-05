# Project choreography

The built-in animators (`reveal`/`cue`, `data-grow`, `data-draw`, `data-count`,
`data-mark`, `data-drift`) all express one idea: elements appearing in sync with
the voice. When a scene needs something to physically *happen* — a tile falling
off a bar, a camera dip, a palette shift over time — declare a choreography
file:

```js
export default {
  // ...
  choreography: "choreo.js",   // optional, path relative to the config
}
```

The file is read at compose time and inlined into the composition document
immediately after the built-in animators are registered. It is local and
inlined, never fetched — the same trust model as `theme.css`.

## What is in scope

| Name | What it is |
|---|---|
| `tl` | the paused GSAP timeline the renderer seeks |
| `DATA` | `{ total, scenes: [{ id, start, dur, turns, transition }] }` |
| `gsap` | the GSAP global |
| `cueTime(sc, el, i)` | the same turn resolution the built-in animators use |

## Anchor to turns, never to wall-clock

Narration length changes every time the script changes, so absolute seconds go
stale immediately. Resolve the scene and offset from its turns:

```js
var sc = DATA.scenes.find(function (s) { return s.id === "overflow"; });
var T = function (k, d) { return sc.start + sc.turns[k] + (d || 0); };

tl.to("#scene-overflow .evict", { y: 1050, rotation: -80, scale: 1.22,
  duration: 1.7, ease: "power2.in" }, T(1, 1.45));
```

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
`transformOrigin` times out the sub-composition timeline script
(`sub_timeline_script_failure`), and the whole composition renders static — no
choreography, and no captions either. Declare the pivot statically in
`theme.css` instead:

```css
.evict { transform-origin: 30% 100%; }
```

This is not specific to choreography: the built-in `data-grow` animator sets
`transformOrigin: 'left center'` and reproduces the same failure on its own.

## What `check` enforces

- the `choreography` path must exist (`resolveConfig` throws if it does not)
- references to `Date`, `Math.random`, `requestAnimationFrame`, `setTimeout`,
  or `fetch` warn
- a file over 32KB warns — choreography that large is usually logic that
  belongs in the tool
