export default {
  title: "backend verification",
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high", color: "#2ee6d6", label: "host · A" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "host · B" },
  },
  scenes: [
    { id: "one",
      vo: [ { who: "a", text: "This is the first backend check. The captions should track every word I say." },
            { who: "b", text: "And this is the second voice, answering back on the same timeline." } ],
      body: `<div class="s-title"><h1 class="reveal">Backend check</h1></div>` },
    { id: "two",
      vo: [ { who: "a", text: "If you can hear this sentence, the voice pipeline works end to end." } ],
      body: `<div class="s-title"><h2 class="reveal">Scene two</h2></div>` },
  ],
}
