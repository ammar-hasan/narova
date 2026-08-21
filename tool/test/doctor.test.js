'use strict';
/* NAR-SPEC-021 doctor tests (NAR-009-018): media-tool guidance must be
 * platform-appropriate and never claim doctor provisions anything. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mediaToolMissing } = require('../src/doctor');

test('media-tool guidance is platform-appropriate (NAR-009-018)', () => {
  const darwin = mediaToolMissing('darwin', 'arm64');
  assert.match(darwin, /brew install ffmpeg/);
  const win32 = mediaToolMissing('win32', 'x64');
  assert.match(win32, /winget install ffmpeg/);
  const linux = mediaToolMissing('linux', 'x64');
  assert.match(linux, /apt install ffmpeg/);
  assert.ok(!linux.includes('brew'), 'a Linux hint must not be `brew install ffmpeg`');
});

test('a pinned static build names the provisioning surface, not doctor (NAR-009-018)', () => {
  const hint = mediaToolMissing('linux', 'arm64');
  assert.match(hint, /pinned/);
  assert.match(hint, /provisioned on first run \/ `narova demo`/);
  assert.ok(!hint.includes('doctor'), 'guidance must not imply doctor provisions');
});
