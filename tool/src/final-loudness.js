'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const duration = file => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
function applyFinalLoudness(config, audioDir, log = () => {}) {
  const request = config.mix?.loudness;
  if (!request) return null;
  const mix = path.join(audioDir, 'mix.wav');
  const source = fs.existsSync(mix) ? mix : path.join(audioDir, 'full.wav');
  const pending = path.join(audioDir, 'mix.loudness.pending.wav');
  fs.rmSync(pending, { force: true });
  const { target, peak, lra } = request;
  const filter = `loudnorm=I=${target}:TP=${peak}:LRA=${lra}`;
  try {
    // First pass measures the complete current mix, including all authored layers.
    let report;
    const { spawnSync } = require('child_process');
    const analysis = spawnSync('ffmpeg', ['-hide_banner', '-i', source, '-af', `${filter}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    if (analysis.error || analysis.status !== 0) throw new Error('final loudness analysis failed');
    const match = analysis.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
    if (!match) throw new Error('final loudness analysis produced no measurements');
    report = JSON.parse(match[0]);
    const measured = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'];
    // Silence has no finite integrated loudness; preserve it without inventing gain.
    const finite = measured.every(k => Number.isFinite(Number(report[k])));
    const normalize = finite ? `${filter}:measured_I=${report.input_i}:measured_TP=${report.input_tp}:measured_LRA=${report.input_lra}:measured_thresh=${report.input_thresh}:offset=${report.target_offset}:linear=true` : 'anull';
    const seconds = duration(source);
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-af', `${normalize},apad=whole_dur=${seconds}`, '-t', String(seconds), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', pending], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (Math.abs(duration(pending) - seconds) > 0.005) throw new Error('final loudness processing changed soundtrack duration');
    fs.renameSync(pending, mix);
    log(`  final loudness: target ${target} LUFS, peak ${peak} dBTP -> mix.wav${finite ? '' : ' (source has no finite loudness)'}`);
    return { file: mix, request, duration: seconds, measuredInput: report };
  } catch (error) {
    fs.rmSync(mix, { force: true });
    throw error;
  } finally { fs.rmSync(pending, { force: true }); }
}
module.exports = { applyFinalLoudness };
