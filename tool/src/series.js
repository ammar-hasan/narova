'use strict';
/* Frozen, data-only series authoring. Membership never loads episode code. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CANDIDATES } = require('./config');
const { mergeDefaults } = require('./series-defaults');
const FORMAT = 'narova.series/1';
const BINDING_FORMAT = 'narova.series-binding/1';
const HOME = '.narova-series';
const STORE = '.narova-series-store';
const MEMBERSHIP = 'series-membership.json';
const CURRENT = `${HOME}/current`;
const BINDING = `${CURRENT}/binding.json`;
const FILES = `${CURRENT}/files/`;
const JSON_LIMIT = 2 * 1024 * 1024;
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const HASH = /^[a-f0-9]{64}$/;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) {
    const compare = (a, b) => {
      const aa = [...a], bb = [...b];
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        const difference = aa[i].codePointAt(0) - bb[i].codePointAt(0);
        if (difference) return difference;
      }
      return aa.length - bb.length;
    };
    return '{' + Object.keys(value).sort(compare).map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}
const digest = value => sha(canonical(value));
const archive = () => require('./project-archive');
function fail(label, message) { throw new Error(`series ${label}: ${message}`); }
function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value) || ['constructor', 'prototype'].includes(value)) fail(label, 'expected a safe identifier');
  return value;
}
function text(value, label) { if (typeof value !== 'string' || !value.trim()) fail(label, 'expected nonempty text'); }
function keys(value, allowed, label) {
  if (!object(value)) fail(label, 'expected an object');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label}.${key}`, 'unknown field');
}
function safeJson(value, label) {
  if (Array.isArray(value)) return value.forEach((v, i) => safeJson(v, `${label}[${i}]`));
  if (object(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(`${label}.${key}`, 'reserved map key');
      safeJson(v, `${label}.${key}`);
    }
  }
}
function parse(bytes, label, managed = true) {
  if (managed && bytes.length > JSON_LIMIT) fail(label, 'JSON exceeds 2 MiB');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) { fail(label, `invalid UTF-8 JSON (${error.message})`); }
  if (managed) safeJson(value, label);
  return value;
}
function portable(value, label) {
  try { return archive().safeMemberPath(value); } catch (error) { fail(label, error.message); }
}
function regular(root, rel, label) {
  portable(rel, label);
  let current = root;
  try {
    if (fs.lstatSync(root).isSymbolicLink()) fail(label, 'symlink root is not permitted');
    for (const part of rel.split('/')) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) fail(label, 'symlink is not permitted');
    }
    if (!fs.statSync(current).isFile()) fail(label, 'expected a regular file');
  } catch (error) { if (error.code === 'ENOENT') fail(label, `missing file ${rel}; restore or explicitly adopt a complete revision`); throw error; }
  return current;
}
function readJson(file, managed = true) {
  const absolute = path.resolve(file);
  const root = path.dirname(absolute), name = path.basename(absolute);
  regular(root, name, name);
  if (managed && fs.statSync(absolute).size > JSON_LIMIT) fail(name, 'JSON exceeds 2 MiB');
  return parse(fs.readFileSync(absolute), name, managed);
}
function names(value, available, label) {
  if (!Array.isArray(value) || new Set(value).size !== value.length) fail(label, 'expected unique names');
  for (const name of value) if (!own(available, id(name, label))) fail(label, `unknown selection ${name}`);
  return value;
}
function defaultsFiles(defaults, visit) {
  const out = JSON.parse(JSON.stringify(defaults));
  for (const [name, voice] of Object.entries(out.voices || {})) {
    for (const [key, file] of Object.entries(voice.providerFiles || {})) voice.providerFiles[key] = visit(file, `defaults.voices.${name}.providerFiles.${key}`);
    if ((voice.backend === 'chatterbox' && voice.speaker) || (voice.backend === 'xtts' && typeof voice.speaker === 'string' && (path.isAbsolute(voice.speaker) || /\.(?:wav|mp3|flac|m4a)$/i.test(voice.speaker)))) fail(`defaults.voices.${name}.speaker`, 'machine-local clone samples cannot be shared; use supported bound providerFiles or episode-local narration');
  }
  for (const [name, character] of Object.entries(out.characters || {})) {
    for (const field of ['model', 'src']) if (character[field]) character[field] = visit(character[field], `defaults.characters.${name}.${field}`);
    const fileFields = new Set(['src', 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'texture']);
    const visitParts = (value, label) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (fileFields.has(key) && typeof child === 'string') value[key] = visit(child, `${label}.${key}`);
        else visitParts(child, `${label}.${key}`);
      }
    };
    visitParts(character.parts, `defaults.characters.${name}.parts`);
  }
  return out;
}
function validateDefaults(value = {}) {
  keys(value, ['voices', 'characters', 'theme', 'captions'], 'defaults');
  for (const field of ['voices', 'characters']) {
    if (value[field] === undefined) continue;
    if (!object(value[field])) fail(`defaults.${field}`, 'expected a record map');
    for (const [name, record] of Object.entries(value[field])) {
      id(name, `defaults.${field}`);
      if (!object(record)) fail(`defaults.${field}.${name}`, 'expected an ordinary record');
    }
  }
  if (value.theme !== undefined) {
    if (!object(value.theme) || own(value.theme, 'css')) fail('defaults.theme', 'expected mode/tokens only, without CSS');
    for (const [key, token] of Object.entries(value.theme)) {
      id(key, 'defaults.theme');
      if (key === 'mode' ? !['dark', 'light'].includes(token) : /[;{}<]/.test(String(token))) fail(`defaults.theme.${key}`, 'invalid ordinary theme value');
    }
  }
  if (value.captions !== undefined && typeof value.captions !== 'boolean') {
    keys(value.captions, ['preset', 'emphasis', 'maxWords', 'plate', 'size', 'color', 'activeColor', 'pastColor', 'plateColor', 'enabled'], 'defaults.captions');
  }
  return value;
}
function state(value, label) {
  keys(value, ['facts', 'note', 'source'], label);
  if (!object(value.facts)) fail(`${label}.facts`, 'expected an authored JSON object');
  for (const field of ['note', 'source']) if (value[field] !== undefined) text(value[field], `${label}.${field}`);
}
function validateSource(raw) {
  keys(raw, ['format', 'id', 'title', 'defaults', 'voiceOrder', 'resources', 'context', 'states', 'episodes'], 'source');
  if (raw.format !== FORMAT) fail('format', `expected ${FORMAT}`);
  id(raw.id, 'id'); text(raw.title, 'title');
  const defaults = validateDefaults(raw.defaults);
  const voiceOrder = raw.voiceOrder === undefined ? Object.keys(defaults.voices || {}) : raw.voiceOrder;
  names(voiceOrder, defaults.voices || {}, 'voiceOrder');
  if (voiceOrder.length !== Object.keys(defaults.voices || {}).length) fail('voiceOrder', 'must list every shared voice once');
  for (const field of ['resources', 'context', 'states']) {
    if (raw[field] !== undefined && !object(raw[field])) fail(field, 'expected a record map');
    for (const [name, entry] of Object.entries(raw[field] || {})) {
      id(name, field);
      if (field === 'resources') {
        keys(entry, ['file', 'dependencies', 'description'], `${field}.${name}`);
        portable(entry.file, `${field}.${name}.file`);
        if (entry.dependencies !== undefined && (!Array.isArray(entry.dependencies) || new Set(entry.dependencies).size !== entry.dependencies.length)) fail(`${field}.${name}.dependencies`, 'expected unique paths');
        for (const file of entry.dependencies || []) portable(file, `${field}.${name}.dependencies`);
        if (entry.description !== undefined) text(entry.description, `${field}.${name}.description`);
      } else if (field === 'context') {
        keys(entry, ['text', 'file', 'source'], `${field}.${name}`);
        if (entry.text === undefined && entry.file === undefined) fail(`${field}.${name}`, 'text or file is required');
        if (entry.file !== undefined) portable(entry.file, `${field}.${name}.file`);
        for (const key of ['text', 'source']) if (entry[key] !== undefined) text(entry[key], `${field}.${name}.${key}`);
      } else state(entry, `${field}.${name}`);
    }
  }
  const episodes = raw.episodes === undefined ? [] : raw.episodes;
  if (!Array.isArray(episodes)) fail('episodes', 'expected an ordered array');
  const byId = new Map();
  for (const [i, episode] of episodes.entries()) {
    keys(episode, ['id', 'title', 'project', 'group', 'relationships', 'shared'], `episodes[${i}]`);
    id(episode.id, `episodes[${i}].id`); text(episode.title, `episodes[${i}].title`);
    if (byId.has(episode.id)) fail('episodes', `duplicate episode ${episode.id}`);
    byId.set(episode.id, episode);
    if (episode.project !== undefined) portable(episode.project, `episodes.${episode.id}.project`);
    if (episode.group !== undefined) text(episode.group, `episodes.${episode.id}.group`);
    if (episode.shared !== undefined) {
      const label = `episodes.${episode.id}.shared`, shared = episode.shared;
      keys(shared, ['revision', 'resources', 'context', 'incoming'], label);
      if (own(shared, 'revision')) {
        if (typeof shared.revision !== 'string' || !HASH.test(shared.revision) || Object.keys(shared).length !== 1) fail(label, 'a pin requires only an exact revision SHA-256');
      } else {
        for (const key of ['resources', 'context']) if (shared[key] !== undefined) names(shared[key], raw[key] || {}, `${label}.${key}`);
        if (shared.incoming !== undefined && shared.incoming !== null && !own(raw.states || {}, id(shared.incoming, `${label}.incoming`))) fail(label, 'unknown incoming state');
      }
    }
  }
  const visiting = new Set(), seen = new Set();
  function visit(name) {
    if (visiting.has(name)) fail('episodes.relationships', `cycle involving ${[...visiting, name].join(' -> ')}`);
    if (seen.has(name)) return;
    visiting.add(name);
    const relations = byId.get(name).relationships === undefined ? [] : byId.get(name).relationships;
    if (!Array.isArray(relations)) fail(`episodes.${name}.relationships`, 'expected an array');
    const duplicate = new Set();
    for (const relation of relations) {
      keys(relation, ['type', 'episode'], `episodes.${name}.relationships`);
      id(relation.type, `episodes.${name}.relationships.type`);
      if (!byId.has(relation.episode) || relation.episode === name) fail(`episodes.${name}.relationships`, `invalid episode ${relation.episode}`);
      const key = `${relation.type}:${relation.episode}`;
      if (duplicate.has(key)) fail(`episodes.${name}.relationships`, `duplicate ${key}`);
      duplicate.add(key); visit(relation.episode);
    }
    visiting.delete(name); seen.add(name);
  }
  for (const name of byId.keys()) visit(name);
  return { ...raw, defaults, voiceOrder, resources: raw.resources || {}, context: raw.context || {}, states: raw.states || {}, episodes };
}
function source(input) {
  let file = path.resolve(input || '.');
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'series.config.json');
  return { raw: validateSource(readJson(file)), file, root: path.dirname(file) };
}
function init(directory, seriesId, title) {
  id(seriesId, 'id'); text(title || seriesId, 'title');
  const file = path.resolve(directory, 'series.config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = { format: FORMAT, id: seriesId, title: title || seriesId, defaults: {}, resources: {}, context: {}, states: {}, episodes: [] };
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, { flag: 'wx' });
  return { file, seriesId };
}
function selectors(options, prior) {
  const list = (key) => options[key] === undefined ? [...(prior?.[key] || [])] : (Array.isArray(options[key]) ? options[key] : String(options[key]).split(',').filter(Boolean));
  return { resources: list('resources'), context: list('context'), incoming: options.incoming === undefined ? (prior?.incoming || null) : (options.incoming || null) };
}
function verifyClosure(entries) {
  const table = new Map(entries.map(e => [e.path, e.data]));
  for (const entry of entries) {
    const ext = path.posix.extname(entry.path).toLowerCase();
    let refs = [];
    if (['.css', '.html', '.htm', '.svg'].includes(ext)) {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(entry.data);
      if (ext !== '.css' && (/<script\b[^>]*>[\s\S]*?\S[\s\S]*?<\/script\s*>/i.test(content) || /\b(?:on[a-z]+|srcdoc)\s*=/i.test(content))) fail(entry.path, 'inline executable markup dependency closure is unavailable; use ordinary episode-owned script source');
      refs = ext === '.css' ? archive().cssReferences(content, entry.path, path.posix.dirname(entry.path)) : archive().markupReferences(content, entry.path, path.posix.dirname(entry.path));
    }
    if (['.js', '.mjs', '.cjs'].includes(ext)) {
      const content = entry.data.toString('utf8');
      if (/\b(?:require|import)\s*\((?!\s*['"])/.test(content) || /\b(?:fetch|readFile(?:Sync)?)\s*\(/.test(content)) fail(entry.path, 'dynamic dependency closure is unavailable; use self-contained selected source');
      const patterns = [/\b(?:require|import)\s*\(\s*(['"])([^'"]+)\1\s*\)/g, /\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s+)?(['"])([^'"]+)\1/g];
      for (const pattern of patterns) for (const match of content.matchAll(pattern)) refs.push({ value: match[2], baseDir: path.posix.dirname(entry.path), label: entry.path });
    }
    for (const ref of refs) {
      if (/^(?:data:|#|mailto:|tel:)/i.test(ref.value)) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref.value)) fail(ref.label, 'remote selected dependency; acquire it locally');
      const target = path.posix.normalize(path.posix.join(ref.baseDir || '', ref.value.split(/[?#]/, 1)[0]));
      portable(target, ref.label);
      if (!table.has(target)) fail(ref.label, `undeclared dependency ${target}; declare its complete closure`);
    }
  }
}
function verifyResourceClosures(resources, entries) {
  const table = new Map(entries.map(entry => [entry.path, entry]));
  for (const resource of Object.values(resources)) verifyClosure([resource.file, ...(resource.dependencies || [])].map(file => {
    const entry = table.get(file);
    if (!entry) fail(file, 'undeclared resource dependency');
    return entry;
  }));
}
function assertSelection(options, selected, message) {
  const requested = selectors(options, selected);
  for (const key of ['resources', 'context']) {
    if (new Set(requested[key]).size !== requested[key].length) fail(key, 'expected unique names');
    if (canonical([...requested[key]].sort()) !== canonical([...selected[key]].sort())) fail('selection', message);
  }
  if (requested.incoming !== selected.incoming) fail('selection', message);
}
function storedSnapshot(loaded, episodeId) {
  const episode = loaded.raw.episodes.find(e => e.id === episodeId);
  const revision = episode?.shared?.revision;
  if (typeof revision !== 'string' || !HASH.test(revision)) fail('pin', 'episode has no exact catalog pin');
  try {
    const binding = validateBinding(readJson(regular(loaded.root, `${STORE}/bindings/${revision}.json`, `pin ${revision}`)));
    if (binding.revision !== revision || binding.series.id !== loaded.raw.id || binding.episode.id !== episodeId) fail('pin', `revision ${revision} does not match the catalog series/episode; restore the correct pin`);
    const members = new Map(binding.files.map(entry => [entry.path, entry]));
    const entries = verifyEntries(binding, file => {
      const member = members.get(file);
      const absolute = regular(loaded.root, `${STORE}/files/${member.sha256}`, `pin ${revision} member ${file}`);
      if (fs.statSync(absolute).size !== member.bytes) fail(file, `pin ${revision} stored byte count mismatch; restore the committed store`);
      return fs.readFileSync(absolute);
    });
    return { binding, entries };
  } catch (error) {
    fail(`pin ${revision}`, `${error.message}; restore the committed catalog/store`);
  }
}
function storeDirectory(root, relative) {
  portable(relative, 'store');
  let directory = root;
  if (fs.lstatSync(root).isSymbolicLink()) fail('store', 'symlink root is not permitted');
  for (const part of relative.split('/')) {
    directory = path.join(directory, part);
    try { fs.mkdirSync(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('store', `expected contained directory ${relative}`);
  }
  return directory;
}
function admitObject(root, relative, data) {
  storeDirectory(root, path.posix.dirname(relative));
  const destination = path.join(root, relative);
  const verify = () => {
    const file = regular(root, relative, 'store admission');
    if (fs.statSync(file).size !== data.length || !fs.readFileSync(file).equals(data)) fail('store', `existing object differs at ${relative}; restore the committed store`);
  };
  if (fs.existsSync(destination)) { verify(); return; }
  const temp = path.join(root, STORE, `.object-${crypto.randomBytes(12).toString('hex')}`);
  try {
    fs.writeFileSync(temp, data, { flag: 'wx' });
    try { fs.linkSync(temp, destination); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    verify();
  } finally { try { fs.unlinkSync(temp); } catch {} }
}
function pin(input, episodeId, options = {}) {
  id(episodeId, 'episode');
  const loaded = source(input), before = fs.readFileSync(loaded.file);
  // Preserve the author's catalog fields, changing only the selected entry.
  const document = parse(before, loaded.file);
  if (canonical(validateSource(document)) !== canonical(loaded.raw)) fail('pin', 'catalog changed while reading; inspect and retry');
  const episode = loaded.raw.episodes.find(e => e.id === episodeId);
  if (!episode) fail('episode', `unknown catalog episode ${episodeId}`);
  if (options.project && !options.fromBound) fail('pin', '--project is only used with --from-bound');
  let snap;
  if (options.fromBound) {
    if (['resources', 'context', 'incoming'].some(k => options[k] !== undefined)) fail('pin', '--from-bound cannot replace the retained selection; omit selection flags');
    const target = options.project || (episode.project && catalogProject(loaded.root, episode.project, `episodes.${episodeId}.project`));
    if (!target) fail('pin', 'episode has no project; supply --project for --from-bound');
    const binding = readBinding(projectRoot(target));
    if (!binding || binding.series.id !== loaded.raw.id || binding.episode.id !== episodeId) fail('pin', 'existing binding does not match catalog series/episode');
    snap = { binding, entries: verifyEntries(binding, file => fs.readFileSync(regular(target, FILES + file, file))) };
  } else {
    const prior = episode.shared?.revision ? storedSnapshot(loaded, episodeId).binding.selection : episode.shared;
    snap = snapshot(input, episodeId, options, prior, true, loaded);
  }
  const store = storeDirectory(loaded.root, STORE), lock = path.join(store, 'lock');
  try { fs.mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') fail('pin', `busy store mutation; inspect ${lock} before recovery`); throw error; }
  let stagedCatalog, capturedCatalog, displaced = false, committed = false, restored = false;
  try {
    validateBinding(snap.binding);
    for (const entry of snap.entries) {
      if (entry.data.length !== entry.bytes || sha(entry.data) !== entry.sha256) fail(entry.path, 'selected content changed before store admission');
      admitObject(loaded.root, `${STORE}/files/${entry.sha256}`, entry.data);
    }
    const relative = `${STORE}/bindings/${snap.binding.revision}.json`;
    if (fs.existsSync(path.join(loaded.root, relative))) {
      const stored = validateBinding(readJson(regular(loaded.root, relative, 'stored snapshot')));
      if (canonical(stored) !== canonical(snap.binding)) fail('pin', 'stored revision identity conflict');
    } else admitObject(loaded.root, relative, Buffer.from(`${JSON.stringify(snap.binding, null, 2)}\n`));
    const catalogEpisode = document.episodes.find(e => e.id === episodeId);
    catalogEpisode.shared = { revision: snap.binding.revision };
    const next = validateSource(document);
    storedSnapshot({ ...loaded, raw: next }, episodeId);
    const data = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
    if (data.length > JSON_LIMIT) fail('pin', 'catalog exceeds 2 MiB after pin creation');
    stagedCatalog = path.join(loaded.root, `.catalog-pin-${crypto.randomBytes(12).toString('hex')}.json`);
    fs.writeFileSync(stagedCatalog, data, { flag: 'wx', mode: fs.statSync(loaded.file).mode & 0o777 });
    regular(loaded.root, path.basename(loaded.file), 'catalog publication');
    capturedCatalog = path.join(loaded.root, `.catalog-pin-backup-${crypto.randomBytes(12).toString('hex')}.json`);
    // Capture the current pathname before checking its bytes. Publication uses
    // an exclusive link, so a newly created catalog can never be overwritten.
    fs.renameSync(loaded.file, capturedCatalog);
    displaced = true;
    regular(loaded.root, path.basename(capturedCatalog), 'captured catalog');
    if (!fs.readFileSync(capturedCatalog).equals(before)) fail('pin', 'catalog changed during pinning; inspect and retry');
    try { fs.linkSync(stagedCatalog, loaded.file); }
    catch (error) { if (error.code === 'EEXIST') fail('pin', 'catalog changed during publication; inspect and retry'); throw error; }
    committed = true;
    return { seriesId: loaded.raw.id, episodeId, revision: snap.binding.revision,
      file: loaded.file, store, selection: snap.binding.selection, committed: true };
  } catch (error) {
    if (displaced && !committed) {
      try { fs.linkSync(capturedCatalog, loaded.file); restored = true; }
      catch (recovery) { error.message += `; catalog restoration could not publish without replacing another file (${recovery.message}); preserve recovery material ${capturedCatalog}`; }
    }
    throw error;
  } finally {
    if (stagedCatalog) { try { fs.unlinkSync(stagedCatalog); } catch {} }
    if (capturedCatalog && (committed || restored)) { try { fs.unlinkSync(capturedCatalog); } catch {} }
    try { fs.rmdirSync(lock); } catch {}
  }
}

function catalogProject(root, relative, label) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return null;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) fail(label, 'symlink project locator is not permitted');
    if (!stat.isDirectory()) return null;
  }
  return current;
}
function snapshot(input, episodeId, options = {}, prior, captureLive = false, observedSource) {
  const loaded = observedSource || source(input), raw = loaded.raw;
  const episode = raw.episodes.find(e => e.id === episodeId);
  if (!episode) fail('episode', `unknown catalog episode ${episodeId}`);
  if (episode.shared?.revision && !captureLive) {
    const snap = storedSnapshot(loaded, episodeId);
    assertSelection(options, snap.binding.selection, 'pinned selectors differ; repin the catalog episode explicitly');
    return { ...snap, project: options.project ? path.resolve(options.project) : (episode.project && catalogProject(loaded.root, episode.project, `episodes.${episode.id}.project`)) };
  }
  const selection = selectors(options, prior || episode.shared);
  names(selection.resources, raw.resources, 'resources'); names(selection.context, raw.context, 'context');
  if (selection.incoming !== null && !own(raw.states, id(selection.incoming, 'incoming'))) fail('incoming', `unknown state ${selection.incoming}`);
  const required = new Set(selection.resources);
  defaultsFiles(raw.defaults, (file, label) => {
    portable(file, label);
    const matches = Object.entries(raw.resources).filter(([, entry]) => entry.file === file);
    if (matches.length !== 1) fail(label, `must identify exactly one resource with primary file ${file}`);
    required.add(matches[0][0]); return file;
  });
  const resources = Object.fromEntries([...required].sort().map(name => [name, raw.resources[name]]));
  const context = Object.fromEntries(selection.context.map(name => [name, raw.context[name]]));
  const selected = new Map();
  let selectedBytes = 0;
  const add = (file, role, label) => {
    if (selected.has(file)) { if (role === 'resource') selected.get(file).role = role; return; }
    const absolute = regular(loaded.root, file, label);
    const bytes = fs.statSync(absolute).size;
    if (bytes > archive().MAX_MEMBER_BYTES) fail(file, 'selected member exceeds 128 MiB');
    selectedBytes += bytes;
    if (selected.size >= 10000 || selectedBytes > archive().MAX_TOTAL_BYTES) fail('selection', 'selected closure exceeds archive limits');
    const data = fs.readFileSync(absolute);
    selected.set(file, { path: file, data, bytes: data.length, sha256: sha(data), role });
  };
  for (const [name, resource] of Object.entries(resources)) for (const file of [resource.file, ...(resource.dependencies || [])]) add(file, 'resource', `resources.${name}`);
  for (const [name, entry] of Object.entries(context)) if (entry.file) add(entry.file, 'context', `context.${name}`);
  const entries = [...selected.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (entries.length > 10000 || entries.reduce((sum, e) => sum + e.bytes, 0) > archive().MAX_TOTAL_BYTES) fail('selection', 'selected closure exceeds archive limits');
  archive().assertPortablePaths(entries.map(e => e.path), 'selected series files');
  verifyResourceClosures(resources, entries);
  const value = selection.incoming ? raw.states[selection.incoming] : null;
  const binding = { format: BINDING_FORMAT, series: { id: raw.id, title: raw.title }, episode: { ...episode }, selection,
    defaults: raw.defaults, voiceOrder: raw.voiceOrder, resources, context,
    incoming: value ? { id: selection.incoming, value, sha256: digest(value) } : null,
    files: entries.map(({ path: file, bytes, sha256, role }) => ({ path: file, bytes, sha256, role })) };
  delete binding.episode.project;
  delete binding.episode.shared;
  binding.revision = digest(binding);
  if (Buffer.byteLength(JSON.stringify(binding)) > JSON_LIMIT) fail('binding', 'selected data exceeds 2 MiB');
  const catalogLocation = episode.project ? catalogProject(loaded.root, episode.project, `episodes.${episode.id}.project`) : null;
  return { binding, entries, project: options.project ? path.resolve(options.project) : catalogLocation };
}
function validateBinding(binding) {
  keys(binding, ['format', 'series', 'episode', 'selection', 'defaults', 'voiceOrder', 'resources', 'context', 'incoming', 'files', 'revision'], 'binding');
  for (const field of ['format', 'series', 'episode', 'selection', 'defaults', 'voiceOrder', 'resources', 'context', 'incoming', 'files', 'revision']) if (!own(binding, field)) fail(`binding.${field}`, 'required field is missing');
  if (binding.format !== BINDING_FORMAT || !HASH.test(binding.revision || '')) fail('binding', 'unsupported format or revision');
  keys(binding.series, ['id', 'title'], 'binding.series'); id(binding.series.id, 'binding.series.id'); text(binding.series.title, 'binding.series.title');
  // Reuse source validation, retaining relationship targets as provenance only.
  keys(binding.episode, ['id', 'title', 'group', 'relationships'], 'binding.episode');
  if (binding.episode.relationships !== undefined && !Array.isArray(binding.episode.relationships)) fail('binding.episode.relationships', 'expected an array');
  for (const relation of binding.episode.relationships || []) { keys(relation, ['type', 'episode'], 'binding.episode.relationships'); id(relation.type, 'relationship.type'); id(relation.episode, 'relationship.episode'); }
  const episode = { ...binding.episode, relationships: [] };
  validateSource({ format: FORMAT, id: binding.series.id, title: binding.series.title, defaults: binding.defaults, voiceOrder: binding.voiceOrder, resources: binding.resources, context: binding.context, states: {}, episodes: [episode] });
  keys(binding.selection, ['resources', 'context', 'incoming'], 'binding.selection');
  names(binding.selection.resources, binding.resources, 'binding.selection.resources'); names(binding.selection.context, binding.context, 'binding.selection.context');
  defaultsFiles(binding.defaults, (file, label) => {
    portable(file, label);
    if (Object.values(binding.resources).filter(resource => resource.file === file).length !== 1) fail(label, 'default file is outside its declared resource closure');
    return file;
  });
  if (binding.incoming !== null) {
    keys(binding.incoming, ['id', 'value', 'sha256'], 'binding.incoming'); id(binding.incoming.id, 'binding.incoming.id'); state(binding.incoming.value, 'binding.incoming.value');
    if (binding.incoming.id !== binding.selection.incoming || digest(binding.incoming.value) !== binding.incoming.sha256) fail('incoming', 'retained state identity mismatch');
  } else if (binding.selection.incoming !== null) fail('incoming', 'selected state is missing');
  if (!Array.isArray(binding.files) || binding.files.length > 10000) fail('files', 'invalid retained table');
  const expected = new Set(), resourcePaths = new Set();
  for (const entry of Object.values(binding.resources)) for (const file of [entry.file, ...(entry.dependencies || [])]) { expected.add(file); resourcePaths.add(file); }
  for (const entry of Object.values(binding.context)) if (entry.file) expected.add(entry.file);
  let total = 0;
  for (const file of binding.files) {
    keys(file, ['path', 'bytes', 'sha256', 'role'], 'files'); portable(file.path, 'files.path');
    if (!expected.delete(file.path) || !HASH.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > archive().MAX_MEMBER_BYTES || !['resource', 'context'].includes(file.role)) fail(file.path, 'invalid retained file declaration');
    if (file.role !== (resourcePaths.has(file.path) ? 'resource' : 'context')) fail(file.path, 'retained file role mismatch');
    total += file.bytes;
  }
  if (expected.size || total > archive().MAX_TOTAL_BYTES) fail('files', 'incomplete or oversized retained closure');
  archive().assertPortablePaths(binding.files.map(e => e.path), 'retained series files');
  const { revision, ...body } = binding;
  if (digest(body) !== revision) fail('binding.revision', 'retained binding identity mismatch; restore or explicitly adopt a complete revision');
  return binding;
}
function verifyEntries(binding, get) {
  validateBinding(binding);
  const entries = binding.files.map(file => {
    const data = get(file.path);
    if (!data || data.length !== file.bytes || sha(data) !== file.sha256) fail(file.path, 'retained file identity mismatch; restore or explicitly adopt a complete revision');
    return { ...file, data };
  });
  verifyResourceClosures(binding.resources, entries);
  return entries;
}
function readBundle(directory, verify = true) {
  const binding = validateBinding(readJson(path.join(directory, 'binding.json')));
  if (verify) verifyEntries(binding, file => fs.readFileSync(regular(directory, `files/${file}`, file)));
  return binding;
}
function projectRoot(directory) {
  const root = path.resolve(directory || '.');
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) fail('project', 'symlink project root is not permitted');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('project', `missing project ${root}`);
  const configs = CANDIDATES.filter(file => fs.existsSync(path.join(root, file)));
  if (configs.length !== 1) fail('project', 'requires exactly one root reel.config file');
  return root;
}
function validateMembership(membership, binding = null) {
  keys(membership, ['format', 'seriesId', 'episodeId'], 'membership');
  if (membership.format !== 'narova.series-member/1') fail('membership', 'unsupported format');
  id(membership.seriesId, 'membership.seriesId'); id(membership.episodeId, 'membership.episodeId');
  if (binding && (membership.seriesId !== binding.series.id || membership.episodeId !== binding.episode.id)) fail('membership', 'binding identity does not match declared membership');
  return membership;
}
function readBinding(root, verify = true) {
  const file = path.join(root, BINDING);
  const memberFile = path.join(root, MEMBERSHIP);
  const membership = fs.existsSync(memberFile) ? readJson(memberFile) : null;
  if (membership) validateMembership(membership);
  if (!fs.existsSync(file)) {
    if (membership) fail('binding', 'current binding is incomplete; restore retained material');
    return null;
  }
  regular(root, BINDING, 'binding');
  if (!membership) fail('binding', 'missing explicit series-membership.json; restore membership declaration or detach');
  const binding = readBundle(path.join(root, CURRENT), verify);
  validateMembership(membership, binding);
  return binding;
}
function runtime(binding) {
  const dependencies = {};
  for (const resource of Object.values(binding.resources)) {
    const file = FILES + resource.file;
    dependencies[file] = [...new Set([...(dependencies[file] || []), ...(resource.dependencies || []).map(ref => FILES + ref)])];
  }
  return { defaults: defaultsFiles(binding.defaults, file => FILES + file), voiceOrder: binding.voiceOrder,
    files: binding.files.filter(e => e.role === 'resource').map(e => FILES + e.path),
    dependencies };
}
function applyBinding(raw, root) {
  const binding = readBinding(path.resolve(root));
  if (!binding) {
    if (raw.seriesOverrides !== undefined) fail('seriesOverrides', 'project has no binding; bind explicitly or remove the declaration');
    return { raw, provenance: null };
  }
  const effective = runtime(binding);
  const merged = mergeDefaults(raw, effective.defaults, effective.voiceOrder, effective.files, effective.dependencies);
  return { raw: merged.raw, provenance: { ...binding, origins: merged.origins, removals: merged.removals } };
}
function assertBoundConfig(config) {
  if (!config.seriesBinding) return;
  const current = readBinding(config.projectDir || '.');
  if (!current || current.revision !== config.seriesBinding.revision) fail('binding', 'selection changed since resolution; resolve the project again before work or reuse');
}
function dataProject(root) {
  const configs = CANDIDATES.filter(name => fs.existsSync(path.join(root, name)));
  return configs.length === 1 && configs[0].endsWith('.json') ? readJson(path.join(root, configs[0]), false) : null;
}
function inspectProject(directory) {
  const root = projectRoot(directory), binding = readBinding(root);
  if (!binding) fail('inspect', 'project has no binding');
  const raw = dataProject(root), effective = runtime(binding);
  const merged = raw ? mergeDefaults(raw, effective.defaults, effective.voiceOrder, effective.files, effective.dependencies) : null;
  const handoff = fs.existsSync(path.join(root, 'series-handoff.json')) ? readJson(path.join(root, 'series-handoff.json')) : null;
  return { ...binding, resources: Object.fromEntries(Object.entries(binding.resources).map(([name, entry]) => [name, { ...entry, retainedFile: FILES + entry.file, available: true }])),
    effective: merged ? { status: 'available', defaults: Object.fromEntries(['voices', 'characters', 'theme', 'captions'].filter(k => merged.raw[k] !== undefined).map(k => [k, merged.raw[k]])), origins: merged.origins, removals: merged.removals } : { status: 'unavailable', reason: 'executable project source was not evaluated', defaults: effective.defaults, voiceOrder: binding.voiceOrder }, handoff };
}
function inspectSource(input) {
  const loaded = source(input);
  return { ...loaded.raw, episodes: loaded.raw.episodes.map(e => {
    let status = 'planned';
    if (e.project) {
      status = catalogProject(loaded.root, e.project, `episodes.${e.id}.project`) ? 'available' : 'missing';
    }
    let pin;
    if (e.shared?.revision) {
      try { const snap = storedSnapshot(loaded, e.id); pin = { revision: snap.binding.revision, available: true, selection: snap.binding.selection }; }
      catch (error) { pin = { revision: e.shared.revision, available: false, reason: error.message }; }
    }
    return { ...e, projectStatus: status, ...(pin ? { pin } : {}) };
  }) };
}
function differences(root, before, after) {
  const raw = dataProject(root);
  const effective = binding => { const r = runtime(binding); return mergeDefaults(raw || {}, r.defaults, r.voiceOrder, r.files, r.dependencies); };
  const old = effective(before), next = effective(after);
  const fields = ['voices', 'characters', 'theme', 'captions'];
  const changedDefaults = fields.filter(key => canonical(old.raw[key]) !== canonical(next.raw[key]));
  const voiceOrderChanged = canonical(Object.keys(old.raw.voices || {})) !== canonical(Object.keys(next.raw.voices || {}));
  const oldFiles = new Map(before.files.filter(e => e.role === 'resource').map(e => [e.path, e.sha256]));
  const changedFiles = [...new Set([...oldFiles.keys(), ...after.files.filter(e => e.role === 'resource').map(e => e.path)])].filter(file => oldFiles.get(file) !== after.files.find(e => e.path === file && e.role === 'resource')?.sha256);
  const contextChanged = digest({ series: before.series, episode: before.episode, context: before.context, incoming: before.incoming, files: before.files.filter(e => e.role === 'context') }) !== digest({ series: after.series, episode: after.episode, context: after.context, incoming: after.incoming, files: after.files.filter(e => e.role === 'context') });
  let plan = { status: 'unavailable', reason: raw ? 'ordinary provider/runtime resolution was not invoked' : 'executable project source was not evaluated' };
  // Inspection never probes providers. Runtime deltas are candidate inputs, not
  // a promise that every selected resource is consumed or must rebuild.
  return { from: before.revision, to: after.revision, runtime: { changedDefaults, changedFiles, voiceOrderChanged, effective: raw ? 'available' : 'unavailable', consumption: 'ordinary diff/build determines affected consumers' }, contextChanged, origins: raw ? next.origins : null, plan };
}
function managedLock(root, operation) {
  const home = path.join(root, HOME);
  if (fs.existsSync(home) && (fs.lstatSync(home).isSymbolicLink() || !fs.statSync(home).isDirectory())) fail('binding', 'managed root must be a local directory');
  fs.mkdirSync(home, { recursive: true });
  const lock = path.join(home, 'lock');
  try { fs.mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') fail('mutation', `busy managed mutation; inspect ${lock} before recovering an abandoned lock`); throw error; }
  try { return operation(); } finally { try { fs.rmdirSync(lock); } catch {} }
}
function publish(root, snap, initial = false) {
  return managedLock(root, () => {
    const current = path.join(root, CURRENT);
    let previous;
    try { previous = readBinding(root, false); }
    catch (error) {
      if (!snap.repair) throw error;
      const membership = validateMembership(readJson(path.join(root, MEMBERSHIP)), snap.binding);
      previous = { series: { id: membership.seriesId }, episode: { id: membership.episodeId }, revision: null };
    }
    if (initial && previous) fail('bind', 'project is already bound; use adopt');
    if (initial && !previous && fs.existsSync(current)) fail('bind', 'current resource directory already contains ordinary sources; move those sources and update their local references before binding');
    if (previous && (previous.series.id !== snap.binding.series.id || previous.episode.id !== snap.binding.episode.id)) fail('binding', 'adoption cannot change series or episode identity; detach first');
    const stage = fs.mkdtempSync(path.join(root, HOME, '.stage-'));
    if (snap.expectedRevision && previous?.revision !== snap.expectedRevision) fail('adopt', 'binding changed while selection was prepared; inspect and retry');
    let backup = null, createdMembership = false;
    try {
      for (const entry of snap.entries) {
        const file = path.join(stage, 'files', entry.path); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, entry.data);
      }
      fs.writeFileSync(path.join(stage, 'binding.json'), `${JSON.stringify(snap.binding, null, 2)}\n`);
      readBundle(stage);
      if (previous && previous.revision) {
        const history = path.join(root, HOME, 'history');
        if (fs.existsSync(history) && fs.lstatSync(history).isSymbolicLink()) fail('history', 'symlink is not permitted');
        fs.mkdirSync(history, { recursive: true });
        const retained = path.join(history, previous.revision);
        if (fs.existsSync(retained)) {
          const historical = readBundle(retained);
          if (historical.revision !== previous.revision) fail('history', `retained revision does not match ${previous.revision}; preserve current material while repairing ${retained}`);
        } else {
          const retainedStage = fs.mkdtempSync(path.join(history, '.stage-'));
          try {
            fs.cpSync(current, retainedStage, { recursive: true, dereference: false });
            const historical = readBundle(retainedStage);
            if (historical.revision !== previous.revision) fail('history', 'current selection changed during retention; inspect and retry');
            fs.renameSync(retainedStage, retained);
          }
          catch (error) { try { fs.rmSync(retainedStage, { recursive: true, force: true }); } catch {} throw error; }
        }
      }
      if (fs.existsSync(current)) {
        backup = path.join(root, HOME, `.backup-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
        fs.renameSync(current, backup);
      }
      if (!previous) {
        fs.writeFileSync(path.join(root, MEMBERSHIP), `${JSON.stringify({ format: 'narova.series-member/1', seriesId: snap.binding.series.id, episodeId: snap.binding.episode.id })}\n`, { flag: 'wx' });
        createdMembership = true;
      }
      fs.renameSync(stage, current);
    } catch (error) {
      let retainStage = false;
      if (createdMembership) {
        try { fs.unlinkSync(path.join(root, MEMBERSHIP)); }
        catch (recovery) { retainStage = true; error.message += `; membership rollback failed (${recovery.message}); recover verified binding at ${stage} and inspect ${path.join(root, MEMBERSHIP)}`; }
      }
      if (!retainStage) { try { fs.rmSync(stage, { recursive: true, force: true }); } catch {} }
      if (backup && fs.existsSync(backup) && !fs.existsSync(current)) {
        try { fs.renameSync(backup, current); }
        catch (recovery) { throw new Error(`${error.message}; recovery failed (${recovery.message}); restore retained binding at ${backup}`); }
      }
      throw error;
    }
    if (backup) { try { fs.rmSync(backup, { recursive: true, force: true }); } catch {} }
    return { project: root, seriesId: snap.binding.series.id, episodeId: snap.binding.episode.id, revision: snap.binding.revision, committed: true };
  });
}
function bind(input, episodeId, options = {}) {
  const snap = snapshot(input, episodeId, options);
  if (!snap.project) fail('project', `episode ${episodeId} has no project; author it and supply --project`);
  const root = projectRoot(snap.project);
  const raw = dataProject(root);
  if (raw) { const r = runtime(snap.binding); mergeDefaults(raw, r.defaults, r.voiceOrder, r.files, r.dependencies); }
  return publish(root, snap, true);
}
// Preparation stays data-only. The CLI runs the ordinary build after this
// scoped authoring operation, retaining its receipt if production later fails.
function prepareBuild(input, episodeId, options = {}) {
  id(episodeId, 'episode');
  const loaded = source(input);
  const episode = loaded.raw.episodes.find(entry => entry.id === episodeId);
  if (!episode) fail('episode', `unknown catalog episode ${episodeId}`);
  const target = options.project || (episode.project && catalogProject(loaded.root, episode.project, `episodes.${episodeId}.project`));
  if (!target) fail('project', `episode ${episodeId} has no project; author it and supply --project`);
  const root = projectRoot(target), current = readBinding(root);
  if (episode.shared?.revision) {
    const snap = storedSnapshot(loaded, episodeId);
    assertSelection(options, snap.binding.selection, 'pinned selectors differ; repin the catalog episode explicitly');
    if (current && current.revision !== snap.binding.revision && !options.updateShared) fail('build', 'prepared revision differs from catalog pin; use --update-shared to adopt the verified pin');
  }
  if (!current) return { action: 'bind', ...bind(input, episodeId, { ...options, project: root }) };
  if (current.series.id !== loaded.raw.id || current.episode.id !== episodeId) {
    fail('build', 'series or episode identity does not match the target binding; select the correct project or detach first');
  }
  if (options.updateShared) return { action: 'adopt', ...adopt(input, root, options) };
  const selection = selectors(options, current.selection);
  for (const key of ['resources', 'context']) {
    if (new Set(selection[key]).size !== selection[key].length) fail(key, 'expected unique names');
    if (canonical([...selection[key]].sort()) !== canonical([...current.selection[key]].sort())) {
      fail('build', `changed --${key} selection requires --update-shared`);
    }
  }
  if (selection.incoming !== current.selection.incoming) fail('build', 'changed --incoming selection requires --update-shared');
  return { action: 'retained', project: root, seriesId: current.series.id,
    episodeId, revision: current.revision, committed: false };
}
function compare(input, directory, options = {}) {
  const root = projectRoot(directory), current = readBinding(root);
  if (!current) fail('compare', 'project has no binding');
  const snap = snapshot(input, current.episode.id, { ...options, project: root }, current.selection);
  if (snap.binding.series.id !== current.series.id) fail('compare', 'series identity does not match binding');
  return { ...differences(root, current, snap.binding), seriesId: current.series.id, episodeId: current.episode.id };
}
function adopt(input, directory, options = {}) {
  const root = projectRoot(directory), current = readBinding(root);
  if (!current) fail('adopt', 'project has no binding');
  const snap = snapshot(input, current.episode.id, { ...options, project: root }, current.selection);
  const report = differences(root, current, snap.binding);
  snap.expectedRevision = current.revision;
  return { ...publish(root, snap), changes: report };
}
function restore(revision, directory) {
  if (!HASH.test(revision || '')) fail('restore', 'expected an exact retained revision SHA-256');
  const root = projectRoot(directory), history = path.join(root, HOME, 'history', revision);
  regular(root, `${HOME}/history/${revision}/binding.json`, 'restore');
  const binding = readBundle(history);
  if (binding.revision !== revision) fail('restore', `historical content does not match requested revision ${revision}`);
  const entries = verifyEntries(binding, file => fs.readFileSync(regular(history, `files/${file}`, file)));
  const raw = dataProject(root), r = runtime(binding); if (raw) mergeDefaults(raw, r.defaults, r.voiceOrder, r.files, r.dependencies);
  return publish(root, { binding, entries, repair: true });
}
function handoff(file, directory) {
  const root = projectRoot(directory), binding = readBinding(root);
  if (!binding) fail('handoff', 'project has no binding');
  const value = readJson(file); state(value, 'handoff');
  const result = { format: 'narova.series-handoff/1', seriesId: binding.series.id, episodeId: binding.episode.id, value, sha256: digest(value) };
  return managedLock(root, () => {
    const temp = path.join(root, HOME, `.handoff-${crypto.randomBytes(6).toString('hex')}.json`);
    try { fs.writeFileSync(temp, `${JSON.stringify(result, null, 2)}\n`); fs.renameSync(temp, path.join(root, 'series-handoff.json')); }
    finally { try { fs.rmSync(temp, { force: true }); } catch {} }
    return result;
  });
}
function verifyArchive(entries) {
  const byName = new Map(entries.map(entry => [entry.path, entry.data]));
  const bytes = byName.get(BINDING), member = byName.get(MEMBERSHIP);
  if (!bytes) {
    if (member || entries.some(e => e.path.startsWith(`${CURRENT}/`) && !e.path.startsWith(FILES))) fail('archive', 'incomplete current binding');
    return null;
  }
  if (!member) fail('archive', 'missing explicit membership');
  const binding = parse(bytes, BINDING), membership = parse(member, MEMBERSHIP);
  validateMembership(membership, binding);
  const expected = new Set([BINDING, ...binding.files.map(e => FILES + e.path)]);
  for (const entry of entries) if (entry.path.startsWith(CURRENT + '/') && !expected.has(entry.path)) fail('archive', `unselected current member ${entry.path}`);
  verifyEntries(binding, file => byName.get(FILES + file));
  return binding;
}
function detach(directory, target) {
  const root = projectRoot(directory);
  let binding = readBinding(root);
  if (!binding) fail('detach', 'project has no binding');
  const destination = path.resolve(target);
  archive().assertSourceTargetSeparate(root, destination);
  if (fs.existsSync(destination)) fail('detach', `target already exists: ${destination}`);
  const selected = archive().collectProjectFiles(root);
  binding = verifyArchive(selected.files);
  const config = selected.configName, bytes = selected.files.find(e => e.path === config).data;
  const r = runtime(binding);
  let entries = selected.files.filter(e => e.path !== BINDING && e.path !== MEMBERSHIP && e.path !== config && e.path !== 'series-handoff.json');
  if (config.endsWith('.json')) {
    const merged = mergeDefaults(parse(bytes, config, false), r.defaults, r.voiceOrder, r.files, r.dependencies);
    entries.push({ path: config, data: Buffer.from(`${JSON.stringify(merged.raw, null, 2)}\n`) });
  } else {
    const reserved = ['series-original' + path.extname(config), 'series-defaults.json', 'series-merge.cjs', 'series-context.json'];
    for (const name of reserved) if (entries.some(e => e.path === name)) fail('detach', `materialization name already exists: ${name}`);
    const original = reserved[0];
    entries.push({ path: original, data: bytes }, { path: 'series-defaults.json', data: Buffer.from(JSON.stringify(r)) },
      { path: 'series-merge.cjs', data: fs.readFileSync(path.join(__dirname, 'series-defaults.js')) });
    const packageFile = selected.files.find(e => e.path === 'package.json');
    const moduleMode = config.endsWith('.mjs') || (config.endsWith('.js') && packageFile && parse(packageFile.data, 'package.json', false).type === 'module');
    const unwrap = config.endsWith('.js') ? `if (raw && raw.default) raw = raw.default;\n` : '';
    const wrapper = moduleMode
      ? `import * as source from './${original}';\nimport merge from './series-merge.cjs';\nconst raw = source.default ? source.default : source;\nconst d = ${JSON.stringify(r)};\nexport default merge.mergeDefaults(raw, d.defaults, d.voiceOrder, d.files, d.dependencies).raw;\n`
      : `let raw = require('./${original}');\n${unwrap}const d = require('./series-defaults.json');\nmodule.exports = require('./series-merge.cjs').mergeDefaults(raw, d.defaults, d.voiceOrder, d.files, d.dependencies).raw;\n`;
    entries.push({ path: config, data: Buffer.from(wrapper) });
  }
  if (entries.some(e => e.path === 'series-context.json')) fail('detach', 'series-context.json already exists');
  entries.push({ path: 'series-context.json', data: Buffer.from(`${JSON.stringify({ format: 'narova.series-context/1', series: binding.series, episode: binding.episode, revision: binding.revision, context: binding.context, incoming: binding.incoming, files: binding.files.filter(e => e.role === 'context') }, null, 2)}\n`) });
  archive().assertEntryDependencyClosure(entries);
  archive().assertAssetClosure(entries);
  const published = archive().publishEntries(entries, destination);
  return { target: published, seriesId: binding.series.id, episodeId: binding.episode.id, revision: binding.revision, committed: true };
}

module.exports = { STORE, pin, FORMAT, BINDING_FORMAT, MEMBERSHIP, BINDING, FILES, CURRENT, HOME, canonical, digest, validateSource, validateBinding, readBinding, applyBinding, assertBoundConfig, init, bind, prepareBuild, inspectSource, inspectProject, runtime, compare, adopt, restore, handoff, detach, verifyArchive };
