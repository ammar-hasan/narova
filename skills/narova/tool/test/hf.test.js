'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { previewUrl, startHfPreview } = require('../src/hf');

test('previewUrl reports the exact Studio project route', () => {
  const dir = path.join('/tmp', 'my narrated reel');
  assert.equal(previewUrl(dir, 4317), 'http://localhost:4317/#project/my%20narrated%20reel');
});

test('detached preview refuses to overwrite a live pid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-'));
  const pidFile = path.join(dir, 'preview.pid');
  fs.writeFileSync(pidFile, `${process.pid}\n`);
  assert.throws(
    () => startHfPreview(dir, { pidFile, logFile: path.join(dir, 'preview.log') }),
    /preview already running/,
  );
});
