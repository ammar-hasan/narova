export default {
  title: "narova — Chatterbox Cloned Voice",
  voices: {
    a: { backend: "chatterbox", speaker: "my-voice", color: "#2ee6d6", label: "cloned voice" },
  },
  scenes: [
    { id: "title",
      vo: [{ who: "a", text: "This is a voice cloned with chatterbox. The speaker is my own voice, synthesized from a short recording." }],
      body: `<div class="s-title"><h1 class="reveal grad">Chatterbox</h1><p class="lede cue" data-cue="0">Voice cloning, fully local</p></div>` },
  ],
};
