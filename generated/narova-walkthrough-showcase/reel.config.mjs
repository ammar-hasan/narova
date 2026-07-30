const demoUrl = process.env.NAROVA_DEMO_URL || "http://127.0.0.1:4173/";

export default {
  title: "Narova · Real product walkthrough",
  size: "16:9",
  assets: "assets",
  voices: {
    guide: {
      backend: "piper",
      speaker: "en_US-ryan-high",
      label: "Narova guide",
      color: "#8dfb72",
    },
  },
  theme: {
    accent: "#8dfb72",
    "accent-dim": "#4ebd62",
    bg: "#070b16",
    stage: "#0b1120",
    panel: "#111a2d",
  },
  captions: {
    preset: "karaoke",
    emphasis: ["real", "ready", "walkthrough"],
    maxWords: 10,
  },
  timing: {
    gapSentence: 0.2,
    gapTurn: 0.36,
    lead: 0.16,
    tail: 0.7,
  },
  walkthroughs: {
    orbit: {
      url: demoUrl,
      title: "Orbit · Acme workspace",
      allowedDomains: ["127.0.0.1"],
      viewport: { w: 1200, h: 760 },
      ready: { text: "New project", timeout: 10000 },
      preRoll: 0.5,
      postRoll: 0.7,
      cursor: { enabled: true, travelMs: 280, color: "#8dfb72" },
      screenshots: true,
      mutates: true,
      steps: [
        {
          at: { scene: "create", cue: 0, offset: 0.9 },
          action: "click",
          target: { role: "button", name: "New project" },
        },
        {
          at: { scene: "create", cue: 0, offset: 2.2 },
          action: "type",
          target: { label: "Project name" },
          value: "Launch plan",
        },
        {
          at: { scene: "create", cue: 0, offset: 4.1 },
          action: "click",
          target: { role: "button", name: "Create" },
        },
        {
          at: { scene: "result", cue: 0, offset: 0.35 },
          action: "wait",
          text: "Project ready",
          screenshot: "project-ready",
        },
      ],
    },
  },
  scenes: [
    {
      id: "create",
      walkthrough: { id: "orbit", layout: "window", fit: "contain" },
      body: `<div class="eyebrow reveal">A real product flow · captured on the narration clock</div>`,
      vo: [{
        who: "guide",
        text: "This is a real product walkthrough. Start a new project, give it a clear name, and create the workspace.",
      }],
    },
    {
      id: "result",
      walkthrough: {
        id: "orbit",
        layout: "full",
        fit: "cover",
        opacity: 0.94,
        position: { x: 0.5, y: 0.5 },
      },
      body: `<div class="s-foot ok reveal">Real actions · word-synced narration · fresh evidence</div>`,
      vo: [{
        who: "guide",
        text: "The project is ready, the result stays readable, and every action has evidence. Narova turns the complete flow into a narrated sales video.",
      }],
    },
  ],
};
