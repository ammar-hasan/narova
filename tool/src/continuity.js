'use strict';
/* Creator-owned continuity context for explicit generated-video acquisition.
 * This is not the scene model, sceneState, a judge, or a scheduler. */

const fs = require('fs');
const {
  inferKind, resolveProjectFile, sha256File,
} = require('./asset-registry');

const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected an object`);
  }
  return value;
}

function exactFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key}: unknown field`);
  }
}

function identifier(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) {
    throw new Error(`${label}: must begin with a letter and contain only letters, digits, _ or -`);
  }
  return value;
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: expected a non-empty string`);
  return value.trim();
}

function stringList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label}: expected an array`);
  return value.map((entry, index) => nonempty(entry, `${label}[${index}]`));
}

function anchorIdentity(projectDir, ref) {
  if (typeof ref !== 'string' || !ref.trim()) throw new Error('continuity anchor must be a non-empty project-relative path');
  const resolved = resolveProjectFile(projectDir, ref.trim());
  const link = fs.lstatSync(resolved.absolute);
  if (link.isSymbolicLink() || !link.isFile()) throw new Error(`continuity anchor must be a regular file: ${ref}`);
  if (inferKind(resolved.relative) !== 'image') throw new Error(`continuity anchor must be an image: ${ref}`);
  const stats = fs.statSync(resolved.absolute);
  if (stats.size <= 0) throw new Error(`continuity anchor must not be empty: ${ref}`);
  return {
    file: resolved.relative,
    absolute: resolved.absolute,
    bytes: stats.size,
    sha256: sha256File(resolved.absolute),
  };
}

function parsePlan(value) {
  const root = object(value, 'continuity');
  exactFields(root, new Set(['entities', 'shots']), 'continuity');
  const rawEntities = object(root.entities, 'continuity.entities');
  const rawShots = object(root.shots, 'continuity.shots');
  const entities = {};
  for (const [id, raw] of Object.entries(rawEntities)) {
    identifier(id, `continuity.entities key ${JSON.stringify(id)}`);
    const entry = object(raw, `continuity.entities.${id}`);
    exactFields(entry, new Set(['kind', 'description']), `continuity.entities.${id}`);
    entities[id] = {
      kind: nonempty(entry.kind, `continuity.entities.${id}.kind`),
      description: nonempty(entry.description, `continuity.entities.${id}.description`),
    };
  }
  const shots = {};
  for (const [id, raw] of Object.entries(rawShots)) {
    identifier(id, `continuity.shots key ${JSON.stringify(id)}`);
    const entry = object(raw, `continuity.shots.${id}`);
    exactFields(entry, new Set(['entities', 'keep', 'change', 'anchor']), `continuity.shots.${id}`);
    if (!Array.isArray(entry.entities) || entry.entities.length === 0) {
      throw new Error(`continuity.shots.${id}.entities: expected a non-empty array`);
    }
    const selected = entry.entities.map((entityId, index) => identifier(
      entityId, `continuity.shots.${id}.entities[${index}]`,
    ));
    if (new Set(selected).size !== selected.length) {
      throw new Error(`continuity.shots.${id}.entities: duplicate entity`);
    }
    for (const entityId of selected) {
      if (!entities[entityId]) throw new Error(`continuity.shots.${id}.entities: unknown entity ${JSON.stringify(entityId)}`);
    }
    shots[id] = {
      entities: selected,
      keep: stringList(entry.keep, `continuity.shots.${id}.keep`),
      change: stringList(entry.change, `continuity.shots.${id}.change`),
      ...(entry.anchor == null ? {} : { anchor: nonempty(entry.anchor, `continuity.shots.${id}.anchor`) }),
    };
  }
  return { entities, shots };
}

function continuityText(snapshot) {
  const lines = [
    '',
    'Creator-authored continuity context for this shot:',
    ...snapshot.entities.map(entity => `- ${entity.id} [${entity.kind}]: ${entity.description}`),
  ];
  if (snapshot.keep.length) {
    lines.push('Keep:', ...snapshot.keep.map(value => `- ${value}`));
  }
  if (snapshot.change.length) {
    lines.push('Intentionally change:', ...snapshot.change.map(value => `- ${value}`));
  }
  return lines.join('\n');
}

function runtimeContinuity(projectDir, snapshot) {
  const anchor = snapshot.anchor ? anchorIdentity(projectDir, snapshot.anchor.file) : null;
  const stored = {
    shot: snapshot.shot,
    entities: snapshot.entities.map(entity => ({ ...entity })),
    keep: [...snapshot.keep],
    change: [...snapshot.change],
    ...(anchor ? { anchor: { file: anchor.file, bytes: anchor.bytes, sha256: anchor.sha256 } } : {}),
  };
  return {
    snapshot: stored,
    text: continuityText(stored),
    reference: anchor ? {
      kind: 'image', path: anchor.absolute, bytes: anchor.bytes, sha256: anchor.sha256,
    } : null,
  };
}

function loadContinuityShot(projectDir, value, shotId) {
  identifier(shotId, 'continuity shot');
  if (value == null) throw new Error('project config has no continuity block');
  const plan = parsePlan(value);
  const shot = plan.shots[shotId];
  if (!shot) throw new Error(`continuity shot ${JSON.stringify(shotId)} is not declared in project config`);
  return runtimeContinuity(projectDir, {
    shot: shotId,
    entities: shot.entities.map(id => ({ id, ...plan.entities[id] })),
    keep: shot.keep,
    change: shot.change,
    ...(shot.anchor ? { anchor: { file: shot.anchor } } : {}),
  });
}

function continuityFromRecipe(projectDir, value) {
  const stored = object(value, 'generation recipe continuity');
  exactFields(stored, new Set(['shot', 'entities', 'keep', 'change', 'anchor']), 'generation recipe continuity');
  identifier(stored.shot, 'generation recipe continuity.shot');
  if (!Array.isArray(stored.entities) || stored.entities.length === 0) {
    throw new Error('generation recipe continuity.entities: expected a non-empty array');
  }
  const entities = stored.entities.map((raw, index) => {
    const entry = object(raw, `generation recipe continuity.entities[${index}]`);
    exactFields(entry, new Set(['id', 'kind', 'description']), `generation recipe continuity.entities[${index}]`);
    return {
      id: identifier(entry.id, `generation recipe continuity.entities[${index}].id`),
      kind: nonempty(entry.kind, `generation recipe continuity.entities[${index}].kind`),
      description: nonempty(entry.description, `generation recipe continuity.entities[${index}].description`),
    };
  });
  if (new Set(entities.map(entity => entity.id)).size !== entities.length) {
    throw new Error('generation recipe continuity.entities: duplicate entity');
  }
  let anchor;
  if (stored.anchor != null) {
    const raw = object(stored.anchor, 'generation recipe continuity.anchor');
    exactFields(raw, new Set(['file', 'bytes', 'sha256']), 'generation recipe continuity.anchor');
    anchor = { file: nonempty(raw.file, 'generation recipe continuity.anchor.file') };
  }
  return runtimeContinuity(projectDir, {
    shot: stored.shot,
    entities,
    keep: stringList(stored.keep, 'generation recipe continuity.keep'),
    change: stringList(stored.change, 'generation recipe continuity.change'),
    ...(anchor ? { anchor } : {}),
  });
}

module.exports = {
  continuityFromRecipe,
  continuityText,
  loadContinuityShot,
  parsePlan,
};
