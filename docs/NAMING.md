# NAMING

Constraint: the package name is a **single lowercase token**, npm- and pypi-plausible
(we ship a Node CLI + a Python TTS package, so ideally the name is free on **both**).
Availability was sniffed live against `registry.npmjs.org` and `pypi.org/pypi` plus a
web brand check. "Available" = HTTP 404 on the registry (no published package).

## Candidates

| Name | npm | pypi | Rationale | Brand collision |
|------|-----|------|-----------|-----------------|
| **narova** *(current)* | ❌ **taken** | ✅ free | reel + kit | **Direct collision:** npm `narova` is a *"TypeScript SDK for video composition and rendering"* (v1.1.1, published Mar 2026). Same namespace, same domain — retire it |
| **scenevox** | ✅ free | ✅ free | scene + vox (voice) — "scenes that speak" | None found (a "VoxScene" voxel-diffusion *paper* exists, different spelling/domain) |
| **narravox** | ✅ free | ✅ free | narrate + vox — automatic narration is the point | None found |
| **kinescript** | ✅ free | ✅ free | kinetic + script — kinetic captions from a scene *script* | ⚠️ near **kinescope.io** (video hosting) — phonetically close, could confuse |
| **cuereel** | ✅ free | ✅ free | `data-cue` reveals + reel | None found |
| **captiscene** | ✅ free | ✅ free | caption + scene — captions are a first-class feature | None found; a bit hard to say/spell |
| **spielcast** | ✅ free | ✅ free | *spiel* (an explainer pitch) + cast | None found; "cast" leans podcast-y, "spiel" reads German |
| **reelweave** | ✅ free | ✅ free | weave narration + captions + motion into a reel | None found |
| **voxscene** | ✅ free | ✅ free | voice + scene | ⚠️ "VoxScene" research paper + "ScriptVOX" TTS app — muddier than scenevox |
| **reelvox** | ✅ free | ✅ free | reel + voice | None on registries, but "reel" space is crowded |
| **reelcast** | ✅ free | ✅ free | reel + cast | ⚠️ consumer apps own it: reelcast.app (multi-platform posting), ReelCast YouTube tool |
| **reeltalk** | ✅ free | ✅ free | reel + talk | ⚠️ **ReelTalk** iOS teleprompter app owns the consumer brand |
| **voxreel** | — | ❌ **taken** | voice + reel | pypi `voxreel` is *"media tooling for transcription, GIF, and Piper TTS"* — adjacent, avoid |
| **scenecast** | ❌ **taken** | ✅ free | scene + cast | npm `scenecast` is an AI-agent asset-shape lib — adjacent namespace, avoid |
| **narrata** | ✅ free | ❌ **taken** | narrate | pypi `narrata` = time-series narration lib |

### Note on the "reel" theme
`reel*` names (reelcast, reeltalk, reelvox, reelweave, cuereel) are **crowded and
off-signal**: "reel" now reads as TikTok/Instagram short-form social video, and the
current npm collision (`narova`) is itself a video SDK. Our product is a *technical
explainer* tool, not a social-clip maker. The **scene / vox / narrate** cluster
positions better and has cleaner namespaces.

## Top 3

1. **scenevox** — clearest meaning ("scenes that narrate themselves"), free on npm
   *and* pypi, no software collision, easy to say and spell. Best single-token fit for
   what the tool actually does. **Recommended.**
2. **narravox** — free on both registries, no collision; foregrounds the automatic
   *narration*, which is the killer feature. Slightly voice-assistant-flavored, but safe
   and pronounceable.
3. **cuereel** — free on both, no collision, and nods to the `data-cue` reveal
   mechanic that makes visuals react to the voice. Caveat: carries the "reel" baggage
   above, so third rather than first.

**If we want to keep "narova"**, we'd need a namespaced package (e.g.
`@narova/cli`) since the bare npm name is taken — but given a same-domain collision
*and* a free clean alternative, switching to **scenevox** is the better call.
