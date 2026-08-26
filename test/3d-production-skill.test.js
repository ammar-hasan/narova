'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const skillDir = path.join(root, 'skills', 'narova-3d-production');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('3D-production companion stays optional and progressively discloses execution', () => {
  const topLevel = fs.readdirSync(skillDir).sort();
  assert.deepEqual(topLevel.filter(name => name !== 'node_modules'), [
    'SKILL.md',
    'agents',
    'package-lock.json',
    'package.json',
    'references',
    'tests',
    'tools',
  ]);

  const references = fs.readdirSync(path.join(skillDir, 'references')).sort();
  assert.deepEqual(references, [
    'dcc-environment.md',
    'frame-encoding.md',
    'inspection.md',
    'physical-reasoning.md',
    'scene-direction.md',
    'subjects-and-assets.md',
  ]);

  const skill = read('skills/narova-3d-production/SKILL.md');
  assert.match(skill, /^name: narova-3d-production$/m);
  assert.match(skill, /^license: Apache-2.0$/m);
  assert.match(skill, /^  version: "0\.6\.0"$/m);
  assert.match(skill, /A straightforward scene may need none\./);
  assert.match(skill, /Do not perform a full-manual pass\./);
  assert.match(skill, /adds no core dependency, renderer, provider/);
  assert.match(skill, /Do not default the work to a palette/);
  assert.match(skill, /Do not silently turn a blockout/);
  assert.match(skill, /without its rationale/);
  assert.match(skill, /Never pretend this skill's prose/);
  assert.match(skill, /DCC environment and operations/);
  assert.match(skill, /availability\s+alone is not suitability/);
  assert.match(skill, /A committed DCC result enters ordinary Narova/);
  assert.match(skill, /Inspect the exact shot source that will render/);
  assert.match(skill, /Narova does not choose\s+the frames/);
  assert.ok(skill.split('\n').length < 145, 'primary skill body should stay concise');

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

test('public and core discovery preserve the optional no-core-runtime boundary', () => {
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

test('3D-production physical reasoning preserves premise, authorship, and evidence boundaries', () => {
  const skill = read('skills/narova-3d-production/SKILL.md');
  const physical = read('skills/narova-3d-production/references/physical-reasoning.md');
  const packageJson = JSON.parse(read('skills/narova-3d-production/package.json'));

  assert.match(physical, /Never assign one unrelated substitute to distinct principal roles/);
  assert.match(physical, /initial state -> cause or intent -> approach\/path -> contact or constraint/);
  assert.match(physical, /Authored kinematics/);
  assert.match(physical, /Bounded rigid-body bake/);
  assert.match(physical, /Specialist solver/);
  assert.match(physical, /do not run the solver inside the renderer/i);
  assert.match(physical, /`sceneState` is advisory evidence/);
  assert.match(skill, /Do not persist or retrieve another project's concept/);
  assert.match(skill, /Route cloth, fluids, fracture, robotics/);
  assert.equal(packageJson.dependencies['@dimforge/rapier3d-deterministic-compat'], '0.20.0');
});

test('3D-production DCC operations stay optional, bounded, and capability-honest', () => {
  const skill = read('skills/narova-3d-production/SKILL.md');
  const dcc = read('skills/narova-3d-production/references/dcc-environment.md');
  const packageJson = JSON.parse(read('skills/narova-3d-production/package.json'));

  assert.match(skill, /Never install or transmit implicitly/);
  assert.match(dcc, /`suitable`,\s+`unsuitable`, or `unknown`/);
  assert.match(dcc, /never downloads, installs, or selects a remote executor/);
  assert.match(dcc, /Scene assembly\/modification, arbitrary simulation, and managed installation/);
  assert.match(dcc, /replace the\s+destination atomically/);
  assert.match(dcc, /explicit stop route/);
  assert.match(dcc, /`workload\.sampleFrames`/);
  assert.match(dcc, /do not establish motion between samples/);
  assert.match(dcc, /pixelMeasurements/);
  assert.match(dcc, /20,000,000 pixels/);
  assert.match(dcc, /no target band or\s+recommendation/i);
  assert.match(skill, /decoded-pixel distributions/);
  assert.match(skill, /coarse requested-object camera projection/);
  assert.equal(packageJson.scripts.dcc, 'node tools/blender-dcc.js');
  assert.equal(packageJson.version, '0.6.0');
});
