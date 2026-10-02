---
name: narova-pockettts
description: >
  Use this optional Narova companion when the user requests Pocket TTS, local
  CPU speech with Pocket presets, multilingual Pocket narration, reference
  voice cloning, or saved Pocket voice states. Install and register its
  isolated runtime separately; Narova owns timing, captions and rendering.
license: Apache-2.0
metadata:
  author: ammar-hasan
  version: "1.0.0"
checksum: 4200bc9209c55c694a9e81341b175687a862f1ea63154292fb57a896e1c7312c
---

# Narova + Pocket TTS

Pocket TTS 3.3.0 runs locally on CPU in a separate Python 3.12 environment.
Its worker uses `narova-tts-provider/v1`; it adds no Pocket dependencies to
Narova core and does not change the default Piper provider.

Read [references/configuration.md](references/configuration.md) before use.
This companion and `providerFiles` are currently unreleased; use the matching
Narova source checkout until a CLI release includes them.

## Setup

1. Install Narova and select `narova` and `narova-pockettts` separately from
   `ammar-hasan/narova`. Locate this skill's directory as `<pocket-skill-dir>`.
2. Run `bash <pocket-skill-dir>/tool/setup.sh`. Set `NAROVA_SETUP_PYTHON` to a
   Python 3.12 executable if `python3.12` is unavailable. The runtime defaults
   to `${NAROVA_HOME:-~/.narova}/venv-pockettts`; `NAROVA_POCKETTTS_VENV` overrides it.
3. Register explicitly:

   ```bash
   narova providers add <pocket-skill-dir>/tool/provider.json
   narova providers doctor pockettts
   narova voices --backend pockettts
   python3 <pocket-skill-dir>/tool/run.py doctor --speaker alba
   ```

   Generic provider doctor checks the protocol/runtime; companion doctor loads
   the selected model and voice, acquiring missing files if online. Setup and
   registration do not download model weights. Previously acquired resources
   work with `NAROVA_POCKETTTS_OFFLINE=1` (or `HF_HUB_OFFLINE=1`).
4. Choose voices explicitly. Presets default to dated `english_2026-09` weights
   without cloning. Reference audio selects full cloning weights. Obtain the
   selected model's gated access and authenticate locally before cloning;
   the worker never accepts terms or silently downgrades to presets.

## Operating rules

- Run serial generation in the worker; it retains at most two model profiles
  and eight voice states per model. Every utterance copies its conditioning
  state and receives Narova's seed. Keep seed/profile fixed for repeatability
  within the same environment; do not promise cross-machine bit identity.
- Put files in `providerFiles`, controls in `providerOptions`. Core hashes
  files before considering reuse; the worker verifies those hashes again.
- Keep `HF_TOKEN` in the environment or a user-managed Hugging Face login,
  never in project options. No cloud synthesis calls occur; initial model
  acquisition may use the network. Respect model/preset/reference rights and
  obtain permission to clone a real person's voice.
- Narova owns sentence segmentation, resampling, loudness, tempo, alignment,
  captions, mixing, cache publication and video rendering. Pocket returns raw
  24 kHz mono PCM WAV without the CLI's playback tail.
- Seven released languages are supported: English, French, German, Spanish,
  Italian, Portuguese and Dutch. 24-layer configurations are previews.
  Pocket does not supply word timestamps, surrounding-text context, delivery
  instructions, markup or verified Urdu/Arabic speech support.
- Quantization is opt-in; do not promise a speed gain. Split oversized text
  instead of ignoring a token-limit error. Failed generation preserves the
  previous valid output and removes staged files.
- After changing dependencies, remove and register the provider again before
  building, so its reported runtime profile updates the cache identity.
  Unregistering leaves models, caches and the separately installed skill intact.
