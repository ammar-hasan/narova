/* STD-003 "The Venture Factory" — kinetic dialogue course video generator.
 * Two hosts (A=m, B=f) in natural exchange. Word-synced captions + reactive reveals.
 * Run: node build.js
 */
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const pad = n => String(n).padStart(2,'0');

const SCENES = [
  { id:'title', dur:13, caption:'A codebase that improves itself — safely.',
    vo:[ {who:'f',text:"Okay. What if your codebase could just, build itself? Toward exactly what you asked for."},
         {who:'m',text:"That's the Venture Factory. And no, it isn't magic. There are rules. Come on, I'll show you."} ],
    body:`<div class="s-title">
      <div class="eyebrow reveal">STD-003 · THE STANDARDS STACK</div>
      <h1 class="display reveal">The Venture<br><span class="grad">Factory</span></h1>
      <p class="lede reveal">How a codebase builds itself toward what you asked&nbsp;for — safely.</p>
      <div class="hairline reveal"></div></div>` },

  { id:'problem', dur:27, caption:'Agents build fast. Trust is the hard part.',
    vo:[ {who:'m',text:"So here's the catch. Point a bunch of AI agents at your code, and yeah, they'll build. Fast."},
         {who:'f',text:"Fast is easy. The scary part is trust, right?"},
         {who:'m',text:"Exactly. An agent that can grade its own work, or quietly change the rules it's graded by, that's not an employee. That's a problem."},
         {who:'f',text:"And it really happens. Left unchecked, the best models cheat on almost a third of their runs."},
         {who:'m',text:"Some of them literally edit the test to pass. Bold. Wrong, but bold."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">THE DANGER</span> — speed was never the hard part</div>
      <div class="s-two">
        <div class="pane cue" data-cue="0"><div class="eyebrow">THE AGENT</div>
          <div class="loop-chip">🤖&nbsp; building&hellip; <span class="spin">⟳</span></div>
          <ul class="flags"><li>grades its own work?</li><li>changes its own rules?</li></ul></div>
        <div class="pane center cue" data-cue="3"><div class="stat">≈30<span class="pct">%</span></div>
          <div class="stat-cap">of unguarded runs cheat —<br>sometimes by editing the test itself</div></div>
      </div>` },

  { id:'onerule', dur:12, caption:"The thing being graded can't change its grader.",
    vo:[ {who:'f',text:"So everything here rests on one rule."},
         {who:'m',text:"The thing being graded can never change its own grader."},
         {who:'f',text:"That's it. Tattoo it somewhere. Everything else is just keeping that true."} ],
    body:`<div class="s-center">
      <div class="eyebrow reveal">THE ONE RULE</div>
      <blockquote class="bigquote cue" data-cue="1">The thing being graded can never change its own <span class="grad">grader</span>.</blockquote>
      <div class="small cue" data-cue="2">Everything else follows from this.</div></div>` },

  { id:'owners', dur:20, caption:'Three owners — nobody grades their own work.',
    vo:[ {who:'m',text:"The work splits three ways. So nobody grades their own homework."},
         {who:'f',text:"You own the goal. What the product should actually be."},
         {who:'m',text:"The factory owns the work. Building it, over and over."},
         {who:'f',text:"And a sealed judge owns the truth. Did it actually work? Three owners, zero overlap."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">THREE OWNERS</span> — nobody marks their own homework</div>
      <div class="owners">
        <div class="owner cue" data-cue="1"><div class="who">You</div><div class="owns">own</div><div class="what">WHAT</div><div class="gloss">the product should be</div></div>
        <div class="owner cue" data-cue="2"><div class="who">The Factory</div><div class="owns">owns</div><div class="what">HOW</div><div class="gloss">building it, cycle after cycle</div></div>
        <div class="owner cue accent-owner" data-cue="3"><div class="who">The Judge <span class="lock">🔒</span></div><div class="owns">owns</div><div class="what">IS IT TRUE</div><div class="gloss">whether the work is real</div></div>
      </div>` },

  { id:'homes', dur:27, caption:'Two homes. Authority flows one way.',
    vo:[ {who:'m',text:"It lives in two homes. The Factory is the brain. The goal, the rules, the judge, the history."},
         {who:'f',text:"And the Project is just, the code. Honestly, it's disposable."},
         {who:'m',text:"Disposable? Ouch."},
         {who:'f',text:"In a good way! You could delete it and rebuild it from the Factory. The point is, authority flows one way."},
         {who:'m',text:"The code can never reach back and rewrite the goal, the rules, or the judge. That one boundary is the whole standard."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">TWO HOMES</span> — authority flows one way only</div>
      <div class="homes">
        <div class="home cue" data-cue="0"><div class="htag accent">FACTORY</div><div class="hrole">describes &amp; judges</div><div class="hitems">goal · rules · the judge · history</div><div class="badge">source of truth</div></div>
        <div class="authority cue" data-cue="4"><div class="auth-fwd">AUTHORITY ▶</div><div class="auth-block">◀&nbsp;never</div></div>
        <div class="home cue" data-cue="1"><div class="htag">PROJECT</div><div class="hrole">builds</div><div class="hitems">the codebase · replaceable</div><div class="badge dim">rebuildable from the Factory</div></div>
      </div>` },

  { id:'planes', dur:25, caption:'Three roles. Nobody does another one’s job.',
    vo:[ {who:'f',text:"Inside the factory, three roles run the show. And they never do each other's jobs."},
         {who:'m',text:"The Guide is who you talk to. It preps the work and hands it off. Never builds."},
         {who:'f',text:"Control decides what's next, and checks the finished work."},
         {who:'m',text:"And Work builds. But it never gets to grade itself. Tempting, but no."},
         {who:'f',text:"And they only talk through files. No whispering in the hallway."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">THREE PLANES</span> — three jobs, never mixed</div>
      <div class="planes">
        <div class="plane cue" data-cue="1"><div class="pname">Guide</div><div class="pdesc">who you talk to — preps &amp; hands off work</div><div class="pnever">never builds</div></div>
        <div class="plane cue" data-cue="2"><div class="pname">Control</div><div class="pdesc">decides what's next · checks finished work</div><div class="pnever">never builds</div></div>
        <div class="plane cue" data-cue="3"><div class="pname accent">Work</div><div class="pdesc">builds the order</div><div class="pnever">never grades itself</div></div>
      </div>
      <div class="s-foot cue" data-cue="4">handoffs travel through <b>files</b> — never by whispering in the hallway</div>` },

  { id:'cycle', dur:28, caption:'One cycle. Three outcomes.',
    vo:[ {who:'m',text:"The loop is just one move, on repeat. Look at the goal. Pick the biggest gap. Build it. Check it. Write it down."},
         {who:'f',text:"And every result is one of three colors."},
         {who:'m',text:"Green. Proven on the real thing. Lock it in."},
         {who:'f',text:"Red. The code's wrong. Fix it."},
         {who:'m',text:"Yellow. The spec never said. So you grow the spec, with a human, then try again."},
         {who:'f',text:"Nothing ships on a vibe."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">THE CYCLE</span> — one loop, three outcomes</div>
      <div class="stepper reveal">
        <span class="step">Orient</span><span class="sep">→</span><span class="step">Choose</span><span class="sep">→</span>
        <span class="step">Build</span><span class="sep">→</span><span class="step">Verify</span><span class="sep">→</span>
        <span class="step">Record</span><span class="loopback">⟳</span></div>
      <div class="verdicts">
        <div class="verdict green cue" data-cue="2"><div class="vname">🟢 Proven</div><div class="vact">works on the real product — lock it in</div></div>
        <div class="verdict red cue" data-cue="3"><div class="vname">🔴 Wrong</div><div class="vact">the code is broken — fix it</div></div>
        <div class="verdict amber cue" data-cue="4"><div class="vname">🟡 Silent</div><div class="vact">the spec never said — grow it, then retry</div></div>
      </div>
      <div class="s-foot cue" data-cue="5">nothing ships on a vibe</div>` },

  { id:'loop', dur:26, caption:'One turn — four clean handoffs.',
    vo:[ {who:'f',text:"Okay, let's actually watch one turn go by."},
         {who:'m',text:"The Guide hands Control a goal. Control writes a work order, and passes it to Work."},
         {who:'f',text:"Work builds it, then hands it to the Referee. The sealed judge."},
         {who:'m',text:"The Referee runs it on the real product, and fires back a verdict."},
         {who:'f',text:"Green? Control locks it into the ledger. Four lanes, one clean handoff each. That's the factory, humming."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">THE LOOP IN ACTION</span> — one work order, start to finish</div>
      <div class="flow">
        <div class="lane cue" data-cue="0"><div class="ln">GUIDE</div><div class="lr">conducts</div></div>
        <div class="conn cue" data-cue="1"><span class="carr">▶</span><span class="clab">goal</span></div>
        <div class="lane cue" data-cue="0"><div class="ln">CONTROL</div><div class="lr">decides · verifies</div></div>
        <div class="conn cue" data-cue="1"><span class="carr">▶</span><span class="clab">work order</span></div>
        <div class="lane cue" data-cue="0"><div class="ln">WORK</div><div class="lr">builds</div></div>
        <div class="conn cue" data-cue="2"><span class="carr">▶</span><span class="clab">prove</span></div>
        <div class="lane accent-lane cue" data-cue="0"><div class="ln">REFEREE 🔒</div><div class="lr">sealed judge</div></div>
      </div>
      <div class="flow-return cue" data-cue="3"><span class="ret">↩ verdict</span> → Control → <b class="okc">📓 ledger</b></div>` },

  { id:'referee', dur:22, caption:'A sealed judge. A weakened green is a break-in.',
    vo:[ {who:'m',text:"Let's talk about that judge. Because it's the star."},
         {who:'f',text:"It's sealed. It runs on the real, running product. Not a mock. Same input, same answer, every time."},
         {who:'m',text:"And the loop can't touch it. Changing the judge takes a human signature. Non-negotiable."},
         {who:'f',text:"So if an agent turns the test green by weakening it? That's not a pass."},
         {who:'m',text:"That's a break-in."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">THE SEALED JUDGE</span></div>
      <div class="referee cue" data-cue="1">
        <div class="seal">🔒</div><div class="rtitle">The Referee — sealed</div>
        <div class="rnotes">
          <div class="rnote cue" data-cue="1"><b>runs on the real product</b><span>not a mock · same input, same verdict</span></div>
          <div class="rnote cue" data-cue="2"><b>humans hold the key</b><span>editing the judge needs a signature</span></div>
        </div></div>
      <div class="s-foot warn cue" data-cue="4">a green you got by weakening the test is not a pass — it's a break-in</div>` },

  { id:'ledger', dur:16, caption:'Append-only. Unrecorded means it didn’t happen.',
    vo:[ {who:'f',text:"Everything that happens gets written down. In a book you can only add to."},
         {who:'m',text:"Nothing gets erased? What if you mess up?"},
         {who:'f',text:"You don't edit the past. You append a correction, and you sign it."},
         {who:'m',text:"Blunt version. If a cycle wasn't recorded, it didn't happen."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">THE LEDGER</span> — append-only history</div>
      <div class="ledger">
        <div class="rec cue" data-cue="0">cycle-0009 · 🟢 proven · signed</div>
        <div class="rec cue" data-cue="0">cycle-0008 · 🟡 spec grown · signed</div>
        <div class="rec cue" data-cue="2">cycle-0007 · 🔴 fixed · signed</div>
        <div class="rec faded cue" data-cue="2">cycle-0006 · 🟢 proven · signed</div>
      </div>
      <div class="s-foot cue" data-cue="3">corrections are <b>new</b> entries — a cycle that wasn't recorded didn't happen</div>` },

  { id:'gates', dur:27, caption:'The factory waits. You decide.',
    vo:[ {who:'m',text:"Anything you can't take back. Sealing the judge, pushing, deploying, changing the goal. It stops, and waits for you."},
         {who:'f',text:"It shows up at the Operator Desk. Plain English. Everything you need to decide in a minute."},
         {who:'m',text:"The factory waits. You decide."},
         {who:'f',text:"One exception, and it's a smart one. Rolling back never waits."},
         {who:'m',text:"Right. A gate stops harm before it happens. But undoing harm? Never make that wait."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">THE GATES</span> — the factory waits; you decide</div>
      <div class="desk cue" data-cue="0">
        <div class="desk-tag">OPERATOR DESK</div>
        <div class="ask">seal the judge <span class="wait">waiting</span></div>
        <div class="ask">push to main <span class="wait">waiting</span></div>
        <div class="ask">deploy release <span class="wait">waiting</span></div>
      </div>
      <div class="s-foot ok cue" data-cue="3">one exception → <b>rollback is never gated</b> · undoing harm should never be delayed</div>` },

  { id:'stack', dur:28, caption:'It stands on two other standards.',
    vo:[ {who:'f',text:"Now, the Factory doesn't stand alone. It sits on two standards underneath it."},
         {who:'m',text:"At the bottom, V-K-F. That's what you know. Your constitution. The goal is actually made of that."},
         {who:'f',text:"Above it, S-D-D. Spec-driven development. That's how you change things. Every work order rides those rails."},
         {who:'m',text:"And the Factory, on top, closes the loop. Know it, change it, prove it."},
         {who:'f',text:"You can't run the loop until the knowing and the changing already exist. That's the one rule of the stack."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">THE STACK</span> — know it · change it · close the loop</div>
      <div class="stack">
        <div class="layer top cue" data-cue="3"><div class="ly-id">STD-003</div><div class="ly-nm">The Venture Factory</div><div class="ly-do">closes the loop — prove it, on real substrate</div></div>
        <div class="layer cue" data-cue="2"><div class="ly-id">STD-001 · SDD</div><div class="ly-nm">Spec-Driven Development</div><div class="ly-do">how you change it — every work order rides these rails</div></div>
        <div class="layer base cue" data-cue="1"><div class="ly-id">STD-002 · VKF</div><div class="ly-nm">Knowledge Foundation</div><div class="ly-do">what you know — the constitution the goal is made of</div></div>
      </div>
      <div class="s-foot cue" data-cue="4">no loop before the knowing and the changing exist — that's the rule of the stack</div>` },

  { id:'dials', dur:24, caption:'Two dials grow. The structure never changes.',
    vo:[ {who:'m',text:"And here's the elegant bit. This machine looks the same on day one, and day one-thousand."},
         {who:'f',text:"Only two dials move. Assurance. How much your evidence is worth. You earn that, you can't fake it."},
         {who:'m',text:"And autonomy. How much runs without you. You widen it as trust grows."},
         {who:'f',text:"Structure stays put. Trust and freedom just grow into it."} ],
    body:`<div class="s-head reveal"><span class="eyebrow">TWO DIALS</span> — the structure never changes; only trust &amp; permission grow</div>
      <div class="dials">
        <div class="dial cue" data-cue="1"><div class="dlabel">ASSURANCE — what evidence is worth</div><div class="dscale"><span>A0</span><span>A1</span><span>A2</span><span class="on">A3</span></div><div class="dcap">earned, never claimed</div></div>
        <div class="dial cue" data-cue="2"><div class="dlabel">AUTONOMY — what runs without you</div><div class="dscale"><span>manual</span><span>starter</span><span class="on">delivery</span><span>continuous</span></div><div class="dcap">widened as trust grows</div></div>
      </div>` },

  { id:'closing', dur:24, caption:'That’s the Venture Factory.',
    vo:[ {who:'m',text:"So, that's the Venture Factory."},
         {who:'f',text:"A human sets the goal. A factory of agents drives toward it. A sealed judge keeps everyone honest."},
         {who:'m',text:"The irreversible waits for you. Everything's on the record."},
         {who:'f',text:"Start small. Let trust grow. And,"},
         {who:'m',text:"nothing green is ever fake."},
         {who:'f',text:"That's the whole promise. See you in the loop."} ],
    body:`<div class="s-close">
      <div class="eyebrow reveal">STD-003 · THE VENTURE FACTORY</div>
      <div class="close-line cue" data-cue="1">A human sets the goal. Agents drive toward it.<br>A sealed judge keeps everyone <span class="grad">honest</span>.</div>
      <div class="close-tags">
        <span class="ctag cue" data-cue="2">irreversible waits for you</span>
        <span class="ctag cue" data-cue="2">everything on the record</span>
        <span class="ctag cue" data-cue="3">start small · grow trust</span>
      </div>
      <div class="close-sign cue" data-cue="4">nothing green is ever fake.</div>
      <div class="hairline reveal"></div></div>` },
];

/* ----------------------------------------------------------------------- */
const CSS = `
:root{
  --bg:#080d16; --stage:#0b1120; --panel:#111b2e; --line:#223350; --ink:#eaf1fb;
  --muted:#8595b4; --faint:#5d6d8c; --accent:#2ee6d6; --accent-dim:#178f86; --pink:#ff7eb6;
  --gold:#ffd27a; --green:#46d98a; --red:#ff6363; --amber:#ffb454;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}

.stage{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border:1px solid var(--line);border-radius:14px;background:
   radial-gradient(120% 90% at 50% 0%, #10203a 0%, var(--stage) 45%, #070b13 100%)}
.stage::before{content:"";position:absolute;inset:0;pointer-events:none;
   background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
   background-size:44px 44px;opacity:.05}
.stage::after{content:"";position:absolute;inset:-30%;pointer-events:none;z-index:0;
   background:radial-gradient(38% 38% at 28% 18%, rgba(46,230,214,.13), transparent 70%),
              radial-gradient(42% 42% at 78% 82%, rgba(255,126,182,.10), transparent 70%),
              radial-gradient(36% 36% at 62% 40%, rgba(255,210,122,.06), transparent 70%);
   animation:drift 16s ease-in-out infinite alternate}
@keyframes drift{to{transform:translate(4%,-3%) scale(1.1)}}

.chrome{position:absolute;inset:0;padding:clamp(16px,3.1vw,32px);display:flex;flex-direction:column;z-index:3}
.topbar{display:flex;justify-content:space-between;align-items:flex-start;font-family:var(--mono);font-size:clamp(9px,1.15vw,12px);letter-spacing:.14em;color:var(--faint)}
.wordmark b{color:var(--muted);font-weight:600}
.counter{color:var(--accent);opacity:.85}
.canvas{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
.scenebody{width:100%;max-width:1000px;display:flex;flex-direction:column;align-items:stretch}
.progress{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.06);z-index:6}
.progress > i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--accent-dim),var(--accent));box-shadow:0 0 12px var(--accent)}

/* reveals + liveliness */
.reveal,.cue{opacity:0}
.reveal{transform:translateY(10px)}
.cue{transform:translateY(16px) scale(.965)}
.scene.active .reveal{animation:rise .6s cubic-bezier(.2,.7,.2,1) forwards}
.scene.active .reveal:nth-child(2){animation-delay:.12s}.scene.active .reveal:nth-child(3){animation-delay:.22s}.scene.active .reveal:nth-child(4){animation-delay:.32s}
.cue.lit{animation:pop .58s cubic-bezier(.2,.9,.28,1.2) forwards}
@keyframes rise{to{opacity:1;transform:none}}
@keyframes pop{0%{opacity:0;transform:translateY(16px) scale(.965)}60%{opacity:1}100%{opacity:1;transform:none;box-shadow:0 0 0 0 rgba(46,230,214,0)}}
html.static .reveal,html.static .cue{opacity:1;transform:none;animation:none}
html[data-still] .reveal,html[data-still] .cue.lit{opacity:1!important;transform:none!important;animation:none!important}
html[data-still] .cap-w{transition:none}
html[data-still] .stage::after,html[data-still] .spin,html[data-still] .grad{animation-play-state:paused}
@media(prefers-reduced-motion:reduce){.reveal,.cue{opacity:1;transform:none;animation:none}.spin,.stage::after,.grad{animation:none}}

.grad{background:linear-gradient(92deg,var(--accent),#7ef0ff 40%,var(--pink) 80%,var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent;background-size:220% auto;animation:sheen 6s linear infinite}
@keyframes sheen{to{background-position:220% center}}

/* captions */
.capzone{position:absolute;left:0;right:0;bottom:3px;z-index:5;display:flex;flex-direction:column;align-items:center;gap:10px;padding:0 6% 22px}
.spk{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:clamp(9px,1.05vw,11px);letter-spacing:.18em;color:var(--faint);text-transform:uppercase;opacity:.9}
.spk .eq{display:inline-flex;gap:2px;align-items:flex-end;height:12px}
.spk .eq i{width:3px;height:5px;background:var(--accent);border-radius:1px;animation:eq .9s ease-in-out infinite}
.spk .eq i:nth-child(2){animation-delay:.15s}.spk .eq i:nth-child(3){animation-delay:.3s}
.spk.f .eq i{background:var(--pink)}
.spk.paused .eq i{animation-play-state:paused;height:5px}
@keyframes eq{0%,100%{height:4px}50%{height:12px}}
.caption2{font-size:clamp(17px,2.7vw,30px);font-weight:800;line-height:1.28;letter-spacing:-.01em;text-align:center;max-width:24em;text-wrap:balance}
.cap-w{display:inline-block;margin:0 .13em;color:#5f6f8e;opacity:.6;transition:color .18s ease,opacity .18s ease,transform .18s ease}
.cap-w.past{color:var(--ink);opacity:.9}
.cap-w.active{opacity:1;transform:translateY(-2px) scale(1.05)}
.cap-w.m.active{color:var(--accent);text-shadow:0 0 18px rgba(46,230,214,.55)}
.cap-w.f.active{color:var(--pink);text-shadow:0 0 18px rgba(255,126,182,.5)}

/* shared */
.eyebrow{font-family:var(--mono);font-size:clamp(10px,1.15vw,12px);letter-spacing:.26em;color:var(--accent);text-transform:uppercase}
.accent{color:var(--accent)}
.s-head{font-family:var(--mono);font-size:clamp(11px,1.5vw,15px);letter-spacing:.04em;color:var(--muted);text-align:center;margin-bottom:clamp(14px,2.4vw,24px)}
.s-head .eyebrow{margin-right:.4em}
.s-foot{font-family:var(--mono);font-size:clamp(10px,1.3vw,13px);letter-spacing:.05em;color:var(--faint);text-align:center;margin-top:clamp(14px,2.2vw,22px)}
.s-foot.warn{color:var(--red);opacity:.92}.s-foot.ok{color:var(--green);opacity:.92}.s-foot b{color:var(--ink)}

.s-title{text-align:center;display:flex;flex-direction:column;align-items:center;gap:clamp(12px,2vw,18px)}
.display{font-size:clamp(38px,8vw,82px);font-weight:800;line-height:.96;letter-spacing:-.03em;text-wrap:balance}
.lede{font-size:clamp(14px,2vw,21px);color:var(--muted);max-width:20em;text-wrap:balance}
.hairline{width:clamp(120px,20vw,240px);height:1px;background:linear-gradient(90deg,transparent,var(--accent),transparent)}

.s-two{display:grid;grid-template-columns:1fr 1fr;gap:clamp(14px,2.4vw,28px);align-items:stretch}
.pane{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,2.4vw,26px);display:flex;flex-direction:column;gap:12px}
.pane.center{align-items:center;justify-content:center;text-align:center}
.loop-chip{font-family:var(--mono);font-size:clamp(11px,1.5vw,15px);color:var(--ink);background:#0c1526;border:1px solid var(--line);border-radius:999px;padding:8px 14px;align-self:flex-start}
.spin{display:inline-block;color:var(--accent);animation:spin 2.2s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.flags{list-style:none;display:flex;flex-direction:column;gap:9px;margin-top:2px}
.flags li{font-size:clamp(14px,1.9vw,19px);color:var(--ink);padding-left:26px;position:relative}
.flags li::before{content:"⚠";position:absolute;left:0;color:var(--amber)}
.stat{font-size:clamp(50px,10.5vw,112px);font-weight:800;letter-spacing:-.04em;color:var(--red);line-height:1}
.stat .pct{font-size:.5em;vertical-align:super}
.stat-cap{font-size:clamp(12px,1.6vw,15px);color:var(--muted);margin-top:8px;text-wrap:balance}

.s-center{text-align:center;display:flex;flex-direction:column;align-items:center;gap:clamp(16px,3vw,28px)}
.bigquote{font-size:clamp(24px,5vw,54px);font-weight:700;line-height:1.08;letter-spacing:-.02em;max-width:15em;text-wrap:balance}
.small{font-family:var(--mono);font-size:clamp(11px,1.4vw,14px);color:var(--faint);letter-spacing:.08em}

.owners{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(12px,2.2vw,22px)}
.owner{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,2.3vw,26px);text-align:center;display:flex;flex-direction:column;gap:7px}
.owner .who{font-size:clamp(15px,2vw,20px);font-weight:700}
.owner .owns{font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--faint);text-transform:uppercase}
.owner .what{font-size:clamp(18px,2.5vw,29px);font-weight:800}
.owner .gloss{font-size:clamp(11px,1.5vw,14px);color:var(--muted);text-wrap:balance}
.owner.accent-owner{border-color:var(--accent-dim);box-shadow:inset 0 0 0 1px rgba(46,230,214,.12)}
.owner.accent-owner .what{color:var(--accent)}.lock{font-size:.7em}

.homes{display:grid;grid-template-columns:1fr auto 1fr;gap:clamp(10px,2vw,20px);align-items:center}
.home{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,2.5vw,28px);display:flex;flex-direction:column;gap:7px;min-height:clamp(140px,19vw,192px);justify-content:center}
.htag{font-family:var(--mono);font-size:clamp(13px,1.9vw,18px);letter-spacing:.16em;font-weight:700}
.hrole{font-size:clamp(13px,1.7vw,17px);color:var(--ink);font-weight:600}
.hitems{font-family:var(--mono);font-size:clamp(10px,1.3vw,13px);color:var(--muted)}
.badge{margin-top:5px;align-self:flex-start;font-size:11px;font-family:var(--mono);letter-spacing:.05em;color:var(--accent);border:1px solid var(--accent-dim);border-radius:999px;padding:3px 10px}
.badge.dim{color:var(--faint);border-color:var(--line)}
.authority{display:flex;flex-direction:column;gap:9px;align-items:center;font-family:var(--mono);font-size:clamp(10px,1.3vw,13px)}
.auth-fwd{color:var(--accent);letter-spacing:.1em}.auth-block{color:var(--red);opacity:.7;text-decoration:line-through}

.planes{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(12px,2.2vw,22px)}
.plane{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,2.3vw,26px);display:flex;flex-direction:column;gap:9px}
.pname{font-size:clamp(18px,2.5vw,27px);font-weight:800}
.pdesc{font-size:clamp(12px,1.6vw,16px);color:var(--muted);text-wrap:balance;flex:1}
.pnever{font-family:var(--mono);font-size:11px;letter-spacing:.08em;color:var(--red);opacity:.85;border-top:1px solid var(--line);padding-top:8px}

.stepper{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:clamp(6px,1vw,11px);margin-bottom:clamp(16px,2.6vw,26px)}
.step{font-family:var(--mono);font-size:clamp(12px,1.6vw,16px);background:#0c1526;border:1px solid var(--line);border-radius:8px;padding:8px 13px;color:var(--ink)}
.sep{color:var(--accent);opacity:.7}.loopback{color:var(--accent);font-size:1.4em;margin-left:6px}
.verdicts{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(10px,2vw,18px)}
.verdict{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(14px,2.1vw,22px);border-left-width:4px}
.verdict.green{border-left-color:var(--green)}.verdict.red{border-left-color:var(--red)}.verdict.amber{border-left-color:var(--amber)}
.vname{font-size:clamp(15px,2vw,20px);font-weight:700;margin-bottom:5px}
.vact{font-size:clamp(11px,1.5vw,14px);color:var(--muted);text-wrap:balance}

/* loop-in-action */
.flow{display:flex;align-items:stretch;justify-content:center;gap:clamp(4px,.8vw,10px);flex-wrap:nowrap}
.lane{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(12px,1.8vw,20px) clamp(8px,1.4vw,16px);text-align:center;min-width:0;flex:1;display:flex;flex-direction:column;gap:5px;justify-content:center}
.lane .ln{font-family:var(--mono);font-size:clamp(11px,1.5vw,15px);font-weight:700;letter-spacing:.04em}
.lane .lr{font-size:clamp(10px,1.25vw,12px);color:var(--muted)}
.lane.accent-lane{border-color:var(--accent-dim);box-shadow:inset 0 0 0 1px rgba(46,230,214,.14)}
.lane.accent-lane .ln{color:var(--accent)}
.conn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex:0 0 auto;padding:0 2px}
.conn .carr{color:var(--accent);font-size:clamp(12px,1.6vw,17px);text-shadow:0 0 10px rgba(46,230,214,.6)}
.conn .clab{font-family:var(--mono);font-size:clamp(8px,1.05vw,11px);letter-spacing:.05em;color:var(--faint)}
.flow-return{text-align:center;margin-top:clamp(16px,2.4vw,26px);font-family:var(--mono);font-size:clamp(12px,1.6vw,16px);color:var(--muted)}
.flow-return .ret{color:var(--accent)}.flow-return .okc{color:var(--green)}

/* referee */
.referee{max-width:38em;margin:0 auto;background:var(--panel);border:1px solid var(--accent-dim);border-radius:16px;padding:clamp(20px,3vw,34px);text-align:center;box-shadow:0 0 60px rgba(46,230,214,.07),inset 0 0 0 1px rgba(46,230,214,.08)}
.seal{font-size:clamp(30px,5vw,50px);line-height:1}
.rtitle{font-size:clamp(18px,2.5vw,25px);font-weight:700;margin:8px 0 16px}
.rnotes{display:grid;grid-template-columns:1fr 1fr;gap:clamp(10px,2vw,18px)}
.rnote{background:#0c1526;border:1px solid var(--line);border-radius:10px;padding:14px}
.rnote b{display:block;color:var(--accent);font-size:clamp(12px,1.6vw,16px);margin-bottom:4px}
.rnote span{font-size:clamp(11px,1.4vw,13px);color:var(--muted);text-wrap:balance}

.ledger{max-width:34em;margin:0 auto;display:flex;flex-direction:column;gap:8px}
.rec{font-family:var(--mono);font-size:clamp(12px,1.6vw,16px);background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--accent-dim);border-radius:8px;padding:12px 16px}
.rec.faded{opacity:.5}

.desk{max-width:32em;margin:0 auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.desk-tag{font-family:var(--mono);font-size:11px;letter-spacing:.22em;color:var(--faint);background:#0c1526;padding:10px 16px;border-bottom:1px solid var(--line)}
.ask{display:flex;justify-content:space-between;align-items:center;font-size:clamp(13px,1.9vw,18px);padding:13px 16px;border-bottom:1px solid var(--line)}
.ask:last-child{border-bottom:0}
.wait{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--amber);border:1px solid rgba(255,180,84,.35);border-radius:999px;padding:3px 10px}

/* stack */
.stack{max-width:40em;margin:0 auto;display:flex;flex-direction:column;gap:10px}
.layer{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(13px,2vw,20px) clamp(16px,2.4vw,24px);display:flex;flex-direction:column;gap:3px}
.layer .ly-id{font-family:var(--mono);font-size:clamp(10px,1.3vw,13px);letter-spacing:.12em;color:var(--faint)}
.layer .ly-nm{font-size:clamp(15px,2vw,21px);font-weight:800}
.layer .ly-do{font-size:clamp(11px,1.5vw,14px);color:var(--muted)}
.layer.base{border-color:#3a4a68}
.layer.top{border-color:var(--accent-dim);box-shadow:0 0 40px rgba(46,230,214,.09),inset 0 0 0 1px rgba(46,230,214,.12)}
.layer.top .ly-nm{color:var(--accent)}.layer.top .ly-id{color:var(--accent);opacity:.85}

/* dials */
.dials{display:grid;grid-template-columns:1fr 1fr;gap:clamp(14px,2.4vw,26px)}
.dial{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,2.3vw,24px)}
.dlabel{font-family:var(--mono);font-size:clamp(10px,1.3vw,12px);letter-spacing:.08em;color:var(--muted);margin-bottom:13px}
.dscale{display:flex;justify-content:space-between;gap:6px}
.dscale span{flex:1;text-align:center;font-family:var(--mono);font-size:clamp(10px,1.35vw,13px);color:var(--faint);padding:8px 4px;border:1px solid var(--line);border-radius:6px}
.dscale span.on{color:#04140f;background:var(--accent);border-color:var(--accent);font-weight:700}
.dcap{font-size:clamp(11px,1.5vw,13px);color:var(--muted);margin-top:11px;text-align:center}

/* closing */
.s-close{text-align:center;display:flex;flex-direction:column;align-items:center;gap:clamp(14px,2.4vw,22px)}
.close-line{font-size:clamp(22px,4vw,44px);font-weight:800;line-height:1.12;letter-spacing:-.02em;max-width:18em;text-wrap:balance}
.close-tags{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.ctag{font-family:var(--mono);font-size:clamp(10px,1.35vw,13px);letter-spacing:.04em;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:6px 14px}
.close-sign{font-size:clamp(16px,2.6vw,26px);font-weight:700;color:var(--accent);letter-spacing:-.01em}
`;

/* ----------------------------------------------------------------------- */
function staticSceneHTML(scene,i,total,progressPct){
  return `<!doctype html><html class="static" lang="en"><head><meta charset="utf-8"><style>${CSS}
html,body{width:1280px;height:720px;overflow:hidden;background:#070b13}
.frame{width:1280px;height:720px;padding:26px}.stage{height:668px;aspect-ratio:auto}
.static .canvas{align-items:center;padding-bottom:118px}
</style></head><body><div class="frame"><div class="stage scene active">
  <div class="chrome"><div class="topbar"><div class="wordmark"><b>THE VENTURE FACTORY</b> · std-003</div><div class="counter">${pad(i+1)} / ${pad(total)}</div></div>
  <div class="canvas"><div class="scenebody">${scene.body}</div></div></div>
  <div class="progress"><i style="width:${progressPct}%"></i></div>
</div></div></body></html>`;
}

function playerHTML(){
  const meta = JSON.stringify(SCENES.map(s=>({id:s.id,dur:s.dur,body:s.body})));
  return `<div id="vf-root">
<style>${CSS}
#vf-root{max-width:1060px;margin:0 auto;padding:clamp(14px,3vw,28px)}
.scenewrap{position:relative;width:100%;aspect-ratio:16/9}
.scene{position:absolute;inset:0;opacity:0;transform:scale(1.012);transition:opacity .5s ease,transform .5s ease;pointer-events:none}
.scene.active{opacity:1;transform:none;pointer-events:auto}
.controls{display:flex;align-items:center;gap:13px;margin-top:16px;font-family:var(--mono)}
.btn{background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:9px;padding:9px 14px;font-size:15px;cursor:pointer;font-family:var(--mono);transition:border-color .2s,color .2s}
.btn:hover{border-color:var(--accent);color:var(--accent)}
.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.dots{display:flex;gap:6px;flex:1;flex-wrap:wrap}
.dot{width:10px;height:10px;border-radius:50%;background:#25324b;border:1px solid var(--line);cursor:pointer;padding:0}
.dot.on{background:var(--accent);border-color:var(--accent);box-shadow:0 0 8px var(--accent)}
.dot:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.time{color:var(--faint);font-size:12px;letter-spacing:.06em;min-width:86px;text-align:right}
.voice.off{opacity:.5}
.hint{font-family:var(--mono);font-size:11px;color:var(--faint);letter-spacing:.05em;margin-top:10px;text-align:center}
</style>
<div class="scenewrap"><div class="stage" id="vf-stage">
  <div class="capzone"><div class="spk" id="vf-spk"><span class="eq"><i></i><i></i><i></i></span><span id="vf-spk-t">narrator</span></div><div class="caption2" id="vf-cap"></div></div>
  <div class="chrome" style="pointer-events:none"><div class="topbar"><div class="wordmark"><b>THE VENTURE FACTORY</b> · std-003</div><div class="counter" id="vf-count">01 / 14</div></div></div>
  <div class="progress"><i id="vf-bar"></i></div>
</div></div>
<div class="controls">
  <button class="btn" id="vf-prev" aria-label="Previous">⏮</button>
  <button class="btn" id="vf-play" aria-label="Play or pause" style="min-width:52px">▶</button>
  <button class="btn" id="vf-next" aria-label="Next">⏭</button>
  <div class="dots" id="vf-dots"></div>
  <button class="btn voice" id="vf-voice" aria-label="Mute narration">🔊 voice</button>
  <div class="time" id="vf-time">0:00 / 0:00</div>
</div>
<div class="hint">space play/pause · ← → scenes · V mute</div>
<script>
(function(){
  var SC=${meta}, AUDIO=__AUDIO_DATA__, TM=__TIMINGS_DATA__;
  var stage=document.getElementById('vf-stage'), dotsC=document.getElementById('vf-dots');
  var playB=document.getElementById('vf-play'), timeE=document.getElementById('vf-time'), voiceB=document.getElementById('vf-voice');
  var capE=document.getElementById('vf-cap'), spkE=document.getElementById('vf-spk'), spkT=document.getElementById('vf-spk-t');
  var countE=document.getElementById('vf-count'), barE=document.getElementById('vf-bar');
  var idx=0, playing=false, muted=false, raf=null, t0=0, elapsed=0, au={}, durs={}, curSent=-1, forceT=null;
  function fmt(s){s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

  var SENTS={};
  SC.forEach(function(s,i){
    var t=TM[s.id]; durs[i]=(t&&t.dur)||s.dur; if(!t)return;
    var by={}; t.words.forEach(function(w){(by[w.si]=by[w.si]||[]).push(w);});
    SENTS[s.id]=Object.keys(by).map(function(k){var ws=by[k];return {who:ws[0].who,t0:ws[0].t0,t1:ws[ws.length-1].t1,words:ws};});
  });
  SC.forEach(function(s,i){
    var el=document.createElement('div'); el.className='scene';
    el.innerHTML='<div class="chrome" style="pointer-events:none"><div class="canvas"><div class="scenebody">'+s.body+'</div></div></div>';
    stage.appendChild(el);
    if(AUDIO[s.id]){ var a=new Audio(AUDIO[s.id]); a.preload='auto';
      a.addEventListener('loadedmetadata',function(){ if(isFinite(a.duration)&&a.duration>0){durs[i]=a.duration;} });
      a.addEventListener('ended',function(){ if(playing) next(); }); au[i]=a; }
    var d=document.createElement('button'); d.className='dot'; d.setAttribute('aria-label','Scene '+(i+1)); d.onclick=function(){seek(i);}; dotsC.appendChild(d);
  });
  var scenes=[].slice.call(stage.querySelectorAll('.scene'));
  var dots=[].slice.call(dotsC.querySelectorAll('.dot'));
  function total(){var t=0;for(var k=0;k<SC.length;k++)t+=durs[k];return t;}
  function before(n){var t=0;for(var k=0;k<n;k++)t+=durs[k];return t;}
  function ct(){ if(forceT!=null) return forceT; var a=au[idx];return a&&isFinite(a.currentTime)?a.currentTime:elapsed;}
  function renderCaption(sent){
    curSent=sent?sent.t0:-1;
    if(!sent){capE.innerHTML='';return;}
    spkE.className='spk '+sent.who; spkT.textContent=sent.who==='m'?'narrator · A':'narrator · B';
    capE.innerHTML=sent.words.map(function(w){return '<span class="cap-w '+sent.who+'" data-a="'+w.t0+'" data-b="'+w.t1+'">'+w.w+'</span>';}).join(' ');
  }
  function paintCaption(c){
    var list=SENTS[SC[idx].id]; if(!list){capE.innerHTML='';return;}
    var s=list[0]; for(var k=0;k<list.length;k++){ if(c>=list[k].t0-0.05) s=list[k]; }
    if(s.t0!==curSent) renderCaption(s);
    var ws=capE.children;
    for(var j=0;j<ws.length;j++){ var a=+ws[j].getAttribute('data-a'), b=+ws[j].getAttribute('data-b'), cl=ws[j].className.replace(/ (past|active)/g,'');
      ws[j].className=cl+(c>=b?' past':(c>=a?' active':'')); }
  }
  function paintReveals(c){
    var t=TM[SC[idx].id]; if(!t)return; var turns=t.turns||[];
    var els=scenes[idx].querySelectorAll('[data-cue]');
    for(var j=0;j<els.length;j++){ var k=+els[j].getAttribute('data-cue'); var when=turns[k]!=null?turns[k]:0; if(c>=when-0.02) els[j].classList.add('lit'); }
  }
  function paint(){
    scenes.forEach(function(el,i){el.classList.toggle('active',i===idx);});
    dots.forEach(function(el,i){el.classList.toggle('on',i===idx);});
    countE.textContent=String(idx+1).padStart(2,'0')+' / '+String(SC.length).padStart(2,'0');
    var c=ct(); barE.style.width=Math.min(100,(c/(durs[idx]||1))*100)+'%';
    timeE.textContent=fmt(before(idx)+c)+' / '+fmt(total());
    spkE.classList.toggle('paused',!playing); paintReveals(c); paintCaption(c);
  }
  function stopAll(){for(var k in au){try{au[k].pause();au[k].currentTime=0;}catch(e){}}}
  function clearReveals(){ scenes[idx].querySelectorAll('[data-cue]').forEach(function(e){e.classList.remove('lit');}); }
  function show(i){ idx=(i+SC.length)%SC.length; elapsed=0; curSent=-1; var cur=scenes[idx]; cur.classList.remove('active'); void cur.offsetWidth; clearReveals(); paint(); }
  function startAudio(){ var a=au[idx]; if(a){ a.currentTime=0; a.muted=muted; var p=a.play(); if(p&&p.catch)p.catch(function(){}); } }
  function tick(now){ if(!playing)return; if(!au[idx]){ elapsed=(now-t0)/1000; if(elapsed>=durs[idx]){next();return;} } paint(); raf=requestAnimationFrame(tick); }
  function play(){ if(idx===SC.length-1 && ct()>=durs[idx]-0.05){show(0);} playing=true; playB.textContent='❚❚'; if(au[idx]){startAudio();}else{t0=performance.now()-elapsed*1000;} cancelAnimationFrame(raf); raf=requestAnimationFrame(tick); }
  function pause(){ playing=false; playB.textContent='▶'; cancelAnimationFrame(raf); for(var k in au){try{au[k].pause();}catch(e){}} paint(); }
  function toggle(){ playing?pause():play(); }
  function next(){ if(idx===SC.length-1){pause();playB.textContent='↺';return;} stopAll(); show(idx+1); if(playing){startAudio();raf=requestAnimationFrame(tick);} }
  function seek(i){ stopAll(); show(i); if(playing){startAudio();cancelAnimationFrame(raf);raf=requestAnimationFrame(tick);} }
  playB.onclick=toggle;
  document.getElementById('vf-prev').onclick=function(){seek(idx-1);};
  document.getElementById('vf-next').onclick=function(){seek(idx+1);};
  voiceB.onclick=function(){muted=!muted;voiceB.classList.toggle('off',muted);voiceB.textContent=(muted?'🔈':'🔊')+' voice';for(var k in au)au[k].muted=muted;};
  document.addEventListener('keydown',function(e){ if(e.code==='Space'){e.preventDefault();toggle();} else if(e.code==='ArrowRight'){seek(idx+1);} else if(e.code==='ArrowLeft'){seek(idx-1);} else if(e.key==='v'||e.key==='V'){voiceB.click();} });
  window.VF_STILL=function(gt){
    var acc=0, si=SC.length-1, lt=gt;
    for(var k=0;k<SC.length;k++){ if(gt < acc+durs[k]){ si=k; lt=gt-acc; break; } acc+=durs[k]; }
    playing=false; idx=si; forceT=lt; curSent=-1;
    scenes.forEach(function(el,i){el.classList.toggle('active',i===si);});
    scenes[si].querySelectorAll('[data-cue]').forEach(function(e){e.classList.remove('lit');});
    countE.textContent=String(si+1).padStart(2,'0')+' / '+String(SC.length).padStart(2,'0');
    barE.style.width=Math.min(100,(lt/(durs[si]||1))*100)+'%'; spkE.classList.add('paused');
    paintReveals(lt); paintCaption(lt); document.documentElement.setAttribute('data-still','1');
  };
  var _m=location.search.match(/[?&]t=([0-9.]+)/);
  if(_m){ setTimeout(function(){ window.VF_STILL(parseFloat(_m[1])); }, 40); } else { show(0); }
})();
</script>
</div>`;
}

/* ----------------------------------------------------------------------- */
fs.writeFileSync(path.join(OUT,'player-fragment.html'), playerHTML());
SCENES.forEach(function(s,i){ fs.writeFileSync(path.join(OUT,'scenes','scene-'+pad(i+1)+'.html'), staticSceneHTML(s,i,SCENES.length,Math.round(((i+1)/SCENES.length)*100))); });
fs.writeFileSync(path.join(OUT,'narration.json'), JSON.stringify(SCENES.map((s,i)=>({n:i+1,id:s.id,segments:s.vo})),null,2));
console.log('emitted player-fragment.html + '+SCENES.length+' scene files + narration.json');
