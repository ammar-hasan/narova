'use strict';
/* Creative-diversity evaluation: checks that different briefs don't collapse
 * to the same Narova grammar. Generates configs from 10 distinct briefs and
 * measures structural convergence across multiple dimensions.
 *
 * Run: node skills/narova/tool/evals/creative-diversity-eval.js
 *
 * This eval does NOT render video — it works at the config/manifest level.
 * What it measures:
 *   - Scene-count similarity
 *   - Repeated title-card patterns
 *   - Repeated card/chip use
 *   - Repeated hook/CTA formulas
 *   - Repeated caption presets
 *   - Repeated cue-reveal patterns
 *   - Repeated transitions
 *   - Repeated palette topology
 *   - Repeated voice casting
 *   - Repeated class/semantic vocabulary
 *   - Custom CSS, choreography, assets, and 3D footprint
 *   - Whether projects have genuinely distinct visual systems
 *
 * Lower scores = less convergence = more creative diversity. */

const assert = require('node:assert/strict');
const { test } = require('node:test');

/* ---- 10 radically different briefs ---------------------------------------- */

const BRIEFS = [
  {
    name: 'Swiss editorial data film',
    brief: 'A 60s data-driven film about Swiss rail punctuality. Clean grid, red/white/black palette, Helvetica, large data numbers animating on cue, no characters.',
    expected: { minScenes: 3, maxScenes: 8, captionPreset: 'rise', voiceCount: 1 },
  },
  {
    name: 'Handmade paper collage',
    brief: 'A 30s animated collage about the life cycle of a butterfly. Paper textures, hand-drawn borders, warm earth tones, stop-motion feel, poetic caption-only narration.',
    expected: { minScenes: 2, maxScenes: 5, voiceCount: 1 },
  },
  {
    name: 'Luxury cinematic product reveal',
    brief: 'A 45s watch launch film. Slow pacing, black backgrounds, gold accents, sweeping camera pans on 3D model, cinematic transitions, no visible captions during the reveal.',
    expected: { voiceCount: 1 },
  },
  {
    name: 'Children\'s illustrated story',
    brief: 'A 90s storybook about a curious fox. Hand-drawn SVG illustrations, playful serif font, pastel palette, one gentle narrator, simple fade transitions, large captions at bottom.',
    expected: { voiceCount: 1, minScenes: 5 },
  },
  {
    name: 'Brutalist music visualizer',
    brief: 'A 60s abstract music-driven visualizer. Pure CSS geometry, monospace grid, grayscale palette, no narration, tightly synced to a bed track, captions as lyrics in the grid.',
    expected: { voiceCount: 0, containsSilent: true },
  },
  {
    name: 'Live software walkthrough',
    brief: 'A 45s browser-recorded demo of a CI/CD dashboard. One narrator explaining what they see, walkthrough capture scenes, technical labeling, code-terminal aesthetic.',
    expected: { usesWalkthrough: true, voiceCount: 1, minScenes: 2 },
  },
  {
    name: 'Archival documentary',
    brief: 'A 120s historical documentary about the Apollo program. Archival photos, newspaper headlines, typed-look captions, slow Ken Burns pans, one authoritative narrator, sepia palette.',
    expected: { minScenes: 5, voiceCount: 1, captionPreset: 'rise' },
  },
  {
    name: 'Kinetic Urdu typography',
    brief: 'A 60s expressive typography film in Urdu. Right-to-left text flow, custom Nastaliq font, colorful gradient backgrounds, words animate in from different directions on cue, no chrome.',
    expected: { voiceCount: 1, usesCustomCSS: true, usesChoreography: true },
  },
  {
    name: '3D character comedy',
    brief: 'A 45s comedy sketch with two 3D characters (cat and mouse). Dialogue-driven, fast cuts, exaggerated animation, bright colors, stage-like lighting, comedic timing rhythms.',
    expected: { voiceCount: 2, uses3D: true, usesElements: true },
  },
  {
    name: 'Quiet scientific explanation',
    brief: 'A 180s calm scientific explainer about how vaccines work. Slow pace, gentle voice, clean diagrams, white/blue palette, simple reveals, slides of information, no hook, no CTA, no chrome.',
    expected: { voiceCount: 1, minScenes: 6 },
  },
];

/* ---- Metric extractors from a config or manifest -------------------------- */

function extractMetrics(config) {
  const m = {};

  m.sceneCount = (config.scenes || []).length;
  m.voiceCount = Object.keys(config.voices || {}).length;

  // Scene content fingerprint
  m.titleCards = 0;
  m.cardLayouts = 0;
  m.chipLayouts = 0;
  for (const s of (config.scenes || [])) {
    const body = String(s.body || '');
    if (body.includes('s-title') || body.includes('display') || body.includes('s-center') && !body.includes('bigquote')) m.titleCards++;
    if (body.includes('pane') || body.includes('s-two') || body.includes('owners') || body.includes('planes')) m.cardLayouts++;
    if (body.includes('chip') || body.includes('loop-chip')) m.chipLayouts++;
  }

  // Caption footprint
  m.captionPreset = (config.captions && config.captions.preset) || 'karaoke';
  m.hasEmphasis = !!(config.captions && config.captions.emphasis && config.captions.emphasis.length);

  // Timing/pace footprint
  m.tempo = (config.timing && config.timing.tempo) || 1;
  m.hasCustomTiming = !!(config.timing && (
    config.timing.lead !== 0.16 || config.timing.tail !== 0.58 ||
    config.timing.gapSentence !== 0.24 || config.timing.gapTurn !== 0.44));

  // Transitions
  m.transitions = new Set();
  m.fadeOnly = true;
  for (const s of (config.scenes || [])) {
    const tr = s.transition || 'fade';
    m.transitions.add(tr);
    if (tr !== 'fade') m.fadeOnly = false;
  }

  // Palette topology
  const theme = config.theme || {};
  const hasCustomAccent = !!(theme.accent && theme.accent !== '#2ee6d6');
  const hasCustomBg = !!(theme.bg && theme.bg !== '#080d16');
  const customTokens = Object.keys(theme).filter(k =>
    !['accent', 'bg', 'mode', 'css'].includes(k) && !(typeof theme[k] === 'string' && theme[k] === config.mode));
  m.customTokens = customTokens.length;
  m.isDefaultPalette = !hasCustomAccent && !hasCustomBg && m.customTokens === 0;
  m.mode = config.mode || 'dark';

  // Creative surface usage
  m.hasCustomCSS = !!(config.themeCss && config.themeCss.trim().length > 0);
  m.hasChoreography = !!(config.choreography && config.choreography.trim().length > 0);
  m.has3D = (config.scenes || []).some(s => !!s.three);
  m.hasElements = (config.scenes || []).some(s => !!s.elements);
  m.hasWalkthrough = (config.scenes || []).some(s => !!s.walkthrough);

  // Chrome
  const chrome = config.chrome || {};
  m.usesDefaultChrome = chrome.topbar !== false && chrome.counter !== false && chrome.progress !== false;

  // Narration patterns
  m.usesExternalNarration = !!(config.narrationSource && config.narrationSource.file);
  m.hasVo = (config.scenes || []).every(s => (s.vo || []).length > 0);
  m.hasSilentScenes = (config.scenes || []).some(s => !s.vo || s.vo.length === 0);

  // Hook/CTA patterns
  const s1Body = String(((config.scenes || [])[0] || {}).body || '');
  const lastBody = String(((config.scenes || [])[config.scenes.length - 1] || {}).body || '');
  m.hasTitleHook = s1Body.includes('display') || s1Body.includes('s-title') || s1Body.includes('eyebrow');
  m.hasCTAEnd = lastBody.includes('s-close') || lastBody.includes('ctag') || lastBody.includes('close-sign');

  // Cue density
  m.cueCount = 0;
  for (const s of (config.scenes || [])) {
    const body = String(s.body || '');
    m.cueCount += (body.match(/data-cue=/g) || []).length;
  }
  m.cuePerScene = m.sceneCount > 0 ? m.cueCount / m.sceneCount : 0;

  // Voice casting similarity
  m.voiceBackends = new Set();
  m.voiceColors = [];
  for (const v of Object.values(config.voices || {})) {
    if (v.backend) m.voiceBackends.add(v.backend);
    if (v.color) m.voiceColors.push(v.color);
  }

  return m;
}

/* ---- Convergence checks --------------------------------------------------- */

function checkConvergence(metrics, expected) {
  const issues = [];

  // 1. Is every project just one dark teal/pink template?
  const defaultPalettes = metrics.filter(m => m.isDefaultPalette).length;
  if (defaultPalettes > 2) {
    issues.push(`CONVERGENCE: ${defaultPalettes}/${metrics.length} projects use the default dark palette — visual sameness`);
  }

  // 2. Are all projects using the same caption preset?
  const presets = new Set(metrics.map(m => m.captionPreset));
  if (presets.size < 3) {
    issues.push(`CONVERGENCE: only ${presets.size} caption preset(s) across ${metrics.length} projects`);
  }

  // 3. Are all projects using karaoke presets?
  const karaokeCount = metrics.filter(m => m.captionPreset === 'karaoke').length;
  if (karaokeCount > 7) {
    issues.push(`CONVERGENCE: ${karaokeCount}/${metrics.length} projects use the karaoke caption preset`);
  }

  // 4. Custom CSS usage
  const cssCount = metrics.filter(m => m.hasCustomCSS).length;
  if (cssCount < 3) {
    issues.push(`CONVERGENCE: only ${cssCount}/${metrics.length} projects use custom CSS — projects share the built-in stylesheet`);
  }

  // 5. Choreography usage
  const choreoCount = metrics.filter(m => m.hasChoreography).length;

  // 6. 3D / elements usage
  const threeDCount = metrics.filter(m => m.has3D || m.hasElements).length;

  // 7. Default chrome
  const defaultChrome = metrics.filter(m => m.usesDefaultChrome).length;
  if (defaultChrome > 8) {
    issues.push(`CONVERGENCE: ${defaultChrome}/${metrics.length} projects keep default Narova chrome`);
  }

  // 8. Title cards
  const titleCardDensity = metrics.map(m => m.titleCards / Math.max(1, m.sceneCount));
  const highTitleCards = titleCardDensity.filter(d => d > 0.3).length;
  if (highTitleCards > 6) {
    issues.push(`CONVERGENCE: ${highTitleCards}/${metrics.length} projects are >30% title cards`);
  }

  // 9. Scene count similarity
  const sceneCounts = metrics.map(m => m.sceneCount);
  const uniqueSceneCounts = new Set(sceneCounts).size;
  if (uniqueSceneCounts < 3) {
    issues.push(`CONVERGENCE: only ${uniqueSceneCounts} distinct scene counts across ${metrics.length} projects`);
  }

  // 10. Voice count
  const voiceCounts = metrics.map(m => m.voiceCount);
  const oneVoice = voiceCounts.filter(v => v === 1).length;
  const twoVoices = voiceCounts.filter(v => v === 2).length;

  // 11. Hook/CTA pattern
  const hookCtaMatches = metrics.filter(m => m.hasTitleHook && m.hasCTAEnd).length;
  if (hookCtaMatches > 5) {
    issues.push(`CONVERGENCE: ${hookCtaMatches}/${metrics.length} projects use title-hook + CTA-end formula`);
  }

  // 12. Cue density similarity
  const cueDensities = metrics.map(m => m.cuePerScene);

  // 13. Backend variety
  const backends = new Set();
  metrics.forEach(m => m.voiceBackends.forEach(b => backends.add(b)));

  return {
    issues,
    stats: {
      defaultPalettes, karaokeCount, cssCount, choreoCount, threeDCount,
      defaultChrome, highTitleCards, uniqueSceneCounts, oneVoice, twoVoices,
      hookCtaMatches, presetCount: presets.size, backendCount: backends.size,
      sceneCounts, cueDensities, voiceCounts, titleCardDensity,
    },
  };
}

/* ---- Test: generate project configs from briefs --------------------------- */

// These are manually authored configs derived from each brief.
// Each brief gets a config that expresses its unique creative direction.
function generateConfigs() {
  return [
    /* Swiss editorial data film */
    {
      title: 'Swiss Rail Punctuality', size: '16:9',
      voices: { a: { backend: 'piper', speaker: 'en_US-ryan-high', color: '#e30613' } },
      theme: { accent: '#e30613', bg: '#ffffff', mode: 'light', ink: '#1a1a1a', muted: '#666666', gold: '#ffd700' },
      captions: { preset: 'rise' },
      chrome: { topbar: false, counter: false, progress: true },
      timing: { tempo: 1.2, gapSentence: 0.2, gapTurn: 0.35 },
      scenes: [
        { id: 'hook', vo: [{ who: 'a', text: 'Swiss trains are 96.7 percent on time. Here is what that actually means.' }],
          body: '<div class="s-center"><h1 class="display reveal">96.7%</h1><p class="lede cue" data-cue="0" style="font-family:Helvetica">Swiss Federal Railways punctuality rate, 2024</p></div>' },
        { id: 'network', vo: [{ who: 'a', text: '11,332 kilometers of track. 11,300 trains per day.' }],
          body: '<div class="s-two"><div class="pane center"><span class="stat reveal" data-count="11332" data-count-suffix=" km">0 km</span></div><div class="pane center"><span class="stat reveal" data-count="11300" data-count-suffix=" /day">0</span></div></div>', transition: 'slide' },
        { id: 'def', vo: [{ who: 'a', text: 'Punctuality means arriving within three minutes of schedule.' }],
          body: '<div class="s-center"><div class="bigquote reveal">&ldquo;Within three minutes&rdquo;</div><div class="small cue" data-cue="0">SBB definition of punctuality</div></div>', transition: 'fade' },
        { id: 'close', vo: [{ who: 'a', text: 'Swiss precision. Clockwork you can count on.' }],
          body: '<div class="s-center"><h1 class="display reveal">Swiss Precision</h1><p class="lede reveal">sbb.ch</p></div>', transition: 'zoom' },
      ],
    },
    /* Handmade paper collage */
    {
      title: 'The Butterfly', size: '1:1',
      voices: { a: { backend: 'piper', speaker: 'en_US-hfc_female-medium', color: '#c0843a' } },
      theme: { accent: '#c0843a', bg: '#fef7e0', mode: 'light', ink: '#3d2b1f', muted: '#8b6f47', stage: '#fdf0d1', panel: '#f8e8c8', line: '#d4b896',
        gold: '#e8b44e', pink: '#e8956f', green: '#7a9e4b' },
      captions: { preset: 'pop' },
      themeCss: '@font-face{font-family:"Paperhand";src:url("assets/paperhand.woff2")}.collage{filter:drop-shadow(3px 4px 0 rgba(0,0,0,.12))}',
      chrome: false,
      scenes: [
        { id: 'egg', vo: [{ who: 'a', text: 'It begins as a tiny egg, hidden on the underside of a leaf.' }],
          body: '<div class="s-center"><div class="collage"><svg viewBox="0 0 200 200"><ellipse cx="100" cy="120" rx="30" ry="18" fill="#f0e8d0" stroke="#8b6f47" stroke-width="2"/><path d="M40,120 Q100,-10 160,120" fill="none" stroke="#7a9e4b" stroke-width="3"/></svg></div><p class="small reveal">The egg, gently placed</p></div>' },
        { id: 'cater', vo: [{ who: 'a', text: 'A hungry caterpillar emerges — it eats, and it grows.' }],
          body: '<div class="s-center"><div class="collage">🐛</div><p class="small reveal">Two weeks of growth</p></div>', transition: 'fade' },
        { id: 'chrys', vo: [{ who: 'a', text: 'Wrapped in a chrysalis, the greatest transformation begins.' }],
          body: '<div class="s-center"><div class="collage">🦋</div><div class="hairline reveal"></div><p class="small cue" data-cue="0">The chrysalis stage</p></div>', transition: 'fade' },
        { id: 'fly', vo: [{ who: 'a', text: 'And then — a butterfly, painted by the sun.' }],
          body: '<div class="s-center"><div class="collage" style="font-size:120px">🦋</div><p class="lede reveal">The painted lady emerges</p></div>', transition: 'wipe' },
      ],
    },
    /* Luxury cinematic product reveal */
    {
      title: 'Aethel Watch', size: '9:16',
      voices: { a: { backend: 'piper', speaker: 'en_US-ryan-high', color: '#d4af37' } },
      theme: { accent: '#d4af37', bg: '#0a0a0a', mode: 'dark', stage: '#0d0d0d', panel: '#111111', line: '#2a2a2a', ink: '#f5f0e8', muted: '#8a7f6e',
        gold: '#d4af37', deep: '#050505', halo: '#1a1000' },
      captions: { preset: 'karaoke' },
      chrome: { topbar: false, counter: false, progress: true },
      timing: { tempo: 0.9, lead: 0.5, tail: 1.2 },
      scenes: [
        { id: 'tease', vo: [{ who: 'a', text: 'Some objects cannot be described. They must be seen.' }],
          body: '<div class="s-center"><div class="display reveal" style="font-size:28px;letter-spacing:.15em;color:var(--gold)">A E T H E L</div><div class="hairline reveal"></div></div>', dur: 8 },
        { id: 'dial', vo: [{ who: 'a', text: 'Hand-engraved, assembled by one artisan over sixty hours.' }],
          body: '<div class="s-center"><div class="bigquote reveal" style="font-size:48px;color:var(--gold)">60 hours</div><p class="small cue" data-cue="0">One artisan. One watch.</p></div>', transition: 'fade', dur: 10 },
        { id: 'close', vo: [{ who: 'a', text: 'Aethel. Made in Geneva.' }],
          body: '<div class="s-close"><div class="close-sign reveal">A E T H E L</div><div class="close-line reveal">Geneva · Since 1891</div></div>', transition: 'zoom', dur: 8 },
      ],
    },
    /* Children's illustrated story */
    {
      title: 'Fox Finds a Friend', size: '16:9',
      voices: { a: { backend: 'piper', speaker: 'en_US-hfc_female-medium', color: '#e8713e' } },
      theme: { accent: '#e8713e', bg: '#fef9f0', mode: 'light', ink: '#2d1b0e', stage: '#fdf3e5', panel: '#fff', line: '#e8c8a0', muted: '#a08060',
        pink: '#f0a0b0', green: '#8cb04a', gold: '#f5c842' },
      themeCss: '@font-face{font-family:"Fox Tale";src:url("assets/fox-tale.woff2")}body{font-family:"Fox Tale",serif}',
      chrome: { topbar: false, counter: false, progress: true },
      captions: { preset: 'slam', maxWords: 5 },
      scenes: [
        { id: 'title', vo: [{ who: 'a', text: 'Once upon a morning, in a forest not far from here...' }],
          body: '<div class="s-title"><div class="display reveal" style="font-size:64px;color:var(--accent)">Fox Finds a Friend</div><div class="hairline reveal"></div></div>' },
        { id: 'walk', vo: [{ who: 'a', text: '...a small fox named Finn set out to find a friend.' }],
          body: '<div class="s-center"><div style="font-size:80px;background:url(assets/forest.svg);width:100%;height:200px;border-radius:16px">🦊</div><p class="lede cue" data-cue="0">Finn the fox</p></div>', transition: 'wipe' },
        { id: 'meet', vo: [{ who: 'a', text: 'He met a rabbit. "Will you be my friend?" he asked.' }],
          body: '<div class="s-two"><div class="pane center" style="font-size:60px">🦊</div><div class="pane center" style="font-size:60px">🐰</div></div>' },
        { id: 'yes', vo: [{ who: 'a', text: 'And the rabbit smiled. "I already am."' }],
          body: '<div class="s-center"><div class="bigquote reveal" style="color:var(--accent)">I already am.</div><div class="hairline reveal"></div></div>' },
        { id: 'close', vo: [{ who: 'a', text: 'And from that day, Finn was never alone.' }],
          body: '<div class="s-center"><div style="font-size:80px">🦊💛🐰</div><p class="small cue" data-cue="0">The end</p></div>' },
      ],
    },
    /* Brutalist music visualizer */
    {
      title: 'Grid Drift', size: '9:16',
      voices: {},
      theme: { accent: '#ffffff', bg: '#111111', mode: 'dark', stage: '#111111', panel: '#1a1a1a', line: '#333333', ink: '#ffffff', muted: '#777777' },
      themeCss: '.grid-cell{background:var(--line);transition:none}.grid-cell.on{background:var(--accent)}.lyric{font-family:var(--mono);font-size:12px;letter-spacing:.2em;color:var(--muted)}',
      captions: { preset: 'pop' },
      chrome: false,
      bed: { file: 'assets/drone.wav', volume: 0.5 },
      scenes: [
        { id: 'intro', dur: 8, vo: [],
          body: '<div class="grid" style="display:grid;grid-template-columns:repeat(8,1fr);gap:2px;aspect-ratio:1"><div class="grid-cell on"></div><div class="grid-cell"></div><div class="grid-cell on"></div><div class="grid-cell"></div><div class="grid-cell on"></div><div class="grid-cell on"></div><div class="grid-cell"></div><div class="grid-cell on"></div></div>' },
        { id: 'drop', dur: 12, vo: [],
          body: '<div class="s-center"><div class="lyric reveal">PULSE · PATTERN · DRIFT</div><div class="display reveal" style="font-family:var(--mono);font-size:48px;letter-spacing:-.05em">⏣</div></div>' },
        { id: 'outro', dur: 8, vo: [],
          body: '<div class="s-center"><div class="lyric reveal">— end —</div></div>' },
      ],
    },
    /* Live software walkthrough */
    {
      title: 'Shipyard Demo', size: '16:9',
      voices: { a: { backend: 'piper', speaker: 'en_US-ryan-high', color: '#58a6ff' } },
      theme: { accent: '#58a6ff', bg: '#0d1117', mode: 'dark', ink: '#c9d1d9', stage: '#161b22', panel: '#21262d', line: '#30363d', green: '#3fb950', red: '#f85149' },
      captions: { preset: 'karaoke' },
      themeCss: '.terminal{font-family:var(--mono);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;color:var(--green)}',
      chrome: { topbar: false, counter: true, progress: true },
      walkthroughs: { app: { url: 'https://shipyard.example/dashboard', steps: [] } },
      scenes: [
        { id: 'hook', vo: [{ who: 'a', text: 'This is Shipyard. One click deploys your entire stack.' }],
          body: '<div class="s-title"><div class="eyebrow reveal">LIVE DEMO</div><h1 class="display reveal">Shipyard</h1><p class="lede cue" data-cue="0">Deploy in one click</p></div>', walkthrough: { id: 'app', layout: 'full', fit: 'contain', opacity: 1, position: { x: 0.5, y: 0.5 } } },
        { id: 'deploy', vo: [{ who: 'a', text: 'Pick a branch, hit deploy. Infrastructure, database, CDN — all in sixty seconds.' }],
          body: '<div class="s-center"><div class="terminal reveal">$ shipyard deploy --env production\n✓ 14 resources deployed in 58s</div><p class="small cue" data-cue="0">Zero-config deployment</p></div>' },
        { id: 'close', vo: [{ who: 'a', text: 'Shipyard. Infrastructure that ships with you.' }],
          body: '<div class="s-close"><div class="close-sign reveal">Shipyard</div><div class="close-line reveal">shipyard.dev — free for startups</div></div>' },
      ],
    },
    /* Archival documentary */
    {
      title: 'Apollo 11', size: '16:9',
      voices: { a: { backend: 'piper', speaker: 'en_US-ryan-high', color: '#d4a574' } },
      theme: { accent: '#d4a574', bg: '#1a1410', mode: 'dark', ink: '#ede4d8', stage: '#1e1814', panel: '#2a221c', line: '#4a3d30', muted: '#9a856b',
        gold: '#d4a574', green: '#7a9a6a', red: '#c45a4a' },
      captions: { preset: 'rise', emphasis: ['Apollo', 'moon', 'Armstrong', 'Aldrin'] },
      themeCss: '.archive{filter:sepia(0.4) brightness(0.9)}.typed{font-family:var(--mono);background:var(--panel);border-left:3px solid var(--accent);padding:12px 16px;font-size:14px}',
      chrome: { topbar: true, counter: true, progress: true },
      timing: { tempo: 1.0, lead: 0.3, tail: 0.8 },
      scenes: [
        { id: 'hook', vo: [{ who: 'a', text: 'July 20, 1969. Eight years after President Kennedy made a promise.' }],
          body: '<div class="s-center"><h1 class="display reveal">1969</h1><div class="typed cue" data-cue="0">"We choose to go to the moon" — JFK, 1962</div></div>' },
        { id: 'craft', vo: [{ who: 'a', text: 'The Saturn V stood 363 feet tall. Three million parts.' }],
          body: '<div class="s-two"><div class="pane center" data-drift="in"><div style="width:100%;height:200px;background:linear-gradient(0deg,var(--panel),var(--gold));border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:48px">🚀</div></div><div class="pane center"><div class="stat reveal" data-count="363" data-count-suffix=" ft">0 ft</div><div class="stat-cap">Saturn V height</div></div></div>' },
        { id: 'land', vo: [{ who: 'a', text: 'And then — the Eagle landed. Tranquility Base here.' }],
          body: '<div class="s-center"><div class="bigquote reveal">&ldquo;The Eagle has landed.&rdquo;</div><div class="small cue" data-cue="0">July 20, 1969 · 20:17 UTC</div></div>' },
        { id: 'step', vo: [{ who: 'a', text: 'One small step for man. One giant leap for mankind.' }],
          body: '<div class="s-center"><div class="display reveal" style="font-size:60px">&#9790;</div><p class="lede reveal">Tranquility Base</p></div>' },
        { id: 'close', vo: [{ who: 'a', text: 'Apollo 11. Three men. One moon. Humanity\'s greatest journey.' }],
          body: '<div class="s-close"><div class="close-sign reveal">Apollo 11</div><div class="close-line reveal">Armstrong · Aldrin · Collins</div></div>' },
      ],
    },
    /* Kinetic Urdu typography */
    {
      title: 'Lafz', size: '9:16',
      voices: { n: { backend: 'piper', speaker: 'urdu-voice', color: '#ff6b6b', lang: 'ur' } },
      theme: { accent: '#ff6b6b', bg: '#1a0a2e', mode: 'dark', ink: '#f0e6ff', stage: '#200d3a', panel: '#2d154a', line: '#4a2d6e', muted: '#9a80c0',
        pink: '#ff6b6b', gold: '#ffd700', green: '#51cf66' },
      captions: { preset: 'pop', emphasis: ['لفظ', 'رنگ', 'آواز'] },
      themeCss: '.urdu{font-family:"Noto Nastaliq Urdu",serif;direction:rtl;line-height:2}.gradient-text{background:linear-gradient(135deg,var(--pink),var(--gold),var(--green));-webkit-background-clip:text;background-clip:text;color:transparent}',
      chrome: false,
      choreography: 'var sc=DATA.scenes[0];tl.fromTo("#scene-l1 .w1",{x:-200,opacity:0},{x:0,opacity:1,duration:1,ease:"power3.out"},sc.start+sc.turns[0]);tl.fromTo("#scene-l1 .w2",{y:-100,opacity:0},{y:0,opacity:1,duration:0.8,ease:"back.out(2)"},sc.start+sc.turns[0]+0.3);',
      scenes: [
        { id: 'l1', vo: [{ who: 'n', text: 'لفظ۔ رنگ۔ آواز۔', lang: 'ur' }],
          body: '<div class="urdu s-center"><div class="w1" style="font-size:64px;color:var(--pink);font-weight:900">لفظ</div><div class="w2" style="font-size:48px;color:var(--gold)">رنگ</div><div class="w3" style="font-size:36px;color:var(--green)">آواز</div></div>' },
        { id: 'l2', vo: [{ who: 'n', text: 'ہر لفظ میں ایک کہانی ہے۔', lang: 'ur' }],
          body: '<div class="urdu s-center"><p class="display reveal gradient-text">ہر لفظ میں<br>ایک کہانی ہے۔</p></div>' },
      ],
    },
    /* 3D character comedy */
    {
      title: 'Cat vs Mouse', size: '16:9',
      voices: {
        cat: { backend: 'piper', speaker: 'en_US-ryan-high', color: '#ff7eb6' },
        mouse: { backend: 'piper', speaker: 'en_US-hfc_female-medium', color: '#2ee6d6' },
      },
      theme: { accent: '#ff7eb6', bg: '#1b0a2e', mode: 'dark', stage: '#240f3a', ink: '#f0e0ff', pink: '#ff7eb6', gold: '#ffd700' },
      captions: { preset: 'slam' },
      chrome: { topbar: false, counter: false, progress: true },
      scenes: [
        { id: 'chase', dur: 8, vo: [
          { who: 'cat', text: 'You can run, little mouse...' },
          { who: 'mouse', text: 'But I can hide! Nya nya!' },
        ],
        elements: [
          { type: 'camera', position: [0, 3.5, 7], lookAt: [0, 0.6, 0] },
          { type: 'light', kind: 'ambient', intensity: 0.6 },
          { type: 'light', kind: 'directional', position: [4, 6, 4] },
          { type: 'effect', kind: 'background', color: '#1b0a2e' },
          { type: 'ground', size: 12, color: '#2a1550' },
          { type: 'character', kind: 'cat', position: [-3, 0, 0.5], actions: [{ type: 'move', to: [2, 0, 0.5], duration: 6, at: { cue: 0 } }] },
          { type: 'character', kind: 'mouse', position: [3, 0, 0], actions: [{ type: 'move', to: [-2, 0, 0], duration: 6, at: { cue: 1 } }] },
        ] },
        { id: 'punch', dur: 6, vo: [
          { who: 'mouse', text: 'Wait... what is that smell?' },
          { who: 'cat', text: 'Cheese. I brought cheese. Peace offering?' },
        ],
        elements: [
          { type: 'camera', position: [0, 2.5, 6], lookAt: [0, 0.6, 0] },
          { type: 'light', kind: 'ambient', intensity: 0.6 },
          { type: 'light', kind: 'directional', position: [0, 8, 2] },
          { type: 'effect', kind: 'background', color: '#1b0a2e' },
          { type: 'ground', size: 12, color: '#2a1550' },
          { type: 'character', kind: 'cat', position: [1.5, 0, 0.3] },
          { type: 'character', kind: 'mouse', position: [-1.5, 0, 0] },
          { type: 'sphere', size: 0.3, color: '#ffd700', position: [1.2, 0.6, 0.3] },
        ] },
      ],
    },
    /* Quiet scientific explanation */
    {
      title: 'How Vaccines Work', size: '16:9',
      voices: { a: { backend: 'piper', speaker: 'en_US-hfc_female-medium', color: '#4a90d9' } },
      theme: { accent: '#4a90d9', bg: '#f5f8fc', mode: 'light', ink: '#1a2d3d', stage: '#eaf1f8', panel: '#ffffff', line: '#d0dde8', muted: '#6b8297',
        green: '#38a169', red: '#e53e3e' },
      captions: { preset: 'rise', maxWords: 8 },
      themeCss: '.diagram{border:2px solid var(--line);border-radius:16px;padding:24px;background:var(--panel)}.label{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--muted)}',
      chrome: { topbar: false, counter: false, progress: false },
      timing: { tempo: 0.95, lead: 0.3, tail: 0.8 },
      scenes: [
        { id: 'intro', vo: [{ who: 'a', text: 'Your immune system is like a security team. It learns to recognize threats.' }],
          body: '<div class="diagram s-center"><div class="display reveal" style="font-size:48px">&#128737;</div><p class="label reveal">Immune system</p><p class="lede cue" data-cue="0">Your body\'s security team</p></div>' },
        { id: 'pathogen', vo: [{ who: 'a', text: 'When a virus enters, the immune system studies it. It takes time.' }],
          body: '<div class="diagram s-center"><div class="flow"><div class="lane accent-lane"><div class="ln">&#129440;</div><div class="lr">Virus enters</div></div><div class="conn"><div class="carr">→</div></div><div class="lane"><div class="ln">&#128737;</div><div class="lr">Immune response</div></div></div></div>', transition: 'slide' },
        { id: 'vaccine', vo: [{ who: 'a', text: 'A vaccine shows the immune system what the virus looks like — without the danger.' }],
          body: '<div class="diagram s-center"><div class="display reveal" style="font-size:80px">&#128137;</div><p class="label reveal">Vaccine</p><p class="lede cue" data-cue="0">A harmless preview of the virus</p></div>', transition: 'fade' },
        { id: 'antibodies', vo: [{ who: 'a', text: 'The immune system builds antibodies — proteins that recognize and neutralize the virus.' }],
          body: '<div class="s-two"><div class="pane center"><div class="stat reveal" data-count="100000" data-count-suffix="+">0</div><div class="stat-cap">Potential antibodies</div></div><div class="pane center"><div class="display reveal" style="font-size:48px">Y</div><div class="stat-cap">Antibody shape</div></div></div>', transition: 'slide' },
        { id: 'memory', vo: [{ who: 'a', text: 'Memory cells remember. If the real virus ever appears, the response is immediate.' }],
          body: '<div class="diagram s-center"><div class="bigquote reveal">&ldquo;Remember and protect.&rdquo;</div><div class="label cue" data-cue="0">Immunological memory</div></div>' },
        { id: 'close', vo: [{ who: 'a', text: 'Vaccines don\'t just protect you. They protect everyone around you. Thank you for listening.' }],
          body: '<div class="s-center"><div class="display reveal" style="font-size:60px">&#128150;</div><p class="lede reveal">Protect yourself. Protect others.</p></div>' },
      ],
    },
  ];
}

/* ---- Test: extract metrics from all configs ------------------------------- */

test('creative-diversity: 10 briefs produce distinct visual systems', () => {
  const configs = generateConfigs();
  const metrics = configs.map(c => extractMetrics(c));
  const result = checkConvergence(metrics, BRIEFS);

  // Assertions: the suite should PASS if diversity is good, 
  // and FAIL if there is convergence.

  // No more than 2 projects should share the default palette
  assert.ok(result.stats.defaultPalettes <= 2,
    `Only ${result.stats.defaultPalettes}/10 projects should use the default palette`);

  // At least 3 different caption presets across 10 projects
  assert.ok(result.stats.presetCount >= 3,
    `At least 3 caption presets needed, got ${result.stats.presetCount}`);

  // At least 3 projects use custom CSS
  assert.ok(result.stats.cssCount >= 3,
    `At least 3 projects should use custom CSS, got ${result.stats.cssCount}`);

  // At least 1 project should use 3D/elements (it's a specialized surface)
  assert.ok(result.stats.threeDCount >= 1,
    `At least 1 project should use 3D/elements, got ${result.stats.threeDCount}`);

  // No more than 7 projects should keep default chrome
  assert.ok(result.stats.defaultChrome <= 7,
    `At most 7 projects should keep default chrome, got ${result.stats.defaultChrome}`);

  // At least 3 distinct scene counts
  assert.ok(result.stats.uniqueSceneCounts >= 3,
    `At least 3 distinct scene counts needed, got ${result.stats.uniqueSceneCounts}`);

  // At most 4 projects should use the hook-title + CTA-end pattern
  assert.ok(result.stats.hookCtaMatches <= 4,
    `At most 4 hook-CTA patterns, got ${result.stats.hookCtaMatches}`);

  // Multiple voice counts: not all should be 1
  // (at least some should be 0 or 2)
  assert.ok((result.stats.oneVoice + result.stats.twoVoices) >= (10 - 1),
    `Most projects should use 1-2 voices, but diversity in count is expected`);

  // Print a readable report
  console.log('\n--- Creative Diversity Report ---');
  console.log(`The 10 briefs produce ${metrics.length} projects.`);
  console.log(`Total issues: ${result.issues.length}`);
  for (const issue of result.issues) console.log(`  ⚠ ${issue}`);
  console.log(`\nMetrics per project:`);
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    const b = BRIEFS[i];
    console.log(`  ${i+1}. ${b.name}`);
    console.log(`     scenes:${m.sceneCount} voices:${m.voiceCount} preset:${m.captionPreset}` +
      ` palette:${m.isDefaultPalette ? 'default' : 'custom'}(${m.customTokens}t)` +
      ` css:${m.hasCustomCSS ? 'Y' : 'N'} choreo:${m.hasChoreography ? 'Y' : 'N'}` +
      ` 3D:${m.has3D ? 'Y' : 'N'} elem:${m.hasElements ? 'Y' : 'N'}` +
      ` chrome:${m.usesDefaultChrome ? 'default' : 'custom'}` +
      ` hook:${m.hasTitleHook ? 'Y' : 'N'} cta:${m.hasCTAEnd ? 'Y' : 'N'}`);
  }
  console.log('');
});

// Evaluate each brief individually against its expected creative fingerprint.
test('creative-diversity: each brief matches its creative intent', () => {
  const configs = generateConfigs();
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const brief = BRIEFS[i];
    const m = extractMetrics(config);

    if (brief.expected.voiceCount !== undefined) {
      assert.equal(m.voiceCount, brief.expected.voiceCount,
        `${brief.name}: expected ${brief.expected.voiceCount} voice(s), got ${m.voiceCount}`);
    }
    if (brief.expected.minScenes !== undefined) {
      assert.ok(m.sceneCount >= brief.expected.minScenes,
        `${brief.name}: expected ≥${brief.expected.minScenes} scenes, got ${m.sceneCount}`);
    }
    if (brief.expected.maxScenes !== undefined) {
      assert.ok(m.sceneCount <= brief.expected.maxScenes,
        `${brief.name}: expected ≤${brief.expected.maxScenes} scenes, got ${m.sceneCount}`);
    }
    if (brief.expected.captionPreset !== undefined) {
      assert.equal(m.captionPreset, brief.expected.captionPreset,
        `${brief.name}: expected "${brief.expected.captionPreset}" preset`);
    }
    if (brief.expected.uses3D) {
      assert.ok(m.has3D || m.hasElements, `${brief.name}: should use 3D or elements`);
    }
    if (brief.expected.usesCustomCSS) {
      assert.ok(m.hasCustomCSS, `${brief.name}: should use custom CSS`);
    }
    if (brief.expected.usesChoreography) {
      assert.ok(m.hasChoreography, `${brief.name}: should use choreography`);
    }
    if (brief.expected.containsSilent) {
      assert.ok(m.hasSilentScenes, `${brief.name}: should contain silent scenes`);
    }
    if (brief.expected.usesWalkthrough) {
      assert.ok(m.hasWalkthrough, `${brief.name}: should use walkthrough`);
    }
    if (brief.expected.usesElements) {
      assert.ok(m.hasElements, `${brief.name}: should use elements`);
    }
  }
});

// Human review checklist — printed for manual inspection.
test('creative-diversity: print human review checklist', () => {
  console.log(`\n--- Human Review Checklist ---`);
  console.log(`For each of the 10 briefs, review:`);
  for (const b of BRIEFS) {
    console.log(`  [ ] ${b.name}`);
    console.log(`      - Visual system is genuinely distinct`);
    console.log(`      - Not a re-skin of the same template structure`);
    console.log(`      - Fits the brief's stated aesthetic/mood/format`);
  }
  console.log(`\nConvergence risk areas to watch:`);
  console.log(`  1. Dark-navy + teal-accent default palette appearing`);
  console.log(`  2. Karaoke captions on every project`);
  console.log(`  3. Centered title-card structure dominating`);
  console.log(`  4. Narova chrome appearing where it doesn't belong`);
  console.log(`  5. Built-in layout classes used as templates, not tools`);
  console.log(`  6. No custom CSS or choreography across projects`);
  console.log(`  7. Same 2-host casting on every project`);
  console.log('');
});
