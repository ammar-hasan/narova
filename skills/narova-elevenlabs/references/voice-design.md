# ElevenLabs voice design — audition a new voice without leaving Narova

Use this when a brief needs a voice that does not exist yet (an invented
character, a specific accent or age the account library lacks). The
helper lives beside the provider worker and uses the same
`ELEVENLABS_API_KEY`. It changes no project or core state and registers
nothing.

**Network and billing:** every design call is a network operation billed
against the hosted account — check current pricing/quota before
generating many previews. The helper never retries automatically (a
lost response may still be billed). Disclosure stays at the
documentation level like the rest of the companion.

## The loop: describe → listen → pick → create

### 1. Design previews from a description

```bash
python3 <skill-dir>/tool/design.py \
  "A warm Urdu-speaking grandmother, gentle and unhurried, softly raspy with age" \
  --out out/voice-design --seed 7
```

Writes into `out/voice-design/`:

- `preview-01-<id>.mp3`, `preview-02-<id>.mp3`, … — the generated previews
- `index.md` — the audition table (file, generated voice id, duration)
  and the exact create command to copy
- `design.json` — the recorded request parameters and preview metadata;
  the same **seed** with the same inputs reproduces the same previews

By default ElevenLabs generates its own short preview lines. Supply
`--text` to hear the voice speak your own material (100–1000 characters
— try real narration lines, including Urdu); shorter or longer text
fails locally before any network call.

Tunables: `--language` (preview language), `--loudness` (-1..1),
`--guidance-scale` (0 freer … 20 stricter; high values can sound
robotic — prefer longer descriptions at lower values), `--enhance`
(expand a sparse description with AI), `--model eleven_ttv_v3` (newer),
`--timeout`.

### 2. Listen and pick — a human chooses

Play the previews (`afplay`, `mpv`, or any player). The helper never
ranks or auto-picks; a wrong-sounding voice is discarded, not shipped.

### 3. Create the permanent voice

```bash
python3 <skill-dir>/tool/design.py \
  --create <chosen-generated-voice-id> --name "Dadi" \
  --description "Warm Urdu-speaking grandmother"
```

Prints the permanent `voice_id` and a ready-to-paste config fragment:

```js
voices: {
  dadi: { backend: "elevenlabs", speaker: "<voice_id>", label: "Dadi" }
}
```

From here everything is the ordinary ElevenLabs path: the voice appears
in `narova voices list --backend elevenlabs`, synthesis/options/caching
behave exactly as in [configuration.md](configuration.md).

## Remixing an existing voice

Derive a *new* voice from a remixable one (self-designed, IVC/PVC, or a
library voice with an infinite notice period) — the original voice and
its takes stay untouched:

```bash
python3 <skill-dir>/tool/design.py \
  "Same voice but higher pitch with a Boston accent" \
  --remix <existing-voice-id> --out out/voice-design-remix
```

Then audition and create exactly as above.

## Notes

- Keep descriptions concrete: age, gender, texture, pace, accent,
  energy. Two or three vivid sentences outperform a keyword list; with
  `--enhance`, one good sentence is enough.
- Previews are evidence files (mp3), not build inputs — Narova still
  synthesizes every build sentence itself through the registered
  provider.
- A designed voice is account state at ElevenLabs; the portable artifact
  is the printed `voice_id` string, which is all Narova ever stores.
