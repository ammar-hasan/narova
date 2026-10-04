'use strict';
/* Ordinary explicit files: contained source validation and source-relative
 * references when a selected document is inlined into the composition. */
const fs = require('fs');
const path = require('path');
function resolveLocalResources(value, root) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || new Set(value).size !== value.length) throw new Error('config.localResources: expected unique project-relative file paths');
  return value.map((file, index) => {
    const label = `config.localResources[${index}]`;
    require('./project-archive').safeMemberPath(file);
    if (!file.includes('/') || ['assets', 'audio', 'spans'].includes(file.split('/')[0])) throw new Error(`${label}: use a subdirectory outside the renderer-owned assets mount`);
    let current = path.resolve(root);
    for (const part of file.split('/')) {
      current = path.join(current, part);
      let stat;
      try { stat = fs.lstatSync(current); } catch { throw new Error(`${label}: file not found: ${file}`); }
      if (stat.isSymbolicLink()) throw new Error(`${label}: symlink is not permitted: ${file}`);
    }
    if (!fs.statSync(current).isFile()) throw new Error(`${label}: expected a regular file: ${file}`);
    return file;
  });
}
function relativeUrl(value, file) {
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\/)/i.test(value)) return value;
  const suffix = value.search(/[?#]/);
  const local = suffix < 0 ? value : value.slice(0, suffix);
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(file), local));
  require('./project-archive').safeMemberPath(joined);
  return joined + (suffix < 0 ? '' : value.slice(suffix));
}
function rebaseSource(contents, file) {
  const ext = path.posix.extname(file).toLowerCase();
  if (['.js', '.mjs', '.cjs'].includes(ext)) {
    // The supported literal module references keep their declaring directory
    // when the source is inlined. Do not change ordinary strings or comments.
    const code = contents.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g, value => ' '.repeat(value.length));
    const replacements = [];
    const patterns = [/\b(?:require|import)\s*\(\s*(['"])([^'"]+)\1\s*\)/g, /\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s+)?(['"])([^'"]+)\1/g];
    for (const pattern of patterns) for (const match of contents.matchAll(pattern)) {
      if (!/^(?:require|import|export)\b/.test(code.slice(match.index))) continue;
      const ref = relativeUrl(match[2], file);
      const value = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(ref) ? ref : './' + ref;
      const start = match.index + match[0].indexOf(match[1]) + 1;
      replacements.push({ start, end: start + match[2].length, value });
    }
    for (const replacement of replacements.sort((a, b) => b.start - a.start)) contents = contents.slice(0, replacement.start) + replacement.value + contents.slice(replacement.end);
    return contents;
  }
  if (['.html', '.htm', '.svg', '.css'].includes(ext)) {
    let result = contents.replace(/url\(\s*("([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi,
      (_, quoted, double, single, bare) => `url(${JSON.stringify(relativeUrl(double ?? single ?? bare, file))})`);
    result = result.replace(/@import\s+(['"])([^'"]+)\1/gi, (_, quote, ref) => `@import ${quote}${relativeUrl(ref, file)}${quote}`);
    if (ext !== '.css') {
      result = result.replace(/\b(src|poster|href|data)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
        (_, attr, quoted, double, single, bare) => `${attr}="${relativeUrl(double ?? single ?? bare, file)}"`);
      result = result.replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (_, quoted, double, single) =>
        `srcset="${(double ?? single).split(',').map(candidate => {
          const [url, ...descriptor] = candidate.trim().split(/\s+/);
          return [relativeUrl(url, file), ...descriptor].join(' ');
        }).join(', ')}"`);
    }
    return result;
  }
  if (ext === '.json') {
    const raw = JSON.parse(contents);
    const fields = new Set(['src', 'fontFile', 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'texture', 'envMap']);
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (fields.has(key) && typeof child === 'string') value[key] = relativeUrl(child, file);
        else visit(child);
      }
    }
    visit(raw);
    return JSON.stringify(raw);
  }
  return contents;
}
function copyLocalResources(config, directory) {
  require('./series').assertBoundConfig(config);
  for (const file of resolveLocalResources(config.localResources, config.projectDir)) {
    const destination = path.join(directory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.resolve(config.projectDir, file), destination);
  }
}
function resolveResourceDependencies(value, resources) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config.localResourceDependencies: expected a path map');
  const selected = new Set(resources), result = {};
  for (const [file, refs] of Object.entries(value)) {
    if (!selected.has(file) || !Array.isArray(refs) || new Set(refs).size !== refs.length || refs.some(ref => !selected.has(ref) || ref === file)) throw new Error(`config.localResourceDependencies.${file}: declare unique selected dependency paths without self-reference`);
    result[file] = [...refs];
  }
  return result;
}
function expandResourceRefs(refs, dependencies, root) {
  const queue = Object.keys(refs);
  for (let i = 0; i < queue.length; i++) for (const file of dependencies[queue[i]] || []) {
    if (Object.prototype.hasOwnProperty.call(refs, file)) continue;
    refs[file] = require('crypto').createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex');
    queue.push(file);
  }
  return refs;
}
function dependencyInputs(file, dependencies, root) {
  const refs = { [file]: null };
  expandResourceRefs(refs, dependencies, root);
  delete refs[file];
  return Object.fromEntries(Object.entries(refs).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
module.exports = { resolveLocalResources, rebaseSource, copyLocalResources, resolveResourceDependencies, expandResourceRefs, dependencyInputs };
