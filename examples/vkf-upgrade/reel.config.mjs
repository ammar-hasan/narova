// VKF upgrade announcement — STD-002 v3 → v4.4  (bold social cut, concrete edit)
// The forest, shown not asserted: v3 FILED your knowledge; v4 puts it to WORK.
// Every claim below is visible in the repo diff (v3.1 → v4.4, 119 files, +9166):
//   READ BACK — the loop engine: .claude/hooks/hitl-mode.sh + catchup fetch-{gmail,slack,drive}
//   REAL      — six bucket folders on disk + procedural/tools.md + the *-log.yaml audit trail
//   HONEST    — vkf/drift-check.md + drift-proposer.md + drift-verifier.md ; redaction-scan.sh
// Built with narova.
export default {
  title: "VKF v4.4",
  size: { w: 1080, h: 1080 },            // square — social feed native
  voices: {
    a: { backend: "xtts", speaker: "Viktor Eka", color: "#66c8ff", label: "narrator · A" },   // male
    b: { backend: "xtts", speaker: "Tammie Ema", color: "#ff6fae", label: "narrator · B" },    // female
  },
  theme: { accent: "#a37bff", bg: "#08060f", css: "theme.css" },
  timing: { gapSentence: 0.22, gapTurn: 0.4, lead: 0.14, tail: 0.5, tempo: 1.18 },

  scenes: [
    {
      id: "hook",
      vo: [
        { who: "b", text: "Heads up — STD-002 just jumped from version three, to four point four." },
        { who: "a", text: "And it's not a patch. In v3 your knowledge base was a filing cabinet. In v4 it works — reads itself back, checks its facts against your code, and blocks secrets before they ship." },
      ],
      body: `<div class="vk-wrap">
        <div class="vk-kicker reveal">STD-002 · <b>Venture Knowledge Foundation</b></div>
        <div class="vk-mega reveal">v3 <span class="gradt">&rarr;</span> v4.4</div>
        <div class="vk-sub reveal">your knowledge base just <span class="gradt">went to work.</span></div>
      </div>`,
    },
    {
      id: "old",
      vo: [
        { who: "a", text: "Rewind to v3. You sorted notes into types and buckets. Tidy. Organized." },
        { who: "b", text: "But that's all it did — sit on a shelf. Nobody promised it was current, or true, or that anyone ever opened it. Write-only archives nobody reads." },
      ],
      body: `<div class="vk-wrap">
        <div class="vk-kicker reveal">WHERE WE WERE</div>
        <div class="vk-mega reveal"><span class="vk-mute">v3 filed it —</span><br>then hoped</div>
        <div class="vk-line reveal">organized &nbsp;·&nbsp; <b>passive</b> &nbsp;·&nbsp; unread</div>
      </div>`,
    },
    {
      id: "shift",
      vo: [
        { who: "b", text: "v4 rips it off the shelf and wires it into a loop. Three changes — all visible in the repo." },
        { who: "a", text: "It gets read back. It becomes real files. And it keeps itself honest. Let's go." },
      ],
      body: `<div class="vk-wrap">
        <div class="vk-kicker reveal">WHAT ACTUALLY CHANGED</div>
        <div class="vk-vs">
          <div class="vk-old reveal"><s>a shelf</s></div>
          <div class="vk-new gradt cue" data-cue="1">a working loop</div>
        </div>
        <div class="vk-line cue" data-cue="1">read back &nbsp;·&nbsp; real files &nbsp;·&nbsp; kept honest</div>
      </div>`,
    },
    {
      id: "readback",
      vo: [
        { who: "a", text: "Change one — it gets read back. Every note runs a loop: captured from Gmail, Slack, Drive; a human signs off; it's committed; then it comes back as a cited answer, plus a weekly digest." },
        { who: "b", text: "v3 let you dump and forget. v4's rule — if you can't read it back, it isn't knowledge. It's a rumor." },
      ],
      body: `<div class="vk-wrap">
        <div class="vk-pillnum reveal">01</div>
        <div class="vk-pillword reveal">READ BACK</div>
        <div class="vk-flow cue" data-cue="1">
          <span class="vk-node">capture</span><span class="vk-arrow">&rarr;</span>
          <span class="vk-node">stage</span><span class="vk-arrow">&rarr;</span>
          <span class="vk-node">classify</span><span class="vk-arrow">&rarr;</span>
          <span class="vk-node">approve</span><span class="vk-arrow">&rarr;</span>
          <span class="vk-node">commit</span><span class="vk-arrow">&rarr;</span>
          <span class="vk-node">surface</span><span class="vk-arrow">&rarr;</span>
          <span class="vk-node end">read back</span></div>
        <div class="vk-line cue" data-cue="1">a human signs off every entry &nbsp;·&nbsp; cited answers + a weekly digest</div>
      </div>`,
    },
    {
      id: "real",
      vo: [
        { who: "b", text: "Change two — it got real. Those abstract types became six folders you can open: constitution, specs, state, procedural, episodic, identity. Your tools live right in the repo next to them." },
        { who: "a", text: "And one standard now, for every project. v3 let you say we'll get there someday. v4 deleted that line." },
      ],
      body: `<div class="vk-wrap">
        <div class="vk-pillnum reveal">02</div>
        <div class="vk-pillword reveal">REAL</div>
        <div class="vk-chips cue" data-cue="1">
          <span class="vk-chip">constitution/</span>
          <span class="vk-chip">specs/</span>
          <span class="vk-chip">state/</span>
          <span class="vk-chip">procedural/</span>
          <span class="vk-chip">episodic/</span>
          <span class="vk-chip">identity/</span>
          <span class="vk-chip hot">one bar — no tiers</span></div>
        <div class="vk-line cue" data-cue="1">six real folders on disk &nbsp;·&nbsp; tools committed in the repo</div>
      </div>`,
    },
    {
      id: "honest",
      vo: [
        { who: "a", text: "Change three — it keeps itself honest. It checks your docs against your real code. Rename a table two sprints back? It catches the stale doc, proposes a fix, and a second agent verifies it — so nothing's made up." },
        { who: "b", text: "And it stops secrets cold. A customer's gate was blocking the word determination — just because it contains termination. Fixed: whole words only, and no A-P-I key slips through." },
      ],
      body: `<div class="vk-wrap">
        <div class="vk-pillnum reveal">03</div>
        <div class="vk-pillword reveal">HONEST</div>
        <div class="vk-chips cue" data-cue="1">
          <span class="vk-chip">docs checked vs code</span>
          <span class="vk-chip">dual-agent verified</span>
          <span class="vk-chip hot">secrets blocked</span></div>
        <div class="vk-line cue" data-cue="1">&ldquo;determination&rdquo; &ne; &ldquo;termination&rdquo; — whole-word now &nbsp;·&nbsp; added lines only</div>
      </div>`,
    },
    {
      id: "close",
      vo: [
        { who: "b", text: "v3 filed your knowledge." },
        { who: "a", text: "v4 puts it to work — reads it back, keeps it honest, guards it." },
        { who: "b", text: "Run, slash v-k-f validate. See where you stand — then upgrade the loop." },
      ],
      body: `<div class="vk-wrap">
        <div class="vk-vs">
          <div class="vk-old reveal">v3 <b>filed</b> it.</div>
          <div class="vk-new gradt cue" data-cue="1">v4 works it.</div>
        </div>
        <div class="vk-cmd cue" data-cue="2">/vkf:validate</div>
        <div class="vk-kicker cue" data-cue="2">see where you stand</div>
      </div>`,
    },
  ],
};
