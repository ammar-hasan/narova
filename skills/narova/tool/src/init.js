'use strict';
/* Minimal project scaffold (creative contract + config + one scene). This is a
 * runnable stub; projects earn production scale by proving their pilot. */
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./util');

const CONFIG = `// narova project — see SPEC.md for the full scene API.
// This scaffold is production infrastructure only. Narova is zero-style by
// default — no visual identity, no chrome, no built-in layout classes.
// Every aesthetic choice is yours to make explicitly.
//
// Quick reference (all off by default):
//   chrome: true           — add topbar, counter, progress bar
//   chrome: { topbar: true }  — just the project wordmark
//   patterns: true         — include built-in layout classes (.s-title, .pane, etc.)
//   theme: { accent, bg }  — set color tokens; omit for neutral monochrome base
//   captions: false        — remove visual caption band (SRT/VTT sidecars always export)
//   captions: { preset: "karaoke" }  — word-by-word color highlights
//   timing.tempo           — adjust speech rate (null = 1.18x piper default)
//   scene.transition       — fade (default) | wipe | slide | zoom
//   markers: { name: seconds }  — named time anchors for data-cue="marker:name"
//
export default {
  title: "My Project",
  size: "16:9",                         // "16:9" | "1:1" | "9:16"
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high", label: "Narrator" },
    // Add or remove voices to match your concept. One voice works. Zero voices
    // works for silent projects with explicit scene durations.
  },
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58 },
  scenes: [
    {
      id: "opening",
      vo: [
        { who: "a", text: "This is a narova project. Design it from the brief." },
      ],
      body: \`<div style="width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center">
        <h1 style="font-size:64px;font-weight:800;line-height:1;color:var(--ink)">My Project</h1>
        <p style="font-size:18px;color:var(--muted);max-width:20em">Write your story here.</p>
      </div>\`,
    },
  ],
};
`;

const README = `# My Project

A narova project. Fill \`creative-brief.md\`, prove the direction with pilot
frames, then edit \`reel.config.mjs\` and run:

\`\`\`bash
narova check      # validate the config (fast)
narova critique creative,cinematic  # challenge direction and shot grammar
narova synth      # create narration + timings
narova compose && narova shots --beats  # inspect every narration beat
narova preview --detach  # persistent Studio; prints the review URL
narova build --reuse --release  # after approval -> out/video.mp4
\`\`\`

The first build sets up its own Python venv (~/.narova/venv) and downloads a
voice model. One-time wait, not a hang. \`narova doctor\` checks the machine.
`;

const CREATIVE_BRIEF = `# Creative brief

Status: draft

Set Status to \`approved\` only after the pilot frames meet the visual contract.

## Intent

- Audience and goal:
- Emotional promise:
- Platform, duration, and viewing context:
- References and what specifically matters in each:

## Directions considered

Describe at least two genuinely different concepts. Record why the chosen one
serves the story better, not merely why it is easier to build.

## Visual contract

- Production ambition and deliberate exclusions:
- World continuity and spatial depth:
- Character/subject specificity:
- Materials, lighting, atmosphere, and compositing:
- Camera grammar and editorial rhythm:
- Signature image or move unique to this film:

## Beat map

For every narration sentence or named marker, specify the camera, visible
action, foreground/midground/background, and lighting state.

## Pilot gate

- [ ] Establishing frame proves the world and depth.
- [ ] Close frame proves subject/character specificity.
- [ ] Action frame proves blocking, motion, and camera language.
- [ ] Pilot was compared directly with the reference or written visual contract.
- [ ] Weak directions were rejected before full production.

## Rejection criteria

List observable reasons a frame must be rebuilt: hidden action, empty or generic
sets, repeated silhouettes, flat light, weak hierarchy, broken continuity,
reference mismatch, or anything specific to this project.
`;

const GITIGNORE = `out/\n.venv/\nnode_modules/\n`;

function initProject(dir) {
  const target = path.resolve(dir);
  ensureDir(target);
  const write = (name, content) => {
    const p = path.join(target, name);
    if (fs.existsSync(p)) { console.log(`  skip  ${name} (exists)`); return; }
    fs.writeFileSync(p, content);
    console.log(`  create ${name}`);
  };
  console.log(`Scaffolding narova project in ${target}`);
  ensureDir(path.join(target, 'assets'));
  write('reel.config.mjs', CONFIG);
  write('creative-brief.md', CREATIVE_BRIEF);
  write('README.md', README);
  write('.gitignore', GITIGNORE);
  console.log(`\nNext: fill ${dir}/creative-brief.md, prove the pilot, then run narova check`);
}

module.exports = { initProject };
