'use strict';
/* render stage: resolved config -> out/player.html, out/record.html,
 * out/narration.json, out/config.resolved.json. Tokens remain unfilled; the
 * inject step fills them after synth. */
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('../util');
const { narration } = require('./schema');
const { playerDoc, recordDoc } = require('./player');

function render(config, outDir) {
  ensureDir(outDir);
  const size = config.size;

  const player = playerDoc(config, size);
  const record = recordDoc(config, size);

  fs.writeFileSync(path.join(outDir, 'player.html'), player);
  fs.writeFileSync(path.join(outDir, 'record.html'), record);
  fs.writeFileSync(path.join(outDir, 'narration.json'), JSON.stringify(narration(config), null, 2));
  fs.writeFileSync(path.join(outDir, 'config.resolved.json'), JSON.stringify(config, null, 2));

  return {
    player: path.join(outDir, 'player.html'),
    record: path.join(outDir, 'record.html'),
    narration: path.join(outDir, 'narration.json'),
    config: path.join(outDir, 'config.resolved.json'),
    scenes: config.scenes.length,
  };
}

module.exports = { render };
