'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncVersion } = require('../scripts/sync-version');

const ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'skills', 'narova');
const TOOL_DIR = path.join(ROOT, 'tool');

function filesBelow(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(full));
    else found.push(path.relative(dir, full));
  }
  return found;
}

test('Narova skill is instructions-only and bootstraps the standalone CLI', () => {
  const topLevel = fs.readdirSync(SKILL_DIR).filter(name => name !== '.DS_Store').sort();
  assert.deepEqual(topLevel, ['SKILL.md', 'references']);

  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  assert.match(skill, /command -v narova/);
  assert.match(skill, /\[ -x "\$HOME\/\.local\/bin\/narova" \]/);
  assert.match(skill, /npm install --global @narova\/narova@\d+\.\d+\.\d+/);
  assert.doesNotMatch(skill, /raw\.githubusercontent\.com\/ammar-hasan\/narova\/main\/tool\/install\.sh/);
  assert.match(skill, /narova <command>/);
  assert.match(skill, /narova-uninstall/);
  assert.doesNotMatch(skill, /<this-skill-dir>\/tool|<skill-dir>\/tool|skills\/narova\/tool/);

  for (const file of filesBelow(path.join(SKILL_DIR, 'references'))) {
    const source = fs.readFileSync(path.join(SKILL_DIR, 'references', file), 'utf8');
    assert.doesNotMatch(source, /<skill-dir>\/tool|<narova-skill-dir>\/tool|skills\/narova\/tool/, file);
  }

  assert.equal(fs.existsSync(path.join(TOOL_DIR, 'install.sh')), false);
  const smoke = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test-packed-package.js')], {
    encoding: 'utf8',
  });
  assert.equal(smoke.status, 0, smoke.stderr || smoke.stdout);
  assert.match(smoke.stdout, /packed package smoke test ok: @narova\/narova@/);
});

test('skill bootstrap reuses the default-prefix CLI and preserves install failures', t => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const bootstrap = skill.match(/Before the first Narova command[\s\S]*?```bash\n([\s\S]*?)\n```/);
  assert.ok(bootstrap, 'SKILL.md must contain an executable bootstrap block');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-skill-bootstrap-'));
  const fakeBin = path.join(tmp, 'bin');
  const installHome = path.join(tmp, 'home');
  const defaultBin = path.join(installHome, '.local', 'bin', 'narova');
  const npmMarker = path.join(tmp, 'npm-called');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(path.dirname(defaultBin), { recursive: true });
  fs.writeFileSync(defaultBin, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(defaultBin, 0o755);

  const fakeNpm = path.join(fakeBin, 'npm');
  fs.writeFileSync(fakeNpm, `#!/bin/sh\nprintf '%s\\n' "$*" > "${npmMarker}"\nexit 37\n`);
  fs.chmodSync(fakeNpm, 0o755);
  const env = {
    ...process.env,
    HOME: installHome,
    TMPDIR: path.join(tmp, 'installer-tmp'),
    PATH: `${fakeBin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
  };
  fs.mkdirSync(env.TMPDIR);

  const reused = spawnSync('bash', ['-c', bootstrap[1]], { encoding: 'utf8', env });
  assert.equal(reused.status, 0, reused.stderr);
  assert.equal(reused.stdout.trim(), defaultBin);
  assert.equal(fs.existsSync(npmMarker), false, 'an existing default-prefix CLI must not be reinstalled');

  fs.rmSync(defaultBin);
  const failed = spawnSync('bash', ['-c', bootstrap[1]], { encoding: 'utf8', env });
  assert.equal(failed.status, 37, failed.stderr || failed.stdout);
  assert.equal(
    fs.readFileSync(npmMarker, 'utf8').trim(),
    `install --global @narova/narova@${require(path.join(TOOL_DIR, 'package.json')).version}`,
  );
});

test('repository version sources agree with the standalone tool package', () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const rootVer = rootPkg.version;
  assert.ok(typeof rootVer === 'string' && rootVer.length > 0, 'root package.json must have a version');

  const toolPkg = JSON.parse(fs.readFileSync(path.join(TOOL_DIR, 'package.json'), 'utf8'));
  assert.equal(toolPkg.version, rootVer, 'tool/package.json version must match root');

  const skillMd = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const skillVerMatch = skillMd.match(/^\s{2}version:\s*"([^"]+)"/m);
  assert.ok(skillVerMatch, 'SKILL.md must have metadata.version');
  assert.equal(skillVerMatch[1], rootVer, 'SKILL.md version must match root');

  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const badgeMatch = readme.match(/badge\/version-([0-9.]+)-/);
  assert.ok(badgeMatch, 'README.md must have a version badge');
  assert.equal(badgeMatch[1], rootVer, 'README.md badge version must match root');
  assert.match(readme, /npm install --global @narova\/narova/);
  assert.match(readme, /narova doctor/);
  assert.doesNotMatch(readme, /raw\.githubusercontent\.com\/ammar-hasan\/narova\/main\/tool\/install\.sh/);
  assert.match(skillMd, new RegExp(`npm install --global @narova/narova@${rootVer.replace(/\\./g, '\\\\.')}\\b`));

  const spec = fs.readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8');
  const specMatch = spec.match(/^## Status: ([0-9.]+) shipped$/m);
  assert.ok(specMatch, 'SPEC.md must have a shipped status version');
  assert.equal(specMatch[1], rootVer, 'SPEC.md status version must match root');

  for (const relative of ['docs/index.html', 'docs/changelog/index.html']) {
    const html = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    const currentMatch = html.match(/data-narova-version[^>]*>v?([0-9.]+)/);
    assert.ok(currentMatch, `${relative} must have a current version marker`);
    assert.equal(currentMatch[1], rootVer, `${relative} version must match root`);
  }
});

test('version sync updates skill metadata and its exact npm bootstrap pin', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-version-sync-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const write = (relative, source) => {
    const file = path.join(tmp, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, source);
  };

  write('package.json', '{"version":"9.8.7"}\n');
  write('tool/package.json', '{"name":"@narova/narova","version":"0.0.1"}\n');
  write('tool/package-lock.json', `${JSON.stringify({
    name: '@narova/narova',
    version: '0.0.1',
    packages: { '': { name: '@narova/narova', version: '0.0.1' } },
  }, null, 2)}\n`);
  write('skills/narova/SKILL.md', [
    '---',
    'metadata:',
    '  version: "0.0.1"',
    '---',
    'npm install --global @narova/narova@0.0.1',
    '',
  ].join('\n'));
  write('README.md', 'https://img.shields.io/badge/version-0.0.1-blue.svg\n');
  write('SPEC.md', '## Status: 0.0.1 shipped\n');
  write('docs/index.html', '<span data-narova-version>v0.0.1</span>\n');
  write('docs/changelog/index.html', '<span data-narova-version>0.0.1</span>\n');

  syncVersion(tmp, { log() {}, warn() {} });

  const skill = fs.readFileSync(path.join(tmp, 'skills/narova/SKILL.md'), 'utf8');
  assert.match(skill, /version: "9\.8\.7"/);
  assert.match(skill, /@narova\/narova@9\.8\.7/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'tool/package.json'))).version, '9.8.7');
  const lock = JSON.parse(fs.readFileSync(path.join(tmp, 'tool/package-lock.json')));
  assert.equal(lock.version, '9.8.7');
  assert.equal(lock.packages[''].version, '9.8.7');
  assert.match(fs.readFileSync(path.join(tmp, 'README.md'), 'utf8'), /version-9\.8\.7-/);
  assert.match(fs.readFileSync(path.join(tmp, 'SPEC.md'), 'utf8'), /Status: 9\.8\.7 shipped/);
  assert.match(fs.readFileSync(path.join(tmp, 'docs/index.html'), 'utf8'), />v9\.8\.7</);
  assert.match(fs.readFileSync(path.join(tmp, 'docs/changelog/index.html'), 'utf8'), />9\.8\.7</);
});

test('repository eval runners resolve the top-level tool layout', () => {
  for (const name of ['complex-animated-proof.js', 'no-browser-complex-eval.js']) {
    const source = fs.readFileSync(path.join(TOOL_DIR, 'evals', name), 'utf8');
    assert.match(source, /path\.resolve\(__dirname, '\.\.\/\.\.'\)/, name);
    assert.doesNotMatch(source, /skills['"], ['"]narova['"], ['"]tool/, name);
  }

  const live = fs.readFileSync(path.join(TOOL_DIR, 'evals', 'live-creativity-ab.js'), 'utf8');
  assert.match(live, /path\.join\(root, 'tool', 'bin', 'narova\.js'\)/);
  assert.doesNotMatch(live, /skills['"], ['"]narova['"], ['"]tool/);
});
