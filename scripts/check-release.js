'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

if (process.env.GITHUB_REF_TYPE === 'tag') {
  const expectedTag = `v${version}`;
  if (process.env.GITHUB_REF_NAME !== expectedTag) {
    throw new Error(`release tag ${process.env.GITHUB_REF_NAME} does not match ${expectedTag}`);
  }
}

process.stdout.write(`release metadata ok: @narova/narova@${version}\n`);
