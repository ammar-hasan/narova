'use strict';
/* Minimal project scaffold (creative contract + config + one scene). This is a
 * runnable stub; projects earn production scale by proving their pilot. */
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./util');

const CONFIG = `// narova project — see the public interface guide in SPEC.md for the full scene API.
// This scaffold is production infrastructure only. Narova is zero-style by
// default — no visual identity, no chrome, no built-in layout classes.
// Every aesthetic choice is yours to make explicitly.
//
// Quick reference (all off by default):
//   chrome: true           — add topbar, counter, progress bar
//   chrome: { topbar: true }  — just the project wordmark
//   patterns: true         — include built-in layout classes (.s-title, .pane, etc.)
//   safeLayout: true       — add centered max-width content, gutters, caption reserve
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
      body: \`<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center">
        <h1 style="font-size:64px;font-weight:800;line-height:1;color:var(--ink)">My Project</h1>
        <p style="font-size:18px;color:var(--muted);max-width:20em">Write your story here.</p>
      </div>\`,
    },
  ],
};
`;

const README = `# My Project

A narova project. For an ambitious brief, keep the config to a small proof,
save 2–3 directions with rationale, approve one, and only then expand it:

\`\`\`bash
narova check      # validate the config (fast)
narova critique creative  # challenge intent, proof evidence, and rejection criteria
narova synth      # create narration + timings
narova compose && narova shots --motion --proof  # inspect + reject an invisible pilot
narova branch save proof-a --rationale "why this direction may serve the brief"
# repeat for proof-b/proof-c; then: narova branch set proof-b --status approved
narova preview --detach  # persistent Studio; prints the review URL
narova build --reuse --release  # after approval -> out/video.mp4
\`\`\`

The first build sets up its own Python venv (~/.narova/venv) and downloads a
voice model. One-time wait, not a hang. \`narova doctor\` checks the machine.
`;

const CREATIVE_BRIEF = `# Creative brief

Status: draft
Ambition: routine | ambitious

Set Status to \`approved\` only after the selected proof meets this intent.

## Creative intent

- Audience, purpose, and viewing context:
- What should become newly felt, understood, or possible:
- Unusual hypothesis worth proving:
- Source/reference evidence that must survive:
- Hard constraints and deliberate exclusions:

## Directions considered

For an ambitious brief, describe 2–3 meaningfully different hypotheses. Vary
representation, temporal logic, spatial logic, sound relationship, or audience
interaction—not merely palette. Each direction should become only a small proof.

## Proof branches

| Branch | Rationale | Smallest decisive proof | Status |
|---|---|---|---|
| proof-a | | | exploring |
| proof-b | | | exploring |

Selected proof branch:
Why it won against the rejection criteria:
Expanded from proof branch:
Expanded proof identity:

Do not build three complete videos. Compose only enough material to settle the
risky creative question, then use \`narova branch save <name> --rationale "..."\`.

## Medium and behavior

- Chosen medium/material and why it carries the idea:
- Representation logic (literal, symbolic, procedural, evidentiary, hybrid):
- Temporal logic (continuous, accumulative, fragmented, cyclical, responsive):
- Spatial or compositional logic:
- Role of speech, sound, silence, and text:
- Signature behavior or transformation unique to this work:
- Optional medium-specific controls, only when relevant (camera, depth,
  lighting, interaction, typography, physical performance, simulation, etc.):

## Beat map

For every narration sentence or named marker, state what materially changes and
why that change advances the intent. Camera, depth, and light are conditional;
leave them out when the chosen medium does not use them.

## Pilot gate

- [ ] 2–3 small proof branches were saved with distinct rationale (ambitious work).
- [ ] Each proof isolates a decisive creative risk instead of pretending to be a full film.
- [ ] The selected proof demonstrates the intended representation and temporal behavior.
- [ ] A relevant edge state, transition, detail, or interaction was inspected.
- [ ] Rendered proof frames were compared with references and this written intent.
- [ ] One branch was selected; weaker directions were rejected before expansion.

## Rejection criteria

<!-- Replace this comment with observable, medium-specific reasons a proof must
be rebuilt. Possible dimensions include: familiar-template convergence, an
invisible decisive change, lost evidence, contradictory rhythm, ambiguous
interaction, generic craft, or missing reference-specific qualities. -->
`;

const GITIGNORE = `out/\n.venv/\nnode_modules/\n`;

function initProject(dir) {
  const target = path.resolve(dir);
  const targetCreated = !fs.existsSync(target);
  const assetsPath = path.join(target, 'assets');
  const assetsCreated = !fs.existsSync(assetsPath);
  const created = [];
  const skipped = [];
  ensureDir(target);
  const write = (name, content) => {
    const p = path.join(target, name);
    if (fs.existsSync(p)) { skipped.push(p); console.log(`  skip  ${name} (exists)`); return; }
    fs.writeFileSync(p, content);
    created.push(p);
    console.log(`  create ${name}`);
  };
  console.log(`Scaffolding narova project in ${target}`);
  ensureDir(assetsPath);
  write('reel.config.mjs', CONFIG);
  write('creative-brief.md', CREATIVE_BRIEF);
  write('README.md', README);
  write('.gitignore', GITIGNORE);
  console.log(`\nNext: fill ${dir}/creative-brief.md; for ambitious work save 2–3 small proof branches, choose one, then expand`);
  return { target, assets: assetsPath, targetCreated, assetsCreated, created, skipped };
}

module.exports = { initProject };
