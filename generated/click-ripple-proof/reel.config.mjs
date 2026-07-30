/*
 * Creative direction
 * - One clear local Piper narrator (Ryan), because this is a focused product proof.
 * - 16:9, roughly six seconds, using the verified real-browser recording.
 * - Full-strength UI, magenta accent, karaoke captions, no music or extra chrome.
 */
export default {
  title: "Narova click ripple — voiced proof",
  size: "16:9",
  assets: "assets",
  voices: {
    narrator: {
      backend: "piper",
      speaker: "en_US-ryan-high",
      color: "#ff3d81",
      label: "Narova",
    },
  },
  theme: {
    mode: "light",
    accent: "#ff3d81",
    "accent-dim": "#a90e4c",
    css: "theme.css",
  },
  chrome: false,
  timing: {
    gapSentence: 0.14,
    gapTurn: 0.18,
    lead: 0.08,
    tail: 0.42,
    tempo: 1.08,
  },
  captions: {
    preset: "karaoke",
    emphasis: ["ripple", "disappears"],
  },
  scenes: [
    {
      id: "proof",
      clip: "assets/ripple-source.webm",
      vo: [
        { who: "narrator", text: "Watch the click." },
        {
          who: "narrator",
          text: "A real ripple expands, fades, and disappears, while the pointer stays clear.",
        },
      ],
      body: `<p class="proof-badge reveal">Real click ripple</p>`,
    },
  ],
};
