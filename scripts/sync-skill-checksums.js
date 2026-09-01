'use strict';

/* Sync the content-identity frontmatter of every first-party skill
 * (CHANGE-2026-042 / NAR-020-034):
 *
 *   - ensure a `license:` field (Apache-2.0 for first-party skills);
 *   - recompute the `checksum:` field as SHA-256 over the file's CANONICAL
 *     content — the exact UTF-8 bytes with every whole-line `checksum:` and
 *     `signature:` field removed. Removing the checksum line makes the
 *     definition self-consistent: adding or updating the checksum never
 *     changes the canonical bytes, so the checksum is a stable content
 *     identity (not authorship or tamper evidence).
 *
 * Idempotent: running it twice on an already-synced tree is a no-op. It is
 * called at the end of `version:sync` so a release version bump can never
 * leave the core skill's checksum stale. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LICENSE = 'Apache-2.0';
const SKILL_GLOBS = ['skills/narova/SKILL.md', 'skills/narova-3d-production/SKILL.md',
  'skills/narova-elevenlabs/SKILL.md', 'skills/narova-google/SKILL.md', 'skills/narova-xiaomi/SKILL.md',
  'skills/narova-openai/SKILL.md', 'skills/narova-runway/SKILL.md', 'skills/narova-stock-extensions/SKILL.md'];

/* Whole-line checksum/signature fields, removed for the canonical form. The
 * checksum line is exact-hex (matches what this tool writes); the signature
 * line is any single-line scalar (future signing, not yet emitted). */
const CHECKSUM_LINE = /^[ \t]*checksum:[ \t]*[0-9a-f]{64}[ \t]*\r?\n?/gm;
const SIGNATURE_LINE = /^[ \t]*signature:[^\r\n]*\r?\n?/gm;

/* Canonical content: file bytes minus checksum/signature whole lines. */
function canonicalContent(source) {
  return source.replace(CHECKSUM_LINE, '').replace(SIGNATURE_LINE, '');
}

function contentChecksum(source) {
  return crypto.createHash('sha256').update(canonicalContent(source), 'utf8').digest('hex');
}

/* Index just before the closing `---` of the YAML frontmatter (the second
 * `---` line from the start; body horizontal rules appear later). */
function frontmatterCloseIndex(source) {
  const first = source.indexOf('---');
  if (first < 0) throw new Error('frontmatter opening --- not found');
  const close = source.indexOf('\n---', first + 3);
  if (close < 0) throw new Error('frontmatter closing --- not found');
  return close + 1; // position of the closing `---`
}

/* Insert a `license:` line into the frontmatter if absent. */
function ensureLicense(source) {
  if (/^[ \t]*license:[^\r\n]*$/m.test(source)) return { source, changed: false };
  const close = frontmatterCloseIndex(source);
  const inserted = source.slice(0, close) + `license: ${LICENSE}\n` + source.slice(close);
  return { source: inserted, changed: true };
}

/* Insert or replace the `checksum:` line in the frontmatter. */
function setChecksum(source, checksum) {
  if (/^[ \t]*checksum:[ \t]*[0-9a-f]{64}[ \t]*$/m.test(source)) {
    const updated = source.replace(/^[ \t]*checksum:[ \t]*[0-9a-f]{64}[ \t]*$/m, `checksum: ${checksum}`);
    return { source: updated, changed: updated !== source };
  }
  const close = frontmatterCloseIndex(source);
  const inserted = source.slice(0, close) + `checksum: ${checksum}\n` + source.slice(close);
  return { source: inserted, changed: true };
}

function syncSkill(file, logger = console) {
  const absolute = path.join(ROOT, file);
  let source = fs.readFileSync(absolute, 'utf8');
  let changed = false;

  const license = ensureLicense(source);
  source = license.source; changed = changed || license.changed;

  const checksum = contentChecksum(source);
  const written = setChecksum(source, checksum);
  source = written.source; changed = changed || written.changed;

  if (changed) {
    fs.writeFileSync(absolute, source, 'utf8');
    logger.log(`  ✓ ${file} (license + checksum ${checksum.slice(0, 12)}…)`);
  } else {
    logger.log(`  = ${file} (checksum ${checksum.slice(0, 12)}… unchanged)`);
  }
  return { file, checksum };
}

function syncAllSkills(root = ROOT, logger = console) {
  return SKILL_GLOBS.map(file => syncSkill(file, logger));
}

/* Verify one skill's content identity: a non-empty license and a recorded
 * checksum equal to the digest of the canonical content. Returns {ok, error?}. */
function verifySkill(source, file = 'skill') {
  if (!/^[ \t]*license:[^\r\n]*$/m.test(source)) {
    return { ok: false, error: `${file} is missing a frontmatter license field (NAR-020-034)` };
  }
  const recorded = source.match(/^[ \t]*checksum:[ \t]*([0-9a-f]{64})[ \t]*$/m)?.[1];
  if (!recorded) {
    return { ok: false, error: `${file} is missing a frontmatter checksum field (NAR-020-034)` };
  }
  if (contentChecksum(source) !== recorded) {
    return { ok: false, error: `${file} checksum is stale — run node scripts/sync-skill-checksums.js (NAR-020-034)` };
  }
  return { ok: true };
}

function verifyAllSkills(root = ROOT) {
  const failures = [];
  for (const file of SKILL_GLOBS) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const result = verifySkill(source, file);
    if (!result.ok) failures.push(result.error);
  }
  return failures;
}

module.exports = {
  canonicalContent, contentChecksum, ensureLicense, setChecksum,
  syncAllSkills, verifySkill, verifyAllSkills, SKILL_GLOBS,
};

if (require.main === module) {
  console.log('Syncing skill content identity…');
  syncAllSkills();
  console.log('Done.');
}
