'use strict';
/* Tests for generated-asset provenance: a generated clip persists its full
 * generative specification as a .gen.json sidecar so it survives as an
 * editable creative source, not just an opaque downloaded MP4. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { buildSpec, generate, readSpec, specPathFor, providerInfo, downloadFile, _internals } = require('../src/generate');
const { readAssetLock, registerAsset } = require('../src/asset-registry');

test('specPathFor maps an artifact to its sidecar path', () => {
  assert.equal(specPathFor('assets/gen-sora-foo.mp4'), 'assets/gen-sora-foo.gen.json');
  assert.equal(specPathFor('clips/take.webm'), 'clips/take.gen.json');
  assert.equal(specPathFor('a/b/c.MOV'), 'a/b/c.gen.json');
});

test('buildSpec captures provider, model, prompt, params, and the artifact hash', () => {
  const info = providerInfo('sora');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  const artifact = path.join(dir, 'gen-sora-x.mp4');
  fs.writeFileSync(artifact, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
  const params = { model: 'sora-2', size: '1280x720', duration: 5 };
  const spec = buildSpec('sora', info, 'a rainy city at night', params, 'https://x/v.mp4', artifact, 8);

  assert.equal(spec.kind, 'narova-generate-spec');
  assert.equal(spec.version, 1);
  assert.equal(spec.provider, 'sora');
  assert.equal(spec.providerName, 'OpenAI Sora');
  assert.equal(spec.model, 'sora-2');
  assert.equal(spec.prompt, 'a rainy city at night');
  assert.deepEqual(spec.params, params);
  assert.equal(spec.artifact, 'gen-sora-x.mp4');
  assert.equal(spec.artifactBytes, 8);
  assert.equal(spec.artifactSha256.length, 64);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readSpec round-trips a written sidecar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  const artifact = path.join(dir, 'clip.mp4');
  fs.writeFileSync(artifact, Buffer.from('hi'));
  const info = providerInfo('runway');
  const spec = buildSpec('runway', info, 'kite in storm', { model: 'gen4.5' }, 'https://r/v.mp4', artifact, 2);
  fs.writeFileSync(specPathFor(artifact), JSON.stringify(spec));
  const back = readSpec(artifact);
  assert.equal(back.prompt, 'kite in storm');
  assert.equal(back.provider, 'runway');
  assert.equal(back.model, 'gen4.5');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readSpec returns null when no sidecar exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  const artifact = path.join(dir, 'lonely.mp4');
  fs.writeFileSync(artifact, 'x');
  assert.equal(readSpec(artifact), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildSpec captures null model when params omit it (regeneration still works)', () => {
  const info = providerInfo('sora');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  const artifact = path.join(dir, 'g.mp4');
  fs.writeFileSync(artifact, 'x');
  const spec = buildSpec('sora', info, 'p', {}, 'https://x.example/video?token=secret#part', artifact, 1);
  assert.equal(spec.model, null);
  assert.deepEqual(spec.params, {});
  assert.equal(spec.sourceVideoUrl, 'https://x.example/video');
  assert.match(spec.sourceVideoUrlHash, /^[a-f0-9]{64}$/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generation restores the previous artifact and recipe when registration fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-transaction-'));
  const assets = path.join(dir, 'assets');
  const artifact = path.join(assets, 'clip.mp4');
  fs.mkdirSync(assets);
  fs.writeFileSync(artifact, 'old-video');
  fs.writeFileSync(specPathFor(artifact), 'old-spec');
  try {
    await assert.rejects(generate('sora', 'paper boat', 'test-key', artifact, assets, {
      projectDir: dir,
      generateSora: async () => ({ url: 'https://cdn.example/video?signature=secret', headers: {} }),
      downloadFile: async (_url, destination) => { fs.writeFileSync(destination, 'new-video'); },
      registerAsset: () => { throw new Error('lock unavailable'); },
    }), /lock unavailable/);
    assert.equal(fs.readFileSync(artifact, 'utf8'), 'old-video');
    assert.equal(fs.readFileSync(specPathFor(artifact), 'utf8'), 'old-spec');
    assert.deepEqual(fs.readdirSync(assets).sort(), ['clip.gen.json', 'clip.mp4']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generation rejects an escaping output parent before provider work', async () => {
  if (process.platform === 'win32') return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-boundary-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-outside-'));
  fs.symlinkSync(outside, path.join(dir, 'assets'));
  let providerCalls = 0;
  try {
    await assert.rejects(generate('sora', 'paper boat', 'test-key', path.join(dir, 'assets', 'clip.mp4'), path.join(dir, 'assets'), {
      projectDir: dir,
      generateSora: async () => { providerCalls++; return { url: 'https://cdn.example/video', headers: {} }; },
    }), /resolves outside the project/);
    assert.equal(providerCalls, 0);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('generation rejects a directory target before provider work', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-directory-'));
  const target = path.join(dir, 'assets', 'clip.mp4');
  fs.mkdirSync(target, { recursive: true });
  let providerCalls = 0;
  try {
    await assert.rejects(generate('sora', 'paper boat', 'test-key', target, path.dirname(target), {
      projectDir: dir,
      generateSora: async () => { providerCalls++; return { url: 'https://cdn.example/video', headers: {} }; },
    }), /not a regular file/);
    assert.equal(providerCalls, 0);
    assert.ok(fs.statSync(target).isDirectory());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('automatic generation refresh preserves omitted rights metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-rights-'));
  const assets = path.join(dir, 'assets');
  const artifact = path.join(assets, 'clip.mp4');
  fs.mkdirSync(assets);
  fs.writeFileSync(artifact, 'old');
  registerAsset(dir, {
    file: 'assets/clip.mp4',
    rights: { license: 'CC-BY-4.0', creator: 'Example Artist', attribution: 'Example Artist' },
  });
  try {
    await generate('sora', 'paper boat', 'test-key', artifact, assets, {
      projectDir: dir,
      generateSora: async () => ({ url: 'https://cdn.example/video?signature=secret', headers: {} }),
      downloadFile: async (_url, destination) => { fs.writeFileSync(destination, 'new'); },
    });
    const record = readAssetLock(dir).assets[0];
    assert.equal(record.origin.mode, 'generated');
    assert.equal(record.rights.license, 'CC-BY-4.0');
    assert.equal(record.rights.creator, 'Example Artist');
    assert.equal(record.rights.attribution, 'Example Artist');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provider metadata matches current OpenAI and Runway API contracts', () => {
  assert.equal(providerInfo('sora').api, 'https://api.openai.com/v1/videos');
  assert.equal(providerInfo('runway').api, 'https://api.dev.runwayml.com/v1/text_to_video');
  assert.equal(providerInfo('runway').envKey, 'RUNWAYML_API_SECRET');
});

test('multipart video creation sends string seconds fields', async () => {
  let request = null;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      request = { headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'video_1' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const result = await _internals.postMultipartFields(`http://127.0.0.1:${port}/videos`, {
      model: 'sora-2', prompt: 'test', size: '1280x720', seconds: '4',
    });
    assert.equal(result.status, 201);
    assert.match(request.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.match(request.body, /name="seconds"\r\n\r\n4\r\n/);
    assert.doesNotMatch(request.body, /name="duration"/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('video downloader follows relative redirects and publishes atomically', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-download-'));
  const dest = path.join(dir, 'clip.mp4');
  fs.writeFileSync(dest, 'old');
  const server = http.createServer((req, res) => {
    if (req.url === '/start') { res.writeHead(302, { location: '/video' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '8' });
    res.end('newvideo');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await downloadFile(`http://127.0.0.1:${server.address().port}/start`, dest);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'newvideo');
    assert.deepEqual(fs.readdirSync(dir), ['clip.mp4']);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('failed video download preserves the previous artifact and removes partials', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-download-fail-'));
  const dest = path.join(dir, 'clip.mp4');
  fs.writeFileSync(dest, 'previous');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<h1>error</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(downloadFile(`http://127.0.0.1:${server.address().port}/bad`, dest), /content-type/);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'previous');
    assert.deepEqual(fs.readdirSync(dir), ['clip.mp4']);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
