'use strict';
/* Minimal project scaffold (config + one scene + theme). The full example project
 * is a separate agent's job — this is a runnable stub. */
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
