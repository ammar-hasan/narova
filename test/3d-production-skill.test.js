'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const skillDir = path.join(root, 'skills', 'narova-3d-production');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('3D-production companion is small, independent, and progressively disclosed', () => {
  const topLevel = fs.readdirSync(skillDir).sort();
  assert.deepEqual(topLevel, ['SKILL.md', 'agents', 'references']);

  const references = fs.readdirSync(path.join(skillDir, 'references')).sort();
  assert.deepEqual(references, [
    'inspection.md',
    'scene-direction.md',
    'subjects-and-assets.md',
  ]);

  const skill = read('skills/narova-3d-production/SKILL.md');
  assert.match(skill, /^name: narova-3d-production$/m);
  assert.match(skill, /^license: MIT$/m);
  assert.match(skill, /^  version: "0\.2\.0"$/m);
  assert.match(skill, /A straightforward scene may need none\./);
  assert.match(skill, /Do not perform a full-manual pass\./);
  assert.match(skill, /adds no renderer, physics engine, command, schema,/);
  assert.match(skill, /Do not default the work to a palette/);
  assert.match(skill, /Do not silently turn a blockout/);
  assert.match(skill, /without its rationale/);
  assert.match(skill, /Never pretend this skill's prose/);
  assert.ok(skill.split('\n').length < 100, 'primary skill body should stay concise');

  for (const reference of references) {
    assert.match(skill, new RegExp(`references/${reference.replace('.', '\\.')}\\)`));
  }

  for (const forbidden of ['scripts', 'assets', 'README.md', 'CHANGELOG.md']) {
    assert.equal(fs.existsSync(path.join(skillDir, forbidden)), false);
  }
});

test('3D-production companion metadata routes narrowly and matches the skill', () => {
  const skill = read('skills/narova-3d-production/SKILL.md');
  const metadata = read('skills/narova-3d-production/agents/openai.yaml');

  assert.match(skill, /authored 3D video/);
  assert.match(skill, /Do not use it\s+merely because\s+a request says animation/);
  assert.match(skill, /ordinary 2D motion, browser walkthroughs,/);
  assert.match(skill, /principal subjects/);
  assert.match(metadata, /display_name: "Narova 3D Production"/);
  assert.match(metadata, /short_description: "High-freedom direction for authored 3D video"/);
  assert.match(metadata, /\$narova-3d-production/);
});

test('public and core discovery preserve the optional no-runtime boundary', () => {
  const command = 'npx skills add ammar-hasan/narova --skill narova-3d-production -g';
  const repositoryReadme = read('README.md');
  const website = read('docs/index.html');
  const coreSkill = read('skills/narova/SKILL.md');
  const sceneReference = read('skills/narova/references/scene-script.md');

  assert.match(repositoryReadme, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(website, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const source of [repositoryReadme, website, coreSkill, sceneReference]) {
    assert.match(source, /narova-3d-production/);
  }

  assert.match(repositoryReadme, /core Narova works identically\s+without it/);
  assert.match(coreSkill, /Core Narova remains complete without it/);
  assert.doesNotMatch(coreSkill, /geometry\/prop density/);
  assert.doesNotMatch(sceneReference, /motivated key\/fill\/rim light/);
});

test('3D-production review isolates perception from author rationale', () => {
  const skill = read('skills/narova-3d-production/SKILL.md');
  const subjects = read('skills/narova-3d-production/references/subjects-and-assets.md');
  const inspection = read('skills/narova-3d-production/references/inspection.md');

  assert.match(subjects, /Subject class does not prescribe realism or a\s+rig\./);
  assert.match(subjects, /placeholder promotion/i);
  assert.match(inspection, /Do not reveal the author's plan/);
  assert.match(inspection, /deterministic or structured evidence/);
  assert.match(inspection, /automated visual critic/);
  assert.doesNotMatch(`${skill}\n${subjects}\n${inspection}`, /must use (?:Meshy|Blender|Three\.js)/i);
});
