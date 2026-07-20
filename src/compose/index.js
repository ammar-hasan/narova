'use strict';
/* narova compose: config + out/timings.json + out/audio/full.wav -> out/hf/,
 * a self-contained HyperFrames project (index.html + assets/narration.wav +
 * package.json). Regenerated from scratch every run — reel.config is the
 * single source of truth; out/hf is a build artifact, never hand-edited. */
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
  const css = composeCss(config.theme || {}, config.voices, size, config.themeCss || '');
  const html = composeDoc(config, size, data, css);

  const hfDir = ensureDir(path.join(outDir, 'hf'));
  ensureDir(path.join(hfDir, 'assets'));
  fs.writeFileSync(path.join(hfDir, 'index.html'), html);
  fs.copyFileSync(fullWav, path.join(hfDir, 'assets', 'narration.wav'));
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
