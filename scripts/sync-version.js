'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

function assertNoDuplicateJsonKeys(source, label) {
  let index = 0;

  const fail = message => {
    throw new Error(`${label}: ${message}`);
  };
  const skipWhitespace = () => {
    while (/\s/.test(source[index] || '')) index += 1;
  };
  const parseString = () => {
    if (source[index] !== '"') fail(`expected a JSON string at offset ${index}`);
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
      } else if (source[index] === '"') {
        index += 1;
        return JSON.parse(source.slice(start, index));
      } else {
        index += 1;
      }
    }
    fail(`unterminated JSON string at offset ${start}`);
    return '';
  };

  const parseValue = valuePath => {
    skipWhitespace();
    if (source[index] === '{') {
      parseObject(valuePath);
      return;
    }
    if (source[index] === '[') {
      parseArray(valuePath);
      return;
    }
    if (source[index] === '"') {
      parseString();
      return;
    }
    const start = index;
    while (index < source.length && !/[\s,\]}]/.test(source[index])) index += 1;
    if (index === start) fail(`expected a JSON value at offset ${index}`);
  };

  const parseObject = objectPath => {
    index += 1;
    skipWhitespace();
    const keys = new Set();
    if (source[index] === '}') {
      index += 1;
      return;
    }
    while (index < source.length) {
      const key = parseString();
      const keyPath = `${objectPath}[${JSON.stringify(key)}]`;
      if (keys.has(key)) fail(`duplicate JSON key ${keyPath}`);
      keys.add(key);
      skipWhitespace();
      if (source[index] !== ':') fail(`expected ':' after ${keyPath}`);
      index += 1;
      parseValue(keyPath);
      skipWhitespace();
      if (source[index] === '}') {
        index += 1;
        return;
      }
      if (source[index] !== ',') fail(`expected ',' after ${keyPath}`);
      index += 1;
      skipWhitespace();
    }
    fail(`unterminated JSON object ${objectPath}`);
  };

  const parseArray = arrayPath => {
    index += 1;
    skipWhitespace();
    if (source[index] === ']') {
      index += 1;
      return;
    }
    let item = 0;
    while (index < source.length) {
      parseValue(`${arrayPath}[${item}]`);
      item += 1;
      skipWhitespace();
      if (source[index] === ']') {
        index += 1;
        return;
      }
      if (source[index] !== ',') fail(`expected ',' in ${arrayPath}`);
      index += 1;
      skipWhitespace();
    }
    fail(`unterminated JSON array ${arrayPath}`);
  };

  parseValue('$');
  skipWhitespace();
  if (index !== source.length) fail(`unexpected content at offset ${index}`);
}

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

  function exactlyOneMatch(source, pattern, label) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
    if (matches.length !== 1) {
      throw new Error(`${label}: expected exactly one version surface, found ${matches.length}`);
    }
    return matches[0];
  }

  function replaceExactlyOne(source, pattern, replacement, label) {
    exactlyOneMatch(source, pattern, label);
    return source.replace(pattern, replacement);
  }

  // SKILL.md — metadata.version and exact npm bootstrap pin
  update(['skills/narova/SKILL.md'], (source, next) => {
    const metadata = replaceExactlyOne(
      source,
      /(\n\s{2}version:\s*)"[^"]*"/,
      `$1"${next}"`,
      'skills/narova/SKILL.md metadata.version',
    );
    return replaceExactlyOne(
      metadata,
      /(@narova\/narova@)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/,
      `$1${next}`,
      'skills/narova/SKILL.md exact npm compatibility pin',
    );
  });

  // tool package.json — top-level version
  update(['tool/package.json'], (source, next) =>
    replaceExactlyOne(
      source,
      /("version"\s*:\s*)"[^"]*"/,
      `$1"${next}"`,
      'tool/package.json version',
    ));

  // tool/package-lock.json — root package and lock metadata versions
  update(['tool/package-lock.json'], (source, next) => {
    // JSON.parse silently keeps the last duplicate key, so reject duplicates
    // structurally before parsing regardless of whitespace or formatting.
    assertNoDuplicateJsonKeys(source, 'tool/package-lock.json');
    const lock = JSON.parse(source);
    if (!Object.hasOwn(lock, 'version')
        || !lock.packages
        || !Object.hasOwn(lock.packages, '')
        || !Object.hasOwn(lock.packages[''], 'version')) {
      throw new Error('tool/package-lock.json: missing lock or root package version surface');
    }
    lock.version = next;
    lock.packages[''].version = next;
    return `${JSON.stringify(lock, null, 2)}\n`;
  });

  // README.md — badge URL
  update(['README.md'], (source, next) =>
    replaceExactlyOne(
      source,
      /(badge\/version-)[0-9.]+(-)/,
      `$1${next}$2`,
      'README.md version badge',
    ));

  // AGENT_PROTOCOL.md — release identity for the shipped machine contract.
  update(['AGENT_PROTOCOL.md', 'tool/AGENT_PROTOCOL.md'], (source, next) =>
    replaceExactlyOne(
      source,
      /^(Narova release: \*\*)[0-9.]+(\*\*)/m,
      `$1${next}$2`,
      'AGENT_PROTOCOL.md release identity',
    ));

  // Website — current-version markers on the landing page and changelog.
  // Only update the first occurrence (the current/latest release entry).
  update(['docs/index.html', 'docs/changelog/index.html'], (source, next) => {
    const updated = replaceExactlyOne(
      source,
      /(<[^>]+data-narova-version[^>]*>v?)[0-9.]+(<\/[^>]+>)/,
      `$1${next}$2`,
      'website current version marker',
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
