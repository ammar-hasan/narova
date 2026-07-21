// Research-paper walkthrough: "Attention Is All You Need" for engineers.
// Built from the plain-language prompt in PROMPT.md — see
// references/prompt-to-video.md (research-paper shape: surprising result →
// problem → key idea → worked example → why it matters).
export default {
  title: "Attention Is All You Need",
  size: "16:9",
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",         color: "#2ee6d6", label: "explainer" },   // male
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#ff7eb6", label: "questioner" },  // female
  },
  theme: { accent: "#2ee6d6", bg: "#080d16" },
  timing: { gapSentence: 0.24, gapTurn: 0.44, lead: 0.16, tail: 0.58, tempo: 1.12 },

  scenes: [
    {
      id: "hook",
      vo: [
        { who: "b", text: "In 2017, one paper changed how machines understand language." },
        { who: "a", text: "Attention Is All You Need. And its key idea is simpler than you'd think." },
      ],
      body: `<div class="s-title">
        <div class="eyebrow reveal">2017 · VASWANI ET AL</div>
        <h1 class="display reveal">Attention Is<br>All You Need</h1>
        <p class="lede cue" data-cue="1">one idea, every modern AI model</p>
      </div>`,
    },
    {
      id: "problem",
      vo: [
        { who: "b", text: "Before it, models read text word by word, in order. Slow — and easy to lose the thread." },
        { who: "a", text: "Right. By the end of a long sentence, the model could forget how it started." },
      ],
      body: `<div class="s-title">
        <div class="eyebrow reveal">THE OLD WAY</div>
        <h2 class="display reveal">word → word → word</h2>
        <p class="lede cue" data-cue="1">long sentence? the beginning fades</p>
      </div>`,
    },
    {
      id: "idea",
      vo: [
        { who: "a", text: "Attention lets every word look at every other word — all at once." },
        { who: "b", text: "So the word 'it' can point straight back at the thing it means?" },
      ],
      body: `<div class="s-title">
        <div class="eyebrow reveal">THE KEY IDEA</div>
        <h2 class="display reveal">every word<br>sees every word</h2>
        <p class="lede cue" data-cue="1">no queue, no forgetting</p>
      </div>`,
    },
    {
      id: "example",
      vo: [
        { who: "a", text: "Take 'the animal didn't cross the street, because it was too tired'. Attention links 'it' to 'animal'." },
        { who: "b", text: "That's the whole trick — relevance scores between words, learned from data." },
      ],
      body: `<div class="s-title">
        <div class="eyebrow reveal">ONE EXAMPLE</div>
        <p class="lede reveal">"the <b>animal</b> didn't cross the street,<br>because <b class="grad">it</b> was too tired"</p>
        <p class="lede cue" data-cue="1"><b class="grad">it</b> → <b>animal</b> · learned, not programmed</p>
      </div>`,
    },
    {
      id: "close",
      vo: [
        { who: "a", text: "Stack that mechanism and you get the transformer — the engine behind every modern AI model." },
        { who: "b", text: "One mechanism. An entire revolution." },
      ],
      body: `<div class="s-title">
        <h2 class="display reveal">attention<br><span class="grad">&rarr; transformer</span></h2>
        <p class="lede cue" data-cue="1">one mechanism, an entire revolution</p>
      </div>`,
    },
  ],
};
