'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { previewUrl, startHfPreview, stopHfPreview } = require('../src/hf');

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

(process.platform === 'win32' ? test.skip : test)('detached preview returns its persisted port state file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-preview-port-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const npx = path.join(bin, 'npx');
  fs.writeFileSync(npx, '#!/bin/sh\nsleep 30\n');
  fs.chmodSync(npx, 0o755);
  const pidFile = path.join(dir, 'preview.pid');
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ''}`;
  try {
    const preview = startHfPreview(dir, {
      port: 43179, pidFile, logFile: path.join(dir, 'preview.log'),
    });
    assert.equal(preview.portFile, path.join(dir, 'preview.port'));
    assert.equal(fs.readFileSync(preview.portFile, 'utf8').trim(), '43179');
    stopHfPreview(pidFile);
  } finally {
    process.env.PATH = previousPath;
  }
});
