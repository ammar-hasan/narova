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

async function generateSora(prompt, apiKey) {
  const submit = await postJson(
    'https://api.openai.com/v1/videos',
    { model: 'sora-2', prompt, size: '1280x720', duration: 5 },
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

async function generateRunway(prompt, apiKey) {
  const res = await postJson(
    'https://api.runwayml.com/v1/generations',
    { model: 'gen4.5', prompt },
    { Authorization: `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' },
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Runway API error: ${JSON.stringify(res.body)}`);
  }
  const videoUrl = res.body.video_url || res.body.output?.video_url;
  if (!videoUrl) throw new Error('Runway result missing video URL');
  return videoUrl;
}

async function generate(provider, prompt, apiKey, outputPath, assetsDir) {
  const info = PROVIDERS[provider];
  if (!info) throw new Error(`Unknown provider: ${provider} (valid: ${Object.keys(PROVIDERS).join(', ')})`);

  console.log(`Generating video with ${info.name}...`);
  console.log(`Prompt: "${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}"`);

  let videoUrl;
  if (provider === 'sora') videoUrl = await generateSora(prompt, apiKey);
  else if (provider === 'runway') videoUrl = await generateRunway(prompt, apiKey);
  else throw new Error(`Provider ${provider} not yet implemented`);

  console.log(`Downloading video...`);
  const destDir = path.dirname(outputPath);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  await downloadFile(videoUrl, outputPath);
  const stats = fs.statSync(outputPath);
  console.log(`Saved: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  return outputPath;
}

module.exports = { PROVIDERS, providerInfo, generate };
