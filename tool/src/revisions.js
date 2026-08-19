'use strict';
/* CHANGE-2026-026 — revision ledger and measured reuse evidence (advisory).
 *
 *   NAR-009-025  revision recording: a revision is a change in the effective
 *                resolved project state between two builds. State identity is
 *                computed from authored inputs (the compiled manifest minus
 *                volatile timestamps, plus output-affecting build options) —
 *                never from artifact bytes — so a rebuild of identical
 *                authored state records no revision even if encoding differs.
 *                The ledger (out/revisions.jsonl) is append-only; loss or
 *                truncation never fails an operation and history restarts at
 *                the next ordinal. A ledger write failure after a successful
 *                build is reported but never fails the build.
 *   NAR-007-036  realized-reuse evidence: every successful build emits a
 *                measured reuse record — per-scene audio byte-identity by
 *                content digest, span reuse/identity-render/fallback classes,
 *                sentence-cache hit and fresh counts, and shared artifacts
 *                rebuilt by design. Measured facts only; fallback re-renders
 *                are never counted as reuse.
 *   NAR-007-037  every ratio states measured-or-predicted and its unit;
 *                unevidenced quantities are null (not applicable), never
 *                invented.
 *
 * Variant members never record revisions (the base build owns the ledger).
 * All surfaces here are advisory: no gate consumes them. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { compile, withoutToolchainVersionEvidence } = require('./manifest');
const { audioFingerprint, timingsFingerprint, narrationContextDigest } = require('./audio-fingerprint');
const { renderContextHash } = require('./scene-cache');

const LEDGER_NAME = 'revisions.jsonl';
const RECORD_VERSION = 1;

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hashFile(filePath) {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch {
    return null;
  }
}

/* Authored-state identity. Compiled manifest minus volatile timestamps
 * (project.created, environment.compiled), plus the build options that
 * affect output identity (renderer selection, backend override, frame rate,
 * quality — the scene-cache identity inputs of NAR-007-010). Identical
 * authored state + identical options always yield the same identity. */
function stateIdentity(config, opts = {}) {
  const manifest = compile(config, { toolVersion: require('../package.json').version });
  const stable = JSON.parse(JSON.stringify(withoutToolchainVersionEvidence(manifest), (k, v) =>
    ((k === 'created' || k === 'compiled')) ? undefined : v));
  return sha256(JSON.stringify({
    manifest: stable,
    build: {
      renderer: opts.renderer || null,
      backend: opts.backend || null,
      fps: opts.fps || null,
      quality: opts.quality || null,
    },
  }));
}

/* Post-synthesis manifest identity (the enriched document actually on disk,
 * volatile timestamps stripped). This is the measured build's canonical
 * artifact identity — distinct from stateIdentity, which is authored. */
function manifestIdentity(manifest) {
  const stable = JSON.parse(JSON.stringify(withoutToolchainVersionEvidence(manifest), (k, v) =>
    ((k === 'created' || k === 'compiled')) ? undefined : v));
  return sha256(JSON.stringify(stable));
}

/* Per-scene narration identity: ordered turns of who/text/language/
 * synthesis-text/take — everything scene-scoped that drives speech. Shared
 * with the recorded sceneIdentities entries so two revisions classify from
 * the records alone (NAR-007-035). */
function narrationDigest(scene) {
  const turns = (scene.vo || []).map(turn => ({
    who: turn.who,
    text: turn.text,
    ...(turn.lang ? { lang: turn.lang } : {}),
    ...(turn.synthesisText ? { synthesisText: turn.synthesisText } : {}),
    ...(turn.take != null ? { take: turn.take } : {}),
  }));
  return sha256(JSON.stringify(turns));
}

/* Per-scene classification inputs for a freshly compiled (un-enriched)
 * manifest. `sentences` is filled from take evidence when available. */
function sceneProjection(manifest, sentenceCountsByScene = null) {
  return (manifest.scenes || []).map(s => ({
    id: s.id,
    digest: s.hash || null,                 // full authored content identity
    narration: narrationDigest(s),          // speech-side identity
    silentDur: s.dur || null,               // authored silent duration
    duration: s.duration || null,           // measured (records only)
    sentences: sentenceCountsByScene ? (sentenceCountsByScene[s.id] ?? null) : null,
  }));
}

function sentenceCountsFromTakes(outDir) {
  try {
    const takes = JSON.parse(fs.readFileSync(path.join(outDir, 'audio', 'takes.json'), 'utf8'));
    if (!Array.isArray(takes)) return null;
    const counts = {};
    for (const t of takes) {
      if (t && t.sceneId) counts[t.sceneId] = (counts[t.sceneId] || 0) + 1;
    }
    return counts;
  } catch {
    return null;
  }
}

function ledgerPath(outDir) {
  return path.join(outDir, LEDGER_NAME);
}

/* Parse the append-only ledger. A partial/corrupt tail (interrupted append)
 * is ignored: the longest parseable prefix is the history. Returns [] when
 * the ledger is missing or empty. */
function readLedger(outDir) {
  let text;
  try { text = fs.readFileSync(ledgerPath(outDir), 'utf8'); } catch { return []; }
  const records = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      break;
    }
  }
  return records;
}

function appendRecord(outDir, record) {
  fs.mkdirSync(path.dirname(ledgerPath(outDir)), { recursive: true });
  fs.appendFileSync(ledgerPath(outDir), JSON.stringify(record) + '\n');
}

/* Measured per-scene processed-audio digests (out/audio/NN.wav, scene order
 * from the enriched manifest). A missing file yields null = not applicable
 * (external narration writes no per-scene audio). */
function sceneAudioDigests(outDir, scenes) {
  const digests = {};
  (scenes || []).forEach((s, i) => {
    const file = path.join(outDir, 'audio', `${String(i + 1).padStart(2, '0')}.wav`);
    digests[s.id] = hashFile(file);
  });
  return digests;
}

/* Sentence-cache counts from the take-identity evidence the synthesis stage
 * already writes (audio/takes.json, NAR-018-070). Null when absent — not
 * applicable (external narration, reused timings, pre-evidence build). */
function sentenceCacheCounts(outDir) {
  let takes;
  try {
    takes = JSON.parse(fs.readFileSync(path.join(outDir, 'audio', 'takes.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(takes)) return null;
  let hits = 0;
  for (const t of takes) if (t && t.cacheHit) hits++;
  return { hits, fresh: takes.length - hits, total: takes.length, basis: 'measured', unit: 'sentence count' };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/* Assemble the measured reuse record for one completed build.
 * `previous` is the previous revision record (or null). `renderReuse` is the
 * scene-cache reuse summary attached by renderToMp4 (or null when spans are
 * not applicable, e.g. per-preset deliverable renders). Every ratio states
 * its basis and unit; unevidenced quantities are null. */
function measuredReuseRecord({ outDir, manifest, previous, renderReuse, deliverableCount = 0, videoName = null }) {
  const scenes = (manifest && manifest.scenes) || [];
  const digests = sceneAudioDigests(outDir, scenes);
  const prevAudio = (previous && previous.sceneAudio) || null;

  let identicalSeconds = 0;
  let evidencedSeconds = 0;
  let scenesIdentical = 0;
  let scenesEvidenced = 0;
  const perScene = scenes.map((s) => {
    const digest = digests[s.id];
    const prevDigest = prevAudio ? prevAudio[s.id] : undefined;
    const hasEvidence = digest != null && prevDigest != null;
    const identical = hasEvidence ? digest === prevDigest : null;
    if (hasEvidence) {
      scenesEvidenced++;
      evidencedSeconds += s.duration || 0;
      if (identical) {
        scenesIdentical++;
        identicalSeconds += s.duration || 0;
      }
    }
    return { sceneId: s.id, audioDigest: digest, audioIdenticalToParent: identical };
  });

  const audio = scenesEvidenced
    ? {
        basis: 'measured',
        unit: 'duration-weighted scene audio',
        identicalSeconds: round3(identicalSeconds),
        evidencedSeconds: round3(evidencedSeconds),
        ratio: evidencedSeconds > 0 ? round3(identicalSeconds / evidencedSeconds) : null,
        scenesIdentical,
        scenesEvidenced,
        scenesTotal: scenes.length,
      }
    : { basis: 'measured', unit: 'duration-weighted scene audio', ratio: null, note: 'not applicable — no prior per-scene audio evidence' };

  const spans = renderReuse
    ? (renderReuse.mode === 'whole-video'
        ? {
            basis: 'measured',
            mode: 'whole-video',
            wholeVideoReused: renderReuse.wholeVideoReused === true,
            note: renderReuse.wholeVideoReused === true
              ? 'whole-video render reused — render skipped'
              : (renderReuse.selectiveSkipped
                  ? `selective render skipped — ${renderReuse.selectiveSkipped}`
                  : 'whole-video render re-rendered'),
            unit: 'scene span count',
          }
        : {
            basis: 'measured',
            mode: renderReuse.mode || null,
            fallback: renderReuse.fallback || null,
            selectiveSkipped: renderReuse.selectiveSkipped || null,
            perScene: renderReuse.spans
              ? renderReuse.spans.map(sp => ({
                sceneId: sp.sceneId,
                status: sp.status, // 'reused' | 'rendered' | 'fallback'
                seconds: round3(sp.seconds || 0),
              }))
              : null,
            reusedCount: renderReuse.spans ? renderReuse.spans.filter(sp => sp.status === 'reused').length : null,
            totalCount: renderReuse.spans ? renderReuse.spans.length : null,
            unit: 'scene span count',
          })
    : { basis: 'measured', unit: 'scene span count', ratio: null, note: 'not applicable — render spans not used by this build path' };

  const rebuiltByDesign = [];
  if (videoName) rebuiltByDesign.push(`encoded video (${videoName})`);
  const full = path.join(outDir, 'audio', 'full.wav');
  if (fs.existsSync(full)) rebuiltByDesign.push('full narration track (audio/full.wav)');
  const mix = path.join(outDir, 'audio', 'mix.wav');
  if (fs.existsSync(mix)) rebuiltByDesign.push('narration + bed/sfx mix (audio/mix.wav)');
  if (deliverableCount > 0) rebuiltByDesign.push(`${deliverableCount} delivery member(s)`);

  return {
    basis: 'measured',
    audio,
    spans,
    sentences: sentenceCacheCounts(outDir),
    rebuiltByDesign,
  };
}

/* One-line human summary of a measured reuse record (build output). */
function formatMeasuredSummary(measured) {
  if (!measured) return '';
  const parts = [];
  const a = measured.audio;
  if (a && a.ratio != null) {
    parts.push(`${a.scenesIdentical}/${a.scenesEvidenced} scene audio byte-identical (${Math.round(a.ratio * 100)}% by ${a.unit})`);
  } else if (a && a.note) {
    parts.push('scene audio reuse not applicable');
  }
  const sp = measured.spans;
  if (sp && sp.perScene) {
    parts.push(`${sp.reusedCount}/${sp.totalCount} render spans reused (${sp.unit})`);
  } else if (sp && sp.mode === 'whole-video') {
    parts.push(sp.wholeVideoReused ? 'whole-video render reused' : 'whole-video render re-rendered');
  } else if (sp && sp.note) {
    parts.push('span reuse not applicable');
  }
  const se = measured.sentences;
  if (se) parts.push(`sentences ${se.hits}/${se.total} served from cache (${se.unit})`);
  return parts.join(', ');
}

/* End-of-build recording. Appends exactly one revision record when the
 * effective resolved state differs from the latest recorded revision;
 * reports no-change otherwise. Advisory: any failure is reported and
 * swallowed — the completed build's success is never undone. */
function recordRevision({ config, opts = {}, outDir, manifest, renderReuse, deliverableCount = 0, videoName = null, stageDurations = null, log = () => {} }) {
  try {
    const records = readLedger(outDir);
    const last = records.length ? records[records.length - 1] : null;
    const measured = measuredReuseRecord({
      outDir, manifest, previous: last, renderReuse, deliverableCount, videoName,
    });
    const summary = formatMeasuredSummary(measured);

    // Variant members never record revisions (NAR-009-025).
    if (config && config.variant) return { recorded: false, variant: true };

    const identity = stateIdentity(config, opts);
    if (last && last.stateIdentity === identity) {
      log(`revisions: no change since v${last.ordinal} — no revision recorded${summary ? ` (measured reuse: ${summary})` : ''}`);
      return { recorded: false, ordinal: last.ordinal, measured };
    }

    const ordinal = last ? last.ordinal + 1 : 1;
    const scenes = (manifest && manifest.scenes) || [];
    const fps = opts.fps || (manifest && manifest.format && manifest.format.fps) || 30;
    const sentenceCounts = sentenceCountsFromTakes(outDir);
    const identities = scenes.map(s => ({
      id: s.id,
      digest: s.hash || null,
      narration: narrationDigest(s),
      silentDur: s.dur || null,
      duration: s.duration || null,
      sentences: sentenceCounts ? (sentenceCounts[s.id] ?? null) : null,
    }));
    const record = {
      v: RECORD_VERSION,
      ordinal,
      parent: last ? last.ordinal : null,
      recordedAt: new Date().toISOString(),
      stateIdentity: identity,
      audioFingerprint: audioFingerprint(config),
      narrationContext: narrationContextDigest(config),
      timingsFingerprint: timingsFingerprint(config),
      manifestIdentity: manifestIdentity(manifest),
      renderContextIdentity: manifest ? renderContextHash(manifest, { fps, quality: opts.quality }) : null,
      label: null,
      sceneIdentities: identities,
      sceneAudio: sceneAudioDigests(outDir, scenes),
      stageDurations,
      measuredReuse: measured,
    };
    appendRecord(outDir, record);
    log(`revisions: recorded v${ordinal}${last ? ` (parent v${last.ordinal})` : ''}${summary ? ` — reuse: ${summary}` : ''}`);
    return { recorded: true, ordinal, record, measured };
  } catch (e) {
    log(`revisions: could not record revision (${e.message}) — the build result is unaffected`);
    return { recorded: false, error: e.message };
  }
}

/* ---- revision-impact report (NAR-007-035, NAR-009-026..027) ---------------- *
 *
 * Classification is driven by per-scene identity inputs (content digest,
 * narration digest, authored silent duration) plus the shared render-context
 * identity. Both sides are projections of the same shape: a freshly
 * compiled manifest for "current", or a recorded revision's sceneIdentities
 * for pairwise record comparison — the latter needs no re-resolution. */

const SCENE_CLASS_LABELS = {
  unchanged: 'unchanged',
  narration: 'script changed',
  visual: 'visual changed',
  timing: 'timing changed',
  structural: 'structural change',
};

function classifyScenes(after, before) {
  const afterById = new Map(after.map(s => [s.id, s]));
  const beforeById = new Map(before.map(s => [s.id, s]));
  const beforeOrder = before.map(s => s.id).filter(id => afterById.has(id));
  const afterOrder = after.map(s => s.id).filter(id => beforeById.has(id));
  const moved = new Set();
  if (beforeOrder.join('\u0000') !== afterOrder.join('\u0000')) {
    for (let i = 0; i < beforeOrder.length; i++) {
      if (beforeOrder[i] !== afterOrder[i]) { moved.add(beforeOrder[i]); moved.add(afterOrder[i]); }
    }
  }

  const rows = [];
  for (const a of after) {
    const b = beforeById.get(a.id);
    if (!b) { rows.push({ sceneId: a.id, cls: 'structural', reason: 'added' }); continue; }
    if (moved.has(a.id)) { rows.push({ sceneId: a.id, cls: 'structural', reason: 'reordered' }); continue; }
    if (a.narration !== b.narration) { rows.push({ sceneId: a.id, cls: 'narration' }); continue; }
    const aDur = a.silentDur ?? null;
    const bDur = b.silentDur ?? null;
    if (aDur !== bDur) { rows.push({ sceneId: a.id, cls: 'timing' }); continue; }
    if ((a.digest || '') !== (b.digest || '')) { rows.push({ sceneId: a.id, cls: 'visual' }); continue; }
    rows.push({ sceneId: a.id, cls: 'unchanged' });
  }
  for (const b of before) {
    if (!afterById.has(b.id)) rows.push({ sceneId: b.id, cls: 'structural', reason: 'removed' });
  }
  return rows;
}

function derivedImpacts(row) {
  switch (row.cls) {
    case 'narration':
      return ['narration regenerated', 'captions retimed', 'scene re-rendered (timing changed)', 'visuals unchanged'];
    case 'visual':
      return ['scene re-rendered', 'audio retained'];
    case 'timing':
      return ['scene duration changed', 'timeline re-chained', 'scene re-rendered'];
    case 'structural':
      return ['timeline re-chained', row.reason === 'added' ? 'scene added'
        : row.reason === 'removed' ? 'scene removed' : 'scene moved'];
    default:
      return ['audio + render span retained'];
  }
}

/* Predicted reuse summary (NAR-007-035 + NAR-007-037 predicted side).
 * Audio retention follows narration identity: unchanged narration means the
 * sentence cache reproduces the scene's processed audio byte-for-byte.
 * Span reuse follows content+timing identity AND an unchanged shared render
 * context — and a duration-changing edit (narration/timing/structural)
 * shifts every LATER scene's start time, invalidating its span key even
 * though its content is untouched. The span prediction is conservative:
 * only unchanged scenes BEFORE the first duration-affecting change keep
 * their spans. Every number states its basis and unit and is recomputable
 * from the per-scene rows. */
function predictedReuse(rows, before, contextChanged, audioIdentityChanged = false) {
  const durOf = id => (before.find(s => s.id === id) || {}).duration || 0;
  const sentOf = id => (before.find(s => s.id === id) || {}).sentences;
  const sharedIds = rows.filter(r => r.cls !== 'structural').map(r => r.sceneId);
  const audioKeep = audioIdentityChanged
    ? []
    : rows.filter(r => r.cls === 'unchanged' || r.cls === 'visual' || r.cls === 'timing');
  const durationChanging = new Set(['narration', 'timing', 'structural']);
  let firstDurationChange = Infinity;
  rows.forEach((r, i) => { if (durationChanging.has(r.cls)) firstDurationChange = Math.min(firstDurationChange, i); });
  const cascade = !contextChanged && firstDurationChange < Infinity
    && rows.slice(firstDurationChange + 1).some(r => r.cls === 'unchanged');
  const spanKeep = contextChanged
    ? []
    : rows.filter((r, i) => r.cls === 'unchanged' && (audioIdentityChanged ? false : i < firstDurationChange));

  const audioSecondsKeep = audioKeep.reduce((n, r) => n + durOf(r.sceneId), 0);
  const audioSecondsTotal = sharedIds.reduce((n, id) => n + durOf(id), 0);
  const audio = audioIdentityChanged
    ? {
        basis: 'predicted',
        unit: 'duration-weighted scene audio',
        keepSeconds: 0,
        totalSeconds: round3(audioSecondsTotal),
        ratio: audioSecondsTotal > 0 ? 0 : null,
        scenesKeep: 0,
        scenesTotal: sharedIds.length,
        note: 'narration identity changed (voices, tempo, or timing gaps) — all speech re-synthesizes',
      }
    : audioSecondsTotal > 0
      ? {
          basis: 'predicted',
          unit: 'duration-weighted scene audio',
          keepSeconds: round3(audioSecondsKeep),
          totalSeconds: round3(audioSecondsTotal),
          ratio: round3(audioSecondsKeep / audioSecondsTotal),
          scenesKeep: audioKeep.length,
          scenesTotal: sharedIds.length,
          note: contextChanged ? 'render context changed — audio retention follows narration identity only' : null,
        }
      : { basis: 'predicted', unit: 'duration-weighted scene audio', ratio: null, note: 'not applicable — no prior per-scene durations' };

  const sentencesKeep = audioKeep.reduce((n, r) => n + (sentOf(r.sceneId) || 0), 0);
  const sentencesTotal = sharedIds.reduce((n, id) => n + (sentOf(id) || 0), 0);
  const sentences = audioIdentityChanged
    ? { basis: 'predicted', unit: 'sentence count', keep: 0, total: sentencesTotal, note: 'narration identity changed — no sentence reuse predicted' }
    : sentencesTotal > 0
      ? { basis: 'predicted', unit: 'sentence count', keep: sentencesKeep, total: sentencesTotal }
      : { basis: 'predicted', unit: 'sentence count', ratio: null, note: 'not applicable — no prior sentence evidence' };

  const spans = sharedIds.length
    ? {
        basis: 'predicted',
        unit: 'scene span count',
        keep: spanKeep.length,
        total: sharedIds.length,
        note: contextChanged
          ? 'render context changed — all spans re-render'
          : (audioIdentityChanged
              ? 'narration identity changed — all spans re-render'
              : (cascade ? 'scenes after a duration-changing edit re-render (start-time shift)' : null)),
      }
    : { basis: 'predicted', unit: 'scene span count', ratio: null, note: 'not applicable — no prior span evidence' };

  return { audio, spans, sentences };
}

/* Predicted render-cost estimate (NAR-007-035): derived from the baseline
 * record's measured stage durations applied to the predicted changed
 * surface. Omitted with a plain statement when no measured basis exists. */
function renderEstimate(baselineRecord, reuse) {
  const d = baselineRecord && baselineRecord.stageDurations;
  if (!d || (d.composeAndRender == null && d.synth == null)) {
    return { estimate: null, note: 'no measured stage durations recorded yet — estimate omitted' };
  }
  const spanFraction = reuse.spans && reuse.spans.total > 0 && reuse.spans.keep != null
    ? 1 - (reuse.spans.keep / reuse.spans.total) : null;
  const sentenceFraction = reuse.sentences && reuse.sentences.total > 0 && reuse.sentences.keep != null
    ? 1 - (reuse.sentences.keep / reuse.sentences.total) : null;
  const renderPart = d.composeAndRender != null && spanFraction != null
    ? d.composeAndRender * Math.max(spanFraction, 0.05) : null;
  const synthPart = d.synth != null && sentenceFraction != null
    ? d.synth * Math.max(sentenceFraction, 0.05) : null;
  const parts = [];
  if (renderPart != null) parts.push(renderPart);
  if (synthPart != null) parts.push(synthPart);
  if (!parts.length) return { estimate: null, note: 'no measured basis for the predicted surface — estimate omitted' };
  const seconds = parts.reduce((a, b) => a + b, 0);
  return {
    estimate: Math.round(seconds * 10) / 10,
    note: 'estimate — scaled from recorded measured stage durations',
  };
}

/* Build the full revision-impact report between a "current" projection (or
 * an after-record's sceneIdentities) and a baseline record.
 * `audioIdentityChanged` carries the project-level narration fingerprint
 * comparison (NAR-007-009): a tempo, voice, backend, or gap change
 * re-synthesizes every scene even when no scene's text changed, and the
 * predicted audio summary MUST say so instead of promising reuse. */
function buildRevisionReport({ currentScenes, currentContextIdentity, baselineRecord, afterRecord = null, audioIdentityChanged = false }) {
  const before = (baselineRecord && baselineRecord.sceneIdentities) || [];
  const after = afterRecord
    ? (afterRecord.sceneIdentities || [])
    : currentScenes;
  const contextChanged = !!afterRecord
    ? (baselineRecord.renderContextIdentity || '') !== (afterRecord.renderContextIdentity || '')
    : (baselineRecord.renderContextIdentity || '') !== (currentContextIdentity || '');
  const rows = classifyScenes(after, before);
  const reuse = predictedReuse(rows, before, contextChanged, audioIdentityChanged);
  const estimate = renderEstimate(baselineRecord, reuse);
  return {
    baseline: baselineRecord ? baselineRecord.ordinal : null,
    after: afterRecord ? afterRecord.ordinal : null,
    rows,
    contextChanged,
    audioIdentityChanged,
    reuse,
    estimate,
  };
}

/* Human formatter — the `narova diff` / `narova history compare` output. */
function formatRevisionImpact(report, { baselineName = null } = {}) {
  const L = [];
  const vs = baselineName || (report.baseline != null ? `v${report.baseline}` : 'baseline');
  L.push(`Revision impact (vs ${vs}${report.after != null ? `, v${report.after} after` : ''})`);
  L.push('');
  for (const row of report.rows) {
    const label = SCENE_CLASS_LABELS[row.cls] || row.cls;
    const suffix = row.reason ? ` (${row.reason})` : '';
    L.push(`  ${row.sceneId.padEnd(24)} ${label}${suffix}`);
    if (row.cls !== 'unchanged') {
      for (const impact of derivedImpacts(row)) L.push(`  ${' '.repeat(24)} ↳ ${impact}`);
    }
  }
  L.push('');
  if (report.contextChanged) {
    L.push('Project: shared render context changed — every scene span re-renders; per-scene classes above describe authored changes only');
    L.push('');
  }
  if (report.audioIdentityChanged) {
    L.push('Project: narration identity changed (voices, tempo, or timing gaps) — every scene re-synthesizes');
    L.push('');
  }
  L.push('Reused (predicted):');
  const a = report.reuse.audio;
  if (a.ratio != null && !a.note?.includes('re-synthesizes')) {
    L.push(`  audio      ${Math.round(a.ratio * 100)}%  (${a.scenesKeep}/${a.scenesTotal} scenes, ${a.keepSeconds}s of ${a.totalSeconds}s — ${a.unit})`);
  } else if (a.note) L.push(`  audio      ${a.note}`);
  const sp = report.reuse.spans;
  if (sp.keep != null) {
    L.push(`  spans      ${sp.keep}/${sp.total}  (${sp.unit}${sp.note ? `; ${sp.note}` : ''})`);
  } else if (sp.note) L.push(`  spans      not applicable — ${sp.note.split('— ')[1] || sp.note}`);
  const se = report.reuse.sentences;
  if (se.keep != null && !se.note) {
    L.push(`  sentences  ${se.keep}/${se.total}  (${se.unit})`);
  } else if (se.note) L.push(`  sentences  ${se.note}`);
  const est = report.estimate;
  L.push('');
  if (est.estimate != null) {
    const shown = est.estimate < 10 ? est.estimate.toFixed(1) : Math.round(est.estimate);
    L.push(`Estimated render: ~${shown}s (${est.note})`);
  } else {
    L.push(`Estimated render: omitted — ${est.note}`);
  }
  return L.join('\n');
}

/* One-line change summary for `narova history` rows: what changed relative
 * to this record's parent. The first revision summarizes itself as initial. */
function changeSummaryForRecord(record, parentRecord) {
  if (!parentRecord) return 'initial revision';
  const rows = classifyScenes(record.sceneIdentities || [], parentRecord.sceneIdentities || []);
  const counts = {};
  for (const r of rows) counts[r.cls] = (counts[r.cls] || 0) + 1;
  const parts = [];
  if (counts.narration) parts.push(`${counts.narration} narration`);
  if (counts.visual) parts.push(`${counts.visual} visual`);
  if (counts.timing) parts.push(`${counts.timing} timing`);
  if (counts.structural) parts.push(`${counts.structural} structural`);
  const contextNote = (record.renderContextIdentity || '') !== (parentRecord.renderContextIdentity || '')
    ? ' + render context' : '';
  // Narration-identity note keys on the SHARED context digest (voices/tempo/
  // gaps), not the full fingerprint — a single turn edit is already counted
  // as its scene's narration class.
  const audioNote = (record.narrationContext != null && parentRecord.narrationContext != null
    && record.narrationContext !== parentRecord.narrationContext)
    ? ' + narration identity' : '';
  if (parts.length) {
    const total = parts.reduce((n, p) => n + parseInt(p, 10), 0);
    return `${parts.join(', ')} scene change${total === 1 ? '' : 's'}${contextNote}${audioNote}`;
  }
  if (audioNote) return `narration identity change only${contextNote}`;
  if (contextNote) return 'render-context change only';
  return 'no per-scene change';
}

/* Annotate: rewrite only the label field of one record in place. The ledger
 * stays byte-identical for every other line. */
function annotateLedger(outDir, ordinal, label) {
  const p = ledgerPath(outDir);
  let text;
  try { text = fs.readFileSync(p, 'utf8'); } catch { return { ok: false, error: 'no revision ledger found' }; }
  const lines = text.split('\n');
  let found = false;
  const out = lines.map((line) => {
    const t = line.trim();
    if (!t || found) return line;
    try {
      const rec = JSON.parse(t);
      if (rec.ordinal === ordinal) {
        found = true;
        return JSON.stringify({ ...rec, label: String(label) });
      }
    } catch { /* keep unparseable tail lines byte-identical */ }
    return line;
  });
  if (!found) return { ok: false, error: `no revision v${ordinal} recorded` };
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, out.join('\n'));
  fs.renameSync(tmp, p);
  return { ok: true };
}

module.exports = {
  LEDGER_NAME,
  stateIdentity,
  manifestIdentity,
  narrationDigest,
  sceneProjection,
  readLedger,
  appendRecord,
  sceneAudioDigests,
  sentenceCacheCounts,
  sentenceCountsFromTakes,
  measuredReuseRecord,
  formatMeasuredSummary,
  recordRevision,
  buildRevisionReport,
  formatRevisionImpact,
  changeSummaryForRecord,
  annotateLedger,
};
