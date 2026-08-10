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

const builtinNames = () => Object.keys(BUILTIN_BACKENDS);
const isBuiltinBackend = name => Object.prototype.hasOwnProperty.call(BUILTIN_BACKENDS, name);
const backendHint = () => builtinNames().join('|');

module.exports = { BUILTIN_BACKENDS, builtinNames, isBuiltinBackend, backendHint };
