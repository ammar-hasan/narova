'use strict';
/* One authoritative registry for Narova's built-in, local TTS backends.
 * External backends are never added here: they resolve through an explicitly
 * registered narova-tts-provider manifest. */

const BUILTIN_BACKENDS = Object.freeze({
  piper: Object.freeze({ displayName: 'Piper', voiceMode: 'downloadable' }),
  xtts: Object.freeze({ displayName: 'XTTS-v2', voiceMode: 'bundled' }),
  qwen: Object.freeze({ displayName: 'Qwen3-TTS', voiceMode: 'bundled' }),
  chatterbox: Object.freeze({ displayName: 'Chatterbox', voiceMode: 'clone' }),
});

/* NAR-018-068 — delivery-control capability declarations for the built-in
 * backends. These are DISCLOSURES, never restrictions: they tell the agent
 * what each backend actually honors so it can route around limits instead of
 * burning renders to discover them. Statuses: 'honored' | 'ignored' |
 * 'unknown'. Absent families read as 'unknown' — never inferred.
 *
 * Families:
 *   pronunciation-markup  SSML-style <phoneme>/<say-as> and IPA /…/ forms.
 *   delivery-instruct     free-text performance direction (qwen: per-voice
 *                         `instruct`, e.g. "warm, never flat").
 *   pause-markup          authored <break time="…s"/> pauses.
 *   emphasis-markup       <emphasis>/<prosody> emphasis tags.
 *   non-latin-script      native Arabic/Urdu script text synthesis.
 *   seed-stabilization    deterministic takes from an identity-derived seed
 *                         (NAR-018-071). */
const DELIVERY_CAPABILITIES = Object.freeze({
  piper: Object.freeze({
    'pronunciation-markup': 'ignored',
    'delivery-instruct': 'ignored',
    'pause-markup': 'ignored',
    'emphasis-markup': 'ignored',
    'non-latin-script': 'ignored', // single Arabic voice exists; tags are not parsed
    'seed-stabilization': 'honored', // deterministic by construction (no sampling)
  }),
  xtts: Object.freeze({
    'pronunciation-markup': 'ignored',
    'delivery-instruct': 'ignored',
    'pause-markup': 'ignored',
    'emphasis-markup': 'ignored',
    'non-latin-script': 'honored', // Arabic is in the trained language set
    'seed-stabilization': 'honored', // torch.manual_seed pinned from the derived seed
  }),
  qwen: Object.freeze({
    'pronunciation-markup': 'ignored',
    'delivery-instruct': 'honored', // per-voice `instruct` reaches generate_custom_voice
    'pause-markup': 'ignored',
    'emphasis-markup': 'ignored',
    'non-latin-script': 'honored', // language pass-through / auto-detect
    'seed-stabilization': 'unknown', // no seed hook in generate_custom_voice
  }),
  chatterbox: Object.freeze({
    'pronunciation-markup': 'ignored',
    'delivery-instruct': 'ignored', // exaggeration/cfg_weight are knobs, not text direction
    'pause-markup': 'ignored',
    'emphasis-markup': 'ignored',
    'non-latin-script': 'honored', // multilingual v3 with per-voice lang
    'seed-stabilization': 'unknown', // worker protocol has no seed field
  }),
});

/* NAR-018-069 — markup family detectors used by the check-time advisory.
 * Detection is string-level and heuristic; warnings, never errors. */
const MARKUP_FAMILIES = Object.freeze([
  { family: 'pronunciation-markup', pattern: /<phoneme\b|<say-as\b|\bipa:|\|[^|\n]{1,40}\|/i },
  { family: 'pause-markup', pattern: /<break\b/i },
  { family: 'emphasis-markup', pattern: /<emphasis\b|<prosody\b/i },
]);

/* Capability view for a backend name. Built-ins read DELIVERY_CAPABILITIES;
 * external providers report whatever their manifest declares, with every
 * undeclared family reported as 'unknown' (getExternal is injected by callers
 * to avoid a require cycle with providers.js). */
function deliveryCapabilitiesFor(backend, getExternal) {
  if (Object.prototype.hasOwnProperty.call(DELIVERY_CAPABILITIES, backend)) {
    return DELIVERY_CAPABILITIES[backend];
  }
  if (typeof getExternal === 'function') {
    const manifest = getExternal(backend);
    if (manifest && manifest.deliveryCapabilities) return manifest.deliveryCapabilities;
  }
  return null; // unknown backend or undeclared — callers surface as unknown
}

const builtinNames = () => Object.keys(BUILTIN_BACKENDS);
const isBuiltinBackend = name => Object.prototype.hasOwnProperty.call(BUILTIN_BACKENDS, name);
const backendHint = () => builtinNames().join('|');

module.exports = {
  BUILTIN_BACKENDS, builtinNames, isBuiltinBackend, backendHint,
  DELIVERY_CAPABILITIES, MARKUP_FAMILIES, deliveryCapabilitiesFor,
};
