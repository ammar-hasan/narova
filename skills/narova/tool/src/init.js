'use strict';
/* Minimal project scaffold (config + one scene + theme). The full example project
 * is a separate agent's job — this is a runnable stub. */
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./util');

const CONFIG = `// narova project — see SPEC.md for the full scene API.
export default {
  title: "My Reel",
  size: "16:9",                         // "16:9" | "1:1" | "9:16"
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

A narova project.

## Build

\`\`\`bash
narova check      # validate the config (fast)
narova synth      # -> out/audio/*, out/timings.json   (needs a Python venv, see below)
narova compose    # -> out/hf/ (a HyperFrames project)
narova preview    # open HyperFrames Studio to review
narova build      # full pipeline -> out/video.mp4
\`\`\`

## Python venv (for synth)

narova shells out to the \`narova_tts\` Python module for TTS. Point it at a venv via
\`.venv/\` in this project, \`.venv/\` in the narova repo, or \`$NAROVA_PYTHON\`.
See \`narova doctor\`.
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
  write('reel.config.mjs', CONFIG);
  write('README.md', README);
  write('.gitignore', GITIGNORE);
  console.log(`\nNext: cd ${dir} && narova check && narova build`);
}

module.exports = { initProject };
