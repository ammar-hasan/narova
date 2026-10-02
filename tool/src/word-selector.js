'use strict';
const normalize = text => String(text).trim().toLowerCase().replace(/^[\p{P}\p{S}]+/u, '').replace(/[\p{P}\p{S}]+$/u, '');
function selectWordIndex(tokens, selector, at = 'word cue') {
  if (Number.isInteger(selector) && selector >= 0) return selector;
  if (!selector || typeof selector !== 'object' || Array.isArray(selector) || typeof selector.text !== 'string' || !normalize(selector.text) || (selector.occurrence != null && (!Number.isInteger(selector.occurrence) || selector.occurrence < 0))) throw new Error(`${at}: invalid word selector`);
  const matches = tokens.flatMap((token, i) => normalize(token) === normalize(selector.text) ? [i] : []);
  if (selector.occurrence == null && matches.length !== 1) throw new Error(`${at}: word ${JSON.stringify(selector.text)} has ${matches.length} matches; provide occurrence for repeated words`);
  const index = matches[selector.occurrence ?? 0];
  if (index == null) throw new Error(`${at}: word occurrence unavailable`);
  return index;
}
module.exports = { selectWordIndex, normalize };
