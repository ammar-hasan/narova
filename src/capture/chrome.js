'use strict';
/* Locate a headless-capable Chrome/Chromium. Honors $CHROME. */
const fs = require('fs');

const MAC_DEFAULTS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
];
const LINUX_DEFAULTS = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

function detectChrome() {
  if (process.env.CHROME && fs.existsSync(process.env.CHROME)) return process.env.CHROME;
  const list = process.platform === 'darwin' ? MAC_DEFAULTS : LINUX_DEFAULTS;
  for (const p of list) if (fs.existsSync(p)) return p;
  return null;
}

module.exports = { detectChrome };
