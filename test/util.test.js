'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveSize, hexToRgba } = require('../skills/narova/tool/src/util');

test('resolveSize handles presets and objects', () => {
  assert.deepEqual(resolveSize('16:9'), { w: 1280, h: 720 });
  assert.deepEqual(resolveSize('1:1'), { w: 1080, h: 1080 });
  assert.deepEqual(resolveSize('9:16'), { w: 720, h: 1280 });
  assert.deepEqual(resolveSize({ w: 100.7, h: 50 }), { w: 100, h: 50 });
  assert.deepEqual(resolveSize(undefined), { w: 1280, h: 720 });
});

test('resolveSize rejects unknown sizes instead of silently using 16:9', () => {
  assert.throws(() => resolveSize('4:3'), /unknown size "4:3"/);
  assert.throws(() => resolveSize({ w: 100 }), /unknown size/);
});

test('hexToRgba converts and falls back safely', () => {
  assert.equal(hexToRgba('#ff0000', 0.5), 'rgba(255,0,0,0.5)');
  assert.equal(hexToRgba('00ff00', 1), 'rgba(0,255,0,1)');
  assert.equal(hexToRgba('nope', 0.3), 'rgba(46,230,214,0.3)');
});
