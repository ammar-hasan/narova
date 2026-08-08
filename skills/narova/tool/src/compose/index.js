'use strict';
/* narova compose: config + out/timings.json + out/audio/full.wav -> out/hf/,
 * a self-contained HyperFrames project (index.html + project assets +
 * narration.wav + package.json). Regenerated from scratch every run — the
 * config, theme, and project assets are source; out/hf is never hand-edited. */
const fs = require('fs');
const path = require('path');
const { ensureDir, probe, sh } = require('../util');
const { HYPERFRAMES_VERSION } = require('../hf');
const { composeData } = require('./data');
const { composeCss } = require('./css');
const { composeDoc, composeSceneDoc } = require('./html');
const { collectModelAssets, collectTextureAssets, hasThreeScenes, THREE_IMPORT, THREE_MODULE_SRC } = require('./three');
const { assertFreshCaptures } = require('../walkthrough');

const GSAP_VENDOR_DIR = path.join(__dirname, '..', '..', 'vendor', 'gsap');
const GSAP_SRC = path.join(GSAP_VENDOR_DIR, 'gsap.min.js');

/* Copy the vendored three.js global bundle (core + GLTFLoader, esbuild-bundled
 * to a classic script exposing window.THREE) into the render project. The file
 * ships inside the tool (tool/vendor/three/), so rendering never depends on a
 * CDN being reachable at build time. */
function copyThreeAssets(assetsDir) {
  const dest = path.join(assetsDir, path.basename(THREE_IMPORT));
  if (!fs.existsSync(dest)) fs.copyFileSync(THREE_MODULE_SRC, dest);
}

/* External narration (a pre-recorded file + optional word timings) skips TTS
 * synth; scenes carry explicit `dur`. When word timings are present we
 * synthesize the same per-scene timing entries synth would have written, so
 * composeData can build caption groups. Shared by compose() (full project) and
 * composeSceneProject() (isolated span) — previously only compose() did this,
 * so per-scene rendering of external-narration projects always threw and fell
 * back to a full render. Returns null when the project is not external-narrated
 * or carries no word timings (callers fall back to timings.json). */
function synthesizeExternalTimings(config) {
  if (!(config.narrationSource && config.narrationSource.file && config.narrationSource.wordTimings)) {
    return null;
  }
  const cues = config.narrationSource.wordTimings;
  const timings = { total: config.scenes.reduce((n, s) => n + (s.dur || 0), 0) };
  let cursor = 0;
  for (const s of config.scenes) {
    const sceneEnd = cursor + (s.dur || 0);
    const sceneCues = cues.filter(c => c.start < sceneEnd && c.end > cursor);
    timings[s.id] = { dur: s.dur || 0, words: sceneCues.flatMap(c => c.words) };
    cursor = sceneEnd;
  }
  return timings;
}

function compose(config, outDir) {
  const timingsPath = path.join(outDir, 'timings.json');
  const fullWav = path.join(outDir, 'audio', 'full.wav');
  // External narration: no TTS synth needed — scenes carry explicit dur.
  const hasExternalNarration = !!(config.narrationSource && config.narrationSource.file);
  if (!hasExternalNarration && (!fs.existsSync(timingsPath) || !fs.existsSync(fullWav))) {
    throw new Error('compose needs out/timings.json and out/audio/full.wav — run `narova synth` first');
  }
  let timings = {};
  if (fs.existsSync(timingsPath)) {
    timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  }
  const synthesized = synthesizeExternalTimings(config);
  if (synthesized) {
    timings = synthesized;
  } else if (!hasExternalNarration) {
    // Standard mode: validate timings.
  }
  if (!hasExternalNarration) assertFreshCaptures(config, timings, outDir);

  const size = config.size;
  const data = composeData(config, timings, config.captionsEnabled !== false);

  // Merge per-scene file-referenced CSS and choreography into the project.
  let mergedExtraCss = config.themeCss || '';
  let mergedChoreography = config.choreography || '';
  for (const s of config.scenes) {
    if (s._cssFileContents) mergedExtraCss += '\n/* scene-css:' + s.id + ' */\n' + s._cssFileContents;
    if (s._choreographyFileContents) mergedChoreography += '\n/* scene:' + s.id + ' */\n' + s._choreographyFileContents;
    if (s._scriptFileContents) {
      const scData = data.scenes.find(d => d.id === s.id);
      const scStart = scData ? scData.start : 0;
      const scDur = scData ? scData.dur : (s.dur || 0);
      mergedChoreography += `\n/* scene-script:${s.id} */
(function(){
  var _scStart=${scStart}, _scDur=${scDur};
${s._scriptFileContents}
})();\n`;
    }
  }
  // Append import module contents: CSS-like files → extra CSS, JS-like files → choreography.
  if (config.imports) {
    for (const [name, imported] of Object.entries(config.imports)) {
      if (!imported || !imported.contents) continue;
      const ext = path.extname(imported.file || '').toLowerCase();
      if (ext === '.css') {
        mergedExtraCss += '\n/* import:' + name + ' */\n' + imported.contents;
      } else if (ext === '.js') {
        mergedChoreography += '\n/* import:' + name + ' */\n' + imported.contents;
      }
      // .json, .html, .svg imports are available on the config object for
      // scene body HTML and element references at authoring time.
    }
  }
  const css = composeCss(config.theme || {}, config.voices, size, mergedExtraCss, config.mode, config.captionsEnabled !== false, config.includePatterns !== false, config.safeLayout === true);
  const composeConfig = { ...config, themeCss: mergedExtraCss, choreography: mergedChoreography };
  const html = composeDoc(composeConfig, size, data, css);

  const slugTitle = slug(config.title || 'narova');
  const hfDir = path.join(outDir, `hf-${slugTitle}`);
  // A clean rebuild matters for assets: deleting logo.svg from the source must
  // not leave a stale copy in the render project. Also remove any old hf-*
  // directories so renames don't accumulate stale projects.
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('hf-')) {
      fs.rmSync(path.join(outDir, entry.name), { recursive: true, force: true });
    }
  }
  ensureDir(hfDir);
  const assetsDir = ensureDir(path.join(hfDir, 'assets'));
  if (config.assetsDir) fs.cpSync(config.assetsDir, assetsDir, { recursive: true });
  // Three.js is vendored in the tool (r185, esbuild-bundled global script) —
  // copy it into the render project so HyperFrames never hits a CDN.
  if (hasThreeScenes(config)) {
    copyThreeAssets(assetsDir);
  }
  // GSAP is vendored in the tool (3.14.2, minified) — copy into the render
  // project so rendering and preview never require a CDN.
  fs.copyFileSync(GSAP_SRC, path.join(assetsDir, 'gsap.min.js'));
  // Copy and auto-loop per-scene b-roll clips. If a clip is shorter than
  // its scene, narova creates a looped version with ffmpeg so the renderer
  // doesn't stutter on boundary seeks.
  for (const s of config.scenes) {
    if (s.clip) {
      const ext = path.extname(s.clip).toLowerCase() || '.mp4';
      const dest = path.join(assetsDir, `clip-${s.id}${ext}`);
      const srcPath = path.resolve(config.projectDir, s.clip);
      fs.copyFileSync(srcPath, dest);
      const sceneDur = timings[s.id] ? timings[s.id].dur : 0;
      if (sceneDur > 0) {
        try {
          const clipDur = probe(srcPath);
          if (clipDur < sceneDur * 0.95) {
            const isWebm = ext === '.webm';
            sh('ffmpeg', [
              '-y', '-loglevel', 'error',
              '-stream_loop', '-1', '-i', srcPath,
              '-t', String(Math.ceil(sceneDur + 1)),
              '-an',
              ...(isWebm
                ? ['-c:v', 'libvpx-vp9', '-crf', '20', '-b:v', '0']
                : ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20']),
              '-r', '30', '-g', '30', '-keyint_min', '30',
              '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
              '-movflags', '+faststart', dest,
            ]);
          }
        } catch { /* keep original clip if ffprobe/ffmpeg fails */ }
      }
    }
  }
  for (const modelRel of collectModelAssets(config)) {
    const modelSrc = path.resolve(config.projectDir, modelRel);
    if (fs.existsSync(modelSrc)) {
      const destName = path.basename(modelRel);
      fs.copyFileSync(modelSrc, path.join(assetsDir, destName));
    }
  }
  for (const texRel of collectTextureAssets(config)) {
    const texSrc = path.resolve(config.projectDir, texRel);
    if (fs.existsSync(texSrc)) {
      const destName = path.basename(texRel);
      fs.copyFileSync(texSrc, path.join(assetsDir, destName));
    }
  }
  for (const s of config.scenes) {
    if (s.three && s.three.envMap) {
      const envCfg = typeof s.three.envMap === 'string' ? { src: s.three.envMap } : s.three.envMap;
      const envSrc = path.resolve(config.projectDir, envCfg.src);
      if (fs.existsSync(envSrc)) {
        fs.copyFileSync(envSrc, path.join(assetsDir, path.basename(envCfg.src)));
      }
    }
  }
  fs.writeFileSync(path.join(hfDir, 'index.html'), html);
  fs.writeFileSync(path.join(hfDir, 'style.css'), css);
  // Register visual-tree fonts so the browser shapes custom fontFile references.
  const fontCss = buildFontFaces(config);
  if (fontCss) fs.appendFileSync(path.join(hfDir, 'style.css'), '\n' + fontCss);
  // Audio: the mixed track wins for both synthesized and custom narration;
  // otherwise use the custom narrator file, then synthesized full.wav.
  const mixWav = path.join(outDir, 'audio', 'mix.wav');
  const audioSource = fs.existsSync(mixWav)
    ? mixWav
    : (hasExternalNarration ? config.narrationSource.file : fullWav);
  fs.copyFileSync(audioSource, path.join(assetsDir, 'narration.wav'));
  fs.writeFileSync(path.join(hfDir, 'package.json'), JSON.stringify({
    name: slug(config.title || 'narova'),
    private: true,
    devDependencies: { hyperframes: HYPERFRAMES_VERSION },
  }, null, 2) + '\n');

  return { dir: hfDir, total: data.total, scenes: data.scenes.length };
}

/* Generate a single-scene HyperFrames HTML file within a fully composed
 * project directory. The full compose() must be run first to set up assets,
 * style.css, package.json, etc. This function reads the timings, builds
 * scene-local DATA, and writes a scene-specific index.html into a span
 * subdirectory. Used by the per-scene HyperFrames render cache. */
function composeSceneProject(config, outDir, sceneIdx) {
  const timingsPath = path.join(outDir, 'timings.json');
  const fullWav = path.join(outDir, 'audio', 'full.wav');
  const hasExternalNarration = !!(config.narrationSource && config.narrationSource.file);
  if (!hasExternalNarration && !fs.existsSync(timingsPath)) {
    throw new Error('composeSceneProject needs out/timings.json — run `narova synth` first');
  }
  // External narration: synthesize timings from wordTimings the same way the
  // full compose() does (shared helper), so an isolated span of a karaoke /
  // external-narration project builds the same scene-local DATA instead of
  // throwing and forcing a full-render fallback.
  let timings = synthesizeExternalTimings(config);
  if (!timings && fs.existsSync(timingsPath)) timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
  if (!timings) timings = {};

  const size = config.size;
  const data = composeData(config, timings, config.captionsEnabled !== false);
  const scene = config.scenes[sceneIdx];
  const scData = data.scenes.find(d => d.id === scene.id);
  if (!scData) throw new Error(`composeSceneProject: no data for scene "${scene.id}"`);

  let mergedExtraCss = config.themeCss || '';
  // Include this scene's cssFile so an isolated span sees the same styles the
  // full render applies (the full compose merges every scene's cssFile into the
  // shared style.css). Other scenes' cssFile is intentionally omitted — it
  // cannot affect this scene's pixels and omitting it keeps the span faithful.
  if (scene._cssFileContents) {
    mergedExtraCss += '\n/* scene-css:' + scene.id + ' */\n' + scene._cssFileContents;
  }
  if (config.imports) {
    for (const [name, imported] of Object.entries(config.imports)) {
      if (!imported || !imported.contents) continue;
      if ((imported.file || '').toLowerCase().endsWith('.css')) {
        mergedExtraCss += '\n/* import:' + name + ' */\n' + imported.contents;
      }
    }
  }
  const css = composeCss(config.theme || {}, config.voices, size, mergedExtraCss, config.mode, config.captionsEnabled !== false, config.includePatterns !== false, config.safeLayout === true);
  const sceneHtml = composeSceneDoc(config, sceneIdx, size, data, css);

  const slugTitle = slug(config.title || 'narova');
  const hfDir = path.join(outDir, `hf-${slugTitle}`);
  if (!fs.existsSync(hfDir)) throw new Error(`composeSceneProject: full compose not found at ${hfDir} — run compose first`);
  const spanDir = path.join(hfDir, 'spans', `scene-${scene.id}`);
  ensureDir(spanDir);

  // Create trimmed audio for just this scene's time window.
  const audioSrc = fs.existsSync(path.join(outDir, 'audio', 'mix.wav'))
    ? path.join(outDir, 'audio', 'mix.wav')
    : (hasExternalNarration ? config.narrationSource.file : fullWav);
  const spanAudioSrc = path.join(spanDir, 'narration.wav');
  if (!fs.existsSync(spanAudioSrc)) {
    sh('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-ss', String(scData.start), '-t', String(scData.dur),
      '-i', audioSrc,
      '-acodec', 'pcm_s16le', '-ar', '48000', '-ac', '2',
      spanAudioSrc,
    ]);
  }

  // Write scene project files
  fs.writeFileSync(path.join(spanDir, 'index.html'), sceneHtml);
  // Link to shared assets (style.css, vendors, project assets)
  for (const f of ['style.css', 'package.json']) {
    const src = path.join(hfDir, f);
    if (fs.existsSync(src)) {
      try { fs.linkSync(src, path.join(spanDir, f)); } catch { fs.copyFileSync(src, path.join(spanDir, f)); }
    }
  }
  const assetsDest = path.join(spanDir, 'assets');
  const assetsSrc = path.join(hfDir, 'assets');
  if (!fs.existsSync(assetsDest) && fs.existsSync(assetsSrc)) {
    try { fs.symlinkSync(assetsSrc, assetsDest, 'junction'); } catch {
      try { fs.symlinkSync(assetsSrc, assetsDest, 'dir'); } catch {
        fs.cpSync(assetsSrc, assetsDest, { recursive: true });
      }
    }
  }

  return { dir: spanDir, sceneId: scene.id, start: scData.start, dur: scData.dur };
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'narova';
}

/* Scan scene.visual trees for fontFile references registered by the no-browser
 * renderer and emit @font-face blocks so HyperFrames can shape the same
 * authored fonts through the browser's font engine. */
function buildFontFaces(config) {
  const refs = new Map();
  function visit(node) {
    const style = node.style || {};
    if (style.fontFile) {
      const family = style.fontFamily || path.basename(style.fontFile, path.extname(style.fontFile));
      if (!refs.has(family)) refs.set(family, style.fontFile);
    }
    (node.children || []).forEach(visit);
  }
  (config.scenes || []).forEach(s => { if (s.visual) visit(s.visual); });
  if (!refs.size) return '';
  return [...refs].map(([family, file]) =>
    `@font-face{font-family:"${family}";src:url("assets/${path.basename(file)}")}`).join('\n');
}

module.exports = { compose, composeSceneProject, buildFontFaces, slug };
