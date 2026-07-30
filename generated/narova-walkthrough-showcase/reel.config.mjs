/*
  Director's brief
  - A 75–90 second, single-narrator product walkthrough in 16:9.
  - Show one uninterrupted browser take with creation, configuration, search,
    task assignment, automation, and collaboration.
  - Keep overlays small and editorial; the real Orbit UI remains the hero.
  - Use a calm local voice, word-synced captions, and narration-anchored actions.
*/
const demoUrl = process.env.NAROVA_DEMO_URL || "http://127.0.0.1:4173/";

export default {
  title: "Narova · A complete product walkthrough",
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
    css: "theme.css",
    accent: "#8dfb72",
    "accent-dim": "#4ebd62",
    bg: "#070b16",
    stage: "#0b1120",
    panel: "#111a2d",
  },
  captions: {
    preset: "karaoke",
    emphasis: ["real", "browser", "semantic", "evidence", "Narova"],
    maxWords: 10,
  },
  timing: {
    gapSentence: 0.22,
    gapTurn: 0.36,
    lead: 0.18,
    tail: 0.76,
    tempo: 1.08,
  },
  walkthroughs: {
    orbit: {
      url: demoUrl,
      title: "Orbit · Acme workspace",
      allowedDomains: ["127.0.0.1"],
      viewport: { w: 1200, h: 760 },
      ready: { text: "New project", timeout: 10000 },
      preRoll: 0.6,
      postRoll: 0.9,
      cursor: { enabled: true, travelMs: 320, color: "#8dfb72" },
      screenshots: true,
      mutates: true,
      steps: [
        {
          at: { scene: "hook", cue: 0, offset: 3.8 },
          action: "click",
          target: { role: "button", name: "New project" },
          screenshot: "new-project",
        },
        {
          at: { scene: "configure", cue: 0, offset: 0.9 },
          action: "type",
          target: { label: "Project name" },
          value: "Launch plan",
        },
        {
          at: { scene: "configure", cue: 0, offset: 3.4 },
          action: "select",
          target: { css: "#project-template" },
          value: "campaign",
        },
        {
          at: { scene: "configure", cue: 0, offset: 5.5 },
          action: "click",
          target: { role: "checkbox", name: "Mark as priority" },
          screenshot: "project-configured",
        },
        {
          at: { scene: "create", cue: 0, offset: 1.1 },
          action: "click",
          target: { role: "button", name: "Create project" },
        },
        {
          at: { scene: "create", cue: 0, offset: 3.1 },
          action: "wait",
          text: "Project ready",
          screenshot: "project-ready",
        },
        {
          at: { scene: "find", cue: 0, offset: 0.8 },
          action: "fill",
          target: { label: "Search projects" },
          value: "Launch plan",
        },
        {
          at: { scene: "find", cue: 0, offset: 2.8 },
          action: "wait",
          text: "1 project found",
        },
        {
          at: { scene: "find", cue: 0, offset: 4.2 },
          action: "hover",
          target: { role: "button", name: "Open Launch plan" },
        },
        {
          at: { scene: "find", cue: 0, offset: 5.3 },
          action: "click",
          target: { role: "button", name: "Open Launch plan" },
          screenshot: "project-open",
        },
        {
          at: { scene: "task", cue: 0, offset: 0.8 },
          action: "click",
          target: { role: "button", name: "Add task" },
        },
        {
          at: { scene: "task", cue: 0, offset: 2.5 },
          action: "type",
          target: { label: "Task name" },
          value: "Review campaign assets",
        },
        {
          at: { scene: "task", cue: 0, offset: 5.0 },
          action: "select",
          target: { css: "#task-assignee" },
          value: "jordan",
        },
        {
          at: { scene: "task", cue: 0, offset: 6.9 },
          action: "click",
          target: { role: "button", name: "Save task" },
        },
        {
          at: { scene: "task", cue: 0, offset: 8.2 },
          action: "wait",
          text: "Task added",
          screenshot: "task-added",
        },
        {
          at: { scene: "automate", cue: 0, offset: 0.8 },
          action: "click",
          target: { role: "button", name: "Automations" },
        },
        {
          at: { scene: "automate", cue: 0, offset: 3.0 },
          action: "click",
          target: { role: "button", name: "Enable status alerts" },
        },
        {
          at: { scene: "automate", cue: 0, offset: 4.5 },
          action: "wait",
          text: "Status alerts active",
          screenshot: "automation-enabled",
        },
        {
          at: { scene: "collaborate", cue: 0, offset: 0.8 },
          action: "click",
          target: { role: "button", name: "Team" },
        },
        {
          at: { scene: "collaborate", cue: 0, offset: 2.1 },
          action: "click",
          target: { role: "button", name: "Invite teammate" },
        },
        {
          at: { scene: "collaborate", cue: 0, offset: 3.7 },
          action: "type",
          target: { label: "Work email" },
          value: "mina@orbit.test",
        },
        {
          at: { scene: "collaborate", cue: 0, offset: 6.4 },
          action: "select",
          target: { css: "#invite-role" },
          value: "editor",
        },
        {
          at: { scene: "collaborate", cue: 0, offset: 8.4 },
          action: "click",
          target: { role: "button", name: "Send invite" },
        },
        {
          at: { scene: "close", cue: 0, offset: 0.5 },
          action: "wait",
          text: "Invite sent",
          screenshot: "collaboration-complete",
        },
      ],
    },
  },
  scenes: [
    {
      id: "hook",
      walkthrough: { id: "orbit", layout: "window", fit: "contain" },
      body: `<div class="demo-tag reveal"><b>LIVE</b><span>one continuous browser take</span></div>`,
      vo: [{
        who: "guide",
        text: "Most product demos fake the interface or hide behind jump cuts. This one is different: every screen, click, and field comes from a real browser session timed to the narration.",
      }],
    },
    {
      id: "configure",
      transition: "slide",
      walkthrough: { id: "orbit", layout: "window", fit: "contain" },
      body: `<div class="demo-tag reveal"><b>01</b><span>configure a project</span></div>`,
      vo: [{
        who: "guide",
        text: "Start a new launch workspace. Give it a clear name, choose the campaign template, and mark it as priority so the team knows this work should lead the queue.",
      }],
    },
    {
      id: "create",
      transition: "fade",
      walkthrough: { id: "orbit", layout: "window", fit: "contain" },
      body: `<div class="demo-tag reveal"><b>02</b><span>create and verify</span></div>`,
      vo: [{
        who: "guide",
        text: "Create the project and Orbit updates the workspace immediately. The new launch plan appears with its template and priority state intact.",
      }],
    },
    {
      id: "find",
      transition: "zoom",
      walkthrough: { id: "orbit", layout: "window", fit: "contain" },
      body: `<div class="demo-tag reveal"><b>03</b><span>search and reopen</span></div>`,
      vo: [{
        who: "guide",
        text: "Now search the live project list, narrow the records to the one you need, and reopen the project without breaking the narrated flow.",
      }],
    },
    {
      id: "task",
      transition: "slide",
      walkthrough: { id: "orbit", layout: "window", fit: "contain" },
      body: `<div class="demo-tag reveal"><b>04</b><span>assign real work</span></div>`,
      vo: [{
        who: "guide",
        text: "Inside the project, add the next concrete task. Name the campaign review, assign it to Jordan, and save it so ownership and progress stay visible in one place.",
      }],
    },
    {
      id: "automate",
      transition: "fade",
      walkthrough: { id: "orbit", layout: "window", fit: "contain" },
      body: `<div class="demo-tag reveal"><b>05</b><span>enable automation</span></div>`,
      vo: [{
        who: "guide",
        text: "Move to automations and enable status alerts. From here, review and blocked changes can reach the project channel without someone manually chasing every update.",
      }],
    },
    {
      id: "collaborate",
      transition: "zoom",
      walkthrough: { id: "orbit", layout: "window", fit: "contain" },
      body: `<div class="demo-tag reveal"><b>06</b><span>invite a teammate</span></div>`,
      vo: [{
        who: "guide",
        text: "Then open the team workspace, invite Mina, choose the editor role, and send access. The demo uses disposable data, but the actions are the same semantic controls a real product exposes.",
      }],
    },
    {
      id: "close",
      transition: "fade",
      walkthrough: {
        id: "orbit",
        layout: "full",
        fit: "cover",
        opacity: 0.92,
        position: { x: 0.5, y: 0.5 },
      },
      body: `<div class="demo-proof reveal"><span>CREATE</span><span>SEARCH</span><span>ASSIGN</span><span>AUTOMATE</span><span>INVITE</span></div>`,
      vo: [{
        who: "guide",
        text: "That was one continuous browser take: creation, configuration, search, task assignment, automation, and collaboration. Narova adds narration, word-synced captions, scene-aware framing, and evidence for every important step, ready for a walkthrough, onboarding video, or sales demo.",
      }],
    },
  ],
};
