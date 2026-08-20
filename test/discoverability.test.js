'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const homeUrl = 'https://ammar-hasan.github.io/narova/';
const changelogUrl = `${homeUrl}changelog/`;
const npmUrl = 'https://www.npmjs.com/package/@narova/narova';
const skillUrl = 'https://skills.sh/ammar-hasan/narova';
const releaseDate = '2026-08-12';
const expectedKeywords = [
  'video',
  'video-generation',
  'prompt-to-video',
  'text-to-video',
  'programmatic-video',
  'video-cli',
  'agent-skills',
  'motion-graphics',
  'text-to-speech',
  'tts',
  'captions',
  'subtitles',
  'ffmpeg',
  'threejs',
  'local-first',
];

function expectHeadMetadata(html, canonicalUrl) {
  const head = html.match(/<head>\s*([\s\S]*?)\s*<\/head>/i)?.[1];
  assert.ok(head, 'missing document head');
  const canonicals = [...head.matchAll(/<link rel="canonical" href="([^"]+)">/g)]
    .map(match => match[1]);
  assert.deepEqual(canonicals, [canonicalUrl]);
  assert.match(head, /<meta property="og:type" content="website">/);
  assert.equal(
    head.match(/<meta property="og:url" content="([^"]+)">/)?.[1],
    canonicalUrl,
  );
  for (const property of [
    'og:title',
    'og:description',
    'og:image',
    'og:image:type',
    'og:image:width',
    'og:image:height',
    'og:image:alt',
    'og:site_name',
    'og:locale',
  ]) {
    assert.match(head, new RegExp(`<meta property="${property}" content="[^"]+">`));
  }
  for (const name of [
    'twitter:card',
    'twitter:title',
    'twitter:description',
    'twitter:image',
    'twitter:image:alt',
  ]) {
    assert.match(head, new RegExp(`<meta name="${name}" content="[^"]+">`));
  }
}

test('npm metadata uses focused prompt-to-video discovery language', () => {
  const pkg = JSON.parse(read('tool/package.json'));
  assert.equal(
    pkg.description,
    'Local-first prompt-to-video CLI for AI agents, with deterministic scene scripts, TTS, word-synced captions, product walkthroughs, and 2D/3D rendering.',
  );
  assert.deepEqual(pkg.keywords, expectedKeywords);
});

test('READMEs lead with the product category and distribution links', () => {
  const repositoryReadme = read('README.md');
  const packageReadme = read('tool/README.md');
  assert.match(repositoryReadme, /^# Narova — prompt-to-video CLI and agent skill$/m);
  assert.match(packageReadme, /^# Narova — local-first prompt-to-video CLI$/m);
  for (const content of [repositoryReadme, packageReadme]) {
    assert.match(content, new RegExp(npmUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(content, new RegExp(skillUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(repositoryReadme, /\[`--json` protocol\]\(AGENT_PROTOCOL\.md\)/);
  assert.ok(fs.existsSync(path.join(root, 'AGENT_PROTOCOL.md')));
});

test('website metadata and hero present the skill without making people secondary', () => {
  const home = read('docs/index.html');
  const changelog = read('docs/changelog/index.html');
  expectHeadMetadata(home, homeUrl);
  expectHeadMetadata(changelog, changelogUrl);
  assert.match(home, /<title>[^<]*prompt-to-video skill and local CLI[^<]*<\/title>/i);
  assert.match(home, /<p class="kicker reveal-line">Open-source prompt-to-video<\/p>/);
  assert.match(home, /<h1[^>]*>[\s\S]*Prompt in\.[\s\S]*Directed video out\.[\s\S]*<\/h1>/);
  assert.match(home, /<p class="hero-sub reveal-line">[\s\S]*work interactively[\s\S]*agent run unattended[\s\S]*skill directs the work[\s\S]*local CLI handles[\s\S]*<\/p>/i);
  assert.doesNotMatch(home, /for AI agents/i);
  assert.match(changelog, /<title>[^<]*prompt-to-video[^<]*agent skill[^<]*<\/title>/i);
  assert.match(home, new RegExp(`href="${npmUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(home, new RegExp(`href="${skillUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(home, /<link rel="icon" href="assets\/favicon\.svg" type="image\/svg\+xml">/);
  assert.ok(fs.existsSync(path.join(root, 'docs/assets/favicon.svg')));
});

test('animated hero headline preserves word-level wrapping', () => {
  const script = read('docs/app.js');
  const styles = read('docs/style.css');
  assert.match(script, /text\.trim\(\)\.split\(\/\\s\+\/\)/);
  assert.match(script, /wordSpan\.className = "word"/);
  assert.match(script, /createTextNode\(" "\)/);
  assert.doesNotMatch(script, /ch === " " \? " "/);
  assert.match(styles, /\.hero-title\s*\{[^}]*text-wrap:\s*balance;/s);
  assert.match(styles, /\.ht-line \.word\s*\{[^}]*display:\s*inline-block;[^}]*white-space:\s*nowrap;/s);
});

test('structured data is accurate, evergreen, and free of invented reviews', () => {
  const html = read('docs/index.html');
  const source = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(source, 'missing JSON-LD');
  const data = JSON.parse(source);
  const graph = data['@graph'];
  const webPage = graph.find(item => item['@type'] === 'WebPage');
  const software = graph.find(item => item['@type'] === 'SoftwareApplication');
  assert.equal(webPage.url, homeUrl);
  assert.equal(webPage['@id'], `${homeUrl}#webpage`);
  assert.equal(software['@id'], `${homeUrl}#software`);
  assert.equal(software.name, 'Narova');
  assert.match(webPage.name, /prompt-to-video skill and local CLI/i);
  assert.match(webPage.description, /agent skill and local CLI/i);
  assert.match(software.description, /agent skill with a local CLI/i);
  assert.doesNotMatch(JSON.stringify(data), /for AI agents/i);
  assert.equal(software.applicationCategory, 'DeveloperApplication');
  assert.equal(software.downloadUrl, npmUrl);
  assert.equal(software.codeRepository, 'https://github.com/ammar-hasan/narova');
  assert.equal(software.license, 'https://github.com/ammar-hasan/narova/blob/main/LICENSE');
  assert.equal(software.offers['@type'], 'Offer');
  assert.equal(software.offers.price, '0');
  assert.equal(software.offers.priceCurrency, 'USD');
  assert.equal(software.softwareVersion, undefined);
  assert.equal(software.aggregateRating, undefined);
  assert.equal(software.review, undefined);
});

test('sitemap lists canonical pages without ignored ranking hints', () => {
  const sitemap = read('docs/sitemap.xml');
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n/);
  const wrapper = sitemap.match(/^<\?xml[^>]+\?>\s*<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">([\s\S]*)<\/urlset>\s*$/);
  assert.ok(wrapper, 'sitemap must have one valid sitemap urlset root');
  const entries = [...wrapper[1].matchAll(/\s*<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>\s*<\/url>/g)];
  assert.deepEqual(
    entries.map(match => ({ location: match[1], lastmod: match[2] })),
    [
      { location: homeUrl, lastmod: releaseDate },
      { location: changelogUrl, lastmod: releaseDate },
    ],
  );
  assert.equal(wrapper[1].replace(/\s+/g, ''), entries.map(match => match[0]).join('').replace(/\s+/g, ''));
  assert.doesNotMatch(sitemap, /<(?:priority|changefreq)>/);
  assert.equal(fs.existsSync(path.join(root, 'docs/robots.txt')), false);
});
