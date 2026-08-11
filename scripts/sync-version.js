'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

function syncVersion(root = DEFAULT_ROOT, logger = console) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  logger.log(`Canonical version: ${version}`);

  function update(paths, replacer) {
    for (const relative of paths) {
      const absolute = path.join(root, relative);
      const old = fs.readFileSync(absolute, 'utf8');
      const updated = replacer(old, version);
      if (updated !== old) {
        fs.writeFileSync(absolute, updated, 'utf8');
        logger.log(`  ✓ ${relative}`);
      } else {
        logger.log(`  = ${relative} (already ${version})`);
      }
    }
  }

  // SKILL.md — metadata.version and exact npm bootstrap pin
  update(['skills/narova/SKILL.md'], (source, next) => source
    .replace(/(\n\s{2}version:\s*)"[^"]*"/, `$1"${next}"`)
    .replace(/(@narova\/narova@)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/, `$1${next}`));

  // tool package.json — top-level version
  update(['tool/package.json'], (source, next) =>
    source.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${next}"`));

  // tool/package-lock.json — root package and lock metadata versions
  update(['tool/package-lock.json'], (source, next) => {
    const lock = JSON.parse(source);
    lock.version = next;
    if (lock.packages && lock.packages['']) lock.packages[''].version = next;
    return `${JSON.stringify(lock, null, 2)}\n`;
  });

  // README.md — badge URL
  update(['README.md'], (source, next) =>
    source.replace(/(badge\/version-)[0-9.]+(-)/, `$1${next}$2`));

  // SPEC.md — Status line
  update(['SPEC.md'], (source, next) =>
    source.replace(/^(## Status: +)[0-9.]+( +shipped)/m, `$1${next}$2`));

  // Website — current-version markers on the landing page and changelog.
  // Only update the first occurrence (the current/latest release entry).
  update(['docs/index.html', 'docs/changelog/index.html'], (source, next) => {
    const updated = source.replace(
      /(<[^>]+data-narova-version[^>]*>v?)[0-9.]+(<\/[^>]+>)/,
      `$1${next}$2`,
    );
    const count = (updated.match(/data-narova-version/g) || []).length;
    if (count > 1) {
      logger.warn(`  ⚠ ${count} data-narova-version markers found — only the first was updated. Remove the attribute from older release entries.`);
    }
    return updated;
  });

  logger.log('Done.');
  return version;
}

if (require.main === module) syncVersion();

module.exports = { syncVersion };
