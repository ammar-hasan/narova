"use strict";
// Local selection resources are read without importing ASR, TTS or a runtime.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const RECOGNITION_ROOT = path.resolve(__dirname, '..');

function fileDigest(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let size;
    while ((size = fs.readSync(fd, chunk, 0, chunk.length, null))) hash.update(chunk.subarray(0, size));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

function resourceIdentity(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.isFile()) return { sha256: fileDigest(file) };
    if (!stat.isDirectory()) return { unavailable: 'not a model file or directory' };
    // Include filenames and contents, in stable order. Hugging Face snapshots
    // commonly symlink files into the blob store; hash those actual bytes too.
    const entries = [], ancestors = new Set();
    function scan(dir, prefix) {
      const real = fs.realpathSync(dir);
      if (ancestors.has(real)) throw new Error('cyclic model directory');
      ancestors.add(real);
      try {
        for (const name of fs.readdirSync(dir).sort()) {
          const absolute = path.join(dir, name), relative = prefix + name;
          const item = fs.statSync(absolute);
          if (item.isDirectory()) scan(absolute, relative + '/');
          else if (item.isFile()) entries.push([relative, fileDigest(absolute)]);
        }
      } finally { ancestors.delete(real); }
    }
    scan(file, '');
    return { sha256: crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex') };
  } catch (error) {
    // Missing/unreadable models still reach the explicit unavailable-ASR path.
    // Acquiring/fixing a model changes this identity before selection can reuse.
    return { unavailable: error.code || error.message };
  }
}

// Aliases in the installed faster-whisper model catalog; arbitrary Hub IDs
// also work directly. Inspect only the local main snapshot, never acquire it.
const FW_REPOS = Object.fromEntries(['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large-v1', 'large-v2', 'large-v3'].map(name => [name, `Systran/faster-whisper-${name}`]));
Object.assign(FW_REPOS, {
  large: FW_REPOS['large-v3'],
  ...Object.fromEntries(['distil-large-v2', 'distil-medium.en', 'distil-small.en', 'distil-large-v3'].map(name => [name, `Systran/faster-${name.replace('distil-', 'distil-whisper-')}`])),
  'distil-large-v3.5': 'distil-whisper/distil-large-v3.5-ct2',
  'large-v3-turbo': 'mobiuslabsgmbh/faster-whisper-large-v3-turbo',
  turbo: 'mobiuslabsgmbh/faster-whisper-large-v3-turbo',
});

// Match huggingface_hub's POSIX expanduser-then-expandvars order. The Rust
// tokenizer client deliberately keeps its raw HF_HOME semantics separately.
function pythonCachePath(value) {
  const match = value.match(/^~([^/]*)(?=\/|$)/);
  if (match) {
    let home;
    if (!match[1]) home = os.homedir();
    else {
      const user = os.userInfo();
      if (match[1] === user.username) home = user.homedir;
      else {
        try { home = fs.readFileSync('/etc/passwd', 'utf8').split('\n').find(line => line.split(':')[0] === match[1])?.split(':')[5]; } catch {}
      }
    }
    if (home) value = home + value.slice(match[0].length);
  }
  return value.replace(/\$(\w+|\{[^}]*\})/g, (all, key) => process.env[key.startsWith('{') ? key.slice(1, -1) : key] ?? all);
}

function cachedSnapshot(model, cacheRoot, tokenizerOnly = false) {
  const repo = FW_REPOS[model] || (model.includes('/') ? model : null);
  if (!repo) return { unavailable: 'unknown model identifier' };
  const hfHome = pythonCachePath(process.env.HF_HOME || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'huggingface'));
  const cache = path.resolve(RECOGNITION_ROOT, cacheRoot || pythonCachePath(process.env.HF_HUB_CACHE || process.env.HUGGINGFACE_HUB_CACHE || path.join(hfHome, 'hub')));
  const dir = path.join(cache, `models--${repo.replaceAll('/', '--')}`);
  try {
    const revision = fs.readFileSync(path.join(dir, 'refs', 'main'), 'utf8').trim();
    if (!/^[a-f0-9]{40,64}$/i.test(revision)) return { unavailable: 'invalid local model revision' };
    const snapshot = path.join(dir, 'snapshots', revision);
    return { repo, revision, tokenizerBound: fs.existsSync(path.join(snapshot, 'tokenizer.json')),
      ...resourceIdentity(tokenizerOnly ? path.join(snapshot, 'tokenizer.json') : snapshot) };
  } catch (error) { return { repo, unavailable: error.code || error.message }; }
}

function selectionIdentity(config) {
  const engine = config.speech.engine || config.align?.engine || 'auto';
  const model = config.speech.model || config.align?.model || process.env.NAROVA_WHISPER_MODEL || null;
  const resources = {};
  if (model) {
    // Resolved authored local paths are absolute. Environment paths are relative
    // to the synthesis helper's working directory, as in Python recognition.
    const local = path.resolve(__dirname, '..', model);
    if (fs.existsSync(local) || path.isAbsolute(model) || model.startsWith('.')) resources.local = resourceIdentity(local);
  }
  if (engine === 'auto' || engine === 'faster-whisper') {
    const local = model && path.resolve(__dirname, '..', model);
    let fallbackTokenizer = local && fs.existsSync(local) && !fs.existsSync(path.join(local, 'tokenizer.json'));
    if (!local || !fs.existsSync(local)) {
      // Default choice depends on turn language; bind both possible defaults
      // without importing the recognizer or changing sentence-cache identity.
      for (const name of model ? [model] : ['tiny.en', 'tiny']) {
        const snapshot = cachedSnapshot(name);
        resources[`fasterWhisper:${name}`] = snapshot;
        if (!snapshot.tokenizerBound) fallbackTokenizer = true;
      }
    }
    if (fallbackTokenizer) {
      // Tokenizers' Rust Hub client uses HF_HOME/hub (not the Python Hub
      // cache override or XDG_CACHE_HOME). Actual model capability chooses
      // English/multilingual after loading; bind both without loading it here.
      const cache = path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'), 'hub');
      for (const name of ['openai/whisper-tiny.en', 'openai/whisper-tiny']) resources[`tokenizer:${name}`] = cachedSnapshot(name, cache, true);
    }
  }
  if (engine === 'auto' || engine === 'whisper-cpp') {
    const selected = model || 'ggml-tiny.en.bin';
    const direct = path.resolve(__dirname, '..', selected);
    let file;
    try { if (fs.statSync(direct).isFile()) file = direct; } catch {}
    file ||= path.resolve(RECOGNITION_ROOT, process.env.NAROVA_HOME || path.join(os.homedir(), '.narova'), 'models', selected);
    resources.whisperCpp = resourceIdentity(file);
  }
  return { retakes: config.speech.retakes, engine, model, resources };
}

module.exports = { selectionIdentity };
