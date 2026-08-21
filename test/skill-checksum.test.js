'use strict';

/* Focused tests for distributed skill content identity (CHANGE-2026-042 /
 * NAR-020-034): every first-party skill declares `license` + `checksum`, and
 * the checksum is the digest of the file's canonical content (minus
 * `checksum:`/`signature:` whole lines). */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  canonicalContent, contentChecksum, ensureLicense, setChecksum,
  syncAllSkills, verifySkill, verifyAllSkills, SKILL_GLOBS,
} = require('../scripts/sync-skill-checksums');

const ROOT = path.join(__dirname, '..');

test('every first-party skill carries a license and a matching checksum', () => {
  const failures = verifyAllSkills(ROOT);
  assert.deepEqual(failures, [], `skill integrity failures: ${failures.join('; ')}`);
  assert.equal(SKILL_GLOBS.length, 5, 'all five first-party skills are covered');
});

test('canonical content excludes the checksum/signature lines (self-consistent)', () => {
  const src = fs.readFileSync(path.join(ROOT, SKILL_GLOBS[0]), 'utf8');
  const withChecksum = canonicalContent(src);
  const withoutChecksum = canonicalContent(src.replace(/^checksum: [0-9a-f]{64}\n?/m, ''));
  assert.equal(withChecksum, withoutChecksum, 'adding the checksum line never changes canonical content');
  const signed = src + '\nsignature: aW52YWxpZA==\n';
  assert.equal(canonicalContent(signed).includes('signature:'), false, 'signature-shaped lines are excluded too');
});

test('a body edit without refreshing the checksum fails verification', () => {
  const src = fs.readFileSync(path.join(ROOT, SKILL_GLOBS[0]), 'utf8');
  const edited = src.replace(/^# .*$/m, '# edited body line'); // change a body line
  const result = verifySkill(edited, 'edited-skill');
  assert.equal(result.ok, false);
  assert.match(result.error, /stale/);
});

test('a wrong checksum fails; recomputing it passes (checksum-only edit is stable)', () => {
  const src = fs.readFileSync(path.join(ROOT, SKILL_GLOBS[0]), 'utf8');
  const tampered = src.replace(/^checksum: [0-9a-f]{64}$/m, `checksum: ${'0'.repeat(64)}`);
  assert.equal(verifySkill(tampered).ok, false, 'a checksum edit without a matching body fails');

  const reSynced = setChecksum(src, contentChecksum(src)).source;
  assert.equal(verifySkill(reSynced).ok, true, 'recomputed checksum passes');
  assert.equal(setChecksum(reSynced, contentChecksum(reSynced)).changed, false, 'sync is idempotent');
});

test('license is ensured when missing and never duplicated', () => {
  const bare = '---\nname: x\ndescription: y\n---\nbody';
  const withLicense = ensureLicense(bare).source;
  assert.match(withLicense, /^license: Apache-2.0$/m);
  assert.equal((withLicense.match(/^license:/gm) || []).length, 1, 'license appears exactly once');
  assert.equal(verifySkill(setChecksum(withLicense, contentChecksum(withLicense)).source).ok, true);
});

test('syncAllSkills is idempotent on the canonical tree', () => {
  const before = fs.readFileSync(path.join(ROOT, SKILL_GLOBS[0]), 'utf8');
  const silent = { log() {} };
  syncAllSkills(ROOT, silent);
  const after = fs.readFileSync(path.join(ROOT, SKILL_GLOBS[0]), 'utf8');
  assert.equal(after, before, 'a synced tree is unchanged by another sync');
});
