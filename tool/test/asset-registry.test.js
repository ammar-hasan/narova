'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {
  creditLines, downloadAsset, readAssetLock, registerAsset,
  resolveProjectFile, sha256File, unregisterAsset, verifyAssets, withAssetMutation,
} = require('../src/asset-registry');

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('registerAsset writes deterministic project-local provenance without signed URL queries', () => {
  const dir = tmp('narova-assets-');
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'hero.jpg'), 'image-bytes');
    const record = registerAsset(dir, {
      file: 'assets/hero.jpg',
      origin: {
        mode: 'stock', provider: 'example', itemId: '42',
        sourcePage: 'https://example.test/items/42',
        sourceUrl: 'https://cdn.example.test/hero.jpg?token=secret#fragment',
      },
      rights: {
        license: 'CC-BY-4.0', creator: 'Example Artist', attribution: 'Example Artist / Example',
      },
      acquiredAt: '2026-08-10T00:00:00.000Z',
    });
    assert.equal(record.file, 'assets/hero.jpg');
    assert.equal(record.kind, 'image');
    assert.equal(record.sha256, sha256File(path.join(dir, record.file)));
    assert.equal(record.origin.sourceUrl, 'https://cdn.example.test/hero.jpg');
    assert.match(record.origin.sourceUrlHash, /^[a-f0-9]{64}$/);
    assert.equal(record.rights.status, 'declared');

    const lock = readAssetLock(dir);
    assert.equal(lock.version, 1);
    assert.deepEqual(lock.assets.map(asset => asset.file), ['assets/hero.jpg']);

    // Re-registering the bytes updates mechanical fields without discarding
    // previously captured origin/rights metadata.
    fs.writeFileSync(path.join(dir, 'assets', 'hero.jpg'), 'new-image-bytes');
    registerAsset(dir, { file: 'assets/hero.jpg' });
    const updated = readAssetLock(dir).assets[0];
    assert.equal(updated.origin.provider, 'example');
    assert.equal(updated.rights.license, 'CC-BY-4.0');
    assert.equal(updated.sha256, sha256File(path.join(dir, updated.file)));

    registerAsset(dir, {
      file: 'assets/hero.jpg',
      origin: { mode: 'generated', provider: 'example-ai' },
      rights: {},
    });
    const replaced = readAssetLock(dir).assets[0];
    assert.equal(replaced.origin.mode, 'generated');
    assert.equal(replaced.origin.itemId, undefined);
    assert.equal(replaced.rights.status, 'unknown');
    assert.equal(replaced.rights.license, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('asset mutations are serialized and release control paths are reserved', () => {
  const dir = tmp('narova-assets-locking-');
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'a.jpg'), 'a');
    fs.writeFileSync(path.join(dir, 'manifest.json'), 'not a release manifest');
    assert.throws(() => registerAsset(dir, { file: 'manifest.json' }), /release control path/);
    assert.throws(() => registerAsset(dir, { file: 'manifest.json/clip.bin' }), /release control path/);
    assert.throws(() => resolveProjectFile(dir, '.assets.lock.json.lock/clip.bin', { mustExist: false }), /release control path/);
    withAssetMutation(dir, () => {
      assert.throws(
        () => registerAsset(dir, { file: 'assets/a.jpg' }),
        /being changed by another process/,
      );
      registerAsset(dir, { file: 'assets/a.jpg' }, { lockHeld: true });
    });
    assert.equal(readAssetLock(dir).assets.length, 1);
    assert.deepEqual(fs.readdirSync(path.join(dir, '.assets.lock.json.lock')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('asset mutation locking reclaims only a dead unique intent', () => {
  const dir = tmp('narova-assets-stale-intent-');
  try {
    const lockDir = path.join(dir, '.assets.lock.json.lock');
    fs.mkdirSync(lockDir);
    const stale = path.join(lockDir, 'intent-99999999-0123456789abcdef01234567.json');
    fs.writeFileSync(stale, JSON.stringify({ pid: 99_999_999, nonce: '0123456789abcdef01234567' }));
    withAssetMutation(dir, () => assert.equal(fs.existsSync(stale), false));
    assert.deepEqual(fs.readdirSync(lockDir), []);

    const unrelated = path.join(lockDir, 'keep-me.txt');
    fs.writeFileSync(unrelated, 'project data');
    assert.throws(() => withAssetMutation(dir, () => {}), /being changed by another process/);
    assert.equal(fs.readFileSync(unrelated, 'utf8'), 'project data');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('asset mutation locking rejects a symlinked control directory', t => {
  if (process.platform === 'win32') return t.skip('symlink permissions vary on Windows');
  const dir = tmp('narova-assets-lock-control-');
  const outside = tmp('narova-assets-lock-control-outside-');
  try {
    const stale = path.join(outside, 'intent-99999999-0123456789abcdef01234567.json');
    fs.writeFileSync(stale, JSON.stringify({ pid: 99_999_999 }));
    fs.symlinkSync(outside, path.join(dir, '.assets.lock.json.lock'));
    assert.throws(() => withAssetMutation(dir, () => {}), /project-local directory/);
    assert.equal(fs.existsSync(stale), true);
    assert.deepEqual(fs.readdirSync(outside), [path.basename(stale)]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('asset lock reads reject symlinks', t => {
  if (process.platform === 'win32') return t.skip('symlink permissions vary on Windows');
  const dir = tmp('narova-assets-lock-symlink-');
  const outside = tmp('narova-assets-lock-outside-');
  try {
    fs.writeFileSync(path.join(outside, 'lock.json'), JSON.stringify({ version: 1, assets: [] }));
    fs.symlinkSync(path.join(outside, 'lock.json'), path.join(dir, 'assets.lock.json'));
    assert.throws(() => readAssetLock(dir), /expected a regular file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('asset paths cannot escape the project lexically or through symlinks', () => {
  const dir = tmp('narova-assets-path-');
  const outside = tmp('narova-assets-outside-');
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(outside, 'secret.jpg'), 'secret');
    assert.throws(() => resolveProjectFile(dir, '../outside.jpg'), /escapes the project/);
    assert.throws(() => resolveProjectFile(dir, 'assets.lock.json', { mustExist: false }), /cannot register or replace itself/);
    if (process.platform !== 'win32') {
      fs.symlinkSync(outside, path.join(dir, 'assets', 'linked'));
      assert.throws(
        () => registerAsset(dir, { file: 'assets/linked/secret.jpg' }),
        /resolves outside the project/,
      );
      assert.throws(
        () => resolveProjectFile(dir, 'assets/linked/new.jpg', { mustExist: false }),
        /destination resolves outside the project/,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('verifyAssets detects tampering and missing files', () => {
  const dir = tmp('narova-assets-verify-');
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'bed.mp3'), 'audio');
    registerAsset(dir, { file: 'assets/bed.mp3' });
    assert.equal(verifyAssets(dir).ok, true);

    const recipe = path.join(dir, 'assets', 'bed.gen.json');
    fs.writeFileSync(recipe, '{}');
    registerAsset(dir, { file: 'assets/bed.mp3', recipe: 'assets/bed.gen.json' });
    fs.rmSync(recipe);
    let report = verifyAssets(dir);
    assert.equal(report.ok, false);
    assert.match(report.results[0].issues.join(' '), /recipe.*not found/);

    fs.writeFileSync(path.join(dir, 'assets', 'bed.mp3'), 'changed');
    report = verifyAssets(dir);
    assert.equal(report.ok, false);
    assert.match(report.results[0].issues.join(' '), /hash changed/);

    fs.rmSync(path.join(dir, 'assets', 'bed.mp3'));
    report = verifyAssets(dir);
    assert.equal(report.ok, false);
    assert.match(report.results[0].issues.join(' '), /not found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('asset lock validation requires complete records and uses locale-independent ordering', () => {
  const dir = tmp('narova-assets-schema-');
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'ä.jpg'), 'umlaut');
    fs.writeFileSync(path.join(dir, 'assets', 'z.jpg'), 'zed');
    registerAsset(dir, { file: 'assets/ä.jpg' });
    registerAsset(dir, { file: 'assets/z.jpg' });
    const lock = readAssetLock(dir);
    assert.deepEqual(lock.assets.map(asset => asset.file), ['assets/z.jpg', 'assets/ä.jpg']);

    const malformed = structuredClone(lock);
    delete malformed.assets[0].acquiredAt;
    fs.writeFileSync(path.join(dir, 'assets.lock.json'), JSON.stringify(malformed));
    assert.throws(() => readAssetLock(dir), /acquiredAt must be a valid timestamp/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('version 1 locks reject unknown fields at every schema level', () => {
  const dir = tmp('narova-assets-schema-fields-');
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', 'a.jpg'), 'a');
    registerAsset(dir, { file: 'assets/a.jpg' });
    const original = readAssetLock(dir);
    for (const mutate of [
      lock => { lock.future = true; },
      lock => { lock.assets[0].future = true; },
      lock => { lock.assets[0].origin.downloadUrl = 'https://signed.example/x?secret=1'; },
      lock => { lock.assets[0].rights.future = true; },
      lock => { lock.assets[0].media = { mime: 'image/jpeg', future: true }; },
    ]) {
      const malformed = structuredClone(original);
      mutate(malformed);
      fs.writeFileSync(path.join(dir, 'assets.lock.json'), JSON.stringify(malformed));
      assert.throws(() => readAssetLock(dir), /not supported by assets lock version 1/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('untrack remains possible after a tracked parent becomes an escaping symlink', () => {
  if (process.platform === 'win32') return;
  const dir = tmp('narova-assets-untrack-');
  const outside = tmp('narova-assets-untrack-outside-');
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.mkdirSync(path.join(dir, 'assets', 'stock'));
    fs.writeFileSync(path.join(dir, 'assets', 'stock', 'a.jpg'), 'a');
    registerAsset(dir, { file: 'assets/stock/a.jpg' });
    fs.rmSync(path.join(dir, 'assets', 'stock'), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, 'assets', 'stock'));
    assert.equal(unregisterAsset(dir, 'assets/stock/a.jpg'), 'assets/stock/a.jpg');
    assert.equal(readAssetLock(dir).assets.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('creditLines deduplicates useful attribution and omits unknown records', () => {
  const dir = tmp('narova-assets-credits-');
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) fs.writeFileSync(path.join(dir, 'assets', name), name);
    for (const name of ['a.jpg', 'b.jpg']) {
      registerAsset(dir, {
        file: `assets/${name}`,
        origin: { mode: 'stock', sourcePage: 'https://example.test/item' },
        rights: { license: 'CC-BY-4.0', attribution: 'Example Artist' },
      });
    }
    registerAsset(dir, { file: 'assets/c.jpg' });
    assert.deepEqual(creditLines(dir), [
      'Example Artist (CC-BY-4.0) — https://example.test/item',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadAsset publishes atomically, enforces type/size, and preserves old bytes on failure', async () => {
  const dir = tmp('narova-assets-download-');
  const dest = path.join(dir, 'asset.bin');
  try {
    fs.writeFileSync(dest, 'old');
    const ok = await downloadAsset('https://example.test/asset', dest, {
      fetch: async () => new Response('new-bytes', {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '9' },
      }),
    });
    assert.equal(ok.bytes, 9);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new-bytes');
    assert.deepEqual(fs.readdirSync(dir), ['asset.bin']);

    await assert.rejects(
      downloadAsset('https://example.test/error', dest, {
        fetch: async () => new Response('<html>error</html>', {
          status: 200, headers: { 'content-type': 'text/html' },
        }),
      }),
      /content-type/,
    );
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new-bytes');

    await assert.rejects(
      downloadAsset('https://example.test/disguised-html', dest, {
        fetch: async () => new Response('<!doctype html><title>Access denied</title>', {
          status: 200, headers: { 'content-type': 'application/octet-stream' },
        }),
      }),
      /HTML error body/,
    );
    await assert.rejects(
      downloadAsset('https://example.test/disguised-json', dest, {
        fetch: async () => new Response('{"error":"expired URL"}', {
          status: 200, headers: { 'content-type': 'text/plain' },
        }),
      }),
      /JSON error body/,
    );
    await assert.rejects(
      downloadAsset('https://example.test/empty', dest, {
        fetch: async () => new Response('', { status: 200 }),
      }),
      /empty response body/,
    );
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new-bytes');

    await assert.rejects(
      downloadAsset('https://example.test/large', dest, {
        maxBytes: 3,
        fetch: async () => new Response('four', {
          status: 200, headers: { 'content-type': 'application/octet-stream' },
        }),
      }),
      /byte limit/,
    );
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new-bytes');

    const model = path.join(dir, 'scene.gltf');
    await downloadAsset('https://example.test/model', model, {
      fetch: async () => new Response('{"asset":{"version":"2.0"}}', {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    });
    assert.match(fs.readFileSync(model, 'utf8'), /"version":"2.0"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('downloadAsset does not forward credentials across origins when redirected', async () => {
  const dir = tmp('narova-assets-redirect-');
  const destination = path.join(dir, 'asset.bin');
  let initialHeaders;
  let redirectedHeaders;
  const target = http.createServer((request, response) => {
    redirectedHeaders = request.headers;
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end('asset');
  });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const redirect = http.createServer((request, response) => {
    initialHeaders = request.headers;
    response.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/asset` });
    response.end();
  });
  await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
  try {
    await downloadAsset(`http://127.0.0.1:${redirect.address().port}/start`, destination, {
      headers: { authorization: 'Bearer secret', cookie: 'session=secret' },
    });
    assert.equal(initialHeaders.authorization, 'Bearer secret');
    assert.equal(initialHeaders.cookie, 'session=secret');
    assert.equal(redirectedHeaders.authorization, undefined);
    assert.equal(redirectedHeaders.cookie, undefined);
    assert.equal(fs.readFileSync(destination, 'utf8'), 'asset');
  } finally {
    await new Promise(resolve => redirect.close(resolve));
    await new Promise(resolve => target.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
