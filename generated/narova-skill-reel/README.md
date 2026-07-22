# Narova skill reel

Source project for the 30-second, single-narrator, 16:9 Narova overview embedded in the repository root README.

```bash
node ../../skills/narova/tool/bin/narova.js check
node ../../skills/narova/tool/bin/narova.js synth
node ../../skills/narova/tool/bin/narova.js compose
node ../../skills/narova/tool/bin/narova.js shots
node ../../skills/narova/tool/bin/narova.js preview --detach
node ../../skills/narova/tool/bin/narova.js build --reuse
```

Editable source lives in `reel.config.mjs`, `theme.css`, and `claims.md`. Generated build output stays in ignored `out/`.
