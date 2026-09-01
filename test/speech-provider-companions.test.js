'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('Xiaomi MiMo ships in the narova-xiaomi speech-provider companion', () => {
  const mimo = JSON.parse(read('skills/narova-xiaomi/tool/provider.json'));
  assert.equal(mimo.name, 'mimo');
  assert.equal(mimo.protocol, 'narova-tts-provider/v1');
  assert.equal(mimo.capabilities.synthesis, true);
  assert.equal(mimo.capabilities.voiceListing, true);
  assert.deepEqual(mimo.requiredEnvironment, ['MIMO_API_KEY']);
  const skill = read('skills/narova-xiaomi/SKILL.md');
  assert.match(skill, /^name: narova-xiaomi$/m);
  assert.match(skill, /license: Apache-2.0/);
  assert.match(skill, /checksum: [0-9a-f]{64}/);
});

test('public discovery names the independently installable MiMo companion', () => {
  const surfaces = [read('README.md'), read('docs/index.html'), read('skills/narova/SKILL.md')].join('\n');
  assert.match(surfaces, /--skill narova-xiaomi -g/);
  assert.match(surfaces, /narova-tts-provider\/v1/);
});
