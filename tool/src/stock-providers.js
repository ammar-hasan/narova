'use strict';
/* Small stock-catalogue boundary.
 *
 * Providers only search and normalize remote metadata. Asset publication,
 * hashing, rollback, and the provenance lock remain in asset-registry/CLI.
 * Keeping that split makes provider API churn cheap without turning Narova
 * into a general plugin host. */

// Openverse's anonymous detail endpoint can legitimately approach 20 seconds.
// Keep catalogue metadata bounded without treating that observed latency as a failure.
const API_TIMEOUT_MS = 30_000;
const API_MAX_BYTES = 8 * 1024 * 1024;
const KINDS = new Set(['image', 'video', 'audio', 'model']);

const ESSENTIAL_PROVIDER_INFO = Object.freeze({
  wikimedia: Object.freeze({
    name: 'Wikimedia Commons',
    kinds: Object.freeze(['image', 'video', 'audio']),
    envKey: null,
  }),
  openverse: Object.freeze({
    name: 'Openverse',
    kinds: Object.freeze(['image', 'audio']),
    envKey: null,
  }),
  nasa: Object.freeze({
    name: 'NASA Image and Video Library',
    kinds: Object.freeze(['image', 'video', 'audio']),
    envKey: null,
  }),
  'internet-archive': Object.freeze({
    name: 'Internet Archive',
    kinds: Object.freeze(['video', 'audio']),
    envKey: null,
  }),
  iconify: Object.freeze({
    name: 'Iconify',
    kinds: Object.freeze(['image']),
    envKey: null,
  }),
  'poly-haven': Object.freeze({
    name: 'Poly Haven',
    kinds: Object.freeze(['model']),
    envKey: null,
  }),
});

const ADDITIONAL_PROVIDER_INFO = Object.freeze({
  met: Object.freeze({ name: 'The Metropolitan Museum of Art', kinds: Object.freeze(['image']), envKey: null }),
  'cleveland-museum': Object.freeze({ name: 'Cleveland Museum of Art', kinds: Object.freeze(['image']), envKey: null }),
  loc: Object.freeze({ name: 'Library of Congress', kinds: Object.freeze(['image']), envKey: null }),
  pexels: Object.freeze({ name: 'Pexels', kinds: Object.freeze(['image', 'video']), envKey: 'PEXELS_API_KEY' }),
  pixabay: Object.freeze({ name: 'Pixabay', kinds: Object.freeze(['image', 'video']), envKey: 'PIXABAY_API_KEY' }),
  freesound: Object.freeze({ name: 'Freesound', kinds: Object.freeze(['audio']), envKey: 'FREESOUND_API_KEY' }),
});

const PROVIDER_INFO = Object.freeze({ ...ESSENTIAL_PROVIDER_INFO, ...ADDITIONAL_PROVIDER_INFO });
const STOCK_PACKS = Object.freeze({
  essential: Object.freeze(Object.keys(ESSENTIAL_PROVIDER_INFO)),
  core: Object.freeze(Object.keys(PROVIDER_INFO)),
});

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

function cleanUrl(value) {
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); }
  catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  parsed.hash = '';
  return parsed.toString();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function requireProvider(name, pack) {
  const key = cleanText(name);
  const available = providerInfoForPack(pack);
  const info = key && available[key];
  if (!info) throw new Error(`unknown stock provider ${JSON.stringify(name)} in ${cleanText(pack) || 'essential'} pack (${Object.keys(available).join('|')})`);
  return { key, info };
}

function providerInfoForPack(pack = 'core') {
  const normalized = cleanText(pack) || 'core';
  const ids = STOCK_PACKS[normalized];
  if (!ids) throw new Error(`unknown stock provider pack ${JSON.stringify(pack)} (core|essential)`);
  return Object.fromEntries(ids.map(id => [id, PROVIDER_INFO[id]]));
}

function normalizeOptions(provider, opts = {}) {
  const kind = cleanText(opts.kind) || PROVIDER_INFO[provider].kinds[0];
  if (!KINDS.has(kind) || !PROVIDER_INFO[provider].kinds.includes(kind)) {
    throw new Error(`${provider} does not support kind ${JSON.stringify(kind)} (${PROVIDER_INFO[provider].kinds.join('|')})`);
  }
  const limit = opts.limit == null ? 5 : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('--limit must be an integer from 1 to 20');
  return { kind, limit };
}

function apiKey(provider, env = process.env) {
  const keyName = PROVIDER_INFO[provider].envKey;
  if (!keyName) return null;
  const key = env && cleanText(env[keyName]);
  if (!key) throw new Error(`${provider} requires ${keyName}`);
  return key;
}

async function fetchJson(url, opts = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (!fetchImpl) throw new Error('global fetch unavailable — stock search needs Node 18+');
  const timeoutMs = deps.timeoutMs ?? API_TIMEOUT_MS;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Narova stock asset adapter',
        ...(opts.headers || {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new Error(timedOut ? `stock provider timed out after ${timeoutMs}ms` : `stock provider request failed: ${error.message}`);
  }
  if (!response.ok) throw new Error(`stock provider returned HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > API_MAX_BYTES) throw new Error('stock provider response is too large');
  const text = await response.text();
  if (Buffer.byteLength(text) > API_MAX_BYTES) throw new Error('stock provider response is too large');
  try { return JSON.parse(text); }
  catch { throw new Error('stock provider returned invalid JSON'); }
}

function licenseId(value) {
  const url = cleanUrl(value);
  if (!url) return cleanText(value);
  const lower = url.toLowerCase();
  const version = (lower.match(/\/(\d+\.\d+)\/?$/) || [])[1];
  if (lower.includes('/publicdomain/zero/')) return 'CC0-1.0';
  if (lower.includes('/publicdomain/mark/')) return 'PDM-1.0';
  if (lower.includes('/licenses/by-nc-sa/')) return `CC-BY-NC-SA-${version || 'Unknown'}`;
  if (lower.includes('/licenses/by-nc-nd/')) return `CC-BY-NC-ND-${version || 'Unknown'}`;
  if (lower.includes('/licenses/by-nc/')) return `CC-BY-NC-${version || 'Unknown'}`;
  if (lower.includes('/licenses/by-sa/')) return `CC-BY-SA-${version || 'Unknown'}`;
  if (lower.includes('/licenses/by-nd/')) return `CC-BY-ND-${version || 'Unknown'}`;
  if (lower.includes('/licenses/by/')) return `CC-BY-${version || 'Unknown'}`;
  return url;
}

function rights({ license, licenseUrl, creator, attribution, unknown = false } = {}) {
  if (unknown) return { status: 'unknown' };
  return Object.fromEntries(Object.entries({
    status: 'declared',
    license: cleanText(license),
    licenseUrl: cleanUrl(licenseUrl),
    creator: cleanText(creator),
    attribution: cleanText(attribution),
  }).filter(([, value]) => value != null));
}

function download(url, metadata = {}) {
  const normalized = cleanUrl(url);
  if (!normalized) return null;
  return Object.fromEntries(Object.entries({
    url: normalized,
    mime: cleanText(metadata.mime),
    width: positiveInteger(metadata.width),
    height: positiveInteger(metadata.height),
    bytes: positiveInteger(metadata.bytes),
    duration: nonNegativeNumber(metadata.duration),
  }).filter(([, value]) => value != null));
}

function candidate(value) {
  const result = Object.fromEntries(Object.entries({
    provider: value.provider,
    id: cleanText(value.id),
    kind: value.kind,
    title: cleanText(value.title),
    sourcePage: cleanUrl(value.sourcePage),
    previewUrl: cleanUrl(value.previewUrl),
    download: value.download || null,
    rights: value.rights || { status: 'unknown' },
  }).filter(([, item]) => item != null));
  if (!result.id || !KINDS.has(result.kind) || !result.title || !result.sourcePage) {
    throw new Error(`${value.provider} returned an incomplete asset record`);
  }
  return result;
}

function resultArray(provider, data, field) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data[field])) {
    throw new Error(`${provider} returned an invalid response (expected ${field} array)`);
  }
  return data[field];
}

function wikimediaKind(item) {
  const mime = cleanText(item && (item.mimetype || item.mime)) || '';
  const mediaType = cleanText(item && item.mediatype) || '';
  if (mime.startsWith('video/') || mediaType.toUpperCase() === 'VIDEO') return 'video';
  if (mime.startsWith('audio/') || mediaType.toUpperCase() === 'AUDIO') return 'audio';
  const title = String(item && item.title || '').toLowerCase();
  if (/\.(?:webm|ogv|mp4|mov)$/.test(title)) return 'video';
  if (/\.(?:ogg|oga|opus|mp3|wav|flac)$/.test(title)) return 'audio';
  return 'image';
}

function wikimediaSourcePage(title) {
  return `https://commons.wikimedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`;
}

function fromWikimediaSearch(item, requestedKind) {
  const thumb = item.thumbnail || {};
  return candidate({
    provider: 'wikimedia', id: item.title || item.key, kind: requestedKind,
    title: String(item.title || item.key || '').replace(/^File:/, ''),
    sourcePage: wikimediaSourcePage(item.title || item.key), previewUrl: thumb.url,
    // Core search/get-file does not expose Commons' item license metadata.
    // Do not mistake the site's page license for the uploaded media license.
    rights: rights({ unknown: true }),
  });
}

function fromWikimediaFile(id, item) {
  const original = item.original || item.preferred || item.thumbnail || {};
  const kind = wikimediaKind({ ...original, title: id });
  return candidate({
    provider: 'wikimedia', id, kind,
    title: item.title || String(id).replace(/^File:/, ''),
    sourcePage: wikimediaSourcePage(id),
    previewUrl: item.thumbnail && item.thumbnail.url,
    download: download(original.url, {
      mime: original.mime, width: original.width, height: original.height,
      bytes: original.size, duration: original.duration,
    }),
    rights: rights({ unknown: true }),
  });
}

async function searchWikimedia(query, opts, deps) {
  const filetype = opts.kind === 'video' ? 'video' : opts.kind === 'audio' ? 'audio' : 'bitmap';
  const search = `filetype:${filetype} ${query}`;
  const url = `https://api.wikimedia.org/core/v1/commons/search/page?${new URLSearchParams({ q: search, limit: String(opts.limit) })}`;
  const data = await fetchJson(url, { headers: { 'api-user-agent': 'Narova stock asset adapter' } }, deps);
  return resultArray('wikimedia', data, 'pages')
    .filter(item => wikimediaKind({ ...(item.thumbnail || {}), title: item.title }) === opts.kind)
    .map(item => fromWikimediaSearch(item, opts.kind));
}

async function resolveWikimedia(id, opts, deps) {
  const title = String(id).startsWith('File:') ? String(id) : `File:${id}`;
  const url = `https://api.wikimedia.org/core/v1/commons/file/${encodeURIComponent(title)}`;
  const data = await fetchJson(url, { headers: { 'api-user-agent': 'Narova stock asset adapter' } }, deps);
  const normalized = fromWikimediaFile(title, data);
  if (normalized.kind !== opts.kind) throw new Error(`wikimedia asset is ${normalized.kind}, not ${opts.kind}: ${title}`);
  return normalized;
}

function fromOpenverse(item, kind) {
  const licenseUrl = cleanUrl(item.license_url);
  const creator = cleanText(item.creator);
  const durationMs = nonNegativeNumber(item.duration);
  return candidate({
    provider: 'openverse', id: item.id, kind,
    title: item.title || `Openverse ${kind} ${item.id}`,
    sourcePage: item.foreign_landing_url || item.detail_url,
    previewUrl: item.thumbnail || (kind === 'audio' ? item.url : null),
    download: download(item.url, {
      mime: mimeForUrl(item.url),
      width: item.width, height: item.height, bytes: item.filesize,
      // Openverse audio durations are milliseconds.
      duration: durationMs == null ? null : durationMs / 1000,
    }),
    rights: licenseUrl ? rights({
      license: licenseId(licenseUrl || [item.license, item.license_version].filter(Boolean).join('-')),
      licenseUrl, creator, attribution: item.attribution,
    }) : rights({ unknown: true }),
  });
}

async function openverseRequest(kind, id, query, opts, deps) {
  const collection = kind === 'image' ? 'images' : 'audio';
  const route = id ? `${collection}/${encodeURIComponent(id)}/` : `${collection}/`;
  const params = id ? '' : `?${new URLSearchParams({ q: query, page_size: String(opts.limit) })}`;
  return fetchJson(`https://api.openverse.org/v1/${route}${params}`, {}, deps);
}

async function searchOpenverse(query, opts, deps) {
  const data = await openverseRequest(opts.kind, null, query, opts, deps);
  return resultArray('openverse', data, 'results').map(item => fromOpenverse(item, opts.kind));
}

async function resolveOpenverse(id, opts, deps) {
  return fromOpenverse(await openverseRequest(opts.kind, id, null, opts, deps), opts.kind);
}

function mimeForUrl(value) {
  let pathname;
  try { pathname = new URL(value).pathname.toLowerCase(); }
  catch { return null; }
  const extension = pathname.match(/\.([a-z0-9]+)$/)?.[1];
  return ({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac',
  })[extension] || null;
}

const KIND_EXTENSIONS = Object.freeze({
  image: Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'tif', 'tiff']),
  video: Object.freeze(['mp4', 'webm', 'mov', 'm4v']),
  audio: Object.freeze(['mp3', 'm4a', 'wav', 'ogg', 'oga', 'flac']),
});

function fileKindFromUrl(value) {
  const mime = mimeForUrl(value);
  return mime ? mime.split('/')[0] : null;
}

function nasaItem(item, requestedKind, resolvedDownload = null) {
  const metadata = Array.isArray(item && item.data) ? item.data[0] : null;
  if (!metadata || typeof metadata !== 'object') throw new Error('nasa returned an invalid item');
  const id = cleanText(metadata.nasa_id);
  const kind = cleanText(metadata.media_type);
  if (!id || kind !== requestedKind) throw new Error(`nasa returned an invalid ${requestedKind} item`);
  const links = Array.isArray(item.links) ? item.links : [];
  const preview = links.find(link => link.rel === 'preview') || links.find(link => link.render === 'image');
  const canonical = links.find(link => link.rel === 'canonical' && fileKindFromUrl(link.href) === kind);
  const creator = cleanText(metadata.secondary_creator || metadata.photographer || metadata.center);
  return candidate({
    provider: 'nasa', id, kind, title: metadata.title || `NASA ${kind} ${id}`,
    sourcePage: `https://images.nasa.gov/details/${encodeURIComponent(id)}`,
    previewUrl: preview && preview.href,
    download: resolvedDownload || (canonical && download(canonical.href, {
      mime: mimeForUrl(canonical.href), width: canonical.width, height: canonical.height, bytes: canonical.size,
    })),
    // NASA hosts some third-party material; review the item before declaring rights.
    rights: rights({ unknown: true, creator }),
  });
}

function nasaCollection(data, field = 'items') {
  if (!data || typeof data !== 'object' || !data.collection || !Array.isArray(data.collection[field])) {
    throw new Error(`nasa returned an invalid response (expected collection.${field} array)`);
  }
  return data.collection[field];
}

async function nasaSearchRequest(params, deps) {
  return fetchJson(`https://images-api.nasa.gov/search?${new URLSearchParams(params)}`, {}, deps);
}

async function searchNasa(query, opts, deps) {
  const data = await nasaSearchRequest({ q: query, media_type: opts.kind, page_size: String(opts.limit) }, deps);
  return nasaCollection(data).map(item => nasaItem(item, opts.kind));
}

function selectNasaAsset(items, kind) {
  const options = items
    .map(item => cleanUrl(item && item.href))
    .filter(url => url && fileKindFromUrl(url) === kind)
    .map(url => ({ url, original: /~orig\.[a-z0-9]+(?:\?|$)/i.test(url) }));
  options.sort((a, b) => Number(b.original) - Number(a.original)
    || KIND_EXTENSIONS[kind].indexOf(new URL(a.url).pathname.split('.').pop().toLowerCase())
      - KIND_EXTENSIONS[kind].indexOf(new URL(b.url).pathname.split('.').pop().toLowerCase()));
  return options[0] ? download(options[0].url, { mime: mimeForUrl(options[0].url) }) : null;
}

async function resolveNasa(id, opts, deps) {
  const search = await nasaSearchRequest({ nasa_id: id, media_type: opts.kind, page_size: '1' }, deps);
  const matches = nasaCollection(search);
  if (!matches.length) throw new Error(`nasa asset not found: ${id}`);
  const asset = await fetchJson(`https://images-api.nasa.gov/asset/${encodeURIComponent(id)}`, {}, deps);
  const selected = selectNasaAsset(nasaCollection(asset), opts.kind);
  if (!selected) throw new Error(`nasa did not return a downloadable ${opts.kind} for ${id}`);
  return nasaItem(matches[0], opts.kind, selected);
}

function archiveMediaType(kind) {
  return kind === 'video' ? 'movies' : 'audio';
}

function archiveLicense(metadata) {
  const value = Array.isArray(metadata.licenseurl) ? metadata.licenseurl[0] : metadata.licenseurl;
  return cleanUrl(value);
}

function fromArchiveDocument(item, kind, resolvedDownload = null) {
  const id = cleanText(item.identifier);
  const creator = cleanText(Array.isArray(item.creator) ? item.creator.join(', ') : item.creator);
  const licenseUrl = archiveLicense(item);
  return candidate({
    provider: 'internet-archive', id, kind,
    title: item.title || `Internet Archive ${kind} ${id}`,
    sourcePage: `https://archive.org/details/${encodeURIComponent(id)}`,
    previewUrl: `https://archive.org/services/img/${encodeURIComponent(id)}`,
    download: resolvedDownload,
    rights: licenseUrl ? rights({
      license: licenseId(licenseUrl), licenseUrl, creator,
      attribution: creator ? `${item.title || id} by ${creator} / Internet Archive` : `${item.title || id} / Internet Archive`,
    }) : rights({ unknown: true }),
  });
}

function archiveDocs(data) {
  if (!data || typeof data !== 'object' || !data.response || !Array.isArray(data.response.docs)) {
    throw new Error('internet-archive returned an invalid response (expected response.docs array)');
  }
  return data.response.docs;
}

async function searchArchive(query, opts, deps) {
  const q = `mediatype:${archiveMediaType(opts.kind)} AND (${query})`;
  const params = new URLSearchParams({ q, rows: String(opts.limit), page: '1', output: 'json' });
  for (const field of ['identifier', 'title', 'creator', 'licenseurl']) params.append('fl[]', field);
  const data = await fetchJson(`https://archive.org/advancedsearch.php?${params}`, {}, deps);
  return archiveDocs(data).map(item => fromArchiveDocument(item, opts.kind));
}

function archiveDownload(id, files, kind) {
  const candidates = (Array.isArray(files) ? files : []).map(file => {
    const name = cleanText(file && file.name);
    const size = positiveInteger(file && file.size);
    if (!name || fileKindFromUrl(`https://archive.org/download/x/${encodeURIComponent(name)}`) !== kind) return null;
    const format = cleanText(file.format) || '';
    let score = 0;
    if (kind === 'video' && /512kb mpeg4|h\.264/i.test(format)) score += 30;
    if (kind === 'audio' && /vbr mp3|ogg vorbis/i.test(format)) score += 30;
    if (String(file.source).toLowerCase() === 'original') score += 10;
    if (size && size <= 100 * 1024 * 1024) score += 5;
    return { name, size, score };
  }).filter(Boolean);
  candidates.sort((a, b) => b.score - a.score || (a.size || Infinity) - (b.size || Infinity));
  const selected = candidates[0];
  if (!selected) return null;
  const url = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(selected.name).replace(/%2F/gi, '/')}`;
  return download(url, { mime: mimeForUrl(url), bytes: selected.size });
}

async function resolveArchive(id, opts, deps) {
  const data = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(id)}`, {}, deps);
  if (!data || typeof data !== 'object' || !data.metadata || !Array.isArray(data.files)) {
    throw new Error('internet-archive returned an invalid response (expected metadata and files)');
  }
  const declaredType = cleanText(data.metadata.mediatype);
  if (declaredType && declaredType !== archiveMediaType(opts.kind)) {
    throw new Error(`internet-archive asset is ${declaredType}, not ${archiveMediaType(opts.kind)}: ${id}`);
  }
  const selected = archiveDownload(id, data.files, opts.kind);
  if (!selected) throw new Error(`internet-archive did not return a downloadable ${opts.kind} for ${id}`);
  return fromArchiveDocument({ ...data.metadata, identifier: data.metadata.identifier || id }, opts.kind, selected);
}

function iconifyRights(collection) {
  const license = collection && collection.license;
  return license && license.spdx ? rights({
    license: license.spdx,
    licenseUrl: license.url,
    creator: collection.author && collection.author.name,
    attribution: `${collection.name || 'Icon set'} via Iconify`,
  }) : rights({ unknown: true });
}

function iconifyCandidate(id, collection) {
  const [prefix, ...nameParts] = String(id).split(':');
  const name = nameParts.join(':');
  return candidate({
    provider: 'iconify', id, kind: 'image', title: `${name} (${collection?.name || prefix})`,
    sourcePage: `https://icon-sets.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}/`,
    previewUrl: `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`,
    download: download(`https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`, { mime: 'image/svg+xml' }),
    rights: iconifyRights(collection),
  });
}

async function searchIconify(query, opts, deps) {
  const data = await fetchJson(`https://api.iconify.design/search?${new URLSearchParams({
    query, limit: String(Math.max(32, opts.limit)),
  })}`, {}, deps);
  const icons = resultArray('iconify', data, 'icons').slice(0, opts.limit);
  return icons.map(id => iconifyCandidate(id, data.collections && data.collections[String(id).split(':')[0]]));
}

async function resolveIconify(id, opts, deps) {
  const [prefix, ...nameParts] = id.split(':');
  if (!prefix || !nameParts.length) throw new Error('iconify asset id must be prefix:name');
  const data = await fetchJson(`https://api.iconify.design/collection?${new URLSearchParams({ prefix, info: 'true' })}`, {}, deps);
  return iconifyCandidate(id, data.info);
}

const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

function polyHavenCandidate(id, item, selected) {
  const creators = item && item.authors ? Object.keys(item.authors).join(', ') : null;
  return candidate({
    provider: 'poly-haven', id, kind: 'model', title: item?.name || id,
    sourcePage: `https://polyhaven.com/a/${encodeURIComponent(id)}`,
    previewUrl: item?.thumbnail_url,
    download: selected && download(selected.url, { mime: 'application/octet-stream', bytes: selected.size }),
    rights: rights({
      license: 'CC0-1.0', licenseUrl: CC0_URL, creator: creators,
      attribution: creators ? `${item?.name || id} by ${creators} / Poly Haven` : `${item?.name || id} / Poly Haven`,
    }),
  });
}

async function polyHavenAssets(deps) {
  const data = await fetchJson('https://api.polyhaven.com/assets?t=models', {}, deps);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('poly-haven returned an invalid response (expected assets object)');
  }
  return data;
}

async function searchPolyHaven(query, opts, deps) {
  const data = await polyHavenAssets(deps);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.entries(data).filter(([id, item]) => {
    const haystack = [id, item.name, item.description, ...(item.tags || []), ...(item.categories || [])]
      .filter(Boolean).join(' ').toLowerCase();
    return words.every(word => haystack.includes(word));
  }).slice(0, opts.limit).map(([id, item]) => polyHavenCandidate(id, item));
}

async function resolvePolyHaven(id, opts, deps) {
  const [assets, files] = await Promise.all([
    polyHavenAssets(deps),
    fetchJson(`https://api.polyhaven.com/files/${encodeURIComponent(id)}`, {}, deps),
  ]);
  if (!assets[id]) throw new Error(`poly-haven asset not found: ${id}`);
  const selected = files && files.fbx && (files.fbx['1k'] || files.fbx['2k'] || files.fbx['4k'])?.fbx;
  if (!selected || !selected.url) throw new Error(`poly-haven did not return an FBX model for ${id}`);
  return polyHavenCandidate(id, assets[id], selected);
}

function pexelsVideoDownload(files) {
  const usable = (Array.isArray(files) ? files : []).map(file => download(file.link, {
    mime: file.file_type, width: file.width, height: file.height,
  })).filter(Boolean);
  const hd = usable.filter(file => {
    const longEdge = Math.max(file.width || 0, file.height || 0);
    const shortEdge = Math.min(file.width || 0, file.height || 0);
    return longEdge <= 1920 && shortEdge <= 1080;
  });
  return (hd.length ? hd : usable)
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0] || null;
}

function fromPexelsPhoto(item) {
  const creator = cleanText(item.photographer);
  return candidate({
    provider: 'pexels', id: item.id, kind: 'image', title: item.alt || `Pexels photo ${item.id}`,
    sourcePage: item.url, previewUrl: item.src && (item.src.medium || item.src.small),
    download: download(item.src && (item.src.original || item.src.large2x || item.src.large), {
      mime: 'image/jpeg', width: item.width, height: item.height,
    }),
    rights: rights({
      license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', creator,
      attribution: creator ? `Photo by ${creator} on Pexels` : 'Photo from Pexels',
    }),
  });
}

function fromPexelsVideo(item) {
  const creator = cleanText(item.user && item.user.name);
  return candidate({
    provider: 'pexels', id: item.id, kind: 'video', title: `Pexels video ${item.id}`,
    sourcePage: item.url, previewUrl: item.image, download: pexelsVideoDownload(item.video_files),
    rights: rights({
      license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', creator,
      attribution: creator ? `Video by ${creator} on Pexels` : 'Video from Pexels',
    }),
  });
}

async function searchPexels(query, opts, deps) {
  const key = apiKey('pexels', deps.env);
  const route = opts.kind === 'video' ? 'videos/search' : 'search';
  const data = await fetchJson(`https://api.pexels.com/v1/${route}?${new URLSearchParams({ query, per_page: String(opts.limit) })}`, {
    headers: { authorization: key },
  }, deps);
  return resultArray('pexels', data, opts.kind === 'video' ? 'videos' : 'photos')
    .map(opts.kind === 'video' ? fromPexelsVideo : fromPexelsPhoto);
}

async function resolvePexels(id, opts, deps) {
  const key = apiKey('pexels', deps.env);
  const route = opts.kind === 'video' ? `videos/videos/${encodeURIComponent(id)}` : `photos/${encodeURIComponent(id)}`;
  const data = await fetchJson(`https://api.pexels.com/v1/${route}`, { headers: { authorization: key } }, deps);
  return opts.kind === 'video' ? fromPexelsVideo(data) : fromPexelsPhoto(data);
}

function pixabayVideoDownload(videos) {
  for (const name of ['medium', 'large', 'small', 'tiny']) {
    const item = videos && videos[name];
    const normalized = item && download(item.url, {
      mime: 'video/mp4', width: item.width, height: item.height, bytes: item.size,
    });
    if (normalized) return normalized;
  }
  return null;
}

function fromPixabayImage(item) {
  const creator = cleanText(item.user);
  const original = Boolean(item.imageURL);
  const selectedUrl = item.imageURL || item.fullHDURL || item.largeImageURL || item.webformatURL;
  const webformat = selectedUrl === item.webformatURL;
  return candidate({
    provider: 'pixabay', id: item.id, kind: 'image', title: item.tags || `Pixabay image ${item.id}`,
    sourcePage: item.pageURL, previewUrl: item.previewURL,
    download: download(selectedUrl, {
      mime: 'image/jpeg', width: original ? item.imageWidth : (webformat ? item.webformatWidth : null),
      height: original ? item.imageHeight : (webformat ? item.webformatHeight : null),
      bytes: original ? item.imageSize : null,
    }),
    rights: rights({
      license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', creator,
      attribution: creator ? `${creator} on Pixabay` : 'Media from Pixabay',
    }),
  });
}

function fromPixabayVideo(item) {
  const creator = cleanText(item.user);
  const selected = pixabayVideoDownload(item.videos);
  if (selected && item.duration != null) selected.duration = nonNegativeNumber(item.duration);
  return candidate({
    provider: 'pixabay', id: item.id, kind: 'video', title: item.tags || `Pixabay video ${item.id}`,
    sourcePage: item.pageURL, previewUrl: item.videos && item.videos.medium && item.videos.medium.thumbnail,
    download: selected,
    rights: rights({
      license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', creator,
      attribution: creator ? `${creator} on Pixabay` : 'Media from Pixabay',
    }),
  });
}

async function pixabayRequest(params, opts, deps) {
  const key = apiKey('pixabay', deps.env);
  const base = opts.kind === 'video' ? 'https://pixabay.com/api/videos/' : 'https://pixabay.com/api/';
  return fetchJson(`${base}?${new URLSearchParams({ key, ...params })}`, {}, deps);
}

async function searchPixabay(query, opts, deps) {
  const data = await pixabayRequest({
    q: query, per_page: String(Math.max(3, opts.limit)), safesearch: 'true',
  }, opts, deps);
  return resultArray('pixabay', data, 'hits').slice(0, opts.limit)
    .map(opts.kind === 'video' ? fromPixabayVideo : fromPixabayImage);
}

async function resolvePixabay(id, opts, deps) {
  const data = await pixabayRequest({ id: String(id) }, opts, deps);
  if (!Array.isArray(data.hits) || data.hits.length !== 1) throw new Error(`pixabay asset not found: ${id}`);
  return opts.kind === 'video' ? fromPixabayVideo(data.hits[0]) : fromPixabayImage(data.hits[0]);
}

function fromFreesound(item) {
  const preview = item.previews && (item.previews['preview-hq-mp3'] || item.previews['preview-hq-ogg']
    || item.previews['preview-lq-mp3'] || item.previews['preview-lq-ogg']);
  const licenseUrl = cleanUrl(item.license);
  const creator = cleanText(item.username);
  return candidate({
    provider: 'freesound', id: item.id, kind: 'audio', title: item.name || `Freesound audio ${item.id}`,
    sourcePage: item.url || `https://freesound.org/s/${encodeURIComponent(item.id)}/`,
    previewUrl: preview,
    download: download(preview, {
      mime: preview && preview.includes('.ogg') ? 'audio/ogg' : 'audio/mpeg', duration: item.duration,
    }),
    rights: licenseUrl ? rights({
      license: licenseId(item.license), licenseUrl, creator,
      attribution: creator ? `${item.name || `Sound ${item.id}`} by ${creator} on Freesound` : `Sound ${item.id} on Freesound`,
    }) : rights({ unknown: true }),
  });
}

const FREESOUND_FIELDS = 'id,name,url,username,license,previews,duration';

async function freesoundRequest(route, params, deps) {
  const key = apiKey('freesound', deps.env);
  return fetchJson(`https://freesound.org/apiv2/${route}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Token ${key}` },
  }, deps);
}

async function searchFreesound(query, opts, deps) {
  const data = await freesoundRequest('search/', {
    query, page_size: String(opts.limit), fields: FREESOUND_FIELDS,
  }, deps);
  return resultArray('freesound', data, 'results').map(fromFreesound);
}

async function resolveFreesound(id, opts, deps) {
  return fromFreesound(await freesoundRequest(`sounds/${encodeURIComponent(id)}/`, { fields: FREESOUND_FIELDS }, deps));
}

function fromMet(item) {
  const creator = cleanText(item.artistDisplayName);
  return candidate({
    provider: 'met', id: item.objectID, kind: 'image', title: item.title || `Met object ${item.objectID}`,
    sourcePage: item.objectURL || `https://www.metmuseum.org/art/collection/search/${encodeURIComponent(item.objectID)}`,
    previewUrl: item.primaryImageSmall,
    download: download(item.primaryImageSmall || item.primaryImage, { mime: 'image/jpeg' }),
    rights: item.isPublicDomain === true ? rights({
      license: 'CC0-1.0', licenseUrl: CC0_URL, creator,
      attribution: creator
        ? `${item.title || `Object ${item.objectID}`} by ${creator} / The Metropolitan Museum of Art`
        : `${item.title || `Object ${item.objectID}`} / The Metropolitan Museum of Art`,
    }) : rights({ unknown: true }),
  });
}

async function metObject(id, deps) {
  return fetchJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${encodeURIComponent(id)}`, {}, deps);
}

async function searchMet(query, opts, deps) {
  const data = await fetchJson(`https://collectionapi.metmuseum.org/public/collection/v1/search?${new URLSearchParams({
    q: query, hasImages: 'true', isPublicDomain: 'true',
  })}`, {}, deps);
  const ids = data && data.total === 0 && data.objectIDs == null ? [] : resultArray('met', data, 'objectIDs');
  const objects = await Promise.all(ids.slice(0, opts.limit).map(id => metObject(id, deps)));
  return objects.filter(item => item.isPublicDomain === true && item.primaryImage).map(fromMet);
}

async function resolveMet(id, opts, deps) {
  return fromMet(await metObject(id, deps));
}

function fromCleveland(item) {
  const creator = cleanText(Array.isArray(item.creators)
    ? item.creators.filter(value => value && value.use_in_caption !== false)
      .map(value => value.description).filter(Boolean).join(', ') : null);
  const image = item.images && (item.images.print || item.images.web);
  return candidate({
    provider: 'cleveland-museum', id: item.id, kind: 'image',
    title: item.title || `Cleveland Museum artwork ${item.id}`,
    sourcePage: item.url || `https://www.clevelandart.org/art/${encodeURIComponent(item.accession_number || item.id)}`,
    previewUrl: item.images && item.images.web && item.images.web.url,
    download: image && download(image.url, {
      mime: 'image/jpeg', width: image.width, height: image.height, bytes: image.filesize,
    }),
    rights: item.share_license_status === 'CC0' ? rights({
      license: 'CC0-1.0', licenseUrl: CC0_URL, creator,
      attribution: creator
        ? `${item.title || `Artwork ${item.id}`} by ${creator} / Cleveland Museum of Art`
        : `${item.title || `Artwork ${item.id}`} / Cleveland Museum of Art`,
    }) : rights({ unknown: true }),
  });
}

async function searchCleveland(query, opts, deps) {
  const data = await fetchJson(`https://openaccess-api.clevelandart.org/api/artworks/?${new URLSearchParams({
    q: query, limit: String(opts.limit), cc0: 'true',
  })}`, {}, deps);
  return resultArray('cleveland-museum', data, 'data')
    .filter(item => item.share_license_status === 'CC0' && item.images && (item.images.print || item.images.web))
    .map(fromCleveland);
}

async function resolveCleveland(id, opts, deps) {
  const data = await fetchJson(`https://openaccess-api.clevelandart.org/api/artworks/${encodeURIComponent(id)}`, {}, deps);
  if (!data || typeof data !== 'object' || !data.data || typeof data.data !== 'object') {
    throw new Error('cleveland-museum returned an invalid response (expected data object)');
  }
  return fromCleveland(data.data);
}

function locItemId(item) {
  const raw = cleanText(item && (item.item_id || item.id));
  if (!raw) return null;
  const match = raw.match(/\/item\/([^/?#]+)/i);
  return cleanText(match ? decodeURIComponent(match[1]) : raw);
}

function locSourcePage(id) {
  return `https://www.loc.gov/item/${encodeURIComponent(id)}/`;
}

function fromLocSearch(item) {
  const id = locItemId(item);
  const images = Array.isArray(item.image_url) ? item.image_url : [];
  return candidate({
    provider: 'loc', id, kind: 'image', title: item.title || `Library of Congress item ${id}`,
    sourcePage: locSourcePage(id), previewUrl: images[0],
    download: download(images.at(-1), { mime: 'image/jpeg' }), rights: rights({ unknown: true }),
  });
}

function flattenLocFiles(value, output = []) {
  if (Array.isArray(value)) for (const item of value) flattenLocFiles(item, output);
  else if (value && typeof value === 'object' && value.url) output.push(value);
  return output;
}

function locDownload(resources) {
  const files = flattenLocFiles((Array.isArray(resources) ? resources : []).map(resource => resource.files))
    .map(file => ({
      url: cleanUrl(file.url), mime: cleanText(file.mimetype), width: positiveInteger(file.width),
      height: positiveInteger(file.height), bytes: positiveInteger(file.size),
    })).filter(file => file.url && file.mime === 'image/jpeg');
  const practical = files.filter(file => (!file.bytes || file.bytes <= 50 * 1024 * 1024)
    && (!file.width || file.width <= 3000));
  const selected = (practical.length ? practical : files)
    .sort((a, b) => (b.width || 0) - (a.width || 0) || (b.bytes || 0) - (a.bytes || 0))[0];
  return selected ? download(selected.url, selected) : null;
}

async function searchLoc(query, opts, deps) {
  const data = await fetchJson(`https://www.loc.gov/photos/?${new URLSearchParams({
    q: query, fo: 'json', c: String(opts.limit), at: 'results',
  })}`, {}, deps);
  return resultArray('loc', data, 'results')
    .filter(item => item.digitized === true && item.access_restricted !== true && locItemId(item)
      && Array.isArray(item.image_url) && item.image_url.length)
    .map(fromLocSearch);
}

async function resolveLoc(id, opts, deps) {
  const data = await fetchJson(`${locSourcePage(id)}?fo=json`, {}, deps);
  if (!data || typeof data !== 'object' || !data.item || typeof data.item !== 'object' || !Array.isArray(data.resources)) {
    throw new Error('loc returned an invalid response (expected item and resources)');
  }
  const selected = locDownload(data.resources);
  if (!selected) throw new Error(`loc did not return a downloadable image for ${id}`);
  return candidate({
    provider: 'loc', id, kind: 'image', title: data.item.title || `Library of Congress item ${id}`,
    sourcePage: locSourcePage(id), previewUrl: data.resources.find(resource => resource.image)?.image,
    download: selected, rights: rights({ unknown: true }),
  });
}

const ESSENTIAL_ADAPTERS = Object.freeze({
  wikimedia: { search: searchWikimedia, resolve: resolveWikimedia },
  openverse: { search: searchOpenverse, resolve: resolveOpenverse },
  nasa: { search: searchNasa, resolve: resolveNasa },
  'internet-archive': { search: searchArchive, resolve: resolveArchive },
  iconify: { search: searchIconify, resolve: resolveIconify },
  'poly-haven': { search: searchPolyHaven, resolve: resolvePolyHaven },
});

const ADDITIONAL_ADAPTERS = Object.freeze({
  met: { search: searchMet, resolve: resolveMet },
  'cleveland-museum': { search: searchCleveland, resolve: resolveCleveland },
  loc: { search: searchLoc, resolve: resolveLoc },
  pexels: { search: searchPexels, resolve: resolvePexels },
  pixabay: { search: searchPixabay, resolve: resolvePixabay },
  freesound: { search: searchFreesound, resolve: resolveFreesound },
});

const ADAPTERS = Object.freeze({ ...ESSENTIAL_ADAPTERS, ...ADDITIONAL_ADAPTERS });

function listStockProviders(env = process.env, opts = {}) {
  const infoForPack = providerInfoForPack(opts.pack);
  return Object.entries(infoForPack).map(([id, info]) => ({
    id, name: info.name, kinds: [...info.kinds], envKey: info.envKey,
    ready: !info.envKey || Boolean(env && cleanText(env[info.envKey])),
  }));
}

async function searchStock(name, query, opts = {}, deps = {}) {
  const { key } = requireProvider(name, opts.pack);
  const normalizedQuery = cleanText(query);
  if (!normalizedQuery) throw new Error('stock search query must not be empty');
  if (normalizedQuery.length > 200) throw new Error('stock search query must be at most 200 characters');
  const normalized = normalizeOptions(key, opts);
  return ADAPTERS[key].search(normalizedQuery, normalized, { ...deps, env: deps.env || process.env });
}

async function resolveStock(name, id, opts = {}, deps = {}) {
  const { key } = requireProvider(name, opts.pack);
  const normalizedId = cleanText(id);
  if (!normalizedId) throw new Error('stock asset id must not be empty');
  if (normalizedId.length > 500) throw new Error('stock asset id must be at most 500 characters');
  const normalized = normalizeOptions(key, { ...opts, limit: 1 });
  const result = await ADAPTERS[key].resolve(normalizedId, normalized, { ...deps, env: deps.env || process.env });
  if (!result.download || !result.download.url) throw new Error(`${key} did not return a downloadable ${normalized.kind} for ${normalizedId}`);
  return result;
}

module.exports = {
  PROVIDER_INFO, ESSENTIAL_PROVIDER_INFO, ADDITIONAL_PROVIDER_INFO, STOCK_PACKS,
  listStockProviders,
  searchStock,
  resolveStock,
  _internals: {
    archiveDownload, cleanText, cleanUrl, fetchJson, iconifyCandidate,
    fromArchiveDocument, fromCleveland, fromFreesound, fromLocSearch,
    fromMet, fromNasaItem: nasaItem, fromOpenverse, fromPexelsPhoto,
    fromPexelsVideo, fromPixabayImage, fromPixabayVideo, fromWikimediaFile,
    fromWikimediaSearch, licenseId, locDownload, mimeForUrl, normalizeOptions,
    polyHavenCandidate, resultArray, selectNasaAsset, wikimediaKind,
  },
};
