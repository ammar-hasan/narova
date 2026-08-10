'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { addSample, removeSample, listSamples } = require('../src/samples');

function makeWav(dir, name) {
  const silence = Buffer.alloc(44);
  silence.write('RIFF', 0);
  silence.writeUInt32LE(36, 4);
  silence.write('WAVE', 8);
  silence.write('fmt ', 12);
  silence.writeUInt32LE(16, 16);
  silence.writeUInt16LE(1, 20);
  silence.writeUInt16LE(1, 22);
  silence.writeUInt32LE(22050, 24);
  silence.writeUInt32LE(44100, 28);
  silence.writeUInt16LE(2, 32);
  silence.writeUInt16LE(16, 34);
  silence.write('data', 36);
  silence.writeUInt32LE(0, 40);
  const p = path.join(dir, name);
  fs.writeFileSync(p, silence);
  return p;
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'narova-samples-'));
}

test('addSample copies a wav to the samples dir and returns its path', () => {
  const dir = tmpDir();
  const srcDir = tmpDir();
  const wav = makeWav(srcDir, 'test-recording.wav');
  const dest = addSample(wav, 'my-voice', dir);
  assert.ok(dest.endsWith('my-voice.wav'), dest);
  assert.ok(fs.existsSync(dest));
});

test('addSample rejects non-existent files', () => {
  assert.throws(() => addSample('/nonexistent/sample.wav', 'ghost'), /source file not found/);
});

test('addSample rejects unsupported formats', () => {
  const dir = tmpDir();
  const srcDir = tmpDir();
  const wav = makeWav(srcDir, 'test.wav');
  const ogg = path.join(srcDir, 'bad.ogg');
  fs.copyFileSync(wav, ogg);
  assert.throws(() => addSample(ogg, 'bad', dir), /unsupported audio format/);
});

test('addSample rejects names with invalid characters', () => {
  const dir = tmpDir();
  const srcDir = tmpDir();
  const wav = makeWav(srcDir, 'test.wav');
  assert.throws(() => addSample(wav, 'my voice', dir), /alphanumeric/);
});

test('listSamples returns sorted named entries with size and extension', () => {
  const dir = tmpDir();
  const srcDir = tmpDir(); // keep source files separate from samples
  const wav = makeWav(srcDir, 'source.wav');
  addSample(wav, 'b-voice', dir);
  addSample(wav, 'a-voice', dir);
  const list = listSamples(dir);
  assert.equal(list.length, 2, `expected 2, got ${list.length}`);
  assert.equal(list[0].name, 'a-voice');
  assert.equal(list[1].name, 'b-voice');
  assert.ok(list[0].size > 0);
  assert.equal(list[0].ext, '.wav');
});

test('removeSample deletes a named sample and returns its path', () => {
  const dir = tmpDir();
  const srcDir = tmpDir();
  const wav = makeWav(srcDir, 'source.wav');
  addSample(wav, 'to-delete', dir);
  const removed = removeSample('to-delete', dir);
  assert.ok(removed.endsWith('to-delete.wav'));
  assert.ok(!fs.existsSync(removed));
});

test('removeSample throws on unknown names', () => {
  assert.throws(() => removeSample('no-such-sample', '/tmp/no-such-dir'), /not found/);
});

test('listSamples returns empty array when no dir or no samples exist', () => {
  const dir = tmpDir();
  const list = listSamples(dir);
  assert.deepEqual(list, []);
});
