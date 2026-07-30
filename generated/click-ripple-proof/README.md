# Narova click ripple — voiced proof

A short narrated and captioned proof built over Narova's real-browser
walkthrough eval capture.

```bash
narova check      # validate the config (fast)
narova synth      # create narration + timings
narova preview --detach  # persistent Studio; prints the review URL
narova build --reuse     # after approval -> out/video.mp4
```

The first build sets up its own Python venv (~/.narova/venv) and downloads a
voice model. One-time wait, not a hang. `narova doctor` checks the machine.
