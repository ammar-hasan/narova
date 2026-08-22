'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('Sora and Runway ship as external video-provider companions', () => {
  const sora = JSON.parse(read('skills/narova-openai/tool/video-provider.json'));
  const runway = JSON.parse(read('skills/narova-runway/tool/provider.json'));
  const veo = JSON.parse(read('skills/narova-google/tool/video-provider.json'));
  assert.deepEqual([sora.name, runway.name, veo.name], ['sora', 'runway', 'veo']);
  for (const provider of [sora, runway, veo]) {
    assert.equal(provider.protocol, 'narova-video-provider/v1');
    assert.equal(provider.capabilities.generation, true);
    assert.ok(provider.command.length >= 2);
    assert.equal(provider.requiredEnvironment.length, 1);
  }
});

test('public discovery names both independently installable video companions', () => {
  const surfaces = [read('README.md'), read('docs/index.html'), read('skills/narova/SKILL.md')].join('\n');
  assert.match(surfaces, /--skill narova-openai -g/);
  assert.match(surfaces, /--skill narova-runway -g/);
  assert.match(surfaces, /--skill narova-google -g/);
  assert.match(surfaces, /narova-video-provider\/v1/);
});

test('Google companion registers speech and video workers independently', () => {
  const google = JSON.parse(read('skills/narova-google/tool/provider.json'));
  assert.equal(google.name, 'google');
  assert.equal(google.protocol, 'narova-tts-provider/v1');
  assert.equal(google.capabilities.synthesis, true);
  assert.equal(google.capabilities.voiceListing, true);
  assert.deepEqual(google.requiredEnvironment, ['GEMINI_API_KEY']);
  const veo = JSON.parse(read('skills/narova-google/tool/video-provider.json'));
  assert.deepEqual(veo.requiredEnvironment, ['GEMINI_API_KEY']);
  const skill = read('skills/narova-google/SKILL.md');
  assert.match(skill, /license: Apache-2.0/);
  assert.match(skill, /checksum: [0-9a-f]{64}/);
});
