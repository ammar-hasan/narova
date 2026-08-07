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
    api: 'https://api.runwayml.com/v1/generations',
    envKey: 'RUNWAY_API_KEY',
    description: 'Runway Gen-4.5 — text/image-to-video generation (requires RUNWAY_API_KEY)',
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

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    mod.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`download failed: ${res.statusCode}`));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(dest); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

/* Poll until the generation is complete (Sora pattern — submit, then poll). */
async function pollSora(jobId, apiKey, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await new Promise((resolve, reject) => {
      const u = new URL(`https://api.openai.com/v1/videos/${jobId}`);
      const req = https.request({
        hostname: u.hostname, path: u.pathname,
        headers: { Authorization: `Bearer ${apiKey}` },
      }, res => {
        let chunks = '';
        res.on('data', d => chunks += d);
        res.on('end', () => { try { resolve(JSON.parse(chunks)); } catch { resolve(chunks); } });
      });
      req.on('error', reject);
      req.end();
    });
    if (res.status === 'completed' || res.status === 'succeeded') return res;
    if (res.status === 'failed') throw new Error(`Sora generation failed: ${JSON.stringify(res)}`);
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Sora generation timed out');
}

async function generateSora(prompt, apiKey, params = {}) {
  const submit = await postJson(
    'https://api.openai.com/v1/videos',
    { model: params.model || 'sora-2', prompt, size: params.size || '1280x720', duration: params.duration || 5 },
    { Authorization: `Bearer ${apiKey}` },
  );
  if (submit.status !== 200 && submit.status !== 201) {
    throw new Error(`Sora API error: ${JSON.stringify(submit.body)}`);
  }
  const jobId = submit.body.id;
  const result = await pollSora(jobId, apiKey);
  const videoUrl = result.video_url || (result.output && result.output.video_url);
  if (!videoUrl) throw new Error('Sora result missing video URL');
  return videoUrl;
}

async function generateRunway(prompt, apiKey, params = {}) {
  const res = await postJson(
    'https://api.runwayml.com/v1/generations',
    { model: params.model || 'gen4.5', prompt },
    { Authorization: `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' },
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Runway API error: ${JSON.stringify(res.body)}`);
  }
  const videoUrl = res.body.video_url || res.body.output?.video_url;
  if (!videoUrl) throw new Error('Runway result missing video URL');
  return videoUrl;
}

async function generate(provider, prompt, apiKey, outputPath, assetsDir, opts = {}) {
  const info = PROVIDERS[provider];
  if (!info) throw new Error(`Unknown provider: ${provider} (valid: ${Object.keys(PROVIDERS).join(', ')})`);

  console.log(`Generating video with ${info.name}...`);
  console.log(`Prompt: "${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}"`);

  let videoUrl;
  const params = { ...(opts.params || {}) };
  if (provider === 'sora') {
    // Capture the exact generation parameters so the shot can be regenerated
    // or revised ("make it rainy", "same composition, different seed").
    params.model = params.model || 'sora-2';
    params.size = params.size || '1280x720';
    params.duration = params.duration || 5;
    videoUrl = await generateSora(prompt, apiKey, params);
  } else if (provider === 'runway') {
    params.model = params.model || 'gen4.5';
    videoUrl = await generateRunway(prompt, apiKey, params);
  } else throw new Error(`Provider ${provider} not yet implemented`);

  console.log(`Downloading video...`);
  const destDir = path.dirname(outputPath);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  await downloadFile(videoUrl, outputPath);
  const stats = fs.statSync(outputPath);
  console.log(`Saved: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  // Persist the generative specification as a sidecar so an AI clip remains a
  // living, editable creative source — not just a downloaded artifact. The
  // MP4 is cache/output; this spec is the creative source that survives. An
  // author can later say "regenerate this with the same composition but a
  // different mood" and the provider/model/prompt/params are all recoverable.
  const spec = buildSpec(provider, info, prompt, params, videoUrl, outputPath, stats.size);
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

module.exports = { PROVIDERS, providerInfo, generate, buildSpec, readSpec, specPathFor };
