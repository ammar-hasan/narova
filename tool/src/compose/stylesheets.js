'use strict';
const fs = require('fs');
const path = require('path');

// Each source is an independent stylesheet. Concatenation can invalidate a
// leading @import/@charset, or change layer order. Projected URLs already use
// the renderer root, including rebased selected library sources.
function authoredStylesheets(config) {
  const sheets = [];
  if (config.themeCss) sheets.push({ file: 'author-theme.css', contents: config.themeCss });
  (config.scenes || []).forEach((scene, index) => {
    if (scene._cssFileContents) sheets.push({ file: `author-scene-${index}.css`, contents: scene._cssFileContents });
  });
  Object.values(config.imports || {}).forEach((imported, index) => {
    if (imported?.contents && /\.css$/i.test(imported.file || '')) {
      sheets.push({ file: `author-import-${index}.css`, contents: imported.contents });
    }
  });
  return sheets;
}

function writeStylesheets(directory, css, sheets, fontCss) {
  fs.writeFileSync(path.join(directory, 'style.css'), css);
  for (const sheet of sheets) fs.writeFileSync(path.join(directory, sheet.file), sheet.contents);
  if (fontCss) fs.writeFileSync(path.join(directory, 'visual-fonts.css'), fontCss);
}

module.exports = { authoredStylesheets, writeStylesheets };
