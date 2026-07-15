# RESEARCH — Landscape & Positioning

Scope: where a "scene-script → narrated, word-synced, captioned explainer video"
tool sits among existing video engines, which local/OSS neural TTS backends to
support, and forced-alignment options for exact word timing. Sources cited inline.

---

## 1. Video engine landscape

We generate two artifacts from one declarative scene script: a self-contained
interactive HTML player and a pixel-identical MP4. Narration and word-level caption
sync are first-class and automatic. Below is how the real alternatives handle the
*narrated word-synced explainer-from-a-script* job specifically.

| Tool | What it is | Strengths | Where it falls short for our job |
|------|-----------|-----------|----------------------------------|
| **Remotion** | React framework; videos are components rendered to MP4/WebM via headless Chrome | Mature, huge ecosystem, `@remotion/player`, precise frame control, server rendering | You write React, not plain HTML+data. TTS + word-sync + reactive reveals are all DIY (you wire ElevenLabs + an aligner yourself). **License is not OSI open source** — a paid Company License is required at scale; the "Automators" tier (prompt-to-video / automated pipelines / embedding the Player) is **$0.01/render, $100/mo minimum** ([license](https://www.remotion.dev/docs/license), [pricing](https://www.remotion.dev/docs/license/pricing)) |
| **Revideo** | Open-source (MIT) fork of Motion Canvas; adds a `renderVideo()` server API + templates | Truly OSS, canvas-based, built for batch/automation pipelines ([pkgpulse](https://www.pkgpulse.com/guides/remotion-vs-motion-canvas-vs-revideo-programmatic-video-2026)) | Imperative TypeScript animation API, not a script. No built-in narration/word-sync; you assemble audio + timing yourself |
| **Motion Canvas** | TypeScript generator animation engine (originally for the Motion Canvas author's own videos) | Excellent for hand-tuned procedural motion, good editor | Not automation-first (Revideo exists precisely to fix that). No narration/caption sync story |
| **manim** (+ **manim-voiceover**) | Python math-animation engine; the voiceover plugin adds TTS and **per-word timing to trigger animations** ([docs](https://voiceover.manim.community/en/stable/index.html)) | Closest philosophical cousin — narration drives animation, multi-TTS backends, Whisper for word timing | Python-only, math/diagram aesthetic, steep API, render-only (no interactive HTML player). Heavy for a talking-head explainer |
| **Slidev / reveal.js** | Markdown/HTML presentation frameworks | Author in Markdown/HTML (like us), self-contained web output | Slides, not video: no narration, no word-sync, no MP4 pipeline. Export-to-video is a bolt-on screen recording |
| **ffmpeg slideshow** | Stitch images/clips + an audio track with ffmpeg filters | Zero dependencies, total control, what our `assemble` stage uses under the hood | Not authoring — it's plumbing. No layout, no captions, no sync; you hand it pre-timed frames |
| **"AI video" tools** (Pika, Runway, HeyGen, Synthesia, invideo) | Prompt/script → generated or avatar video, cloud SaaS | Fast, no code, good for talking-head/marketing | Closed, per-seat/credit pricing, non-deterministic, no source-controlled scene script, no self-hosting, weak precise-control story |

**The gap we fill:** every code-first engine (Remotion, Revideo, Motion Canvas)
treats narration + word-synced captions + voice-reactive reveals as *your problem*.
manim-voiceover is the only one that makes narration drive timing — but it's
Python/math-only and render-only. Nobody ships **plain-HTML scenes + automatic
neural narration + word-level caption sync + an interactive player AND a matching
MP4** as one tool. That's the whitespace.

---

## 2. Neural TTS backends (local/OSS + cloud)

Ranked on the axes that matter for us: quality, speed, license (commercial use),
and ease of local install on Apple Silicon (MPS/CPU).

| Backend | License | Quality | Speed (local) | Apple Silicon install | Notes |
|---------|---------|---------|---------------|----------------------|-------|
| **Piper** | ⚠️ **GPL-3.0** now — the MIT `rhasspy/piper` was archived Oct 2025; active dev is `OHF-Voice/piper1-gpl` ([license](https://github.com/rhasspy/piper/blob/master/LICENSE.md), [promptquorum](https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts)) | Good, not studio | **~10–15× realtime on CPU**, sub-50ms latency ([localaimaster](https://localaimaster.com/blog/piper-tts-setup-guide)) | Trivial — ONNX runtime, 20–200MB voices, no torch | Zero-config default. GPL means shell-out (subprocess), don't link |
| **Kokoro-82M** | ✅ **Apache-2.0** | Excellent for size — hit #1 on TTS Arena at v1.0 launch (Jan 2025), beats far larger models ([HF](https://huggingface.co/hexgrad/Kokoro-82M), [pulse](https://arifsolmaz.github.io/repo/2026/01/28/kokoro-82m/)) | Realtime-or-faster on CPU; 327MB weights, 54 voices/8 langs | Easy — small, CPU-friendly, MPS works | **Best quality-per-constraint + clean license.** Strong Piper upgrade |
| **Chatterbox** (Resemble AI) | ✅ **MIT** | Very high — 63.75% blind-preferred over ElevenLabs; emotion control, zero-shot clone ([GitHub](https://github.com/resemble-ai/chatterbox)) | Slower (torch); Turbo variant targets fastest OSS inference | Moderate — torch/transformers stack, MPS viable | Built-in PerTh watermark. Best *permissive* high-end option |
| **XTTS-v2** (Coqui) | ❌ **CPML — non-commercial only**, and Coqui shut down Jan 2024 so **no one can sell you a commercial license** ([issue](https://github.com/coqui-ai/TTS/issues/3490)). Code (MPL-2.0) is fine; the *weights* are the trap | Excellent, 58 speakers, cloning | Slow, ~1.9GB, needs the transformers shim | Heavy — torch + torchcodec; works on MPS/CPU per our LEARNINGS | Keep as opt-in, but **flag the license**: fine for demos/internal, not for users shipping commercial video. Use maintained `idiap/coqui-ai-TTS` fork |
| **StyleTTS2** | ✅ **MIT** | Most-natural English narration; matches/beats human on LJSpeech/VCTK ([PyPI](https://pypi.org/project/styletts2/)) | Fast at inference | Moderate — inference package exists, torch-based | No zero-shot cloning in the base package; great single-voice narrator |
| **Parler-TTS** | ✅ **Apache-2.0** | High; prompt-describable voices ([GitHub](https://github.com/huggingface/parler-tts)) | Mini 880M / Large 2.3B — heavier | Moderate–heavy (torch) | Nice "describe the voice in text" UX, but large models; overkill for v0.1 |
| **ElevenLabs** (cloud) | Commercial API | Top MOS ~4.1–4.3, best expressiveness ([speechmatics](https://www.speechmatics.com/company/articles-and-news/best-tts-apis-in-2025-top-12-text-to-speech-services-for-developers)) | Network-bound | n/a (API) | $50–165 /M chars. Has **character-level timestamps** → great for exact sync. Premium opt-in |
| **OpenAI TTS** (cloud) | Commercial API | Clear but flatter (~3.9 MOS) | Network-bound | n/a | $15/M chars, easy integration, but **no word timestamps, no SSML, no speed control** ([tokenmix](https://tokenmix.ai/blog/tts-api-comparison)) — weak for our sync model |
| **Google Cloud TTS** (cloud) | Commercial API | Good (Studio ~4.1) | Network-bound | n/a | $4–16/M chars, full SSML, best price/features. Solid cloud default |

### Recommendation — prioritize 3

1. **Piper** — keep as the zero-config default (fast, tiny, no torch). Ship it via
   **subprocess only** and document the GPL-3.0 status; a permissive fallback matters.
2. **Kokoro-82M** — add as the *quality default*. Apache-2.0, small, CPU/MPS-friendly,
   punches way above its size. This is the cleanest "sounds good AND commercially safe"
   option and the best answer to Piper's GPL wrinkle.
3. **Chatterbox (MIT)** — the high-end, cloning-capable, permissively-licensed tier for
   users who want studio quality without XTTS's license dead-end.

Keep **XTTS-v2** as an opt-in "it works today, but non-commercial weights" backend
(our LEARNINGS already solve its install), and expose **ElevenLabs** as the cloud
premium path — notably its **word/character timestamps let us skip heuristic timing
entirely** for users who pay. Deprioritize OpenAI TTS for our use case: no word
timestamps breaks our core feature.

---

## 3. Forced alignment (exact word timing) vs our heuristic

Today we **distribute words evenly across a measured sentence/turn duration** and
rescale to the real (post-loudnorm) audio length. That's cheap, dependency-free, and
"good enough" because the audio is TTS of the exact caption text — but it drifts
inside a sentence (pauses, long words). If we later want true onsets:

| Option | Approach | Accuracy | Cost / deps | Fit |
|--------|----------|----------|-------------|-----|
| **WhisperX** | Whisper ASR + wav2vec2 alignment | Word-level, but timestamps can be **off vs MFA** ([issue #1247](https://github.com/m-bain/whisperX/issues/1247), [arxiv](https://arxiv.org/html/2406.19363v1)) | torch + models, GPU-ish | Easiest to bolt on; already Python; decent, not perfect |
| **Montreal Forced Aligner (MFA)** | GMM-HMM, 10ms resolution | **Most accurate word-level** — beats WhisperX/MMS ([arxiv](https://arxiv.org/html/2406.19363v1)) | Kaldi/conda install, phone dictionaries | Best accuracy, heaviest install; overkill unless precision is the selling point |
| **aeneas** | DTW on MFCCs, synth-vs-real ([GitHub](https://github.com/readbeyond/aeneas)) | Good at **sentence/sub-sentence**, *not great at word* granularity ([wiki](https://github.com/readbeyond/aeneas/blob/master/wiki/HOWITWORKS.md)) | Python/C, no ML models | Ironically close to what we already do; little upside for word-level |
| **Gentle** | Kaldi-based aligner | Solid word-level (English) | Docker/Kaldi, largely unmaintained | Heavy, stale; skip |

**Verdict:** our heuristic is the right default — it's zero-dep and the text is known
exactly. If we add alignment, **WhisperX** is the pragmatic opt-in (Python already in
our stack, one model download) with **MFA** reserved for a future "precision mode."
Better still: when a backend *emits* timestamps natively (ElevenLabs; Whisper inside
manim-voiceover's approach), consume those and skip alignment entirely.

---

## 4. Positioning

**Positioning statement:**
> **narova turns a plain-HTML scene script into a narrated, word-synced, kinetic
> explainer video — an interactive player and a matching MP4 — with automatic neural
> TTS and captions that stay locked to the generated speech. Open, local-first, and
> version-controllable.**

**Who it's for:** engineers and technical teams who want **repeatable, source-controlled
explainer/demo videos** (product walkthroughs, launch clips, docs-as-video) without
learning React (Remotion), hand-animating in TypeScript (Motion Canvas/Revideo), or
renting a closed AI-video SaaS — and without wiring TTS + alignment + ffmpeg themselves.

**The 3 features that make it distinct:**
1. **Automatic word-level caption sync to generated speech** — captions are derived
   from the TTS timing track, guaranteed to match audio (timings total == audio
   duration is asserted). No manual subtitle timing, no libass.
2. **Voice-reactive visuals from a declarative script** — `data-cue="k"` elements
   reveal exactly when the narrator reaches turn *k*. You write HTML + data, not code.
3. **One script → interactive player + pixel-identical MP4**, both self-contained,
   with multi-host neural narration built in and local/OSS TTS backends.

---

## 5. "Why not just use Remotion?"

Honest answer: if you already live in React and want maximum motion control, **use
Remotion** — it's more mature and more flexible. narova is the better fit when:

- You want **narration + word-synced captions to be automatic**, not a subsystem you
  build from ElevenLabs + an aligner + subtitle code. In Remotion that's all DIY.
- You'd rather write **plain HTML + a data script** than React components.
- You care about **licensing and self-hosting**: Remotion's source is visible but
  **not OSI open source**, and automated/prompt-to-video pipelines — exactly our use
  case — need the paid **Automators** license ($0.01/render, $100/mo min)
  ([Remotion license](https://www.remotion.dev/docs/license)). narova is meant to be
  fully open and local.

Short version: Remotion is a general programmatic-video framework you script in React;
narova is a narrow, opinionated **"script → talking explainer video"** tool where the
voice and the word-sync are the whole point.

---

### Sources
- Remotion license & pricing: https://www.remotion.dev/docs/license · https://www.remotion.dev/docs/license/pricing
- Revideo/Motion Canvas comparison: https://www.pkgpulse.com/guides/remotion-vs-motion-canvas-vs-revideo-programmatic-video-2026
- manim-voiceover: https://voiceover.manim.community/en/stable/index.html
- Piper license/perf: https://github.com/rhasspy/piper/blob/master/LICENSE.md · https://localaimaster.com/blog/piper-tts-setup-guide
- Kokoro-82M: https://huggingface.co/hexgrad/Kokoro-82M
- Chatterbox: https://github.com/resemble-ai/chatterbox
- XTTS-v2 license/shutdown: https://github.com/coqui-ai/TTS/issues/3490 · https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts
- StyleTTS2: https://pypi.org/project/styletts2/ · Parler-TTS: https://github.com/huggingface/parler-tts
- Cloud TTS comparison: https://www.speechmatics.com/company/articles-and-news/best-tts-apis-in-2025-top-12-text-to-speech-services-for-developers · https://tokenmix.ai/blog/tts-api-comparison
- Forced alignment: https://arxiv.org/html/2406.19363v1 · https://github.com/m-bain/whisperX/issues/1247 · https://github.com/readbeyond/aeneas
