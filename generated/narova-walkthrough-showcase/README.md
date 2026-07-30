# Narova product walkthrough showcase

This project drives the local Orbit fixture in
`skills/narova/tool/evals/fixtures/product-app/` and produces the shipped
`assets/narova-product-walkthrough-demo.mp4`.

The roughly 80-second showcase is one continuous browser take. It creates and
configures a project, searches for it, assigns a task, enables an automation,
and invites a teammate. Narration, karaoke captions, cursor movement, semantic
actions, and named evidence frames stay on the same measured timeline.

Run the fixture on `127.0.0.1:4173`, then:

```bash
export NAROVA_DEMO_URL=http://127.0.0.1:4173/
narova synth
narova walkthrough capture orbit
narova compose
narova shots
narova check --release
narova build --reuse
```
