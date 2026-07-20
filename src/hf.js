'use strict';
/* HyperFrames CLI access. narova stays zero-dep: every call goes through
 * `npx --yes hyperframes@<PIN>` so the engine version is reproducible. The same
 * pin is written into the generated out/hf/package.json. */
const { spawnSync } = require('child_process');

const HYPERFRAMES_VERSION = '0.7.64';

/* Run a hyperframes CLI command in `cwd` (normally out/hf). Inherits stdio so
 * progress is visible. Throws on non-zero exit. */
function runHf(args, cwd, opts = {}) {
  const r = spawnSync('npx', ['--yes', `hyperframes@${HYPERFRAMES_VERSION}`, ...args], {
    cwd, stdio: 'inherit', ...opts,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`hyperframes ${args[0]} exited ${r.status}`);
  return r;
}

module.exports = { HYPERFRAMES_VERSION, runHf };
