'use strict';
/* Locate + load a project config: reel.config.{mjs,js,json}. Supports ESM
 * (export default) and CJS (module.exports) and plain JSON. */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const CANDIDATES = ['reel.config.mjs', 'reel.config.js', 'reel.config.json', 'reel.config.cjs'];

/* Locate the config from `dir`, walking UP toward the filesystem root if it is
 * not there. Commands are often run from a subdirectory (e.g. out/hf after a
 * hyperframes call); the project is the nearest ancestor holding a config. */
function findConfig(dir) {
  let d = path.resolve(dir || '.');
  for (;;) {
    for (const name of CANDIDATES) {
      const p = path.join(d, name);
      if (fs.existsSync(p)) return p;
    }
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

async function loadConfigFile(file) {
  const ext = path.extname(file);
  if (ext === '.json') return JSON.parse(fs.readFileSync(file, 'utf8'));
  // Try CJS require first (fast, works for module.exports); fall back to ESM import.
  if (ext === '.cjs') return require(path.resolve(file));
  try {
    const mod = require(path.resolve(file));
    return mod && mod.default ? mod.default : mod;
  } catch (e) {
    if (!/import|export|Cannot use import|ES Module/.test(String(e.message))) {
      // Not an ESM-vs-CJS problem — re-throw.
      if (ext !== '.mjs') throw e;
    }
    const mod = await import(pathToFileURL(path.resolve(file)).href);
    return mod && mod.default ? mod.default : mod;
  }
}

/* Resolve the config file for a project dir (or an explicit --config path). */
async function loadProjectConfig(projectDir, explicitFile) {
  const file = explicitFile
    ? path.resolve(explicitFile)
    : findConfig(projectDir);
  if (!file || !fs.existsSync(file)) {
    throw new Error(`No config found. Expected one of ${CANDIDATES.join(', ')} in ${path.resolve(projectDir || '.')} or any parent directory`);
  }
  const raw = await loadConfigFile(file);
  return { raw, file, dir: path.dirname(file) };
}

module.exports = { findConfig, loadConfigFile, loadProjectConfig, CANDIDATES };
