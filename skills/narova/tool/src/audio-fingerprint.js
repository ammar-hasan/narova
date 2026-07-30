'use strict';
/* Content identity for every input that affects synthesized narration.
 *
 * This is a leaf module because both the synthesis pipeline and walkthrough
 * freshness checks need the exact same identity without introducing a
 * pipeline/schema circular dependency. */
const fs = require('fs');
const crypto = require('crypto');
const { stableStringify } = require('./providers');

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return sha256(fs.readFileSync(filePath));
}

function audioFingerprint(config) {
  const voices = config.voices || {};
  const entries = [];

  for (const [id, v] of Object.entries(voices)) {
    const fp = { id };
    fp.backend = v.backend || 'piper';
    fp.speaker = v.speaker || '';
    if ((v.backend === 'chatterbox' || v.backend === 'xtts') && v.speaker) {
      const resolved = v.speaker;
      if (fs.existsSync(resolved)) fp.sampleHash = hashFile(resolved);
    }
    fp.gainDb = v.gainDb != null ? v.gainDb : 0;
    fp.lang = v.lang || '';
    fp.instruct = v.instruct || '';
    fp.exaggeration = v.exaggeration != null ? v.exaggeration : 1.0;
    fp.cfg_weight = v.cfg_weight != null ? v.cfg_weight : 0.7;
    fp.providerProtocol = v.providerProtocol || '';
    fp.providerVersion = v.providerVersion || '';
    fp.providerOptions = v.providerOptions || {};
    entries.push(fp);
  }

  const turns = [];
  for (const scene of (config.scenes || [])) {
    for (const turn of (scene.vo || [])) {
      turns.push({
        who: turn.who,
        text: turn.text,
        ...(turn.synthesisText ? { synthesisText: turn.synthesisText } : {}),
        lang: turn.lang || '',
      });
    }
  }

  const timing = config.timing || {};
  const tempo = timing.tempo != null ? timing.tempo : 1.0;
  return sha256(stableStringify({
    voices: entries,
    turns,
    tempo,
    gapSentence: timing.gapSentence != null ? timing.gapSentence : 0.24,
    gapTurn: timing.gapTurn != null ? timing.gapTurn : 0.44,
    lead: timing.lead != null ? timing.lead : 0.16,
    tail: timing.tail != null ? timing.tail : 0.58,
    backend: Object.values(voices)[0]?.backend || 'piper',
    pipeline: 3,
  }));
}

module.exports = { audioFingerprint };
