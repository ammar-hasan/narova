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
const TOOL_VERSION = require(path.join(TOOL_DIR, 'package.json')).version;

function writeFakeCli(file, version) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    `  printf '%s\\n' '${version}'`,
    '  exit 0',
    'fi',
    'exit 0',
    '',
  ].join('\n'));
  fs.chmodSync(file, 0o755);
}

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
  assert.match(skill, /narova_required="@narova\/narova@\d+\.\d+\.\d+"/);
  assert.match(skill, /npm install --global "\$narova_required"/);
  assert.match(skill, /--version 2>\/dev\/null/);
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

test('skill bootstrap reuses only an exact CLI and reconciles older and newer mismatches', t => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const bootstrap = skill.match(/Before the first Narova command[\s\S]*?```bash\n([\s\S]*?)\n```/);
  assert.ok(bootstrap, 'SKILL.md must contain an executable bootstrap block');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-skill-bootstrap-'));
  const fakeBin = path.join(tmp, 'bin');
  const installHome = path.join(tmp, 'home');
  const defaultBin = path.join(installHome, '.local', 'bin', 'narova');
  const npmMarker = path.join(tmp, 'npm-called');
  const installedCli = path.join(tmp, 'installed-narova');
  const defaultSetup = path.join(path.dirname(defaultBin), 'narova-setup');
  const defaultUninstall = path.join(path.dirname(defaultBin), 'narova-uninstall');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(fakeBin, { recursive: true });
  writeFakeCli(defaultBin, TOOL_VERSION);
  writeFakeCli(defaultSetup, TOOL_VERSION);
  writeFakeCli(defaultUninstall, TOOL_VERSION);
  writeFakeCli(installedCli, TOOL_VERSION);

  const fakeNpm = path.join(fakeBin, 'npm');
  fs.writeFileSync(fakeNpm, [
    '#!/bin/sh',
    `printf '%s\\n' "$*" > "${npmMarker}"`,
    'if [ -n "$NAROVA_FAKE_INSTALL_SOURCE" ]; then',
    '  cp "$NAROVA_FAKE_INSTALL_SOURCE" "$NAROVA_FAKE_INSTALL_TARGET"',
    '  chmod 755 "$NAROVA_FAKE_INSTALL_TARGET"',
    'fi',
    'exit "${NAROVA_FAKE_NPM_STATUS:-0}"',
    '',
  ].join('\n'));
  fs.chmodSync(fakeNpm, 0o755);
  const env = {
    ...process.env,
    HOME: installHome,
    TMPDIR: path.join(tmp, 'installer-tmp'),
    PATH: `${fakeBin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    NAROVA_FAKE_INSTALL_TARGET: defaultBin,
  };
  fs.mkdirSync(env.TMPDIR);

  const reused = spawnSync('bash', ['-c', bootstrap[1]], { encoding: 'utf8', env });
  assert.equal(reused.status, 0, reused.stderr);
  assert.equal(reused.stdout.trim(), defaultBin);
  assert.equal(fs.existsSync(npmMarker), false, 'an exact default-prefix CLI must not be reinstalled');

  const relativeBinName = 'relative-bin';
  const relativeBin = path.join(tmp, relativeBinName);
  const relativeCli = path.join(relativeBin, 'narova');
  writeFakeCli(relativeCli, TOOL_VERSION);
  writeFakeCli(path.join(relativeBin, 'narova-setup'), TOOL_VERSION);
  writeFakeCli(path.join(relativeBin, 'narova-uninstall'), TOOL_VERSION);
  const resolvedRelative = spawnSync('bash', ['-c', bootstrap[1]], {
    cwd: tmp,
    encoding: 'utf8',
    env: { ...env, PATH: `${relativeBinName}${path.delimiter}/usr/bin${path.delimiter}/bin` },
  });
  assert.equal(resolvedRelative.status, 0, resolvedRelative.stderr);
  assert.equal(
    resolvedRelative.stdout.trim(),
    fs.realpathSync(relativeCli),
    'relative PATH entries must resolve to an absolute physical directory',
  );

  for (const mismatch of ['0.0.1', '99.0.0']) {
    writeFakeCli(defaultBin, mismatch);
    if (fs.existsSync(npmMarker)) fs.rmSync(npmMarker);
    const reconciled = spawnSync('bash', ['-c', bootstrap[1]], {
      encoding: 'utf8',
      env: { ...env, NAROVA_FAKE_INSTALL_SOURCE: installedCli },
    });
    assert.equal(reconciled.status, 0, reconciled.stderr);
    assert.equal(reconciled.stdout.trim(), defaultBin);
    assert.equal(
      fs.readFileSync(npmMarker, 'utf8').trim(),
      `install --global @narova/narova@${TOOL_VERSION}`,
    );
    assert.equal(spawnSync(defaultBin, ['--version'], { encoding: 'utf8' }).stdout.trim(), TOOL_VERSION);
  }

  fs.rmSync(npmMarker);
  writeFakeCli(path.join(fakeBin, 'narova'), '0.0.1');
  writeFakeCli(path.join(fakeBin, 'narova-setup'), '0.0.1');
  writeFakeCli(path.join(fakeBin, 'narova-uninstall'), '0.0.1');
  const ignoredStalePath = spawnSync('bash', ['-c', bootstrap[1]], { encoding: 'utf8', env });
  assert.equal(ignoredStalePath.status, 0, ignoredStalePath.stderr);
  assert.equal(ignoredStalePath.stdout.trim(), defaultBin);
  assert.equal(fs.existsSync(npmMarker), false, 'a matching fallback CLI must beat a stale PATH CLI');
  assert.equal(
    spawnSync(ignoredStalePath.stdout.trim(), ['--version'], { encoding: 'utf8' }).stdout.trim(),
    TOOL_VERSION,
    'subsequent commands must use the authoritative resolved path',
  );
  for (const companion of ['narova-setup', 'narova-uninstall']) {
    const resolvedCompanion = path.join(path.dirname(ignoredStalePath.stdout.trim()), companion);
    assert.equal(
      spawnSync(resolvedCompanion, ['--version'], { encoding: 'utf8' }).stdout.trim(),
      TOOL_VERSION,
      `${companion} must resolve beside the authoritative CLI`,
    );
    assert.equal(
      spawnSync(companion, ['--version'], { encoding: 'utf8', env }).stdout.trim(),
      '0.0.1',
      `the fixture must prove bare ${companion} remains shadowed`,
    );
  }
  assert.match(skill, /final printed line is the authoritative executable/);
  assert.match(skill, /do not invoke\s+a shadowing bare `narova`/);
  assert.match(skill, /`narova-uninstall` shorthands\s+anywhere in this skill or its references/);
});

test('skill bootstrap preserves npm failures and rejects a stale resolved CLI', t => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const bootstrap = skill.match(/Before the first Narova command[\s\S]*?```bash\n([\s\S]*?)\n```/);
  assert.ok(bootstrap, 'SKILL.md must contain an executable bootstrap block');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-skill-bootstrap-failure-'));
  const fakeBin = path.join(tmp, 'bin');
  const installHome = path.join(tmp, 'home');
  const defaultBin = path.join(installHome, '.local', 'bin', 'narova');
  const npmMarker = path.join(tmp, 'npm-called');
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(path.dirname(defaultBin), { recursive: true });

  const fakeNpm = path.join(fakeBin, 'npm');
  fs.writeFileSync(fakeNpm, [
    '#!/bin/sh',
    `printf '%s\\n' "$*" > "${npmMarker}"`,
    'exit "${NAROVA_FAKE_NPM_STATUS:-0}"',
    '',
  ].join('\n'));
  fs.chmodSync(fakeNpm, 0o755);
  const env = {
    ...process.env,
    HOME: installHome,
    PATH: `${fakeBin}${path.delimiter}/usr/bin${path.delimiter}/bin`,
  };

  const failed = spawnSync('bash', ['-c', bootstrap[1]], {
    encoding: 'utf8',
    env: { ...env, NAROVA_FAKE_NPM_STATUS: '37' },
  });
  assert.equal(failed.status, 37, failed.stderr || failed.stdout);
  assert.equal(
    fs.readFileSync(npmMarker, 'utf8').trim(),
    `install --global @narova/narova@${TOOL_VERSION}`,
  );

  const unresolved = spawnSync('bash', ['-c', bootstrap[1]], { encoding: 'utf8', env });
  assert.equal(unresolved.status, 1, unresolved.stderr || unresolved.stdout);
  assert.match(unresolved.stderr, /installed @narova\/narova@\d+\.\d+\.\d+ but no matching CLI is available/);
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
  const pins = [...skillMd.matchAll(/@narova\/narova@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)]
    .map(match => match[1]);
  assert.deepEqual(pins, [rootVer], 'SKILL.md must have exactly one canonical npm compatibility pin');
  assert.match(skillMd, /npm install --global "\$narova_required"/);
  assert.match(skillMd, /narova_candidate.*--version/);

  const publicGuide = fs.readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8');
  const specMatch = publicGuide.match(/^## Status: ([0-9.]+) shipped$/m);
  assert.ok(specMatch, 'SPEC.md must have a shipped status version');
  assert.equal(specMatch[1], rootVer, 'SPEC.md status version must match root');
  assert.match(publicGuide, /<!-- narova-document-role: shipped-interface-guide; authority: non-normative -->/);
  const prohibitedGuideHeading = /^#{1,6} .*\b(?:future work|product roadmap|research store|product strategy|project memory|agent (?:instructions|guidance|context|memory))\b/im;
  assert.doesNotMatch(publicGuide, prohibitedGuideHeading);
  assert.match('### Future work', prohibitedGuideHeading);
  assert.doesNotMatch('## Memory requirements', prohibitedGuideHeading);
  assert.doesNotMatch(publicGuide, /docs\/experiments\//);

  const maintainerNotes = fs.readFileSync(path.join(ROOT, 'LEARNINGS.md'), 'utf8');
  assert.match(maintainerNotes, /<!-- narova-document-role: implementation-maintainer-notes; authority: non-normative -->/);
  const prohibitedMaintainerHeading = /^#{1,6} .*\b(?:product (?:vision|roadmap|strategy)|research store|strategic memory|future work|creative (?:confidence|divergence|strategy)|scene model|agent (?:instructions|guidance|context|memory))\b/im;
  assert.doesNotMatch(maintainerNotes, prohibitedMaintainerHeading);
  assert.match('## Agent instructions', prohibitedMaintainerHeading);
  assert.doesNotMatch('## Agent-browser capture failures', prohibitedMaintainerHeading);

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
    'narova_required="@narova/narova@0.0.1"',
    'npm install --global "$narova_required"',
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

  write('skills/narova/SKILL.md', [
    '---',
    'metadata:',
    '  version: "9.8.7"',
    '---',
    'missing compatibility pin',
    '',
  ].join('\n'));
  assert.throws(
    () => syncVersion(tmp, { log() {}, warn() {} }),
    /exact npm compatibility pin: expected exactly one version surface, found 0/,
  );

  write('skills/narova/SKILL.md', [
    '---',
    'metadata:',
    '  version: "9.8.7"',
    '---',
    'narova_required="@narova/narova@9.8.7"',
    'npm install --global "$narova_required"',
    '',
  ].join('\n'));
  write('tool/package-lock.json', `${JSON.stringify({
    name: '@narova/narova',
    version: '9.8.7',
    packages: {},
  }, null, 2)}\n`);
  assert.throws(
    () => syncVersion(tmp, { log() {}, warn() {} }),
    /tool\/package-lock\.json: missing lock or root package version surface/,
  );

  write('tool/package-lock.json', [
    '{',
    '  "name": "@narova/narova",',
    '  "version": "9.8.7",',
    '    "version": "8.8.8",',
    '  "packages": {',
    '    "": {',
    '      "name": "@narova/narova",',
    '      "version": "9.8.7"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'));
  assert.throws(
    () => syncVersion(tmp, { log() {}, warn() {} }),
    /tool\/package-lock\.json: duplicate JSON key \$\["version"\]/,
  );

  write('tool/package-lock.json', [
    '{',
    '  "name": "@narova/narova",',
    '  "version": "9.8.7",',
    '  "packages": {',
    '    "": {',
    '      "name": "@narova/narova",',
    '      "version": "9.8.7",',
    '          "version": "8.8.8"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'));
  assert.throws(
    () => syncVersion(tmp, { log() {}, warn() {} }),
    /tool\/package-lock\.json: duplicate JSON key \$\["packages"\]\[""\]\["version"\]/,
  );
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
