const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const V = PKG.version;
console.log(`Canonical version: ${V}`);

function update(paths, replacer) {
  for (const p of paths) {
    const abs = path.join(ROOT, p);
    const old = fs.readFileSync(abs, 'utf8');
    const updated = replacer(old, V);
    if (updated !== old) {
      fs.writeFileSync(abs, updated, 'utf8');
      console.log(`  ✓ ${p}`);
    } else {
      console.log(`  = ${p} (already ${V})`);
    }
  }
}

// SKILL.md — metadata.version
update(['skills/narova/SKILL.md'], (s, ver) =>
  s.replace(/(\n\s{2}version:\s*)"[^"]*"/, `$1"${ver}"`)
);

// tool package.json — top-level version
update(['skills/narova/tool/package.json'], (s, ver) =>
  s.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${ver}"`)
);

// README.md — badge URL
update(['README.md'], (s, ver) =>
  s.replace(/(badge\/version-)[0-9.]+(-)/, `$1${ver}$2`)
);

// SPEC.md — Status line
update(['SPEC.md'], (s, ver) =>
  s.replace(/^(## Status: +)[0-9.]+( +shipped)/m, `$1${ver}$2`)
);

console.log('Done.');
