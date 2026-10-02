'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Exercise npm's real lifecycle offline. Every expensive check is a recording
// double; npm publish is explicitly dry-run and the package has no dependencies.
for (const failure of ['', 'integration', 'tool-js', 'package-install']) {
  test(`tagged publish lifecycle ${failure ? 'stops at ' + failure : 'executes each check once'}`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'narova-publish-lifecycle-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'tool'));
    fs.mkdirSync(path.join(root, 'scripts'));
    const repository = JSON.parse(JSON.stringify(require('../package.json')));
    const tool = JSON.parse(JSON.stringify(require('../tool/package.json')));
    const log = path.join(root, 'checks.log');
    fs.writeFileSync(path.join(root, 'probe.cjs'), [
      "const fs = require('node:fs');",
      "const name = process.argv[2];",
      "fs.appendFileSync(process.env.CHECK_LOG, name + '\\n');",
      "if (name === process.env.FAIL_CHECK) process.exit(23);",
    ].join('\n'));
    for (const name of ['integration', '3d', 'elevenlabs', 'openai', 'runway', 'google', 'mimo']) {
      repository.scripts['test:' + name] = `node probe.cjs ${name}`;
    }
    for (const [file, label] of [
      ['check-release', 'metadata'], ['check-package', 'package'], ['test-packed-package', 'package-install'],
    ]) {
      fs.writeFileSync(path.join(root, 'scripts', file + '.js'),
        `process.argv[2] = ${JSON.stringify(label)}; require('../probe.cjs');`);
    }
    tool.name = 'narova-offline-lifecycle-fixture';
    tool.scripts['test:js'] = 'node ../probe.cjs tool-js';
    tool.scripts['test:py'] = 'node ../probe.cjs tool-py';
    delete tool.optionalDependencies;
    delete tool.bin;
    tool.files = ['package.json'];
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(repository));
    fs.writeFileSync(path.join(root, 'tool', 'package.json'), JSON.stringify(tool));
    const result = spawnSync('/bin/sh', ['-c',
      'npm run -s release:prepublish && cd tool && npm publish --dry-run --access public --provenance'],
    { cwd: root, encoding: 'utf8', timeout: 60000, env: {
      ...process.env, CHECK_LOG: log, FAIL_CHECK: failure,
      npm_config_cache: path.join(root, 'npm-cache'), npm_config_offline: 'true',
      npm_config_ignore_scripts: 'false',
    } });
    const observed = fs.readFileSync(log, 'utf8').trim().split('\n');
    const expected = ['integration', '3d', 'elevenlabs', 'openai', 'runway', 'google', 'mimo',
      'metadata', 'tool-js', 'tool-py', 'package', 'package-install'];
    assert.deepEqual(observed, failure ? expected.slice(0, expected.indexOf(failure) + 1) : expected);
    if (failure) assert.notEqual(result.status, 0);
    else assert.equal(result.status, 0, result.stderr);
  });
}
