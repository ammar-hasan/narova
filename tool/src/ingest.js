'use strict';
/* `narova ingest <url>` — the mechanical first pass of URL sourcing
 * (references/url-to-source.md): fetch the page, extract metadata + content
 * images, download the best assets into <project>/assets/, take a best-effort
 * headless-Chrome screenshot, append sources.md, seed a claims.md skeleton.
 * Classification and the claims ledger stay with the agent.
 * Zero deps; Node 18+ (global fetch). Tests inject opts.fetch — no network. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ensureDir, which } = require('./util');

const FETCH_TIMEOUT_MS = 20000;
const SHOT_TIMEOUT_MS = 30000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGES = 5;

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
};

const CHROME_APPS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const CHROME_BINS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

/* Fetch the page as HTML. Follows redirects; throws a clear error on
 * non-200, non-HTML, or timeout. Returns { finalUrl, html, fetchedAt, durationMs }. */
async function fetchPage(url, { fetch: fetchImpl = globalThis.fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  if (!fetchImpl) throw new Error('global fetch unavailable — narova ingest needs Node 18+');
  if (!/^https?:\/\//i.test(url)) throw new Error(`ingest needs an http(s) URL, got "${url}"`);
  const started = Date.now();
  let res;
  try {
    res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
      headers: { 'user-agent': 'narova-ingest/1.0', accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    });
  } catch (e) {
    const why = e.name === 'TimeoutError' || e.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : e.message;
    throw new Error(`fetch failed for ${url}: ${why}`);
  }
  if (!res.ok) throw new Error(`fetch failed for ${url}: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type && type !== 'text/html' && type !== 'application/xhtml+xml') {
    throw new Error(`${url} is not a web page (content-type: ${type}) — download files directly with curl instead`);
  }
  const html = await res.text();
  return { finalUrl: res.url || url, html, fetchedAt: new Date().toISOString(), durationMs: Date.now() - started };
}

/* Minimal entity decode for attribute/title text. */
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");
}

/* Read one HTML attribute from a tag, quote style agnostic. */
function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null;
}

/* Parse metadata out of the page HTML. Pure; unit-testable. */
function parsePage(html, finalUrl) {
  const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const meta = {};
  const colors = {};
  const metaRe = /<meta\s[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(html))) {
    const tag = m[0];
    const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (!key || content == null) continue;
    if (!(key in meta)) meta[key] = content;
    if (/color/i.test(key)) colors[key] = content;
  }
  const canonM = /<link\s[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i.exec(html)
    || /<link\s[^>]*canonical[^>]*>/i.exec(html);
  const abs = (u) => { try { return new URL(u, finalUrl).href; } catch { return null; } };
  return {
    title: titleM ? decodeEntities(titleM[1].trim()) : '',
    description: meta['description'] || '',
    og: { title: meta['og:title'] || '', description: meta['og:description'] || '', image: meta['og:image'] ? abs(meta['og:image']) : null },
    themeColor: meta['theme-color'] || '',
    canonical: canonM && attr(canonM[0], 'href') ? abs(attr(canonM[0], 'href')) : null,
    colors,
  };
}

/* Candidate content images: og:image first, then large <img> candidates,
 * absolute-ized against the final URL, deduped. data: URIs skipped. */
function collectImages(html, finalUrl, { ogImage } = {}) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    if (!u || u.startsWith('data:')) return;
    let abs;
    try { abs = new URL(u, finalUrl).href; } catch { return; }
    if (!/^https?:\/\//i.test(abs) || seen.has(abs)) return;
    seen.add(abs);
    out.push(abs);
  };
  push(ogImage);
  const imgRe = /<img\s[^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const src = attr(tag, 'src');
    if (!src || /pixel|beacon|spacer|tracking|1x1/i.test(src)) continue;
    const w = parseInt(attr(tag, 'width'), 10) || 0;
    const h = parseInt(attr(tag, 'height'), 10) || 0;
    if ((w && w < 200) || (h && h < 200)) continue;                  // declared tiny
    if (!w && !h && !/\.(jpe?g|png|webp|avif|gif)(\?|#|$)/i.test(src)) continue; // unknown size, not raster-looking
    push(src);
  }
  return out;
}

/* Download the best images into dir. og:image comes first in `images`.
 * Content-type checked (image/* only), size-capped, extension from
 * content-type, collision-safe `<slug>-<n>.<ext>` names. */
async function downloadImages(images, { dir, slug, fetch: fetchImpl = globalThis.fetch, cap = MAX_IMAGES, maxBytes = MAX_IMAGE_BYTES, log = () => {} } = {}) {
  ensureDir(dir);
  const saved = [];
  for (const src of images) {
    if (saved.length >= cap) break;
    try {
      const res = await fetchImpl(src, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
      if (!res.ok) { log(`  skip  ${src} (HTTP ${res.status})`); continue; }
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) { log(`  skip  ${src} (not an image: ${type || 'unknown'})`); continue; }
      const len = parseInt(res.headers.get('content-length'), 10) || 0;
      if (len > maxBytes) { log(`  skip  ${src} (${(len / 1e6).toFixed(1)}MB > cap)`); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > maxBytes) { log(`  skip  ${src} (${buf.length ? 'over size cap' : 'empty'})`); continue; }
      const ext = EXT[type] || type.split('/')[1].replace(/[^a-z0-9]/g, '') || 'img';
      let name = `${slug}-${saved.length + 1}.${ext}`;
      for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${slug}-${saved.length + 1}-${n}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buf);
      saved.push(path.join(dir, name));
      log(`  saved ${path.join(path.basename(dir), name)} (${(buf.length / 1024).toFixed(0)}KB)`);
    } catch (e) {
      log(`  skip  ${src} (${e.message})`);
    }
  }
  return saved;
}

/* Best-available Chrome/Chromium/Edge binary, or null. Injectable for tests. */
function findChrome({ apps = CHROME_APPS, bins = CHROME_BINS, whichFn = which } = {}) {
  for (const p of apps) if (fs.existsSync(p)) return p;
  for (const b of bins) { const p = whichFn(b); if (p) return p; }
  return null;
}

/* Headless full-viewport screenshot. Best-effort: never throws, never hangs
 * longer than timeoutMs (spawnSync kills the child). */
function screenshotPage(url, out, { chrome, spawnSyncImpl = spawnSync, timeoutMs = SHOT_TIMEOUT_MS } = {}) {
  if (!chrome) return { ok: false, reason: 'no Chrome/Chromium/Edge found — screenshot skipped' };
  const args = (headless) => [headless, `--screenshot=${out}`, '--window-size=1440,900', '--hide-scrollbars', '--disable-gpu', url];
  for (const headless of ['--headless=new', '--headless']) {
    const r = spawnSyncImpl(chrome, args(headless), { timeout: timeoutMs, stdio: ['ignore', 'ignore', 'ignore'] });
    if (fs.existsSync(out) && fs.statSync(out).size > 0) return { ok: true, path: out };
    if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, reason: `chrome timed out after ${timeoutMs}ms` };
  }
  return { ok: false, reason: 'chrome produced no screenshot' };
}

/* #rgb/#rrggbb (optionally 0x-prefixed junk) → lowercase #rrggbb, or null. */
function normalizeHex(c) {
  const m = /#?([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(String(c || '').trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return `#${h}`;
}

/* Brand hints → suggested theme tokens. Suggestions only — never written
 * into reel.config.mjs. */
function themeSuggestions(meta) {
  const out = [];
  const seen = new Set();
  const push = (from, raw) => {
    const c = normalizeHex(raw);
    if (c && !seen.has(c)) { seen.add(c); out.push({ from, color: c }); }
  };
  push('theme-color', meta.themeColor);
  for (const [k, v] of Object.entries(meta.colors || {})) if (k !== 'theme-color') push(k, v);
  return out;
}

/* Page slug for asset names: host + last path segment, filesystem-safe. */
function slugify(u, title) {
  let base = '';
  try {
    const p = new URL(u);
    let seg = p.pathname.split('/').filter(Boolean).pop() || '';
    try { seg = decodeURIComponent(seg); } catch { /* keep raw segment */ }
    base = seg ? `${p.hostname.replace(/^www\./, '')}-${seg}` : p.hostname.replace(/^www\./, '');
  } catch { base = title || 'page'; }
  const s = base.toLowerCase().replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || 'page';
}

/* Append a dated entry to <dir>/sources.md (created on first use). */
function writeSources(dir, e) {
  const p = path.join(dir, 'sources.md');
  if (!fs.existsSync(p)) fs.writeFileSync(p, '# Sources\n\nIngested source material. Workflow: references/url-to-source.md.\n');
  const files = e.files.length ? e.files.map((f) => `\`${f}\``).join(', ') : 'none';
  fs.appendFileSync(p, `\n## ${e.fetchedAt.slice(0, 10)} — ${e.title || '(untitled)'}\n\n` +
    `- url: ${e.url}\n- fetched: ${e.fetchedAt} (${(e.durationMs / 1000).toFixed(1)}s)\n- files: ${files}\n`);
  return p;
}

/* claims.md ledger skeleton — the format from references/url-to-source.md §3.
 * Created only when no ledger exists; never overwrites the agent's ledger. */
function ensureClaimsSkeleton(dir, url) {
  if (fs.existsSync(path.join(dir, 'claims.md')) || fs.existsSync(path.join(dir, 'CLAIMS.md'))) return false;
  fs.writeFileSync(path.join(dir, 'claims.md'), `# Claims ledger

Source: ${url}

Every factual assertion in the \`vo\` must appear here before \`synth\`
(references/url-to-source.md §3), tagged as one of:

- **verbatim** — exact words from the source. Quote + URL (or saved file).
- **paraphrase** — faithfully restated, qualifiers intact. Source URL.
- **inference** — your own conclusion. Cut it, or phrase it on screen and in
  the voice as opinion ("we'd bet…"), never as fact.

If a claim is not in this ledger, it does not go in the script. Numbers keep
their qualifiers and scope. For contested topics, ledger every major side's
key claims — sourcing is checkable; balance is not.

## Claims

| # | Claim (as spoken in vo) | Tag (verbatim/paraphrase/inference) | Source (quote + URL or saved file) |
|---|--------------------------|--------------------------------------|-------------------------------------|
| 1 |                          |                                      |                                     |
`);
  return true;
}

/* Full first pass. opts: { projectDir = '.', log = console.log, fetch, chrome,
 * spawnSync } — fetch/chrome/spawnSync are injectable so tests stay offline. */
async function ingest(url, opts = {}) {
  const { projectDir = '.', log = console.log, fetch: fetchImpl } = opts;
  const dir = path.resolve(projectDir);
  const assetsDir = ensureDir(path.join(dir, 'assets'));

  log(`narova ingest ${url}\n`);
  const page = await fetchPage(url, { fetch: fetchImpl });
  const meta = parsePage(page.html, page.finalUrl);
  const slug = slugify(page.finalUrl, meta.title);
  if (page.finalUrl !== url) log(`  redirected → ${page.finalUrl}`);

  log('downloading images:');
  const images = collectImages(page.html, page.finalUrl, { ogImage: meta.og.image });
  const saved = await downloadImages(images, { dir: assetsDir, slug, fetch: fetchImpl, log });
  if (!saved.length) log('  (none found)');

  const chrome = opts.chrome !== undefined ? opts.chrome : findChrome();
  const shot = screenshotPage(page.finalUrl, path.join(assetsDir, `${slug}-page.png`),
    { chrome, spawnSyncImpl: opts.spawnSync });

  const suggestions = themeSuggestions(meta);
  const files = [...saved, ...(shot.ok ? [shot.path] : [])].map((f) => path.relative(dir, f));
  writeSources(dir, { url: page.finalUrl, title: meta.title, fetchedAt: page.fetchedAt, durationMs: page.durationMs, files });
  const claimsCreated = ensureClaimsSkeleton(dir, page.finalUrl);

  log('\n— ingest summary —');
  log(`title:      ${meta.title || '(none)'}`);
  if (meta.description) log(`description:${meta.description.length > 100 ? '' : ' '}${meta.description}`);
  log(`downloaded: ${files.length ? files.join(', ') : 'nothing'}`);
  log(`screenshot: ${shot.ok ? path.relative(dir, shot.path) : `skipped — ${shot.reason}`}`);
  if (suggestions.length) {
    log('theme hints (suggestions only — decide in reel.config.mjs yourself):');
    for (const s of suggestions) log(`  --accent: ${s.color};  /* from meta ${s.from} */`);
  }
  log(`sources.md: entry appended`);
  log(`claims.md:  ${claimsCreated ? 'skeleton created — fill it before synth' : 'exists — left untouched'}`);
  log('\nnext: classify the source (brand / article / paper / docs) and fill claims.md');
  log('      per references/url-to-source.md before scripting.');

  return { finalUrl: page.finalUrl, slug, meta, images: saved, screenshot: shot, suggestions, claimsCreated, files, projectDir: dir };
}

module.exports = {
  ingest, fetchPage, parsePage, collectImages, downloadImages,
  findChrome, screenshotPage, themeSuggestions, slugify, writeSources,
  ensureClaimsSkeleton, normalizeHex,
};
