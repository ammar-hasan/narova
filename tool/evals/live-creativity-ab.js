#!/usr/bin/env node
'use strict';
/* Tiny live A/B: same model + brief + renderer, with only Narova's authoring
 * guidance varied. It generates PILOTS, never full videos. Outputs live in a
 * temporary directory unless --out is supplied. This is intentionally an
 * experiment runner, not a benchmark platform. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

const flags = args(process.argv.slice(2));
const runs = Number(flags.runs || 2);
const model = flags.model || 'gpt-5.6-sol';
const root = path.resolve(__dirname, '..', '..', '..', '..');
const cli = path.join(root, 'skills', 'narova', 'tool', 'bin', 'narova.js');
const output = path.resolve(flags.out || fs.mkdtempSync(path.join(os.tmpdir(), 'narova-creativity-ab-')));
fs.mkdirSync(output, { recursive: true });

const chosen = [
  {
    id: 'music-only',
    brief: 'Make a 60s video from this ambient music track. No narration, no captions, no text on screen. Pure visual response to the music — shapes, color, motion.',
  },
  {
    id: 'shader-piece',
    brief: 'A 30s abstract procedural piece. Custom GLSL shader driven by the timeline, no pre-made geometry, no declarative elements. Raw WebGL.',
  },
];

function analyzeConfig(config) {
  const scenes = config.scenes || [];
  return {
    sceneCount: scenes.length,
    voiceCount: Object.keys(config.voices || {}).length,
    hasVo: scenes.some(scene => (scene.vo || []).length > 0),
    captionsEnabled: config.captions !== false,
    chromeEnabled: config.chrome === true || !!(config.chrome && Object.values(config.chrome).some(Boolean)),
    patternsEnabled: config.patterns === true,
    usesThemeCss: !!(config.theme && config.theme.css),
    usesThreeJS: scenes.some(scene => !!scene.three),
    usesThreeModule: scenes.some(scene => !!scene.threeModule),
  };
}
const skill = fs.readFileSync(path.join(root, 'skills', 'narova', 'SKILL.md'), 'utf8');
const direction = fs.readFileSync(path.join(root, 'skills', 'narova', 'references', 'prompt-to-video.md'), 'utf8');
const schema = {
  type: 'object', additionalProperties: false,
  required: ['concept', 'rationale', 'configJson', 'themeCss', 'threeModule'],
  properties: {
    concept: { type: 'string' }, rationale: { type: 'string' },
    configJson: { type: 'string' }, themeCss: { type: 'string' }, threeModule: { type: 'string' },
  },
};
const schemaFile = path.join(output, 'response.schema.json');
fs.writeFileSync(schemaFile, JSON.stringify(schema, null, 2));

const contract = `Return one JSON object matching the supplied schema. Author only a small deterministic visual proof (8–12 seconds total), not a complete video.
configJson is a string containing valid JSON for Narova input: title, size, optional patterns/chrome/safeLayout/captions/theme, optional voices, and scenes. Each silent scene uses vo:[] plus positive dur and a body HTML string. themeCss is local static CSS. threeModule is optional local deterministic Three.js code; when non-empty, set a scene's threeModule to "pilot.js". No remote assets, CSS animation/transition, Date, Math.random, requestAnimationFrame, setTimeout, or fetch. Use full-frame HTML/CSS/SVG or timeline-driven raw Three.js. The model is making a visual proof; do not explain outside JSON.`;

function promptFor(brief, condition) {
  const context = condition === 'with'
    ? `\nUse the following Narova authoring guidance as your platform context:\n<narova-skill>\n${skill}\n</narova-skill>\n<creative-direction>\n${direction}\n</creative-direction>`
    : '\nYou have no Narova authoring guidance beyond the minimal artifact contract above.';
  return `${contract}${context}\n\nBRIEF (${brief.id}): ${brief.brief}`;
}

function run(cmd, argv, cwd, timeout = 300000) {
  return spawnSync(cmd, argv, { cwd, encoding: 'utf8', timeout, maxBuffer: 20 * 1024 * 1024 });
}

const records = [];
for (const brief of chosen) {
  for (const condition of ['without', 'with']) {
    for (let n = 1; n <= runs; n++) {
      const id = `${brief.id}-${condition}-${n}`;
      const dir = path.join(output, id);
      fs.mkdirSync(dir, { recursive: true });
      const responseFile = path.join(dir, 'response.json');
      const generated = run('codex', [
        'exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--model', model, '--output-schema', schemaFile,
        '--output-last-message', responseFile, promptFor(brief, condition),
      ], dir, 600000);
      if (generated.status !== 0) {
        records.push({ id, brief: brief.id, condition, run: n, error: `generation failed: ${generated.stderr || generated.stdout}` });
        continue;
      }
      let response;
      try { response = JSON.parse(fs.readFileSync(responseFile, 'utf8')); }
      catch (error) {
        records.push({ id, brief: brief.id, condition, run: n, error: `invalid response JSON: ${error.message}` });
        continue;
      }
      let config;
      try { config = JSON.parse(response.configJson); }
      catch (error) {
        records.push({ id, brief: brief.id, condition, run: n, error: `invalid configJson: ${error.message}` });
        continue;
      }
      config.scenes = config.scenes || [];
      if (response.themeCss) {
        config.theme = { ...(config.theme || {}), css: 'theme.css' };
        fs.writeFileSync(path.join(dir, 'theme.css'), response.themeCss);
      }
      if (response.threeModule) {
        fs.writeFileSync(path.join(dir, 'pilot.js'), response.threeModule);
      }
      fs.writeFileSync(path.join(dir, 'reel.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`);

      const stages = [];
      for (const stage of [
        ['check', '--project', dir], ['synth', '--project', dir],
        ['compose', '--project', dir], ['shots', '--motion', '--proof', '--project', dir],
      ]) {
        const result = run('node', [cli, ...stage], dir, 600000);
        stages.push({ command: stage.join(' '), status: result.status, stdout: result.stdout, stderr: result.stderr });
        if (result.status !== 0) break;
      }
      const frames = fs.existsSync(path.join(dir, 'out'))
        ? fs.readdirSync(path.join(dir, 'out'), { recursive: true })
          .filter(f => /\.(?:png|jpg|jpeg)$/i.test(f)).map(f => path.join('out', f))
        : [];
      const profile = analyzeConfig(config);
      records.push({
        id, brief: brief.id, condition, run: n, concept: response.concept,
        rationale: response.rationale, profile, sceneCount: config.scenes.length,
        totalDuration: config.scenes.reduce((sum, s) => sum + (Number(s.dur) || 0), 0),
        centeredFraming: config.safeLayout === true || config.patterns === true ||
          config.scenes.some(s => /justify-content\s*:\s*center|align-items\s*:\s*center|text-align\s*:\s*center|s-title|s-center/.test(String(s.body || ''))),
        stages, frames,
      });
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ model, runs, briefs: chosen, records }, null, 2));
      process.stdout.write(`${id}: ${stages.at(-1)?.status === 0 ? 'rendered' : 'failed'}\n`);
    }
  }
}

fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ model, runs, briefs: chosen, records }, null, 2));
console.log(`results: ${path.join(output, 'results.json')}`);
