'use strict';
/* Explicit external TTS provider registry.
 *
 * Registration copies a normalized manifest into ~/.narova/providers. Narova
 * never scans skill directories and never executes an unregistered worker.
 * Workers are always spawned with argv arrays (never through a shell). */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { isBuiltinBackend } = require('./tts-backends');

const PROVIDER_PROTOCOL = 'narova-tts-provider/v1';
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SECRET_KEY_RE = /(?:api[-_]?key|authorization|credential|password|secret|token)/i;

const narovaHome = () => path.resolve(process.env.NAROVA_HOME || path.join(os.homedir(), '.narova'));
const providersDir = () => path.join(narovaHome(), 'providers');
const providerPath = name => path.join(providersDir(), `${name}.json`);
const isProviderName = name => typeof name === 'string' && NAME_RE.test(name);

function executableOnPath(name) {
  const search = String(process.env.PATH || '').split(path.delimiter);
  const extensions = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of search) {
    for (const ext of extensions) {
      const candidate = path.join(dir || '.', name + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return path.resolve(candidate);
      } catch {}
    }
  }
  return null;
}

function normalizeCommand(command, baseDir) {
  if (!Array.isArray(command) || command.length === 0
      || command.some(part => typeof part !== 'string' || !part.length || part.includes('\0'))) {
    throw new Error('provider.command: expected a non-empty array of non-empty argument strings');
  }
  const normalized = command.map((part, index) => {
    if (path.isAbsolute(part)) return path.normalize(part);
    const candidate = path.resolve(baseDir, part);
    if (index > 0 && (part.startsWith('.') || part.includes('/') || part.includes('\\') || fs.existsSync(candidate))) {
      return candidate;
    }
    return part;
  });
  const executable = path.isAbsolute(normalized[0])
      || normalized[0].includes('/') || normalized[0].includes('\\')
    ? path.resolve(baseDir, normalized[0])
    : executableOnPath(normalized[0]);
  if (!executable) {
    throw new Error(`provider.command: executable or interpreter not found: ${JSON.stringify(normalized[0])}`);
  }
  try {
    fs.accessSync(executable, fs.constants.X_OK);
    if (!fs.statSync(executable).isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`provider.command: executable or interpreter is not runnable: ${executable}`);
  }
  normalized[0] = executable;
  return normalized;
}

function validateManifest(raw, baseDir = '.') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('provider manifest: expected a JSON object');
  }
  if (!isProviderName(raw.name)) {
    throw new Error(`provider.name: must match ${NAME_RE}`);
  }
  if (isBuiltinBackend(raw.name)) {
    throw new Error(`provider.name: ${JSON.stringify(raw.name)} is reserved by a built-in backend`);
  }
  if (raw.protocol !== PROVIDER_PROTOCOL) {
    throw new Error(`provider.protocol: unsupported protocol ${JSON.stringify(raw.protocol)}; expected ${PROVIDER_PROTOCOL}`);
  }
  if (raw.displayName != null && (typeof raw.displayName !== 'string' || !raw.displayName.trim())) {
    throw new Error('provider.displayName: expected a non-empty string');
  }
  const command = normalizeCommand(raw.command, baseDir);
  const requiredEnvironment = raw.requiredEnvironment == null ? [] : raw.requiredEnvironment;
  if (!Array.isArray(requiredEnvironment)
      || requiredEnvironment.some(name => typeof name !== 'string' || !ENV_RE.test(name))
      || new Set(requiredEnvironment).size !== requiredEnvironment.length) {
    throw new Error('provider.requiredEnvironment: expected unique environment-variable names');
  }
  const capabilities = raw.capabilities == null ? {} : raw.capabilities;
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)
      || Object.values(capabilities).some(value => typeof value !== 'boolean')) {
    throw new Error('provider.capabilities: expected an object with boolean values');
  }
  if (capabilities.synthesis !== true) {
    throw new Error('provider.capabilities.synthesis: must be true');
  }
  if (raw.providerVersion != null
      && (typeof raw.providerVersion !== 'string' || !raw.providerVersion.trim())) {
    throw new Error('provider.providerVersion: expected a non-empty string');
  }
  // NAR-018-068 — optional delivery-control capability declarations. Open
  // family key set (workers may declare families narova does not know), but
  // a closed status vocabulary. Declarations are disclosures only: they
  // never restrict what options a request may carry.
  if (raw.deliveryCapabilities != null) {
    if (!raw.deliveryCapabilities || typeof raw.deliveryCapabilities !== 'object'
        || Array.isArray(raw.deliveryCapabilities)) {
      throw new Error('provider.deliveryCapabilities: expected an object of family -> "honored" | "ignored" | "unknown"');
    }
    for (const [family, status] of Object.entries(raw.deliveryCapabilities)) {
      if (!/^[a-z][a-z0-9-]*$/.test(family)) {
        throw new Error(`provider.deliveryCapabilities.${family}: family names must be lowercase hyphenated identifiers`);
      }
      if (!['honored', 'ignored', 'unknown'].includes(status)) {
        throw new Error(`provider.deliveryCapabilities.${family}: status must be "honored" | "ignored" | "unknown" (got ${JSON.stringify(status)})`);
      }
    }
  }
  return {
    name: raw.name,
    displayName: raw.displayName || raw.name,
    protocol: PROVIDER_PROTOCOL,
    command,
    requiredEnvironment: [...requiredEnvironment],
    capabilities: { ...capabilities },
    ...(raw.providerVersion ? { providerVersion: raw.providerVersion } : {}),
    ...(raw.deliveryCapabilities ? { deliveryCapabilities: { ...raw.deliveryCapabilities } } : {}),
  };
}

function responseError(response, fallback) {
  const error = response && response.error;
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  return fallback;
}

function handshake(manifest, opts = {}) {
  const request = JSON.stringify({ operation: 'hello', protocol: PROVIDER_PROTOCOL }) + '\n';
  const result = spawnSync(manifest.command[0], manifest.command.slice(1), {
    input: request,
    encoding: 'utf8',
    timeout: opts.timeout == null ? 10000 : opts.timeout,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') throw new Error(`provider ${manifest.name} handshake timed out`);
    throw new Error(`provider ${manifest.name} failed to start: ${result.error.message}`);
  }
  const line = String(result.stdout || '').split(/\r?\n/).find(Boolean);
  if (!line) {
    throw new Error(`provider ${manifest.name} exited without a handshake response`);
  }
  let response;
  try { response = JSON.parse(line); }
  catch { throw new Error(`provider ${manifest.name} returned invalid JSON during handshake`); }
  if (!response || response.ok !== true) {
    throw new Error(`provider ${manifest.name} handshake failed: ${responseError(response, 'unknown worker error')}`);
  }
  if (response.protocol !== PROVIDER_PROTOCOL) {
    throw new Error(`provider ${manifest.name} uses unsupported protocol ${JSON.stringify(response.protocol)}; expected ${PROVIDER_PROTOCOL}`);
  }
  if (response.provider !== manifest.name) {
    throw new Error(`provider handshake name mismatch: manifest=${manifest.name}, worker=${JSON.stringify(response.provider)}`);
  }
  if (typeof response.providerVersion !== 'string' || !response.providerVersion.trim()) {
    throw new Error(`provider ${manifest.name} handshake omitted providerVersion`);
  }
  return response;
}

function readManifestFile(filePath) {
  const absolute = path.resolve(filePath);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(absolute, 'utf8')); }
  catch (error) { throw new Error(`cannot read provider manifest ${absolute}: ${error.message}`); }
  return validateManifest(raw, path.dirname(absolute));
}

function addProvider(filePath, opts = {}) {
  const manifest = readManifestFile(filePath);
  if (typeof opts.beforeHandshake === 'function') opts.beforeHandshake(manifest);
  const destination = providerPath(manifest.name);
  if (fs.existsSync(destination)) {
    throw new Error(`provider ${JSON.stringify(manifest.name)} is already registered`);
  }
  const hello = handshake(manifest, opts);
  const registered = { ...manifest, providerVersion: hello.providerVersion };
  fs.mkdirSync(providersDir(), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(registered, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, destination);
  return { ...registered, missingEnvironment: missingEnvironment(registered) };
}

function getProvider(name) {
  if (!isProviderName(name)) return null;
  const file = providerPath(name);
  if (!fs.existsSync(file)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`registered provider ${name} has invalid JSON: ${error.message}`); }
  const manifest = validateManifest(raw, providersDir());
  if (manifest.name !== name) {
    throw new Error(`registered provider filename/name mismatch for ${name}`);
  }
  return manifest;
}

function listProviders() {
  if (!fs.existsSync(providersDir())) return [];
  return fs.readdirSync(providersDir(), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => getProvider(entry.name.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function removeProvider(name) {
  if (!isProviderName(name)) {
    throw new Error(`provider name must match ${NAME_RE}`);
  }
  const manifest = getProvider(name);
  if (!manifest) throw new Error(`provider ${JSON.stringify(name)} is not registered`);
  fs.unlinkSync(providerPath(name));
  return manifest;
}

function missingEnvironment(manifest) {
  return (manifest.requiredEnvironment || []).filter(name => !process.env[name]);
}

function doctorProvider(name, opts = {}) {
  const manifest = getProvider(name);
  if (!manifest) throw new Error(`provider ${JSON.stringify(name)} is not registered`);
  if (typeof opts.beforeHandshake === 'function') opts.beforeHandshake(manifest);
  const missing = missingEnvironment(manifest);
  const hello = handshake(manifest, opts);
  return {
    ok: missing.length === 0,
    manifest,
    hello,
    missingEnvironment: missing,
  };
}

function jsonCompatibilityError(value, at = 'providerOptions', seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : `${at}: numbers must be finite and JSON-compatible`;
  }
  if (typeof value !== 'object') return `${at}: value must be JSON-compatible`;
  if (seen.has(value)) return `${at}: circular values are not JSON-compatible`;
  if (Array.isArray(value)) {
    seen.add(value);
    for (let i = 0; i < value.length; i++) {
      const error = jsonCompatibilityError(value[i], `${at}[${i}]`, seen);
      if (error) return error;
    }
    seen.delete(value);
    return null;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return `${at}: expected plain JSON objects`;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) {
      return `${at}.${key}: secret-like key is not allowed; use the provider's required environment variables`;
    }
    const error = jsonCompatibilityError(child, `${at}.${key}`, seen);
    if (error) return error;
  }
  seen.delete(value);
  return null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function containsRequiredEnvironmentValue(value, manifest) {
  const secrets = new Set((manifest.requiredEnvironment || [])
    .map(name => process.env[name])
    .filter(secret => typeof secret === 'string' && secret.length > 0));
  if (secrets.size === 0) return false;
  function visit(child) {
    if (typeof child === 'string') return secrets.has(child);
    if (Array.isArray(child)) return child.some(visit);
    if (child && typeof child === 'object') return Object.values(child).some(visit);
    return false;
  }
  return visit(value);
}

module.exports = {
  PROVIDER_PROTOCOL,
  providersDir,
  providerPath,
  isProviderName,
  validateManifest,
  readManifestFile,
  handshake,
  addProvider,
  getProvider,
  listProviders,
  removeProvider,
  doctorProvider,
  missingEnvironment,
  jsonCompatibilityError,
  stableStringify,
  containsRequiredEnvironmentValue,
};
