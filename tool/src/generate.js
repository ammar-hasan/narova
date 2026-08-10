'use strict';
/* AI video clip generation for narova.
 *
 * Generates video clips via external AI providers (Sora, Runway) and saves
 * them to the project's assets directory for use as scene.clip sources.
 * Generated clips are first-class assets that can be reused across scenes. */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const PROVIDERS = {
  sora: {
    name: 'OpenAI Sora',
    api: 'https://api.openai.com/v1/videos',
    envKey: 'OPENAI_API_KEY',
    description: 'OpenAI Sora — text-to-video generation (requires OPENAI_API_KEY)',
  },
  runway: {
    name: 'Runway',
    api: 'https://api.dev.runwayml.com/v1/text_to_video',
    envKey: 'RUNWAYML_API_SECRET',
    description: 'Runway Gen-4.5 — text-to-video generation (requires RUNWAYML_API_SECRET)',
  },
};

function providerInfo(name) {
  return PROVIDERS[name] || null;
}

/* Simple HTTP POST helper (zero-dependency, no external client needed for MVP). */
function postJson(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const body = JSON.stringify(data);
    const opts = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    };
    const req = mod.request(opts, res => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function postMultipartFields(url, fields, headers = {}) {
  const boundary = `narova-${require('crypto').randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    if (value == null) continue;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  return requestBuffer('POST', url, body, {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': body.length,
    ...headers,
  }).then(res => {
    let parsed;
    try { parsed = JSON.parse(res.body.toString('utf8')); } catch { parsed = res.body.toString('utf8'); }
    return { status: res.status, body: parsed };
  });
}

function requestBuffer(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers,
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getJson(url, headers = {}) {
  const res = await requestBuffer('GET', url, null, headers);
  let body;
  try { body = JSON.parse(res.body.toString('utf8')); } catch { body = res.body.toString('utf8'); }
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function downloadFile(url, dest, opts = {}) {
  const maxBytes = opts.maxBytes || 1024 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects == null ? 5 : opts.maxRedirects;
  const headers = opts.headers || {};
  const temp = `${dest}.part-${process.pid}-${Date.now()}`;
  function cleanup(error, reject) {
    try { fs.rmSync(temp, { force: true }); } catch {}
    reject(error);
  }
  function fetch(current, redirects, resolve, reject, requestHeaders) {
    const u = new URL(current);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: requestHeaders }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= maxRedirects) return cleanup(new Error(`download exceeded ${maxRedirects} redirects`), reject);
        const next = new URL(res.headers.location, current);
        const nextHeaders = next.origin === u.origin
          ? requestHeaders
          : Object.fromEntries(Object.entries(requestHeaders).filter(([key]) => !/^(authorization|cookie)$/i.test(key)));
        return fetch(next.toString(), redirects + 1, resolve, reject, nextHeaders);
      }
      if (res.statusCode !== 200) { res.resume(); return cleanup(new Error(`download failed: ${res.statusCode}`), reject); }
      const contentType = String(res.headers['content-type'] || '').toLowerCase();
      if (contentType && !/^(video\/|application\/(?:octet-stream|mp4))/.test(contentType)) {
        res.resume(); return cleanup(new Error(`download returned unexpected content-type: ${contentType}`), reject);
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.resume(); return cleanup(new Error(`download exceeds ${maxBytes} byte limit`), reject);
      }
      let received = 0;
      const file = fs.createWriteStream(temp, { flags: 'wx' });
      res.on('data', chunk => {
        received += chunk.length;
        if (received > maxBytes) req.destroy(new Error(`download exceeds ${maxBytes} byte limit`));
      });
      res.pipe(file);
      file.on('finish', () => file.close(error => {
        if (error) return cleanup(error, reject);
        try { fs.renameSync(temp, dest); resolve(dest); } catch (renameError) { cleanup(renameError, reject); }
      }));
      file.on('error', error => cleanup(error, reject));
      res.on('error', error => cleanup(error, reject));
    });
    req.on('error', error => cleanup(error, reject));
    req.end();
  }
  return new Promise((resolve, reject) => fetch(url, 0, resolve, reject, headers));
}

/* Poll until the OpenAI video job reaches a terminal state. */
async function pollSora(jobId, apiKey, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await getJson(`https://api.openai.com/v1/videos/${encodeURIComponent(jobId)}`, { Authorization: `Bearer ${apiKey}` });
    if (res.status === 'completed') return res;
    if (res.status === 'failed') throw new Error(`Sora generation failed: ${JSON.stringify(res)}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Sora generation timed out');
}

async function generateSora(prompt, apiKey, params = {}) {
  const seconds = String(params.seconds || params.duration || 4);
  if (!['4', '8', '12'].includes(seconds)) throw new Error('Sora duration must be 4, 8, or 12 seconds');
  const submit = await postMultipartFields(
    'https://api.openai.com/v1/videos',
    { model: params.model || 'sora-2', prompt, size: params.size || '1280x720', seconds },
    { Authorization: `Bearer ${apiKey}` },
  );
  if (submit.status !== 200 && submit.status !== 201) {
    throw new Error(`Sora API error: ${JSON.stringify(submit.body)}`);
  }
  const jobId = submit.body.id;
  await pollSora(jobId, apiKey, params.timeoutMs);
  return {
    url: `https://api.openai.com/v1/videos/${encodeURIComponent(jobId)}/content`,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

async function pollRunway(taskId, apiKey, timeoutMs = 600000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await getJson(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(taskId)}`, {
      Authorization: `Bearer ${apiKey}`,
      'X-Runway-Version': '2024-11-06',
    });
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') throw new Error(`Runway generation ${task.status.toLowerCase()}: ${JSON.stringify(task)}`);
    await new Promise(r => setTimeout(r, 5000 + Math.floor(Math.random() * 500)));
  }
  throw new Error('Runway generation timed out');
}

async function generateRunway(prompt, apiKey, params = {}) {
  const res = await postJson(
    'https://api.dev.runwayml.com/v1/text_to_video',
    {
      model: params.model || 'gen4.5',
      promptText: prompt,
      ratio: params.ratio || String(params.size || '1280x720').replace('x', ':'),
      duration: params.duration || 5,
    },
    { Authorization: `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' },
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Runway API error: ${JSON.stringify(res.body)}`);
  }
  if (!res.body || !res.body.id) throw new Error('Runway result missing task id');
  const task = await pollRunway(res.body.id, apiKey, params.timeoutMs);
  if (!Array.isArray(task.output) || !task.output[0]) throw new Error('Runway result missing output URL');
  return { url: task.output[0], headers: {} };
}

async function generate(provider, prompt, apiKey, outputPath, assetsDir, opts = {}) {
  const info = PROVIDERS[provider];
  if (!info) throw new Error(`Unknown provider: ${provider} (valid: ${Object.keys(PROVIDERS).join(', ')})`);

  console.log(`Generating video with ${info.name}...`);
  console.log(`Prompt: "${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}"`);

  let download;
  const params = { ...(opts.params || {}) };
  if (provider === 'sora') {
    // Capture the exact generation parameters so the shot can be regenerated
    // or revised ("make it rainy", "same composition, different seed").
    params.model = params.model || 'sora-2';
    params.size = params.size || '1280x720';
    params.duration = params.duration || 4;
    download = await generateSora(prompt, apiKey, params);
  } else if (provider === 'runway') {
    params.model = params.model || 'gen4.5';
    params.ratio = params.ratio || String(params.size || '1280x720').replace('x', ':');
    params.duration = params.duration || 5;
    download = await generateRunway(prompt, apiKey, params);
  } else throw new Error(`Provider ${provider} not yet implemented`);

  console.log(`Downloading video...`);
  const destDir = path.dirname(outputPath);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  await downloadFile(download.url, outputPath, { headers: download.headers });
  const stats = fs.statSync(outputPath);
  console.log(`Saved: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  // Persist the generative specification as a sidecar so an AI clip remains a
  // living, editable creative source — not just a downloaded artifact. The
  // MP4 is cache/output; this spec is the creative source that survives. An
  // author can later say "regenerate this with the same composition but a
  // different mood" and the provider/model/prompt/params are all recoverable.
  const spec = buildSpec(provider, info, prompt, params, download.url, outputPath, stats.size);
  const specPath = specPathFor(outputPath);
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
  console.log(`Spec:   ${specPath}`);

  return outputPath;
}

/* Build the generative specification object for a generated clip. Pure so it
 * can be tested without network access. The artifact hash pins the bytes; the
 * prompt/model/params carry the creative intent that survives regeneration. */
function buildSpec(provider, info, prompt, params, sourceVideoUrl, outputPath, artifactBytes) {
  return {
    kind: 'narova-generate-spec',
    version: 1,
    provider,
    providerName: info.name,
    model: params.model || null,
    prompt,
    params,
    sourceVideoUrl,
    artifact: path.basename(outputPath),
    artifactBytes,
    artifactSha256: sha256File(outputPath),
    generatedAt: new Date().toISOString(),
  };
}

/* The sidecar path that accompanies a generated clip artifact. */
function specPathFor(artifactPath) {
  return String(artifactPath).replace(/\.(mp4|webm|mov)$/i, '') + '.gen.json';
}

function sha256File(file) {
  try {
    const { createHash } = require('crypto');
    const h = createHash('sha256');
    h.update(fs.readFileSync(file));
    return h.digest('hex');
  } catch { return null; }
}

/* Read a generative spec sidecar for a generated asset (or null if none). */
function readSpec(artifactPath) {
  const specPath = specPathFor(artifactPath);
  if (!fs.existsSync(specPath)) return null;
  try { return JSON.parse(fs.readFileSync(specPath, 'utf8')); }
  catch { return null; }
}

module.exports = {
  PROVIDERS, providerInfo, generate, buildSpec, readSpec, specPathFor,
  generateSora, generateRunway, pollSora, pollRunway, downloadFile,
  _internals: { postJson, postMultipartFields, requestBuffer, getJson },
};
