'use strict';
// Cue count is not turn count. Bind supplied words to authored turn ranges via
// the same normalized clean transcript used during source validation.
const tokens = text => String(text || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
function externalWordTurns(config) {
  const authored = [];
  for (const scene of config.scenes || []) for (const [ti, turn] of (scene.vo || []).entries()) for (const token of tokens(turn.text)) authored.push({ token, scene: scene.id, ti, who: turn.who });
  const result = new Map(); let cursor = 0;
  const required = (config.scenes || []).some(scene => (scene.vo || []).some(turn => turn.captions === false));
  const unavailable = () => {
    if (required) throw new Error('external captions: supplied cue words cannot be associated with the authored turns; provide matching clean transcript and word evidence');
    return new Map();
  };
  const cues = config.narrationSource?.wordTimings || [];
  for (const cue of cues) {
    const words = cue.words || [], transcript = tokens(cue.text || words.map(w => w.text || w.w).join(' '));
    const sizes = words.map(word => tokens(word.text || word.w).length);
    if (sizes.some(size => size === 0) || sizes.reduce((sum, size) => sum + size, 0) !== transcript.length) return unavailable();
    if (transcript.some((token, i) => authored[cursor + i]?.token !== token)) return unavailable();
    for (const [index, word] of words.entries()) {
      if (tokens(word.text || word.w).some((token, i) => authored[cursor + i]?.token !== token)) return unavailable();
      const owner = authored[cursor];
      // A supplied token cannot represent multiple authored speakers/turns.
      if (!owner || authored.slice(cursor, cursor + sizes[index]).some(item => item.scene !== owner.scene || item.ti !== owner.ti)) return unavailable();
      result.set(word, { scene: owner.scene, ti: owner.ti, who: owner.who }); cursor += sizes[index];
    }
  }
  if (cues.length && cursor !== authored.length) return unavailable();
  return result;
}
module.exports = { externalWordTurns };
