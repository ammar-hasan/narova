export default {
  title: "narova — Slam + Music",
  captions: { preset: "slam", emphasis: ["narova", "machine"] },
  music: { file: "/tmp/narova-bed.mp3", volume: 0.12 },
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high", color: "#2ee6d6", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "host · B" },
  },
  scenes: [
    { id: "title", transition: "wipe",
      vo: [
        { who: "a", text: "Slam caption preset with a music bed underneath." },
        { who: "b", text: "Every word lands big and settles back. On your machine." },
      ],
      body: `<div class="s-title"><h1 class="reveal grad">narova</h1><p class="lede cue" data-cue="1"><span data-mark="underline">word-synced captions</span> with a music bed</p></div>` },
  ],
};
