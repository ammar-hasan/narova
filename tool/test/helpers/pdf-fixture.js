'use strict';
const fs = require('fs');

function pdfString(value) {
  return String(value).replace(/([\\()])/g, '\\$1').replace(/[\r\n]+/g, ' ');
}

/* Small deterministic PDFs for local-ingest tests. Page labels deliberately
 * differ from physical indices, and an optional document OpenAction remains
 * inert source content. */
function makePdf(pageTexts = ['Page one'], { openAction = false } = {}) {
  const objects = [];
  const add = body => { objects.push(body); return objects.length; };
  const catalog = add('');
  const pagesRoot = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageRefs = [];
  for (const text of pageTexts) {
    const stream = `BT /F1 20 Tf 30 150 Td (${pdfString(text)}) Tj ET`;
    const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    const page = add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
    pageRefs.push(page);
  }
  objects[pagesRoot - 1] = `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] >>`;
  const action = openAction
    ? ' /OpenAction << /S /JavaScript /JS (globalThis.__narovaPdfActionRan = true) >>'
    : '';
  // Printed labels begin at roman vii; physical pages remain 1..N.
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R /PageLabels << /Nums [0 << /S /r /St 7 >>] >>${action} >>`;

  let body = '%PDF-1.7\n%fixture\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

function writePdf(file, pageTexts, options) {
  fs.writeFileSync(file, makePdf(pageTexts, options));
  return file;
}

module.exports = { makePdf, writePdf };
