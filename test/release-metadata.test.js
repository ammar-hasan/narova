'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  assertReleaseChronology,
  hasMainAncestryGuard,
  hasRequiredMediaToolSetup,
} = require('../scripts/check-release');

const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'publish.yml');
const ciWorkflowPath = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');

test('publish workflow ancestry guard compares the tag commit to origin/main', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.equal(hasMainAncestryGuard(workflow), true);

  const weakened = workflow.replace(
    'git merge-base --is-ancestor "$tag_commit" origin/main',
    'git merge-base --is-ancestor "$tag_commit" "$tag_commit"',
  );
  assert.notEqual(weakened, workflow);
  assert.equal(hasMainAncestryGuard(weakened), false);

  const inertCopy = weakened.replace(
    'jobs:\n',
    'env:\n  ANCESTRY_EXAMPLE: |\n    if ! git merge-base --is-ancestor "$tag_commit" origin/main; then\njobs:\n',
  );
  assert.notEqual(inertCopy, weakened);
  assert.equal(hasMainAncestryGuard(inertCopy), false);

  const nestedFakeRun = weakened.replace(
    'jobs:\n',
    'env:\n  ANCESTRY_EXAMPLE: |\n    run: |\n      if ! git merge-base --is-ancestor "$tag_commit" origin/main; then\njobs:\n',
  );
  assert.notEqual(nestedFakeRun, weakened);
  assert.equal(hasMainAncestryGuard(nestedFakeRun), false);

  const envMappingRun = weakened.replace(
    'jobs:\n',
    'env:\n  run: |\n    if ! git merge-base --is-ancestor "$tag_commit" origin/main; then\njobs:\n',
  );
  assert.notEqual(envMappingRun, weakened);
  assert.equal(hasMainAncestryGuard(envMappingRun), false);
});

test('a commented ancestry command does not satisfy the release guard', () => {
  assert.equal(
    hasMainAncestryGuard('# if ! git merge-base --is-ancestor "$tag_commit" origin/main; then'),
    false,
  );
});

test('CI and publishing provision and verify required media tools', () => {
  for (const pathToWorkflow of [ciWorkflowPath, workflowPath]) {
    const workflow = fs.readFileSync(pathToWorkflow, 'utf8');
    assert.equal(hasRequiredMediaToolSetup(workflow), true);
    assert.equal(
      hasRequiredMediaToolSetup(workflow.replace('ffprobe -version', '# ffprobe -version')),
      false,
    );
  }
});

test('release metadata requires exact Markdown and website chronology parity', () => {
  const markdown = [
    '## [Unreleased]',
    '## [2.0.0] - 2026-08-26',
    '## [1.0.0] - 2026-08-25',
  ].join('\n');
  const website = [
    '<span class="rel-version" data-narova-version>2.0.0</span>',
    '<span class="rel-version">1.0.0</span>',
  ].join('\n');

  assert.doesNotThrow(() => assertReleaseChronology(markdown, website));
  assert.throws(
    () => assertReleaseChronology(markdown, website.replace('1.0.0', '0.9.0')),
    /versions\/order do not match/,
  );
  assert.throws(
    () => assertReleaseChronology(`${markdown}\n## [1.0.0] - 2026-08-25`, website),
    /duplicate release headings/,
  );
});
