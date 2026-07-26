export default {
  title: "narova — XTTS + 3 scenes",
  voices: {
    a: { backend: "xtts", speaker: "Damien Black", color: "#2ee6d6", label: "host · A" },
    b: { backend: "xtts", speaker: "Claribel Dervla", color: "#ff7eb6", label: "host · B" },
  },
  scenes: [
    { id: "one", transition: "fade",
      vo: [{ who: "a", text: "XTTS voice quality. Richer, more natural, running on your machine." }],
      body: `<div class="s-title"><h1 class="reveal">XTTS</h1><p class="lede cue" data-cue="0">Studio-quality neural voice</p></div>` },
    { id: "two", transition: "slide",
      vo: [{ who: "b", text: "Two speakers, three scenes, with transitions between them." }],
      body: `<div class="s-center"><h2 class="reveal bigquote">Scene two</h2><p class="cue" data-cue="0">Slide transition in</p></div>` },
    { id: "three",
      vo: [{ who: "a", text: "All rendered locally. No cloud, no API keys, no monthly bill." }],
      body: `<div class="s-close"><h2 class="reveal close-line">Local<br>TTS</h2></div>` },
  ],
};
