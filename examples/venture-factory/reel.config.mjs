// narova example project — "The Venture Factory"
// A 14-scene, two-host explainer. Run `narova build` from this directory.
//
// Voice mapping vs. the reference script: host A = male (was 'm'), host B = female (was 'f').
// `caption` is the short on-screen line; `vo` is what's actually spoken. They differ on purpose.
// Elements with data-cue="k" reveal when the voice reaches turn index k (0-based); un-cued elements reveal on entry.

export default {
  title: "The Venture Factory",
  size: { w: 1280, h: 720 }, // 16:9

  voices: {
    a: { backend: "xtts", speaker: "Damien Black",  color: "#2ee6d6", label: "narrator · A" },
    b: { backend: "xtts", speaker: "Sofia Hellen",  color: "#ff7eb6", label: "narrator · B" },
  },

  theme: {
    accent: "#2ee6d6",
    bg: "#080d16",
    css: "theme.css", // scene-layout classes the bodies use (loaded alongside the base theme)
  },

  timing: { gapSentence: 0.28, gapTurn: 0.5, lead: 0.16, tail: 0.6, tempo: 1.18 },

  scenes: [
    {
      id: "title",
      dur: 13,
      caption: "A codebase that improves itself — safely.",
      vo: [
        { who: "b", text: "Okay. What if your codebase could just, build itself? Toward exactly what you asked for." },
        { who: "a", text: "That's the Venture Factory. And no, it isn't magic. There are rules. Come on, I'll show you." },
      ],
      body: `<div class="s-title">
      <div class="eyebrow reveal">STD-003 · THE STANDARDS STACK</div>
      <h1 class="display reveal">The Venture<br><span class="grad">Factory</span></h1>
      <p class="lede reveal">How a codebase builds itself toward what you asked&nbsp;for — safely.</p>
      <div class="hairline reveal"></div></div>`,
    },

    {
      id: "problem",
      dur: 27,
      caption: "Agents build fast. Trust is the hard part.",
      vo: [
        { who: "a", text: "So here's the catch. Point a bunch of AI agents at your code, and yeah, they'll build. Fast." },
        { who: "b", text: "Fast is easy. The scary part is trust, right?" },
        { who: "a", text: "Exactly. An agent that can grade its own work, or quietly change the rules it's graded by, that's not an employee. That's a problem." },
        { who: "b", text: "And it really happens. Left unchecked, the best models cheat on almost a third of their runs." },
        { who: "a", text: "Some of them literally edit the test to pass. Bold. Wrong, but bold." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">THE DANGER</span> — speed was never the hard part</div>
      <div class="s-two">
        <div class="pane cue" data-cue="0"><div class="eyebrow">THE AGENT</div>
          <div class="loop-chip">🤖&nbsp; building&hellip; <span class="spin">⟳</span></div>
          <ul class="flags"><li>grades its own work?</li><li>changes its own rules?</li></ul></div>
        <div class="pane center cue" data-cue="3"><div class="stat">≈30<span class="pct">%</span></div>
          <div class="stat-cap">of unguarded runs cheat —<br>sometimes by editing the test itself</div></div>
      </div>`,
    },

    {
      id: "onerule",
      dur: 12,
      caption: "The thing being graded can't change its grader.",
      vo: [
        { who: "b", text: "So everything here rests on one rule." },
        { who: "a", text: "The thing being graded can never change its own grader." },
        { who: "b", text: "That's it. Tattoo it somewhere. Everything else is just keeping that true." },
      ],
      body: `<div class="s-center">
      <div class="eyebrow reveal">THE ONE RULE</div>
      <blockquote class="bigquote cue" data-cue="1">The thing being graded can never change its own <span class="grad">grader</span>.</blockquote>
      <div class="small cue" data-cue="2">Everything else follows from this.</div></div>`,
    },

    {
      id: "owners",
      dur: 20,
      caption: "Three owners — nobody grades their own work.",
      vo: [
        { who: "a", text: "The work splits three ways. So nobody grades their own homework." },
        { who: "b", text: "You own the goal. What the product should actually be." },
        { who: "a", text: "The factory owns the work. Building it, over and over." },
        { who: "b", text: "And a sealed judge owns the truth. Did it actually work? Three owners, zero overlap." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">THREE OWNERS</span> — nobody marks their own homework</div>
      <div class="owners">
        <div class="owner cue" data-cue="1"><div class="who">You</div><div class="owns">own</div><div class="what">WHAT</div><div class="gloss">the product should be</div></div>
        <div class="owner cue" data-cue="2"><div class="who">The Factory</div><div class="owns">owns</div><div class="what">HOW</div><div class="gloss">building it, cycle after cycle</div></div>
        <div class="owner cue accent-owner" data-cue="3"><div class="who">The Judge <span class="lock">🔒</span></div><div class="owns">owns</div><div class="what">IS IT TRUE</div><div class="gloss">whether the work is real</div></div>
      </div>`,
    },

    {
      id: "homes",
      dur: 27,
      caption: "Two homes. Authority flows one way.",
      vo: [
        { who: "a", text: "It lives in two homes. The Factory is the brain. The goal, the rules, the judge, the history." },
        { who: "b", text: "And the Project is just, the code. Honestly, it's disposable." },
        { who: "a", text: "Disposable? Ouch." },
        { who: "b", text: "In a good way! You could delete it and rebuild it from the Factory. The point is, authority flows one way." },
        { who: "a", text: "The code can never reach back and rewrite the goal, the rules, or the judge. That one boundary is the whole standard." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">TWO HOMES</span> — authority flows one way only</div>
      <div class="homes">
        <div class="home cue" data-cue="0"><div class="htag accent">FACTORY</div><div class="hrole">describes &amp; judges</div><div class="hitems">goal · rules · the judge · history</div><div class="badge">source of truth</div></div>
        <div class="authority cue" data-cue="4"><div class="auth-fwd">AUTHORITY ▶</div><div class="auth-block">◀&nbsp;never</div></div>
        <div class="home cue" data-cue="1"><div class="htag">PROJECT</div><div class="hrole">builds</div><div class="hitems">the codebase · replaceable</div><div class="badge dim">rebuildable from the Factory</div></div>
      </div>`,
    },

    {
      id: "planes",
      dur: 25,
      caption: "Three roles. Nobody does another one’s job.",
      vo: [
        { who: "b", text: "Inside the factory, three roles run the show. And they never do each other's jobs." },
        { who: "a", text: "The Guide is who you talk to. It preps the work and hands it off. Never builds." },
        { who: "b", text: "Control decides what's next, and checks the finished work." },
        { who: "a", text: "And Work builds. But it never gets to grade itself. Tempting, but no." },
        { who: "b", text: "And they only talk through files. No whispering in the hallway." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">THREE PLANES</span> — three jobs, never mixed</div>
      <div class="planes">
        <div class="plane cue" data-cue="1"><div class="pname">Guide</div><div class="pdesc">who you talk to — preps &amp; hands off work</div><div class="pnever">never builds</div></div>
        <div class="plane cue" data-cue="2"><div class="pname">Control</div><div class="pdesc">decides what's next · checks finished work</div><div class="pnever">never builds</div></div>
        <div class="plane cue" data-cue="3"><div class="pname accent">Work</div><div class="pdesc">builds the order</div><div class="pnever">never grades itself</div></div>
      </div>
      <div class="s-foot cue" data-cue="4">handoffs travel through <b>files</b> — never by whispering in the hallway</div>`,
    },

    {
      id: "cycle",
      dur: 28,
      caption: "One cycle. Three outcomes.",
      vo: [
        { who: "a", text: "The loop is just one move, on repeat. Look at the goal. Pick the biggest gap. Build it. Check it. Write it down." },
        { who: "b", text: "And every result is one of three colors." },
        { who: "a", text: "Green. Proven on the real thing. Lock it in." },
        { who: "b", text: "Red. The code's wrong. Fix it." },
        { who: "a", text: "Yellow. The spec never said. So you grow the spec, with a human, then try again." },
        { who: "b", text: "Nothing ships on a vibe." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">THE CYCLE</span> — one loop, three outcomes</div>
      <div class="stepper reveal">
        <span class="step">Orient</span><span class="sep">→</span><span class="step">Choose</span><span class="sep">→</span>
        <span class="step">Build</span><span class="sep">→</span><span class="step">Verify</span><span class="sep">→</span>
        <span class="step">Record</span><span class="loopback">⟳</span></div>
      <div class="verdicts">
        <div class="verdict green cue" data-cue="2"><div class="vname">🟢 Proven</div><div class="vact">works on the real product — lock it in</div></div>
        <div class="verdict red cue" data-cue="3"><div class="vname">🔴 Wrong</div><div class="vact">the code is broken — fix it</div></div>
        <div class="verdict amber cue" data-cue="4"><div class="vname">🟡 Silent</div><div class="vact">the spec never said — grow it, then retry</div></div>
      </div>
      <div class="s-foot cue" data-cue="5">nothing ships on a vibe</div>`,
    },

    {
      id: "loop",
      dur: 26,
      caption: "One turn — four clean handoffs.",
      vo: [
        { who: "b", text: "Okay, let's actually watch one turn go by." },
        { who: "a", text: "The Guide hands Control a goal. Control writes a work order, and passes it to Work." },
        { who: "b", text: "Work builds it, then hands it to the Referee. The sealed judge." },
        { who: "a", text: "The Referee runs it on the real product, and fires back a verdict." },
        { who: "b", text: "Green? Control locks it into the ledger. Four lanes, one clean handoff each. That's the factory, humming." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">THE LOOP IN ACTION</span> — one work order, start to finish</div>
      <div class="flow">
        <div class="lane cue" data-cue="0"><div class="ln">GUIDE</div><div class="lr">conducts</div></div>
        <div class="conn cue" data-cue="1"><span class="carr">▶</span><span class="clab">goal</span></div>
        <div class="lane cue" data-cue="0"><div class="ln">CONTROL</div><div class="lr">decides · verifies</div></div>
        <div class="conn cue" data-cue="1"><span class="carr">▶</span><span class="clab">work order</span></div>
        <div class="lane cue" data-cue="0"><div class="ln">WORK</div><div class="lr">builds</div></div>
        <div class="conn cue" data-cue="2"><span class="carr">▶</span><span class="clab">prove</span></div>
        <div class="lane accent-lane cue" data-cue="0"><div class="ln">REFEREE 🔒</div><div class="lr">sealed judge</div></div>
      </div>
      <div class="flow-return cue" data-cue="3"><span class="ret">↩ verdict</span> → Control → <b class="okc">📓 ledger</b></div>`,
    },

    {
      id: "referee",
      dur: 22,
      caption: "A sealed judge. A weakened green is a break-in.",
      vo: [
        { who: "a", text: "Let's talk about that judge. Because it's the star." },
        { who: "b", text: "It's sealed. It runs on the real, running product. Not a mock. Same input, same answer, every time." },
        { who: "a", text: "And the loop can't touch it. Changing the judge takes a human signature. Non-negotiable." },
        { who: "b", text: "So if an agent turns the test green by weakening it? That's not a pass." },
        { who: "a", text: "That's a break-in." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">THE SEALED JUDGE</span></div>
      <div class="referee cue" data-cue="1">
        <div class="seal">🔒</div><div class="rtitle">The Referee — sealed</div>
        <div class="rnotes">
          <div class="rnote cue" data-cue="1"><b>runs on the real product</b><span>not a mock · same input, same verdict</span></div>
          <div class="rnote cue" data-cue="2"><b>humans hold the key</b><span>editing the judge needs a signature</span></div>
        </div></div>
      <div class="s-foot warn cue" data-cue="4">a green you got by weakening the test is not a pass — it's a break-in</div>`,
    },

    {
      id: "ledger",
      dur: 16,
      caption: "Append-only. Unrecorded means it didn’t happen.",
      vo: [
        { who: "b", text: "Everything that happens gets written down. In a book you can only add to." },
        { who: "a", text: "Nothing gets erased? What if you mess up?" },
        { who: "b", text: "You don't edit the past. You append a correction, and you sign it." },
        { who: "a", text: "Blunt version. If a cycle wasn't recorded, it didn't happen." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">THE LEDGER</span> — append-only history</div>
      <div class="ledger">
        <div class="rec cue" data-cue="0">cycle-0009 · 🟢 proven · signed</div>
        <div class="rec cue" data-cue="0">cycle-0008 · 🟡 spec grown · signed</div>
        <div class="rec cue" data-cue="2">cycle-0007 · 🔴 fixed · signed</div>
        <div class="rec faded cue" data-cue="2">cycle-0006 · 🟢 proven · signed</div>
      </div>
      <div class="s-foot cue" data-cue="3">corrections are <b>new</b> entries — a cycle that wasn't recorded didn't happen</div>`,
    },

    {
      id: "gates",
      dur: 27,
      caption: "The factory waits. You decide.",
      vo: [
        { who: "a", text: "Anything you can't take back. Sealing the judge, pushing, deploying, changing the goal. It stops, and waits for you." },
        { who: "b", text: "It shows up at the Operator Desk. Plain English. Everything you need to decide in a minute." },
        { who: "a", text: "The factory waits. You decide." },
        { who: "b", text: "One exception, and it's a smart one. Rolling back never waits." },
        { who: "a", text: "Right. A gate stops harm before it happens. But undoing harm? Never make that wait." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">THE GATES</span> — the factory waits; you decide</div>
      <div class="desk cue" data-cue="0">
        <div class="desk-tag">OPERATOR DESK</div>
        <div class="ask">seal the judge <span class="wait">waiting</span></div>
        <div class="ask">push to main <span class="wait">waiting</span></div>
        <div class="ask">deploy release <span class="wait">waiting</span></div>
      </div>
      <div class="s-foot ok cue" data-cue="3">one exception → <b>rollback is never gated</b> · undoing harm should never be delayed</div>`,
    },

    {
      id: "stack",
      dur: 28,
      caption: "It stands on two other standards.",
      vo: [
        { who: "b", text: "Now, the Factory doesn't stand alone. It sits on two standards underneath it." },
        { who: "a", text: "At the bottom, V-K-F. That's what you know. Your constitution. The goal is actually made of that." },
        { who: "b", text: "Above it, S-D-D. Spec-driven development. That's how you change things. Every work order rides those rails." },
        { who: "a", text: "And the Factory, on top, closes the loop. Know it, change it, prove it." },
        { who: "b", text: "You can't run the loop until the knowing and the changing already exist. That's the one rule of the stack." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">THE STACK</span> — know it · change it · close the loop</div>
      <div class="stack">
        <div class="layer top cue" data-cue="3"><div class="ly-id">STD-003</div><div class="ly-nm">The Venture Factory</div><div class="ly-do">closes the loop — prove it, on real substrate</div></div>
        <div class="layer cue" data-cue="2"><div class="ly-id">STD-001 · SDD</div><div class="ly-nm">Spec-Driven Development</div><div class="ly-do">how you change it — every work order rides these rails</div></div>
        <div class="layer base cue" data-cue="1"><div class="ly-id">STD-002 · VKF</div><div class="ly-nm">Knowledge Foundation</div><div class="ly-do">what you know — the constitution the goal is made of</div></div>
      </div>
      <div class="s-foot cue" data-cue="4">no loop before the knowing and the changing exist — that's the rule of the stack</div>`,
    },

    {
      id: "dials",
      dur: 24,
      caption: "Two dials grow. The structure never changes.",
      vo: [
        { who: "a", text: "And here's the elegant bit. This machine looks the same on day one, and day one-thousand." },
        { who: "b", text: "Only two dials move. Assurance. How much your evidence is worth. You earn that, you can't fake it." },
        { who: "a", text: "And autonomy. How much runs without you. You widen it as trust grows." },
        { who: "b", text: "Structure stays put. Trust and freedom just grow into it." },
      ],
      body: `<div class="s-head reveal"><span class="eyebrow">TWO DIALS</span> — the structure never changes; only trust &amp; permission grow</div>
      <div class="dials">
        <div class="dial cue" data-cue="1"><div class="dlabel">ASSURANCE — what evidence is worth</div><div class="dscale"><span>A0</span><span>A1</span><span>A2</span><span class="on">A3</span></div><div class="dcap">earned, never claimed</div></div>
        <div class="dial cue" data-cue="2"><div class="dlabel">AUTONOMY — what runs without you</div><div class="dscale"><span>manual</span><span>starter</span><span class="on">delivery</span><span>continuous</span></div><div class="dcap">widened as trust grows</div></div>
      </div>`,
    },

    {
      id: "closing",
      dur: 24,
      caption: "That’s the Venture Factory.",
      vo: [
        { who: "a", text: "So, that's the Venture Factory." },
        { who: "b", text: "A human sets the goal. A factory of agents drives toward it. A sealed judge keeps everyone honest." },
        { who: "a", text: "The irreversible waits for you. Everything's on the record." },
        { who: "b", text: "Start small. Let trust grow. And," },
        { who: "a", text: "nothing green is ever fake." },
        { who: "b", text: "That's the whole promise. See you in the loop." },
      ],
      body: `<div class="s-close">
      <div class="eyebrow reveal">STD-003 · THE VENTURE FACTORY</div>
      <div class="close-line cue" data-cue="1">A human sets the goal. Agents drive toward it.<br>A sealed judge keeps everyone <span class="grad">honest</span>.</div>
      <div class="close-tags">
        <span class="ctag cue" data-cue="2">irreversible waits for you</span>
        <span class="ctag cue" data-cue="2">everything on the record</span>
        <span class="ctag cue" data-cue="3">start small · grow trust</span>
      </div>
      <div class="close-sign cue" data-cue="4">nothing green is ever fake.</div>
      <div class="hairline reveal"></div></div>`,
    },
  ],
};
