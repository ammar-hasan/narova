'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ingest, fetchPage, parsePage, collectImages, downloadImages,
  findChrome, screenshotPage, themeSuggestions, slugify, normalizeHex,
} = require('../src/ingest');

const FIXTURE_HTML = `<!doctype html><html><head>
<title>Acme &amp; Co — Widgets that work</title>
<meta name="description" content="Acme makes widgets.">
<meta property="og:title" content="Acme &amp; Co">
<meta property="og:description" content="Widgets, done right.">
<meta property="og:image" content="/static/hero.png">
<meta name="theme-color" content="#f60">
<meta name="msapplication-TileColor" content="#FF6600">
<link rel="canonical" href="https://acme.example/">
</head><body>
<img src="/static/team.jpg" width="1200" height="800">
<img src="data:image/png;base64,AAAA">
<img src="/static/favicon.png" width="32" height="32">
<img src="/static/tracker-pixel.gif">
<img src="https://cdn.example.com/big.webp" width="1600" height="900">
<img src="/static/photo.jpeg">
</body></html>`;

const htmlRes = (html, { status = 200, type = 'text/html; charset=utf-8', url = '' } = {}) => {
  const r = new Response(html, { status, headers: { 'content-type': type } });
  if (url) Object.defineProperty(r, 'url', { value: url });
  return r;
};
const imgRes = (bytes, type = 'image/png', headers = {}) =>
  new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': type, ...headers } });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'narova-ingest-'));

test('parsePage extracts metadata and absolute-izes og:image/canonical', () => {
  const m = parsePage(FIXTURE_HTML, 'https://acme.example/blog/post');
  assert.equal(m.title, 'Acme & Co — Widgets that work');
  assert.equal(m.description, 'Acme makes widgets.');
  assert.equal(m.og.title, 'Acme & Co');
  assert.equal(m.og.image, 'https://acme.example/static/hero.png');
  assert.equal(m.themeColor, '#f60');
  assert.equal(m.canonical, 'https://acme.example/');
  assert.equal(m.colors['msapplication-tilecolor'], '#FF6600');
});

test('collectImages: og first, skips data:/tiny/tracking, dedupes, absolute', () => {
  const imgs = collectImages(FIXTURE_HTML, 'https://acme.example/blog/', { ogImage: 'https://acme.example/static/hero.png' });
  assert.deepEqual(imgs, [
    'https://acme.example/static/hero.png',
    'https://acme.example/static/team.jpg',
    'https://cdn.example.com/big.webp',
    'https://acme.example/static/photo.jpeg',
  ]);
});

test('fetchPage rejects non-http URLs, non-200, and non-HTML', async () => {
  await assert.rejects(() => fetchPage('file:///etc/passwd', { fetch: async () => { throw new Error('unreachable'); } }), /http\(s\) URL/);
  await assert.rejects(() => fetchPage('https://x.example/', { fetch: async () => htmlRes('nope', { status: 404 }) }), /HTTP 404/);
  await assert.rejects(() => fetchPage('https://x.example/p.pdf', { fetch: async () => htmlRes('%PDF', { type: 'application/pdf' }) }), /not a web page/);
  await assert.rejects(() => fetchPage('https://x.example/', { fetch: async () => { throw Object.assign(new Error('boom'), { name: 'TimeoutError' }); } }), /timed out/);
});

test('fetchPage returns finalUrl after redirects and the body', async () => {
  const page = await fetchPage('https://x.example/a', {
    fetch: async () => htmlRes('<title>t</title>', { url: 'https://x.example/b' }),
  });
  assert.equal(page.finalUrl, 'https://x.example/b');
  assert.match(page.html, /<title>t<\/title>/);
  assert.ok(page.fetchedAt && page.durationMs >= 0);
});

test('downloadImages: content-type checked, size-capped, collision-safe names', async () => {
  const dir = tmp();
  const big = Buffer.alloc(9 * 1024 * 1024);
  const fetch = async (u) => ({
    'https://x.example/a.png': imgRes([1, 2, 3], 'image/png'),
    'https://x.example/b.txt': new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } }),
    'https://x.example/c.jpg': imgRes(big, 'image/jpeg', { 'content-length': String(big.length) }),
    'https://x.example/d.webp': imgRes([9, 9], 'image/webp'),
  })[u] || new Response('nf', { status: 404 });
  const saved = await downloadImages(
    ['https://x.example/a.png', 'https://x.example/b.txt', 'https://x.example/c.jpg', 'https://x.example/d.webp'],
    { dir, slug: 'acme', fetch });
  assert.deepEqual(saved.map((p) => path.basename(p)), ['acme-1.png', 'acme-2.webp']);
  // Collision-safe: same slug again must not overwrite.
  const again = await downloadImages(['https://x.example/a.png'], { dir, slug: 'acme', fetch });
  assert.equal(path.basename(again[0]), 'acme-1-2.png');
  assert.equal(fs.readFileSync(path.join(dir, 'acme-1.png')).length, 3);
});

test('findChrome prefers app paths, then PATH binaries; null when absent', () => {
  assert.equal(findChrome({ apps: [], bins: [], whichFn: () => null }), null);
  assert.equal(findChrome({ apps: [], bins: ['chromium'], whichFn: (b) => (b === 'chromium' ? '/usr/bin/chromium' : null) }), '/usr/bin/chromium');
  const app = path.join(tmp(), 'Fake Chrome');
  fs.writeFileSync(app, '');
  assert.equal(findChrome({ apps: [app], bins: [], whichFn: () => null }), app);
});

test('screenshotPage is best-effort: ok on file, reason on failure, skipped without chrome', () => {
  const dir = tmp();
  const out = path.join(dir, 'shot.png');
  const okShot = screenshotPage('https://x.example/', out, {
    chrome: '/fake/chrome',
    spawnSyncImpl: () => { fs.writeFileSync(out, 'x'); return { status: 0 }; },
  });
  assert.deepEqual(okShot, { ok: true, path: out });
  const bad = screenshotPage('https://x.example/', path.join(dir, 'no.png'), {
    chrome: '/fake/chrome', spawnSyncImpl: () => ({ status: 1 }),
  });
  assert.equal(bad.ok, false);
  assert.equal(screenshotPage('https://x.example/', out, { chrome: null }).ok, false);
});

test('themeSuggestions dedupes case/format and normalizes hex', () => {
  const meta = parsePage(FIXTURE_HTML, 'https://acme.example/');
  assert.deepEqual(themeSuggestions(meta), [
    { from: 'theme-color', color: '#ff6600' },
  ]);
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('not-a-color'), null);
});

test('slugify builds filesystem-safe names from the URL', () => {
  assert.equal(slugify('https://www.acme.example/blog/My Post!.html'), 'acme-example-my-post');
  assert.equal(slugify('https://acme.example/'), 'acme-example');
  assert.equal(slugify('not a url', 'Fallback Title'), 'fallback-title');
});

test('ingest end-to-end (offline): assets, screenshot skip, sources.md, claims.md', async () => {
  const dir = tmp();
  const logs = [];
  const pageUrl = 'https://acme.example/blog/post';
  const fetch = async (u) => {
    if (u === pageUrl) return htmlRes(FIXTURE_HTML);
    if (u.endsWith('.png') || u.endsWith('.jpg') || u.endsWith('.webp') || u.endsWith('.jpeg')) return imgRes([7, 7, 7], 'image/png');
    return new Response('nf', { status: 404 });
  };
  const r = await ingest(pageUrl, { projectDir: dir, log: (s) => logs.push(s), fetch, chrome: null });

  assert.equal(r.finalUrl, pageUrl);
  assert.equal(r.meta.title, 'Acme & Co — Widgets that work');
  assert.equal(r.images.length, 4);
  assert.equal(r.screenshot.ok, false);
  assert.match(r.screenshot.reason, /no Chrome/);
  for (const f of r.files) assert.ok(fs.existsSync(path.join(dir, f)), f);

  const sources = fs.readFileSync(path.join(dir, 'sources.md'), 'utf8');
  assert.match(sources, /## \d{4}-\d{2}-\d{2} — Acme & Co — Widgets that work/);
  assert.match(sources, /url: https:\/\/acme\.example\/blog\/post/);

  const claimsPath = path.join(dir, 'claims.md');
  assert.ok(r.claimsCreated);
  const claims = fs.readFileSync(claimsPath, 'utf8');
  assert.match(claims, /verbatim/);
  assert.match(claims, /paraphrase/);
  assert.match(claims, /inference/);

  const out = logs.join('\n');
  assert.match(out, /ingest summary/);
  assert.match(out, /--accent: #ff6600/);
  assert.match(out, /references\/url-to-source\.md/);

  // Second run: sources.md appends, claims.md is never overwritten.
  const r2 = await ingest(pageUrl, { projectDir: dir, log: () => {}, fetch, chrome: null });
  assert.equal(r2.claimsCreated, false);
  assert.equal(fs.readFileSync(claimsPath, 'utf8'), claims);
  const entries = fs.readFileSync(path.join(dir, 'sources.md'), 'utf8').match(/^## /gm);
  assert.equal(entries.length, 2);
});
