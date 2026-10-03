'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const machine = require('./machine');
const { narration } = require('./schema');

function formatTurn(row) {
  let text = `speech: scene ${row.sceneId} turn ${row.turn} [${row.who}] ${row.status}`;
  if (row.status === 'unavailable') return `${text}: ${row.reason || 'unavailable'}`;
  for (const d of row.differences || []) text += `; ${d.kind} ${JSON.stringify(d.expected.join(' '))} -> ${JSON.stringify(d.observed.join(' '))}`;
  return text;
}

function reviewSpeech(config, outDir) {
  const fingerprint = path.join(outDir, '.audio-fingerprint');
  if (!fs.existsSync(fingerprint) || fs.readFileSync(fingerprint, 'utf8').trim() !== require('./audio-fingerprint').audioFingerprint(config)) {
    const turns = config.scenes.flatMap((s, i) => (s.vo || []).map((t, turn) => ({ scene:i+1, sceneId:s.id, turn, who:t.who, expectedText:t.text, transcript:null, differences:[], status:'unavailable', reason:'audio inputs changed or completed synthesis identity is missing; synthesize first' })));
    return { schema:'narova.speech-check/1', turns, counts:{match:0,mismatch:0,unavailable:turns.length}, uncertainty:'ASR transcript differences are evidence, not proof of a speech error.' };
  }
  const { findPython, TOOL_ROOT } = require('./pipeline');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-speech-review-'));
  try {
    const configFile = path.join(dir, 'config.json'), narrationFile = path.join(dir, 'narration.json');
    fs.writeFileSync(configFile, JSON.stringify(config));
    fs.writeFileSync(narrationFile, JSON.stringify(narration(config)));
    const args = ['-m', 'narova_tts.speech_check', '--review', outDir, '--config', configFile, '--narration', narrationFile];
    const turns = config.scenes.reduce((n, s) => n + (s.vo || []).length, 0);
    const r = spawnSync(findPython(config.projectDir), args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: Math.max(150000, turns * 125000),
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: path.join(TOOL_ROOT, 'py') + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '') } });
    if (r.stderr) process.stderr.write(machine.redact(r.stderr));
    if (r.error || r.status !== 0) throw new Error(`speech review failed: ${r.error?.message || 'recognizer helper failed; verify optional speech dependencies'}`);
    const result = JSON.parse(r.stdout);
    if (result.schema !== 'narova.speech-check/1' || !Array.isArray(result.turns)) throw new Error('invalid speech review result');
    return result;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
module.exports = { reviewSpeech, formatTurn };
