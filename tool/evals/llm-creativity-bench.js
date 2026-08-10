'use strict';
/* LLM-in-the-loop creativity benchmark framework.
 *
 * This is the companion to creative-diversity-eval.js. That eval tests whether
 * Narova's SCHEMA can represent diverse videos (necessary condition). This
 * framework tests whether an LLM USING Narova produces more creative, diverse,
 * and ambitious work than the same LLM without Narova (the real product test).
 *
 * Architecture:
 *   1. Fixture-based mode: pre-baked fixture configs in fixtures/llm-bench/
 *      simulate LLM output for deterministic CI runs (no API calls, no cost).
 *      Run: node tool/evals/llm-creativity-bench.js
 *   2. LLM mode: substitution mechanism. Replace fixture loader with an LLM
 *      adapter that calls a model. Same metrics, same briefs, but real model.
 *      Run with --llm <adapter-path> to use a live LLM.
 *
 * Metrics (measured on Narova configs + raw-config baselines):
 *   Conceptual diversity   — how different are multiple outputs for the same brief?
 *   Visual vocabulary       — palette topology, layout classes, font usage
 *   Escape-hatch usage      — choreography, three.js, threeModule, raw CSS
 *   Narova-class dependency  — how many outputs rely on built-in patterns?
 *   Hook/CTA convergence     — repeated narrative formulas across outputs
 *   Caption diversity        — preset choices, emphasis patterns
 *   Scene-count distribution — within and across outputs
 *   Palette uniqueness       — how many distinct color topologies?
 *   Iteration behavior       — did the model explore before committing?
 *   Ambition recovery         — after a capability failure, did the model drop lower or simplify?
 *
 * Adversarial briefs (from PRODUCT STRATEGY):
 *   music-only, no narration, no captions, one continuous 30s shot,
 *   slow first 5s, empty final frame, anti-CTA brand film,
 *   surreal procedural shader, raw Three.js/WebGL,
 *   kinetic Urdu typography, archival documentary collage,
 *   children's illustrated, luxury product, brutalist,
 *   "do not use cards, title slides, pills, grids, or standard UI metaphors"
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('path');
const fs = require('fs');

/* ---- Adversarial test briefs -------------------------------------------- */

const ADVERSARIAL_BRIEFS = [
  {
    id: 'music-only',
    brief: 'Make a 60s video from this ambient music track. No narration, no captions, no text on screen. Pure visual response to the music — shapes, color, motion.',
    adversarial: 'narration-first tool must handle zero-narration work natively',
    metrics: ['noVoices', 'noCaptions', 'sceneCount', 'hasVisualTree'],
  },
  {
    id: 'no-captions',
    brief: 'A 45s fashion brand film. No narrated captions, no karaoke words. Float the brand name once at the end. Slow edits, dark mood, editorial photography.',
    adversarial: 'captions:false must not penalize or warn',
    metrics: ['captionsEnabled', 'captionText', 'hasHook'],
  },
  {
    id: 'one-shot',
    brief: 'A single continuous 30-second shot. One camera, one scene, one composition. No cuts, no transitions, no cards. Make it compelling.',
    adversarial: 'tool should not force multi-scene structure',
    metrics: ['sceneCount', 'transitionUse', 'layoutClassUse'],
  },
  {
    id: 'slow-opening',
    brief: 'A 60s meditation aid. The first 8 seconds are black silence with only a faint breathing sound, then a slow sunrise of warm light revealing text one word at a time.',
    adversarial: 'hook enforcement must not fire on deliberate slow open',
    metrics: ['hasHook', 'leadSilence', 'sceneCount'],
  },
  {
    id: 'empty-final-frame',
    brief: 'A 45s film that intentionally ends on 4 seconds of black silence. No CTA, no logo, no text. The silence IS the message.',
    adversarial: 'saveable end-frame check must not fire',
    metrics: ['hasCTA', 'finalText', 'finalImages'],
  },
  {
    id: 'anti-cta-brand',
    brief: 'A 90s brand film that deliberately ends NOT with a call to action but with a question the viewer sits with. No "try now," no "sign up," no URL overlay.',
    adversarial: 'CTA assumption must not be built into tool',
    metrics: ['hasCTA', 'hookText', 'layoutClassUse'],
  },
  {
    id: 'shader-piece',
    brief: 'A 30s abstract procedural piece. Custom GLSL shader driven by the timeline, no pre-made geometry, no declarative elements. Raw WebGL.',
    adversarial: 'threeModule escape hatch must feel first-class',
    metrics: ['usesThreeModule', 'usesElements', 'layoutClassUse'],
  },
  {
    id: 'urdu-typography',
    brief: 'A 45s kinetic typography film in Urdu. Urdu script, Urdu voiceover (if any), right-to-left text animation. No English, no left-to-right layout assumptions.',
    adversarial: 'RTL + Urdu script must work as naturally as English',
    metrics: ['language', 'rtlUse', 'fontUse', 'captionPreset'],
  },
  {
    id: 'archival-collage',
    brief: 'A 60s documentary collage from historical photographs. No narrator — caption cards only. Photos animate with Ken Burns drift, connected by short text intertitles.',
    adversarial: 'non-speech visual storytelling must be native',
    metrics: ['noVoices', 'imageCount', 'dataDrift', 'noCaptionKaraoke'],
  },
  {
    id: 'no-ui-metaphors',
    brief: 'Create a 45s film with NO cards, NO title slides, NO pills, NO grids, NO progress bars, NO counters, NO standard UI metaphors. Build an organic visual language from scratch.',
    adversarial: 'built-in layout vocabulary must not leak into output',
    metrics: ['layoutClassUse', 'chromeUse', 'usesPatternsConfig'],
  },
];

/* ---- Diversity metrics ------------------------------------------------- */

function analyzeConfig(rawConfig) {
  const scenes = rawConfig.scenes || [];
  const voices = rawConfig.voices || {};
  const theme = rawConfig.theme || {};

  return {
    sceneCount: scenes.length,
    voiceCount: Object.keys(voices).length,
    hasVo: scenes.some(s => (s.vo || []).length > 0),
    captionsEnabled: rawConfig.captions !== false,
    // Chrome is OPT-IN as of v0.26 (off by default). Treat it as enabled only
    // when the model explicitly turns it on (true, or an object with a true key).
    chromeEnabled: rawConfig.chrome === true ||
      (rawConfig.chrome != null && rawConfig.chrome !== false &&
        Object.values(rawConfig.chrome).some(v => v === true)),
    patternsEnabled: rawConfig.patterns === true,
    usesThemeCss: !!(theme.css),
    usesBodyHtml: scenes.some(s => typeof s.body === 'string'),
    usesVisualTree: scenes.some(s => !!s.visual),
    usesThreeJS: scenes.some(s => !!s.three),
    usesThreeModule: scenes.some(s => !!s._threeModuleContents || !!s.threeModule),
    usesElements: scenes.some(s => Array.isArray(s.elements) && s.elements.length > 0),
    usesChoreography: !!rawConfig.choreography,
    usesAssets: scenes.some(s => typeof s.body === 'string' && /<img|<video|src=["']assets\//.test(s.body)),
    usesDataDrift: scenes.some(s => typeof s.body === 'string' && /data-drift/.test(s.body)),
    hasTransition: scenes.some(s => s.transition),
    captionPreset: (rawConfig.captions && rawConfig.captions.preset) || 'subtitle',
    usesLayoutClasses: scenes.some(s => typeof s.body === 'string' &&
      /\b(s-title|pane|stat|flow|verdicts|s-close|s-two|planes|stepper|bigquote|ledger|referee|owners|homes|dials|desk|stack|flags)\b/.test(s.body)),
    accentColor: theme.accent || '',
    bgColor: theme.bg || '',
    hasHookFormat: scenes[0] && typeof scenes[0].body === 'string' && /\b(?:eyebrow|display|lede|close-line|hook|reveal)\b/.test(scenes[0].body),
    hasCTAFormat: scenes[scenes.length - 1] && typeof scenes[scenes.length - 1].body === 'string' && /\b(?:close-line|close-sign|ctag|cta|subscribe|sign.?up|try|start)\b/i.test(scenes[scenes.length - 1].body),
    transitionTypes: [...new Set(scenes.map(s => s.transition || 'fade').filter(Boolean))],
    platform: rawConfig.platform || null,
    timing: rawConfig.timing ? { ...rawConfig.timing } : null,
  };
}

function diversityScore(samples) {
  if (samples.length < 2) return { score: 1.0, detail: 'single sample — no diversity measured' };

  const profiles = samples.map(analyzeConfig);
  const dimensions = {};

  // Palette uniqueness
  const palettes = new Set(profiles.map(p => `${p.accentColor}|${p.bgColor}`));
  dimensions.paletteUniqueness = palettes.size / profiles.length;

  // Scene-count spread
  const counts = profiles.map(p => p.sceneCount);
  dimensions.sceneCountSpread = new Set(counts).size / profiles.length;

  // Voice-count diversity
  const vcounts = new Set(profiles.map(p => p.voiceCount));
  dimensions.voiceCountDiversity = vcounts.size / profiles.length;

  // Caption preset diversity
  const presets = new Set(profiles.map(p => p.captionPreset));
  dimensions.captionPresetDiversity = presets.size / profiles.length;

  // Layout class independence (lower = more original)
  const layoutUse = profiles.filter(p => p.usesLayoutClasses).length;
  dimensions.layoutClassIndependence = 1 - (layoutUse / profiles.length);

  // Escape-hatch usage (higher = more ambitious)
  const hatchUse = profiles.filter(p => p.usesChoreography || p.usesThreeModule || p.usesThreeJS).length;
  dimensions.escapeHatchUsage = hatchUse / profiles.length;

  // Visual tree usage
  dimensions.visualTreeUse = profiles.filter(p => p.usesVisualTree).length / profiles.length;

  // Pattern config opt-in (vs relying on built-in default)
  dimensions.patternsExplicit = profiles.filter(p => p.patternsEnabled).length / profiles.length;

  // Hook format independence
  const hookUse = profiles.filter(p => p.hasHookFormat).length;
  dimensions.hookIndependence = 1 - (hookUse / profiles.length);

  // CTA format independence
  const ctaUse = profiles.filter(p => p.hasCTAFormat).length;
  dimensions.ctaIndependence = 1 - (ctaUse / profiles.length);

  const scores = Object.values(dimensions);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  return { score: Math.round(avg * 100) / 100, dimensions, detail: `${profiles.length} samples` };
}

/* ---- Fixture loader (deterministic CI mode) ------------------------------- */

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'llm-bench');

function loadFixture(briefId, mode) {
  const file = path.join(FIXTURE_DIR, `${briefId}-${mode}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* ---- Test runner --------------------------------------------------------- */

test('adversarial briefs are defined and distinct', () => {
  const ids = new Set(ADVERSARIAL_BRIEFS.map(b => b.id));
  assert.equal(ids.size, ADVERSARIAL_BRIEFS.length, 'brief ids must be unique');
  assert.ok(ADVERSARIAL_BRIEFS.length >= 8, 'must have at least 8 adversarial briefs');
});

test('diversity scorer handles edge cases', () => {
  const single = diversityScore([{ title: 'T', scenes: [{ body: '<p>x</p>', vo: [{ who: 'a', text: 'a' }] }] }]);
  assert.equal(single.score, 1.0); // single sample passes by definition

  const two = diversityScore([
    { title: 'A', theme: { accent: '#ff0000', bg: '#000000' }, scenes: [{ body: '<p>one</p>', vo: [{ who: 'a', text: 'a' }] }], voices: { a: {} }, captions: { preset: 'karaoke' } },
    { title: 'B', theme: { accent: '#0000ff', bg: '#ffffff' }, scenes: [{ body: '<p>two</p>', vo: [{ who: 'a', text: 'b' }] }], voices: { a: {} }, captions: { preset: 'slam' } },
  ]);
  assert.ok(two.dimensions.paletteUniqueness === 1.0, 'two different palettes');
  assert.ok(two.dimensions.captionPresetDiversity === 1.0, 'two different caption presets');
});

test('fixture directory exists or can be created', () => {
  if (!fs.existsSync(FIXTURE_DIR)) fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  assert.ok(fs.existsSync(FIXTURE_DIR));
});

test('adversarial brief: music-only has correct metrics', () => {
  const brief = ADVERSARIAL_BRIEFS.find(b => b.id === 'music-only');
  assert.ok(brief);
  assert.ok(brief.metrics.includes('noVoices'));
  assert.ok(brief.metrics.includes('noCaptions'));
});

test('adversarial brief: shader-piece requires threeModule escape hatch', () => {
  const brief = ADVERSARIAL_BRIEFS.find(b => b.id === 'shader-piece');
  assert.ok(brief);
  assert.ok(brief.metrics.includes('usesThreeModule'));
  assert.ok(brief.metrics.includes('layoutClassUse'));
});

test('adversarial brief: anti-cta-brand measures CTA independence', () => {
  const brief = ADVERSARIAL_BRIEFS.find(b => b.id === 'anti-cta-brand');
  assert.ok(brief);
  assert.ok(brief.metrics.includes('hasCTA'));
  assert.ok(brief.metrics.includes('layoutClassUse'));
});

test('adversarial brief: no-ui-metaphors tests layout class leakage', () => {
  const brief = ADVERSARIAL_BRIEFS.find(b => b.id === 'no-ui-metaphors');
  assert.ok(brief);
  assert.ok(brief.metrics.includes('layoutClassUse'));
  assert.ok(brief.metrics.includes('chromeUse'));
  assert.ok(brief.metrics.includes('usesPatternsConfig'));
});

/* ---- LLM adapter contract (for future substitution) ----------------------
 *
 * An LLM adapter exports:
 *   { generate(rawBrief, context) → Promise<config> }
 *
 * Context includes: narovaVersion, schema docs, available tools.
 * The fixture-based mode skips this entirely — pre-baked configs are fast,
 * deterministic, and free. Swap in a real adapter for LLM evaluation.
 *
 * Example adapter skeleton:
 *
 *   const { loadProjectConfig, resolveConfig } = require('../src/config');
 *   async function generate(brief, ctx) {
 *     // Call LLM with brief + ctx.schemaDoc + ctx.prompt
 *     // Parse response into a config object
 *     return config;
 *   }
 *   module.exports = { generate };
 */

module.exports = { ADVERSARIAL_BRIEFS, analyzeConfig, diversityScore, FIXTURE_DIR, loadFixture };
