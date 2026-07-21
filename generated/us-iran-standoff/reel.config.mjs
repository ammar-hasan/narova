export default {
  title: "US–IRAN · SITREP",
  size: "16:9",
  voices: {
    // Nadia moderates; Marcus reads Washington; Theo reads energy + the East.
    n: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#37e0d0", label: "Nadia · desk" },
    m: { backend: "piper", speaker: "en_US-ryan-high",         color: "#ffb020", label: "Marcus · Washington" },
    t: { backend: "piper", speaker: "en_US-lessac-medium",     color: "#c084fc", label: "Theo · energy & East" },
  },
  theme: {
    mode: "dark",
    accent: "#ffb020",
    bg: "#070b14",
    stage: "#0b1120",
    css: "theme.css",
  },
  chrome: { topbar: true, counter: true, progress: true },
  timing: { gapSentence: 0.2, gapTurn: 0.4, lead: 0.16, tail: 0.5, tempo: 1.12 },
  scenes: [
    {
      id: "open",
      vo: [
        { who: "n", text: "The U.S. and Iran. Everyone's got a headline — and almost none of them agree." },
        { who: "m", text: "So let's be straight about it. This isn't really a standoff. It's a war both sides are fighting—" },
        { who: "t", text: "—and a fragile deal that both sides are breaking. Washington's story, Tehran's, and Beijing's." },
      ],
      body: `<div class="sr sr-hero">
        <div class="sr-kick reveal">SITREP · US–IRAN · JULY 2026</div>
        <h1 class="sr-title-xl reveal">THE <span class="oil">STANDOFF</span></h1>
        <div class="sr-sub reveal">A war both sides are fighting. A deal both sides are breaking.</div>
        <div class="sr-scan reveal"><span class="us">WASHINGTON</span><span class="ir">TEHRAN</span><span class="cn">BEIJING</span></div>
      </div>`,
    },
    {
      id: "origins",
      vo: [
        { who: "n", text: "First — how we even got here. Because this did not start in July." },
        { who: "t", text: "Back on February twenty-eighth, Israel and the U.S. attacked Iran, and killed its supreme leader, Ali Khamenei." },
        { who: "m", text: "It spilled into Lebanon, too. More than two thousand killed there, a million displaced, before a shaky truce." },
        { who: "n", text: "So by summer, this was already a full war looking for an exit — not a sudden flare-up." },
      ],
      body: `<div class="sr">
        <div class="sr-kick reveal war">HOW WE GOT HERE · SINCE FEB 28</div>
        <div class="sr-timeline war">
          <div class="sr-tnode reveal"><span class="sr-dot"></span><b>FEB 28</b><span>Israel &amp; U.S. attack Iran</span></div>
          <div class="sr-tconn reveal"></div>
          <div class="sr-tnode reveal"><span class="sr-dot"></span><b>KILLED</b><span>Iran's supreme leader, Ali Khamenei</span></div>
          <div class="sr-tconn reveal"></div>
          <div class="sr-tnode reveal"><span class="sr-dot"></span><b>LEBANON FRONT</b><span>2,000+ killed · ~1M displaced</span></div>
        </div>
        <div class="sr-note cue" data-cue="3">By summer this was already a full war looking for an exit — the July strikes came mid-conflict.</div>
      </div>`,
    },
    {
      id: "deal",
      vo: [
        { who: "m", text: "Then, June seventeenth — a way out. They signed the Islamabad memorandum." },
        { who: "n", text: "Fourteen points, a sixty-day clock. Reopen Hormuz, freeze the fighting — including in Lebanon — and ease sanctions." },
        { who: "t", text: "Washington even waived part of the oil sanctions. And paragraph nine was the spine: no new sanctions, no new forces." },
        { who: "m", text: "For about three weeks, it actually held." },
      ],
      body: `<div class="sr">
        <div class="sr-kick reveal">THE WAY OUT · ISLAMABAD MoU · JUN 17</div>
        <div class="sr-timeline">
          <div class="sr-tnode reveal"><span class="sr-dot"></span><b>JUN 17</b><span>14-point memorandum signed</span></div>
          <div class="sr-tconn reveal"></div>
          <div class="sr-tnode reveal"><span class="sr-dot"></span><b>60-DAY CLOCK</b><span>reopen Hormuz · freeze Lebanon · ease sanctions</span></div>
          <div class="sr-tconn reveal"></div>
          <div class="sr-tnode reveal"><span class="sr-dot"></span><b>PARA 9</b><span>no new sanctions · no new forces</span></div>
        </div>
        <div class="sr-note cue" data-cue="3">U.S. waived part of its oil sanctions — for about three weeks, it held.</div>
      </div>`,
    },
    {
      id: "broke",
      vo: [
        { who: "t", text: "Then it came apart — and this is where you need both columns, not one." },
        { who: "n", text: "Iran struck commercial tankers in the strait. That's squarely on Tehran." },
        { who: "m", text: "But Washington revoked the oil waiver, piled on new sanctions, and kept hitting Iranian soil — everything paragraph nine forbade." },
        { who: "t", text: "Iran's foreign minister Araghchi put it bluntly: quote, there can only be mutual compliance." },
      ],
      body: `<div class="sr">
        <div class="sr-kick reveal war">WHO BROKE IT? · BOTH DID</div>
        <div class="sr-ledger2">
          <div class="sr-side ir reveal">
            <div class="sr-side-h"><span class="sr-flag ir"></span>TEHRAN</div>
            <ul><li>Struck commercial tankers in Hormuz</li><li>Threatened to close the strait</li></ul>
          </div>
          <div class="sr-vs reveal">PARA 9<br>BROKEN<br>BOTH WAYS</div>
          <div class="sr-side us reveal">
            <div class="sr-side-h"><span class="sr-flag us">&#9733;</span>WASHINGTON</div>
            <ul><li>Revoked the oil-sanctions waiver</li><li>Imposed fresh sanctions</li><li>Airstrikes on Iranian soil</li></ul>
          </div>
        </div>
        <div class="sr-quote2 cue" data-cue="3">Iran's FM Araghchi: <b class="ir">&ldquo;There can only be mutual compliance.&rdquo;</b></div>
      </div>`,
    },
    {
      id: "words",
      vo: [
        { who: "m", text: "And the tone from the top made it so much worse. Trump declared the deal simply over—" },
        { who: "n", text: "—then called Iran's leaders scum, liars, sick people, and threatened to bomb one of their nuclear sites." },
        { who: "t", text: "Pezeshkian's answer? Those insults are worthy of their authors, not the Iranian nation. And Iran, he said, is now in a full-scale war." },
      ],
      body: `<div class="sr">
        <div class="sr-kick reveal war">THE WAR OF WORDS</div>
        <div class="sr-grid2">
          <div class="sr-panel sr-quote reveal">
            <div class="sr-side-h"><span class="sr-flag us">&#9733;</span>TRUMP</div>
            <p>Called Iran's leaders <b class="war">&ldquo;scum,&rdquo; &ldquo;liars,&rdquo; &ldquo;sick people&rdquo;</b> — and declared the deal &ldquo;over.&rdquo;</p>
          </div>
          <div class="sr-panel sr-quote cue" data-cue="2">
            <div class="sr-side-h"><span class="sr-flag ir"></span>PEZESHKIAN</div>
            <p>Insults are <b class="ir">&ldquo;worthy of them, not the Iranian nation.&rdquo;</b> Iran is now in a &ldquo;full-scale war.&rdquo;</p>
          </div>
        </div>
      </div>`,
    },
    {
      id: "hormuz",
      vo: [
        { who: "n", text: "Theo, be honest — why does one little strait move the entire world?" },
        { who: "t", text: "Because roughly twenty million barrels a day pass through it. That's about a fifth of the world's oil." },
        { who: "m", text: "And the second it gets dangerous, that number falls off a cliff." },
        { who: "t", text: "Exactly. It dropped almost thirty percent, down to fourteen-point-six. On a good day now it's clawed back to about eight and a half." },
      ],
      body: `<div class="sr sr-split">
        <div class="sr-col">
          <div class="sr-kick reveal">THE CHOKEPOINT</div>
          <div class="sr-figure cue" data-cue="1"><span class="sr-fig oil">20M</span><span class="sr-unit">barrels/day — roughly a fifth of the world's oil</span></div>
        </div>
        <div class="sr-col">
          <div class="sr-kick reveal oil">FLOW THROUGH HORMUZ · MB/D</div>
          <div class="sr-bars">
            <div class="sr-bar reveal"><span class="sr-blab">PRE-WAR</span><span class="sr-track"><i style="width:100%"></i></span><span class="sr-bval">20.0</span></div>
            <div class="sr-bar reveal"><span class="sr-blab">Q1 2026</span><span class="sr-track"><i class="war" style="width:73%"></i></span><span class="sr-bval">14.6 <em>−30%</em></span></div>
            <div class="sr-bar reveal"><span class="sr-blab">MID-JULY</span><span class="sr-track"><i class="oil" style="width:42%"></i></span><span class="sr-bval">~8.5</span></div>
          </div>
        </div>
      </div>`,
    },
    {
      id: "oil",
      vo: [
        { who: "m", text: "Then July fourteenth. The U.S. reinstates the blockade and slaps a twenty-percent fee on every cargo." },
        { who: "t", text: "Markets hated it. Brent jumped almost ten percent, straight past eighty-three dollars." },
        { who: "n", text: "And that's the cheap seat, right? It touched a hundred and twenty-six back in March." },
        { who: "m", text: "Meanwhile Tehran's official line is that passage through the strait is, quote, currently unfeasible." },
      ],
      body: `<div class="sr">
        <div class="sr-kick reveal oil">THE OIL SHOCK · JULY 14</div>
        <div class="sr-grid2">
          <div class="sr-panel">
            <div class="sr-badge cue" data-cue="0">+20% U.S. fee on every cargo</div>
            <div class="sr-bars huge">
              <div class="sr-bar reveal"><span class="sr-blab">BRENT NOW</span><span class="sr-track"><i class="oil" style="width:66%"></i></span><span class="sr-bval">$83 <em>+9.5%</em></span></div>
              <div class="sr-bar reveal"><span class="sr-blab">MAR PEAK</span><span class="sr-track"><i class="war" style="width:100%"></i></span><span class="sr-bval">$126</span></div>
            </div>
          </div>
          <div class="sr-panel sr-quote cue" data-cue="3">
            <span class="sr-qmark">&ldquo;</span>
            <p>Passage through the Strait of Hormuz is <b>currently unfeasible.</b></p>
            <span class="sr-qby ir">— Iran · Persian Gulf Strait Authority</span>
          </div>
        </div>
      </div>`,
    },
    {
      id: "china",
      vo: [
        { who: "n", text: "Here's the part nobody covers. Who actually buys Iran's oil?" },
        { who: "t", text: "China. Between eighty and ninety percent of Iran's exports go to that one customer." },
        { who: "m", text: "Which is leverage and a liability. When Hormuz seized up, China's own imports crashed." },
        { who: "t", text: "From about eleven-point-six million barrels a day down to seven-point-eight. An eight-year low." },
      ],
      body: `<div class="sr sr-split">
        <div class="sr-col center">
          <div class="sr-kick reveal cn">WHO BUYS IRAN'S OIL?</div>
          <div class="sr-donut cue" data-cue="1">
            <svg viewBox="0 0 200 200"><circle class="sr-ring-bg" cx="100" cy="100" r="78"/><circle class="sr-ring-fg" cx="100" cy="100" r="78" stroke-dasharray="416 490"/></svg>
            <div class="sr-donut-lab"><b>~85%</b><span>&rarr; CHINA</span></div>
          </div>
          <div class="sr-cap">of Iran's oil exports go to <b class="cn">one buyer</b></div>
        </div>
        <div class="sr-col">
          <div class="sr-kick reveal">CHINA'S CRUDE IMPORTS · MB/D</div>
          <div class="sr-bars">
            <div class="sr-bar reveal"><span class="sr-blab">PRE-WAR</span><span class="sr-track"><i style="width:100%"></i></span><span class="sr-bval">11.6</span></div>
            <div class="sr-bar reveal"><span class="sr-blab">MAY 2026</span><span class="sr-track"><i class="war" style="width:67%"></i></span><span class="sr-bval">7.8 <em>8-yr low</em></span></div>
          </div>
          <div class="sr-note cue" data-cue="3">Iran had been sending China ~1.4M barrels a day before the war.</div>
        </div>
      </div>`,
    },
    {
      id: "beijing",
      vo: [
        { who: "n", text: "So with all that riding on it, what's Beijing actually doing right now?" },
        { who: "t", text: "Pushing hard for calm. Wang Yi and Pakistan's Ishaq Dar jointly told both sides: get back to the table." },
        { who: "m", text: "Beijing's deeply invested — a twenty-five-year deal that pledged four hundred billion dollars for discounted Iranian oil." },
        { who: "t", text: "Though the real spending's been a fraction of that. Still, Tehran calls China's role constructive and positive." },
      ],
      body: `<div class="sr">
        <div class="sr-kick reveal">BEIJING'S PLAY</div>
        <div class="sr-diplo">
          <div class="sr-actor reveal"><span class="sr-flag cn">&#9733;</span>China</div>
          <div class="sr-actor reveal"><span class="sr-flag pk"></span>Pakistan</div>
          <div class="sr-arrow reveal">&#9656;&#9656; PUSH &#9656;&#9656;</div>
          <div class="sr-actor big reveal"><span><span class="sr-flag us">&#9733;</span> &nbsp;&#8644;&nbsp; <span class="sr-flag ir"></span></span><b>BACK TO TALKS</b></div>
        </div>
        <div class="sr-bars cue" data-cue="2" style="max-width:640px;margin:6px auto 0">
          <div class="sr-bar"><span class="sr-blab">PLEDGED</span><span class="sr-track"><i class="cn" style="width:100%"></i></span><span class="sr-bval">$400B</span></div>
          <div class="sr-bar"><span class="sr-blab">ACTUAL·15YR</span><span class="sr-track"><i class="oil" style="width:7%"></i></span><span class="sr-bval">~$27B</span></div>
        </div>
        <div class="sr-quote2 cue" data-cue="3">Tehran's read on Beijing: <b class="cn">&ldquo;constructive and positive.&rdquo;</b></div>
      </div>`,
    },
    {
      id: "nuclear",
      vo: [
        { who: "m", text: "But here's what actually keeps people up at night. It isn't the oil." },
        { who: "n", text: "The nuclear file. The IAEA has been locked out since February — no inspectors, no cameras." },
        { who: "t", text: "And more than four hundred kilos of sixty-percent uranium is simply unaccounted for. Weapons-grade is around ninety." },
        { who: "m", text: "The agency's warning is blunt: enough for up to ten weapons, if Iran ever chose to build them." },
      ],
      body: `<div class="sr sr-split">
        <div class="sr-col center">
          <div class="sr-kick reveal war">THE NUCLEAR SHADOW</div>
          <div class="sr-gauge cue" data-cue="2">
            <svg viewBox="0 0 220 140"><path class="sr-gauge-bg" d="M20,120 A90,90 0 0 1 200,120"/><path class="sr-gauge-fg" d="M20,120 A90,90 0 0 1 200,120" stroke-dasharray="188 283"/><line class="sr-needle" x1="110" y1="120" x2="151" y2="49"/><circle class="sr-needle-hub" cx="110" cy="120" r="6"/></svg>
            <div class="sr-gval">60<small>% enriched</small></div>
          </div>
          <div class="sr-glabels" style="width:clamp(200px,26vw,300px)"><span>0%</span><span class="hi">~90% = weapons-grade</span></div>
        </div>
        <div class="sr-col">
          <div class="sr-stamp reveal">IAEA · LOCKED OUT SINCE FEB 28</div>
          <div class="sr-cap2 reveal">No inspectors. No cameras. <b class="ir">440.9 kg</b> unaccounted for.</div>
          <div class="sr-warheads cue" data-cue="3">
            <div class="sr-whrow"><span class="sr-wh"></span><span class="sr-wh"></span><span class="sr-wh"></span><span class="sr-wh"></span><span class="sr-wh"></span><span class="sr-wh"></span><span class="sr-wh"></span><span class="sr-wh"></span><span class="sr-wh"></span><span class="sr-wh"></span></div>
            <span class="sr-wl">enough for up to <b class="war">10 weapons</b> — <em>if Iran chose to build them</em></span>
          </div>
        </div>
      </div>`,
    },
    {
      id: "close",
      vo: [
        { who: "n", text: "So, verdict. Strip the spin from all three capitals — where does this actually stand?" },
        { who: "t", text: "A war in intensive care. Both sides broke the deal — and both still say they'll keep talking." },
        { who: "m", text: "And it all comes down to one waterway. Open, there's a path. Shut, and everyone pays." },
        { who: "n", text: "Watch the strait. That's the fuse." },
      ],
      body: `<div class="sr sr-hero">
        <div class="sr-kick reveal">THE BOTTOM LINE</div>
        <h1 class="sr-title-xl reveal">INTENSIVE <span class="oil">CARE</span></h1>
        <div class="sr-sub cue" data-cue="1">Both sides broke the deal — yet both still say they'll talk.</div>
        <div class="sr-tag cue" data-cue="3">WATCH THE STRAIT. THAT'S THE FUSE.</div>
      </div>`,
    },
  ],
}
