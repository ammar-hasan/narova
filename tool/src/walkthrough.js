'use strict';
/* Product walkthrough capture.
 *
 * The project model is intentionally driver-neutral: a walkthrough is a URL,
 * viewport, narration-anchored actions, and the scenes that display it.
 * agent-browser is the first execution adapter. Captured media and its
 * manifest are durable project assets under assets/walkthroughs/<id>/ (or a
 * variant-specific child when hook narration changes the capture timing).
 *
 * Capture is always explicit (`narova walkthrough capture`). Ordinary builds
 * only consume a fresh capture; they never replay web actions implicitly. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { ensureDir, probe, which } = require('./util');
const { audioFingerprint } = require('./audio-fingerprint');

const WALKTHROUGH_SCHEMA_VERSION = '1.0';
const CURSOR_RENDERER_VERSION = '2';
const DRIVER = 'agent-browser';
const DEFAULT_VIEWPORT = { w: 1440, h: 900 };
const DEFAULT_CURSOR = { enabled: true, travelMs: 280, color: '#d9ff57' };
const ACTIONS = new Set([
  'click', 'hover', 'fill', 'type', 'press', 'select', 'scroll', 'wait', 'screenshot',
]);
const TARGET_KEYS = ['role', 'text', 'label', 'placeholder', 'testid', 'css'];
const LAYOUTS = new Set(['window', 'full']);
const FITS = new Set(['contain', 'cover']);
const LOAD_STATES = new Set(['load', 'domcontentloaded', 'networkidle']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(
    Buffer.isBuffer(value) ? value : String(value),
  ).digest('hex');
}

function slug(value) {
  return String(value || 'narova').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'narova';
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function insideProject(baseDir, ref) {
  if (typeof ref !== 'string' || !ref.trim() || path.isAbsolute(ref)) return null;
  const target = path.resolve(baseDir, ref);
  const rel = path.relative(path.resolve(baseDir), target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return target;
}

function hasEmbeddedCredentials(value) {
  try {
    const url = new URL(value);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

function resolveProfile(value, baseDir) {
  const trimmed = value.trim();
  const candidate = path.resolve(baseDir, trimmed);
  const pathLike = path.isAbsolute(trimmed)
    || trimmed.startsWith('.')
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || fs.existsSync(candidate);
  return pathLike && !path.isAbsolute(trimmed) ? candidate : trimmed;
}

function validateTarget(target, at, errs) {
  if (!isPlainObject(target)) {
    errs.push(`${at}: expected a locator object such as { role: "button", name: "Create" }`);
    return null;
  }
  const keys = TARGET_KEYS.filter(k => target[k] != null);
  if (keys.length !== 1) {
    errs.push(`${at}: set exactly one locator (${TARGET_KEYS.join('|')})`);
    return null;
  }
  const key = keys[0];
  if (typeof target[key] !== 'string' || !target[key].trim()) {
    errs.push(`${at}.${key}: must be a non-empty string`);
    return null;
  }
  if (key === 'role' && (typeof target.name !== 'string' || !target.name.trim())) {
    errs.push(`${at}.name: required with a role locator`);
  }
  if (target.exact != null && typeof target.exact !== 'boolean') {
    errs.push(`${at}.exact: must be a boolean`);
  }
  const allowed = new Set([key, 'name', 'exact']);
  for (const extra of Object.keys(target)) {
    if (!allowed.has(extra)) errs.push(`${at}.${extra}: unknown locator key`);
  }
  return {
    [key]: target[key].trim(),
    ...(key === 'role' && typeof target.name === 'string'
      ? { name: target.name.trim() }
      : {}),
    ...(target.exact === true ? { exact: true } : {}),
  };
}

function resolveAnchor(raw, at, sceneById, errs) {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (!isPlainObject(raw)) {
    errs.push(`${at}: expected seconds or { scene, cue?, offset? }`);
    return null;
  }
  const scene = sceneById.get(raw.scene);
  if (!scene) {
    errs.push(`${at}.scene: ${JSON.stringify(raw.scene)} is not a scene id`);
    return null;
  }
  let cue = null;
  const turnCount = Array.isArray(scene.vo) ? scene.vo.length : 0;
  if (raw.cue != null) {
    if (!Number.isInteger(raw.cue) || raw.cue < 0 || raw.cue >= turnCount) {
      errs.push(`${at}.cue: must index scene "${scene.id}" turns 0..${turnCount - 1}`);
    } else cue = raw.cue;
  }
  const offset = raw.offset ?? 0;
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) {
    errs.push(`${at}.offset: must be a non-negative number of seconds`);
  }
  for (const key of Object.keys(raw)) {
    if (!['scene', 'cue', 'offset'].includes(key)) errs.push(`${at}.${key}: unknown anchor key`);
  }
  return {
    scene: scene.id,
    ...(cue != null ? { cue } : {}),
    offset: typeof offset === 'number' && Number.isFinite(offset) ? offset : 0,
  };
}

function resolveReady(raw, at, baseDir, errs) {
  if (raw == null) return null;
  if (!isPlainObject(raw)) {
    errs.push(`${at}: expected { selector|text|url|load, timeout? }`);
    return null;
  }
  const kinds = ['selector', 'text', 'url', 'load'].filter(k => raw[k] != null);
  if (kinds.length !== 1) {
    errs.push(`${at}: set exactly one of selector|text|url|load`);
    return null;
  }
  const kind = kinds[0];
  if (typeof raw[kind] !== 'string' || !raw[kind].trim()) {
    errs.push(`${at}.${kind}: must be a non-empty string`);
  }
  if (kind === 'load' && !LOAD_STATES.has(raw.load)) {
    errs.push(`${at}.load: expected ${[...LOAD_STATES].join('|')}`);
  }
  if (kind === 'url' && hasEmbeddedCredentials(raw.url)) {
    errs.push(`${at}.url: credentials must not be embedded in the URL`);
  }
  if (raw.timeout != null && (!Number.isInteger(raw.timeout) || raw.timeout < 1 || raw.timeout > 120000)) {
    errs.push(`${at}.timeout: must be an integer from 1 to 120000 milliseconds`);
  }
  for (const key of Object.keys(raw)) {
    if (![kind, 'timeout'].includes(key)) errs.push(`${at}.${key}: unknown ready key`);
  }
  return {
    [kind]: raw[kind],
    ...(raw.timeout != null ? { timeout: raw.timeout } : {}),
  };
}

function resolveStep(raw, index, flowAt, sceneById, errs) {
  const at = `${flowAt}.steps[${index}]`;
  if (!isPlainObject(raw)) {
    errs.push(`${at}: expected an action object`);
    return null;
  }
  if (!ACTIONS.has(raw.action)) {
    errs.push(`${at}.action: unknown action ${JSON.stringify(raw.action)} (${[...ACTIONS].join('|')})`);
  }
  const anchor = resolveAnchor(raw.at, `${at}.at`, sceneById, errs);
  const needsTarget = ['click', 'hover', 'fill', 'type', 'select'].includes(raw.action);
  const optionalTarget = raw.action === 'press';
  let target = null;
  if (needsTarget || (optionalTarget && raw.target != null)) {
    target = validateTarget(raw.target, `${at}.target`, errs);
  } else if (raw.target != null) {
    errs.push(`${at}.target: not used by action "${raw.action}"`);
  }

  if (['fill', 'type'].includes(raw.action)
      && (typeof raw.value !== 'string' || !raw.value.length)) {
    errs.push(`${at}.value: required for ${raw.action}`);
  }
  if (raw.action === 'select') {
    const values = Array.isArray(raw.value) ? raw.value : [raw.value];
    if (!target || !target.css) errs.push(`${at}.target: select currently requires a css locator`);
    if (values.length === 0 || values.some(v => typeof v !== 'string' || !v.length)) {
      errs.push(`${at}.value: select needs a string or non-empty string array`);
    }
  }
  if (raw.action === 'press' && (typeof raw.key !== 'string' || !raw.key.trim())) {
    errs.push(`${at}.key: required for press`);
  }
  if (raw.action === 'scroll') {
    if (!['up', 'down', 'left', 'right'].includes(raw.direction)) {
      errs.push(`${at}.direction: expected up|down|left|right`);
    }
    if (raw.amount != null && (!Number.isInteger(raw.amount) || raw.amount < 1 || raw.amount > 10000)) {
      errs.push(`${at}.amount: must be an integer from 1 to 10000 pixels`);
    }
  }
  if (raw.action === 'wait') {
    const waitKinds = ['ms', 'selector', 'text', 'url', 'load'].filter(k => raw[k] != null);
    if (waitKinds.length !== 1) errs.push(`${at}: wait needs exactly one of ms|selector|text|url|load`);
    if (raw.ms != null && (!Number.isInteger(raw.ms) || raw.ms < 0 || raw.ms > 120000)) {
      errs.push(`${at}.ms: must be an integer from 0 to 120000`);
    }
    if (raw.load != null && !LOAD_STATES.has(raw.load)) {
      errs.push(`${at}.load: expected ${[...LOAD_STATES].join('|')}`);
    }
    for (const key of ['selector', 'text', 'url']) {
      if (raw[key] != null && (typeof raw[key] !== 'string' || !raw[key].trim())) {
        errs.push(`${at}.${key}: must be a non-empty string`);
      }
    }
    if (raw.url != null && hasEmbeddedCredentials(raw.url)) {
      errs.push(`${at}.url: credentials must not be embedded in the URL`);
    }
  }
  if (raw.action === 'screenshot' && raw.name != null
      && (typeof raw.name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw.name))) {
    errs.push(`${at}.name: must use letters, numbers, "_" or "-"`);
  }
  if (raw.screenshot != null && typeof raw.screenshot !== 'boolean'
      && (typeof raw.screenshot !== 'string' || !/^[A-Za-z0-9_-]+$/.test(raw.screenshot))) {
    errs.push(`${at}.screenshot: expected true/false or a safe filename stem`);
  }

  const common = new Set([
    'at', 'action', 'target', 'value', 'key', 'direction', 'amount',
    'ms', 'selector', 'text', 'url', 'load', 'name', 'screenshot',
  ]);
  for (const key of Object.keys(raw)) {
    if (!common.has(key)) errs.push(`${at}.${key}: unknown step key`);
  }

  return {
    at: anchor,
    action: raw.action,
    ...(target ? { target } : {}),
    ...(['fill', 'type', 'select'].includes(raw.action) ? { value: raw.value } : {}),
    ...(raw.action === 'press' ? { key: raw.key } : {}),
    ...(raw.action === 'scroll' ? { direction: raw.direction, amount: raw.amount ?? 600 } : {}),
    ...(raw.action === 'wait' ? Object.fromEntries(
      ['ms', 'selector', 'text', 'url', 'load'].filter(k => raw[k] != null).map(k => [k, raw[k]]),
    ) : {}),
    ...(raw.action === 'screenshot' && raw.name ? { name: raw.name } : {}),
    ...(raw.screenshot != null ? { screenshot: raw.screenshot } : {}),
  };
}

/* Resolve + validate top-level walkthroughs and scene walkthrough references.
 * This helper appends to the schema's aggregate error list instead of throwing
 * early, preserving Narova's "show every config error at once" behavior. */
function resolveWalkthroughs(rawWalkthroughs, scenes, baseDir, ID_RE, errs) {
  const sceneById = new Map(scenes.filter(Boolean).map(s => [s.id, s]));
  const walkthroughs = {};

  if (rawWalkthroughs != null && !isPlainObject(rawWalkthroughs)) {
    errs.push('config.walkthroughs: expected an object keyed by walkthrough id');
  } else {
    for (const [id, raw] of Object.entries(rawWalkthroughs || {})) {
      const at = `config.walkthroughs.${id}`;
      if (!ID_RE.test(id)) {
        errs.push(`${at}: walkthrough id must match ${ID_RE}`);
        continue;
      }
      if (!isPlainObject(raw)) {
        errs.push(`${at}: expected an object`);
        continue;
      }
      const driver = raw.driver ?? DRIVER;
      if (driver !== DRIVER) {
        errs.push(`${at}.driver: unsupported driver ${JSON.stringify(driver)} (available: ${DRIVER})`);
      }
      if (typeof raw.url !== 'string' || !raw.url.trim()) {
        errs.push(`${at}.url: required`);
      } else {
        try {
          const parsed = new URL(raw.url);
          if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) {
            errs.push(`${at}.url: expected http(s) or file URL`);
          }
          if (parsed.username || parsed.password) {
            errs.push(`${at}.url: credentials must not be embedded in the URL`);
          }
        } catch {
          errs.push(`${at}.url: invalid URL`);
        }
      }
      if (raw.title != null && (typeof raw.title !== 'string' || !raw.title.trim())) {
        errs.push(`${at}.title: must be a non-empty string`);
      }
      if (raw.session != null && (typeof raw.session !== 'string' || !raw.session.trim())) {
        errs.push(`${at}.session: must be a non-empty string`);
      }

      const viewport = { ...DEFAULT_VIEWPORT, ...(raw.viewport || {}) };
      if (!isPlainObject(raw.viewport ?? {})) {
        errs.push(`${at}.viewport: expected { w, h }`);
      }
      for (const key of ['w', 'h']) {
        if (!Number.isInteger(viewport[key]) || viewport[key] < 320 || viewport[key] > 3840) {
          errs.push(`${at}.viewport.${key}: must be an integer from 320 to 3840`);
        }
      }
      if (raw.viewport) {
        for (const key of Object.keys(raw.viewport)) {
          if (!['w', 'h'].includes(key)) errs.push(`${at}.viewport.${key}: unknown key`);
        }
      }

      let restore = false;
      if (raw.restore != null) {
        if (raw.restore === true) restore = true;
        else if (typeof raw.restore === 'string' && raw.restore.trim()) restore = raw.restore.trim();
        else errs.push(`${at}.restore: expected true or a non-empty restore key`);
      }
      let profile = null;
      if (raw.profile != null) {
        if (typeof raw.profile !== 'string' || !raw.profile.trim()) {
          errs.push(`${at}.profile: expected a Chrome profile name or directory`);
        } else profile = resolveProfile(raw.profile, baseDir);
      }
      let allowedDomains = null;
      if (raw.allowedDomains != null) {
        if (!Array.isArray(raw.allowedDomains) || raw.allowedDomains.length === 0
            || raw.allowedDomains.some(v => typeof v !== 'string' || !v.trim())) {
          errs.push(`${at}.allowedDomains: expected a non-empty string array`);
        } else allowedDomains = raw.allowedDomains.map(v => v.trim());
        if (restore || profile) {
          errs.push(`${at}.allowedDomains: agent-browser cannot combine domain containment with restore/profile sessions`);
        }
      }
      let actionPolicy = null;
      if (raw.actionPolicy != null) {
        actionPolicy = insideProject(baseDir, raw.actionPolicy);
        if (!actionPolicy || !fs.existsSync(actionPolicy) || !fs.statSync(actionPolicy).isFile()) {
          errs.push(`${at}.actionPolicy: file not found inside the project`);
          actionPolicy = null;
        }
      }
      const cursor = { ...DEFAULT_CURSOR, ...(raw.cursor === false ? { enabled: false } : raw.cursor || {}) };
      if (raw.cursor != null && raw.cursor !== false && !isPlainObject(raw.cursor)) {
        errs.push(`${at}.cursor: expected false or { enabled, travelMs, color }`);
      }
      if (typeof cursor.enabled !== 'boolean') errs.push(`${at}.cursor.enabled: must be a boolean`);
      if (!Number.isInteger(cursor.travelMs) || cursor.travelMs < 0 || cursor.travelMs > 2000) {
        errs.push(`${at}.cursor.travelMs: must be an integer from 0 to 2000`);
      }
      if (typeof cursor.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(cursor.color)) {
        errs.push(`${at}.cursor.color: expected a six-digit hex color`);
      }
      for (const n of ['preRoll', 'postRoll']) {
        const value = raw[n] ?? (n === 'preRoll' ? 0.4 : 0.6);
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) {
          errs.push(`${at}.${n}: must be a number from 0 to 10 seconds`);
        }
      }
      if (raw.screenshots != null && typeof raw.screenshots !== 'boolean') {
        errs.push(`${at}.screenshots: must be a boolean`);
      }
      if (raw.mutates != null && typeof raw.mutates !== 'boolean') {
        errs.push(`${at}.mutates: must be a boolean`);
      }
      const ready = resolveReady(raw.ready, `${at}.ready`, baseDir, errs);
      if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
        errs.push(`${at}.steps: at least one action required`);
      }
      const steps = Array.isArray(raw.steps)
        ? raw.steps.map((step, index) => resolveStep(step, index, at, sceneById, errs)).filter(Boolean)
        : [];
      const allowedKeys = new Set([
        'driver', 'url', 'title', 'session', 'restore', 'profile', 'viewport',
        'ready', 'preRoll', 'postRoll', 'cursor', 'screenshots', 'mutates',
        'allowedDomains', 'actionPolicy', 'steps',
      ]);
      for (const key of Object.keys(raw)) {
        if (!allowedKeys.has(key)) errs.push(`${at}.${key}: unknown key`);
      }
      walkthroughs[id] = {
        id,
        driver,
        url: typeof raw.url === 'string' ? raw.url.trim() : raw.url,
        title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id,
        session: typeof raw.session === 'string' && raw.session.trim() ? raw.session.trim() : null,
        restore,
        profile,
        viewport,
        ready,
        preRoll: raw.preRoll ?? 0.4,
        postRoll: raw.postRoll ?? 0.6,
        cursor,
        screenshots: raw.screenshots !== false,
        mutates: raw.mutates === true,
        allowedDomains,
        actionPolicy,
        steps,
      };
    }
  }

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene || scene.walkthrough == null) continue;
    const at = `config.scenes[${i}].walkthrough`;
    const raw = typeof scene.walkthrough === 'string'
      ? { id: scene.walkthrough }
      : scene.walkthrough;
    if (!isPlainObject(raw)) {
      errs.push(`${at}: expected a walkthrough id or { id, layout?, fit?, opacity?, position? }`);
      continue;
    }
    const flow = walkthroughs[raw.id];
    if (!flow) errs.push(`${at}.id: ${JSON.stringify(raw.id)} is not declared in config.walkthroughs`);
    const layout = raw.layout ?? 'window';
    if (!LAYOUTS.has(layout)) errs.push(`${at}.layout: expected ${[...LAYOUTS].join('|')}`);
    const fit = raw.fit ?? (layout === 'full' ? 'cover' : 'contain');
    if (!FITS.has(fit)) errs.push(`${at}.fit: expected ${[...FITS].join('|')}`);
    const opacity = raw.opacity ?? 1;
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
      errs.push(`${at}.opacity: must be greater than 0 and at most 1`);
    }
    let position = { x: 0.5, y: 0.5 };
    if (raw.position != null) {
      if (!isPlainObject(raw.position)) errs.push(`${at}.position: expected { x, y } from 0 to 1`);
      else {
        position = { ...position, ...raw.position };
        for (const key of ['x', 'y']) {
          if (typeof position[key] !== 'number' || !Number.isFinite(position[key])
              || position[key] < 0 || position[key] > 1) {
            errs.push(`${at}.position.${key}: must be a number from 0 to 1`);
          }
        }
      }
    }
    for (const key of Object.keys(raw)) {
      if (!['id', 'layout', 'fit', 'opacity', 'position'].includes(key)) {
        errs.push(`${at}.${key}: unknown key`);
      }
    }
    scene.walkthrough = {
      id: raw.id,
      layout,
      fit,
      opacity,
      position,
    };
    if (scene.clip) errs.push(`${at}: a scene cannot use both clip and walkthrough media`);
  }

  for (const [id, flow] of Object.entries(walkthroughs)) {
    const used = scenes.some(s => s && s.walkthrough && s.walkthrough.id === id);
    if (!used) errs.push(`config.walkthroughs.${id}: declared but no scene references it`);
    for (let i = 0; i < flow.steps.length; i++) {
      const anchor = flow.steps[i].at;
      if (anchor && typeof anchor === 'object') {
        const scene = sceneById.get(anchor.scene);
        if (!scene || !scene.walkthrough || scene.walkthrough.id !== id) {
          errs.push(`config.walkthroughs.${id}.steps[${i}].at.scene: scene "${anchor.scene}" does not display walkthrough "${id}"`);
        }
      }
    }
  }

  return walkthroughs;
}

function capturePaths(config, id) {
  const assetsRoot = config.assetsDir || path.join(config.projectDir, 'assets');
  const variantParts = config.variant ? ['variants', config.variant] : [];
  const base = path.join(assetsRoot, 'walkthroughs', id, ...variantParts);
  const assetBase = ['assets', 'walkthroughs', id, ...variantParts].join('/');
  return {
    dir: base,
    recording: path.join(base, 'recording.webm'),
    manifest: path.join(base, 'capture.json'),
    states: path.join(base, 'states'),
    assetRecording: `${assetBase}/recording.webm`,
    assetManifest: `${assetBase}/capture.json`,
  };
}

function sceneTimeline(config, timings, throughIndex = config.scenes.length - 1) {
  let start = 0;
  return config.scenes.slice(0, throughIndex + 1).map(scene => {
    const timing = timings[scene.id];
    if (!timing || !Number.isFinite(timing.dur)) {
      throw new Error(`walkthrough capture needs timings for scene "${scene.id}" — run \`narova synth\` first`);
    }
    const item = { id: scene.id, start, dur: timing.dur, turns: timing.turns || [] };
    start = Math.round((start + timing.dur) * 1000) / 1000;
    return item;
  });
}

function walkthroughSpan(config, id, timings) {
  const indexes = [];
  config.scenes.forEach((scene, index) => {
    if (scene.walkthrough && scene.walkthrough.id === id) indexes.push(index);
  });
  if (!indexes.length) throw new Error(`walkthrough "${id}" is not used by any scene`);
  const firstIndex = Math.min(...indexes);
  const lastIndex = Math.max(...indexes);
  // A missing timing after the walkthrough's final scene cannot affect its
  // absolute start, duration, action anchors, or source trim map.
  const timeline = sceneTimeline(config, timings, lastIndex);
  const origin = timeline[firstIndex].start;
  const end = timeline[lastIndex].start + timeline[lastIndex].dur;
  return {
    firstIndex,
    lastIndex,
    origin,
    duration: Math.round((end - origin) * 1000) / 1000,
    scenes: indexes.map(index => ({
      id: timeline[index].id,
      start: Math.round((timeline[index].start - origin) * 1000) / 1000,
      dur: timeline[index].dur,
      turns: timeline[index].turns,
    })),
    timeline,
  };
}

function resolveStepTime(step, span) {
  if (typeof step.at === 'number') return step.at;
  const scene = span.scenes.find(s => s.id === step.at.scene);
  if (!scene) throw new Error(`walkthrough action anchors to scene "${step.at.scene}" outside its capture span`);
  const cueTime = step.at.cue == null ? 0 : scene.turns[step.at.cue];
  if (step.at.cue != null && !Number.isFinite(cueTime)) {
    throw new Error(`walkthrough action anchors to missing timing for scene "${scene.id}" cue ${step.at.cue} — re-run \`narova synth\``);
  }
  return Math.round((scene.start + (cueTime || 0) + (step.at.offset || 0)) * 1000) / 1000;
}

function captureConfigHash(config, id) {
  const flow = config.walkthroughs[id];
  if (!flow) throw new Error(`unknown walkthrough "${id}"`);
  // `title` only labels Narova's generated browser chrome. It does not change
  // browser execution or the pixels recorded by agent-browser.
  const { title: _title, ...executionFlow } = flow;
  const portableFlow = {
    ...executionFlow,
    actionPolicy: flow.actionPolicy
      ? path.relative(config.projectDir, flow.actionPolicy)
      : null,
    actionPolicyHash: flow.actionPolicy
      ? sha256(fs.readFileSync(flow.actionPolicy))
      : null,
  };
  const sceneRefs = config.scenes
    .filter(scene => scene.walkthrough && scene.walkthrough.id === id)
    .map(scene => ({ id: scene.id }));
  return sha256(stableStringify({
    schema: WALKTHROUGH_SCHEMA_VERSION,
    variant: config.variant || null,
    ...(flow.cursor.enabled ? { cursorRenderer: CURSOR_RENDERER_VERSION } : {}),
    flow: portableFlow,
    sceneRefs,
  }));
}

function captureTimingHash(config, id, timings) {
  const span = walkthroughSpan(config, id, timings);
  const steps = config.walkthroughs[id].steps.map(step => ({
    action: step.action,
    at: resolveStepTime(step, span),
  }));
  return sha256(stableStringify({
    schema: WALKTHROUGH_SCHEMA_VERSION,
    variant: config.variant || null,
    duration: span.duration,
    scenes: span.scenes,
    steps,
  }));
}

function captureSynthesisHash(config) {
  return audioFingerprint(config);
}

function synthesisStatus(config, outDir) {
  const current = captureSynthesisHash(config);
  if (!outDir) return { ok: true, hash: current };
  const fingerprintPath = path.join(outDir, '.audio-fingerprint');
  if (!fs.existsSync(fingerprintPath)) {
    return { ok: false, reason: 'narration synthesis identity unavailable' };
  }
  const synthesized = fs.readFileSync(fingerprintPath, 'utf8').trim();
  if (!synthesized || synthesized !== current) {
    return { ok: false, reason: 'narration synthesis is stale' };
  }
  return { ok: true, hash: current };
}

function readCaptureManifest(config, id) {
  const p = capturePaths(config, id).manifest;
  if (!fs.existsSync(p)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(p, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function captureStatus(config, id, timings = null, opts = {}) {
  const paths = capturePaths(config, id);
  if (!fs.existsSync(paths.recording)) return { ok: false, reason: 'recording missing', paths };
  if (!fs.existsSync(paths.manifest)) return { ok: false, reason: 'capture manifest missing', paths };
  const manifest = readCaptureManifest(config, id);
  if (!manifest) return { ok: false, reason: 'capture manifest is invalid JSON', paths };
  if (manifest.version !== WALKTHROUGH_SCHEMA_VERSION) {
    return { ok: false, reason: `capture manifest version ${manifest.version || 'missing'} is incompatible`, paths, manifest };
  }
  if (!manifest.media || !Number.isFinite(manifest.media.duration)
      || !manifest.timeline || !Array.isArray(manifest.timeline.scenes)
      || !manifest.timeline.scenes.length) {
    return { ok: false, reason: 'capture manifest is incomplete', paths, manifest };
  }
  if ((manifest.variant || null) !== (config.variant || null)) {
    return { ok: false, reason: 'capture belongs to a different narration variant', paths, manifest };
  }
  const cursorRenderer = config.walkthroughs[id].cursor.enabled
    ? CURSOR_RENDERER_VERSION
    : null;
  if ((manifest.cursorRenderer || null) !== cursorRenderer) {
    return { ok: false, reason: 'cursor renderer changed', paths, manifest };
  }
  const configHash = captureConfigHash(config, id);
  if (manifest.configHash !== configHash) {
    return { ok: false, reason: 'walkthrough recipe changed', paths, manifest };
  }
  const synthesisHash = captureSynthesisHash(config);
  if (!manifest.synthesisHash || manifest.synthesisHash !== synthesisHash) {
    return { ok: false, reason: 'narration synthesis inputs changed', paths, manifest };
  }
  if (!manifest.recordingSha256
      || manifest.recordingSha256 !== sha256(fs.readFileSync(paths.recording))) {
    return { ok: false, reason: 'recording content changed', paths, manifest };
  }
  if (!timings) {
    return { ok: false, reason: 'narration timings unavailable', paths, manifest };
  }
  const synthesis = synthesisStatus(config, opts.outDir);
  if (!synthesis.ok) return { ...synthesis, paths, manifest };
  let timingHash;
  let span;
  try {
    timingHash = captureTimingHash(config, id, timings);
    span = walkthroughSpan(config, id, timings);
  } catch {
    return { ok: false, reason: 'narration timings are incomplete', paths, manifest };
  }
  if (manifest.timingHash !== timingHash) {
    return { ok: false, reason: 'narration timings changed', paths, manifest };
  }
  const expectedSteps = config.walkthroughs[id].steps.map((step, index) => ({
    index,
    action: step.action,
    planned: resolveStepTime(step, span),
    screenshot: step.action === 'screenshot'
      || (step.screenshot !== false && (step.screenshot != null || config.walkthroughs[id].screenshots)),
  }));
  if (!Array.isArray(manifest.steps) || manifest.steps.length !== expectedSteps.length) {
    return { ok: false, reason: 'capture action evidence is incomplete', paths, manifest };
  }
  for (const expected of expectedSteps) {
    const actual = manifest.steps[expected.index];
    if (!actual || actual.index !== expected.index || actual.action !== expected.action
        || !Number.isFinite(actual.planned)
        || Math.abs(actual.planned - expected.planned) > 0.001
        || !Number.isFinite(actual.started) || !Number.isFinite(actual.actionAt)
        || !Number.isFinite(actual.completed) || !Number.isFinite(actual.driftMs)) {
      return { ok: false, reason: 'capture action evidence is incomplete', paths, manifest };
    }
    if (expected.screenshot) {
      const screenshot = typeof actual.screenshot === 'string'
        ? path.resolve(paths.dir, actual.screenshot)
        : null;
      const rel = screenshot ? path.relative(paths.dir, screenshot) : null;
      if (!screenshot || !rel || rel === '..' || rel.startsWith(`..${path.sep}`)
          || path.isAbsolute(rel) || !fs.existsSync(screenshot)
          || !fs.statSync(screenshot).isFile() || fs.statSync(screenshot).size === 0
          || !actual.screenshotSha256
          || actual.screenshotSha256 !== sha256(fs.readFileSync(screenshot))) {
        return { ok: false, reason: 'capture screenshot evidence is missing or changed', paths, manifest };
      }
    }
  }
  const readyLead = manifest.timeline.readyLead;
  const sourceOrigin = manifest.timeline.sourceOrigin;
  if (!Number.isFinite(readyLead) || readyLead < 0
      || !Number.isFinite(sourceOrigin)
      || Math.abs(sourceOrigin - (readyLead + config.walkthroughs[id].preRoll)) > 0.002
      || !manifest.timelineSha256
      || manifest.timelineSha256 !== sha256(stableStringify(manifest.timeline))) {
    return { ok: false, reason: 'capture trim map changed', paths, manifest };
  }
  const expectedTimeline = {
    preRoll: config.walkthroughs[id].preRoll,
    readyLead,
    sourceOrigin,
    postRoll: config.walkthroughs[id].postRoll,
    originScene: span.scenes[0].id,
    duration: span.duration,
    scenes: span.scenes.map(scene => ({ id: scene.id, start: scene.start, dur: scene.dur })),
  };
  if (stableStringify(manifest.timeline) !== stableStringify(expectedTimeline)) {
    return { ok: false, reason: 'capture trim map changed', paths, manifest };
  }
  if (manifest.media.duration + 0.1 < expectedTimeline.preRoll + expectedTimeline.duration) {
    return { ok: false, reason: 'recording is shorter than the walkthrough timeline', paths, manifest };
  }
  return { ok: true, paths, manifest };
}

function assertFreshCaptures(config, timings, outDir = null) {
  for (const id of Object.keys(config.walkthroughs || {})) {
    const status = captureStatus(config, id, timings, { outDir });
    if (!status.ok) {
      throw new Error(
        `walkthrough "${id}" capture is stale or missing (${status.reason}) — ` +
        `run \`narova walkthrough capture ${id}\`, then compose/build with --reuse`,
      );
    }
  }
}

function cursorScript(cursor) {
  const color = JSON.stringify(cursor.color);
  const travelMs = Number(cursor.travelMs);
  return `(() => {
  const install = () => {
    if (document.getElementById('__narova_cursor_host__')) return;
    const host = document.createElement('div');
    host.id = '__narova_cursor_host__';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position: 'fixed', left: '0', top: '0', width: '0', height: '0',
      zIndex: '2147483647', pointerEvents: 'none',
    });
    host.style.setProperty('--narova-click-color', ${color});
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = \`
      :host{all:initial}
      .c{position:fixed;left:0;top:0;width:18px;height:24px;
         background:#fff;clip-path:polygon(0 0,0 20px,5px 15px,9px 24px,13px 22px,9px 14px,16px 14px);
         filter:drop-shadow(0 0 1px rgba(0,0,0,.95)) drop-shadow(0 3px 4px rgba(0,0,0,.55));
         transform:translate3d(-40px,-40px,0);transition:transform ${travelMs}ms cubic-bezier(.2,.85,.25,1);
         will-change:transform}
      .r{position:fixed;left:0;top:0;width:24px;height:24px;border:3px solid var(--narova-click-color);
         border-radius:50%;box-shadow:0 0 0 2px rgba(255,255,255,.88);
         opacity:.96;will-change:transform,opacity;
         animation:narova-click-ripple .38s cubic-bezier(.16,.72,.3,1) forwards}
      @keyframes narova-click-ripple{
        from{opacity:.96;transform:var(--p) scale(.25)}
        to{opacity:0;transform:var(--p) scale(2.15)}
      }
    \`;
    const cursor = document.createElement('div');
    cursor.className = 'c';
    root.append(style, cursor);
    document.documentElement.appendChild(host);
    let x = -40, y = -40;
    const move = event => {
      x = event.clientX; y = event.clientY;
      cursor.style.transform = \`translate3d(\${x}px,\${y}px,0)\`;
    };
    const pulse = event => {
      move(event);
      const ripple = document.createElement('div');
      ripple.className = 'r';
      ripple.style.setProperty('--p', \`translate3d(\${x - 12}px,\${y - 12}px,0)\`);
      root.appendChild(ripple);
      const remove = () => ripple.remove();
      ripple.addEventListener('animationend', remove, { once: true });
      setTimeout(remove, 500);
    };
    addEventListener('mousemove', move, true);
    addEventListener('pointermove', move, true);
    addEventListener('pointerdown', pulse, true);
  };
  if (document.documentElement) install();
  else addEventListener('DOMContentLoaded', install, { once: true });
})();`;
}

function parseVersion(text) {
  const match = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match[0] : 'unknown';
}

function versionAtLeast(actual, expected) {
  const a = String(actual).split('.').map(Number);
  const e = String(expected).split('.').map(Number);
  if (a.length !== 3 || e.length !== 3 || [...a, ...e].some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== e[i]) return a[i] > e[i];
  }
  return true;
}

function targetArgs(target, action, value) {
  if (target.css) {
    if (action === 'fill' || action === 'type') return [action, target.css, value];
    return [action, target.css];
  }
  const kind = TARGET_KEYS.find(key => target[key] != null);
  const args = ['find', kind, target[kind], action];
  if (action === 'fill') args.push(value);
  if (kind === 'role') args.push('--name', target.name);
  if (target.exact) args.push('--exact');
  return args;
}

function waitArgs(value) {
  if (value.ms != null) return ['wait', String(value.ms)];
  if (value.selector != null) return ['wait', value.selector];
  if (value.text != null) return ['wait', '--text', value.text];
  if (value.url != null) return ['wait', '--url', value.url];
  if (value.load != null) return ['wait', '--load', value.load];
  return null;
}

function safeStateName(index, step) {
  const stem = typeof step.screenshot === 'string'
    ? step.screenshot
    : step.name || step.action;
  return `${String(index + 1).padStart(2, '0')}-${slug(stem)}.png`;
}

function executeStep(run, step, index, statesDir, flow, onAction = () => {}) {
  const shouldTravel = step.target && flow.cursor.enabled
    && ['click', 'fill', 'type', 'press'].includes(step.action);
  if (shouldTravel) {
    run(targetArgs(step.target, 'hover'));
    if (flow.cursor.travelMs > 0) run(['wait', String(flow.cursor.travelMs)]);
  }

  switch (step.action) {
    case 'click':
    case 'hover':
      onAction();
      run(targetArgs(step.target, step.action));
      break;
    case 'fill':
      onAction();
      run(targetArgs(step.target, 'fill', step.value));
      break;
    case 'type':
      if (step.target.css) {
        onAction();
        run(targetArgs(step.target, 'type', step.value));
      } else {
        run(targetArgs(step.target, 'click'));
        onAction();
        run(['keyboard', 'type', step.value]);
      }
      break;
    case 'press':
      if (step.target) run(targetArgs(step.target, 'click'));
      onAction();
      run(['press', step.key]);
      break;
    case 'select':
      onAction();
      run(['select', step.target.css, ...(Array.isArray(step.value) ? step.value : [step.value])]);
      break;
    case 'scroll':
      onAction();
      run(['scroll', step.direction, String(step.amount)]);
      break;
    case 'wait': {
      const args = waitArgs(step);
      if (args) {
        onAction();
        run(args);
      }
      break;
    }
    case 'screenshot':
      onAction();
      run(['screenshot', path.join(statesDir, safeStateName(index, step))]);
      return safeStateName(index, step);
    default:
      throw new Error(`unsupported walkthrough action "${step.action}"`);
  }

  const screenshot = step.screenshot === false
    ? false
    : (step.screenshot != null || flow.screenshots);
  if (screenshot) {
    const name = safeStateName(index, step);
    run(['screenshot', path.join(statesDir, name)]);
    return name;
  }
  return null;
}

function ffprobeRecording(file) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate,avg_frame_rate',
    '-show_entries', 'format=duration',
    '-of', 'json',
    file,
  ], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`ffprobe could not inspect walkthrough recording: ${(result.stderr || result.error?.message || '').trim()}`);
  }
  const info = JSON.parse(result.stdout);
  const stream = (info.streams || [])[0] || {};
  return {
    duration: Number(info.format && info.format.duration) || probe(file),
    width: stream.width || null,
    height: stream.height || null,
    codec: stream.codec_name || null,
    fps: stream.avg_frame_rate || stream.r_frame_rate || null,
  };
}

function commandLabel(args) {
  if (args[0] === 'open' && args[1]) {
    return `open ${safeUrl(args[1])}`;
  }
  if (args[0] === 'fill' || args[0] === 'type' || args[0] === 'keyboard') {
    return `${args.slice(0, 2).join(' ')} <redacted>`;
  }
  if (args[0] === 'select') {
    return `select ${args[1]} <redacted>`;
  }
  if (args[0] === 'wait' && args[1] === '--url' && args[2]) {
    return `wait --url ${safeUrl(args[2])}`;
  }
  if (args[0] === 'eval') {
    return `${args[0]} <narova cursor>`;
  }
  if (args[0] === 'find' && args.includes('fill')) {
    const copy = args.slice();
    const i = copy.indexOf('fill');
    if (copy[i + 1]) copy[i + 1] = '<redacted>';
    return copy.join(' ');
  }
  return args.join(' ');
}

function sensitiveArgs(args) {
  const values = [];
  for (const option of ['--session', '--profile', '--restore', '--init-script', '--action-policy']) {
    const index = args.indexOf(option);
    if (index >= 0 && args[index + 1]) values.push(args[index + 1]);
  }
  const waitedUrl = args.indexOf('--url');
  if (waitedUrl >= 0 && args[waitedUrl + 1]) values.push(args[waitedUrl + 1]);
  if (args[0] === 'find' && args.includes('fill')) {
    const i = args.indexOf('fill');
    if (i >= 0) values.push(...args.slice(i + 1, i + 2));
  } else if (args.includes('find') && args.includes('fill')) {
    const i = args.indexOf('fill');
    values.push(...args.slice(i + 1, i + 2));
  } else {
    for (const action of ['fill', 'type', 'select']) {
      const i = args.indexOf(action);
      if (i >= 0) values.push(...args.slice(i + 2));
    }
    const keyboard = args.indexOf('keyboard');
    if (keyboard >= 0 && args[keyboard + 1] === 'type') {
      values.push(...args.slice(keyboard + 2));
    }
  }
  return values;
}

function redactDiagnostic(value, args = []) {
  let output = String(value || '');
  if (args.includes('eval')) {
    const policy = output.match(/Action 'evaluate' denied by policy(?::[^\r\n]*)?/);
    return policy ? policy[0] : '<redacted eval diagnostic>';
  }
  for (const secret of sensitiveArgs(args)) {
    if (!secret) continue;
    output = output.split(String(secret)).join('<redacted>');
  }
  // agent-browser diagnostics can echo navigated and waited-for URLs. Strip
  // their queries/fragments even when formatting differs from our argv.
  return output.replace(/\b(?:https?|file):\/\/[^\s"'<>]+/gi, url => safeUrl(url));
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    const hadQuery = Boolean(url.search);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString() + (hadQuery ? '?<redacted>' : '');
  } catch {
    return '<invalid-url>';
  }
}

function makeAgentBrowserRunner(bin, globalArgs, log, spawn = spawnSync, env = process.env) {
  return args => {
    log(`  agent-browser ${commandLabel(args)}`);
    const result = spawn(bin, [...globalArgs, ...args], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env,
    });
    if (result.error) throw new Error(`agent-browser failed to launch: ${result.error.message}`);
    if (result.status !== 0) {
      const detail = redactDiagnostic(result.stderr || result.stdout || '', [...globalArgs, ...args]).trim();
      throw new Error(`agent-browser ${args[0]} failed${detail ? `: ${detail}` : ''}`);
    }
    return result;
  };
}

function agentBrowserGlobalArgs(config, id, flow, initScript = null) {
  // agent-browser sessions are machine-global. Project identity prevents two
  // reels with the same title/id from sharing or closing each other's live
  // browser and default restore state.
  const projectIdentity = sha256(path.resolve(config.projectDir || '.')).slice(0, 10);
  const session = flow.session || `narova-${slug(config.title)}-${id}-${projectIdentity}`;
  const args = ['--session', session];
  if (flow.url.startsWith('file:')) args.push('--allow-file-access');
  if (initScript) args.push('--init-script', initScript);
  if (flow.restore) {
    args.push('--restore');
    if (typeof flow.restore === 'string') args.push(flow.restore);
  }
  if (flow.profile) args.push('--profile', flow.profile);
  if (flow.allowedDomains) args.push('--allowed-domains', flow.allowedDomains.join(','));
  if (flow.actionPolicy) args.push('--action-policy', flow.actionPolicy);
  return { session, args };
}

function replaceDir(source, destination) {
  const parent = path.dirname(destination);
  ensureDir(parent);
  const staged = path.join(parent, `.${path.basename(destination)}-${process.pid}-${Date.now()}`);
  // Scratch commonly lives on a different filesystem (external project
  // volume, container bind mount). Copy into a sibling stage first; the final
  // stage → destination rename is then same-filesystem and atomic.
  fs.cpSync(source, staged, { recursive: true, errorOnExist: true });
  const backup = fs.existsSync(destination)
    ? path.join(parent, `.${path.basename(destination)}-previous-${process.pid}-${Date.now()}`)
    : null;
  try {
    if (backup) fs.renameSync(destination, backup);
    fs.renameSync(staged, destination);
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (backup && fs.existsSync(backup)) {
      if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(backup, destination);
    }
    if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true, force: true });
    throw error;
  }
}

/* Capture one declared walkthrough. Dependencies are injectable for tests;
 * production uses the installed agent-browser CLI and real wall-clock. */
function captureWalkthrough(config, id, timings, opts = {}) {
  const flow = config.walkthroughs && config.walkthroughs[id];
  if (!flow) throw new Error(`unknown walkthrough "${id}"`);
  const synthesis = synthesisStatus(config, opts.outDir);
  if (!synthesis.ok) {
    throw new Error(`${synthesis.reason} — run \`narova synth\` before walkthrough capture`);
  }
  const log = opts.log || console.log;
  const findTool = opts.which || which;
  const bin = opts.agentBrowser || findTool('agent-browser');
  if (!bin) {
    throw new Error(
      'agent-browser is required for walkthrough capture — install it with ' +
      '`npm install -g agent-browser && agent-browser install`',
    );
  }
  if (!opts.skipToolCheck && (!findTool('ffmpeg') || !findTool('ffprobe'))) {
    throw new Error('walkthrough capture requires ffmpeg and ffprobe');
  }

  const versionResult = (opts.spawn || spawnSync)(bin, ['--version'], { encoding: 'utf8' });
  if (versionResult.error || versionResult.status !== 0) {
    throw new Error('agent-browser --version failed');
  }
  const driverVersion = parseVersion(versionResult.stdout || versionResult.stderr);
  if (!versionAtLeast(driverVersion, '0.33.0')) {
    throw new Error(`walkthrough capture requires agent-browser >=0.33.0 (found ${driverVersion})`);
  }
  const span = walkthroughSpan(config, id, timings);
  const scheduled = flow.steps.map((step, index) => ({
    index,
    step,
    planned: resolveStepTime(step, span),
  })).sort((a, b) => a.planned - b.planned || a.index - b.index);
  for (const item of scheduled) {
    if (item.planned > span.duration + 0.001) {
      throw new Error(
        `walkthrough "${id}" step ${item.index + 1} is scheduled at ${item.planned}s, ` +
        `after its final displayed scene ends at ${span.duration}s`,
      );
    }
    const travelLead = item.step.target && flow.cursor.enabled
      && ['click', 'fill', 'type', 'press'].includes(item.step.action)
      ? flow.cursor.travelMs / 1000
      : 0;
    if (flow.preRoll + item.planned + 0.001 < travelLead) {
      const minimum = Math.max(0, travelLead - item.planned);
      throw new Error(
        `walkthrough "${id}" step ${item.index + 1} needs at least ` +
        `${minimum.toFixed(3)}s preRoll for ${flow.cursor.travelMs}ms cursor travel`,
      );
    }
  }

  const scratchRoot = opts.scratchDir || fs.mkdtempSync(path.join(os.tmpdir(), `narova-walkthrough-${id}-`));
  const takeDir = ensureDir(path.join(scratchRoot, 'take'));
  const statesDir = ensureDir(path.join(takeDir, 'states'));
  const recordingPath = path.join(takeDir, 'recording.webm');

  const { args: globalArgs } = agentBrowserGlobalArgs(config, id, flow);
  const agentEnv = {
    ...process.env,
    ...(flow.ready && flow.ready.timeout
      ? { AGENT_BROWSER_DEFAULT_TIMEOUT: String(flow.ready.timeout) }
      : {}),
  };
  const run = makeAgentBrowserRunner(
    bin,
    globalArgs,
    log,
    opts.spawn || spawnSync,
    agentEnv,
  );

  const steps = [];
  let recordingStarted = false;
  let cursorActive = flow.cursor.enabled;
  const now = opts.now || (() => Number(process.hrtime.bigint()) / 1e9);
  try {
    // A derived, isolated session is safe to reset; never touch other sessions.
    try { run(['close']); } catch { /* no existing session */ }
    run(['open', flow.url]);
    run(['set', 'viewport', String(flow.viewport.w), String(flow.viewport.h)]);
    if (flow.ready) {
      const args = waitArgs(flow.ready);
      if (args) run(args);
    }
    run(['record', 'start', recordingPath]);
    recordingStarted = true;
    const recordingStartedAt = now();
    // agent-browser 0.33 starts recording in a fresh browser context and does
    // not preserve registered init scripts in that context.
    if (flow.ready) {
      const args = waitArgs(flow.ready);
      if (args) run(args);
    }
    const readyLead = Math.max(0, now() - recordingStartedAt);
    // The narration origin is preRoll seconds in the future. Scheduling
    // against that future origin lets cursor travel for an early first action
    // happen during the recorded pre-roll instead of delaying the action.
    const timelineStart = now() + flow.preRoll;

    for (const item of scheduled) {
      const plannedTravelLead = item.step.target && cursorActive
        && ['click', 'fill', 'type', 'press'].includes(item.step.action)
        ? flow.cursor.travelMs / 1000
        : 0;
      // Leave a small setup window so delayed navigation can settle before
      // the cursor is installed in the document that will receive the action.
      const cursorSetupLead = cursorActive ? 0.1 : 0;
      const bulkElapsed = now() - timelineStart;
      const bulkWaitMs = Math.max(
        0,
        Math.round((item.planned - plannedTravelLead - cursorSetupLead - bulkElapsed) * 1000),
      );
      if (bulkWaitMs > 0) run(['wait', String(bulkWaitMs)]);
      // The script is idempotent. Reinstalling immediately before every step
      // restores the cursor after full navigations while keeping the driver's
      // documented action policy on every user-authored action.
      if (cursorActive) {
        try {
          run(['eval', cursorScript(flow.cursor)]);
        } catch (error) {
          // A restrictive policy may intentionally deny evaluation. Keep the
          // capture useful and policy-compliant; only the optional highlight
          // is omitted. Other cursor setup failures remain capture failures.
          if (flow.actionPolicy
              && /Action 'evaluate' denied by policy/.test(String(error && error.message))) {
            cursorActive = false;
            log('  walkthrough cursor disabled: action policy denies evaluate');
          } else {
            throw error;
          }
        }
      }
      const travelLead = item.step.target && cursorActive
        && ['click', 'fill', 'type', 'press'].includes(item.step.action)
        ? flow.cursor.travelMs / 1000
        : 0;
      const elapsed = now() - timelineStart;
      const waitMs = Math.max(0, Math.round((item.planned - travelLead - elapsed) * 1000));
      if (waitMs > 0) run(['wait', String(waitMs)]);
      const started = now() - timelineStart;
      let actionAt = null;
      const screenshot = executeStep(
        run,
        item.step,
        item.index,
        statesDir,
        cursorActive
          ? flow
          : { ...flow, cursor: { ...flow.cursor, enabled: false } },
        () => {
          if (actionAt == null) actionAt = now() - timelineStart;
        },
      );
      const completed = now() - timelineStart;
      if (actionAt == null) actionAt = started;
      steps.push({
        index: item.index,
        action: item.step.action,
        planned: item.planned,
        started: Math.round(started * 1000) / 1000,
        actionAt: Math.round(actionAt * 1000) / 1000,
        completed: Math.round(completed * 1000) / 1000,
        driftMs: Math.round((actionAt - item.planned) * 1000),
        ...(screenshot ? {
          screenshot: `states/${screenshot}`,
          screenshotSha256: sha256(fs.readFileSync(path.join(statesDir, screenshot))),
        } : {}),
      });
    }

    const elapsed = now() - timelineStart;
    const remainingMs = Math.max(0, Math.round((span.duration + flow.postRoll - elapsed) * 1000));
    if (remainingMs > 0) run(['wait', String(remainingMs)]);
    run(['record', 'stop']);
    recordingStarted = false;
    run(['close']);

    if (!fs.existsSync(recordingPath) || fs.statSync(recordingPath).size === 0) {
      throw new Error('agent-browser produced no walkthrough recording');
    }
    const media = (opts.inspectRecording || ffprobeRecording)(recordingPath);
    const sourceOrigin = Math.round((readyLead + flow.preRoll) * 1000) / 1000;
    const requiredDuration = sourceOrigin + span.duration;
    if (Number.isFinite(media.duration) && media.duration + 0.1 < requiredDuration) {
      throw new Error(
        `agent-browser recording is ${media.duration.toFixed(2)}s but the walkthrough needs ` +
        `${requiredDuration.toFixed(2)}s before post-roll`,
      );
    }
    const sourceUrl = new URL(flow.url);
    sourceUrl.username = '';
    sourceUrl.password = '';
    sourceUrl.search = '';
    sourceUrl.hash = '';
    const timeline = {
      preRoll: flow.preRoll,
      readyLead: Math.round(readyLead * 1000) / 1000,
      sourceOrigin,
      postRoll: flow.postRoll,
      originScene: span.scenes[0].id,
      duration: span.duration,
      scenes: span.scenes.map(scene => ({ id: scene.id, start: scene.start, dur: scene.dur })),
    };
    const manifest = {
      version: WALKTHROUGH_SCHEMA_VERSION,
      id,
      variant: config.variant || null,
      ...(flow.cursor.enabled ? { cursorRenderer: CURSOR_RENDERER_VERSION } : {}),
      capturedAt: new Date().toISOString(),
      driver: { name: DRIVER, version: driverVersion },
      url: sourceUrl.toString(),
      urlHash: sha256(flow.url),
      viewport: flow.viewport,
      configHash: captureConfigHash(config, id),
      synthesisHash: synthesis.hash,
      timingHash: captureTimingHash(config, id, timings),
      recording: 'recording.webm',
      recordingSha256: sha256(fs.readFileSync(recordingPath)),
      media,
      timeline,
      timelineSha256: sha256(stableStringify(timeline)),
      mutates: flow.mutates,
      steps: steps.sort((a, b) => a.index - b.index),
    };
    fs.writeFileSync(path.join(takeDir, 'capture.json'), JSON.stringify(manifest, null, 2) + '\n');
    const destination = capturePaths(config, id).dir;
    replaceDir(takeDir, destination);
    if (!opts.keepScratch) fs.rmSync(scratchRoot, { recursive: true, force: true });
    return { id, dir: destination, manifest, recording: capturePaths(config, id).recording };
  } catch (error) {
    if (recordingStarted) {
      try { run(['record', 'stop']); } catch { /* retain the original failure */ }
    }
    try { run(['close']); } catch { /* retain the original failure */ }
    if (!opts.keepScratch) fs.rmSync(scratchRoot, { recursive: true, force: true });
    throw error;
  }
}

/* Open a declared source in a persistent, named agent-browser session and
 * return its interactive accessibility snapshot. This is the discovery pass:
 * authors/agents can inspect stable roles, labels, text, and test ids before
 * committing a narration-timed recipe. The session intentionally stays open. */
function exploreWalkthrough(config, id, opts = {}) {
  const flow = config.walkthroughs && config.walkthroughs[id];
  if (!flow) throw new Error(`unknown walkthrough "${id}"`);
  const findTool = opts.which || which;
  const bin = opts.agentBrowser || findTool('agent-browser');
  if (!bin) {
    throw new Error(
      'agent-browser is required for walkthrough exploration — install it with ' +
      '`npm install -g agent-browser && agent-browser install`',
    );
  }
  const spawn = opts.spawn || spawnSync;
  const versionResult = spawn(bin, ['--version'], { encoding: 'utf8' });
  const driverVersion = versionResult.status === 0
    ? parseVersion(versionResult.stdout || versionResult.stderr)
    : 'unknown';
  if (!versionAtLeast(driverVersion, '0.33.0')) {
    throw new Error(`walkthrough exploration requires agent-browser >=0.33.0 (found ${driverVersion})`);
  }
  const { session, args: globalArgs } = agentBrowserGlobalArgs(config, id, flow);
  const env = {
    ...process.env,
    ...(flow.ready && flow.ready.timeout
      ? { AGENT_BROWSER_DEFAULT_TIMEOUT: String(flow.ready.timeout) }
      : {}),
  };
  const run = makeAgentBrowserRunner(
    bin,
    globalArgs,
    opts.log || (() => {}),
    spawn,
    env,
  );
  run(['open', flow.url]);
  run(['set', 'viewport', String(flow.viewport.w), String(flow.viewport.h)]);
  if (flow.ready) {
    const args = waitArgs(flow.ready);
    if (args) run(args);
  }
  const snapshot = run(['snapshot', '-i']);
  return {
    id,
    session,
    version: driverVersion,
    snapshot: String(snapshot.stdout || '').trim(),
  };
}

module.exports = {
  CURSOR_RENDERER_VERSION,
  WALKTHROUGH_SCHEMA_VERSION,
  ACTIONS,
  resolveWalkthroughs,
  capturePaths,
  captureConfigHash,
  captureTimingHash,
  captureSynthesisHash,
  synthesisStatus,
  captureStatus,
  assertFreshCaptures,
  readCaptureManifest,
  walkthroughSpan,
  resolveStepTime,
  safeStateName,
  cursorScript,
  targetArgs,
  safeUrl,
  redactDiagnostic,
  exploreWalkthrough,
  captureWalkthrough,
  replaceDir,
  stableStringify,
};
