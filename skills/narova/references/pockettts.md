# Built-in Pocket TTS

Pocket TTS ships within the Narova tool alongside Piper, XTTS, Qwen and
Chatterbox. Install only its optional isolated runtime with
`narova-setup --pockettts` (Python 3.12). No separate skill or provider registration
is required. A former Pocket companion registration is ignored by built-in
routing and may be removed explicitly with `narova providers remove pockettts`;
normal project commands leave that registry file untouched. Setup leaves other backend environments intact and downloads no
models. Pocket setup ignores inherited pip options and configuration to prevent
package installation from being redirected into another environment.
Select `backend: 'pockettts'` per voice or `--backend pockettts`.

`narova voices list --backend pockettts` and `narova pockettts catalog` work
without the Pocket runtime or model downloads. Ordinary `narova doctor` checks
optional package readiness only; `narova pockettts doctor --speaker alba`
explicitly checks the selected model and state and may download them.
`NAROVA_POCKETTTS_VENV` selects the isolated environment;
`NAROVA_POCKETTTS_OFFLINE=1` uses already acquired resources without network.
Models are cached by the upstream runtime; `HF_HOME` can locate that cache.

Explicit model doctor and voice export announce their work and print elapsed
progress every five seconds, including in automation. Their default deadline
is 120 seconds. Set `NAROVA_POCKETTTS_TIMEOUT` to positive finite seconds up to
86400 for a cold download or slower machine; when unset,
`NAROVA_PROVIDER_TIMEOUT` supplies the deadline. Timeout stops the helper and
cleans its private export stage, preserving an existing destination. Diagnostics
go to stderr in `--json` mode. Successful exports verify the staged byte digest
before replacing the destination.

## Engine and resources

The released engine profile is Pocket TTS 3.3.0 on CPU, with dated model
configurations and immutable model/tokenizer/embedding revisions. Run
`narova pockettts catalog` for all 27 preset IDs and 18
released model configurations; this command needs no speech dependencies.
Catalog model records label 24-layer configurations with `preview: true` and
include the seven language routes.
See [upstream presets and their sources](https://huggingface.co/kyutai/tts-voices),
[released package](https://pypi.org/project/pocket-tts/3.3.0/) and
[release source](https://github.com/kyutai-labs/pocket-tts/tree/v3.3.0).
Source recordings and upstream model licenses remain separate from Narova's license.

## Presets and languages

```js
voices: {
  host: {
    backend: 'pockettts', speaker: 'alba',
    providerOptions: { model: 'english_2026-09', temperature: 0.3 }
  },
  guest: { backend: 'pockettts', speaker: 'estelle' }
},
scenes: [{ id: 'hello', body: '<h1>Hello</h1>', vo: [
  { who: 'host', text: 'Welcome to Narova.', lang: 'en' },
  { who: 'guest', text: 'Bienvenue dans Narova.', lang: 'fr' }
]}]
```

With no model option, turn language selects `english_2026-09`, `french`,
`german`, `spanish`, `italian`, `portuguese` or `dutch`; no language defaults to
English. `english` resolves to the dated English model. An explicit model that
conflicts with a requested language fails. Regional codes are not accepted;
use `en|fr|de|es|it|pt|nl`. Pin a dated English model for archived work.

## Clone a reference

```js
voices: {
  host: {
    backend: 'pockettts', speaker: 'my-authorized-voice',
    providerFiles: { referenceAudio: 'assets/my-voice.wav' },
    providerOptions: { model: 'english_2026-09', truncateReference: false }
  }
}
```

Use clean speech from a consenting speaker. Cloning requires full weights and
may require gated Hugging Face access; unavailable weights produce a clear
error, never a preset fallback. References longer than 30 seconds fail unless
`truncateReference: true` explicitly permits the upstream first-30-second policy.
`referenceAudio` and `voiceState` are mutually exclusive. Audio files and decoded float samples are each bounded at 64 MiB. Decoding
reads at most the explicitly selected first 30 seconds, before encoding. Speaker becomes your label when either file supplies conditioning.

## Export and reuse a voice state

```bash
narova pockettts export-voice \
  --speaker alba --model english_2026-09 --output /absolute/path/alba.safetensors
# For a clone, add --reference /absolute/path/authorized.wav.
```

```js
voices: {
  host: {
    backend: 'pockettts', speaker: 'saved-alba',
    providerFiles: { voiceState: 'assets/alba.safetensors' },
    providerOptions: { model: 'english_2026-09', voiceCloning: false }
  }
}
```

Export embeds Narova provenance in the state itself. Import requires the
same model/runtime/quantization/full-or-preset profile. For a state exported
from a clone, set `voiceCloning: true`; for a quantized export, set
`quantize: true`. Arbitrary upstream states lack this provenance and are rejected.
Files are verified before reading; exports replace the destination only after
successful serialization. Keep the state inside the project for portable packs.
Declare all local references, saved states and model resources through
`providerFiles`; authored `{path, sha256}` records in `providerOptions` are
rejected so stale metadata cannot bypass cache or archive dependency checks.

## Generation controls

| Option | Default | Accepted values |
| --- | --- | --- |
| `model` | language default | released catalog ID; mutually exclusive with `config` |
| `temperature` | 0.3 | finite 0–2 |
| `samplerDecodeSteps` | 1 | integer 1–32 |
| `noiseClamp` | null | positive finite number ≤10, or null |
| `eosThreshold` | -4 | finite -20–20 |
| `framesAfterEos` | null | integer 0–50, or null for model recommendation |
| `maxTokens` | 50 | integer 16–256 per native chunk |
| `quantize` | false | Boolean; optional CPU dynamic quantization |
| `voiceCloning` | true for references/custom config; otherwise false | Boolean selecting full/preset weights |
| `truncateReference` | false | Boolean; explicit long-reference truncation |

Use Narova's seed/take controls; `providerOptions.seed` is not the authoring
route. Core injects the utterance seed. Unknown options, invalid types, stale
files and conflicting inputs fail before generation. Text is bounded at 8,192
characters; split long unpunctuated passages at sentence/comma boundaries.
A native chunk that exceeds the token bound or never reaches EOS fails instead
of silently publishing incomplete narration.

## Custom model resources

Bind a local `config` file through `providerFiles`, optionally with `weights`,
`nonCloningWeights`, `tokenizer`, `flowWeights` and `codecWeights`. Every local
resource referenced by that config must be explicitly bound; remote resources
must use upstream `hf://...@<40-hex-revision>` references. Floating revisions,
raw HTTP model URLs and unbound local resources fail. `config` and `model` are
mutually exclusive. Custom models require a reference or compatible saved state;
preset conditioning is not inferred. Explicit custom preset mode requires declared
`nonCloningWeights`; full weights are never relabeled as preset-only. Model resources are bounded at 2 GiB each,
config at 1 MiB, voice states at 256 MiB and other files at 64 MiB.
Exports enforce the same state bound as imports; state filenames may be renamed. Archive size/scope limits still apply.

`providerFileInputs` is resolver-owned evidence, not author configuration.
Whole-build, shared narration and sentence reuse include the current file
paths and SHA-256 bytes. A missing file fails even if a previous output exists.
Changing reference/state/config/resource bytes at the same path invalidates reuse.
