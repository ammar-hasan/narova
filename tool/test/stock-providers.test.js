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
  const providers = listStockProviders({ PEXELS_API_KEY: 'secret', FREESOUND_API_KEY: '' });
  assert.deepEqual(providers.map(provider => provider.id), [
    'wikimedia', 'openverse', 'nasa', 'internet-archive', 'pexels', 'pixabay', 'freesound',
  ]);
  assert.deepEqual(providers[0], {
    id: 'wikimedia', name: 'Wikimedia Commons', kinds: ['image', 'video', 'audio'], envKey: null, ready: true,
  });
  assert.equal(providers.find(provider => provider.id === 'pexels').ready, true);
  assert.equal(providers.find(provider => provider.id === 'pixabay').ready, false);
  assert.doesNotMatch(JSON.stringify(providers), /secret/);
  assert.deepEqual(
    listStockProviders({}, { pack: 'essential' }).map(provider => provider.id),
    ['wikimedia', 'openverse', 'nasa', 'internet-archive'],
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

test('Pexels adapters normalize photo/video metadata and select a practical HD video rendition', async () => {
  const requests = [];
  const photo = {
    id: 10, width: 4000, height: 3000, url: 'https://www.pexels.com/photo/10/',
    photographer: 'Ada', alt: 'Calm ocean',
    src: { original: 'https://images.pexels.com/photo.jpg', medium: 'https://images.pexels.com/preview.jpg' },
  };
  const video = {
    id: 20, url: 'https://www.pexels.com/video/20/', image: 'https://images.pexels.com/poster.jpg',
    user: { name: 'Lin' }, video_files: [
      { link: 'https://videos.pexels.com/4k.mp4', file_type: 'video/mp4', width: 3840, height: 2160 },
      { link: 'https://videos.pexels.com/hd.mp4', file_type: 'video/mp4', width: 1920, height: 1080 },
      { link: 'https://videos.pexels.com/sd.mp4', file_type: 'video/mp4', width: 640, height: 360 },
    ],
  };
  const fetch = async (url, init) => {
    requests.push({ url: String(url), authorization: init.headers.authorization });
    if (String(url).includes('/videos/')) return jsonResponse(String(url).includes('/search?') ? { videos: [video] } : video);
    return jsonResponse(String(url).includes('/search?') ? { photos: [photo] } : photo);
  };
  const deps = { fetch, env: { PEXELS_API_KEY: 'pexels-secret' } };
  const photos = await searchStock('pexels', 'ocean', { kind: 'image', limit: 1 }, deps);
  assert.equal(photos[0].title, 'Calm ocean');
  assert.equal(photos[0].rights.license, 'Pexels License');
  assert.equal(photos[0].rights.attribution, 'Photo by Ada on Pexels');
  const resolved = await resolveStock('pexels', '20', { kind: 'video' }, deps);
  assert.equal(resolved.download.url, 'https://videos.pexels.com/hd.mp4');
  assert.equal(resolved.download.width, 1920);
  assert.ok(requests.every(request => request.authorization === 'pexels-secret'));

  const portrait = _internals.fromPexelsVideo({
    id: 21, url: 'https://www.pexels.com/video/21/', video_files: [
      { link: 'https://videos.pexels.com/portrait-hd.mp4', file_type: 'video/mp4', width: 1080, height: 1920 },
      { link: 'https://videos.pexels.com/portrait-sd.mp4', file_type: 'video/mp4', width: 360, height: 640 },
    ],
  });
  assert.equal(portrait.download.url, 'https://videos.pexels.com/portrait-hd.mp4');
});

test('Pixabay adapters respect the three-result API minimum and normalize image/video rights', async () => {
  const requests = [];
  const image = {
    id: 31, tags: 'mountain, sunrise', pageURL: 'https://pixabay.com/photos/31/', user: 'Mira',
    previewURL: 'https://cdn.pixabay.com/preview.jpg', largeImageURL: 'https://cdn.pixabay.com/large.jpg',
    imageWidth: 2000, imageHeight: 1200, imageSize: 1234,
  };
  const video = {
    id: 32, tags: 'mountain video', pageURL: 'https://pixabay.com/videos/32/', user: 'Omar', duration: 8,
    videos: { medium: {
      url: 'https://cdn.pixabay.com/medium.mp4', width: 1920, height: 1080, size: 999,
      thumbnail: 'https://cdn.pixabay.com/medium.jpg',
    } },
  };
  const fetch = async url => {
    requests.push(String(url));
    return jsonResponse({ hits: [String(url).includes('/videos/') ? video : image] });
  };
  const deps = { fetch, env: { PIXABAY_API_KEY: 'pixabay-secret' } };
  const images = await searchStock('pixabay', 'mountain', { kind: 'image', limit: 1 }, deps);
  assert.equal(images[0].download.bytes, undefined);
  assert.equal(images[0].download.width, undefined);
  assert.equal(images[0].rights.license, 'Pixabay Content License');
  assert.match(requests[0], /per_page=3/);
  const resolved = await resolveStock('pixabay', '32', { kind: 'video' }, deps);
  assert.equal(resolved.download.duration, 8);
  assert.equal(resolved.rights.creator, 'Omar');
});

test('Freesound uses token headers, preview downloads, and SPDX-like Creative Commons ids', async () => {
  let request;
  const sound = {
    id: 77, name: 'Soft gong.wav', username: 'Sam', duration: 3.4,
    url: 'https://freesound.org/s/77/', license: 'https://creativecommons.org/licenses/by/4.0/',
    previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/77.mp3' },
  };
  const fetch = async (url, init) => {
    request = { url: String(url), authorization: init.headers.authorization };
    return jsonResponse(String(url).includes('/search/') ? { results: [sound] } : sound);
  };
  const deps = { fetch, env: { FREESOUND_API_KEY: 'freesound-secret' } };
  const found = await searchStock('freesound', 'gong', { kind: 'audio', limit: 2 }, deps);
  assert.equal(found[0].rights.license, 'CC-BY-4.0');
  assert.equal(found[0].download.mime, 'audio/mpeg');
  assert.equal(request.authorization, 'Token freesound-secret');
  const resolved = await resolveStock('freesound', '77', { kind: 'audio' }, deps);
  assert.equal(resolved.download.duration, 3.4);
  assert.deepEqual(_internals.fromFreesound({
    id: 78, name: 'Unlicensed.mp3', username: 'Sam', url: 'https://freesound.org/s/78/',
    previews: { 'preview-hq-mp3': 'https://cdn.freesound.org/previews/78.mp3' },
  }).rights, { status: 'unknown' });
});

test('provider validation rejects unsupported kinds, missing keys, oversized queries, and secret-bearing URLs', async () => {
  await assert.rejects(searchStock('freesound', 'gong', { kind: 'video' }, { env: {} }), /does not support kind/);
  await assert.rejects(searchStock('pexels', 'ocean', { kind: 'image' }, { env: {} }), /requires PEXELS_API_KEY/);
  await assert.rejects(searchStock('pixabay', 'ocean', { kind: 'image' }, {
    env: { PIXABAY_API_KEY: 'do-not-print' },
    fetch: async () => new Response('no', { status: 401 }),
  }), error => {
    assert.doesNotMatch(error.message, /do-not-print/);
    return /HTTP 401/.test(error.message);
  });
  await assert.rejects(searchStock('wikimedia', 'x'.repeat(201), { kind: 'image' }, { env: {} }), /at most 200/);
  assert.equal(_internals.cleanUrl('https://user:pass@example.com/x'), null);

  for (const [provider, kind, env] of [
    ['wikimedia', 'image', {}],
    ['openverse', 'image', {}],
    ['nasa', 'image', {}],
    ['internet-archive', 'audio', {}],
    ['pexels', 'image', { PEXELS_API_KEY: 'x' }],
    ['pixabay', 'image', { PIXABAY_API_KEY: 'x' }],
    ['freesound', 'audio', { FREESOUND_API_KEY: 'x' }],
  ]) {
    await assert.rejects(
      searchStock(provider, 'test', { kind }, { env, fetch: async () => jsonResponse({}) }),
      new RegExp(`${provider === 'nasa' ? 'nasa' : provider} returned an invalid response`),
    );
  }
  assert.throws(() => listStockProviders({}, { pack: 'everything' }), /unknown stock provider pack/);
  await assert.rejects(
    searchStock('pexels', 'ocean', { kind: 'image', pack: 'essential' }, { env: { PEXELS_API_KEY: 'x' } }),
    /unknown stock provider .* essential pack/,
  );
});
