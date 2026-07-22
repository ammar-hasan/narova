export default {
  title: "Narova — Prompt. Voice. Motion.",
  size: "16:9",
  assets: "assets",
  voices: {
    narrator: {
      backend: "piper",
      speaker: "en_US-ryan-high",
      color: "#d9ff57",
      label: "NAROVA",
    },
  },
  theme: {
    bg: "#10072b",
    stage: "#170a3d",
    panel: "#21104c",
    line: "#5839a3",
    ink: "#fffdf7",
    muted: "#c8bfe7",
    faint: "#75699d",
    accent: "#d9ff57",
    "accent-dim": "#7a9b17",
    pink: "#ff5a8c",
    gold: "#ffb84d",
    green: "#d9ff57",
    red: "#ff5a8c",
    amber: "#ffb84d",
    deep: "#10072b",
    halo: "rgba(217,255,87,.2)",
    chip: "#2b165d",
    capidle: "#8f85b0",
    onaccent: "#10072b",
    track: "rgba(255,255,255,.14)",
    colw: "1160px",
    css: "theme.css",
  },
  chrome: { topbar: false, counter: false, progress: true },
  timing: {
    gapSentence: 0.12,
    gapTurn: 0.18,
    lead: 0.10,
    tail: 0.32,
    tempo: 0.99,
  },
  scenes: [
    {
      id: "hook",
      vo: [
        { who: "narrator", text: "Stop building narrated videos frame by frame." },
        { who: "narrator", text: "Give Narova a prompt, and watch this." },
      ],
      body: `<div class="hook-grid">
        <div class="hook-copy">
          <div class="kicker reveal">THE NARRATION-FIRST VIDEO SKILL</div>
          <h1 class="mega reveal">PROMPT.<br><span>VOICE.</span><br><em>MOTION.</em></h1>
        </div>
        <div class="prompt-machine cue" data-cue="1">
          <div class="prompt-card"><i></i><b>Make me a video</b><span>↵</span></div>
          <svg viewBox="0 0 500 250" aria-hidden="true">
            <defs><linearGradient id="beam" x1="0" x2="1"><stop stop-color="#d9ff57"/><stop offset=".52" stop-color="#5ed7ff"/><stop offset="1" stop-color="#ff5a8c"/></linearGradient></defs>
            <path data-draw d="M36 126 C130 30 204 220 290 126 S415 38 470 126" fill="none" stroke="url(#beam)" stroke-width="14" stroke-linecap="round"/>
            <circle class="pulse-dot" cx="470" cy="126" r="22" fill="#ff5a8c"/>
          </svg>
          <div class="machine-tags"><span>script</span><span>voice</span><span>timing</span><span>video</span></div>
        </div>
      </div>`,
    },
    {
      id: "sync",
      vo: [
        { who: "narrator", text: "It creates local voiceover, lights captions word by word," },
        { who: "narrator", text: "and reveals graphics on the spoken beat." },
      ],
      body: `<div class="sync-stage">
        <div class="kicker reveal">SPEECH DRIVES EVERYTHING</div>
        <h2 class="scene-title reveal">Every word becomes a <span>trigger.</span></h2>
        <div class="sync-layout">
          <div class="wave-panel reveal">
            <div class="wave-label">LOCAL VOICEOVER</div>
            <div class="wave-bars">
              <i style="--h:30%"></i><i style="--h:70%"></i><i style="--h:48%"></i><i style="--h:92%"></i><i style="--h:60%"></i><i style="--h:34%"></i><i style="--h:80%"></i><i style="--h:52%"></i><i style="--h:96%"></i><i style="--h:42%"></i><i style="--h:68%"></i><i style="--h:36%"></i>
            </div>
            <div class="caption-demo"><span>captions</span> <b>light</b> <span>up</span> <span>word</span> <span>by</span> <span>word</span></div>
          </div>
          <div class="beat-visual cue" data-cue="1">
            <div class="orbit o1">HTML</div><div class="orbit o2">SVG</div><div class="orbit o3">DATA</div>
            <div class="beat-core">ON<br><b>BEAT</b></div>
            <svg viewBox="0 0 330 330" aria-hidden="true"><circle data-draw cx="165" cy="165" r="132" fill="none" stroke="#5ed7ff" stroke-width="5" stroke-dasharray="10 15"/></svg>
          </div>
        </div>
      </div>`,
    },
    {
      id: "workflow",
      vo: [
        { who: "narrator", text: "Initialize a project." },
        { who: "narrator", text: "Write scenes." },
        { who: "narrator", text: "Then synthesize, preview, and build." },
      ],
      body: `<div class="workflow-stage">
        <div class="workflow-head reveal"><div class="kicker">FROM IDEA TO MP4</div><h2 class="scene-title">Three moves. <span>That’s it.</span></h2></div>
        <div class="steps-row">
          <div class="step-card cue" data-cue="0"><div class="step-no">01</div><code>narova init</code><p>start the project</p></div>
          <div class="step-arrow cue" data-cue="1">→</div>
          <div class="step-card cue hot" data-cue="1"><div class="step-no">02</div><code>reel.config.mjs</code><p>write voice + visuals</p></div>
          <div class="step-arrow cue" data-cue="2">→</div>
          <div class="step-card cue" data-cue="2"><div class="step-no">03</div><code>synth → preview → build</code><p>hear it · see it · ship it</p></div>
        </div>
        <div class="speed-line cue" data-cue="2"><i data-grow></i><span>prompt</span><b>finished video</b></div>
      </div>`,
    },
    {
      id: "pipeline",
      vo: [
        { who: "narrator", text: "Audio sets the timing." },
        { who: "narrator", text: "HyperFrames turns your HTML visuals into a rendered MP4." },
      ],
      body: `<div class="pipeline-stage">
        <div class="kicker reveal">ONE TIMELINE · ZERO GUESSWORK</div>
        <h2 class="scene-title reveal">The voice is the <span>clock.</span></h2>
        <div class="pipeline">
          <div class="pipe-node reveal"><div class="node-icon mic">●</div><b>AUDIO</b><small>real duration</small></div>
          <div class="pipe-link reveal"><i data-grow></i><span>word timings</span></div>
          <div class="pipe-node reveal"><div class="node-icon clock">◷</div><b>TIMELINE</b><small>cues + captions</small></div>
          <div class="pipe-link cue" data-cue="1"><i data-grow></i><span>HyperFrames</span></div>
          <div class="pipe-node cue final-node" data-cue="1"><div class="frame-stack"><i></i><i></i><i></i><strong>▶</strong></div><b>VIDEO.MP4</b><small>1280 × 720</small></div>
        </div>
      </div>`,
    },
    {
      id: "close",
      vo: [
        { who: "narrator", text: "No API keys." },
        { who: "narrator", text: "No cloud." },
        { who: "narrator", text: "Just invoke the Narova skill, describe your video, and let it roll." },
      ],
      body: `<div class="close-stage">
        <div class="close-badges">
          <div class="zero-badge cue" data-cue="0"><b>0</b><span>API KEYS</span></div>
          <div class="zero-badge cue" data-cue="1"><b>0</b><span>CLOUD CALLS</span></div>
        </div>
        <div class="close-main cue" data-cue="2">
          <div class="kicker">YOUR NEXT PROMPT COULD MOVE</div>
          <h2>TRY <span>NAROVA</span></h2>
          <div class="command-pill"><i>›</i> Use the Narova skill to create…<b>↵</b></div>
          <div class="close-sign">prompt in <em>→</em> narrated video out</div>
        </div>
      </div>`,
    },
  ],
};
