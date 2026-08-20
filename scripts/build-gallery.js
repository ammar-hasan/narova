'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inspectArchive, readArchiveBytes } = require('../tool/src/project-archive');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const INDEX_RELATIVE = 'docs/explore/gallery.json';
const OUTPUT_RELATIVE = 'docs/explore/index.html';
const FORMAT = 'narova.gallery/1';
const SITE = 'https://ammar-hasan.github.io/narova/';
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_PROJECTED_SOURCE_BYTES = 2 * 1024 * 1024;

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function plainString(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error(`${label} must be a bounded non-empty plain string`);
  }
  return value.trim();
}

function safeId(value) {
  const id = plainString(value, 'entry id', 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`invalid gallery entry id: ${id}`);
  return id;
}

function regularFile(root, relative, label, extensions) {
  const rel = plainString(relative, label, 500).replace(/\\/g, '/');
  if (rel.startsWith('/') || rel.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`${label} must be a confined repository-relative path`);
  }
  if (extensions && !extensions.some(ext => rel.toLowerCase().endsWith(ext))) {
    throw new Error(`${label} has an unsupported extension: ${rel}`);
  }
  if (!rel.startsWith('docs/')) throw new Error(`${label} must live under the static docs tree`);
  const absolute = path.resolve(root, ...rel.split('/'));
  const lexical = path.relative(root, absolute);
  if (!lexical || lexical.startsWith(`..${path.sep}`) || path.isAbsolute(lexical)) {
    throw new Error(`${label} escapes the repository`);
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  const rootReal = fs.realpathSync(root);
  const fileReal = fs.realpathSync(absolute);
  const realRelative = path.relative(rootReal, fileReal);
  if (!realRelative || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error(`${label} resolves outside the repository`);
  }
  return { rel, absolute };
}

function pageHref(fileRel) {
  return path.posix.relative('docs/explore', fileRel);
}

function assertMediaBytes(file, kind, label) {
  const bytes = fs.readFileSync(file);
  if (kind === 'video') {
    if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') throw new Error(`${label} is not a supported MP4 file`);
    return;
  }
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!jpeg && !png && !webp) throw new Error(`${label} is not a supported poster image`);
}

function parseJson(bytes, label) {
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
  return value;
}

function projectProjection(archiveFile, expectedSha, version) {
  if (!SHA256_RE.test(expectedSha || '')) throw new Error('archiveSha256 must be a lowercase SHA-256 digest');
  const bytes = fs.readFileSync(archiveFile);
  if (sha256(bytes) !== expectedSha) throw new Error(`archive digest does not match the gallery index: ${archiveFile}`);
  const summary = inspectArchive(archiveFile);
  if (summary.sha256 !== expectedSha) throw new Error(`verified archive identity disagrees for ${archiveFile}`);
  if (summary.packer.version !== version) throw new Error(`producing version does not match the archive for ${archiveFile}`);
  const verified = readArchiveBytes(bytes);
  const configMember = verified.entries.find(member => member.role === 'authoring-config');
  if (!configMember || !configMember.path.endsWith('.json')) {
    throw new Error(`gallery projection requires a non-executing JSON authoring config: ${archiveFile}`);
  }
  const config = parseJson(configMember.data, configMember.path);
  if (!Array.isArray(config.scenes) || !config.scenes.length) throw new Error(`${configMember.path} must contain scenes`);
  const scenes = config.scenes.map((scene, sceneIndex) => {
    const id = plainString(scene && scene.id, `scene ${sceneIndex + 1} id`, 120);
    if (!Array.isArray(scene.vo)) throw new Error(`scene ${id} narration must be an array`);
    const turns = scene.vo.map((turn, turnIndex) => ({
      who: plainString(turn && turn.who, `scene ${id} turn ${turnIndex + 1} speaker`, 120),
      text: plainString(turn && turn.text, `scene ${id} turn ${turnIndex + 1} text`, 5000),
    }));
    return { id, turns };
  });
  const lineageMember = verified.entries.find(member => member.role === 'remix-lineage');
  const lineage = lineageMember ? parseJson(lineageMember.data, lineageMember.path) : null;
  const sourceMembers = verified.entries.filter(member => [
    'authoring-config', 'creative-brief', 'creative-rationale', 'claims-ledger', 'authored-module',
  ].includes(member.role));
  const projectedBytes = sourceMembers.reduce((total, member) => total + member.bytes, 0);
  if (projectedBytes > MAX_PROJECTED_SOURCE_BYTES) throw new Error(`projected authoring source exceeds ${MAX_PROJECTED_SOURCE_BYTES} bytes`);
  return { summary, scenes, lineage, sourceMembers };
}

function validateEntry(root, entry, ids) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('gallery entry must be an object');
  const id = safeId(entry.id);
  if (ids.has(id)) throw new Error(`duplicate gallery entry id: ${id}`);
  ids.add(id);
  const title = plainString(entry.title, `${id} title`, 120);
  const description = plainString(entry.summary, `${id} summary`, 500);
  const producingVersion = plainString(entry.producingVersion, `${id} producingVersion`, 50);
  const archive = regularFile(root, entry.archive, `${id} archive`, ['.narova']);
  const video = regularFile(root, entry.video, `${id} video`, ['.mp4']);
  const captions = regularFile(root, entry.captions, `${id} captions`, ['.vtt']);
  const poster = regularFile(root, entry.poster, `${id} poster`, ['.jpg', '.jpeg', '.png', '.webp']);
  assertMediaBytes(video.absolute, 'video', `${id} video`);
  assertMediaBytes(poster.absolute, 'poster', `${id} poster`);
  if (!SHA256_RE.test(entry.videoSha256 || '') || sha256(fs.readFileSync(video.absolute)) !== entry.videoSha256) {
    throw new Error(`${id} video digest does not match the gallery index`);
  }
  const captionText = fs.readFileSync(captions.absolute, 'utf8');
  if (!/^WEBVTT(?:\r?\n)/.test(captionText) || !/\d{2}:\d{2}:\d{2}\.\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}\.\d{3}/.test(captionText)) {
    throw new Error(`${id} captions are not a non-empty WebVTT track`);
  }
  if (!entry.releaseCheck || entry.releaseCheck.status !== 'pass') throw new Error(`${id} has no passing release-check record`);
  const releaseNote = plainString(entry.releaseCheck.note, `${id} release-check note`, 500);
  if (!entry.provenance || typeof entry.provenance !== 'object' || entry.provenance.status !== 'complete') throw new Error(`${id} has no complete provenance record`);
  const provenanceSummary = plainString(entry.provenance.summary, `${id} provenance summary`, 1000);
  const declaredLineage = plainString(entry.provenance.lineage, `${id} lineage summary`, 500);
  if (!entry.accessibility || entry.accessibility.status !== 'pass') throw new Error(`${id} has no passing accessibility record`);
  const accessibilityNote = plainString(entry.accessibility.note, `${id} accessibility note`, 500);
  if (!entry.rights || entry.rights.status !== 'declared-compatible') throw new Error(`${id} lacks hosting-compatible declared rights`);
  const rightsBasis = plainString(entry.rights.basis, `${id} rights basis`, 1000);
  if (!Array.isArray(entry.rights.credits) || !entry.rights.credits.length) throw new Error(`${id} must carry at least one credit`);
  const credits = entry.rights.credits.map((credit, index) => plainString(credit, `${id} credit ${index + 1}`, 500));
  const project = projectProjection(archive.absolute, entry.archiveSha256, producingVersion);
  const actualLineage = project.lineage
    ? `Recorded remix parent: ${JSON.stringify(project.lineage.parent)}`
    : 'No recorded remix parent.';
  if (declaredLineage !== actualLineage) throw new Error(`${id} lineage summary does not match the archive`);
  return {
    id, title, description, producingVersion, archive, video, captions, poster,
    archiveSha256: entry.archiveSha256, releaseNote, provenanceSummary,
    rightsBasis, credits, accessibilityNote, project,
  };
}

function sourceMarkup(member) {
  const text = member.data.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(member.data)) throw new Error(`${member.path} is not UTF-8 source`);
  return `<details class="source-file${member.role === 'authoring-config' ? ' source-primary' : ''}">
          <summary><span>${escapeHtml(member.path)}</span><small>${escapeHtml(member.role)} · ${member.bytes.toLocaleString('en-US')} bytes</small></summary>
          <pre><code>${escapeHtml(text)}</code></pre>
        </details>`;
}

function entryMarkup(entry, index) {
  const memberBytes = entry.project.summary.members.reduce((total, member) => total + member.bytes, 0);
  const sceneMarkup = entry.project.scenes.map((scene, sceneIndex) => `
            <li>
              <span class="scene-number">${String(sceneIndex + 1).padStart(2, '0')}</span>
              <div><strong>${escapeHtml(scene.id)}</strong>${scene.turns.length ? `<ol class="turns">${scene.turns.map(turn => `<li><b>${escapeHtml(turn.who)}</b> ${escapeHtml(turn.text)}</li>`).join('')}</ol>` : '<p>Silent scene</p>'}</div>
            </li>`).join('');
  const command = `narova remix ${path.posix.basename(entry.archive.rel)} --dir ${entry.id}-remix`;
  const manifestMembers = entry.project.summary.members
    .map(member => `<li><code>${escapeHtml(member.path)}</code><span>${escapeHtml(member.role)} · ${member.bytes.toLocaleString('en-US')} bytes</span></li>`)
    .join('');
  return `<article class="gallery-entry" id="${entry.id}">
      <header class="entry-heading">
        <p class="entry-count">PROJECT ${String(index + 1).padStart(2, '0')}</p>
        <h2>${escapeHtml(entry.title)}</h2>
        <p>${escapeHtml(entry.description)}</p>
      </header>

      <section class="gallery-step watch" aria-labelledby="${entry.id}-watch">
        <div class="step-label"><span>01</span><h3 id="${entry.id}-watch">Watch</h3></div>
        <video controls preload="metadata" poster="${escapeHtml(pageHref(entry.poster.rel))}">
          <source src="${escapeHtml(pageHref(entry.video.rel))}" type="video/mp4">
          <track kind="captions" src="${escapeHtml(pageHref(entry.captions.rel))}" srclang="en" label="English" default>
          Your browser cannot play this video. <a href="${escapeHtml(pageHref(entry.video.rel))}">Download the MP4</a>.
        </video>
      </section>

      <section class="gallery-step inspect" aria-labelledby="${entry.id}-inspect">
        <div class="step-label"><span>02</span><h3 id="${entry.id}-inspect">Inspect</h3></div>
        <div class="inspect-grid">
          <div class="fact-panel">
            <h4>Verified archive</h4>
            <dl>
              <div><dt>Identity</dt><dd><code>${entry.archiveSha256}</code></dd></div>
              <div><dt>Format</dt><dd>${escapeHtml(entry.project.summary.format)}</dd></div>
              <div><dt>Packer version</dt><dd>Narova ${escapeHtml(entry.producingVersion)}</dd></div>
              <div><dt>Contents</dt><dd>${entry.project.summary.members.length} members · ${memberBytes.toLocaleString('en-US')} bytes</dd></div>
              <div><dt>Release check</dt><dd>${escapeHtml(entry.releaseNote)}</dd></div>
              <div><dt>Accessibility</dt><dd>${escapeHtml(entry.accessibilityNote)}</dd></div>
            </dl>
            <ul class="manifest-members">${manifestMembers}</ul>
          </div>
          <div class="fact-panel">
            <h4>Provenance &amp; rights</h4>
            <p>${escapeHtml(entry.provenanceSummary)}</p>
            <p>${escapeHtml(entry.project.lineage ? `Recorded remix parent: ${JSON.stringify(entry.project.lineage.parent)}` : 'No recorded remix parent.')}</p>
            <p><strong>Hosting basis:</strong> ${escapeHtml(entry.rightsBasis)}</p>
            <ul>${entry.credits.map(credit => `<li>${escapeHtml(credit)}</li>`).join('')}</ul>
          </div>
        </div>
        <h4 class="subhead">Scene &amp; narration inventory</h4>
        <ol class="scene-list">${sceneMarkup}
        </ol>
        <h4 class="subhead">Authoring source</h4>
        <div class="source-list">
        ${entry.project.sourceMembers.map(sourceMarkup).join('\n        ')}
        </div>
      </section>

      <section class="gallery-step remix" aria-labelledby="${entry.id}-remix">
        <div class="step-label"><span>03</span><h3 id="${entry.id}-remix">Remix</h3></div>
        <p>Download the verified project, then run the exact local archive command.</p>
        <div class="remix-command"><code>${escapeHtml(command)}</code><button type="button" data-copy-command="${escapeHtml(command)}">Copy</button></div>
        <a class="archive-download" href="${escapeHtml(pageHref(entry.archive.rel))}" download>Download ${escapeHtml(path.posix.basename(entry.archive.rel))} <span aria-hidden="true">↓</span></a>
        <p class="trust-note">Archives are untrusted input. Inspect first; building executes authored project source with your account's ambient authority.</p>
      </section>
    </article>`;
}

function renderGallery(index, entries) {
  const canonical = `${SITE}explore/`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Narova Explore — watch, inspect, remix real video projects</title>
<meta name="description" content="Watch finished Narova videos, inspect their verified authoring source and provenance, then download and remix the complete project.">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#12061d">
<meta property="og:title" content="Narova Explore — every video is a project">
<meta property="og:description" content="Watch the render. Inspect the source. Remix the verified Narova project.">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}explore/assets/narova-explore-share.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="720">
<meta property="og:image:alt" content="Narova prompt-to-video workflow preview">
<meta property="og:site_name" content="Narova">
<meta property="og:locale" content="en_US">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Narova Explore — every video is a project">
<meta name="twitter:description" content="Watch the render. Inspect the source. Remix the verified Narova project.">
<meta name="twitter:image" content="${SITE}explore/assets/narova-explore-share.png">
<meta name="twitter:image:alt" content="Narova prompt-to-video workflow preview">
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">
${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${canonical}#collection`,
    url: canonical,
    name: 'Narova Explore',
    description: 'Curated, verified Narova video projects to watch, inspect, and remix.',
    numberOfItems: entries.length,
  }, null, 2)}
</script>
<link rel="stylesheet" href="../style.css">
<link rel="stylesheet" href="explore.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div class="cursor-dot" aria-hidden="true"></div>
<div class="cursor-ring" aria-hidden="true"></div>
<div class="progress" aria-hidden="true"><div class="progress-bar" id="progressBar"></div></div>
<div class="grain" aria-hidden="true"></div>
<header class="nav">
  <a class="nav-logo" href="../" data-hover><span class="logo-mark" aria-hidden="true">▶</span>narova</a>
  <nav class="nav-links" aria-label="Primary navigation">
    <a href="../">Home</a><a href="./" aria-current="page">Explore</a><a href="../changelog/">Changelog</a>
  </nav>
  <a class="nav-gh" href="https://github.com/ammar-hasan/narova">GitHub</a>
</header>
<main id="main">
  <section class="explore-hero">
    <p class="kicker">THE PROJECT IS THE MEDIUM</p>
    <h1>Watch it.<br><em>Open the source.</em><br>Make it yours.</h1>
    <p>Each finished video below carries its verified authoring archive, readable source, provenance, credits, and one exact remix path. No account. No upload form. No hidden runtime.</p>
    <div class="loop" aria-label="Gallery workflow"><span>01 Watch</span><i>→</i><span>02 Inspect</span><i>→</i><span>03 Remix</span></div>
  </section>
  <section class="gallery" aria-label="Curated Narova projects">
    ${entries.map(entryMarkup).join('\n    ')}
  </section>
  <section class="curation-note">
    <p class="kicker">CURATED, NOT INGESTED</p>
    <h2>Static by design.</h2>
    <p>This page is generated from a checked-in, human-reviewed index. Archives are verified before publication; browsers never unpack or execute project content. Gallery update: ${escapeHtml(index.updated)}.</p>
  </section>
</main>
<footer class="footer"><span>© 2026 Narova · Apache-2.0</span><span><a href="../">Home</a> · <a href="../changelog/">Changelog</a> · <a href="https://github.com/ammar-hasan/narova">GitHub</a></span></footer>
<script src="../vendor/gsap.min.js"></script>
<script src="../vendor/ScrollTrigger.min.js"></script>
<script src="../vendor/lenis.min.js"></script>
<script src="../app.js"></script>
</body>
</html>
`;
}

function buildGallery({ root = DEFAULT_ROOT, indexPath, outputPath, check = false } = {}) {
  const indexFile = indexPath || path.join(root, INDEX_RELATIVE);
  const outputFile = outputPath || path.join(root, OUTPUT_RELATIVE);
  const index = parseJson(fs.readFileSync(indexFile), INDEX_RELATIVE);
  if (!index || typeof index !== 'object' || index.format !== FORMAT) throw new Error(`gallery index format must be ${FORMAT}`);
  plainString(index.updated, 'gallery updated date', 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(index.updated)) throw new Error('gallery updated must use YYYY-MM-DD');
  if (!Array.isArray(index.entries) || !index.entries.length || index.entries.length > 100) throw new Error('gallery index must contain 1–100 entries');
  regularFile(root, 'docs/explore/assets/narova-explore-share.png', 'explore share image', ['.png']);
  const ids = new Set();
  const entries = index.entries.map(entry => validateEntry(root, entry, ids));
  const html = renderGallery(index, entries);
  if (check) {
    if (!fs.existsSync(outputFile) || fs.readFileSync(outputFile, 'utf8') !== html) {
      throw new Error(`${path.relative(root, outputFile)} is stale; run npm run gallery:build`);
    }
  } else {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, html);
  }
  return { entries: entries.length, output: outputFile };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const result = buildGallery({ check });
  process.stdout.write(`gallery ${check ? 'verified' : 'built'}: ${result.entries} entries -> ${path.relative(DEFAULT_ROOT, result.output)}\n`);
}

module.exports = { FORMAT, buildGallery, validateEntry, renderGallery };
