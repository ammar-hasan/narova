'use strict';

/* Cross-platform system font discovery.
 *
 * The no-browser renderer registers authored fonts and shapes complex scripts
 * through FontKit, so tests and evals need a real font file without assuming a
 * specific distro. These candidates are the fonts most likely to be present on
 * Linux (DejaVu/Liberation), macOS (Verdana/Georgia), and Windows (Arial). */

const fs = require('fs');

const LATIN_FONT_CANDIDATES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/liberation/LiberationSans-Regular.ttf',
  '/System/Library/Fonts/Supplemental/Verdana.ttf',
  '/System/Library/Fonts/Supplemental/Georgia.ttf',
  '/System/Library/Fonts/Supplemental/Courier New.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\verdana.ttf',
];

function findLatinFont() {
  return LATIN_FONT_CANDIDATES.find(file => fs.existsSync(file)) || null;
}

module.exports = { findLatinFont, LATIN_FONT_CANDIDATES };
