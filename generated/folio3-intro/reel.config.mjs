// narova project — Folio3 fun intro (brand-led promo, two hosts)
// Source: https://www.folio3.com/  (see claims.md for the ledger)
export default {
  title: "folio3",
  size: "16:9",
  assets: "assets",
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#2159c7", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#cc0022", label: "host · B" },
  },
  theme: {
    mode: "light",
    accent: "#cc0022",
    bg: "#ffffff",
    capidle: "#5b5b60",
    css: "theme.css",
  },
  chrome: { topbar: true, counter: true, progress: true },
  timing: { gapSentence: 0.2, gapTurn: 0.4, lead: 0.14, tail: 0.5, tempo: 1.08 },
  scenes: [
    {
      id: "title",
      vo: [
        { who: "b", text: "Meet Folio3 — your trusted AI transformation partner." },
        { who: "a", text: "From idea to scale, they power your growth with AI. Let's take a look." },
      ],
      body: `<div class="s-title f3-hero">
        <div class="f3-dots reveal"><span class="d-red"></span><span class="d-blue"></span><span class="d-gold"></span></div>
        <h1 class="display reveal">folio<span class="f3-three">3</span></h1>
        <p class="lede cue" data-cue="0">Your trusted <span class="f3-red">AI transformation</span> partner.</p>
        <p class="f3-sub cue" data-cue="1">From idea to scale — powered by AI.</p>
      </div>`,
    },
    {
      id: "aifirst",
      vo: [
        { who: "a", text: "So what's under the hood? AI-first architectures, built to think." },
        { who: "b", text: "Agentic AI orchestrates the workflows. Cloud and data platforms fuel real-time intelligence." },
        { who: "a", text: "And those old ERP systems? They evolve into adaptive, insight-driven engines." },
      ],
      body: `<div class="f3-scene">
        <div class="eyebrow reveal">AI-FIRST ARCHITECTURE</div>
        <div class="f3-stack">
          <div class="f3-layer reveal"><span class="f3-tag t-red">AGENTIC AI</span><span class="f3-do">orchestrates the workflows</span></div>
          <div class="f3-layer cue" data-cue="1"><span class="f3-tag t-blue">CLOUD + DATA</span><span class="f3-do">fuels real-time intelligence</span></div>
          <div class="f3-layer cue" data-cue="2"><span class="f3-tag t-gold">ERP</span><span class="f3-do">adaptive, insight-driven engines</span></div>
        </div>
      </div>`,
    },
    {
      id: "capabilities",
      vo: [
        { who: "b", text: "Then there's the fun stuff — computer vision, AI drones, machine learning." },
        { who: "a", text: "Predictive analytics, natural language. If it's intelligent, they build it." },
      ],
      body: `<div class="f3-scene">
        <div class="eyebrow reveal">WHAT THEY BUILD</div>
        <div class="f3-chips">
          <span class="f3-chip reveal">Computer Vision</span>
          <span class="f3-chip reveal">AI Drones</span>
          <span class="f3-chip reveal">Machine Learning</span>
          <span class="f3-chip cue" data-cue="1">Predictive Analytics</span>
          <span class="f3-chip cue" data-cue="1">Natural Language</span>
        </div>
        <p class="f3-punch cue" data-cue="1">If it's intelligent — <span class="f3-red">they build it.</span></p>
      </div>`,
    },
    {
      id: "industries",
      vo: [
        { who: "a", text: "And this isn't tech for tech's sake." },
        { who: "b", text: "Farms, hospitals, storefronts — agriculture, digital health, and retail, all running smarter." },
      ],
      body: `<div class="f3-scene">
        <div class="eyebrow reveal">EVERYWHERE IT MATTERS</div>
        <div class="f3-inds">
          <div class="f3-ind cue" data-cue="1"><span class="d-red big"></span><div class="f3-in">Agriculture<br>&amp; Food</div></div>
          <div class="f3-ind cue" data-cue="1"><span class="d-blue big"></span><div class="f3-in">Digital<br>Health</div></div>
          <div class="f3-ind cue" data-cue="1"><span class="d-gold big"></span><div class="f3-in">Retail<br>&amp; Commerce</div></div>
        </div>
      </div>`,
    },
    {
      id: "numbers",
      vo: [
        { who: "b", text: "The receipts? Twenty-plus years, and seven hundred people across the globe." },
        { who: "a", text: "Five thousand projects delivered. A thousand companies served. That's the real deal." },
      ],
      body: `<div class="f3-scene">
        <div class="eyebrow reveal">BY THE NUMBERS</div>
        <div class="f3-figs">
          <div class="f3-fig reveal"><div class="f3-num f3-red">20+</div><div class="f3-lab">years of excellence</div></div>
          <div class="f3-fig reveal"><div class="f3-num f3-blue">700+</div><div class="f3-lab">people across the globe</div></div>
          <div class="f3-fig cue" data-cue="1"><div class="f3-num f3-red">5000+</div><div class="f3-lab">projects delivered</div></div>
          <div class="f3-fig cue" data-cue="1"><div class="f3-num f3-blue">1000+</div><div class="f3-lab">companies served</div></div>
        </div>
      </div>`,
    },
    {
      id: "close",
      vo: [
        { who: "a", text: "Powering your AI-first business transformation." },
        { who: "b", text: "Ready when you are — let's connect." },
      ],
      body: `<div class="s-close f3-close">
        <div class="f3-dots reveal"><span class="d-red"></span><span class="d-blue"></span><span class="d-gold"></span></div>
        <h2 class="close-line reveal">Powering your <span class="f3-red">AI-first</span> transformation.</h2>
        <div class="f3-cta cue" data-cue="1">Let's Connect &rarr;</div>
        <div class="close-sign reveal">folio3.com</div>
      </div>`,
    },
  ],
};
