'use strict';

/* Focused public-guidance contract for CHANGE-2026-084 / NAR-020-044.
 * Truthful scene locality stays discoverable without restricting the global
 * author-JavaScript escape hatch or pretending arbitrary code can be inferred. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const skill = read('skills/narova/SKILL.md');
const choreography = read('skills/narova/references/choreography.md');
const sceneScript = read('skills/narova/references/scene-script.md');
const readme = read('README.md');

test('one-scene choreography is the primary public authoring form', () => {
  const localExample = choreography.indexOf('choreographyFile: "overflow.choreo.js"');
  const globalExample = choreography.indexOf('choreography: "cross-scene.choreo.js"');
  assert.ok(localExample >= 0, 'scene-local choreography example must exist');
  assert.ok(globalExample > localExample, 'scene-local example must precede the global escape hatch');
  assert.match(choreography, /belongs to that scene's cache identity/);
  assert.match(choreography, /unchanged sibling scenes remain\s+eligible for reuse/);
  assert.match(sceneScript, /Scene-local or project choreography/);
  assert.match(sceneScript, /owning scene/);
});

test('project choreography remains the unrestricted cross-scene form', () => {
  assert.match(choreography, /genuinely reads,\s+schedules, selects, or coordinates across scenes/);
  assert.match(choreography, /inspect the full composition `DATA` and address any\s+scene/);
  assert.match(choreography, /conservatively uses whole-video reuse/);
  assert.match(choreography, /global\s+escape hatch remains unrestricted/);
  assert.match(choreography, /performance consequence, not a creative or validity judgement/);
});

test('guidance preserves agent choice and makes no locality inference', () => {
  assert.match(choreography, /does not\s+rewrite, sandbox, infer locality/);
  assert.match(choreography, /Do not misrepresent genuinely global work\s+as local merely to gain speed/);
  assert.match(skill, /use a scene's\s+`choreographyFile` when the behavior belongs to that scene/);
  assert.match(skill, /global form remains unrestricted/);
  assert.match(skill, /Narova\s+does not infer or rewrite the choice/);
  assert.match(readme, /Global choreography remains unrestricted and valid/);
});
