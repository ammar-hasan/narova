'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isStepRunBlock(lines, index, runIndent, directStep) {
  let stepIndex = index;
  let stepIndent = runIndent;

  if (!directStep) {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (!lines[cursor].trim() || /^\s*#/.test(lines[cursor])) continue;
      const indent = lines[cursor].match(/^\s*/)[0].length;
      if (indent >= runIndent) continue;
      if (!/^\s*-\s+/.test(lines[cursor])) return false;
      stepIndex = cursor;
      stepIndent = indent;
      break;
    }
  }

  for (let cursor = stepIndex - 1; cursor >= 0; cursor -= 1) {
    if (!lines[cursor].trim() || /^\s*#/.test(lines[cursor])) continue;
    const indent = lines[cursor].match(/^\s*/)[0].length;
    if (indent >= stepIndent) continue;
    return /^\s*steps:\s*(?:#.*)?$/.test(lines[cursor]);
  }
  return false;
}

function hasMainAncestryGuard(source) {
  const lines = source.split(/\r?\n/);
  const runScripts = [];

  for (let index = 0; index < lines.length; index += 1) {
    const block = lines[index].match(
      /^(\s*)(?:-\s+)?([A-Za-z0-9_-]+):\s*[|>](?:[+-]?[1-9]?|[1-9][+-]?)\s*(?:#.*)?$/,
    );
    if (!block) continue;

    const blockIndent = block[1].length;
    const directStep = lines[index].slice(blockIndent).startsWith('- ');
    const executableRun = block[2] === 'run'
      && isStepRunBlock(lines, index, blockIndent, directStep);
    const contents = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) {
        contents.push('');
        continue;
      }
      const indent = line.match(/^\s*/)[0].length;
      if (indent <= blockIndent) {
        index -= 1;
        break;
      }
      contents.push(line.trim());
    }
    if (executableRun) runScripts.push(contents);
  }

  return runScripts.some(script => script.some(line => (
    /^if\s+!\s+git\s+merge-base\s+--is-ancestor\s+"\$tag_commit"\s+origin\/main;\s*then$/.test(line)
  )));
}

function checkRelease() {
const root = path.resolve(__dirname, '..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const repositoryPackage = readJson('package.json');
const toolPackage = readJson('tool/package.json');
const toolLock = readJson('tool/package-lock.json');
const version = repositoryPackage.version;

if (toolPackage.version !== version) {
  throw new Error(`tool/package.json is ${toolPackage.version}; expected ${version}`);
}
if (toolPackage.name !== '@narova/narova') {
  throw new Error(`unexpected npm package name ${JSON.stringify(toolPackage.name)}`);
}
if (toolLock.name !== toolPackage.name || toolLock.version !== version
    || toolLock.packages?.['']?.name !== toolPackage.name
    || toolLock.packages?.['']?.version !== version) {
  throw new Error('tool/package-lock.json does not match the scoped package name and release version');
}

const skill = fs.readFileSync(path.join(root, 'skills/narova/SKILL.md'), 'utf8');
const skillVersion = skill.match(/^\s{2}version:\s*"([^"]+)"\s*$/m)?.[1];
if (skillVersion !== version) {
  throw new Error(`skill metadata is ${skillVersion || 'missing'}; expected ${version}`);
}
if (!skill.includes(`@narova/narova@${version}`)) {
  throw new Error(`skill installer must pin @narova/narova@${version}`);
}

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) {
  throw new Error(`CHANGELOG.md has no dated ${version} release entry`);
}

const publishWorkflow = fs.readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8');
for (const required of [
  'id-token: write',
  'fetch-depth: 0',
  'npm publish --access public --provenance',
]) {
  if (!publishWorkflow.includes(required)) {
    throw new Error(`publish workflow is missing required release control: ${required}`);
  }
}
if (!hasMainAncestryGuard(publishWorkflow)) {
  throw new Error('publish workflow must require $tag_commit to be an ancestor of origin/main');
}
if (/NPM_TOKEN|NODE_AUTH_TOKEN/.test(publishWorkflow)) {
  throw new Error('publish workflow must use npm Trusted Publishing without a token fallback');
}

if (process.env.GITHUB_REF_TYPE === 'tag') {
  const expectedTag = `v${version}`;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    throw new Error(`release tag ${process.env.GITHUB_REF_NAME} does not match ${expectedTag}`);
  }
}

process.stdout.write(`release metadata ok: @narova/narova@${version}\n`);
}

if (require.main === module) checkRelease();

module.exports = { checkRelease, hasMainAncestryGuard };
