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

// Website — current-version markers on the landing page and changelog.
// Only update the FIRST occurrence (the current/latest release entry).
// Contract: exactly one element per HTML file may carry data-narova-version.
// Historical releases (0.20.0, 0.19.0, ...) must NOT have this attribute —
// only the current version's release article or hero badge. If a fresh release
// entry is added with the attribute, the old one must have it removed.
update(['docs/index.html', 'docs/changelog/index.html'], (s, ver) => {
  const updated = s.replace(
    /(<[^>]+data-narova-version[^>]*>v?)[0-9.]+(<\/[^>]+>)/,
    `$1${ver}$2`
  );
  // Safety: if more than one marker attribute remains, the old release entry
  // wasn't cleaned up. Warn but don't block — the first match is authoritative.
  const count = (updated.match(/data-narova-version/g) || []).length;
  if (count > 1) {
    console.warn(`  ⚠ ${count} data-narova-version markers found — only the first was updated. Remove the attribute from older release entries.`);
  }
  return updated;
});

console.log('Done.');
