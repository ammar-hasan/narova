'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ingestPdf, literalText, parsePageSelection, validatePdfSource,
  writePdfSource, MAX_SELECTED_PAGES,
} = require('../src/pdf-ingest');
const { readAssetLock } = require('../src/asset-registry');
const { writePdf } = require('./helpers/pdf-fixture');

const ENCRYPTED_PDF = Buffer.from(
  'JVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDBkYjYxOTk5NDA+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9UeXBlIC9QYWdlCi9SZXNvdXJjZXMgPDwKPj4KL01lZGlhQm94IFsgMC4wIDAuMCAzMDAgMjAwIF0KL1BhcmVudCAyIDAgUgo+PgplbmRvYmoKNSAwIG9iago8PAovViAyCi9SIDMKL0xlbmd0aCAxMjgKL1AgNDI5NDk2NzI5MgovRmlsdGVyIC9TdGFuZGFyZAovTyA8MGU1MjI5MjVhM2U0ZTg3NGMzY2ZhY2JlZjUxMWE3M2FjNGVjMmJkODY1ZGNkM2Q0NjI3NjE0OTE3YWJmZDdlND4KL1UgPDg3Yjg4ODIxYmFiNzk4NGM2MjY2ZmZkMzgwNzliMDIxMjhiZjRlNWU0ZTc1OGE0MTY0MDA0ZTU2ZmZmYTAxMDg+Cj4+CmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA1OSAwMDAwMCBuIAowMDAwMDAwMTE4IDAwMDAwIG4gCjAwMDAwMDAxNjcgMDAwMDAgbiAKMDAwMDAwMDI2MSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDYKL1Jvb3QgMyAwIFIKL0luZm8gMSAwIFIKL0lEIFsgPDMzMzYzMDY0MzAzNzM0NjUzMjM3MzYzMDMzMzEzMTM2MzA2MzYzMzU2MTYxNjEzMDM3NjQ2NTM3MzQzNzYyNjM2NT4gPDMzMzYzMDY0MzAzNzM0NjUzMjM3MzYzMDMzMzEzMTM2MzA2MzYzMzU2MTYxNjEzMDM3NjQ2NTM3MzQzNzYyNjM2NT4gXQovRW5jcnlwdCA1IDAgUgo+PgpzdGFydHhyZWYKNDU5CiUlRU9GCg==',
  'base64',
);

const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

test('physical page selections preserve expanded order and reject ambiguity', () => {
  assert.deepEqual(parsePageSelection('3, 1-2, 5'), [3, 1, 2, 5]);
  for (const bad of ['', '0', '-1', '1.5', '3-1', '1,1', '1-2,2', 'x']) {
    assert.throws(() => parsePageSelection(bad), /physical|requires --pages|invalid/);
  }
  assert.throws(() => parsePageSelection(`1-${MAX_SELECTED_PAGES + 1}`), /more than 24 pages/);
});

test('source validation requires a bounded regular file and leading PDF signature', () => {
  const root = tmp('narova-pdf-source-');
  const valid = writePdf(path.join(root, 'book.bin'), ['one']);
  assert.equal(validatePdfSource(valid).basename, 'book.bin', 'signature permits an explicitly supplied non-.pdf filename');
  const junk = path.join(root, 'junk.pdf');
  fs.writeFileSync(junk, 'not pdf');
  assert.throws(() => validatePdfSource(junk), /missing leading %PDF-/);
  assert.throws(() => validatePdfSource(valid, { maxSourceBytes: 4 }), /maximum is 4 bytes/);
  assert.throws(() => validatePdfSource(root), /regular file/);
  if (process.platform !== 'win32') {
    const link = path.join(root, 'link.pdf');
    fs.symlinkSync(valid, link);
    assert.throws(() => validatePdfSource(link), /regular file.*symlink/);
  }
});

test('literal text preserves mixed-script strings with only whitespace normalization', () => {
  const text = literalText({ items: [
    { str: 'English', hasEOL: false },
    { str: 'اُردُو', hasEOL: true },
    { str: 'العَرَبِيَّة', hasEOL: false },
  ] });
  assert.equal(text, 'English اُردُو\nالعَرَبِيَّة');
});

test('source ledger renders a machine-local basename as inert text', () => {
  const project = tmp('narova-pdf-ledger-name-');
  writePdfSource(project, {
    ingestedAt: '2026-08-29T00:00:00.000Z',
    sourceBasename: 'source-\u001b[31m-`name`.pdf',
    sourceBytes: 10,
    sourceSha256: 'a'.repeat(64),
    documentPageCount: 1,
    selectedPages: [1],
    parser: 'parser',
    renderer: 'renderer',
    pages: [{
      physicalPage: 1,
      image: { path: 'assets/page.png', bytes: 1, sha256: 'b'.repeat(64) },
      text: { availability: 'unavailable' },
    }],
  });
  const ledger = fs.readFileSync(path.join(project, 'sources.md'), 'utf8');
  assert.equal(ledger.includes('\u001b'), false);
  assert.match(ledger, /source-\\u001b\[31m-`name`\.pdf/);
  assert.match(ledger, /source basename: "source-/);
});

(process.platform === 'win32' ? test.skip : test)('local PDF ingest validates the project asset boundary before source parsing', async () => {
  const project = tmp('narova-pdf-boundary-');
  const outside = tmp('narova-pdf-outside-');
  fs.symlinkSync(outside, path.join(project, 'assets'), 'dir');
  await assert.rejects(ingestPdf(path.join(project, 'missing.pdf'), '1', {
    projectDir: project,
    log: () => {},
  }), /assets|escape|symlink/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('local PDF ingest renders selected physical pages without actions or network', async () => {
  const project = tmp('narova-pdf-project-');
  const sourceRoot = tmp('narova-pdf-source-');
  const source = writePdf(path.join(sourceRoot, 'Manual.pdf'), ['Printed vii', 'Printed viii'], { openAction: true });
  const before = fs.readFileSync(source);
  fs.writeFileSync(path.join(project, 'CLAIMS.md'), '# Existing claims\n');
  const previousFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('network forbidden'); };
  delete globalThis.__narovaPdfActionRan;
  try {
    const result = await ingestPdf(source, '2,1', {
      projectDir: project,
      log: () => {},
      ensureClaimsSkeleton: dir => {
        assert.ok(fs.existsSync(path.join(dir, 'CLAIMS.md')));
        return false;
      },
    });
    assert.equal(result.kind, 'local-pdf');
    assert.equal(result.sourceBasename, 'Manual.pdf');
    assert.deepEqual(result.selectedPages, [2, 1]);
    assert.equal(result.documentPageCount, 2);
    assert.equal(networkCalls, 0);
    assert.equal(globalThis.__narovaPdfActionRan, undefined);
    assert.deepEqual(fs.readFileSync(source), before, 'source PDF remains byte-unchanged');
    assert.equal(fs.readFileSync(path.join(project, 'CLAIMS.md'), 'utf8'), '# Existing claims\n');
    assert.equal(fs.readdirSync(project).includes('claims.md'), false);

    assert.equal(result.pages.length, 2);
    for (const page of result.pages) {
      assert.equal(page.image.bytes > 0, true);
      assert.match(page.image.sha256, /^[a-f0-9]{64}$/);
      assert.equal(page.text.availability, 'available');
      assert.ok(fs.existsSync(path.join(project, page.image.path)));
      assert.ok(fs.existsSync(path.join(project, page.text.path)));
      const png = fs.readFileSync(path.join(project, page.image.path));
      assert.equal(png.readUInt32BE(16), 600);
      assert.equal(png.readUInt32BE(20), 400);
    }
    assert.match(fs.readFileSync(path.join(project, result.pages[0].text.path), 'utf8'), /Printed viii/);

    const sources = fs.readFileSync(path.join(project, 'sources.md'), 'utf8');
    assert.match(sources, /selected physical pages: 2, 1/);
    assert.doesNotMatch(sources, /roman|vii[^i]|absolute|narova-pdf-source-/i,
      'ledger records physical indices and basename, not printed labels or source path');
    assert.doesNotMatch(sources, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const lock = JSON.parse(fs.readFileSync(path.join(project, 'assets.lock.json'), 'utf8'));
    assert.equal(lock.assets.length, 4);
    for (const asset of lock.assets) {
      assert.equal(asset.origin.mode, 'local-pdf');
      assert.equal(asset.origin.pdf.sourceBasename, 'Manual.pdf');
      assert.equal(asset.origin.pdf.sourceSha256, digest(before));
      assert.equal(asset.origin.pdf.documentPageCount, 2);
      assert.ok([1, 2].includes(asset.origin.pdf.physicalPage));
      assert.match(asset.origin.pdf.parser, /^pdfjs-dist@4\.8\.69$/);
      assert.doesNotMatch(JSON.stringify(asset), new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    const malformed = structuredClone(lock);
    delete malformed.assets[0].origin.pdf.sourceSha256;
    fs.writeFileSync(path.join(project, 'assets.lock.json'), JSON.stringify(malformed));
    assert.throws(() => readAssetLock(project), /sourceSha256 must be a lowercase SHA-256 digest/);
  } finally {
    globalThis.fetch = previousFetch;
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  }
});

test('a valid image-only page publishes with explicit unavailable text and no OCR fallback', async () => {
  const project = tmp('narova-pdf-empty-');
  const source = writePdf(path.join(project, 'blank.pdf'), ['']);
  const result = await ingestPdf(source, '1', {
    projectDir: project, log: () => {}, ensureClaimsSkeleton: () => false,
  });
  assert.equal(result.pages[0].text.availability, 'unavailable');
  assert.equal(result.files.length, 1);
  assert.match(result.files[0], /\.png$/);
  assert.equal(fs.readdirSync(path.join(project, 'assets')).some(file => file.endsWith('.txt')), false);
});

test('repeated local PDF ingest is collision-safe and never overwrites page evidence', async () => {
  const project = tmp('narova-pdf-collision-');
  const source = writePdf(path.join(project, 'same.pdf'), ['same']);
  const options = { projectDir: project, log: () => {}, ensureClaimsSkeleton: () => false };
  const first = await ingestPdf(source, '1', options);
  const firstBytes = fs.readFileSync(path.join(project, first.pages[0].image.path));
  const second = await ingestPdf(source, '1', options);
  assert.notEqual(second.pages[0].image.path, first.pages[0].image.path);
  assert.match(second.pages[0].image.path, /-2\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(project, first.pages[0].image.path)), firstBytes);
});

test('malformed, encrypted, out-of-range, and bounded-resource failures publish nothing', async () => {
  const cases = [
    { name: 'malformed', bytes: Buffer.from('%PDF-1.7\nnot a document'), pages: '1', match: /could not be parsed/ },
    { name: 'encrypted', bytes: ENCRYPTED_PDF, pages: '1', match: /encrypted or requires a password/ },
  ];
  for (const fixture of cases) {
    const project = tmp(`narova-pdf-${fixture.name}-`);
    const source = path.join(project, `${fixture.name}.pdf`);
    fs.writeFileSync(source, fixture.bytes);
    await assert.rejects(ingestPdf(source, fixture.pages, { projectDir: project, log: () => {} }), fixture.match);
    assert.equal(fs.existsSync(path.join(project, 'assets.lock.json')), false);
    assert.equal(fs.readdirSync(path.join(project, 'assets')).some(file => /\.(png|txt)$/.test(file)), false);
  }

  const sourceRoot = tmp('narova-pdf-bounds-source-');
  const source = writePdf(path.join(sourceRoot, 'bounds.pdf'), ['enough text', 'two']);
  const bounds = [
    { pages: '3', options: {}, match: /outside document page count 2/ },
    { pages: '1', options: { maxPagePixels: 1 }, match: /maximum is 1/ },
    { pages: '1', options: { maxStagedBytes: 1 }, match: /staged output exceeds 1 bytes/ },
    { pages: '1', options: { maxTextBytes: 1 }, match: /extracted text exceeds 1 UTF-8 bytes/ },
  ];
  for (const [index, fixture] of bounds.entries()) {
    const project = tmp(`narova-pdf-bound-${index}-`);
    await assert.rejects(ingestPdf(source, fixture.pages, {
      projectDir: project, log: () => {}, ...fixture.options,
    }), fixture.match);
    assert.equal(fs.existsSync(path.join(project, 'assets.lock.json')), false);
    assert.equal(fs.readdirSync(path.join(project, 'assets')).some(file => /\.(png|txt)$/.test(file)), false);
  }
  fs.rmSync(sourceRoot, { recursive: true, force: true });
});

test('asset-registry failure rolls back every published PDF output', async () => {
  const project = tmp('narova-pdf-rollback-');
  const source = writePdf(path.join(project, 'rollback.pdf'), ['rollback']);
  await assert.rejects(ingestPdf(source, '1', {
    projectDir: project,
    log: () => {},
    registerAssets: () => { throw new Error('registry unavailable'); },
  }), /registry unavailable/);
  assert.equal(fs.existsSync(path.join(project, 'assets.lock.json')), false);
  assert.equal(fs.readdirSync(path.join(project, 'assets')).some(file => /\.(png|txt)$/.test(file)), false);
});

test('a later source-ledger failure may leave the already committed files and registry', async () => {
  const project = tmp('narova-pdf-ledger-fail-');
  const source = writePdf(path.join(project, 'ledger.pdf'), ['ledger']);
  await assert.rejects(ingestPdf(source, '1', {
    projectDir: project,
    log: () => {},
    writeSource: () => { throw new Error('sources ledger unavailable'); },
  }), /sources ledger unavailable/);
  assert.ok(fs.existsSync(path.join(project, 'assets.lock.json')));
  assert.equal(fs.readdirSync(path.join(project, 'assets')).some(file => file.endsWith('.png')), true);
});
