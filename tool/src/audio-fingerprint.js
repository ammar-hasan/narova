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

  const hasClipAudioDecision = (config.scenes || []).some(scene => scene.clipAudio != null);
  const clipAudio = (config.scenes || []).map(scene => {
    const authority = scene.clipAudio?.authority || 'synthesis';
    return {
      authority,
      ...(authority === 'native' ? {
        clipHash: scene.clipAudio?.file ? hashFile(scene.clipAudio.file) : null,
        dur: scene.dur,
      } : {}),
    };
  });

  const timing = config.timing || {};
  const tempo = timing.tempo != null ? timing.tempo : 1.0;
  return sha256(stableStringify({
    voices: entries,
    turns,
    ...(hasClipAudioDecision ? { clipAudio } : {}),
    tempo,
    gapSentence: timing.gapSentence != null ? timing.gapSentence : 0.24,
    gapTurn: timing.gapTurn != null ? timing.gapTurn : 0.44,
    lead: timing.lead != null ? timing.lead : 0.16,
    tail: timing.tail != null ? timing.tail : 0.58,
    backend: Object.values(voices)[0]?.backend || 'piper',
    pipeline: 3,
  }));
}

/* Shared narration context: every fingerprint input EXCEPT the turn texts.
 * A change here (voice, backend, gain, tempo, gaps) re-synthesizes every
 * scene; a turn-text change alone does not — the sentence cache serves every
 * unchanged sentence, so untouched scenes still come out byte-identical.
 * Revision-impact prediction (CHANGE-2026-026) keys its all-scenes warning
 * on this digest, not on the full fingerprint. */
function narrationContextDigest(config) {
  const timing = config.timing || {};
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
  return sha256(stableStringify({
    voices: entries,
    tempo: timing.tempo != null ? timing.tempo : 1.0,
    gapSentence: timing.gapSentence != null ? timing.gapSentence : 0.24,
    gapTurn: timing.gapTurn != null ? timing.gapTurn : 0.44,
    lead: timing.lead != null ? timing.lead : 0.16,
    tail: timing.tail != null ? timing.tail : 0.58,
    backend: Object.values(voices)[0]?.backend || 'piper',
    pipeline: 3,
  }));
}

/* Identity for timings.json reuse. Unlike the speech-only fingerprint above,
 * this includes the scene topology and current silent runtimes because both
 * affect the measured production timeline without changing synthesized audio. */
function timingsFingerprint(config) {
  return sha256(stableStringify({
    audio: audioFingerprint(config),
    scenes: (config.scenes || []).map(scene => ({
      id: scene.id,
      turns: (scene.vo || []).length,
      silentDur: (scene.vo || []).length === 0 ? scene.dur : null,
      minDur: (scene.vo || []).length > 0 ? (scene.minDur ?? null) : null,
      ...(scene.clipAudio ? { clipAudio: {
        authority: scene.clipAudio.authority,
        wordTimings: scene.clipAudio.wordTimings || null,
      } } : {}),
    })),
  }));
}

module.exports = { audioFingerprint, timingsFingerprint, narrationContextDigest };
