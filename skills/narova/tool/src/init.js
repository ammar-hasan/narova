'use strict';
/* Minimal project scaffold (config + one scene + theme). The full example project
 * is a separate agent's job — this is a runnable stub. */
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./util');

const CONFIG = `// narova project — see SPEC.md for the full scene API.
// This scaffold is a starting point: replacing it wholesale is the normal flow.
export default {
  title: "My Reel",
  size: "16:9",                         // "16:9" | "1:1" | "9:16"
  assets: "assets",                     // copied into out/hf/assets/
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",        color: "#2ee6d6", label: "narrator · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "narrator · B" },
  },
  theme: { accent: "#2ee6d6", bg: "#080d16" },   // token overrides (optional)
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58 },
  scenes: [
    {
      id: "title",
      vo: [
        { who: "a", text: "This is narova. You write scenes as plain HTML plus data." },
        { who: "b", text: "And it becomes a narrated, word-synced, kinetic explainer. Let's go." },
      ],
      // Elements with data-cue="k" reveal when the voice reaches turn index k (0-based into vo).
      body: \`<div class="s-title">
        <div class="eyebrow reveal">NAROVA</div>
        <h1 class="display reveal">Scenes to <span class="grad">video</span></h1>
        <p class="lede cue" data-cue="1">Word-synced captions. Reactive reveals. Two hosts.</p>
        <div class="hairline reveal"></div>
      </div>\`,
    },
  ],
};
`;

const README = `# My Reel

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
