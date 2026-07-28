'use strict';
/* Change planner: compare the current project against its last manifest
 * and classify what changed. Answers "what will rebuild?" before any
 * expensive work runs. */

const fs = require('fs');
const path = require('path');
const { compile, read, hashConfig } = require('./manifest');
const { resolveConfig } = require('./schema');
const { loadProjectConfig } = require('./config');

const CHANGE_LEVELS = {
  NONE:           { label: 'no change',              icon: '=', synth: false, compose: false, render: false },
  CONFIG:         { label: 'config-only',            icon: '~', synth: false, compose: true,  render: true  },
  VISUAL:         { label: 'visual-only',            icon: '>', synth: false, compose: true,  render: true  },
  AUDIO:          { label: 'script changed',          icon: '+', synth: true,  compose: true,  render: true  },
  FULL:           { label: 'full rebuild',            icon: '!', synth: true,  compose: true,  render: true  },
};

function plan(fromManifest, toConfig, opts = {}) {
  const from = read(fromManifest);
  const to = compile(toConfig, { toolVersion: opts.toolVersion });

  const changes = [];
  const detail = {};

  // ---- config identity ---------------------------------------------------
  const fromHash = (from.hashes && from.hashes.config) || '';
  const toHash = hashConfig(toConfig);

  if (fromHash === toHash) {
    return { level: CHANGE_LEVELS.NONE, changes: [], detail, fromHash, toHash };
  }

  // ---- classify what changed ----------------------------------------------

  // Voices / format / timing change → full rebuild
  if (diffObj(from.voices, to.voices)) {
    changes.push('voices');
    return { level: CHANGE_LEVELS.FULL, changes, detail: { voices: diffDetail(from.voices, to.voices) }, fromHash, toHash };
  }
  if (diffObj(from.format, to.format)) {
    changes.push('format');
    return { level: CHANGE_LEVELS.FULL, changes, detail: { format: diffDetail(from.format, to.format) }, fromHash, toHash };
  }
  if (diffObj(from.timing, to.timing)) {
    changes.push('timing');
    detail.timing = diffDetail(from.timing, to.timing);
    changes.push('timing');
    return { level: CHANGE_LEVELS.FULL, changes, detail, fromHash, toHash };
  }

  // Backend change → full rebuild
  const fromBackend = from.environment && from.environment.backend;
  const toBackend = to.environment && to.environment.backend;
  if (fromBackend !== toBackend) {
    changes.push('backend (' + fromBackend + ' → ' + toBackend + ')');
    return { level: CHANGE_LEVELS.FULL, changes, detail: { backend: { from: fromBackend, to: toBackend } }, fromHash, toHash };
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
    if (sc.voChanged) {
      s.voChanged = sc.voChanged;
      hasVoChange = true;
    }
    if (sc.bodyChanged) {
      s.bodyChanged = true;
      hasVisualChange = true;
    }
    if (sc.clipChanged) s.clipChanged = true;
    if (sc.transitionChanged) s.transitionChanged = true;
    changes.push(s);
  }
  detail.scenes = sceneChanges;

  // Config-only changes (no scene or voice changes but config hash differs)
  // These are things like platform, theme, captions, bed/sfx, chrome, align, series
  if (!hasVoChange && !hasVisualChange && !hasStructureChange) {
    detail.configDiff = diffConfigTopLevel(from, to);
    return { level: CHANGE_LEVELS.CONFIG, changes, detail, fromHash, toHash };
  }

  // Structure change → full rebuild
  if (hasStructureChange) {
    return { level: CHANGE_LEVELS.FULL, changes, detail, fromHash, toHash };
  }

  // Visual-only → compose + render, no synth
  if (hasVisualChange && !hasVoChange) {
    return { level: CHANGE_LEVELS.VISUAL, changes, detail, fromHash, toHash };
  }

  // Script change → synth + compose + render
  return { level: CHANGE_LEVELS.AUDIO, changes, detail, fromHash, toHash };
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
    const entry = { id: t.id, fromIndex: f.index, toIndex: t.index };
    // Check VO changes
    const fvo = JSON.stringify((f.vo || []).map(v => ({ who: v.who, text: v.text, lang: v.lang })));
    const tvo = JSON.stringify((t.vo || []).map(v => ({ who: v.who, text: v.text, lang: v.lang })));
    if (fvo !== tvo) entry.voChanged = true;
    // Check body changes
    if (f.body !== t.body) entry.bodyChanged = true;
    // Check clip changes
    if (f.clip !== t.clip) entry.clipChanged = true;
    // Check transition changes
    if (f.transition !== t.transition) entry.transitionChanged = true;
    if (entry.voChanged || entry.bodyChanged || entry.clipChanged || entry.transitionChanged) {
      results.push(entry);
    }
  }
  return results;
}

function diffConfigTopLevel(from, to) {
  const checks = [
    { key: 'platform', from: from.project?.platform, to: to.project?.platform },
    { key: 'bed',      from: from.audio?.bed,       to: to.audio?.bed },
    { key: 'sfx',      from: from.audio?.sfx,       to: to.audio?.sfx },
    { key: 'captions', from: from.captions,          to: to.captions },
    { key: 'align',    from: from.align,             to: to.align },
    { key: 'series',   from: from.series,            to: to.series },
    { key: 'chrome',   from: from.chrome,            to: to.chrome },
    { key: 'theme',    from: from.theme,             to: to.theme },
  ];
  const diffs = [];
  for (const chk of checks) {
    if (JSON.stringify(chk.from) !== JSON.stringify(chk.to)) {
      diffs.push({ key: chk.key, from: chk.from, to: chk.to });
    }
  }
  return diffs;
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
  if (result.changes.length) {
    for (const c of result.changes) {
      if (typeof c === 'string') lines.push(`  • ${c}`);
      else if (c.scene) lines.push(`  • scene \"${c.scene}\":${c.voChanged ? ' vo' : ''}${c.bodyChanged ? ' body' : ''}${c.clipChanged ? ' clip' : ''}${c.added ? ' (added)' : ''}${c.removed ? ' (removed)' : ''}`);
    }
  }
  const steps = [];
  if (l.synth) steps.push('synth');
  if (l.compose) steps.push('compose');
  if (l.render) steps.push('render');
  lines.push(`  steps: ${steps.join(' → ') || 'none'}`);
  return lines.join('\n');
}

module.exports = { plan, CHANGE_LEVELS, loadCurrent, lastManifest, formatPlan };
