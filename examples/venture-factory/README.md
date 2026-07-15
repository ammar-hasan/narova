# venture-factory (example project)

A complete 14-scene, two-host explainer written in narova's scene-script format.
It's the reference content for the toolkit — a good template to copy for your own reel.

## Run it

From this directory:

```bash
narova build      # render + synth + capture + assemble -> out/video.mp4 + out/player.html
narova serve      # range-capable server for out/ (player, mp4, landing page)
```

Faster iteration while writing scenes:

```bash
narova render     # scenes -> out/player.html, out/record.html, out/narration.json (no audio)
narova build --backend piper   # default local TTS; add --backend xtts for higher quality
```

Voices need setup first — from the repo root run `scripts/setup.sh` (add `--xtts` for the
higher-quality backend), then `narova doctor` to confirm ffmpeg, Chrome, and the venv are ready.

## Files

| File | What it is |
|------|-----------|
| `reel.config.mjs` | The scene script: `title`, `size`, `voices`, `theme`, `timing`, `scenes` |
| `theme.css` | Scene-layout classes the bodies reference, plus the color tokens |

## How the script is built

- `caption` is the short line shown on screen; `vo` is the two-host dialogue that's spoken.
  They differ on purpose — big word-synced captions read better than the full transcript.
- `vo` turns alternate between host `a` (male) and host `b` (female).
- Body elements with `data-cue="k"` pop in when the voice reaches turn `k`; un-cued
  elements reveal on scene entry.
