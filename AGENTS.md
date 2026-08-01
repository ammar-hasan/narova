# narova

Prompt-to-video CLI. Turns a scene script (`reel.config.mjs`) into an MP4 with
local TTS, word-level captions, and speech-timed visuals rendered through
HyperFrames. The full CLI ships at `skills/narova/tool/bin/narova.js`.

## Key gotchas

- `data-cue="k"` counts turns from 0. `data-cue="0"` = the first turn.
- No CSS animation/infinite/hover/transition in theme.css — the renderer
  jumps between frames. Motion comes from `reveal`/`data-cue` + `data-*` animators.
- SVG ids are namespaced per scene at compose. Style with classes, never `#id` in theme.css.
- Never edit `out/` or `out/hf/` — every compose regenerates them.
- Agent shells don't persist env vars — spell out `node <skill-dir>/tool/bin/narova.js` every call.
- Post-processing renders with ffmpeg concat need `setsar=1` in every video chain.
