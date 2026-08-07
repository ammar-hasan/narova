'use strict';
/* Stylesheet for the generated HyperFrames composition. Ported from the old
 * player theme (src/render/css.js) with every wall-clock animation removed:
 * HyperFrames renders by SEEKING a paused timeline, so CSS animations and
 * transitions would produce nondeterministic frames. Motion now lives on the
 * GSAP timeline (see runtime.js); this file is static styling only.
 *
 * Architecture:
 *   staticCss()  → production infrastructure (background, chrome, captions,
 *                  walkthrough, reveals, marks). Always included.
 *   PATTERNS_CSS → optional layout patterns (.s-title, .pane, .stat, .flow,
 *                  .verdicts, .s-close, etc.). Opt-in via config.patterns
 *                  or project theme.css. Not a default visual language. */
const { hexToRgba } = require('../util');

const DEFAULT_TOKENS = {
  bg: '#101010', stage: '#181818', panel: '#242424', line: '#333333', ink: '#e8e8e8',
  muted: '#8a8a8a', faint: '#5c5c5c', accent: '#888888', 'accent-dim': '#555555', pink: '#d4789a',
  gold: '#c4a354', green: '#588c64', red: '#b05353', amber: '#b07d4a',
  deep: '#0a0a0a', halo: '#1e1e1e', chip: '#161616', capidle: '#6e6e6e',
  onaccent: '#f0f0f0', track: 'rgba(255,255,255,.06)',
};

const LIGHT_TOKENS = {
  bg: '#f5f5f5', stage: '#ebebeb', panel: '#ffffff', line: '#dbdbdb', ink: '#1a1a1a',
  muted: '#6e6e6e', faint: '#8a8a8a',
  deep: '#e0e0e0', halo: '#ededed', chip: '#f0f0f0', capidle: '#9e9e9e',
  onaccent: '#ffffff', track: 'rgba(0,0,0,.06)',
};

function rootBlock(t) {
  const vars = Object.keys(t).map(k => `  --${k}:${t[k]};`).join('\n');
  return `:root{\n${vars}\n  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;\n  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;\n}`;
}

function voiceBlock(voices = {}) {
  return Object.keys(voices).map(id => {
    const color = voices[id].color || 'var(--accent)';
    return `.spk.${id} .eq i{background:${color}}\n` +
      `.cap-w.${id}.active{color:${color};text-shadow:0 0 18px ${hexToRgba(color, 0.5)}}`;
  }).join('\n');
}

/* Caption-preset overrides that must come AFTER voiceBlock() in source order.
 *
 * subtitle is the default and is meant to be a genuinely PLAIN readable
 * treatment — not Narova karaoke in disguise. So in subtitle mode:
 *   - the speaker label + equalizer bar are hidden (they are the loudest
 *     karaoke signal), and
 *   - active/past/upcoming words all render as plain ink with no glow.
 * voiceBlock() emits `.cap-w.<voice>.active{color;text-shadow}` at specificity
 * (0,3,0); these `.cap-preset-subtitle .cap-w.active` rules are also (0,3,0) so
 * source order decides — emitting them last makes subtitle win. The richer
 * speaker-colored behavior is preserved for the explicit karaoke/slam/pop/rise
 * presets (their authors opted into the karaoke look). */
function presetOverridesCss() {
  return `.cap-preset-subtitle .spk{display:none}
.cap-preset-subtitle .cap-w,
.cap-preset-subtitle .cap-w.past,
.cap-preset-subtitle .cap-w.active{color:var(--ink);opacity:.92;text-shadow:none}`;
}

/* ---- production infrastructure (always included) -------------------------- */

function staticCss(W, H, t = DEFAULT_TOKENS, captionsEnabled = true) {
  return `*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}

#root{position:relative;width:${W}px;height:${H}px;overflow:hidden}
#bg{position:absolute;inset:0;z-index:0;pointer-events:none;background:var(--stage)}

/* clips */
.scene{position:absolute;inset:0;z-index:1}
.broll{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:.52;pointer-events:none}
.walkthrough-media{position:absolute;z-index:0;pointer-events:none;opacity:var(--walkthrough-opacity,1);object-position:var(--walkthrough-position,50% 50%);background:#05070b}
.walkthrough-full{inset:0;width:100%;height:100%}
.walkthrough-window{left:4.5%;right:4.5%;top:calc(5% + clamp(30px,4.5vw,44px));bottom:var(--walkthrough-bottom,clamp(112px,20vh,190px));width:91%;height:calc(95% - clamp(30px,4.5vw,44px) - var(--walkthrough-bottom,clamp(112px,20vh,190px)));border-radius:0 0 clamp(10px,1.6vw,18px) clamp(10px,1.6vw,18px)}
.walkthrough-shell{position:absolute;left:4.5%;right:4.5%;top:5%;bottom:var(--walkthrough-bottom,clamp(112px,20vh,190px));z-index:2;border:1px solid rgba(255,255,255,.24);border-radius:clamp(10px,1.6vw,18px);box-shadow:0 20px 70px rgba(0,0,0,.38);pointer-events:none;overflow:hidden}
.scene.walkthrough-layout-full::after{content:"";position:absolute;left:0;right:0;bottom:0;height:34%;z-index:2;pointer-events:none;background:linear-gradient(180deg,transparent 0%,rgba(3,7,14,.72) 68%,rgba(3,7,14,.92) 100%)}
.walkthrough-titlebar{height:clamp(30px,4.5vw,44px);display:grid;grid-template-columns:auto 1fr auto;gap:clamp(8px,1.3vw,16px);align-items:center;padding:0 clamp(10px,1.5vw,16px);font-family:var(--mono);font-size:clamp(8px,1vw,11px);letter-spacing:.04em;color:var(--muted);background:color-mix(in srgb,var(--panel) 94%,transparent);border-bottom:1px solid rgba(255,255,255,.15)}
.walkthrough-titlebar small{font:inherit;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.walkthrough-dots{display:flex;gap:clamp(4px,.55vw,6px)}
.walkthrough-dots i{display:block;width:clamp(6px,.75vw,9px);height:clamp(6px,.75vw,9px);border-radius:50%;background:var(--faint)}
.walkthrough-dots i:first-child{background:var(--red)}.walkthrough-dots i:nth-child(2){background:var(--amber)}.walkthrough-dots i:last-child{background:var(--green)}
.overlay{position:absolute;inset:0;z-index:5;pointer-events:none}

.chrome{position:absolute;inset:0;padding:clamp(16px,3.1vw,32px);display:flex;flex-direction:column;z-index:3}
.topbar{display:flex;justify-content:space-between;align-items:flex-start;font-family:var(--mono);font-size:clamp(9px,1.15vw,12px);letter-spacing:.14em;color:var(--faint)}
.wordmark b{color:var(--muted);font-weight:600}
.counter{color:var(--accent);opacity:.85}
.canvas{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;padding-bottom:${captionsEnabled ? 'var(--cap-pad, clamp(84px,15vh,170px))' : '0'}}
.scenebody{width:100%;max-width:var(--colw,1000px);display:flex;flex-direction:column;align-items:stretch}
.progress{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--track);z-index:6}
.progress > i{display:block;height:100%;width:100%;transform:scaleX(0);transform-origin:left center;background:linear-gradient(90deg,var(--accent-dim),var(--accent));box-shadow:0 0 12px var(--accent)}
.series-badge{position:absolute;top:clamp(10px,2vw,20px);right:clamp(10px,2vw,32px);font-family:var(--mono);font-size:clamp(10px,1.3vw,13px);letter-spacing:.1em;color:var(--accent);background:rgba(0,0,0,.38);border:1px solid var(--accent-dim);border-radius:6px;padding:5px 13px;z-index:10}

/* reveals: static baselines only — motion is timeline tweens (runtime.js) */
.reveal,.cue{opacity:0}

/* captions */
.capzone{position:absolute;left:0;right:0;bottom:3px;z-index:5;padding:0 6% var(--cap-gap, 22px)}
.cap-group{position:absolute;left:6%;right:6%;bottom:22px;display:flex;flex-direction:column;align-items:center;gap:10px;opacity:0}
.spk{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:clamp(9px,1.05vw,11px);letter-spacing:.18em;color:var(--muted);text-transform:uppercase}
.spk .eq{display:inline-flex;gap:2px;align-items:flex-end;height:12px}
.spk .eq i{width:3px;background:var(--accent);border-radius:1px}
.spk .eq i:nth-child(1){height:6px}.spk .eq i:nth-child(2){height:11px}.spk .eq i:nth-child(3){height:8px}
.caption2{font-size:clamp(17px,2.7vw,30px);font-weight:800;line-height:1.28;letter-spacing:-.01em;text-align:center;max-width:24em;text-wrap:balance}
.cap-w{display:inline-block;margin:0 .13em;color:var(--capidle);opacity:.6}
.cap-w.past{color:var(--ink);opacity:.85}
.cap-w.active{opacity:1;color:var(--ink)}
/* subtitle preset neutrality lives in presetOverridesCss() (emitted after
   voiceBlock) so it wins the equal-specificity tie with per-voice active word
   rules — otherwise subtitle words still pick up speaker colors and glow. */
.cap-preset-karaoke .cap-w.active{color:inherit;transform:translateY(-2px) scale(1.05)}
.cap-preset-slam .cap-w.active{font-weight:900}
.cap-preset-pop .cap-w{opacity:.35}
.cap-preset-rise .cap-w.active{transform:translateY(-3px);box-shadow:0 .1em 0 currentColor}
.cap-w.kw{font-size:1.06em;text-decoration:underline;text-decoration-color:var(--accent);text-decoration-thickness:.09em;text-underline-offset:.16em}

/* marks (data-mark annotations) */
.marklayer{position:absolute;inset:0;pointer-events:none}
.marklayer .mark{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.marklayer .mark2{opacity:.55;stroke-width:1.75}
.marklayer .markhl{fill:var(--accent);opacity:.26}

/* furniture (small shared elements used by patterns) */
.eyebrow{font-family:var(--mono);font-size:clamp(10px,1.15vw,12px);letter-spacing:.26em;color:var(--accent);text-transform:uppercase}
.accent{color:var(--accent)}
.small{font-family:var(--mono);font-size:clamp(11px,1.4vw,14px);color:var(--faint);letter-spacing:.08em}

/* 3D */
.narova-three-scene{position:absolute;inset:0;z-index:0;pointer-events:none}
.narova-three-canvas{position:absolute;inset:0;width:100%;height:100%;display:block}`;
}

/* ---- optional layout patterns (opt-in via config.patterns) ---------------- */

function patternsCss(t) { return `/* Narova layout patterns — optional. Include via config.patterns: true or import in theme.css.
 * These are tools, not a visual language. Use them deliberately where they
 * serve the concept; build custom layouts when the video needs its own voice. */

.s-head{font-family:var(--mono);font-size:clamp(11px,1.5vw,15px);letter-spacing:.04em;color:var(--muted);text-align:center;margin-bottom:clamp(14px,2.4vw,24px)}
.s-head .eyebrow{margin-right:.4em}
.s-foot{font-family:var(--mono);font-size:clamp(10px,1.3vw,13px);letter-spacing:.05em;color:var(--faint);text-align:center;margin-top:clamp(14px,2.2vw,22px)}
.s-foot.warn{color:var(--red);opacity:.92}.s-foot.ok{color:var(--green);opacity:.92}.s-foot b{color:var(--ink)}

.s-title{text-align:center;display:flex;flex-direction:column;align-items:center;gap:clamp(12px,2vw,18px)}
.display{font-size:clamp(38px,8vw,82px);font-weight:800;line-height:.96;letter-spacing:-.03em;text-wrap:balance}
.lede{font-size:clamp(14px,2vw,21px);color:var(--muted);max-width:20em;text-wrap:balance}

.s-two{display:grid;grid-template-columns:1fr 1fr;gap:clamp(14px,2.4vw,28px);align-items:stretch}
.pane{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,2.4vw,26px);display:flex;flex-direction:column;gap:12px}
.pane.center{align-items:center;justify-content:center;text-align:center}
.loop-chip{font-family:var(--mono);font-size:clamp(11px,1.5vw,15px);color:var(--ink);background:var(--chip);border:1px solid var(--line);border-radius:999px;padding:8px 14px;align-self:flex-start}
.spin{display:inline-block;color:var(--accent)}

.stat{font-size:clamp(50px,10.5vw,112px);font-weight:800;letter-spacing:-.04em;color:var(--red);line-height:1}
.stat .pct{font-size:.5em;vertical-align:super}
.stat-cap{font-size:clamp(12px,1.6vw,15px);color:var(--muted);margin-top:8px;text-wrap:balance}

.s-center{text-align:center;display:flex;flex-direction:column;align-items:center;gap:clamp(16px,3vw,28px)}
.bigquote{font-size:clamp(24px,5vw,54px);font-weight:700;line-height:1.08;letter-spacing:-.02em;max-width:15em;text-wrap:balance}

.flags{list-style:none;display:flex;flex-direction:column;gap:9px;margin-top:2px}
.flags li{font-size:clamp(14px,1.9vw,19px);color:var(--ink);padding-left:26px;position:relative}
.flags li::before{content:"⚠";position:absolute;left:0;color:var(--amber)}

.owners{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(12px,2.2vw,22px)}
.owner{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,2.3vw,26px);text-align:center;display:flex;flex-direction:column;gap:7px}
.owner .who{font-size:clamp(15px,2vw,20px);font-weight:700}
.owner .owns{font-family:var(--mono);font-size:11px;letter-spacing:.2em;color:var(--faint);text-transform:uppercase}
.owner .what{font-size:clamp(18px,2.5vw,29px);font-weight:800}
.owner .gloss{font-size:clamp(11px,1.5vw,14px);color:var(--muted);text-wrap:balance}
.owner.accent-owner{border-color:var(--accent-dim);box-shadow:inset 0 0 0 1px ${hexToRgba(t.accent, 0.12)}}
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
.step{font-family:var(--mono);font-size:clamp(12px,1.6vw,16px);background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:8px 13px;color:var(--ink)}
.sep{color:var(--accent);opacity:.7}.loopback{color:var(--accent);font-size:1.4em;margin-left:6px}
.verdicts{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(10px,2vw,18px)}
.verdict{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(14px,2.1vw,22px);border-left-width:4px}
.verdict.green{border-left-color:var(--green)}.verdict.red{border-left-color:var(--red)}.verdict.amber{border-left-color:var(--amber)}
.vname{font-size:clamp(15px,2vw,20px);font-weight:700;margin-bottom:5px}
.vact{font-size:clamp(11px,1.5vw,14px);color:var(--muted);text-wrap:balance}

.flow{display:flex;align-items:stretch;justify-content:center;gap:clamp(4px,.8vw,10px);flex-wrap:nowrap}
.lane{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(12px,1.8vw,20px) clamp(8px,1.4vw,16px);text-align:center;min-width:0;flex:1;display:flex;flex-direction:column;gap:5px;justify-content:center}
.lane .ln{font-family:var(--mono);font-size:clamp(11px,1.5vw,15px);font-weight:700;letter-spacing:.04em}
.lane .lr{font-size:clamp(10px,1.25vw,12px);color:var(--muted)}
.lane.accent-lane{border-color:var(--accent-dim);box-shadow:inset 0 0 0 1px ${hexToRgba(t.accent, 0.14)}}
.lane.accent-lane .ln{color:var(--accent)}
.conn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex:0 0 auto;padding:0 2px}
.conn .carr{color:var(--accent);font-size:clamp(12px,1.6vw,17px);text-shadow:0 0 10px ${hexToRgba(t.accent, 0.6)}}
.conn .clab{font-family:var(--mono);font-size:clamp(8px,1.05vw,11px);letter-spacing:.05em;color:var(--faint)}
.flow-return{text-align:center;margin-top:clamp(16px,2.4vw,26px);font-family:var(--mono);font-size:clamp(12px,1.6vw,16px);color:var(--muted)}
.flow-return .ret{color:var(--accent)}.flow-return .okc{color:var(--green)}

.referee{max-width:38em;margin:0 auto;background:var(--panel);border:1px solid var(--accent-dim);border-radius:16px;padding:clamp(20px,3vw,34px);text-align:center;box-shadow:0 0 60px ${hexToRgba(t.accent, 0.07)},inset 0 0 0 1px ${hexToRgba(t.accent, 0.08)}}
.seal{font-size:clamp(30px,5vw,50px);line-height:1}
.rtitle{font-size:clamp(18px,2.5vw,25px);font-weight:700;margin:8px 0 16px}
.rnotes{display:grid;grid-template-columns:1fr 1fr;gap:clamp(10px,2vw,18px)}
.rnote{background:var(--chip);border:1px solid var(--line);border-radius:10px;padding:14px}
.rnote b{display:block;color:var(--accent);font-size:clamp(12px,1.6vw,16px);margin-bottom:4px}
.rnote span{font-size:clamp(11px,1.4vw,13px);color:var(--muted);text-wrap:balance}

.ledger{max-width:34em;margin:0 auto;display:flex;flex-direction:column;gap:8px}
.rec{font-family:var(--mono);font-size:clamp(12px,1.6vw,16px);background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--accent-dim);border-radius:8px;padding:12px 16px}
.rec.faded{opacity:.5}

.desk{max-width:32em;margin:0 auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.desk-tag{font-family:var(--mono);font-size:11px;letter-spacing:.22em;color:var(--faint);background:var(--chip);padding:10px 16px;border-bottom:1px solid var(--line)}
.ask{display:flex;justify-content:space-between;align-items:center;font-size:clamp(13px,1.9vw,18px);padding:13px 16px;border-bottom:1px solid var(--line)}
.ask:last-child{border-bottom:0}
.wait{font-family:var(--mono);font-size:11px;letter-spacing:.1em;color:var(--amber);border:1px solid rgba(255,180,84,.35);border-radius:999px;padding:3px 10px}

.stack{max-width:40em;margin:0 auto;display:flex;flex-direction:column;gap:10px}
.layer{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(13px,2vw,20px) clamp(16px,2.4vw,24px);display:flex;flex-direction:column;gap:3px}
.layer .ly-id{font-family:var(--mono);font-size:clamp(10px,1.3vw,13px);letter-spacing:.12em;color:var(--faint)}
.layer .ly-nm{font-size:clamp(15px,2vw,21px);font-weight:800}
.layer .ly-do{font-size:clamp(11px,1.5vw,14px);color:var(--muted)}
.layer.base{border-color:#3a4a68}
.layer.top{border-color:var(--accent-dim);box-shadow:0 0 40px ${hexToRgba(t.accent, 0.09)},inset 0 0 0 1px ${hexToRgba(t.accent, 0.12)}}
.layer.top .ly-nm{color:var(--accent)}.layer.top .ly-id{color:var(--accent);opacity:.85}

.dials{display:grid;grid-template-columns:1fr 1fr;gap:clamp(14px,2.4vw,26px)}
.dial{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(16px,2.3vw,24px)}
.dlabel{font-family:var(--mono);font-size:clamp(10px,1.3vw,12px);letter-spacing:.08em;color:var(--muted);margin-bottom:13px}
.dscale{display:flex;justify-content:space-between;gap:6px}
.dscale span{flex:1;text-align:center;font-family:var(--mono);font-size:clamp(10px,1.35vw,13px);color:var(--faint);padding:8px 4px;border:1px solid var(--line);border-radius:6px}
.dscale span.on{color:var(--onaccent);background:var(--accent);border-color:var(--accent);font-weight:700}
.dcap{font-size:clamp(11px,1.5vw,13px);color:var(--muted);margin-top:11px;text-align:center}

.s-close{text-align:center;display:flex;flex-direction:column;align-items:center;gap:clamp(14px,2.4vw,22px)}
.close-line{font-size:clamp(22px,4vw,44px);font-weight:800;line-height:1.12;letter-spacing:-.02em;max-width:18em;text-wrap:balance}
.close-tags{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.ctag{font-family:var(--mono);font-size:clamp(10px,1.35vw,13px);letter-spacing:.04em;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:6px 14px}
.close-sign{font-size:clamp(16px,2.6vw,26px);font-weight:700;color:var(--accent);letter-spacing:-.01em}`;
}

/* ---- stylesheet assembly -------------------------------------------------- */

function composeCss(theme, voices, size, extraCss = '', mode = 'dark', captionsEnabled = true, includePatterns = true) {
  const base = mode === 'light' ? { ...DEFAULT_TOKENS, ...LIGHT_TOKENS } : DEFAULT_TOKENS;
  const t = { ...base, ...theme };
  const parts = [
    rootBlock(t),
    staticCss(size.w, size.h, t, captionsEnabled),
    voiceBlock(voices),
    presetOverridesCss(),
  ];
  if (includePatterns) parts.push(patternsCss(t));
  const out = parts.join('\n');
  return extraCss ? `${out}\n${extraCss}` : out;
}

module.exports = { composeCss, patternsCss, presetOverridesCss, DEFAULT_TOKENS, LIGHT_TOKENS };
