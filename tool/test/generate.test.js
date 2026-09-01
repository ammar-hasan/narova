'use strict';
/* External-video-provider and generated-asset transaction tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildSpec, generate, readSpec, specPathFor, invokeGenerationProvider,
  validateProviderResult,
} = require('../src/generate');
const { readAssetLock, registerAsset } = require('../src/asset-registry');
const { loadContinuityShot } = require('../src/continuity');

const VIDEO_FIXTURE = path.join(__dirname, 'fixtures', 'fake-video-provider-worker.py');

function manifest(name = 'sora', mode = 'ok', requiredEnvironment = []) {
  return {
    name,
    displayName: name === 'sora' ? 'OpenAI Sora' : name,
    protocol: 'narova-video-provider/v1',
    command: [process.env.PYTHON || 'python3', VIDEO_FIXTURE, mode, name],
    requiredEnvironment,
    capabilities: { generation: true },
    providerVersion: 'registered-1.0.0',
  };
}

function successfulInvoke(overrides = {}) {
  return async (_manifest, request) => {
    fs.writeFileSync(request.output, overrides.bytes || 'new-video');
    return {
      providerVersion: overrides.providerVersion || 'runtime-2.0.0',
      id: overrides.id || request.id,
      ok: overrides.ok == null ? true : overrides.ok,
      output: overrides.output || request.output,
      metadata: overrides.metadata || {
        model: 'sora-2',
        params: { model: 'sora-2', size: '1280x720', duration: 4 },
        sourceVideoUrl: 'https://cdn.example/video.mp4?signature=secret',
      },
      ...(overrides.error ? { error: overrides.error } : {}),
    };
  };
}

const acceptFakeVideo = () => {};

test('specPathFor maps an artifact to its sidecar path', () => {
  assert.equal(specPathFor('assets/gen-sora-foo.mp4'), 'assets/gen-sora-foo.gen.json');
  assert.equal(specPathFor('clips/take.webm'), 'clips/take.gen.json');
  assert.equal(specPathFor('a/b/c.MOV'), 'a/b/c.gen.json');
});

test('recipe v2 captures runtime provider identity, intent, source hash, and artifact hash', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  try {
    const artifact = path.join(dir, 'gen-sora-x.mp4');
    fs.writeFileSync(artifact, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]));
    const metadata = {
      model: 'sora-2',
      params: { model: 'sora-2', size: '1280x720', duration: 4 },
      sourceVideoUrl: 'https://x.example/v.mp4?token=secret#part',
    };
    const spec = buildSpec(manifest(), 'runtime-2.0.0', 'a rainy city at night', metadata, artifact, 8);
    assert.equal(spec.kind, 'narova-generate-spec');
    assert.equal(spec.version, 2);
    assert.equal(spec.provider, 'sora');
    assert.equal(spec.providerName, 'OpenAI Sora');
    assert.equal(spec.providerProtocol, 'narova-video-provider/v1');
    assert.equal(spec.providerVersion, 'runtime-2.0.0');
    assert.equal(spec.model, 'sora-2');
    assert.equal(spec.sourceVideoUrl, 'https://x.example/v.mp4');
    assert.match(spec.sourceVideoUrlHash, /^[a-f0-9]{64}$/);
    assert.equal(spec.artifactSha256.length, 64);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readSpec retains historical version-1 recipes as regeneration input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-'));
  try {
    const artifact = path.join(dir, 'clip.mp4');
    fs.writeFileSync(artifact, 'old');
    fs.writeFileSync(specPathFor(artifact), JSON.stringify({
      kind: 'narova-generate-spec', version: 1, provider: 'runway',
      prompt: 'kite in storm', params: { model: 'gen4.5' }, artifact: 'clip.mp4',
    }));
    assert.equal(readSpec(artifact).version, 1);
    assert.equal(readSpec(artifact).provider, 'runway');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registered video worker handshakes, generates once, and publishes recipe v2', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-video-worker-'));
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets);
  const artifact = path.join(assets, 'clip.mp4');
  try {
    await generate('sora', 'paper boat', artifact, assets, {
      projectDir: dir,
      providerManifest: manifest(),
      params: { size: '1280x720', duration: 4 },
      probeVideo: acceptFakeVideo,
    });
    assert.equal(fs.readFileSync(artifact, 'utf8'), 'fake-video-bytes');
    const spec = readSpec(artifact);
    assert.equal(spec.version, 2);
    assert.equal(spec.providerVersion, '1.2.3');
    assert.equal(spec.model, 'fake-video-1');
    assert.equal(readAssetLock(dir).assets[0].origin.provider, 'sora');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('text-only continuity reaches the worker and publishes an inspectable recipe v3', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-continuity-text-'));
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets);
  const artifact = path.join(assets, 'clip.mp4');
  const raw = {
    entities: {
      hero: { kind: 'character', description: 'A copper robot with a teal scarf.' },
      seed: { kind: 'object', description: 'A square red seed case.' },
    },
    shots: {
      reveal: { entities: ['hero', 'seed'], keep: ['Keep both identities.'], change: ['Open the case.'] },
    },
  };
  let sent;
  try {
    const continuity = loadContinuityShot(dir, raw, 'reveal');
    await generate('fake-video', 'The robot enters the greenhouse.', artifact, assets, {
      projectDir: dir,
      providerManifest: manifest('fake-video'),
      continuity,
      invokeProvider: async (_manifest, request) => {
        sent = request;
        return successfulInvoke()(_manifest, request);
      },
      probeVideo: acceptFakeVideo,
    });
    assert.equal(sent.continuity.shot, 'reveal');
    assert.equal(sent.reference, undefined);
    assert.match(sent.prompt, /copper robot with a teal scarf/);
    const spec = readSpec(artifact);
    assert.equal(spec.version, 3);
    assert.equal(spec.prompt, 'The robot enters the greenhouse.');
    assert.equal(spec.effectivePrompt, sent.prompt);
    assert.equal(spec.continuity.shot, 'reveal');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('image continuity is capability-gated before worker work and binds the exact anchor', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-continuity-anchor-'));
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets);
  const artifact = path.join(assets, 'clip.mp4');
  fs.writeFileSync(path.join(assets, 'anchor.png'), 'anchor-image');
  const raw = {
    entities: { hero: { kind: 'character', description: 'A copper robot.' } },
    shots: { next: { entities: ['hero'], anchor: 'assets/anchor.png' } },
  };
  const continuity = loadContinuityShot(dir, raw, 'next');
  let calls = 0;
  try {
    await assert.rejects(generate('fake-video', 'The next shot.', artifact, assets, {
      projectDir: dir,
      providerManifest: manifest('fake-video'),
      continuity,
      invokeProvider: async () => { calls++; },
    }), /capabilities\.referenceImages/);
    assert.equal(calls, 0);
    assert.deepEqual(fs.readdirSync(assets).sort(), ['anchor.png']);

    const capable = manifest('fake-video');
    capable.capabilities.referenceImages = true;
    let sent;
    await generate('fake-video', 'The next shot.', artifact, assets, {
      projectDir: dir,
      providerManifest: capable,
      continuity,
      invokeProvider: async (_manifest, request) => {
        calls++;
        assert.notEqual(request.reference.path, path.join(assets, 'anchor.png'));
        assert.equal(fs.statSync(request.reference.path).mode & 0o777, 0o400);
        sent = { ...request, reference: { ...request.reference } };
        return successfulInvoke()(_manifest, request);
      },
      probeVideo: acceptFakeVideo,
    });
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(sent.reference.path), false);
    assert.equal(sent.reference.bytes, 12);
    assert.match(sent.reference.sha256, /^[a-f0-9]{64}$/);
    const spec = readSpec(artifact);
    assert.equal(spec.version, 3);
    assert.deepEqual(spec.continuity.anchor, {
      file: 'assets/anchor.png', bytes: sent.reference.bytes, sha256: sent.reference.sha256,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generation restores previous artifact and recipe when registry publication fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-transaction-'));
  const assets = path.join(dir, 'assets');
  const artifact = path.join(assets, 'clip.mp4');
  fs.mkdirSync(assets);
  fs.writeFileSync(artifact, 'old-video');
  fs.writeFileSync(specPathFor(artifact), 'old-spec');
  try {
    await assert.rejects(generate('sora', 'paper boat', artifact, assets, {
      projectDir: dir,
      providerManifest: manifest(),
      invokeProvider: successfulInvoke(),
      probeVideo: acceptFakeVideo,
      registerAsset: () => { throw new Error('lock unavailable'); },
    }), /lock unavailable/);
    assert.equal(fs.readFileSync(artifact, 'utf8'), 'old-video');
    assert.equal(fs.readFileSync(specPathFor(artifact), 'utf8'), 'old-spec');
    assert.deepEqual(fs.readdirSync(assets).sort(), ['clip.gen.json', 'clip.mp4']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generation rejects escaping or directory outputs before provider work', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-boundary-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-outside-'));
  let providerCalls = 0;
  try {
    if (process.platform !== 'win32') {
      fs.symlinkSync(outside, path.join(dir, 'assets'));
      await assert.rejects(generate('sora', 'paper boat', path.join(dir, 'assets', 'clip.mp4'), path.join(dir, 'assets'), {
        projectDir: dir,
        providerManifest: manifest(),
        invokeProvider: async () => { providerCalls++; },
      }), /resolves outside the project/);
      fs.unlinkSync(path.join(dir, 'assets'));
    }
    const target = path.join(dir, 'assets', 'clip.mp4');
    fs.mkdirSync(target, { recursive: true });
    await assert.rejects(generate('sora', 'paper boat', target, path.dirname(target), {
      projectDir: dir,
      providerManifest: manifest(),
      invokeProvider: async () => { providerCalls++; },
    }), /not a regular file/);
    assert.equal(providerCalls, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('worker result identity, output, metadata, and file are validated before publication', async () => {
  for (const [mode, pattern] of [
    ['wrong-id', /response id mismatch/],
    ['wrong-path', /unexpected output path/],
    ['alias-path', /unexpected output path/],
    ['empty', /empty output file/],
    ['missing', /did not produce a regular output/],
    ['generation-failure', /safe provider failure/],
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `narova-gen-${mode}-`));
    const assets = path.join(dir, 'assets');
    fs.mkdirSync(assets);
    try {
      await assert.rejects(generate('fake-video', 'paper boat', path.join(assets, 'clip.mp4'), assets, {
        projectDir: dir,
        providerManifest: manifest('fake-video', mode),
        timeoutMs: 2000,
      }), pattern);
      assert.deepEqual(fs.readdirSync(assets), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('missing environment and secret-bearing options fail before worker invocation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-secret-'));
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets);
  const previous = process.env.FAKE_VIDEO_SECRET;
  let calls = 0;
  try {
    delete process.env.FAKE_VIDEO_SECRET;
    await assert.rejects(generate('fake-video', 'paper boat', path.join(assets, 'clip.mp4'), assets, {
      projectDir: dir,
      providerManifest: manifest('fake-video', 'ok', ['FAKE_VIDEO_SECRET']),
      invokeProvider: async () => { calls++; },
    }), /requires FAKE_VIDEO_SECRET/);
    process.env.FAKE_VIDEO_SECRET = 'never-persist-this';
    await assert.rejects(generate('fake-video', 'paper boat', path.join(assets, 'clip.mp4'), assets, {
      projectDir: dir,
      providerManifest: manifest('fake-video', 'ok', ['FAKE_VIDEO_SECRET']),
      params: { note: 'prefix-never-persist-this-suffix' },
      invokeProvider: async () => { calls++; },
    }), /intent contains a required environment secret/);
    await assert.rejects(generate('fake-video', 'prefix-never-persist-this-suffix', path.join(assets, 'clip.mp4'), assets, {
      projectDir: dir,
      providerManifest: manifest('fake-video', 'ok', ['FAKE_VIDEO_SECRET']),
      invokeProvider: async () => { calls++; },
    }), /intent contains a required environment secret/);
    assert.equal(calls, 0);
  } finally {
    if (previous == null) delete process.env.FAKE_VIDEO_SECRET;
    else process.env.FAKE_VIDEO_SECRET = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normalized metadata and the final recipe cannot retain registered secret substrings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-secret-result-'));
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets);
  const previous = process.env.FAKE_VIDEO_SECRET;
  process.env.FAKE_VIDEO_SECRET = 'never-persist-this';
  try {
    await assert.rejects(generate('fake-video', 'paper boat', path.join(assets, 'clip.mp4'), assets, {
      projectDir: dir,
      providerManifest: manifest('fake-video', 'ok', ['FAKE_VIDEO_SECRET']),
      invokeProvider: successfulInvoke({ metadata: {
        model: 'fake-video-1',
        params: { model: 'fake-video-1', note: 'Bearer never-persist-this' },
      } }),
      probeVideo: acceptFakeVideo,
    }), /metadata contains a required environment secret/);
    await assert.rejects(generate('fake-video', 'paper boat', path.join(assets, 'clip.mp4'), assets, {
      projectDir: dir,
      providerManifest: manifest('fake-video', 'ok', ['FAKE_VIDEO_SECRET']),
      invokeProvider: successfulInvoke({ providerVersion: 'runtime-never-persist-this' }),
      probeVideo: acceptFakeVideo,
    }), /recipe contains a required environment secret/);
    assert.deepEqual(fs.readdirSync(assets), []);
  } finally {
    if (previous == null) delete process.env.FAKE_VIDEO_SECRET;
    else process.env.FAKE_VIDEO_SECRET = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('staged video validation rejects error documents and oversized files before publication', async () => {
  for (const [bytes, options, pattern] of [
    ['<!doctype html><title>upstream error</title>', {}, /error document instead of video/],
    ['12345', { maxVideoBytes: 4 }, /exceeds the 4-byte generated-video limit/],
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-invalid-media-'));
    const assets = path.join(dir, 'assets');
    fs.mkdirSync(assets);
    let probed = false;
    try {
      await assert.rejects(generate('fake-video', 'paper boat', path.join(assets, 'clip.mp4'), assets, {
        projectDir: dir,
        providerManifest: manifest('fake-video'),
        invokeProvider: successfulInvoke({ bytes }),
        probeVideo: () => { probed = true; },
        ...options,
      }), pattern);
      assert.equal(probed, false);
      assert.deepEqual(fs.readdirSync(assets), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('generation uses an exact private stage path and publishes its streaming digest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-private-stage-'));
  const assets = path.join(dir, 'assets');
  fs.mkdirSync(assets);
  const artifact = path.join(assets, 'clip.mp4');
  let stagePath;
  try {
    await generate('fake-video', 'paper boat', artifact, assets, {
      projectDir: dir,
      providerManifest: manifest('fake-video'),
      invokeProvider: async (_manifest, request) => {
        stagePath = request.output;
        assert.equal(fs.statSync(path.dirname(stagePath)).mode & 0o777, 0o700);
        fs.writeFileSync(stagePath, 'private-video');
        return {
          providerVersion: 'runtime-2.0.0', id: request.id, ok: true,
          output: request.output,
          metadata: { model: 'fake-video-1', params: { model: 'fake-video-1' } },
        };
      },
      probeVideo: file => assert.equal(file, stagePath),
    });
    assert.equal(fs.existsSync(path.dirname(stagePath)), false);
    const expected = require('node:crypto').createHash('sha256').update('private-video').digest('hex');
    assert.equal(readSpec(artifact).artifactSha256, expected);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('worker protocol caps unterminated stdout responses and stderr diagnostics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-worker-bounds-'));
  try {
    const request = {
      id: 'generation-1', operation: 'generate', prompt: 'test',
      output: path.join(dir, 'clip.mp4'), options: {},
    };
    await assert.rejects(
      invokeGenerationProvider(manifest('fake-video', 'stdout-overflow'), request, { timeoutMs: 2000 }),
      /response limit/,
    );
    await assert.rejects(
      invokeGenerationProvider(manifest('fake-video', 'stderr-overflow'), request, { timeoutMs: 2000 }),
      /diagnostic limit/,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('provider result requires the exact worker stage path string', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-exact-path-'));
  const output = path.join(dir, 'clip.mp4');
  fs.writeFileSync(output, 'video');
  try {
    assert.throws(() => validateProviderResult(manifest('fake-video'), {
      id: 'generation-1', output,
    }, {
      id: 'generation-1', ok: true,
      output: `${dir}${path.sep}unused${path.sep}..${path.sep}clip.mp4`,
      metadata: { model: null, params: {} },
    }, { probeVideo: acceptFakeVideo }), /unexpected output path/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('core media validation accepts a locally decodable video stream', t => {
  if (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status !== 0
      || spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status !== 0) {
    t.skip('ffmpeg/ffprobe unavailable');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-real-probe-'));
  const output = path.join(dir, 'clip.mp4');
  try {
    const made = spawnSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'color=c=blue:s=16x16:d=0.2:r=5',
      '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output,
    ], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const result = validateProviderResult(manifest('fake-video'), {
      id: 'generation-1', output,
    }, {
      id: 'generation-1', ok: true, output,
      metadata: { model: 'fake-video-1', params: { model: 'fake-video-1' } },
    });
    assert.ok(result.stats.size > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generated refresh preserves omitted rights metadata', async () => {
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
    await generate('sora', 'paper boat', artifact, assets, {
      projectDir: dir,
      providerManifest: manifest(),
      invokeProvider: successfulInvoke(),
      probeVideo: acceptFakeVideo,
    });
    const record = readAssetLock(dir).assets[0];
    assert.equal(record.rights.license, 'CC-BY-4.0');
    assert.equal(record.rights.creator, 'Example Artist');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('core generation runtime contains no Sora or Runway service adapter', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'generate.js'), 'utf8');
  assert.doesNotMatch(source, /api\.openai\.com|runwayml\.com|OPENAI_API_KEY|RUNWAYML_API_SECRET|sora-2|gen4\.5/);
});

test('direct worker invocation returns runtime identity and validated response', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gen-direct-'));
  try {
    const request = {
      id: 'generation-1', operation: 'generate', prompt: 'test',
      output: path.join(dir, 'clip.mp4'), options: {},
    };
    const result = await invokeGenerationProvider(manifest('fake-video'), request, { timeoutMs: 2000 });
    assert.equal(result.providerVersion, '1.2.3');
    assert.equal(result.response.id, 'generation-1');
    assert.equal(fs.readFileSync(request.output, 'utf8'), 'fake-video-bytes');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
