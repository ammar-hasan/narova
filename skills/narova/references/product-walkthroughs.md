# Narrated product walkthroughs

Use this workflow for demo, onboarding, walkthrough, launch, and sales videos
that must show a real website or web app while narration and captions explain
what matters.

Narova owns the durable contract: URLs, semantic actions, narration anchors,
presentation, freshness hashes, captured assets, and final composition.
`agent-browser` is the first optional execution adapter. Keeping the config
driver-neutral means a future adapter can execute the same project without
rewriting the video.

## The source-first workflow

1. Declare the walkthrough and reference it from one or more scenes.
2. Run `narova walkthrough explore <id>`. It opens an isolated, named
   agent-browser session and prints the interactive accessibility snapshot.
   Use the roles, labels, visible text, and test ids you actually observe.
3. Write/refine the narration and action recipe. Run `narova check`.
4. Run `narova synth`. Capture timing comes from its measured
   `out/timings.json`, not guessed wall-clock delays.
5. Run `narova walkthrough capture <id>` (omit `<id>` to capture all declared
   walkthroughs). This is deliberately explicit: `build`, `compose`, and
   `preview` never replay browser actions.
6. Run `narova compose`, inspect `narova shots`, and watch
   `narova preview --detach`.
7. Run `narova check --release`, then `narova build --reuse`.

If narration timing or the walkthrough recipe changes, the capture is stale
and compose/build stop with the exact recapture command. A body/CSS/layout-only
revision reuses the take.

## Config

```js
export default {
  // ...
  walkthroughs: {
    onboarding: {
      // agent-browser is the default and currently the only adapter.
      driver: "agent-browser",
      url: "https://app.example.com/projects",
      title: "Example · Projects",
      viewport: { w: 1440, h: 900 },

      // Optional authentication. Prefer a named restore/profile prepared
      // during exploration; never put passwords or tokens in steps.
      restore: "example-demo",
      // profile: "Default",
      // profile: "browser-profiles/demo", // relative paths resolve from project root

      // Optional containment. agent-browser does not combine domain
      // containment with restore/profile sessions.
      // allowedDomains: ["app.example.com", "cdn.example.com"],
      // actionPolicy: "walkthrough-policy.json",

      ready: { text: "New project", timeout: 30000 },
      preRoll: 0.4,
      postRoll: 0.6,
      cursor: { enabled: true, travelMs: 280, color: "#d9ff57" },
      screenshots: true,
      mutates: true,

      steps: [
        {
          at: { scene: "create", cue: 0, offset: 0.25 },
          action: "click",
          target: { role: "button", name: "New project" },
        },
        {
          at: { scene: "create", cue: 0, offset: 1.1 },
          action: "type",
          target: { label: "Project name" },
          value: "Launch plan",
        },
        {
          at: { scene: "result", offset: 0.2 },
          action: "wait",
          text: "Project ready",
          screenshot: "project-ready",
        },
      ],
    },
  },
  scenes: [
    {
      id: "create",
      walkthrough: "onboarding",
      vo: [{ who: "a", text: "Create a project and give it a clear name." }],
      body: `<div class="eyebrow reveal">From idea to workspace</div>`,
    },
    {
      id: "result",
      walkthrough: {
        id: "onboarding",
        layout: "full",
        fit: "cover",
        opacity: 0.94,
        position: { x: 0.5, y: 0.5 },
      },
      vo: [{ who: "a", text: "The workspace is ready." }],
      body: `<div class="s-foot ok reveal">Ready before the sentence ends.</div>`,
    },
  ],
}
```

A scene may use `clip` or `walkthrough`, never both. One continuous recording
can span several scenes; Narova trims the correct source range into each scene.
Scenes between two uses may exist—the recorder keeps running through that gap,
while only referenced scenes display it.

## Narration anchors

`at` accepts:

- a number: seconds from the first scene displaying this walkthrough;
- `{ scene: "id" }`: that scene's start;
- `{ scene: "id", cue: 0 }`: the measured start of narration turn 0;
- either object plus `offset`: non-negative seconds after that anchor.

Cursor travel starts before the anchor so the click/fill/typing action lands on
the narration beat. If an early action needs more lead than `preRoll` provides,
capture stops with the minimum required value instead of silently drifting.
`capture.json` records planned time, actual dispatch time, completion time, and
drift for every step.

## Actions and locators

| Action | Fields |
|---|---|
| `click`, `hover` | `target` |
| `fill`, `type` | `target`, string `value` |
| `press` | `key`, optional `target` |
| `select` | CSS `target`, string or string-array `value` |
| `scroll` | `direction: up|down|left|right`, optional pixel `amount` |
| `wait` | exactly one of `ms`, `selector`, `text`, `url`, `load` |
| `screenshot` | optional safe `name` |

Prefer semantic locators in this order: `role` + accessible `name`, `label`,
`testid`, visible `text`, `placeholder`, then `css`. Semantic locators survive
layout and class-name changes better than coordinates or generated selectors.
Set `exact: true` only when a substring match is ambiguous.

```js
{ role: "button", name: "Create", exact: true }
{ label: "Project name" }
{ testid: "project-card" }
{ text: "Project ready" }
{ placeholder: "Search projects" }
{ css: "[data-row-id='launch']" }
```

## Auth, mutations, and secrets

- Authenticate during exploration, then use `restore` or a dedicated browser
  `profile`. Do not script password, API-key, token, payment, or recovery-code
  entry. Named profiles such as `"Default"` pass through unchanged; path-like
  relative profiles resolve from the Narova project root.
- Use disposable demo tenants and seeded fixtures. If actions create, edit,
  submit, publish, invite, purchase, or delete, set `mutates: true` and review
  the target account before running capture.
- Use `allowedDomains` for unauthenticated/public flows, or an
  `actionPolicy` file for tighter action control. Current agent-browser cannot
  combine domain containment with restore/profile sessions.
- Narova redacts typed values and URL query strings from command logs and
  capture manifests, strips embedded URL credentials defensively, and refuses
  credential-bearing walkthrough URLs. The source config and local
  `out/config.resolved.json` still contain literal scripted values, so only put
  non-secret demo data there and never publish resolved build inputs.
- Evidence screenshots and recordings show the page. Treat them like any
  screen recording: inspect before sharing.

## Capture outputs and build boundary

Each take is a source asset:

```text
assets/walkthroughs/<id>/
├── recording.webm
├── capture.json
├── states/
│   ├── 01-click.png
│   └── …
└── variants/
    └── <variant-id>/       # only when captured with --variant
        ├── recording.webm
        ├── capture.json
        └── states/
```

Freshness is bound to both measured timings and the exact successful narration
synthesis identity. If spoken text, voice, clone sample, provider options, or
timing configuration changes, run `narova synth` before recapturing; status,
compose, and release checks reject stale synthesis/capture combinations.

When top-level `assets` names a different project directory, the same
`walkthroughs/<id>/` tree lives there and still composes to
`out/hf/assets/walkthroughs/<id>/`.

`capture.json` includes driver/version, viewport, media metadata, portable
recipe/synthesis/timing hashes, recording SHA-256, scene trim map, action
drift, and evidence filenames plus SHA-256 hashes. It does not include typed
values or URL query strings.
Because agent-browser records in a fresh context, Narova repeats `ready` after
recording starts and records the setup lead separately; composition trims it
before the configured pre-roll and narration origin. With `cursor.enabled`,
Narova installs its isolated cursor immediately before each scheduled step, so
full navigations cannot remove it. Each semantic click creates a 380 ms
high-contrast ripple at the real pointer target; the ring expands, fades, and
is removed after the animation (with a 500 ms cleanup fallback). Cursor setup
uses agent-browser's `evaluate` policy action. If a restrictive `actionPolicy`
denies it, Narova warns and continues the capture without the optional cursor;
user-declared browser actions always remain policy-gated.
The portable project manifest also strips queries/fragments from source,
ready, and wait URLs; hashes preserve change detection without publishing the
original values. Action-policy file contents participate in freshness.

`narova walkthrough status [id]` reports `fresh`, `recording missing`,
`walkthrough recipe changed`, `cursor renderer changed`, `narration timings
changed`, or tampering. Cursor renderer revisions invalidate cursor-enabled
takes so an older cursor or click effect is never silently reused.
`check` warns; `check --release`, compose, preview, and build require a fresh
take. Final rendering uses PNG video-frame extraction to avoid another lossy
generation on fine UI text.

### Hook variants

Variant narration can change action timing, so captures do not overwrite one
another. Prepare each take explicitly:

```bash
narova synth
narova walkthrough capture onboarding

narova synth --variant cold-open
narova walkthrough capture onboarding --variant cold-open

narova build --variants
```

The base take remains at `walkthroughs/<id>/`; variant takes live under
`walkthroughs/<id>/variants/<variant-id>/`. A variant that uses walkthrough
scenes needs its matching take before `build --variants`.

## Current adapter trade-offs

- `agent-browser` is optional. Narration-only projects retain Narova's normal
  Node baseline; install the adapter only for walkthroughs:
  `npm install -g agent-browser && agent-browser install`.
- The adapter's native recorder is optimized for browser evidence and product
  demos. In agent-browser 0.33.x it records VP8 WebM at 10 fps. Narova renders
  the final composition at the requested output fps, but duplicated frames do
  not create source motion detail. Keep cursor travel deliberate and avoid
  fast scrolling.
- Long native-recorder sessions can vary by agent-browser patch and machine
  state. Narova probes the completed media and rejects truncated takes; use
  selective named milestone screenshots when a long flow stresses the driver.
- Capture is live-browser work and can vary when the product, account state,
  experiments, network, or data changes. Stable demo tenants, semantic
  locators, explicit ready conditions, and evidence screenshots are the
  reproducibility controls.
- Capturing an Electron app is supported by agent-browser itself, but Narova's
  first contract accepts URL sources. Treat native/Electron source declaration
  as future adapter work rather than hiding it in CSS selectors.

## Tests and eval

Unit/integration coverage lives in `tool/test/walkthrough.test.js`. The real
adapter eval serves an interactive product fixture, records semantic actions,
checks drift/hashes/evidence, composes window + full layouts, renders QA
snapshots and a 30 fps MP4, verifies audio/dimensions/duration, and rejects
long black frames:

```bash
npm run eval:walkthrough
NAROVA_EVAL_KEEP=1 npm run eval:walkthrough
```
