'use strict';
/* Explicit, bounded local-PDF page evidence for `narova ingest`.
 *
 * This module receives local bytes only. It renders caller-selected physical
 * pages sequentially, extracts literal embedded text when present, and commits
 * the resulting files with their asset records. It never follows links,
 * enables PDF scripting, performs OCR, or interprets page content. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { ensureDir } = require('./util');
const {
  readAssetLock, registerAssets, resolveProjectFile, withAssetMutation,
} = require('./asset-registry');

const PDFJS_VERSION = '4.8.69';
const CANVAS_VERSION = '1.0.3';
const PDF_PARSER = `pdfjs-dist@${PDFJS_VERSION}`;
const PDF_RENDERER = `pdfjs-dist@${PDFJS_VERSION} + @napi-rs/canvas@${CANVAS_VERSION}`;
const PDF_SCALE = 2; // two output pixels per PDF point = 144 pixels/inch
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const MAX_SELECTED_PAGES = 24;
const MAX_PAGE_PIXELS = 16_000_000;
const MAX_STAGED_BYTES = 256 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function pdfSlug(sourceBasename) {
  const stem = path.basename(sourceBasename, path.extname(sourceBasename));
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'pdf';
}

function displayText(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, character => (
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  ));
}

function parsePageSelection(value, { maxPages = MAX_SELECTED_PAGES } = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('local PDF ingest requires --pages <1,3-5> using one-based physical page indices');
  }
  const pages = [];
  const seen = new Set();
  for (const rawPart of value.split(',')) {
    const part = rawPart.trim();
    let first;
    let last;
    if (/^\d+$/.test(part)) {
      first = Number(part);
      last = first;
    } else {
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (!range) throw new Error(`invalid physical PDF page selection ${JSON.stringify(part)} — use indices/ranges like 1,3-5`);
      first = Number(range[1]);
      last = Number(range[2]);
    }
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < 1) {
      throw new Error(`physical PDF page indices must be positive integers, got ${JSON.stringify(part)}`);
    }
    if (last < first) throw new Error(`physical PDF page range must be ascending, got ${JSON.stringify(part)}`);
    for (let page = first; page <= last; page++) {
      if (seen.has(page)) throw new Error(`physical PDF page ${page} is selected more than once`);
      seen.add(page);
      pages.push(page);
      if (pages.length > maxPages) throw new Error(`local PDF ingest selects more than ${maxPages} pages in one invocation`);
    }
  }
  return pages;
}

function validatePdfSource(source, { maxSourceBytes = MAX_SOURCE_BYTES } = {}) {
  const absolute = path.resolve(source);
  let stat;
  try { stat = fs.lstatSync(absolute); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`local PDF source not found: ${path.basename(absolute)}`);
    throw error;
  }
  if (!stat.isFile()) throw new Error(`local PDF source must be a regular file, not a symlink or directory: ${path.basename(absolute)}`);
  if (stat.size > maxSourceBytes) {
    throw new Error(`local PDF source is ${stat.size} bytes; maximum is ${maxSourceBytes} bytes`);
  }
  const bytes = fs.readFileSync(absolute);
  if (bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`local source is not a PDF (missing leading %PDF- signature): ${path.basename(absolute)}`);
  }
  return {
    absolute,
    basename: path.basename(absolute),
    bytes,
    byteCount: bytes.length,
    sha256: sha256(bytes),
  };
}

async function loadPdfRuntime() {
  let canvas;
  let packageRoot;
  let pdfjs;
  try {
    canvas = require('@napi-rs/canvas');
    packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    pdfjs = await import(pathToFileURL(path.join(packageRoot, 'legacy', 'build', 'pdf.mjs')).href);
  } catch (error) {
    const failure = new Error('local PDF ingest renderer is unavailable — reinstall Narova with optional dependencies enabled');
    failure.cause = error;
    throw failure;
  }
  if (pdfjs.version !== PDFJS_VERSION) {
    throw new Error(`local PDF ingest requires ${PDF_PARSER}, found pdfjs-dist@${pdfjs.version || 'unknown'}`);
  }
  return { canvas, packageRoot, pdfjs };
}

function makeCanvasFactory(createCanvas) {
  return class LocalCanvasFactory {
    create(width, height) {
      if (!(width > 0 && height > 0)) throw new Error('PDF canvas dimensions must be positive');
      const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
      return { canvas, context: canvas.getContext('2d') };
    }
    reset(target, width, height) {
      if (!target || !(width > 0 && height > 0)) throw new Error('PDF canvas reset requires a target and positive dimensions');
      target.canvas.width = Math.ceil(width);
      target.canvas.height = Math.ceil(height);
    }
    destroy(target) {
      if (!target) return;
      target.canvas.width = 0;
      target.canvas.height = 0;
      target.canvas = null;
      target.context = null;
    }
  };
}

function literalText(textContent) {
  let text = '';
  for (const item of textContent.items || []) {
    if (!item || typeof item.str !== 'string' || !item.str) continue;
    if (text && !text.endsWith('\n')) text += ' ';
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.replace(/\r\n?/g, '\n')
    .split('\n').map(line => line.replace(/[\t ]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

async function validatePng(buffer, width, height, loadImage) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('local PDF renderer produced an invalid PNG signature');
  }
  const encodedWidth = buffer.readUInt32BE(16);
  const encodedHeight = buffer.readUInt32BE(20);
  if (encodedWidth !== width || encodedHeight !== height) {
    throw new Error(`local PDF renderer produced PNG ${encodedWidth}x${encodedHeight}; expected ${width}x${height}`);
  }
  const decoded = await loadImage(buffer);
  if (decoded.width !== width || decoded.height !== height) {
    throw new Error(`local PDF renderer produced an undecodable or dimension-mismatched PNG`);
  }
}

function collisionSafePath(destination) {
  if (!fs.existsSync(destination)) return destination;
  const ext = path.extname(destination);
  const stem = destination.slice(0, -ext.length);
  let attempt = destination;
  for (let n = 2; fs.existsSync(attempt); n++) attempt = `${stem}-${n}${ext}`;
  return attempt;
}

function writePdfSource(dir, entry) {
  const file = path.join(dir, 'sources.md');
  if (!fs.existsSync(file)) fs.writeFileSync(file, '# Sources\n\nIngested source material.\n');
  const basename = String(entry.sourceBasename);
  const lines = [
    '',
    `## ${entry.ingestedAt.slice(0, 10)} — local PDF ${JSON.stringify(basename)}`,
    '',
    `- source basename: ${JSON.stringify(basename)}`,
    `- source bytes: ${entry.sourceBytes}`,
    `- source SHA-256: \`${entry.sourceSha256}\``,
    `- document physical pages: ${entry.documentPageCount}`,
    `- selected physical pages: ${entry.selectedPages.join(', ')}`,
    `- parser: ${entry.parser}`,
    `- renderer: ${entry.renderer}`,
    '- page text: literal embedded text only; no OCR, reading-order proof, or source interpretation',
  ];
  for (const page of entry.pages) {
    lines.push('', `### Physical page ${page.physicalPage}`, '');
    lines.push(`- PNG: \`${page.image.path}\` (${page.image.bytes} bytes; SHA-256 \`${page.image.sha256}\`)`);
    if (page.text.availability === 'available') {
      lines.push(`- embedded text: available — \`${page.text.path}\` (${page.text.bytes} bytes; SHA-256 \`${page.text.sha256}\`)`);
    } else {
      lines.push('- embedded text: unavailable');
    }
  }
  fs.appendFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

async function ingestPdf(source, pageSelection, opts = {}) {
  const {
    projectDir = '.', log = console.log,
    maxSourceBytes = MAX_SOURCE_BYTES, maxSelectedPages = MAX_SELECTED_PAGES,
    maxPagePixels = MAX_PAGE_PIXELS, maxStagedBytes = MAX_STAGED_BYTES,
    maxTextBytes = MAX_TEXT_BYTES,
  } = opts;
  const dir = path.resolve(projectDir);

  // Validate project mutation boundaries before reading or parsing the PDF.
  readAssetLock(dir);
  const boundary = resolveProjectFile(dir, path.join('assets', '.narova-ingest-boundary'), { mustExist: false });
  const pages = parsePageSelection(pageSelection, { maxPages: maxSelectedPages });
  const sourceInfo = validatePdfSource(source, { maxSourceBytes });
  const assetsDir = ensureDir(path.dirname(boundary.absolute));
  const stagingDir = fs.mkdtempSync(path.join(assetsDir, '.pdf-ingest-'));
  const staged = [];
  let stagedBytes = 0;
  let textBytes = 0;
  let loadingTask;
  let document;

  try {
    const runtime = opts.runtime || await loadPdfRuntime();
    const CanvasFactory = makeCanvasFactory(runtime.canvas.createCanvas);
    const resource = name => `${path.join(runtime.packageRoot, name)}${path.sep}`;
    loadingTask = runtime.pdfjs.getDocument({
      data: new Uint8Array(sourceInfo.bytes),
      disableWorker: true,
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
      enableXfa: false,
      isEvalSupported: false,
      useSystemFonts: false,
      useWorkerFetch: false,
      cMapPacked: true,
      cMapUrl: resource('cmaps'),
      standardFontDataUrl: resource('standard_fonts'),
      CanvasFactory,
      verbosity: 0,
    });
    try { document = await loadingTask.promise; }
    catch (error) {
      if (/password|encrypted/i.test(`${error && error.name} ${error && error.message}`)) {
        throw new Error(`local PDF is encrypted or requires a password; password input is not supported`);
      }
      throw new Error(`local PDF could not be parsed: ${error && error.message ? error.message : error}`);
    }
    for (const pageNumber of pages) {
      if (pageNumber > document.numPages) {
        throw new Error(`physical PDF page ${pageNumber} is outside document page count ${document.numPages}`);
      }
    }

    const slug = pdfSlug(sourceInfo.basename);
    const digits = Math.max(4, String(document.numPages).length);
    for (const pageNumber of pages) {
      const page = await document.getPage(pageNumber);
      let target;
      try {
        const viewport = page.getViewport({ scale: PDF_SCALE });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        const pixels = width * height;
        if (!Number.isSafeInteger(pixels) || pixels > maxPagePixels) {
          throw new Error(`physical PDF page ${pageNumber} renders to ${width}x${height} (${pixels} pixels); maximum is ${maxPagePixels}`);
        }
        const factory = new CanvasFactory();
        target = factory.create(width, height);
        target.context.save();
        target.context.fillStyle = '#ffffff';
        target.context.fillRect(0, 0, width, height);
        target.context.restore();
        await page.render({
          canvasContext: target.context,
          viewport,
          canvasFactory: factory,
          background: '#ffffff',
        }).promise;
        const png = target.canvas.toBuffer('image/png');
        await validatePng(png, width, height, runtime.canvas.loadImage);

        const textContent = await page.getTextContent({ disableNormalization: false });
        const text = literalText(textContent);
        const textBuffer = text ? Buffer.from(`${text}\n`, 'utf8') : null;
        if (textBuffer) {
          textBytes += textBuffer.length;
          if (textBytes > maxTextBytes) {
            throw new Error(`local PDF extracted text exceeds ${maxTextBytes} UTF-8 bytes`);
          }
        }
        stagedBytes += png.length + (textBuffer ? textBuffer.length : 0);
        if (stagedBytes > maxStagedBytes) {
          throw new Error(`local PDF staged output exceeds ${maxStagedBytes} bytes`);
        }

        const pageId = String(pageNumber).padStart(digits, '0');
        const imagePath = path.join(stagingDir, `${slug}-physical-page-${pageId}.png`);
        fs.writeFileSync(imagePath, png, { flag: 'wx' });
        let textPath = null;
        if (textBuffer) {
          textPath = path.join(stagingDir, `${slug}-physical-page-${pageId}.txt`);
          fs.writeFileSync(textPath, textBuffer, { flag: 'wx' });
        }
        staged.push({
          physicalPage: pageNumber,
          width,
          height,
          image: { stagedPath: imagePath, bytes: png.length, sha256: sha256(png) },
          text: textBuffer
            ? { availability: 'available', stagedPath: textPath, bytes: textBuffer.length, sha256: sha256(textBuffer) }
            : { availability: 'unavailable' },
        });
      } finally {
        if (target) {
          target.canvas.width = 0;
          target.canvas.height = 0;
          target.canvas = null;
          target.context = null;
        }
        if (typeof page.cleanup === 'function') page.cleanup();
      }
    }

    const ingestedAt = new Date().toISOString();
    const publications = [];
    let committed = false;
    try {
      withAssetMutation(dir, () => {
        try {
          readAssetLock(dir);
          resolveProjectFile(dir, path.join('assets', '.narova-ingest-boundary'), { mustExist: false });
          for (const page of staged) {
            for (const output of [page.image, ...(page.text.availability === 'available' ? [page.text] : [])]) {
              const destination = collisionSafePath(path.join(assetsDir, path.basename(output.stagedPath)));
              if (fs.existsSync(destination) && !fs.statSync(destination).isFile()) {
                throw new Error(`local PDF ingest destination is not a file: ${path.relative(dir, destination)}`);
              }
              fs.renameSync(output.stagedPath, destination);
              output.path = path.relative(dir, destination).split(path.sep).join('/');
              publications.push(destination);
            }
          }
          const registrations = [];
          for (const page of staged) {
            const pdfOrigin = {
              sourceBasename: sourceInfo.basename,
              sourceSha256: sourceInfo.sha256,
              sourceBytes: sourceInfo.byteCount,
              documentPageCount: document.numPages,
              physicalPage: page.physicalPage,
              parser: PDF_PARSER,
              renderer: PDF_RENDERER,
              textAvailability: page.text.availability,
            };
            registrations.push({
              file: page.image.path,
              contentType: 'image/png',
              origin: { mode: 'local-pdf', pdf: pdfOrigin },
              acquiredAt: ingestedAt,
            });
            if (page.text.availability === 'available') {
              registrations.push({
                file: page.text.path,
                contentType: 'text/plain; charset=utf-8',
                origin: { mode: 'local-pdf', pdf: pdfOrigin },
                acquiredAt: ingestedAt,
              });
            }
          }
          (opts.registerAssets || registerAssets)(dir, registrations, { lockHeld: true });
          committed = true;
        } catch (error) {
          for (const file of publications.reverse()) fs.rmSync(file, { force: true });
          publications.length = 0;
          throw error;
        }
      });

      const ledgerEntry = {
        ingestedAt,
        sourceBasename: sourceInfo.basename,
        sourceBytes: sourceInfo.byteCount,
        sourceSha256: sourceInfo.sha256,
        documentPageCount: document.numPages,
        selectedPages: pages,
        parser: PDF_PARSER,
        renderer: PDF_RENDERER,
        pages: staged.map(page => ({
          physicalPage: page.physicalPage,
          image: { path: page.image.path, bytes: page.image.bytes, sha256: page.image.sha256 },
          text: page.text.availability === 'available'
            ? { availability: 'available', path: page.text.path, bytes: page.text.bytes, sha256: page.text.sha256 }
            : { availability: 'unavailable' },
        })),
      };
      (opts.writeSource || writePdfSource)(dir, ledgerEntry);
      const claimsCreated = opts.ensureClaimsSkeleton
        ? opts.ensureClaimsSkeleton(dir, `local PDF ${sourceInfo.basename} (SHA-256 ${sourceInfo.sha256})`)
        : false;

      const files = publications.map(file => path.relative(dir, file).split(path.sep).join('/'));
      log(`narova ingest local PDF ${displayText(sourceInfo.basename)}`);
      log(`physical pages: ${pages.join(', ')} of ${document.numPages}`);
      for (const page of ledgerEntry.pages) {
        log(`  page ${page.physicalPage}: ${page.image.path}; embedded text ${page.text.availability}`);
      }
      log('page evidence is mechanical; inspect the PNGs and author claims yourself');
      return {
        kind: 'local-pdf',
        sourceBasename: sourceInfo.basename,
        sourceBytes: sourceInfo.byteCount,
        sourceSha256: sourceInfo.sha256,
        documentPageCount: document.numPages,
        selectedPages: pages,
        parser: PDF_PARSER,
        renderer: PDF_RENDERER,
        pages: ledgerEntry.pages,
        files,
        claimsCreated,
        projectDir: dir,
      };
    } catch (error) {
      // Source/claims ledger failures are explicitly allowed to occur after the
      // files and registry have committed. Earlier failures roll back above.
      if (!committed) {
        for (const file of publications.reverse()) fs.rmSync(file, { force: true });
      }
      throw error;
    }
  } finally {
    if (document) {
      try { await document.destroy(); } catch {}
    } else if (loadingTask) {
      try { await loadingTask.destroy(); } catch {}
    }
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

module.exports = {
  ingestPdf,
  parsePageSelection,
  validatePdfSource,
  literalText,
  writePdfSource,
  loadPdfRuntime,
  PDF_PARSER,
  PDF_RENDERER,
  PDF_SCALE,
  MAX_SOURCE_BYTES,
  MAX_SELECTED_PAGES,
  MAX_PAGE_PIXELS,
  MAX_STAGED_BYTES,
  MAX_TEXT_BYTES,
};
