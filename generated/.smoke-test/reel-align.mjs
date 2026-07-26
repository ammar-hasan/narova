export default {
  title: "narova — Aligned",
  align: true,
  captions: { preset: "karaoke" },
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high", color: "#2ee6d6", label: "narrator" },
  },
  scenes: [
    { id: "title",
      vo: [{ who: "a", text: "This video uses forced word alignment. Every word timing is measured from the audio, not estimated from word count." }],
      body: `<div class="s-title"><h1 class="reveal">Aligned</h1><p class="lede cue" data-cue="0">Whisper-measured word timings</p></div>` },
  ],
};
