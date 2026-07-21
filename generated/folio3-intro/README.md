# My Reel

A narova project. Edit `reel.config.mjs`, then:

```bash
narova check      # validate the config (fast)
narova synth      # create narration + timings
narova preview --detach  # persistent Studio; prints the review URL
narova build --reuse     # after approval -> out/video.mp4
```

The first build sets up its own Python venv (~/.narova/venv) and downloads a
voice model. One-time wait, not a hang. `narova doctor` checks the machine.
