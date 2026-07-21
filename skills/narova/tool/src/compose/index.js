'use strict';
/* narova compose: config + out/timings.json + out/audio/full.wav -> out/hf/,
 * a self-contained HyperFrames project (index.html + project assets +
 * narration.wav + package.json). Regenerated from scratch every run — the
 * config, theme, and project assets are source; out/hf is never hand-edited. */
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('../util');
const { HYPERFRAMES_VERSION } = require('../hf');
const { composeData } = require('./data');
const { composeCss } = require('./css');
const { composeDoc } = require('./html');

function compose(config, outDir) {
  const timingsPath = path.join(outDir, 'timings.json');
  const fullWav = path.join(outDir, 'audio', 'full.wav');
  if (!fs.existsSync(timingsPath) || !fs.existsSync(fullWav)) {
    throw new Error('compose needs out/timings.json and out/audio/full.wav — run `narova synth` first');
  }
  const timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));

  const size = config.size;
  const data = composeData(config, timings);
  const css = composeCss(config.theme || {}, config.voices, size, config.themeCss || '', config.mode);
  const html = composeDoc(config, size, data, css);

  const hfDir = path.join(outDir, 'hf');
  // A clean rebuild matters for assets: deleting logo.svg from the source must
  // not leave a stale copy in the render project.
  fs.rmSync(hfDir, { recursive: true, force: true });
  ensureDir(hfDir);
  const assetsDir = ensureDir(path.join(hfDir, 'assets'));
  if (config.assetsDir) fs.cpSync(config.assetsDir, assetsDir, { recursive: true });
  fs.writeFileSync(path.join(hfDir, 'index.html'), html);
  fs.copyFileSync(fullWav, path.join(assetsDir, 'narration.wav'));
  fs.writeFileSync(path.join(hfDir, 'package.json'), JSON.stringify({
    name: slug(config.title || 'narova'),
    private: true,
    devDependencies: { hyperframes: HYPERFRAMES_VERSION },
  }, null, 2) + '\n');

  return { dir: hfDir, total: data.total, scenes: data.scenes.length };
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'narova';
}

module.exports = { compose };
