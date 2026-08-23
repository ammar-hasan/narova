'use strict';

/* Bounded, task-specific scene-state evidence (CHANGE-2026-058).
 *
 * This is an evidence envelope, not a renderer or physics vocabulary. The
 * producer owns each observation's meaning and method; Narova validates the
 * shared identity/time/value boundary and later binds the exact source bytes
 * to an encoded artifact for read-only Video CI comparison. */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'narova.scene-state/1';
const MAX_BYTES = 1024 * 1024;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const BASES = new Set(['MEASURED', 'INFERRED']);
const STATUSES = new Set(['available', 'unavailable']);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function exactKeys(value, allowed, at, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${at}.${key}: unsupported field`);
  }
}

function nonEmpty(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function scalar(value) {
  return (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean'
    || nonEmpty(value);
}

function validateTime(value, at, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${at}: expected { at } or { start, end }`);
    return null;
  }
  exactKeys(value, new Set(['at', 'start', 'end']), at, errors);
  const hasAt = Object.hasOwn(value, 'at');
  const hasStart = Object.hasOwn(value, 'start');
  const hasEnd = Object.hasOwn(value, 'end');
  if (hasAt && !hasStart && !hasEnd) {
    if (typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at < 0) {
      errors.push(`${at}.at: expected a finite non-negative local second`);
      return null;
    }
    return { at: value.at };
  }
  if (!hasAt && hasStart && hasEnd) {
    if (typeof value.start !== 'number' || !Number.isFinite(value.start) || value.start < 0) {
      errors.push(`${at}.start: expected a finite non-negative local second`);
    }
    if (typeof value.end !== 'number' || !Number.isFinite(value.end)
        || !(value.end > value.start)) {
      errors.push(`${at}.end: expected a finite local second greater than start`);
    }
    return Number.isFinite(value.start) && value.start >= 0
      && Number.isFinite(value.end) && value.end > value.start
      ? { start: value.start, end: value.end } : null;
  }
  errors.push(`${at}: expected exactly { at } or { start, end }`);
  return null;
}

function validateSceneStateDocument(value, at = 'scene state') {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { errors: [`${at}: expected an object`], document: null };
  }
  exactKeys(value, new Set(['schema', 'producer', 'observations']), at, errors);
  if (value.schema !== SCHEMA) errors.push(`${at}.schema: expected ${SCHEMA}`);

  let producer = null;
  if (!value.producer || typeof value.producer !== 'object' || Array.isArray(value.producer)) {
    errors.push(`${at}.producer: expected { id, version }`);
  } else {
    exactKeys(value.producer, new Set(['id', 'version']), `${at}.producer`, errors);
    if (!nonEmpty(value.producer.id)) errors.push(`${at}.producer.id: required non-empty string`);
    if (!nonEmpty(value.producer.version)) errors.push(`${at}.producer.version: required non-empty string`);
    if (nonEmpty(value.producer.id) && nonEmpty(value.producer.version)) {
      producer = { id: value.producer.id.trim(), version: value.producer.version.trim() };
    }
  }

  const observations = [];
  const ids = new Set();
  if (!Array.isArray(value.observations)) {
    errors.push(`${at}.observations: expected an array`);
  } else {
    value.observations.forEach((observation, index) => {
      const oat = `${at}.observations[${index}]`;
      if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
        errors.push(`${oat}: expected an object`);
        return;
      }
      exactKeys(observation, new Set([
        'id', 'time', 'status', 'method', 'value', 'unit', 'basis', 'reason',
      ]), oat, errors);
      const normalized = {};
      if (typeof observation.id !== 'string' || !ID_RE.test(observation.id)) {
        errors.push(`${oat}.id: must match ${ID_RE}`);
      } else if (ids.has(observation.id)) {
        errors.push(`${oat}.id: duplicate "${observation.id}"`);
      } else {
        ids.add(observation.id);
        normalized.id = observation.id;
      }
      const time = validateTime(observation.time, `${oat}.time`, errors);
      if (time) normalized.time = time;
      if (!STATUSES.has(observation.status)) {
        errors.push(`${oat}.status: expected available|unavailable`);
      } else normalized.status = observation.status;
      if (!nonEmpty(observation.method)) {
        errors.push(`${oat}.method: required non-empty string`);
      } else normalized.method = observation.method.trim();

      if (observation.status === 'available') {
        if (!scalar(observation.value)) {
          errors.push(`${oat}.value: expected a finite number, boolean, or non-empty string`);
        } else normalized.value = observation.value;
        if (!nonEmpty(observation.unit)) {
          errors.push(`${oat}.unit: required non-empty string`);
        } else normalized.unit = observation.unit.trim();
        if (!BASES.has(observation.basis)) {
          errors.push(`${oat}.basis: expected MEASURED|INFERRED`);
        } else normalized.basis = observation.basis;
        if (Object.hasOwn(observation, 'reason')) {
          errors.push(`${oat}.reason: only unavailable observations may declare a reason`);
        }
      } else if (observation.status === 'unavailable') {
        if (!nonEmpty(observation.reason)) {
          errors.push(`${oat}.reason: required non-empty string for unavailable state`);
        } else normalized.reason = observation.reason.trim();
        for (const key of ['value', 'unit', 'basis']) {
          if (Object.hasOwn(observation, key)) {
            errors.push(`${oat}.${key}: unavailable state must not invent ${key}`);
          }
        }
      }
      observations.push(normalized);
    });
  }

  return {
    errors,
    document: errors.length ? null : { schema: SCHEMA, producer, observations },
  };
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function resolveSceneState(raw, baseDir, sceneIds) {
  const errors = [];
  const entries = [];
  if (raw == null) return { errors, entries };
  if (!Array.isArray(raw)) {
    return { errors: ['config.sceneState: expected an array of { scene, file }'], entries };
  }
  const root = fs.realpathSync(path.resolve(baseDir));
  const scenes = new Set();
  raw.forEach((entry, index) => {
    const at = `config.sceneState[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at}: expected { scene, file }`);
      return;
    }
    exactKeys(entry, new Set(['scene', 'file']), at, errors);
    let scene = null;
    if (typeof entry.scene !== 'string' || !sceneIds.has(entry.scene)) {
      errors.push(`${at}.scene: must name an existing scene`);
    } else if (scenes.has(entry.scene)) {
      errors.push(`${at}.scene: duplicate "${entry.scene}"`);
    } else {
      scene = entry.scene;
      scenes.add(scene);
    }
    if (!nonEmpty(entry.file) || path.isAbsolute(entry.file)
        || /^(?:https?:)?\/\//i.test(entry.file)) {
      errors.push(`${at}.file: expected a contained project-relative JSON file`);
      return;
    }
    const candidate = path.resolve(root, entry.file);
    let file;
    try { file = fs.realpathSync(candidate); }
    catch {
      errors.push(`${at}.file: file not found: ${candidate}`);
      return;
    }
    if (!inside(root, file)) {
      errors.push(`${at}.file: path must stay inside the project`);
      return;
    }
    let stat;
    try { stat = fs.statSync(file); }
    catch (error) {
      errors.push(`${at}.file: cannot inspect file: ${error.message}`);
      return;
    }
    if (!stat.isFile()) {
      errors.push(`${at}.file: expected a regular file`);
      return;
    }
    if (stat.size > MAX_BYTES) {
      errors.push(`${at}.file: exceeds ${MAX_BYTES} byte scene-state bound`);
      return;
    }
    let bytes;
    let parsed;
    try {
      bytes = fs.readFileSync(file);
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      errors.push(`${at}.file: invalid or unreadable JSON: ${error.message}`);
      return;
    }
    const checked = validateSceneStateDocument(parsed, `${at}.file`);
    errors.push(...checked.errors);
    if (scene && checked.document) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      entries.push({
        scene,
        file: relative,
        source: {
          path: relative,
          bytes: bytes.length,
          sha256: sha256(bytes),
          available: true,
          format: SCHEMA,
          content: checked.document,
        },
      });
    }
  });
  return { errors, entries };
}

function receiptEntries(config) {
  return (config && Array.isArray(config.sceneState) ? config.sceneState : []).map(entry => ({
    scene: entry.scene,
    source: JSON.parse(JSON.stringify(entry.source)),
  }));
}

module.exports = {
  SCHEMA,
  MAX_BYTES,
  ID_RE,
  validateSceneStateDocument,
  resolveSceneState,
  receiptEntries,
};
