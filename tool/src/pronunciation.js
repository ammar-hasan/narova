'use strict';
// Literal author-owned speech input. Captions and sentence ownership stay clean.
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
function validatePronounce(value, label = 'config.pronounce') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}: expected a pronunciation map`);
  for (const [key, text] of Object.entries(value)) {
    if (!key.trim() || key !== key.trim() || RESERVED.has(key) || typeof text !== 'string' || !text.trim() || text !== text.trim()) throw new Error(`${label}.${key}: expected trimmed nonempty literal and spoken text, without reserved keys`);
  }
  return { ...value };
}
function applyPronounce(text, map = {}) {
  const keys = Object.keys(map).sort((a, b) => [...b].length - [...a].length);
  if (!keys.length) return text;
  const escaped = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])(?:${escaped.join('|')})(?![\\p{L}\\p{M}\\p{N}_])`, 'gu');
  return text.replace(pattern, key => map[key]);
}
function spokenSentences(turn, backend, map = {}) {
  const split = text => text.trim().split(/(?<=[.!?۔؟])\s+/).filter(Boolean);
  const clean = split(turn.text);
  const builtin = require('./tts-backends').isBuiltinBackend(backend || 'piper');
  const synth = !builtin && turn.synthesisText ? split(turn.synthesisText) : clean;
  return (synth.length === clean.length ? synth : clean).map(text => applyPronounce(text, map));
}
function changedSpeech(turn, backend, map) {
  if (!map || !Object.keys(map).length) return undefined;
  const spoken = spokenSentences(turn, backend, map);
  return JSON.stringify(spoken) === JSON.stringify(spokenSentences(turn, backend)) ? undefined : spoken;
}
module.exports = { validatePronounce, applyPronounce, spokenSentences, changedSpeech };
