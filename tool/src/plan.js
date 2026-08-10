'use strict';
/* Change planner: compare the current project against its last manifest
 * and classify what changed. Answers "what will rebuild?" before any
 * expensive work runs.

 * Pipeline stages (ordered):
 *   tts       — text-to-speech synthesis (narration audio)
 *   align     — forced word alignment (optional, post-synth)
 *   mix       — audio mixing (bed + SFX + narration into full.wav)
 *   capture   — narration-timed walkthrough recording (explicit)
 *   compose   — selected renderer project generation
 *   render    — video rendering + ffmpeg delivery encode
 *
 * Rationale: a bed/SFX change should re-trigger the audio mix but
 * not re-run TTS. A captions-only change should avoid synth entirely.
 * The planner now distinguishes all six stages. */

const fs = require('fs');
const path = require('path');
const { compile, read, hashConfig, buildHashes } = require('./manifest');
const { resolveConfig } = require('./schema');
const { loadProjectConfig } = require('./config');
const { captureStatus } = require('./walkthrough');

const STAGE = {
  NONE:    { label: 'no change',             icon: '=', tts: false, align: false, mix: false, capture: false, compose: false, render: false },
  CONFIG:  { label: 'config-only',           icon: '~', tts: false, align: false, mix: false, capture: false, compose: true,  render: true  },
  MIX:     { label: 'audio-mix only',        icon: '♪', tts: false, align: false, mix: true,  capture: false, compose: true,  render: true  },
  ALIGN:   { label: 'alignment changed',     icon: '↻', tts: false, align: true,  mix: true,  capture: false, compose: true,  render: true  },
  CAPTURE: { label: 'walkthrough recapture', icon: '◉', tts: false, align: false, mix: false, capture: true,  compose: true,  render: true  },
  VISUAL:  { label: 'visual-only',           icon: '>', tts: false, align: false, mix: false, capture: false, compose: true,  render: true  },
  AUDIO:   { label: 'script changed',        icon: '+', tts: true,  align: true,  mix: true,  capture: false, compose: true,  render: true  },
  FULL:    { label: 'full rebuild',          icon: '!', tts: true,  align: true,  mix: true,  capture: false, compose: true,  render: true  },
};

const CHANGE_LEVELS = STAGE; // legacy alias

function plan(fromManifestPath, toConfig, opts = {}) {
  const from = read(fromManifestPath);
  const to = compile(toConfig, { toolVersion: opts.toolVersion });
  const projectDir = toConfig.projectDir || '.';
  const hasWalkthroughs = Object.keys(to.walkthroughs || {}).length > 0;
  const withCapture = (level, needed) => needed && hasWalkthroughs
    ? { ...level, capture: true }
    : level;
  // Alignment can change measured word/turn timings without changing the
  // narration-audio fingerprint. Until synth rewrites the manifest with the
  // new align config, a currently fresh take still needs a post-align capture.
  const hasAlignConfigChange = diffObj(from.align, to.align);

  const changes = [];
  const detail = {};

  // ---- config identity ---------------------------------------------------
  const fromHash = (from.hashes && from.hashes.config) || '';
  const toHash = hashConfig(toConfig);
  const toHashes = buildHashes(toConfig, projectDir);

  // ---- asset content check -----------------------------------------------
  let hasAssetChange = false;
  const assetDiffs = [];
  if (from.hashes && toHashes) {
    // Check bed/sfx/clip hashes.
    const checkKeys = new Set([...Object.keys(from.hashes), ...Object.keys(toHashes)]);
    for (const k of checkKeys) {
      if (k === 'config' || k === 'themeCss') continue;
      if (from.hashes[k] !== toHashes[k]) {
        hasAssetChange = true;
        assetDiffs.push({ file: k, from: from.hashes[k]?.slice(0,8) || 'none', to: toHashes[k]?.slice(0,8) || 'none' });
      }
    }
  }
  const staleWalkthroughAssets = hasWalkthroughs
    && walkthroughAssetsNeedCapture(fromManifestPath, toConfig);
  const captureRequired = staleWalkthroughAssets
    || (hasWalkthroughs && hasAlignConfigChange);

  // Capture freshness is an independent project invariant: a missing take has
  // no asset hash to differ, while a newly captured fresh take does. Do not
  // make recapture depend on whether the asset tree happened to change.
  if (fromHash === toHash && !hasAssetChange) {
    if (staleWalkthroughAssets) {
      return {
        level: STAGE.CAPTURE,
        changes: ['walkthrough capture stale'],
        detail: { capture: 'missing or stale' },
        fromHash,
        toHash,
      };
    }
    return { level: STAGE.NONE, changes: [], detail: {}, fromHash, toHash };
  }

  if (hasAssetChange) {
    detail.assetDiffs = assetDiffs;
  }

  // ---- classify what changed ----------------------------------------------

  // Voices / format / timing / backend change → full rebuild
  if (diffObj(from.voices, to.voices)) {
    changes.push('voices');
    detail.voices = diffDetail(from.voices, to.voices);
    return {
      level: withCapture(STAGE.FULL, captureRequired),
      changes, detail, fromHash, toHash,
    };
  }
  if (diffObj(from.format, to.format)) {
    changes.push('format');
    detail.format = diffDetail(from.format, to.format);
    return {
      level: withCapture(STAGE.FULL, captureRequired),
      changes, detail, fromHash, toHash,
    };
  }
  if (diffObj(from.timing, to.timing)) {
    changes.push('timing');
    detail.timing = diffDetail(from.timing, to.timing);
    return {
      level: withCapture(STAGE.FULL, captureRequired),
      changes, detail, fromHash, toHash,
    };
  }

  // Backend change → full rebuild
  const fromBackend = from.environment && from.environment.backend;
  const toBackend = to.environment && to.environment.backend;
  if (fromBackend !== toBackend) {
    changes.push('backend (' + fromBackend + ' \u2192 ' + toBackend + ')');
    detail.backend = { from: fromBackend, to: toBackend };
    return {
      level: withCapture(STAGE.FULL, captureRequired),
      changes, detail, fromHash, toHash,
    };
  }

  // Scene-level diffs
  const sceneChanges = diffScenes(from.scenes || [], to.scenes || []);
  let hasVoChange = false;
  let hasVisualChange = false;
  let hasStructureChange = false;

  for (const sc of sceneChanges) {
    const s = { scene: sc.id, fromIndex: sc.fromIndex, toIndex: sc.toIndex };
    if (sc.added || sc.removed) {
      s.added = sc.added;
      s.removed = sc.removed;
      hasStructureChange = true;
    }
    if (sc.idChanged) {
      s.idChanged = true;
      s.fromId = sc.fromId;
      s.toId = sc.toId;
      hasStructureChange = true;
    }
    if (sc.voChanged) { s.voChanged = sc.voChanged; hasVoChange = true; }
    if (sc.bodyChanged) { s.bodyChanged = true; hasVisualChange = true; }
    if (sc.visualChanged) { s.visualChanged = true; hasVisualChange = true; }
    if (sc.clipChanged) { s.clipChanged = true; hasVisualChange = true; }
    if (sc.walkthroughChanged) {
      s.walkthroughChanged = true;
      hasVisualChange = true;
    }
    if (sc.transitionChanged) { s.transitionChanged = true; hasVisualChange = true; }
    if (sc.hashChanged) { s.hashChanged = true; }
    changes.push(s);
  }
  detail.scenes = sceneChanges;

  // ---- config-level changes (bed, sfx, captions, align, chrome, theme) ----
  const configDiffs = diffConfigTopLevel(from, to, fromHash, toHash, hasAssetChange);
  detail.configDiff = configDiffs;
  const walkthroughConfigDiff = configDiffs.find(d => d.key === 'walkthroughs');
  const hasWalkthroughConfigChange = Boolean(
    walkthroughConfigDiff
    && diffObj(
      walkthroughExecutionProjection(walkthroughConfigDiff.from),
      walkthroughExecutionProjection(walkthroughConfigDiff.to),
    ),
  );
  const hasBedSfxChange = configDiffs.some(d => d.key === 'bed' || d.key === 'sfx');
  const hasAssetBedSfxChange = assetDiffs.some(d => d.file && (
    d.file.endsWith('.mp3') || d.file.endsWith('.wav') || d.file.endsWith('.ogg')
    || d.file.endsWith('.flac') || d.file.endsWith('.m4a') || d.file.endsWith('.aac')
  ));
  const needsMix = hasBedSfxChange || (hasAssetChange && hasAssetBedSfxChange);
  const withMix = level => needsMix && !level.mix ? { ...level, mix: true } : level;

  // Structure change → full rebuild
  if (hasStructureChange) {
    return {
      level: withCapture(STAGE.FULL, captureRequired),
      changes, detail, fromHash, toHash,
    };
  }

  // Config-only changes with bed/SFX → MIX (audio mix, no TTS)
  if (!hasVoChange && !hasVisualChange && !hasStructureChange) {
    if (hasAlignConfigChange) {
      return {
        level: withCapture(STAGE.ALIGN, captureRequired),
        changes, detail, fromHash, toHash,
      };
    }
    if (hasWalkthroughConfigChange) {
      return {
        level: withMix(captureRequired ? STAGE.CAPTURE : STAGE.CONFIG),
        changes, detail, fromHash, toHash,
      };
    }
    if (needsMix) {
      return {
        level: withCapture(STAGE.MIX, captureRequired),
        changes, detail, fromHash, toHash,
      };
    }
    if (hasAssetChange) {
      return {
        level: withCapture(STAGE.CONFIG, captureRequired),
        changes, detail, fromHash, toHash,
      };
    }
    return {
      level: withCapture(STAGE.CONFIG, captureRequired),
      changes, detail, fromHash, toHash,
    };
  }

  // Visual-only → compose + render, no synth
  if (hasVisualChange && !hasVoChange) {
    return {
      level: withMix(withCapture(
        STAGE.VISUAL,
        captureRequired,
      )),
      changes, detail, fromHash, toHash,
    };
  }

  // Script change → synth + align + mix + compose + render
  return {
    level: withCapture(STAGE.AUDIO, captureRequired),
    changes, detail, fromHash, toHash,
  };
}

/* ---- helpers -------------------------------------------------------------- */

function diffObj(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function diffDetail(a, b) {
  const changes = [];
  const allKeys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of allKeys) {
    if (JSON.stringify(a && a[k]) !== JSON.stringify(b && b[k])) {
      changes.push({ key: k, from: a && a[k], to: b && b[k] });
    }
  }
  return changes;
}

function diffScenes(fromScenes, toScenes) {
  const results = [];
  const maxLen = Math.max(fromScenes.length, toScenes.length);
  for (let i = 0; i < maxLen; i++) {
    const f = fromScenes[i];
    const t = toScenes[i];
    if (!f) { results.push({ id: t.id, fromIndex: i, toIndex: i, added: true }); continue; }
    if (!t) { results.push({ id: f.id, fromIndex: i, toIndex: i, removed: true }); continue; }
    const entry = {
      id: t.id,
      fromId: f.id,
      toId: t.id,
      fromIndex: f.index,
      toIndex: t.index,
    };
    if (f.id !== t.id) entry.idChanged = true;
    const fvo = JSON.stringify((f.vo || []).map(v => ({ who: v.who, text: v.text, lang: v.lang, synthesisText: v.synthesisText })));
    const tvo = JSON.stringify((t.vo || []).map(v => ({ who: v.who, text: v.text, lang: v.lang, synthesisText: v.synthesisText })));
    if (fvo !== tvo) entry.voChanged = true;
    if (f.body !== t.body) entry.bodyChanged = true;
    if (JSON.stringify(f.visual) !== JSON.stringify(t.visual)) entry.visualChanged = true;
    if (f.clip !== t.clip) entry.clipChanged = true;
    if (JSON.stringify(f.walkthrough) !== JSON.stringify(t.walkthrough)) {
      entry.walkthroughChanged = true;
    }
    if (f.transition !== t.transition) entry.transitionChanged = true;
    if (f.hash !== t.hash) entry.hashChanged = true;
    if (entry.idChanged || entry.voChanged || entry.bodyChanged || entry.visualChanged || entry.clipChanged || entry.walkthroughChanged || entry.transitionChanged || entry.hashChanged) {
      results.push(entry);
    }
  }
  return results;
}

function diffConfigTopLevel(from, to, fromHash, toHash, hasAssetChange) {
  const checks = [
    { key: 'renderer', from: from.renderer,          to: to.renderer },
    { key: 'platform', from: from.project?.platform, to: to.project?.platform },
    { key: 'bed',      from: from.audio?.bed,       to: to.audio?.bed },
    { key: 'sfx',      from: from.audio?.sfx,       to: to.audio?.sfx },
    { key: 'captions', from: from.captions,          to: to.captions },
    { key: 'align',    from: from.align,             to: to.align },
    { key: 'series',   from: from.series,            to: to.series },
    { key: 'chrome',   from: from.chrome,            to: to.chrome },
    { key: 'theme',    from: from.theme,             to: to.theme },
    { key: 'walkthroughs', from: from.walkthroughs || {}, to: to.walkthroughs || {} },
  ];
  const diffs = [];
  for (const chk of checks) {
    if (JSON.stringify(chk.from) !== JSON.stringify(chk.to)) {
      diffs.push({ key: chk.key, from: chk.from, to: chk.to });
    }
  }
  return diffs;
}

function walkthroughExecutionProjection(walkthroughs) {
  return Object.fromEntries(Object.entries(walkthroughs || {}).map(([id, flow]) => {
    // `title` is generated Narova browser chrome, not browser execution.
    const { title: _title, ...execution } = flow || {};
    return [id, execution];
  }));
}

function walkthroughAssetsNeedCapture(fromManifestPath, config) {
  const outDir = path.dirname(fromManifestPath);
  const timingsPath = path.join(outDir, 'timings.json');
  let timings = null;
  try {
    timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  } catch {
    return true;
  }
  return Object.keys(config.walkthroughs || {}).some(
    id => !captureStatus(config, id, timings, { outDir }).ok,
  );
}

/* ---- CLI integration helpers --------------------------------------------- */

async function loadCurrent(projectDir) {
  const { raw, dir } = await loadProjectConfig(projectDir);
  const config = resolveConfig(raw, {}, dir);
  return { config, dir };
}

function lastManifest(outDir) {
  const mp = path.join(outDir, 'manifest.json');
  return fs.existsSync(mp) ? mp : null;
}

function formatPlan(result, opts = {}) {
  const l = result.level;
  const lines = [];
  lines.push(`${l.icon} ${l.label}`);
  lines.push(`  config: ${result.fromHash?.slice(0,8) || 'none'} → ${result.toHash?.slice(0,8) || 'none'}`);

  if (result.detail?.assetDiffs?.length) {
    lines.push(`  assets changed (${result.detail.assetDiffs.length} file(s)):`);
    for (const a of result.detail.assetDiffs.slice(0, 5)) {
      lines.push(`    • ${a.file}: ${a.from} → ${a.to}`);
    }
    if (result.detail.assetDiffs.length > 5) lines.push(`    ... +${result.detail.assetDiffs.length - 5} more`);
  }
  if (result.changes.length) {
    for (const c of result.changes) {
      if (typeof c === 'string') lines.push(`  • ${c}`);
      else if (c.scene) lines.push(`  • scene "${c.scene}":${c.voChanged ? ' vo' : ''}${c.bodyChanged ? ' body' : ''}${c.visualChanged ? ' visual' : ''}${c.clipChanged ? ' clip' : ''}${c.walkthroughChanged ? ' walkthrough' : ''}${c.added ? ' (added)' : ''}${c.removed ? ' (removed)' : ''}`);
    }
  }
  if (result.detail?.configDiff?.length) {
    lines.push(`  config diffs: ${result.detail.configDiff.map(d => d.key).join(', ')}`);
  }
  const steps = [];
  if (l.tts) steps.push('tts');
  if (l.align) steps.push('align');
  if (l.mix) steps.push('mix');
  if (l.capture) steps.push('walkthrough capture');
  if (l.compose) steps.push('compose');
  if (l.render) steps.push('render');
  lines.push(`  steps: ${steps.join(' → ') || 'none'}`);
  return lines.join('\n');
}

module.exports = { plan, CHANGE_LEVELS, STAGE, loadCurrent, lastManifest, formatPlan };
