'use strict';
/* Provider-neutral AI video clip generation for Narova.
 *
 * Hosted API details live in explicitly registered companion workers speaking
 * narova-video-provider/v1. Core owns the project boundary, staging, recipe,
 * hashing, asset registry, and rollback transaction. */

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { spawn, spawnSync } = require('child_process');
const {
  readAssetLock, registerAsset, resolveProjectFile,
  sanitizeUrl, sha256, withAssetMutation,
} = require('./asset-registry');
const {
  VIDEO_PROVIDER_PROTOCOL, getVideoProvider, missingEnvironment,
  jsonCompatibilityError, containsRequiredEnvironmentValue, redactProviderText,
} = require('./providers');

const HANDSHAKE_TIMEOUT_MS = 10000;
const GENERATION_TIMEOUT_MS = 20 * 60 * 1000;
const MEDIA_PROBE_TIMEOUT_MS = 10000;
const MAX_GENERATED_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_WORKER_RESPONSE_BYTES = 1024 * 1024;
const MAX_WORKER_STDERR_BYTES = 64 * 1024;
const MAX_WORKER_DIAGNOSTIC_DISPLAY_BYTES = 4 * 1024;

function providerResponseError(response, fallback, manifest = { requiredEnvironment: [] }) {
  const error = response && response.error;
  if (typeof error === 'string') return redactProviderText(error, manifest);
  if (error && typeof error.message === 'string') return redactProviderText(error.message, manifest);
  return redactProviderText(fallback, manifest);
}

class JsonLineWorker {
  constructor(manifest) {
    this.manifest = manifest;
    this.child = null;
    this.pending = null;
    this.exited = null;
    this.fatalError = null;
    this.stderrBuffer = Buffer.alloc(0);
    this.stderrBytes = 0;
  }

  async start() {
    let child;
    try {
      child = spawn(this.manifest.command[0], this.manifest.command.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch (error) {
      throw new Error(`provider ${this.manifest.name} failed to start: ${redactProviderText(error.message, this.manifest)}`);
    }
    this.child = child;
    child.stderr.on('data', chunk => this.onStderrChunk(chunk));
    child.stdout.on('data', chunk => this.onStdoutChunk(chunk));
    child.on('error', error => this.onExit(null, error));
    child.on('exit', (code, signal) => this.onExit(code, null, signal));

    const hello = await this.exchange(
      { operation: 'hello', protocol: VIDEO_PROVIDER_PROTOCOL },
      HANDSHAKE_TIMEOUT_MS,
      'handshake',
    );
    if (hello.ok !== true) {
      throw new Error(`provider ${this.manifest.name} handshake failed: ${providerResponseError(hello, 'unknown worker error', this.manifest)}`);
    }
    if (hello.protocol !== VIDEO_PROVIDER_PROTOCOL) {
      throw new Error(`provider ${this.manifest.name} uses unsupported protocol ${JSON.stringify(hello.protocol)}; expected ${VIDEO_PROVIDER_PROTOCOL}`);
    }
    if (hello.provider !== this.manifest.name) {
      throw new Error(`provider handshake name mismatch: manifest=${this.manifest.name}, worker=${JSON.stringify(hello.provider)}`);
    }
    if (typeof hello.providerVersion !== 'string' || !hello.providerVersion.trim()) {
      throw new Error(`provider ${this.manifest.name} handshake omitted providerVersion`);
    }
    return hello;
  }

  failWorker(message) {
    const pending = this.pending;
    const error = new Error(message);
    this.fatalError = error;
    if (pending) {
      this.pending = null;
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.terminate();
  }

  onStdoutChunk(chunk) {
    const pending = this.pending;
    if (!pending) return;
    const bytes = Buffer.from(chunk);
    pending.outputBytes += bytes.length;
    if (pending.outputBytes > MAX_WORKER_RESPONSE_BYTES) {
      this.failWorker(`provider ${this.manifest.name} exceeded the ${MAX_WORKER_RESPONSE_BYTES}-byte response limit during ${pending.operation}`);
      return;
    }
    pending.outputBuffer = Buffer.concat([pending.outputBuffer, bytes]);
    const newline = pending.outputBuffer.indexOf(0x0a);
    if (newline < 0) return;
    const line = pending.outputBuffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
    this.pending = null;
    clearTimeout(pending.timer);
    let response;
    try { response = JSON.parse(line); }
    catch {
      pending.reject(new Error(`provider ${this.manifest.name} returned invalid JSON during ${pending.operation}`));
      return;
    }
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      pending.reject(new Error(`provider ${this.manifest.name} returned a non-object response during ${pending.operation}`));
      return;
    }
    pending.resolve(response);
  }

  onStderrChunk(chunk) {
    const bytes = Buffer.from(chunk);
    this.stderrBytes += bytes.length;
    if (this.stderrBytes > MAX_WORKER_STDERR_BYTES) {
      this.failWorker(`provider ${this.manifest.name} exceeded the ${MAX_WORKER_STDERR_BYTES}-byte diagnostic limit`);
      return;
    }
    this.stderrBuffer = Buffer.concat([this.stderrBuffer, bytes]);
    while (true) {
      const newline = this.stderrBuffer.indexOf(0x0a);
      if (newline < 0) break;
      const line = this.stderrBuffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
      this.stderrBuffer = this.stderrBuffer.subarray(newline + 1);
      this.writeDiagnostic(line, true);
    }
  }

  writeDiagnostic(value, newline = false) {
    const bytes = Buffer.from(String(value));
    const clipped = bytes.length > MAX_WORKER_DIAGNOSTIC_DISPLAY_BYTES
      ? `${bytes.subarray(0, MAX_WORKER_DIAGNOSTIC_DISPLAY_BYTES).toString('utf8')}… [provider diagnostic truncated]`
      : bytes.toString('utf8');
    process.stderr.write(`${redactProviderText(clipped, this.manifest)}${newline ? '\n' : ''}`);
  }

  onExit(code, error = null, signal = null) {
    if (this.exited) return;
    this.exited = { code, error, signal };
    if (this.stderrBuffer.length && !this.fatalError) {
      this.writeDiagnostic(this.stderrBuffer.toString('utf8'));
      this.stderrBuffer = Buffer.alloc(0);
    }
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timer);
      const detail = redactProviderText(
        error ? error.message : (signal ? `signal ${signal}` : `status ${code}`),
        this.manifest,
      );
      pending.reject(new Error(`provider ${this.manifest.name} exited during ${pending.operation} (${detail})`));
    }
  }

  exchange(request, timeoutMs, operation) {
    if (this.fatalError) return Promise.reject(this.fatalError);
    if (!this.child || this.exited) {
      return Promise.reject(new Error(`provider ${this.manifest.name} worker is not running`));
    }
    if (this.pending) {
      return Promise.reject(new Error(`provider ${this.manifest.name} already has a pending request`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending) return;
        this.pending = null;
        reject(new Error(`provider ${this.manifest.name} ${operation} timed out`));
        this.terminate();
      }, timeoutMs);
      this.pending = {
        resolve, reject, timer, operation,
        outputBytes: 0,
        outputBuffer: Buffer.alloc(0),
      };
      this.child.stdin.write(`${JSON.stringify(request)}\n`, error => {
        if (!error || !this.pending) return;
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timer);
        pending.reject(new Error(`provider ${this.manifest.name} failed while sending ${operation}: ${error.message}`));
      });
    });
  }

  terminate() {
    const child = this.child;
    if (!child || this.exited) return;
    try { child.kill('SIGTERM'); } catch {}
  }

  async close() {
    const child = this.child;
    if (!child || this.exited) return;
    try { child.stdin.end(); } catch {}
    await new Promise(resolve => {
      if (this.exited) { resolve(); return; }
      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 500).unref();
      }, 1000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

function probeVideo(file, opts = {}) {
  if (typeof opts.probeVideo === 'function') return opts.probeVideo(file);
  const probe = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type', '-of', 'default=nw=1:nk=1', file,
  ], {
    encoding: 'utf8',
    timeout: opts.probeTimeoutMs == null ? MEDIA_PROBE_TIMEOUT_MS : opts.probeTimeoutMs,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
  if (probe.error && probe.error.code === 'ETIMEDOUT') {
    throw new Error(`generated video validation timed out after ${opts.probeTimeoutMs || MEDIA_PROBE_TIMEOUT_MS}ms`);
  }
  if (probe.error) throw new Error(`cannot validate generated video: ${probe.error.message}`);
  if (probe.status !== 0 || !String(probe.stdout || '').split(/\r?\n/).includes('video')) {
    throw new Error(`generated output is not a decodable video${probe.stderr ? `: ${String(probe.stderr).trim()}` : ''}`);
  }
}

function validateStagedVideo(file, manifest, opts = {}) {
  let stats;
  try {
    const link = fs.lstatSync(file);
    if (link.isSymbolicLink() || !link.isFile()) throw new Error('not a regular file');
    stats = fs.statSync(file);
  } catch {
    throw new Error(`provider ${manifest.name} did not produce a regular output file at ${file}`);
  }
  if (stats.size <= 0) throw new Error(`provider ${manifest.name} produced an empty output file`);
  const maxBytes = opts.maxVideoBytes == null ? MAX_GENERATED_VIDEO_BYTES : opts.maxVideoBytes;
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('generated-video byte limit must be a positive integer');
  if (stats.size > maxBytes) {
    throw new Error(`provider ${manifest.name} output exceeds the ${maxBytes}-byte generated-video limit`);
  }
  const fd = fs.openSync(file, 'r');
  let prefix;
  try {
    prefix = Buffer.alloc(Math.min(1024, stats.size));
    fs.readSync(fd, prefix, 0, prefix.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const text = prefix.toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^(?:<!doctype\s+html\b|<html\b|<head\b|<body\b)/i.test(text) || /^[{[]/.test(text)) {
    throw new Error(`provider ${manifest.name} returned an error document instead of video`);
  }
  probeVideo(file, opts);
  return stats;
}

function validateProviderResult(manifest, request, result, opts = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`provider ${manifest.name} returned an invalid generation result`);
  }
  if (result.id !== request.id) {
    throw new Error(`provider ${manifest.name} response id mismatch: expected ${request.id}, got ${JSON.stringify(result.id)}`);
  }
  if (result.ok !== true) {
    throw new Error(`provider ${manifest.name} generation failed: ${providerResponseError(result, 'unknown worker error', manifest)}`);
  }
  if (typeof result.output !== 'string' || result.output !== request.output) {
    throw new Error(`provider ${manifest.name} returned unexpected output path`);
  }
  const metadata = result.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`provider ${manifest.name} generation response omitted metadata`);
  }
  if (metadata.model != null && (typeof metadata.model !== 'string' || !metadata.model.trim())) {
    throw new Error(`provider ${manifest.name} metadata.model must be a non-empty string or null`);
  }
  if (!metadata.params || typeof metadata.params !== 'object' || Array.isArray(metadata.params)) {
    throw new Error(`provider ${manifest.name} metadata.params must be a JSON object`);
  }
  const jsonError = jsonCompatibilityError(metadata.params, 'provider metadata.params');
  if (jsonError) throw new Error(jsonError);
  if (containsRequiredEnvironmentValue(metadata, manifest)) {
    throw new Error(`provider ${manifest.name} metadata contains a required environment secret`);
  }
  if (metadata.model != null && metadata.params.model != null && metadata.model !== metadata.params.model) {
    throw new Error(`provider ${manifest.name} metadata model does not match params.model`);
  }
  if (metadata.sourceVideoUrl != null) sanitizeUrl(metadata.sourceVideoUrl);

  const stats = validateStagedVideo(request.output, manifest, opts);
  return {
    output: path.resolve(result.output),
    metadata: {
      model: metadata.model == null ? null : metadata.model,
      params: metadata.params,
      ...(metadata.sourceVideoUrl != null ? { sourceVideoUrl: metadata.sourceVideoUrl } : {}),
    },
    stats,
  };
}

async function invokeGenerationProvider(manifest, request, opts = {}) {
  const worker = new JsonLineWorker(manifest);
  try {
    const hello = await worker.start();
    const response = await worker.exchange(
      request,
      opts.timeoutMs == null ? GENERATION_TIMEOUT_MS : opts.timeoutMs,
      'generation',
    );
    return { providerVersion: hello.providerVersion, response };
  } finally {
    await worker.close();
  }
}

async function generate(providerName, prompt, outputPath, _assetsDir, opts = {}) {
  const manifest = opts.providerManifest || getVideoProvider(providerName);
  if (!manifest || manifest.protocol !== VIDEO_PROVIDER_PROTOCOL || manifest.name !== providerName) {
    throw new Error(`video provider ${JSON.stringify(providerName)} is not registered; install its companion and run \`narova providers add <manifest>\``);
  }
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('generation prompt must be a non-empty string');
  const continuity = opts.continuity || null;
  if (continuity && (!continuity.snapshot || typeof continuity.text !== 'string')) {
    throw new Error('generation continuity must be resolved before provider invocation');
  }
  if (continuity && continuity.reference && manifest.capabilities.referenceImages !== true) {
    throw new Error(`video provider ${JSON.stringify(manifest.name)} does not support continuity image anchors (capabilities.referenceImages)`);
  }
  const effectivePrompt = continuity ? `${prompt.trim()}\n${continuity.text}` : prompt;
  const params = { ...(opts.params || {}) };
  const jsonError = jsonCompatibilityError(params, 'generation options');
  if (jsonError) throw new Error(jsonError);
  if (containsRequiredEnvironmentValue({
    prompt, effectivePrompt, options: params, artifact: path.basename(outputPath),
    continuity: continuity && continuity.snapshot,
  }, manifest)) {
    throw new Error('generation intent contains a required environment secret');
  }
  const missing = missingEnvironment(manifest);
  if (missing.length) {
    throw new Error(`${manifest.displayName} requires ${missing.join(', ')} in the Narova process environment`);
  }

  const specPath = specPathFor(outputPath);
  for (const [label, target] of [['generation output', outputPath], ['generation recipe', specPath]]) {
    if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) {
      throw new Error(`${label} is not a regular file: ${target}`);
    }
    const parent = path.dirname(target);
    if (fs.existsSync(parent) && !fs.statSync(parent).isDirectory()) {
      throw new Error(`${label} parent is not a directory: ${parent}`);
    }
  }
  let projectPaths = null;
  if (opts.projectDir) {
    const file = path.relative(opts.projectDir, outputPath);
    const insideProject = file && file !== '..' && !file.startsWith(`..${path.sep}`) && !path.isAbsolute(file);
    if (insideProject) {
      readAssetLock(opts.projectDir);
      const artifact = resolveProjectFile(opts.projectDir, file, { mustExist: false });
      const recipe = resolveProjectFile(opts.projectDir, path.relative(opts.projectDir, specPath), { mustExist: false });
      projectPaths = { artifact, recipe };
    }
  }

  console.log(`Generating video with ${manifest.displayName}...`);
  console.log(`Prompt: "${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}"`);
  if (continuity) {
    console.log(`Continuity: ${continuity.snapshot.shot}${continuity.reference ? ` (anchor ${continuity.snapshot.anchor.file})` : ''}`);
  }

  const destDir = path.dirname(outputPath);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const token = `${process.pid}-${Date.now()}-${require('crypto').randomBytes(4).toString('hex')}`;
  const outputExt = path.extname(outputPath);
  const outputStem = path.basename(outputPath, outputExt);
  const stagingDir = fs.mkdtempSync(path.join(path.resolve(destDir), '.narova-generate-'));
  fs.chmodSync(stagingDir, 0o700);
  const stagedOutput = path.join(stagingDir, `${outputStem}${outputExt}`);
  const stagedSpec = path.join(stagingDir, path.basename(specPath));
  const outputBackup = path.join(destDir, `.${outputStem}.previous-${token}${outputExt}`);
  const specBackup = path.join(path.dirname(specPath), `.${path.basename(specPath)}.previous-${token}`);
  let outputBackedUp = false;
  let specBackedUp = false;
  let outputPublished = false;
  let specPublished = false;
  let committed = false;
  const rollback = error => {
    if (committed) return;
    let rollbackError = null;
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      if (specPublished) fs.rmSync(specPath, { force: true });
      if (specBackedUp && fs.existsSync(specBackup)) fs.renameSync(specBackup, specPath);
      if (outputPublished) fs.rmSync(outputPath, { force: true });
      if (outputBackedUp && fs.existsSync(outputBackup)) fs.renameSync(outputBackup, outputPath);
      specPublished = false;
      specBackedUp = false;
      outputPublished = false;
      outputBackedUp = false;
    } catch (failure) { rollbackError = failure; }
    if (rollbackError && error) error.message += `; generated asset rollback failed: ${rollbackError.message}`;
  };

  try {
    let stagedReference = null;
    if (continuity && continuity.reference) {
      const ext = path.extname(continuity.reference.path).toLowerCase();
      const stagedAnchor = path.join(stagingDir, `continuity-anchor${ext}`);
      fs.copyFileSync(continuity.reference.path, stagedAnchor, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(stagedAnchor, 0o400);
      const stats = fs.statSync(stagedAnchor);
      const digest = sha256File(stagedAnchor);
      if (stats.size !== continuity.reference.bytes || digest !== continuity.reference.sha256) {
        throw new Error(`continuity anchor changed while generation was being prepared: ${continuity.snapshot.anchor.file}`);
      }
      stagedReference = {
        kind: 'image', path: stagedAnchor, bytes: stats.size, sha256: digest,
      };
    }
    const request = {
      id: 'generation-1',
      operation: 'generate',
      prompt: effectivePrompt,
      output: path.resolve(stagedOutput),
      options: params,
      ...(continuity ? { continuity: {
        shot: continuity.snapshot.shot,
        entities: continuity.snapshot.entities,
        keep: continuity.snapshot.keep,
        change: continuity.snapshot.change,
      } } : {}),
      ...(stagedReference ? { reference: stagedReference } : {}),
    };
    if (containsRequiredEnvironmentValue(request, manifest)) {
      throw new Error('generation request contains a required environment secret');
    }
    const invoke = opts.invokeProvider || invokeGenerationProvider;
    const invoked = await invoke(manifest, request, { timeoutMs: opts.timeoutMs });
    const result = validateProviderResult(manifest, request, invoked.response || invoked, opts);
    const runtimeVersion = invoked.providerVersion || manifest.providerVersion;
    if (typeof runtimeVersion !== 'string' || !runtimeVersion.trim()) {
      throw new Error(`provider ${manifest.name} runtime version is missing`);
    }
    const spec = buildSpec(manifest, runtimeVersion, prompt, result.metadata, stagedOutput, result.stats.size, {
      artifactName: path.basename(outputPath),
      ...(continuity ? { effectivePrompt, continuity: continuity.snapshot } : {}),
    });
    if (containsRequiredEnvironmentValue(spec, manifest)) {
      throw new Error(`provider ${manifest.name} generation recipe contains a required environment secret`);
    }
    const publish = () => {
      try {
        if (projectPaths) {
          readAssetLock(opts.projectDir);
          projectPaths = {
            artifact: resolveProjectFile(opts.projectDir, projectPaths.artifact.relative, { mustExist: false }),
            recipe: resolveProjectFile(opts.projectDir, projectPaths.recipe.relative, { mustExist: false }),
          };
        }
        for (const [label, target] of [['generation output', outputPath], ['generation recipe', specPath]]) {
          if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) {
            throw new Error(`${label} is not a regular file: ${target}`);
          }
        }
        if (fs.existsSync(outputPath)) { fs.renameSync(outputPath, outputBackup); outputBackedUp = true; }
        fs.renameSync(stagedOutput, outputPath);
        outputPublished = true;
        console.log(`Saved: ${outputPath} (${(result.stats.size / 1024 / 1024).toFixed(1)} MB)`);

        fs.mkdirSync(path.dirname(specPath), { recursive: true });
        fs.writeFileSync(stagedSpec, JSON.stringify(spec, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        if (fs.existsSync(specPath)) { fs.renameSync(specPath, specBackup); specBackedUp = true; }
        fs.renameSync(stagedSpec, specPath);
        specPublished = true;
        console.log(`Spec:   ${specPath}`);

        if (projectPaths) {
          (opts.registerAsset || registerAsset)(opts.projectDir, {
            file: projectPaths.artifact.relative,
            origin: {
              mode: 'generated',
              provider: manifest.name,
              model: result.metadata.model,
              ...(result.metadata.sourceVideoUrl ? { sourceUrl: result.metadata.sourceVideoUrl } : {}),
            },
            recipe: projectPaths.recipe.relative,
            acquiredAt: spec.generatedAt,
          }, { lockHeld: true });
          console.log(`Asset:  ${path.join(opts.projectDir, 'assets.lock.json')}`);
        } else if (opts.projectDir) {
          console.log('note: generated clip is outside the project and was not added to assets.lock.json');
        }
        committed = true;
        fs.rmSync(stagingDir, { recursive: true, force: true });
        for (const backup of [outputBackup, specBackup]) {
          try { fs.rmSync(backup, { force: true }); } catch { /* committed files win */ }
        }
      } catch (error) {
        rollback(error);
        throw error;
      }
    };
    if (projectPaths) withAssetMutation(opts.projectDir, publish);
    else publish();
  } catch (error) {
    rollback(error);
    throw error;
  }

  return outputPath;
}

function buildSpec(manifest, providerVersion, prompt, metadata, outputPath, artifactBytes, opts = {}) {
  const sourceVideoUrl = metadata.sourceVideoUrl;
  const continuity = opts.continuity || null;
  return {
    kind: 'narova-generate-spec',
    version: continuity ? 3 : 2,
    provider: manifest.name,
    providerName: manifest.displayName,
    providerProtocol: VIDEO_PROVIDER_PROTOCOL,
    providerVersion,
    model: metadata.model,
    prompt,
    ...(continuity ? { effectivePrompt: opts.effectivePrompt, continuity } : {}),
    params: metadata.params,
    ...(sourceVideoUrl ? {
      sourceVideoUrl: sanitizeUrl(sourceVideoUrl, { stripQuery: true }),
      sourceVideoUrlHash: sha256(sourceVideoUrl),
    } : {}),
    artifact: opts.artifactName || path.basename(outputPath),
    artifactBytes,
    artifactSha256: sha256File(outputPath),
    generatedAt: new Date().toISOString(),
  };
}

function specPathFor(artifactPath) {
  return String(artifactPath).replace(/\.(mp4|webm|mov)$/i, '') + '.gen.json';
}

function sha256File(file) {
  const h = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytes === 0) break;
      h.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function readSpec(artifactPath) {
  const specPath = specPathFor(artifactPath);
  if (!fs.existsSync(specPath)) return null;
  try { return JSON.parse(fs.readFileSync(specPath, 'utf8')); }
  catch { return null; }
}

module.exports = {
  generate, buildSpec, readSpec, specPathFor,
  invokeGenerationProvider, validateProviderResult, validateStagedVideo,
  HANDSHAKE_TIMEOUT_MS, GENERATION_TIMEOUT_MS, MEDIA_PROBE_TIMEOUT_MS,
  MAX_GENERATED_VIDEO_BYTES, MAX_WORKER_RESPONSE_BYTES, MAX_WORKER_STDERR_BYTES,
  MAX_WORKER_DIAGNOSTIC_DISPLAY_BYTES,
  _internals: { JsonLineWorker, providerResponseError, probeVideo, sha256File },
};
