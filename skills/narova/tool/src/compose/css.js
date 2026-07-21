'use strict';
/* Stylesheet for the generated HyperFrames composition. Ported from the old
 * player theme (src/render/css.js) with every wall-clock animation removed:
 * HyperFrames renders by SEEKING a paused timeline, so CSS animations and
 * transitions would produce nondeterministic frames. Motion now lives on the
 * GSAP timeline (see runtime.js); this file is static styling only. */
const { hexToRgba } = require('../util');

const DEFAULT_TOKENS = {
  bg: '#080d16', stage: '#0b1120', panel: '#111b2e', line: '#223350', ink: '#eaf1fb',
  muted: '#8595b4', faint: '#5d6d8c', accent: '#2ee6d6', 'accent-dim': '#178f86', pink: '#ff7eb6',
  gold: '#ffd27a', green: '#46d98a', red: '#ff6363', amber: '#ffb454',
};

function rootBlock(theme = {}) {
  const t = { ...DEFAULT_TOKENS, ...theme };
  const vars = Object.keys(t).map(k => `  --${k}:${t[k]};`).join('\n');
  return `:root{\n${vars}\n  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;\n  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;\n}`;
}

/* Per-voice speaker-indicator + active-caption-word colors. */
function voiceBlock(voices = {}) {
  return Object.keys(voices).map(id => {
    const color = voices[id].color || 'var(--accent)';
    return `.spk.${id} .eq i{background:${color}}\n` +
      `.cap-w.${id}.active{color:${color};text-shadow:0 0 18px ${hexToRgba(color, 0.5)}}`;
  }).join('\n');
}

/* Static composition CSS. W/H are the exact pixel frame size — the root MUST be
 * px-sized or HyperFrames renders a collapsed frame (silent failure).
 * `t` is the merged theme tokens: the background glows derive from them so a
 * custom palette never gets the default teal/pink stage lights. */
function staticCss(W, H, t = DEFAULT_TOKENS) {
  return `*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}

#root{position:relative;width:${W}px;height:${H}px;overflow:hidden}
/* Background lives on a full-bleed CHILD, never on the root itself — the
 * HyperFrames producer can drop the root element's own background (renders
 * black) even though preview shows it. */
#bg{position:absolute;inset:0;z-index:0;pointer-events:none;background:
   radial-gradient(120% 90% at 50% 0%, #10203a 0%, var(--stage) 45%, #070b13 100%)}
#bg::before{content:"";position:absolute;inset:0;
   background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
   background-size:44px 44px;opacity:.05}
#bg::after{content:"";position:absolute;inset:-30%;
   background:radial-gradient(38% 38% at 28% 18%, ${hexToRgba(t.accent, 0.13)}, transparent 70%),
              radial-gradient(42% 42% at 78% 82%, ${hexToRgba(t.pink, 0.10)}, transparent 70%),
              radial-gradient(36% 36% at 62% 40%, ${hexToRgba(t.gold, 0.06)}, transparent 70%)}

/* clips */
.scene{position:absolute;inset:0;z-index:1}
.overlay{position:absolute;inset:0;z-index:5;pointer-events:none}

.chrome{position:absolute;inset:0;padding:clamp(16px,3.1vw,32px);display:flex;flex-direction:column;z-index:3}
.topbar{display:flex;justify-content:space-between;align-items:flex-start;font-family:var(--mono);font-size:clamp(9px,1.15vw,12px);letter-spacing:.14em;color:var(--faint)}
.wordmark b{color:var(--muted);font-weight:600}
.counter{color:var(--accent);opacity:.85}
.canvas{flex:1;display:flex;align-items:center;justify-content:center;min-height:0}
.scenebody{width:100%;max-width:1000px;display:flex;flex-direction:column;align-items:stretch}
.progress{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.06);z-index:6}
.progress > i{display:block;height:100%;width:100%;transform:scaleX(0);transform-origin:left center;background:linear-gradient(90deg,var(--accent-dim),var(--accent));box-shadow:0 0 12px var(--accent)}

/* reveals: static baselines only — motion is timeline tweens (runtime.js) */
.reveal,.cue{opacity:0}

.grad{background:linear-gradient(92deg,var(--accent),#7ef0ff 40%,var(--pink) 80%,var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent;background-size:220% auto}

/* captions: groups stack on one band, timeline toggles their opacity */
.capzone{position:absolute;left:0;right:0;bottom:3px;z-index:5;padding:0 6% 22px}
.cap-group{position:absolute;left:6%;right:6%;bottom:22px;display:flex;flex-direction:column;align-items:center;gap:10px;opacity:0}
.spk{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:clamp(9px,1.05vw,11px);letter-spacing:.18em;color:var(--muted);text-transform:uppercase}
.spk .eq{display:inline-flex;gap:2px;align-items:flex-end;height:12px}
.spk .eq i{width:3px;background:var(--accent);border-radius:1px}
.spk .eq i:nth-child(1){height:6px}.spk .eq i:nth-child(2){height:11px}.spk .eq i:nth-child(3){height:8px}
.caption2{font-size:clamp(17px,2.7vw,30px);font-weight:800;line-height:1.28;letter-spacing:-.01em;text-align:center;max-width:24em;text-wrap:balance}
.cap-w{display:inline-block;margin:0 .13em;color:#5f6f8e;opacity:.6}
.cap-w.past{color:var(--ink);opacity:.9}
.cap-w.active{opacity:1;transform:translateY(-2px) scale(1.05)}

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
.spin{display:inline-block;color:var(--accent)}
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
.close-sign{font-size:clamp(16px,2.6vw,26px);font-weight:700;color:var(--accent);letter-spacing:-.01em}`;
}

/* Full stylesheet for the composition. `extraCss` is the project theme.css,
 * appended last so it can add or override scene-layout classes. */
function composeCss(theme, voices, size, extraCss = '') {
  const t = { ...DEFAULT_TOKENS, ...theme };
  const base = `${rootBlock(theme)}\n${staticCss(size.w, size.h, t)}\n${voiceBlock(voices)}`;
  return extraCss ? `${base}\n${extraCss}` : base;
}

module.exports = { composeCss, DEFAULT_TOKENS };
