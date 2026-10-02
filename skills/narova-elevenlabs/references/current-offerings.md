# Current ElevenLabs routes for Narova

Checked against official documentation on 2026-10-02. Account and model access
remain provider-controlled; this guide does not claim a live generation test.

## Eleven v4 and v4 turbo

Select the model explicitly in the registered voice:

```js
voices: {
  a: { backend: 'elevenlabs', speaker: '<voice-id>',
       providerOptions: { model: 'eleven_v4', stability: 0.45,
                          similarityBoost: 0.7 } }
}
```

Use `eleven_v4_turbo` for the turbo variant. The legacy default remains
`eleven_multilingual_v2`, so upgrading does not silently recast a project.
V4 supports Stability and Similarity; the companion rejects Style, Speed and
Speaker Boost settings for these two models before submitting speech. V4 uses
text/audio directions rather than SSML. Keep clean captions in `text` and
provider directions in `synthesisText`, with matching sentence counts.
See [Eleven v4](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4)
and [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

The model index and product/API guides have differed on v4 endpoint coverage.
The worker sends the explicit model to Create speech; provider account/model
errors remain attributed failures. No alias or automatic fallback is selected.

## Phrasing context and portable takes

Re-register the updated companion after installing it:

```bash
narova providers remove elevenlabs
narova providers add <narova-elevenlabs-skill-dir>/tool/provider.json
```

Both registration and the worker handshake advertise `surroundingText`. Core
passes the effective preceding/following sentences from the same turn; the
adapter maps them to `previous_text` and `next_text`. It still requests only the
current sentence. Context participates in cache identity and derived seeds.
Editing any surrounding text can invalidate every sentence whose context changed;
untouched turns remain reusable. This gives the provider phrasing information,
not a guarantee of continuous turn-level intonation. See the
[Create speech context fields](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

Narova owns gaps and `pauseAfter`; use those instead of inserting invented
caption words. Portable `voice-cache export/import` carries processed sentence
takes for keyless rebuilds. Provider seeds are best-effort; retaining selected
actual audio is stronger evidence than asking a hosted model to regenerate it.
Raw `pcm_<rate>`, `ulaw_<rate>` and `alaw_<rate>` output formats are explicitly
decoded to WAV; access to formats still depends on the provider account.

## Optional hosted MCP

Connect your MCP client explicitly to `https://api.elevenlabs.io/v1/mcp` and
complete the scoped OAuth flow. Region-specific endpoints are listed in the
[official hosted MCP guide](https://elevenlabs.io/docs/eleven-agents/operate/hosted-mcp).
Use your client's tool controls to select the operations appropriate to the
request. This companion does not install or connect an MCP client automatically.

The hosted server offers speech samples and ElevenAgents management. For a
requested speech sample, download the returned short-lived audio link to a
stable project asset before authoring `narration.file`. Give external narration
explicit scene durations and adopt supplied or aligned word cues when needed.
A build never invokes MCP or depends on the ephemeral link. Agent creation,
account changes and deletion are separate actions outside video synthesis.

## Other relevant offerings

| Offering | Explicit Narova authoring route |
|---|---|
| [Text to Dialogue](https://elevenlabs.io/docs/overview/capabilities/text-to-dialogue) | Audition a complete multi-speaker performance, download it, and use external narration with clean turns and adopted word cues. It is separate from the sentence worker. |
| [Sound effects](https://elevenlabs.io/docs/overview/capabilities/sound-effects) | Download the chosen effect, record its source with `narova assets import`, then place it with `sfx` anchors, source trim and fades. |
| [Music](https://elevenlabs.io/docs/overview/capabilities/music) | Download the authored selection and use `bed`; choose gain, fades and optional final mix loudness explicitly. Reference-guided music remains an acquisition choice. |
| [Voice design and remix](voice-design.md) | The existing helper creates previews and a selected account voice; use the resulting voice ID in the registered worker. |
| [Transcription](https://elevenlabs.io/docs/overview/capabilities/speech-to-text) and [forced alignment](https://elevenlabs.io/docs/overview/capabilities/forced-alignment) | Convert selected output into Narova's documented clean word-cue format and adopt it as external timing evidence; never treat an unverified transcript as measured authored identity. |
| [Dubbing](https://elevenlabs.io/docs/overview/capabilities/dubbing), [voice changer](https://elevenlabs.io/docs/overview/capabilities/voice-changer) and [voice isolation](https://elevenlabs.io/docs/overview/capabilities/voice-isolator) | Preserve the selected downloaded performance as external narration; transformation stays outside the build worker. |

Provider-native generation is an explicit acquisition/audition step. Narova
keeps source assets, timing, captions, cache validation, mixing and delivery in
core. Check provider usage rights when choosing assets for a project.
