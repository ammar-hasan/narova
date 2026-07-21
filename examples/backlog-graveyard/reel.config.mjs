// "Your backlog is a graveyard" — 30s vertical hot-take reel.
// Built from the plain-language prompt in PROMPT.md. Reel shape (hook in the
// first seconds, one idea, payoff); videography intentionally unlike the
// other examples: warm palette, stat/verdict/stepper layouts, fast tempo.
export default {
  title: "Backlog Graveyard",
  size: "9:16",                             // vertical — reels/shorts native
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#ff6b4a", label: "host · A" },   // male
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ffb454", label: "host · B" },   // female
  },
  theme: {
    accent: "#ff6b4a", bg: "#160a08", stage: "#1f0e0a", panel: "#2a1410",
    line: "#4a241c", ink: "#fff3e8", muted: "#c9a894", faint: "#8a6a5c",
    pink: "#ffb454", gold: "#ffd27a", green: "#7ddb8a", red: "#ff5c5c",
    css: "theme.css",
  },
  timing: { gapSentence: 0.18, gapTurn: 0.32, lead: 0.12, tail: 0.5, tempo: 1.22 },

  scenes: [
    {
      id: "hook",
      vo: [
        { who: "b", text: "Your backlog is a graveyard." },
        { who: "a", text: "Harsh. But true — and I'll prove it in thirty seconds." },
      ],
      body: `<div class="s-center">
        <p class="bigquote reveal">"Your backlog is a graveyard."</p>
        <p class="small cue" data-cue="1">harsh · true · provable</p>
      </div>`,
    },
    {
      id: "stat",
      vo: [
        { who: "a", text: "The average ticket dies at ninety days. Untouched, unread, un-missed." },
        { who: "b", text: "Ninety days. If nobody missed it, it was never work — it was guilt." },
      ],
      body: `<div class="s-center">
        <div class="stat reveal">90<span class="pct">d</span></div>
        <p class="stat-cap cue" data-cue="1">the average ticket's lifespan — then it's guilt, not work</p>
      </div>`,
    },
    {
      id: "verdict",
      vo: [
        { who: "b", text: "So split it. Keep forty tickets, brutally groomed." },
        { who: "a", text: "Everything older than a quarter — delete. If it matters, it comes back." },
      ],
      body: `<div class="s-center">
        <div class="verdicts reveal">
          <div class="verdict green"><div class="vname">keep 40</div><div class="vact">brutally groomed, always fresh</div></div>
          <div class="verdict red"><div class="vname">delete the rest</div><div class="vact">older than a quarter? gone</div></div>
        </div>
        <p class="small cue" data-cue="1">if it matters, it comes back</p>
      </div>`,
    },
    {
      id: "close",
      vo: [
        { who: "a", text: "Groom weekly. Cap the list. Delete the dead." },
        { who: "b", text: "A short backlog is a promise. A long one is a landfill." },
      ],
      body: `<div class="s-center">
        <div class="stepper reveal">
          <span class="step">groom weekly</span><span class="sep">→</span>
          <span class="step">cap the list</span><span class="sep">→</span>
          <span class="step">delete the dead</span>
        </div>
        <p class="close-line cue" data-cue="1">a short backlog is a promise</p>
        <p class="close-sign cue" data-cue="1">a long one is a landfill</p>
      </div>`,
    },
  ],
};
