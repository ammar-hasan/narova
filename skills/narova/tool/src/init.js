'use strict';
/* Minimal project scaffold (config + one scene + theme). The full example project
 * is a separate agent's job — this is a runnable stub. */
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./util');

const CONFIG = `// narova project — see SPEC.md for the full scene API.
// This scaffold is a minimal starting point: replace everything.
// It gives you production infrastructure, not an implicit visual style.
// Design your own visual language, structure, and look from the brief.
export default {
  title: "My Project",
  size: "16:9",                         // "16:9" | "1:1" | "9:16"
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high", label: "Narrator" },
    // Add or remove voices to match your concept. One voice works. Zero voices
    // works for silent projects with explicit scene durations.
  },
  // theme is optional. Narova has a dark palette for quick starts; override any
  // token to build your own. Visual style is your domain.
  //   Tokens: accent, accent-dim, bg, stage, panel, line, ink, muted, faint,
  //   deep, halo, chip, capidle, onaccent, track, pink, gold, green, red,
  //   amber, colw (content max-width). Add your own tokens too.
  //   theme.css adds custom layouts, fonts, and visual systems.
  // patterns: false to exclude Narova's built-in layout classes (.s-title,
  //   .pane, .stat, .flow, etc.) — use this when you define your own visual
  //   language. Defaults to true for quick starts.
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58 },
  // captions: false to remove the visual caption band (SRT/VTT sidecars still export).
  // chrome: false to strip all page furniture (topbar, counter, progress bar).
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
      // Add transition, clip, walkthrough, elements, three, or visual.
    },
  ],
};
`;

const README = `# My Project

A narova project. Edit \`reel.config.mjs\`, then:

\`\`\`bash
narova check      # validate the config (fast)
narova synth      # create narration + timings
narova preview --detach  # persistent Studio; prints the review URL
narova build --reuse     # after approval -> out/video.mp4
\`\`\`

The first build sets up its own Python venv (~/.narova/venv) and downloads a
voice model. One-time wait, not a hang. \`narova doctor\` checks the machine.
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
  write('README.md', README);
  write('.gitignore', GITIGNORE);
  console.log(`\nNext: cd ${dir} && narova check && narova synth && narova preview --detach`);
}

module.exports = { initProject };
