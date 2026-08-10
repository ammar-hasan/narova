'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listStockProviders, resolveStock, searchStock, _internals } = require('../tool/stock-providers');
const { listBrowserProviders } = require('../tool/browser-providers');

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('lists every extension and treats absent credentials as optional readiness', () => {
  const providers = listStockProviders({ PEXELS_API_KEY: 'secret' });
  assert.deepEqual(providers.map(item => item.id), ['met', 'cleveland-museum', 'loc', 'pexels', 'pixabay', 'freesound']);
  assert.equal(providers.find(item => item.id === 'pexels').ready, true);
  assert.equal(providers.find(item => item.id === 'pixabay').ready, false);
  assert.ok(providers.filter(item => !item.envKey).every(item => item.ready));
  assert.doesNotMatch(JSON.stringify(providers), /secret/);
});

test('lists the long-tail catalogue explicitly as unique llm-browser providers', () => {
  const providers = listBrowserProviders();
  assert.ok(providers.length >= 100, `expected at least 100 loose providers, got ${providers.length}`);
  assert.equal(new Set(providers.map(item => item.id)).size, providers.length);
  for (const id of ['unsplash', 'mixkit-video', 'google-fonts', 'bunny-fonts', 'undraw', 'ambientcg', 'artic', 'openstreetmap', 'where-the-iss', 'jsonplaceholder-photos']) {
    const provider = providers.find(item => item.id === id);
    assert.ok(provider, `missing ${id}`);
    assert.equal(provider.mode, 'llm-browser');
    assert.equal(provider.ready, false);
  }

  const cli = path.resolve(__dirname, '../tool/narova-stock.js');
  const result = spawnSync(process.execPath, [cli, 'providers'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^wikimedia\timage,video,audio\tready\tessential-api$/m);
  assert.match(result.stdout, /^met\timage\tready\textension-api$/m);
  assert.match(result.stdout, /^unsplash\timage\texplore\tllm-browser$/m);
});

test('Met, Cleveland, and LOC normalize their different rights models', async () => {
  const met = {
    objectID: 437133, title: 'Wheat Field', isPublicDomain: true,
    primaryImage: 'https://images.example/met-original.jpg', primaryImageSmall: 'https://images.example/met.jpg',
    artistDisplayName: 'Vincent van Gogh',
    objectURL: 'https://www.metmuseum.org/art/collection/search/437133',
  };
  const metFetch = async url => jsonResponse(String(url).includes('/search?') ? { total: 1, objectIDs: [437133] } : met);
  assert.equal((await searchStock('met', 'wheat', { kind: 'image', limit: 1 }, { fetch: metFetch, env: {} }))[0].rights.license, 'CC0-1.0');

  const cleveland = {
    id: 147016, title: 'Landscape', share_license_status: 'CC0', url: 'https://www.clevelandart.org/art/1972.47',
    creators: [{ description: 'An Artist' }],
    images: { print: { url: 'https://images.example/cleveland.jpg', width: '1536', height: '1931', filesize: '2000' } },
  };
  const clevelandFetch = async url => jsonResponse(String(url).endsWith('/147016') ? { data: cleveland } : { data: [cleveland] });
  const art = await resolveStock('cleveland-museum', '147016', { kind: 'image' }, { fetch: clevelandFetch, env: {} });
  assert.equal(art.download.bytes, 2000);
  assert.equal(art.rights.license, 'CC0-1.0');

  const locSummary = {
    id: 'http://www.loc.gov/item/2004662055/', title: 'Landscape', digitized: true,
    access_restricted: false, image_url: ['https://tile.example/thumb.jpg', 'https://tile.example/view.jpg'],
  };
  const locDetail = { item: { title: 'Landscape' }, resources: [{ files: [[
    { url: 'https://tile.example/small.jpg', mimetype: 'image/jpeg', width: 640, size: 50000 },
    { url: 'https://tile.example/large.jpg', mimetype: 'image/jpeg', width: 2400, size: 2000000 },
  ]] }] };
  const locFetch = async url => jsonResponse(String(url).includes('/photos/?') ? { results: [locSummary] } : locDetail);
  const found = await searchStock('loc', 'landscape', { kind: 'image', limit: 1 }, { fetch: locFetch, env: {} });
  const loc = await resolveStock('loc', found[0].id, { kind: 'image' }, { fetch: locFetch, env: {} });
  assert.equal(loc.download.url, 'https://tile.example/large.jpg');
  assert.deepEqual(loc.rights, { status: 'unknown' });
});

test('Pexels image/video adapters require a key and choose a practical rendition', async () => {
  const photo = {
    id: 10, width: 4000, height: 3000, url: 'https://www.pexels.com/photo/10/', photographer: 'Ada', alt: 'Ocean',
    src: { original: 'https://images.example/photo.jpg', medium: 'https://images.example/preview.jpg' },
  };
  const video = {
    id: 20, url: 'https://www.pexels.com/video/20/', user: { name: 'Lin' }, video_files: [
      { link: 'https://videos.example/4k.mp4', file_type: 'video/mp4', width: 3840, height: 2160 },
      { link: 'https://videos.example/hd.mp4', file_type: 'video/mp4', width: 1920, height: 1080 },
    ],
  };
  const requests = [];
  const fetch = async (url, init) => {
    requests.push(init.headers.authorization);
    return jsonResponse(String(url).includes('/videos/') ? video : (String(url).includes('/search?') ? { photos: [photo] } : photo));
  };
  const deps = { fetch, env: { PEXELS_API_KEY: 'key' } };
  assert.equal((await searchStock('pexels', 'ocean', { kind: 'image', limit: 1 }, deps))[0].rights.license, 'Pexels License');
  assert.equal((await resolveStock('pexels', '20', { kind: 'video' }, deps)).download.url, 'https://videos.example/hd.mp4');
  assert.ok(requests.every(value => value === 'key'));
  await assert.rejects(searchStock('pexels', 'ocean', { kind: 'image' }, { env: {} }), /requires PEXELS_API_KEY/);
});

test('Pixabay and Freesound normalize results without leaking keys', async () => {
  const pixabayFetch = async url => jsonResponse({ hits: [{
    id: 31, tags: 'mountain', pageURL: 'https://pixabay.com/photos/31/', user: 'Mira',
    previewURL: 'https://images.example/preview.jpg', largeImageURL: 'https://images.example/large.jpg',
  }] });
  const pixabay = await searchStock('pixabay', 'mountain', { kind: 'image', limit: 1 }, {
    fetch: pixabayFetch, env: { PIXABAY_API_KEY: 'key' },
  });
  assert.equal(pixabay[0].rights.license, 'Pixabay Content License');

  const sound = {
    id: 77, name: 'Gong.wav', username: 'Sam', duration: 3.4, url: 'https://freesound.org/s/77/',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    previews: { 'preview-hq-mp3': 'https://cdn.example/77.mp3' },
  };
  let authorization;
  const freesoundFetch = async (url, init) => { authorization = init.headers.authorization; return jsonResponse({ results: [sound] }); };
  const sounds = await searchStock('freesound', 'gong', { kind: 'audio', limit: 1 }, {
    fetch: freesoundFetch, env: { FREESOUND_API_KEY: 'key' },
  });
  assert.equal(sounds[0].rights.license, 'CC-BY-4.0');
  assert.equal(authorization, 'Token key');

  await assert.rejects(searchStock('pixabay', 'x', { kind: 'image' }, {
    env: { PIXABAY_API_KEY: 'never-print-this' }, fetch: async () => jsonResponse({}, 401),
  }), error => !error.message.includes('never-print-this') && /HTTP 401/.test(error.message));
  assert.equal(_internals.cleanUrl('https://user:pass@example.com/x'), null);
});
