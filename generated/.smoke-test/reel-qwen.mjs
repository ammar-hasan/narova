export default {
  title: "narova — Qwen + Annotations",
  voices: {
    a: { backend: "qwen", speaker: "Ryan", color: "#2ee6d6", label: "narrator" },
  },
  scenes: [
    { id: "title",
      vo: [{ who: "a", text: "Qwen TTS is high quality and Apache 2.0 licensed. Perfect for commercial use." }],
      body: `<div class="s-title"><h1 class="reveal">Qwen</h1><p class="lede cue" data-cue="0">Apache 2.0 · <span data-mark="circle">commercial-friendly</span></p></div>` },
  ],
};
