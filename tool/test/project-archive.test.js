'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FORMAT, MANIFEST_PATH, REMIX_PATH, zipStored, parseZip, readArchiveBytes,
  MAX_MEMBER_BYTES, openArchive, remix,
} = require('../src/project-archive');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(ROOT, 'tool', 'bin', 'narova.js');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const run = args => spawnSync(process.execPath, [BIN, ...args], {
  encoding: 'utf8', env: { ...process.env, NAROVA_FIRST_RUN: '0' },
});

function project(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'pixel.txt'), 'project asset\n');
  fs.writeFileSync(path.join(root, 'creative-brief.md'), '# Creative brief\nStatus: draft\nAmbition: routine\n');
  fs.writeFileSync(path.join(root, 'reel.config.json'), JSON.stringify({
    title: 'Portable Proof', renderer: 'no-browser', voices: {},
    scenes: [{ id: 'one', dur: 0.5, vo: [], visual: { type: 'text', text: 'Portable' } }],
  }, null, 2));
}

function manifestFor(entries, format = FORMAT) {
  return {
    format, container: 'zip', packer: { product: 'narova', version: 'test' },
    source: { title: 'Fixture', creativeIdentity: null },
    packedAt: '1980-01-01T00:00:00.000Z',
    members: entries.map(entry => ({ path: entry.path, bytes: entry.data.length, sha256: sha256(entry.data), role: 'project-file' })),
  };
}

function archive(entries, format = FORMAT) {
  const manifest = manifestFor(entries, format);
  return zipStored([
    { path: MANIFEST_PATH, data: Buffer.from(`${JSON.stringify(manifest)}\n`) },
    ...entries,
  ].sort((a, b) => a.path.localeCompare(b.path)));
}

test('pack is byte-deterministic and open round-trips an ordinary project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-roundtrip-'));
  const source = path.join(root, 'source');
  const first = path.join(root, 'first.narova');
  const second = path.join(root, 'second.narova');
  const opened = path.join(root, 'opened');
  project(source);
  const before = fs.readdirSync(source).sort();
  const a = run(['pack', '--project', source, '--output', first, '--json']);
  const b = run(['pack', '--project', source, '--output', second, '--json']);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second));
  assert.deepEqual(fs.readdirSync(source).sort(), before);
  const inspected = run(['open', first, '--inspect', '--json']);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).data.format, FORMAT);
  assert.equal(fs.existsSync(opened), false);
  const openedResult = run(['open', first, '--dir', opened, '--json']);
  assert.equal(openedResult.status, 0, openedResult.stderr);
  assert.match(openedResult.stderr, /building executes/i);
  assert.equal(run(['check', '--project', opened]).status, 0);
  assert.equal(fs.existsSync(path.join(opened, 'out')), false);
});

test('brand and design context round-trip and remix as inert project files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-brand-design-'));
  const source = path.join(root, 'source');
  const packed = path.join(root, 'context.narova');
  const opened = path.join(root, 'opened');
  const remixed = path.join(root, 'remixed');
  const brand = '# Brand\n\n## Voice\nDirect and warm.\n';
  const design = '# Design\n\n## Motion\nMeasured transforms.\n';
  project(source);
  fs.writeFileSync(path.join(source, 'BRAND.md'), brand);
  fs.writeFileSync(path.join(source, 'DESIGN.md'), design);

  const packedResult = run(['pack', '--project', source, '--output', packed, '--json']);
  assert.equal(packedResult.status, 0, packedResult.stderr);
  const manifest = readArchiveBytes(fs.readFileSync(packed)).manifest;
  for (const file of ['BRAND.md', 'DESIGN.md']) {
    assert.equal(manifest.members.find(member => member.path === file)?.role, 'project-file');
  }

  const openedResult = run(['open', packed, '--dir', opened, '--json']);
  assert.equal(openedResult.status, 0, openedResult.stderr);
  assert.equal(fs.readFileSync(path.join(opened, 'BRAND.md'), 'utf8'), brand);
  assert.equal(fs.readFileSync(path.join(opened, 'DESIGN.md'), 'utf8'), design);

  const remixResult = await remix(packed, remixed);
  assert.equal(remixResult.target, remixed);
  assert.equal(fs.readFileSync(path.join(remixed, 'BRAND.md'), 'utf8'), brand);
  assert.equal(fs.readFileSync(path.join(remixed, 'DESIGN.md'), 'utf8'), design);
  assert.equal(fs.readFileSync(path.join(source, 'BRAND.md'), 'utf8'), brand);
  assert.equal(fs.readFileSync(path.join(source, 'DESIGN.md'), 'utf8'), design);
});

test('executable config runtime entropy cannot change packed bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-runtime-entropy-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'reel.config.cjs'), `module.exports = {
    title: String(Math.random()), renderer: 'no-browser', voices: {},
    theme: { bg: Math.random() > -1 ? '#111111' : '#ffffff' },
    scenes: [{ id: 'one', dur: 0.5, vo: [], visual: { type: 'text', text: 'Stable source' } }],
  };\n`);
  const first = path.join(root, 'first.narova');
  const second = path.join(root, 'second.narova');
  assert.equal(run(['pack', '--project', source, '--output', first]).status, 0);
  assert.equal(run(['pack', '--project', source, '--output', second]).status, 0);
  assert.deepEqual(fs.readFileSync(first), fs.readFileSync(second));
  const manifest = readArchiveBytes(fs.readFileSync(first)).manifest;
  assert.equal(manifest.source.title, 'source');
  assert.equal(manifest.source.creativeIdentity, null);
});

test('executable configs may use archived modules but not external or dynamic dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-module-closure-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'shared.cjs'), "module.exports = 'Portable';\n");
  fs.writeFileSync(path.join(source, 'reel.config.cjs'), `const title = require('./shared.cjs'); module.exports = {
    title, renderer: 'no-browser', voices: {},
    scenes: [{ id: 'one', dur: 1, vo: [], visual: { type: 'text', text: title } }],
  };\n`);
  assert.equal(run(['pack', '--project', source, '--output', path.join(root, 'ok.narova')]).status, 0);

  fs.writeFileSync(path.join(root, 'outside.cjs'), "module.exports = 'Outside';\n");
  fs.writeFileSync(path.join(source, 'reel.config.cjs'), `const title = require('../outside.cjs'); module.exports = {
    title, renderer: 'no-browser', voices: {}, scenes: [{ id: 'one', dur: 1, vo: [], visual: { type: 'text', text: title } }],
  };\n`);
  const external = run(['pack', '--project', source, '--output', path.join(root, 'external.narova')]);
  assert.equal(external.status, 1, external.stderr);
  assert.match(external.stderr, /resolves outside the packed project|does not resolve inside the archive/);

  fs.writeFileSync(path.join(source, 'reel.config.cjs'), `const ref = './shared.cjs'; const title = require(ref); module.exports = {
    title, renderer: 'no-browser', voices: {}, scenes: [{ id: 'one', dur: 1, vo: [], visual: { type: 'text', text: title } }],
  };\n`);
  const dynamic = run(['pack', '--project', source, '--output', path.join(root, 'dynamic.narova')]);
  assert.equal(dynamic.status, 1, dynamic.stderr);
  assert.match(dynamic.stderr, /dynamic module dependency/);

  fs.writeFileSync(path.join(source, 'reel.config.cjs'), `const fs = require('fs'); const path = require('path');
  const title = fs['readFileSync'](path.join(__dirname, '../outside.txt'), 'utf8'); module.exports = {
    title, renderer: 'no-browser', voices: {}, scenes: [{ id: 'one', dur: 1, vo: [], visual: { type: 'text', text: title } }],
  };\n`);
  fs.writeFileSync(path.join(root, 'outside.txt'), 'Outside');
  const ambient = run(['pack', '--project', source, '--output', path.join(root, 'ambient.narova')]);
  assert.equal(ambient.status, 1, ambient.stderr);
  assert.match(ambient.stderr, /ambient Node built-in|ambient or machine-local/);
  assert.equal(fs.existsSync(path.join(root, 'ambient.narova')), false);
});

test('open verifies every digest before writing and refuses occupied targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-corrupt-'));
  const source = path.join(root, 'source');
  const packed = path.join(root, 'project.narova');
  project(source);
  assert.equal(run(['pack', '--project', source, '--output', packed]).status, 0);
  const parsed = parseZip(fs.readFileSync(packed));
  const manifest = JSON.parse(parsed.find(item => item.path === MANIFEST_PATH).data);
  manifest.members[0].sha256 = '0'.repeat(64);
  const bad = zipStored(parsed.map(item => ({
    path: item.path,
    data: item.path === MANIFEST_PATH ? Buffer.from(JSON.stringify(manifest)) : item.data,
  })));
  const badFile = path.join(root, 'bad.narova');
  fs.writeFileSync(badFile, bad);
  const target = path.join(root, 'target');
  assert.throws(() => openArchive(badFile, target), /digest mismatch/);
  assert.equal(fs.existsSync(target), false);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
  assert.throws(() => openArchive(packed, target), /target already exists/);
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');
});

test('open overwrite never replaces or contains its source archive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-source-target-'));
  const source = path.join(root, 'source');
  const packed = path.join(root, 'project.narova');
  project(source);
  assert.equal(run(['pack', '--project', source, '--output', packed]).status, 0);
  const before = fs.readFileSync(packed);
  assert.throws(() => openArchive(packed, packed, { overwrite: true }), /source and target must not overlap/);
  assert.deepEqual(fs.readFileSync(packed), before);
  assert.throws(() => openArchive(packed, root, { overwrite: true }), /source and target must not overlap/);
  assert.deepEqual(fs.readFileSync(packed), before);
});

test('overwrite cleanup cannot turn a committed replacement into a reported failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-commit-cleanup-'));
  const source = path.join(root, 'source');
  const packed = path.join(root, 'project.narova');
  const target = path.join(root, 'target');
  project(source);
  assert.equal(run(['pack', '--project', source, '--output', packed]).status, 0);
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'old.txt'), 'old');
  const originalRmSync = fs.rmSync;
  try {
    fs.rmSync = (candidate, options) => {
      if (String(candidate).includes('.backup-')) throw new Error('simulated cleanup failure');
      return originalRmSync(candidate, options);
    };
    assert.doesNotThrow(() => openArchive(packed, target, { overwrite: true }));
    assert.equal(fs.existsSync(path.join(target, 'reel.config.json')), true);
    assert.equal(fs.existsSync(path.join(target, 'old.txt')), false);
  } finally {
    fs.rmSync = originalRmSync;
  }
});

test('untrusted open never executes archived authoring code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-hostile-'));
  const code = Buffer.from("const fs=require('fs'); process.kill(process.pid); fetch('https://example.test'); throw new Error('archived authoring code executed'); module.exports={voices:{},scenes:[]};");
  const file = path.join(root, 'hostile.narova');
  fs.writeFileSync(file, archive([{ path: 'reel.config.cjs', data: code }]));
  assert.doesNotThrow(() => readArchiveBytes(fs.readFileSync(file)));
  assert.doesNotThrow(() => openArchive(file, path.join(root, 'opened')));
});

test('unknown archive versions and traversal members are rejected before writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-adversarial-'));
  assert.throws(() => readArchiveBytes(archive([{ path: 'reel.config.json', data: Buffer.from('{}') }], 'narova.project/9')), /unsupported Narova archive version/);
  const valid = zipStored([{ path: 'safe.txt', data: Buffer.from('x') }]);
  const escaped = Buffer.from(valid);
  for (let at = 0; (at = escaped.indexOf('safe.txt', at)) !== -1; at += 8) escaped.write('../x.txt', at, 'utf8');
  assert.throws(() => parseZip(escaped), /escapes/);
});

test('inspection rejects control-bearing archive metadata', () => {
  const entries = [{ path: 'reel.config.json', data: Buffer.from('{}') }];
  const titleManifest = manifestFor(entries);
  titleManifest.source.title = 'safe\u001b]8;;https://example.test\u0007unsafe';
  assert.throws(() => readArchiveBytes(zipStored([
    { path: MANIFEST_PATH, data: Buffer.from(JSON.stringify(titleManifest)) }, ...entries,
  ])), /source title.*control characters/);

  const roleManifest = manifestFor(entries);
  roleManifest.members[0].role = 'authoring-config\nforged';
  assert.throws(() => readArchiveBytes(zipStored([
    { path: MANIFEST_PATH, data: Buffer.from(JSON.stringify(roleManifest)) }, ...entries,
  ])), /role.*control characters/);

  const formatManifest = manifestFor(entries);
  formatManifest.format = 'bad\u001b[2J';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-format-control-'));
  const file = path.join(root, 'bad.narova');
  fs.writeFileSync(file, zipStored([
    { path: MANIFEST_PATH, data: Buffer.from(JSON.stringify(formatManifest)) }, ...entries,
  ]));
  const inspected = run(['open', file, '--inspect']);
  assert.equal(inspected.status, 1);
  assert.equal(inspected.stderr.includes('\u001b'), false);
});

test('archive manifests must be strict UTF-8', () => {
  const entries = [{ path: 'reel.config.json', data: Buffer.from('{}') }];
  const manifest = Buffer.from(JSON.stringify(manifestFor(entries)));
  const titleAt = manifest.indexOf(Buffer.from('"title":"Fixture"')) + Buffer.byteLength('"title":"');
  manifest[titleAt] = 0xff;
  assert.throws(() => readArchiveBytes(zipStored([
    { path: MANIFEST_PATH, data: manifest }, ...entries,
  ])), /archive manifest is not valid UTF-8/);
});

test('absolute paths, links, and bytes beyond a declared size are rejected before writes', () => {
  const absolute = Buffer.from(zipStored([{ path: 'safe.txt', data: Buffer.from('x') }]));
  for (let at = 0; (at = absolute.indexOf('safe.txt', at)) !== -1; at += 8) absolute.write('/bad.txt', at, 'utf8');
  assert.throws(() => parseZip(absolute), /absolute/);

  const linked = Buffer.from(zipStored([{ path: 'safe.txt', data: Buffer.from('x') }]));
  const central = linked.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  linked.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
  assert.throws(() => parseZip(linked), /symbolic link/);

  const overDeclared = Buffer.from(zipStored([{ path: 'safe.txt', data: Buffer.from('more-than-one') }]));
  const overCentral = overDeclared.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  overDeclared.writeUInt32LE(1, overCentral + 24);
  assert.throws(() => parseZip(overDeclared), /local header does not match|size mismatch/);

  const localMismatch = Buffer.from(zipStored([{ path: 'safe.txt', data: Buffer.from('x') }]));
  localMismatch.writeUInt32LE(0x12345678, 14);
  assert.throws(() => parseZip(localMismatch), /local header does not match/);

  const entries = [{ path: 'reel.config.json', data: Buffer.from('{}') }];
  const manifest = manifestFor(entries);
  manifest.members[0].bytes = MAX_MEMBER_BYTES + 1;
  assert.throws(() => readArchiveBytes(zipStored([
    { path: MANIFEST_PATH, data: Buffer.from(JSON.stringify(manifest)) }, ...entries,
  ])), /invalid declared size/);
});

test('the manifest has its own expansion allowance outside project bytes', () => {
  const bytes = zipStored([
    { path: MANIFEST_PATH, data: Buffer.from('manifest') },
    { path: 'reel.config.json', data: Buffer.from('x') },
  ]);
  assert.equal(parseZip(bytes, { maxTotalBytes: 1 }).length, 2);
  assert.throws(() => parseZip(zipStored([
    { path: MANIFEST_PATH, data: Buffer.from('manifest') },
    { path: 'reel.config.json', data: Buffer.from('xx') },
  ]), { maxTotalBytes: 1 }), /total expansion bound/);
});

test('filesystem aliases, trailing data, and explicit directories are rejected', () => {
  const aliasedEntries = [
    { path: 'reel.config.json', data: Buffer.from('{}') },
    { path: 'A.txt', data: Buffer.from('upper') },
    { path: 'a.txt', data: Buffer.from('lower') },
  ];
  assert.throws(() => readArchiveBytes(archive(aliasedEntries)), /filesystem-aliasing/);

  const ordinary = archive([{ path: 'reel.config.json', data: Buffer.from('{}') }]);
  assert.throws(() => readArchiveBytes(Buffer.concat([ordinary, Buffer.from('hidden')])), /end record/);

  const directory = Buffer.from(zipStored([{ path: 'dirx', data: Buffer.from('x') }]));
  for (let at = 0; (at = directory.indexOf('dirx', at)) !== -1; at += 4) directory.write('dir/', at, 'utf8');
  assert.throws(() => parseZip(directory), /directory members/);
});

test('ZIP local records must exactly cover the payload before the central directory', () => {
  const ordinary = archive([{ path: 'reel.config.json', data: Buffer.from('{}') }]);
  const endAt = ordinary.length - 22;
  const centralAt = ordinary.readUInt32LE(endAt + 16);
  const hidden = Buffer.from('undeclared payload');
  const gapped = Buffer.concat([ordinary.subarray(0, centralAt), hidden, ordinary.subarray(centralAt)]);
  gapped.writeUInt32LE(centralAt + hidden.length, endAt + hidden.length + 16);
  assert.throws(() => readArchiveBytes(gapped), /unaccounted payload bytes/);
});

test('archive paths reject Windows aliases and reserved members', () => {
  for (const invalid of ['a.', 'a ', 'a:b', 'CON', 'LPT1.txt']) {
    assert.throws(() => readArchiveBytes(archive([
      { path: 'reel.config.json', data: Buffer.from('{}') },
      { path: invalid, data: Buffer.from('x') },
    ])), /not portable across supported filesystems|absolute/);
  }
});

test('archive paths enforce portable component-length bounds before extraction', () => {
  const safe = `${'a'.repeat(255)}/b`;
  const invalid = 'a'.repeat(257);
  const data = Buffer.from('x');
  const entries = [{ path: 'reel.config.json', data: Buffer.from('{}') }, { path: invalid, data }];
  const bytes = Buffer.from(zipStored([
    { path: MANIFEST_PATH, data: Buffer.from(JSON.stringify(manifestFor(entries))) },
    { path: 'reel.config.json', data: Buffer.from('{}') },
    { path: safe, data },
  ]));
  for (let at = 0; (at = bytes.indexOf(safe, at)) !== -1; at += safe.length) bytes.write(invalid, at, 'utf8');
  assert.throws(() => readArchiveBytes(bytes), /255-byte portability bound/);
});

test('ZIP member names must be valid UTF-8', () => {
  const config = Buffer.from('{}');
  const replacement = '\ufffd\ufffd\ufffd';
  const manifest = manifestFor([
    { path: 'reel.config.json', data: config },
    { path: replacement, data: Buffer.from('x') },
  ]);
  const bytes = Buffer.from(zipStored([
    { path: MANIFEST_PATH, data: Buffer.from(JSON.stringify(manifest)) },
    { path: 'reel.config.json', data: config },
    { path: 'xxx', data: Buffer.from('x') },
  ]));
  for (let at = 0; (at = bytes.indexOf('xxx', at)) !== -1; at += 3) bytes.fill(0xff, at, at + 3);
  assert.throws(() => readArchiveBytes(bytes), /not valid UTF-8/);
});

test('pack rejects secret-shaped files and environment credential bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-secret-'));
  project(root);
  fs.writeFileSync(path.join(root, '.env'), 'TOKEN=secret');
  const result = run(['pack', '--project', root, '--output', path.join(root, 'x.narova')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /secret-shaped/);
  assert.equal(fs.existsSync(path.join(root, 'x.narova')), false);
});

test('pack rejects standard credential carriers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-npmrc-'));
  project(root);
  fs.writeFileSync(path.join(root, '.npmrc'), '//registry.npmjs.org/:_authToken=npm_private_value\n');
  const output = path.join(root, 'x.narova');
  const result = run(['pack', '--project', root, '--output', output]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /secret-shaped|credential-shaped/);
  assert.equal(fs.existsSync(output), false);
});

test('pack rejects AWS credential state by path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-aws-credential-'));
  project(root);
  fs.mkdirSync(path.join(root, '.aws'));
  fs.writeFileSync(path.join(root, '.aws', 'credentials'), '[default]\naws_access_key_id=AKIAEXAMPLE12345678\n');
  const output = path.join(root, 'x.narova');
  const result = run(['pack', '--project', root, '--output', output]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /secret-shaped/);
  assert.equal(fs.existsSync(output), false);
});

test('pack rejects credential-shaped JSON assignments', () => {
  for (const contents of ['{"token":"abcd1234"}', '{"api_key": "abcd1234"}']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-json-credential-'));
    project(root);
    fs.writeFileSync(path.join(root, 'notes.json'), contents);
    const output = path.join(root, 'x.narova');
    const result = run(['pack', '--project', root, '--output', output]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /credential-shaped/);
    assert.equal(fs.existsSync(output), false);
  }
});

test('pack refuses non-archive output names before replacing project inputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-output-boundary-'));
  project(root);
  const config = path.join(root, 'reel.config.json');
  const before = fs.readFileSync(config);
  const result = run(['pack', '--project', root, '--output', config]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /\.narova extension|replace a project input/);
  assert.deepEqual(fs.readFileSync(config), before);
});

test('pack rejects nested secret names, Docker auth, and Git credential carriers', () => {
  for (const [relative, contents] of [
    ['assets/private/token.txt', 'opaque credential'],
    ['.docker/config.json', '{"auths":{"registry":{"auth":"dXNlcjpwYXNz"}}}'],
    ['.git-credentials', 'https://user:password@example.test'],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-carrier-'));
    project(root);
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    const output = path.join(root, 'x.narova');
    const result = run(['pack', '--project', root, '--output', output]);
    assert.equal(result.status, 1, `${relative}: ${result.stderr}`);
    assert.match(result.stderr, /secret-shaped/);
    assert.equal(fs.existsSync(output), false);
  }
});

test('pack rejects remote, external theme, embedded, and global voice dependencies', () => {
  const cases = [
    {
      name: 'remote visual',
      mutate(config) { config.scenes[0].visual = { type: 'image', src: 'https://example.test/pixel.png' }; },
      error: /remote dependency/,
    },
    {
      name: 'external theme',
      prepare(root) { fs.writeFileSync(path.join(root, 'outside.css'), 'body{}'); },
      mutate(config) { config.theme = { css: '../outside.css' }; },
      error: /theme\.css must be project-relative|theme\.css resolves outside|path escapes its project/,
    },
    {
      name: 'remote CSS import',
      prepare(root, source) { fs.writeFileSync(path.join(source, 'theme.css'), '@import "https://fonts.example.test/remote.css";'); },
      mutate(config) { config.theme = { css: 'theme.css' }; },
      error: /theme\.css @import is a remote dependency/,
    },
    {
      name: 'escaped remote CSS URL',
      prepare(root, source) { fs.writeFileSync(path.join(source, 'theme.css'), 'body{background:url(\\68 ttps://example.test/x.png)}'); },
      mutate(config) { config.theme = { css: 'theme.css' }; },
      error: /theme\.css url\(\) is a remote dependency/,
    },
    {
      name: 'scene CSS remote import',
      prepare(root, source) { fs.writeFileSync(path.join(source, 'scene.css'), '@import "https://fonts.example.test/remote.css";'); },
      mutate(config) { config.scenes[0].cssFile = 'scene.css'; },
      error: /cssFile @import is a remote dependency/,
    },
    {
      name: 'imported CSS remote dependency',
      prepare(root, source) { fs.writeFileSync(path.join(source, 'shared.css'), 'body{background:url(https://example.test/x.png)}'); },
      mutate(config) { config.imports = { shared: 'shared.css' }; },
      error: /config\.imports\.shared url\(\) is a remote dependency/,
    },
    {
      name: 'nested local CSS remote import',
      prepare(root, source) {
        fs.mkdirSync(path.join(source, 'styles'));
        fs.writeFileSync(path.join(source, 'theme.css'), '@import "styles/nested.css";');
        fs.writeFileSync(path.join(source, 'styles', 'nested.css'), '@import "https://fonts.example.test/remote.css";');
      },
      mutate(config) { config.theme = { css: 'theme.css' }; },
      error: /@import is a remote dependency/,
    },
    {
      name: 'HTML stylesheet link',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<link rel="stylesheet" href="https://example.test/x.css"><p>x</p>'; },
      error: /body href is a remote dependency/,
    },
    {
      name: 'quoted angle in HTML attribute',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<img alt=">" src="https://example.test/x.png">'; },
      error: /body src is a remote dependency/,
    },
    {
      name: 'HTML base URL',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<base href="https://example.test/"><img src="assets/pixel.txt">'; },
      error: /URL-base or refresh behavior/,
    },
    {
      name: 'entity-obfuscated HTML refresh',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<meta http-equiv="ref&#114;esh" content="0;url=https://example.test/">'; },
      error: /URL-base or refresh behavior/,
    },
    {
      name: 'nested iframe document',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<iframe srcdoc="&lt;img src=&quot;https://example.test/x.png&quot;&gt;"></iframe>'; },
      error: /nested frame/,
    },
    {
      name: 'HTML entity remote URL',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<img src="&#104;ttps&#58;//example.test/x.png">'; },
      error: /body src is a remote dependency/,
    },
    {
      name: 'SVG external href',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<svg><image href="https://example.test/x.svg"></image></svg>'; },
      error: /body href is a remote dependency/,
    },
    {
      name: 'SVG filter image external href',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<svg><filter><feImage href="https://example.test/x.png"></feImage></filter></svg>'; },
      error: /body href is a remote dependency/,
    },
    {
      name: 'comment-obfuscated CSS import',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<style>@import/**/"https://example.test/x.css";</style>'; },
      error: /body @import is a remote dependency/,
    },
    {
      name: 'object external data',
      mutate(config) { config.renderer = 'hyperframes'; config.scenes[0].body = '<object data="https://example.test/x.html"></object>'; },
      error: /body data is a remote dependency/,
    },
    {
      name: 'embedded missing asset',
      mutate(config) { config.scenes[0].body = '<img src="assets/missing.png">'; },
      error: /body src does not resolve/,
    },
    {
      name: 'remote srcset',
      mutate(config) {
        config.renderer = 'hyperframes';
        config.scenes[0].body = '<img srcset="https://cdn.example.test/hero.png 1x">';
      },
      error: /body srcset is a remote dependency/,
    },
    {
      name: 'mixed data srcset',
      mutate(config) {
        config.renderer = 'hyperframes';
        config.scenes[0].body = '<img srcset="data:image/svg+xml,%3Csvg%3E 1x, https://cdn.example.test/hero.png 2x">';
      },
      error: /srcset with data URLs is not supported/,
    },
    {
      name: 'runtime blob URL',
      mutate(config) {
        config.renderer = 'hyperframes';
        config.scenes[0].body = '<img src="blob:https://example.test/00000000-0000-0000-0000-000000000000">';
      },
      error: /remote dependency/,
    },
    {
      name: 'global voice sample',
      mutate(config) { config.voices.alice = { backend: 'chatterbox', speaker: 'alice' }; },
      error: /machine-local (?:saved sample|voice state)/,
      env: { NAROVA_HOME: null },
    },
    {
      name: 'browser profile',
      mutate(config) {
        config.renderer = 'hyperframes';
        config.scenes[0] = { id: 'one', dur: 1, vo: [], body: '<p>x</p>', walkthrough: 'demo' };
        config.walkthroughs = { demo: { url: 'https://example.test', profile: '/Users/alice/Chrome/Profile 1', steps: [{ action: 'wait', at: 0, ms: 1 }] } };
      },
      error: /machine-local browser state/,
    },
    {
      name: 'walkthrough file URL',
      mutate(config) {
        config.renderer = 'hyperframes';
        config.scenes[0] = { id: 'one', dur: 1, vo: [], body: '<p>x</p>', walkthrough: 'demo' };
        config.walkthroughs = { demo: { url: 'file:///Users/alice/private/demo.html', steps: [{ action: 'wait', at: 0, ms: 1 }] } };
      },
      error: /machine-local file URL/,
    },
    {
      name: 'variant-only external asset',
      mutate(config) {
        config.variants = [{ id: 'alt', kind: 'visual', sceneOverrides: { one: { elements: [{ type: 'camera', position: [0, 0, 5] }, { type: 'cube', map: '/Users/alice/private/hero.png' }] } } }];
      },
      error: /must be (?:a portable )?project-relative/,
    },
  ];
  for (const item of cases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-dependency-'));
    const source = path.join(root, 'source');
    project(source);
    if (item.prepare) item.prepare(root, source);
    const file = path.join(source, 'reel.config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    item.mutate(config);
    fs.writeFileSync(file, JSON.stringify(config));
    if (item.name === 'global voice sample') {
      const sampleDir = path.join(root, 'home', 'samples');
      fs.mkdirSync(sampleDir, { recursive: true });
      fs.writeFileSync(path.join(sampleDir, 'alice.wav'), 'voice');
      const result = spawnSync(process.execPath, [BIN, 'pack', '--project', source, '--output', path.join(root, 'x.narova')], {
        encoding: 'utf8', env: { ...process.env, NAROVA_FIRST_RUN: '0', NAROVA_HOME: path.join(root, 'home') },
      });
      assert.equal(result.status, 1, `${item.name}: ${result.stderr}`);
      assert.match(result.stderr, item.error);
    } else {
      const result = run(['pack', '--project', source, '--output', path.join(root, 'x.narova')]);
      assert.equal(result.status, 1, `${item.name}: ${result.stderr}`);
      assert.match(result.stderr, item.error);
    }
  }
});

test('pack resolves query and fragment suffixes on browser resource URLs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-url-suffix-'));
  project(root);
  const configFile = path.join(root, 'reel.config.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  config.renderer = 'hyperframes';
  config.scenes[0].body = '<img src="assets/pixel.txt?v=1#hero">';
  delete config.scenes[0].visual;
  fs.writeFileSync(configFile, JSON.stringify(config));
  const result = run(['pack', '--project', root, '--output', path.join(root, 'project.narova')]);
  assert.equal(result.status, 0, result.stderr);
});

test('pack recursively closes local SVG resources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-svg-closure-pack-'));
  project(root);
  fs.writeFileSync(path.join(root, 'assets', 'local.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/remote.png"/></svg>');
  const configFile = path.join(root, 'reel.config.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  config.renderer = 'hyperframes';
  config.scenes[0].body = '<img src="assets/local.svg">';
  delete config.scenes[0].visual;
  fs.writeFileSync(configFile, JSON.stringify(config));
  const result = run(['pack', '--project', root, '--output', path.join(root, 'project.narova')]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /href is a remote dependency/);
});

test('open rejects forbidden archive state before extraction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-open-profile-'));
  const file = path.join(root, 'hostile.narova');
  fs.writeFileSync(file, archive([
    { path: 'reel.config.json', data: Buffer.from('{}') },
    { path: '.git/hooks/post-checkout', data: Buffer.from('#!/bin/sh\necho hostile\n') },
  ]));
  const target = path.join(root, 'opened');
  const inspected = run(['open', file, '--inspect']);
  assert.equal(inspected.status, 1, inspected.stderr);
  assert.throws(() => openArchive(file, target), /forbidden generated, repository, or nested-archive state/);
  assert.equal(fs.existsSync(target), false);
});

test('open rejects incomplete tracked-asset closure before extraction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-open-asset-closure-'));
  const lock = Buffer.from(JSON.stringify({
    version: 1,
    assets: [{
      file: 'assets/missing.png', kind: 'image', bytes: 1, sha256: '0'.repeat(64),
      origin: { mode: 'local' }, rights: { status: 'unknown' }, acquiredAt: '2026-08-20T00:00:00.000Z',
    }],
  }));
  const file = path.join(root, 'incomplete.narova');
  fs.writeFileSync(file, archive([
    { path: 'reel.config.json', data: Buffer.from('{}') },
    { path: 'assets.lock.json', data: lock },
  ]));
  const target = path.join(root, 'opened');
  assert.throws(() => openArchive(file, target), /tracked asset dependency would be excluded/);
  assert.equal(fs.existsSync(target), false);
});

test('inspect, open, and remix apply non-executing dependency closure to received projects', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-received-closure-'));
  const config = Buffer.from(JSON.stringify({
    title: 'Remote', renderer: 'hyperframes', voices: {},
    scenes: [{ id: 'one', dur: 1, vo: [], body: '<img src="https://example.test/x.png">' }],
  }));
  const file = path.join(root, 'remote.narova');
  fs.writeFileSync(file, archive([{ path: 'reel.config.json', data: config }]));
  assert.equal(run(['open', file, '--inspect']).status, 1);
  assert.throws(() => openArchive(file, path.join(root, 'opened')), /remote dependency/);
  await assert.rejects(remix(file, path.join(root, 'archive-remix')), /remote dependency/);

  const directory = path.join(root, 'directory');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'reel.config.json'), config);
  await assert.rejects(remix(directory, path.join(root, 'directory-remix')), /remote dependency/);

  const repository = zipStored([{ path: 'repo-deadbeef/reel.config.json', data: config }]);
  const fetchImpl = async url => (url.includes('/commits/')
    ? new Response(JSON.stringify({ sha: 'a'.repeat(40) }), { status: 200 })
    : new Response(repository, { status: 200 }));
  await assert.rejects(remix('github:owner/repo#main', path.join(root, 'github-remix'), { fetchImpl }), /remote dependency/);

  for (const [field, member, contents] of [
    ['visualFile', 'visual.json', { type: 'image', src: 'https://example.test/remote.png' }],
    ['threeFile', 'three.json', { objects: [{ type: 'plane', map: 'https://example.test/remote.png' }] }],
    ['elementsFile', 'elements.json', [{ type: 'cube', map: 'https://example.test/remote.png' }]],
  ]) {
    const fileConfig = Buffer.from(JSON.stringify({
      title: 'File-backed', renderer: 'no-browser', voices: {},
      scenes: [{ id: 'one', dur: 1, vo: [], [field]: member }],
    }));
    const received = path.join(root, `${field}.narova`);
    fs.writeFileSync(received, archive([
      { path: 'reel.config.json', data: fileConfig },
      { path: member, data: Buffer.from(JSON.stringify(contents)) },
    ]));
    assert.throws(() => openArchive(received, path.join(root, `${field}-opened`)), /remote dependency/, field);
  }

  const nestedConfig = Buffer.from(JSON.stringify({
    title: 'Nested SVG', renderer: 'hyperframes', voices: {},
    scenes: [{ id: 'one', dur: 1, vo: [], body: '<img src="assets/local.svg">' }],
  }));
  const nested = path.join(root, 'nested-svg.narova');
  fs.writeFileSync(nested, archive([
    { path: 'reel.config.json', data: nestedConfig },
    { path: 'assets/local.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="missing.png"/></svg>') },
  ]));
  assert.throws(() => openArchive(nested, path.join(root, 'nested-opened')), /does not resolve to an archived project file/);
});

test('inspection identity cannot be overridden by untrusted manifest fields', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-inspection-identity-'));
  const entries = [{ path: 'reel.config.json', data: Buffer.from('{}') }];
  const manifest = { ...manifestFor(entries), path: 'spoofed', sha256: '0'.repeat(64) };
  const file = path.join(root, 'real.narova');
  const bytes = zipStored([{ path: MANIFEST_PATH, data: Buffer.from(JSON.stringify(manifest)) }, ...entries]);
  fs.writeFileSync(file, bytes);
  const inspected = JSON.parse(run(['open', file, '--inspect', '--json']).stdout).data;
  assert.equal(inspected.path, file);
  assert.equal(inspected.sha256, sha256(bytes));
});

test('pack omits Git pointer files and validates manifest source metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-pack-git-marker-'));
  project(root);
  fs.writeFileSync(path.join(root, '.git'), 'gitdir: /tmp/private/worktree\n');
  const output = path.join(root, 'valid.narova');
  assert.equal(run(['pack', '--project', root, '--output', output]).status, 0);
  assert.equal(readArchiveBytes(fs.readFileSync(output)).entries.some(entry => entry.path === '.git'), false);
  assert.equal(run(['open', output, '--inspect']).status, 0);

  const configFile = path.join(root, 'reel.config.json');
  const config = JSON.parse(fs.readFileSync(configFile));
  config.title = 'bad\u001b[2J';
  fs.writeFileSync(configFile, JSON.stringify(config));
  const invalid = run(['pack', '--project', root, '--output', path.join(root, 'invalid.narova')]);
  assert.equal(invalid.status, 1, invalid.stderr);
  assert.match(invalid.stderr, /archive source title.*control characters/);
});

test('inspection and lineage output never emit terminal controls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-terminal-output-'));
  const archivePath = path.join(root, 'safe\u001b[2J.narova');
  fs.writeFileSync(archivePath, archive([{ path: 'reel.config.json', data: Buffer.from('{}') }]));
  const inspected = run(['open', archivePath, '--inspect']);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(inspected.stdout.includes('\u001b'), false);
  assert.match(inspected.stdout, /\\u001b/);

  const projectDir = path.join(root, 'project');
  project(projectDir);
  fs.writeFileSync(path.join(projectDir, REMIX_PATH), JSON.stringify({
    schema: 'narova.remix/1',
    parent: { kind: 'github', locator: 'github:safe/repo#main\u001b[2J', commit: 'a'.repeat(40) },
  }));
  const provenance = run(['provenance', '--project', projectDir]);
  assert.equal(provenance.status, 0, provenance.stderr);
  assert.equal(provenance.stdout.includes('\u001b'), false);
  assert.match(provenance.stdout, /remix lineage unreadable/);

  const executable = path.join(root, 'executable');
  fs.mkdirSync(executable);
  fs.writeFileSync(path.join(executable, 'reel.config.cjs'), `require('./missing\\x1b[2J.cjs'); module.exports={renderer:'no-browser',voices:{},scenes:[{id:'x',dur:1,vo:[],visual:{type:'text',text:'x'}}]};\n`);
  const packed = run(['pack', '--project', executable, '--output', path.join(root, 'bad.narova')]);
  assert.equal(packed.status, 1);
  assert.equal(packed.stderr.includes('\u001b'), false);
});

test('pack rejects project-external dependencies instead of leaking their paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-external-'));
  const source = path.join(root, 'source');
  project(source);
  const outside = path.join(root, 'outside.mp4');
  fs.writeFileSync(outside, 'outside');
  const configFile = path.join(source, 'reel.config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.scenes[0].clip = outside;
  fs.writeFileSync(configFile, JSON.stringify(config));
  const output = path.join(root, 'x.narova');
  const result = run(['pack', '--project', source, '--output', output]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be (?:a portable )?project-relative/);
  assert.equal(fs.existsSync(output), false);
});

test('pack refuses a missing tracked asset without replacing an archive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-missing-asset-'));
  project(root);
  fs.writeFileSync(path.join(root, 'assets.lock.json'), JSON.stringify({
    version: 1,
    assets: [{
      file: 'assets/missing.png', kind: 'image', bytes: 1, sha256: '0'.repeat(64),
      origin: { mode: 'local' }, rights: { status: 'unknown' }, acquiredAt: '2026-08-20T00:00:00.000Z',
    }],
  }));
  const output = path.join(root, 'existing.narova');
  fs.writeFileSync(output, 'keep');
  const result = run(['pack', '--project', root, '--output', output, '--json']);
  assert.equal(result.status, 3, result.stderr);
  assert.match(result.stderr, /tracked project assets do not verify/);
  assert.equal(fs.readFileSync(output, 'utf8'), 'keep');
});

test('pack fails when an exclusion would strand a tracked asset record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-archive-tracked-exclusion-'));
  project(root);
  const nested = Buffer.from('nested archive bytes');
  fs.writeFileSync(path.join(root, 'assets', 'child.narova'), nested);
  fs.writeFileSync(path.join(root, 'assets.lock.json'), JSON.stringify({
    version: 1,
    assets: [{
      file: 'assets/child.narova', kind: 'file', bytes: nested.length, sha256: sha256(nested),
      origin: { mode: 'local' }, rights: { status: 'unknown' }, acquiredAt: '2026-08-20T00:00:00.000Z',
    }],
  }));
  const output = path.join(root, 'x.narova');
  const result = run(['pack', '--project', root, '--output', output]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tracked asset dependency would be excluded/);
  assert.equal(fs.existsSync(output), false);
});

test('archive and directory remix start without output history and report lineage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-remix-local-'));
  const source = path.join(root, 'source');
  const packed = path.join(root, 'source.narova');
  project(source);
  fs.mkdirSync(path.join(source, 'out'));
  fs.writeFileSync(path.join(source, 'out', 'revisions.jsonl'), '{}\n');
  assert.equal(run(['pack', '--project', source, '--output', packed]).status, 0);
  fs.rmSync(path.join(source, 'out'), { recursive: true });
  fs.mkdirSync(path.join(source, 'Out'));
  fs.writeFileSync(path.join(source, 'Out', 'video.mp4'), 'output alias');
  fs.writeFileSync(path.join(source, 'old.NAROVA'), 'nested alias');
  fs.writeFileSync(path.join(source, '.NAROVA-REMIX.JSON'), '{"schema":"old"}\n');
  const fromArchive = await remix(packed, path.join(root, 'archive-remix'));
  const fromDirectory = await remix(source, path.join(root, 'directory-remix'));
  for (const result of [fromArchive, fromDirectory]) {
    assert.equal(fs.existsSync(path.join(result.target, 'out')), false);
    assert.equal(fs.existsSync(path.join(result.target, 'Out')), false);
    assert.equal(fs.existsSync(path.join(result.target, 'old.NAROVA')), false);
    assert.equal(fs.readdirSync(result.target).includes('.NAROVA-REMIX.JSON'), false);
    assert.equal(fs.existsSync(path.join(result.target, REMIX_PATH)), true);
    const provenance = run(['provenance', '--project', result.target, '--json']);
    assert.equal(provenance.status, 0, provenance.stderr);
    assert.equal(JSON.parse(provenance.stdout).data.lineage.parent.kind, result.origin.kind);
  }
  fs.writeFileSync(path.join(source, 'assets', 'pixel.txt'), 'changed');
  assert.equal(fs.readFileSync(path.join(fromDirectory.target, 'assets', 'pixel.txt'), 'utf8'), 'project asset\n');
});

test('archive remix reapplies freshness and credential filters', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-remix-hostile-state-'));
  const config = { path: 'reel.config.json', data: Buffer.from('{"voices":{},"scenes":[]}') };
  const withHistory = path.join(root, 'history.narova');
  fs.writeFileSync(withHistory, archive([
    config,
    { path: 'out/revisions.jsonl', data: Buffer.from('history') },
    { path: '.git/config', data: Buffer.from('repository state') },
  ]));
  const result = await remix(withHistory, path.join(root, 'fresh'));
  assert.equal(fs.existsSync(path.join(result.target, 'out')), false);
  assert.equal(fs.existsSync(path.join(result.target, '.git')), false);

  const withSecret = path.join(root, 'secret.narova');
  fs.writeFileSync(withSecret, archive([config, { path: '.env', data: Buffer.from('SAFE_NAME=opaque') }]));
  await assert.rejects(remix(withSecret, path.join(root, 'secret-target')), /secret-shaped/);
  assert.equal(fs.existsSync(path.join(root, 'secret-target')), false);
});

test('directory remix rejects a tracked dependency removed by freshness rules', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-remix-tracked-exclusion-'));
  const source = path.join(root, 'source');
  project(source);
  const nested = Buffer.from('nested archive bytes');
  fs.writeFileSync(path.join(source, 'assets', 'child.narova'), nested);
  fs.writeFileSync(path.join(source, 'assets.lock.json'), JSON.stringify({
    version: 1,
    assets: [{
      file: 'assets/child.narova', kind: 'file', bytes: nested.length, sha256: sha256(nested),
      origin: { mode: 'local' }, rights: { status: 'unknown' }, acquiredAt: '2026-08-20T00:00:00.000Z',
    }],
  }));
  const target = path.join(root, 'remix');
  await assert.rejects(remix(source, target), /tracked asset dependency would be excluded/);
  assert.equal(fs.existsSync(target), false);
});

test('directory remix resolves every existing symlink ancestor before overlap checks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-remix-symlink-overlap-'));
  const source = path.join(root, 'source');
  const alias = path.join(root, 'alias');
  project(source);
  fs.symlinkSync(source, alias, 'dir');
  const target = path.join(alias, 'missing', 'target');
  await assert.rejects(remix(alias, target), /source and target must not overlap/);
  assert.equal(fs.existsSync(target), false);
});

test('github remix is bounded, records resolved commit, and never executes fetched config', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-remix-github-'));
  const config = Buffer.from("throw new Error('fetched config executed'); module.exports={voices:{},scenes:[]};");
  const repository = zipStored([
    { path: 'repo-deadbeef/creative-brief.md', data: Buffer.from('# Brief') },
    { path: 'repo-deadbeef/out/video.mp4', data: Buffer.from('excluded') },
    { path: 'repo-deadbeef/reel.config.cjs', data: config },
  ]);
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes('/commits/')) return new Response(JSON.stringify({ sha: 'a'.repeat(40) }), { status: 200 });
    return new Response(repository, { status: 200, headers: { 'content-type': 'application/zip' } });
  };
  const result = await remix('github:owner/repo#main', path.join(root, 'remix'), { fetchImpl });
  assert.equal(result.origin.commit, 'a'.repeat(40));
  assert.equal(result.origin.locator, 'github:owner/repo#main');
  assert.equal(calls.length, 2);
  assert.equal(fs.existsSync(path.join(result.target, 'out')), false);
});

test('remix reserves member capacity for its lineage record', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-remix-lineage-limit-'));
  const entries = [{ path: 'repo-deadbeef/reel.config.json', data: Buffer.from('{"voices":{},"scenes":[]}') }];
  for (let index = 0; index < 9_999; index++) {
    entries.push({ path: `repo-deadbeef/files/${String(index).padStart(4, '0')}.txt`, data: Buffer.alloc(0) });
  }
  const repository = zipStored(entries);
  const fetchImpl = async url => (url.includes('/commits/')
    ? new Response(JSON.stringify({ sha: 'a'.repeat(40) }), { status: 200 })
    : new Response(repository, { status: 200 }));
  await assert.rejects(
    remix('github:owner/repo#main', path.join(root, 'remix'), { fetchImpl }),
    /more than 10000 files after adding lineage/,
  );
  assert.equal(fs.existsSync(path.join(root, 'remix')), false);
});

test('unknown remote locator schemes fail without a network request', async () => {
  let requested = false;
  await assert.rejects(
    remix('https://example.test/project', path.join(os.tmpdir(), `narova-no-fetch-${Date.now()}`), {
      fetchImpl: async () => { requested = true; throw new Error('unexpected request'); },
    }),
    /must match github:/,
  );
  assert.equal(requested, false);
});
