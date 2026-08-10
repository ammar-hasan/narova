'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  listStockProviders, resolveStock, searchStock, _internals,
} = require('../src/stock-providers');

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

test('provider listing reports supported media and credential readiness without exposing values', () => {
  const providers = listStockProviders({ PEXELS_API_KEY: 'secret' });
  assert.deepEqual(providers.map(provider => provider.id), [
    'wikimedia', 'openverse', 'nasa', 'internet-archive', 'iconify', 'poly-haven',
  ]);
  assert.deepEqual(providers[0], {
    id: 'wikimedia', name: 'Wikimedia Commons', kinds: ['image', 'video', 'audio'], envKey: null, ready: true,
  });
  assert.doesNotMatch(JSON.stringify(providers), /secret/);
  assert.deepEqual(
    listStockProviders({}, { pack: 'essential' }).map(provider => provider.id),
    ['wikimedia', 'openverse', 'nasa', 'internet-archive', 'iconify', 'poly-haven'],
  );
});

test('Openverse normalizes per-item Creative Commons rights for images and audio', async () => {
  const image = {
    id: 'image-id', title: 'Clouds', foreign_landing_url: 'https://example.org/clouds',
    url: 'https://cdn.example.org/clouds.jpg', thumbnail: 'https://cdn.example.org/clouds-small.jpg',
    creator: 'Amina', license: 'by-sa', license_version: '4.0',
    license_url: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution: 'Clouds by Amina, CC BY-SA 4.0', width: 1600, height: 900,
  };
  const audio = {
    ...image, id: 'audio-id', title: 'Birds', url: 'https://cdn.example.org/birds.mp3',
    foreign_landing_url: 'https://example.org/birds', duration: 12500, filesize: 12345,
  };
  const requests = [];
  const fetch = async url => {
    requests.push(String(url));
    if (String(url).includes('/audio/')) return jsonResponse(String(url).includes('?') ? { results: [audio] } : audio);
    return jsonResponse(String(url).includes('?') ? { results: [image] } : image);
  };
  const images = await searchStock('openverse', 'clouds', { kind: 'image', limit: 1 }, { fetch, env: {} });
  assert.equal(images[0].rights.license, 'CC-BY-SA-4.0');
  assert.equal(images[0].download.mime, 'image/jpeg');
  const resolved = await resolveStock('openverse', 'audio-id', { kind: 'audio' }, { fetch, env: {} });
  assert.equal(resolved.download.duration, 12.5);
  assert.equal(resolved.download.mime, 'audio/mpeg');
  assert.match(requests[1], /\/audio\/audio-id\/$/);
  assert.deepEqual(_internals.fromOpenverse({
    id: 'unlicensed', title: 'Unknown rights', foreign_landing_url: 'https://example.org/item',
    url: 'https://example.org/item.jpg', creator: 'Someone', attribution: 'Unverified text',
  }, 'image').rights, { status: 'unknown' });
});

test('NASA search and resolve select the original matching media file without overclaiming rights', async () => {
  const item = {
    data: [{ nasa_id: 'EARTH 1', media_type: 'video', title: 'Earth turns', center: 'NASA' }],
    links: [{ href: 'https://images-assets.nasa.gov/poster.jpg', rel: 'preview', render: 'image' }],
  };
  const requests = [];
  const fetch = async url => {
    requests.push(String(url));
    if (String(url).includes('/asset/')) return jsonResponse({ collection: { items: [
      { href: 'https://images-assets.nasa.gov/EARTH~small.mp4' },
      { href: 'https://images-assets.nasa.gov/EARTH~orig.mp4' },
      { href: 'https://images-assets.nasa.gov/metadata.json' },
    ] } });
    return jsonResponse({ collection: { items: [item] } });
  };
  const found = await searchStock('nasa', 'earth', { kind: 'video', limit: 1 }, { fetch, env: {} });
  assert.equal(found[0].download, undefined);
  assert.deepEqual(found[0].rights, { status: 'unknown' });
  const resolved = await resolveStock('nasa', 'EARTH 1', { kind: 'video' }, { fetch, env: {} });
  assert.equal(resolved.download.url, 'https://images-assets.nasa.gov/EARTH~orig.mp4');
  assert.match(requests.at(-1), /asset\/EARTH%201$/);
});

test('Internet Archive resolves a practical derivative and only declares returned licenses', async () => {
  const document = {
    identifier: 'sample-film', title: 'Sample Film', creator: 'Nadia',
    licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
  };
  const requests = [];
  const fetch = async url => {
    requests.push(String(url));
    if (String(url).includes('/metadata/')) return jsonResponse({
      metadata: { ...document, mediatype: 'movies' },
      files: [
        { name: 'original.mov', format: 'QuickTime', source: 'original', size: '900000000' },
        { name: 'sample_512kb.mp4', format: '512Kb MPEG4', source: 'derivative', size: '4000000' },
        { name: 'poster.jpg', format: 'JPEG' },
      ],
    });
    return jsonResponse({ response: { docs: [document] } });
  };
  const found = await searchStock('internet-archive', 'sample', { kind: 'video', limit: 1 }, { fetch, env: {} });
  assert.equal(found[0].rights.license, 'CC-BY-4.0');
  const resolved = await resolveStock('internet-archive', 'sample-film', { kind: 'video' }, { fetch, env: {} });
  assert.match(resolved.download.url, /sample_512kb\.mp4$/);
  assert.equal(resolved.download.bytes, 4000000);
  assert.match(requests[0], /mediatype%3Amovies/);
});

test('Wikimedia search and resolve use the API gateway and keep rights unknown', async () => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url: String(url), headers: init.headers });
    if (String(url).includes('/search/page?')) {
      return jsonResponse({ pages: [{
        title: 'File:Meditation Gong.ogg',
        thumbnail: {
          mimetype: 'application/ogg', width: 120, height: 80,
          url: 'https://upload.wikimedia.org/preview.ogg?utm_source=commons',
        },
      }] });
    }
    return jsonResponse({
      title: 'Meditation Gong.ogg',
      original: {
        mediatype: 'AUDIO', size: 4567, duration: 2.5,
        url: 'https://upload.wikimedia.org/Meditation_Gong.ogg?utm_source=commons',
      },
      thumbnail: { url: 'https://upload.wikimedia.org/gong.jpg' },
    });
  };
  const found = await searchStock('wikimedia', 'gong', { kind: 'audio', limit: 1 }, { fetch, env: {} });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'File:Meditation Gong.ogg');
  assert.equal(found[0].kind, 'audio');
  assert.equal(found[0].download, undefined);
  assert.match(found[0].previewUrl, /preview\.ogg/);
  assert.deepEqual(found[0].rights, { status: 'unknown' });
  assert.match(requests[0].url, /filetype%3Aaudio\+gong/);
  assert.equal(requests[0].headers['api-user-agent'], 'Narova stock asset adapter');

  const resolved = await resolveStock('wikimedia', found[0].id, { kind: 'audio' }, { fetch, env: {} });
  assert.equal(resolved.download.bytes, 4567);
  assert.equal(resolved.download.duration, 2.5);
  assert.equal(resolved.rights.status, 'unknown');
  assert.match(requests[1].url, /api\.wikimedia\.org\/core\/v1\/commons\/file\/File%3AMeditation%20Gong\.ogg/);
});

test('Iconify normalizes SVG results and collection license metadata', async () => {
  const collection = {
    name: 'Material Design Icons', author: { name: 'Pictogrammers' },
    license: { spdx: 'Apache-2.0', url: 'https://example.test/LICENSE' },
  };
  const fetch = async url => jsonResponse(String(url).includes('/search?')
    ? { icons: ['mdi:home'], collections: { mdi: collection } }
    : { info: collection });
  const found = await searchStock('iconify', 'home', { kind: 'image', limit: 1 }, { fetch, env: {} });
  assert.equal(found[0].download.mime, 'image/svg+xml');
  assert.equal(found[0].rights.license, 'Apache-2.0');
  const resolved = await resolveStock('iconify', 'mdi:home', { kind: 'image' }, { fetch, env: {} });
  assert.match(resolved.download.url, /mdi\/home\.svg$/);
});

test('Poly Haven selects a small standalone FBX and declares CC0', async () => {
  const asset = { name: 'Wooden Crate', authors: { Amina: 'All' }, tags: ['crate'] };
  const fetch = async url => jsonResponse(String(url).includes('/files/') ? {
    fbx: { '1k': { fbx: { url: 'https://dl.polyhaven.org/crate.fbx', size: 1234 } } },
  } : { wooden_crate_01: asset });
  const found = await searchStock('poly-haven', 'crate', { kind: 'model', limit: 1 }, { fetch, env: {} });
  assert.equal(found[0].id, 'wooden_crate_01');
  const resolved = await resolveStock('poly-haven', found[0].id, { kind: 'model' }, { fetch, env: {} });
  assert.equal(resolved.download.url, 'https://dl.polyhaven.org/crate.fbx');
  assert.equal(resolved.rights.license, 'CC0-1.0');
});

test('provider validation rejects unsupported kinds, oversized queries, and secret-bearing URLs', async () => {
  await assert.rejects(searchStock('wikimedia', 'x'.repeat(201), { kind: 'image' }, { env: {} }), /at most 200/);
  assert.equal(_internals.cleanUrl('https://user:pass@example.com/x'), null);

  for (const [provider, kind, env] of [
    ['wikimedia', 'image', {}],
    ['openverse', 'image', {}],
    ['nasa', 'image', {}],
    ['internet-archive', 'audio', {}],
    ['iconify', 'image', {}],
  ]) {
    await assert.rejects(
      searchStock(provider, 'test', { kind }, { env, fetch: async () => jsonResponse({}) }),
      new RegExp(`${provider === 'nasa' ? 'nasa' : provider} returned an invalid response`),
    );
  }
  assert.throws(() => listStockProviders({}, { pack: 'everything' }), /unknown stock provider pack/);
  await assert.rejects(searchStock('pexels', 'ocean', { kind: 'image' }, { env: {} }), /unknown stock provider/);
});
