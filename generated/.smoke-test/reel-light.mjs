export default {
  title: "narova — Light + TikTok",
  platform: "tiktok",
  theme: { mode: "light", accent: "#6366f1", pink: "#ec4899" },
  captions: { preset: "karaoke" },
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high", color: "#6366f1", label: "narrator" },
  },
  scenes: [
    { id: "title", vo: [{ who: "a", text: "This is narova in light mode on TikTok. Fully local, no API keys." }],
      body: `<div class="s-title"><h1 class="reveal">Light mode</h1><p class="lede cue" data-cue="0">TikTok format. One voice. Rendered on device.</p></div>` },
  ],
};
