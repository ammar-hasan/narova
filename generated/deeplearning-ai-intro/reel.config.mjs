// DeepLearning.AI — one-minute fun intro. See claims.md for sourced facts.
export default {
  title: "DeepLearning.AI",
  size: "16:9",
  assets: "assets",
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#ff7f53", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#8ab8ff", label: "host · B" },
  },
  theme: {
    mode: "dark",
    bg: "#021a4e", deep: "#011238", stage: "#062a8a", halo: "#1a3fd4",
    panel: "#0a2a75", line: "#2f50c0",
    ink: "#f3f7ff", muted: "#a3b8ec", faint: "#7489c6",
    accent: "#ff8257", "accent-dim": "#c8502a",
    pink: "#e94fb8", gold: "#ffd27a",
    css: "theme.css",
  },
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: 1.12 },
  scenes: [
    {
      id: "hook",
      vo: [
        { who: "b", text: "AI is the new electricity. You are the spark." },
        { who: "a", text: "That's the front page of DeepLearning.AI — and it delivers. Quick tour." },
      ],
      body: `<div class="s-title">
        <p class="eyebrow reveal">deeplearning.ai</p>
        <h1 class="display reveal">AI is the new <span class="spark">electricity</span>.</h1>
        <p class="lede reveal">You are the spark. <span class="spark">✦</span></p>
        <img class="hook-logo cue" data-cue="1" src="assets/dlai-logo.png" alt="DeepLearning.AI">
      </div>`,
    },
    {
      id: "crowd",
      vo: [
        { who: "b", text: "So what is DeepLearning.AI, exactly?" },
        { who: "a", text: "Over seven million people, learning to use and build AI — with courses, news, and insights from Andrew Ng and other AI leaders." },
      ],
      body: `<div class="s-center">
        <p class="eyebrow reveal">so, what is it?</p>
        <div class="stat gradpink cue" data-cue="1">7M+</div>
        <p class="stat-cap cue" data-cue="1">people learning to use and build AI</p>
        <p class="crowd-sub cue" data-cue="1">courses · news · insights — with Andrew Ng &amp; other AI leaders</p>
      </div>`,
    },
    {
      id: "courses",
      vo: [
        { who: "b", text: "Where do I start?" },
        { who: "a", text: "The classic on-ramp: the Machine Learning Specialization, built with Stanford Online." },
        { who: "b", text: "Or binge short courses from the teams building this stuff — OpenAI, LangChain, crewAI." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">start here</span> pick your first course</div>
        <div class="planes">
        <div class="plane cue" data-cue="1">
          <div class="pname">Machine Learning Specialization</div>
          <div class="pdesc">the classic foundation — with Stanford Online</div>
        </div>
        <div class="plane cue" data-cue="2">
          <div class="pname">ChatGPT Prompt Engineering</div>
          <div class="pdesc">short course — with OpenAI</div>
        </div>
        <div class="plane cue" data-cue="2">
          <div class="pname">Agents &amp; LLM apps</div>
          <div class="pdesc">short courses — LangChain · crewAI</div>
        </div>
      </div>`,
    },
    {
      id: "nocode",
      vo: [
        { who: "b", text: "But I'm not a coder. Like, at all." },
        { who: "a", text: "There's literally a course called AI for Everyone. Or let AI help you write your first Python in AI Python for Beginners." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">no excuses</span> “I'm not a coder” — covered</div>
        <div class="s-two">
        <div class="pane center cue" data-cue="1">
          <div class="door-tag">zero code</div>
          <div class="pname">AI for Everyone</div>
          <div class="pdesc">what AI is, what it can do, how to use it</div>
        </div>
        <div class="pane center cue" data-cue="1">
          <div class="door-tag">first lines of code</div>
          <div class="pname">AI Python for Beginners</div>
          <div class="pdesc">learn Python with AI assistance</div>
        </div>
      </div>`,
    },
    {
      id: "free",
      vo: [
        { who: "b", text: "And the freebies?" },
        { who: "a", text: "The Batch — the largest weekly AI newsletter — plus free books like Machine Learning Yearning and career guides." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">free stuff</span> no wallet required</div>
        <div class="ledger">
        <div class="rec cue" data-cue="1"><b>The Batch</b> — the largest weekly AI newsletter</div>
        <div class="rec cue" data-cue="1"><b>Machine Learning Yearning</b> — free book</div>
        <div class="rec cue" data-cue="1"><b>How to Build Your Career in AI</b> — free guide</div>
      </div>`,
    },
    {
      id: "close",
      vo: [
        { who: "a", text: "AI is the new electricity." },
        { who: "b", text: "You're the spark. DeepLearning.AI — go light it up." },
      ],
      body: `<div class="s-close">
        <div class="close-line reveal">AI is the new electricity.</div>
        <div class="close-line sparkline cue" data-cue="1">You are the <span class="spark">spark</span>. <span class="spark">✦</span></div>
        <img class="close-logo cue" data-cue="1" src="assets/dlai-logo.png" alt="DeepLearning.AI">
        <div class="close-tags cue" data-cue="1"><span class="ctag">courses</span><span class="ctag">newsletter</span><span class="ctag">community</span></div>
        <div class="close-sign cue" data-cue="1">deeplearning.ai</div>
      </div>`,
    },
  ],
};
