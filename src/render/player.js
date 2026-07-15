'use strict';
/* Config-driven port of reference/renderer.build.js — the interactive player
 * fragment plus the two document wrappers (player.html + record.html). The player
 * JS logic is kept faithful to the reference; only the hardcoded SCENES array,
 * two-voice ('m'/'f') assumptions, and title/wordmark are parameterized. */

const { buildCss } = require('./css');

/* The interactive player fragment. Contains __AUDIO_DATA__ / __TIMINGS_DATA__
 * placeholder tokens which the inject step replaces after synth. */
function playerFragment(config, size, cssString) {
  const W = size.w, H = size.h;
  const scenes = config.scenes;
  const meta = JSON.stringify(scenes.map(s => ({ id: s.id, dur: s.dur, body: s.body })));
  const voicesMeta = JSON.stringify(
    Object.fromEntries(Object.keys(config.voices).map(id => [id, { label: config.voices[id].label || id }]))
  );
  const title = String(config.title || 'narova');
  const nn = String(scenes.length).padStart(2, '0');

  return `<div id="vf-root">
<style>${cssString}
#vf-root{max-width:1060px;margin:0 auto;padding:clamp(14px,3vw,28px)}
.scenewrap{position:relative;width:100%;aspect-ratio:${W}/${H}}
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
  <div class="chrome" style="pointer-events:none"><div class="topbar"><div class="wordmark"><b>${escapeHtml(title)}</b></div><div class="counter" id="vf-count">01 / ${nn}</div></div></div>
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
  var SC=${meta}, VOICES=${voicesMeta}, AUDIO=__AUDIO_DATA__, TM=__TIMINGS_DATA__;
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
    spkE.className='spk '+sent.who; spkT.textContent=(VOICES[sent.who]&&VOICES[sent.who].label)||sent.who;
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

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* Full standalone player document (tokens still present). */
function playerDoc(config, size) {
  const css = buildCss(config.theme || {}, config.voices, size, config.themeCss || '');
  const frag = playerFragment(config, size, css);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escapeHtml(config.title || 'narova')}</title></head>` +
    `<body style="background:#070b13">${frag}</body></html>`;
}

/* The deterministic capture page: same fragment, fixed W×H stage, no controls
 * (LEARNINGS #11/#15). Tokens still present; inject writes empty audio here. */
function recordDoc(config, size) {
  const css = buildCss(config.theme || {}, config.voices, size, config.themeCss || '');
  const frag = playerFragment(config, size, css);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;background:#070b13}` +
    `#vf-root{max-width:none!important;margin:0!important;padding:0!important}` +
    `.controls,.hint{display:none!important}` +
    `.scenewrap{width:${size.w}px!important;height:${size.h}px!important;aspect-ratio:auto!important}` +
    `.stage{border-radius:0!important;border:0!important}` +
    `</style></head><body>${frag}</body></html>`;
}

module.exports = { playerFragment, playerDoc, recordDoc, escapeHtml };
