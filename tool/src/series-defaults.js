'use strict';
/* Pure authoring merge. Detached projects carry this small ordinary module. */
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const reserved = key => ['__proto__', 'constructor', 'prototype'].includes(key);

function mergeDefaults(raw, defaults, voiceOrder, files = [], dependencies = {}) {
  const control = raw.seriesOverrides === undefined ? {} : raw.seriesOverrides;
  if (!record(control) || Object.keys(control).some(k => k !== 'remove')) throw new Error('seriesOverrides: expected only remove');
  const removals = control.remove === undefined ? {} : control.remove;
  if (!record(removals) || Object.keys(removals).some(k => !['voices', 'characters', 'theme', 'captions', 'pronounce'].includes(k))) throw new Error('seriesOverrides.remove: unknown field');
  const origins = {};
  const result = { ...raw };
  delete result.seriesOverrides;
  for (const field of ['voices', 'characters', 'theme', 'captions', 'pronounce']) {
    const inherited = defaults[field];
    const local = raw[field];
    const remove = removals[field] === undefined ? [] : removals[field];
    if (!Array.isArray(remove) || new Set(remove).size !== remove.length) throw new Error(`seriesOverrides.remove.${field}: expected unique names`);
    for (const key of remove) {
      if (typeof key !== 'string' || reserved(key) || !record(inherited) || !own(inherited, key)) throw new Error(`seriesOverrides.remove.${field}.${key}: no inherited member`);
    }
    if (field === 'captions' && typeof local === 'boolean') {
      result[field] = local === true ? {} : false; origins[field] = { '*': 'episode' }; continue;
    }
    if (inherited === undefined && !remove.length) continue;
    if (local !== undefined && (!record(local) || (field === 'pronounce' && ![Object.prototype, null].includes(Object.getPrototypeOf(local))))) {
      // Ordinary schema owns diagnostics for malformed local values.
      result[field] = local; origins[field] = { '*': 'episode' }; continue;
    }
    const shared = field === 'captions' && typeof inherited === 'boolean' ? { enabled: inherited } : (inherited || {});
    const keys = field === 'voices' ? voiceOrder : Object.keys(shared);
    const entries = [];
    const source = {};
    const seenKeys = new Set();
    for (const key of keys) {
      if (remove.includes(key)) continue;
      entries.push([key, local && own(local, key) ? local[key] : shared[key]]);
      source[key] = local && own(local, key) ? 'episode' : 'series';
      seenKeys.add(key);
    }
    for (const [key, value] of Object.entries(local || {})) {
      if (reserved(key)) throw new Error(`${field}.${key}: reserved map key`);
      if (!seenKeys.has(key)) { entries.push([key, value]); source[key] = 'episode'; seenKeys.add(key); }
    }
    result[field] = Object.fromEntries(entries);
    origins[field] = source;
  }
  if (files.length && raw.localResources !== undefined && (!Array.isArray(raw.localResources) || new Set(raw.localResources).size !== raw.localResources.length)) throw new Error('config.localResources: expected unique paths');
  if (files.length) result.localResources = [...new Set([...(raw.localResources || []), ...files])];
  if (Object.keys(dependencies).length) {
    if (raw.localResourceDependencies !== undefined && !record(raw.localResourceDependencies)) throw new Error('config.localResourceDependencies: expected a path map');
    result.localResourceDependencies = { ...(raw.localResourceDependencies || {}) };
    for (const [file, refs] of Object.entries(dependencies)) {
      const localRefs = own(result.localResourceDependencies, file) ? result.localResourceDependencies[file] : [];
      if (!Array.isArray(localRefs) || new Set(localRefs).size !== localRefs.length) throw new Error(`config.localResourceDependencies.${file}: expected paths`);
      result.localResourceDependencies[file] = [...new Set([...localRefs, ...refs])];
    }
  }
  return { raw: result, origins, removals };
}
module.exports = { mergeDefaults };
