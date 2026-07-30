# Claims ledger

## Real browser session

- Claim: Every product screen, click, and field in the showcase comes from one real browser capture.
- Evidence: `assets/walkthroughs/orbit/recording.webm` and its content-addressed `capture.json`.

## Narration-timed actions

- Claim: The browser actions are timed to the narration.
- Evidence: The walkthrough recipe anchors each action to a scene and measured voiceover cue; `capture.json` records resolved times and action drift.

## Semantic controls

- Claim: The demo targets semantic product controls.
- Evidence: `reel.config.mjs` uses accessible roles and labels for clicks and text entry, with CSS identifiers used only where the current select adapter requires them.

## Step evidence

- Claim: Important steps have visual evidence.
- Evidence: Named PNGs under `assets/walkthroughs/orbit/states/` are captured during the browser take and hashed in `capture.json`.
