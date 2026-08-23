'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildGallery, renderGallery, validateEntry, loadPublicAssets } = require('../scripts/build-gallery');
const { inspectArchive } = require('../tool/src/project-archive');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'docs/explore/gallery.json');
const outputPath = path.join(root, 'docs/explore/index.html');
const index = () => JSON.parse(fs.readFileSync(indexPath, 'utf8'));

test('checked-in gallery projection is current and backed by verified archives', () => {
  const result = buildGallery({ root, check: true });
  assert.equal(result.entries, 7);
  assert.equal(result.assetCommit, loadPublicAssets(root).commit);
  for (const entry of index().entries) {
    const archive = inspectArchive(path.join(root, entry.archive));
    assert.equal(archive.sha256, entry.archiveSha256);
    assert.equal(archive.packer.version, entry.producingVersion);
    assert.equal(archive.format, 'narova.project/1');
  }
});

test('each static entry presents watch, inspect, then remix with accessible media', () => {
  const html = fs.readFileSync(outputPath, 'utf8');
  for (const entry of index().entries) {
    const article = html.match(new RegExp(`<article class="gallery-entry" id="${entry.id}">([\\s\\S]*?)</article>`))?.[1];
    assert.ok(article, `missing ${entry.id}`);
    const watch = article.indexOf('>Watch</h3>');
    const inspect = article.indexOf('>Inspect source</strong>');
    const remix = article.indexOf('>Remix</h3>');
    assert.ok(watch >= 0 && watch < inspect && inspect < remix, `${entry.id} affordance order`);
    assert.match(article, /<details class="gallery-step inspect">/);
    assert.doesNotMatch(article, /<details class="gallery-step inspect" open>/);
    assert.match(article, /<video controls preload="metadata" poster="[^"]+">/);
    assert.match(article, /<track kind="captions"[^>]* default>/);
    assert.match(article, /<h4 class="subhead">Scene &amp; narration inventory<\/h4>/);
    assert.match(article, /<h4 class="subhead">Authoring source<\/h4>/);
    assert.match(article, new RegExp(`narova remix [^<]*${entry.id}[^<]*\\.narova|narova remix ${path.basename(entry.archive).replace('.', '\\.')}`));
    assert.match(article, new RegExp(`href="https://raw\\.githubusercontent\\.com/ammar-hasan/narova-assets/[a-f0-9]{40}/explore/${entry.id}/${path.basename(entry.archive).replace('.', '\\.')}" download`));
    assert.match(article, new RegExp(`https://raw\\.githubusercontent\\.com/ammar-hasan/narova-assets/[a-f0-9]{40}/explore/${entry.id}/video\\.mp4`));
    assert.match(article, new RegExp(entry.archiveSha256));
  }
});

test('projection is static and carries no privacy-prohibited surface', () => {
  const html = fs.readFileSync(outputPath, 'utf8');
  assert.doesNotMatch(html, /<form\b|<input\b|fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|analytics|telemetry/i);
  assert.doesNotMatch(html, /gallery\.json|\.narova[^<]*(?:unpack|parse|eval)/i);
  assert.match(html, /browsers never unpack or execute project content/i);
  assert.match(html, /<script src="\.\.\/app\.js"><\/script>/);
  assert.match(fs.readFileSync(path.join(root, 'docs/app.js'), 'utf8'), /\[data-copy-command\]/);
  assert.match(html, /raw\.githubusercontent\.com\/ammar-hasan\/narova-assets\/[a-f0-9]{40}\/demos\/explore-share\/share\.png/);
  assert.match(html, /pinned Narova asset revision <code>[a-f0-9]{40}<\/code>/);
  assert.ok(fs.statSync(path.join(root, 'docs/explore/assets/narova-explore-share.png')).isFile());
});

test('public asset source is immutable, catalog-bound, and uses no moving branch', () => {
  const assets = loadPublicAssets(root);
  assert.equal(assets.repository, 'https://github.com/ammar-hasan/narova-assets');
  assert.match(assets.commit, /^[a-f0-9]{40}$/);
  assert.match(assets.catalogSha256, /^[a-f0-9]{64}$/);
  for (const group of [assets.explore, assets.demos]) {
    assert.doesNotMatch(JSON.stringify(group), /\/main\/|\/master\//);
  }
});

test('curation rejects missing release evidence, rights, and digest identity', () => {
  const original = index().entries[0];
  assert.throws(
    () => validateEntry(root, { ...original, releaseCheck: { status: 'fail', note: 'failed' } }, new Set()),
    /no passing release-check record/,
  );
  assert.throws(
    () => validateEntry(root, { ...original, rights: { ...original.rights, status: 'unknown' } }, new Set()),
    /lacks hosting-compatible declared rights/,
  );
  assert.throws(
    () => validateEntry(root, { ...original, accessibility: { status: 'fail', note: 'missing captions' } }, new Set()),
    /no passing accessibility record/,
  );
  assert.throws(
    () => validateEntry(root, { ...original, archiveSha256: '0'.repeat(64) }, new Set()),
    /archive (?:identity\/version does not match the pinned catalog|digest does not match)/,
  );
});

test('curation rejects archive basenames that are unsafe in the exact remix command', () => {
  const original = index().entries[0];
  for (const basename of ['unsafe archive.narova', 'unsafe;echo.narova', 'UPPER.narova']) {
    const archive = path.posix.join(path.posix.dirname(original.archive), basename);
    assert.throws(
      () => validateEntry(root, { ...original, archive }, new Set()),
      /archive basename must be a lowercase slug ending in \.narova/,
    );
  }
});

test('projection escapes curated text before writing static HTML', () => {
  const original = index().entries[0];
  const payload = '</h2><script>alert(1)</script>';
  const entry = validateEntry(root, { ...original, title: payload, summary: payload }, new Set());
  const html = renderGallery({ updated: '2026-08-20' }, [entry]);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('removing an entry produces a valid remaining static route', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-gallery-removal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const reduced = index();
  reduced.entries = reduced.entries.slice(0, 1);
  const reducedIndex = path.join(dir, 'gallery.json');
  const reducedOutput = path.join(dir, 'index.html');
  fs.writeFileSync(reducedIndex, `${JSON.stringify(reduced, null, 2)}\n`);
  const result = buildGallery({ root, indexPath: reducedIndex, outputPath: reducedOutput });
  assert.equal(result.entries, 1);
  const html = fs.readFileSync(reducedOutput, 'utf8');
  assert.match(html, new RegExp(`id="${reduced.entries[0].id}"`));
  assert.doesNotMatch(html, new RegExp(`id="${index().entries[1].id}"`));
  assert.match(html, /<\/html>\s*$/);
});
