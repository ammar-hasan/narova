/* narova — landing page interactions.
   Progressive enhancement: without JS the page is fully readable. */
(function () {
  "use strict";

  var REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var TOUCH = window.matchMedia("(pointer: coarse)").matches;
  var hasGsap = typeof window.gsap !== "undefined";

  if (hasGsap && window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  /* ---------------- smooth scroll (Lenis) ---------------- */
  if (!REDUCED && hasGsap && typeof window.Lenis !== "undefined") {
    var lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1.0 });
    window.lenis = lenis;
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href");
        if (id.length > 1 && document.querySelector(id)) {
          e.preventDefault();
          lenis.scrollTo(id, { offset: -20 });
        }
      });
    });
  }

  /* ---------------- custom cursor ---------------- */
  if (!TOUCH && !REDUCED) {
    var dot = document.querySelector(".cursor-dot");
    var ring = document.querySelector(".cursor-ring");
    var mx = -100, my = -100, rx = -100, ry = -100;
    window.addEventListener("pointermove", function (e) { mx = e.clientX; my = e.clientY; });
    (function loop() {
      rx += (mx - rx) * 0.16; ry += (my - ry) * 0.16;
      dot.style.transform = "translate(" + (mx - 4) + "px," + (my - 4) + "px)";
      var half = ring.classList.contains("is-hover") ? 28 : 18;
      ring.style.transform = "translate(" + (rx - half) + "px," + (ry - half) + "px)";
      requestAnimationFrame(loop);
    })();
    document.querySelectorAll("[data-hover]").forEach(function (el) {
      el.addEventListener("pointerenter", function () { ring.classList.add("is-hover"); });
      el.addEventListener("pointerleave", function () { ring.classList.remove("is-hover"); });
    });
  } else {
    var c1 = document.querySelector(".cursor-dot"), c2 = document.querySelector(".cursor-ring");
    if (c1) c1.style.display = "none";
    if (c2) c2.style.display = "none";
  }

  /* ---------------- hero title: char reveal ---------------- */
  if (!REDUCED && hasGsap) {
    document.querySelectorAll(".ht-line:not(.grad)").forEach(function (line) {
      var text = line.textContent;
      line.textContent = "";
      var accessible = document.createElement("span");
      accessible.className = "visually-hidden";
      accessible.textContent = text;
      line.appendChild(accessible);
      text.trim().split(/\s+/).forEach(function (word, wordIndex) {
        if (wordIndex > 0) line.appendChild(document.createTextNode(" "));
        var wordSpan = document.createElement("span");
        wordSpan.className = "word";
        wordSpan.setAttribute("aria-hidden", "true");
        word.split("").forEach(function (ch) {
          var s = document.createElement("span");
          s.className = "char";
          s.textContent = ch;
          wordSpan.appendChild(s);
        });
        line.appendChild(wordSpan);
      });
    });
    if (document.querySelector(".ht-line .char")) {
      gsap.from(".ht-line .char", {
        yPercent: 110, opacity: 0, rotateX: -50,
        duration: 0.9, ease: "power4.out", stagger: 0.018, delay: 0.15
      });
    }
    /* gradient line animates as one block: per-char transforms break
       background-clip:text compositing in Chrome */
    if (document.querySelector(".ht-line.grad")) {
      gsap.from(".ht-line.grad", {
        y: 60, opacity: 0, duration: 1.1, ease: "power4.out", delay: 0.5
      });
    }
    if (document.querySelector(".reveal-line")) {
      gsap.from(".reveal-line", {
        y: 26, opacity: 0, duration: 0.9, ease: "power3.out", stagger: 0.12, delay: 0.55
      });
    }
  }

  /* ---------------- scroll progress ---------------- */
  if (hasGsap && window.ScrollTrigger) {
    gsap.to("#progressBar", {
      scaleX: 1, ease: "none",
      scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 0.3 }
    });
  }

  /* ---------------- section titles + generic reveals ---------------- */
  if (!REDUCED && hasGsap && window.ScrollTrigger) {
    document.querySelectorAll(".sr-title").forEach(function (el) {
      gsap.from(el, {
        y: 56, opacity: 0, duration: 1.0, ease: "power3.out",
        scrollTrigger: { trigger: el, start: "top 85%" }
      });
    });
    if (document.querySelector(".bento")) {
      gsap.from(".card", {
        y: 44, opacity: 0, duration: 0.85, ease: "power3.out", stagger: 0.09,
        scrollTrigger: { trigger: ".bento", start: "top 82%" }
      });
    }
    if (document.querySelector(".steps")) {
      gsap.from(".step", {
        y: 44, opacity: 0, duration: 0.85, ease: "power3.out", stagger: 0.14,
        scrollTrigger: { trigger: ".steps", start: "top 82%" }
      });
    }
    if (document.querySelector(".terminal")) {
      gsap.from(".terminal", {
        y: 44, opacity: 0, duration: 0.9, ease: "power3.out",
        scrollTrigger: { trigger: ".terminal", start: "top 85%" }
      });
    }
  }

  /* ---------------- video: 3D scroll-in ---------------- */
  if (!REDUCED && !TOUCH && hasGsap && window.ScrollTrigger
      && document.querySelector("#videoCard")) {
    gsap.set("#videoCard", { transformPerspective: 1200, rotateX: 22, scale: 0.82, transformOrigin: "50% 100%" });
    gsap.to("#videoCard", {
      rotateX: 0, scale: 1, ease: "none",
      scrollTrigger: { trigger: ".video-section", start: "top 85%", end: "top 15%", scrub: 0.5 }
    });
  }

  /* ---------------- marquee ---------------- */
  if (!REDUCED && hasGsap) {
    var track = document.getElementById("marqueeTrack");
    if (track) {
      track.innerHTML = track.innerHTML + track.innerHTML + track.innerHTML + track.innerHTML;
      gsap.to(track, { xPercent: -50, ease: "none", duration: 26, repeat: -1 });
    }
  }

  /* ---------------- steps connecting line ---------------- */
  if (hasGsap) {
    var path = document.getElementById("stepsPath");
    if (path) {
      var len = path.getTotalLength();
      path.style.strokeDasharray = len;
      if (!REDUCED && window.ScrollTrigger) {
        path.style.strokeDashoffset = len;
        gsap.to(path, {
          strokeDashoffset: 0, ease: "none",
          scrollTrigger: { trigger: ".steps", start: "top 80%", end: "top 35%", scrub: 0.5 }
        });
      }
    }
  }

  /* ---------------- wave bars: heights + offsets ---------------- */
  document.querySelectorAll(".wave-bars span").forEach(function (s, i) {
    s.style.height = (22 + Math.abs(Math.sin(i * 1.7)) * 74) + "%";
    s.style.animationDelay = (i * 0.13) + "s";
  });

  /* ---------------- karaoke demo ---------------- */
  (function karaoke() {
    var box = document.getElementById("karaoke");
    if (!box) return;
    var script = [
      { who: "a", label: "host · A", text: "Wait — the video builds itself?" },
      { who: "b", label: "host · B", text: "Every word lands right on the beat." },
      { who: "a", label: "host · A", text: "No timeline. No keyframes." },
      { who: "b", label: "host · B", text: "Just a prompt." }
    ];
    var spans = [];
    script.forEach(function (turn) {
      var lab = document.createElement("span");
      lab.className = "speaker spk-" + turn.who;
      lab.textContent = turn.label;
      box.appendChild(lab);
      turn.text.split(" ").forEach(function (w) {
        var s = document.createElement("span");
        s.className = "w";
        s.textContent = w;
        s.dataset.who = turn.who;
        box.appendChild(s);
        spans.push(s);
      });
    });
    if (REDUCED) {
      spans.forEach(function (s) {
        s.classList.add("on-" + s.dataset.who);
      });
      return;
    }
    var i = 0;
    function tick() {
      if (i < spans.length) {
        spans[i].classList.add("on-" + spans[i].dataset.who);
        i++;
        setTimeout(tick, REDUCED ? 0 : 290);
      } else {
        setTimeout(function () {
          spans.forEach(function (s) { s.className = "w"; });
          i = 0;
          setTimeout(tick, 700);
        }, 2200);
      }
    }
    setTimeout(tick, 1200);
  })();

  /* ---------------- magnetic buttons ---------------- */
  if (!TOUCH && !REDUCED && hasGsap) {
    document.querySelectorAll(".magnetic").forEach(function (el) {
      var strength = 0.32;
      el.addEventListener("pointermove", function (e) {
        var r = el.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        gsap.to(el, { x: dx * strength, y: dy * strength, duration: 0.4, ease: "power3.out" });
      });
      el.addEventListener("pointerleave", function () {
        gsap.to(el, { x: 0, y: 0, duration: 0.7, ease: "elastic.out(1, 0.35)" });
      });
    });
  }

  /* ---------------- bento tilt + spotlight ---------------- */
  if (!TOUCH && !REDUCED && hasGsap) {
    document.querySelectorAll(".tilt").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        card.style.setProperty("--mx", px * 100 + "%");
        card.style.setProperty("--my", py * 100 + "%");
        gsap.to(card, {
          rotateY: (px - 0.5) * 7, rotateX: (0.5 - py) * 7,
          transformPerspective: 900, duration: 0.5, ease: "power2.out"
        });
      });
      card.addEventListener("pointerleave", function () {
        gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.8, ease: "elastic.out(1, 0.45)" });
      });
    });
  }

  /* ---------------- copy buttons ---------------- */
  function bindCopy(btnId, text, label) {
    var btn = typeof btnId === "string" ? document.getElementById(btnId) : btnId;
    if (!btn) return;
    btn.addEventListener("click", function () {
      var copyText = typeof text === "function" ? text() : text;
      function done() {
        if (label) {
          var old = label.textContent;
          label.textContent = "copied!";
          btn.classList.add("copied");
          setTimeout(function () { label.textContent = old; btn.classList.remove("copied"); }, 1600);
        } else {
          var oldT = btn.textContent;
          btn.textContent = "copied!";
          setTimeout(function () { btn.textContent = oldT; }, 1600);
        }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(copyText).then(done, done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = copyText; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta); done();
      }
    });
  }
  var INSTALL = "npx skills add ammar-hasan/narova --skill narova -g";
  bindCopy("copyInstall", INSTALL, document.querySelector("#copyInstall .copy-label"));
  bindCopy("copyInstall2", INSTALL, document.querySelector("#copyInstall2 .copy-label"));
  bindCopy(
    "copyOpenAI",
    "npx skills add ammar-hasan/narova --skill narova-openai -g",
    document.getElementById("copyOpenAILabel")
  );
  bindCopy(
    "copyEleven",
    "npx skills add ammar-hasan/narova --skill narova-elevenlabs -g",
    document.getElementById("copyElevenLabel")
  );
  document.querySelectorAll("[data-copy-command]").forEach(function (button) {
    bindCopy(button, button.getAttribute("data-copy-command"), null);
  });

  var PROMPT_EXAMPLES = {
    idea: {
      mode: "# idea → video",
      prompt: "Make a 45-second vertical explainer about why starting small makes habits easier to keep. Make it warm and practical, and show me a preview before rendering.",
      reply: "I’ll use one warm narrator, a calm visual rhythm, and simple step-by-step scenes. I’ll keep the language practical and show you the vertical preview first."
    },
    product: {
      mode: "# product page → launch video",
      prompt: "Turn this product page into a 30-second LinkedIn launch video: [product URL]. Lead with the user outcome, use the site’s visual identity, and show me a preview before rendering.",
      reply: "I’ll study the page, pull its visual language and strongest product outcome, then build a concise launch story for LinkedIn. I’ll show you the direction before the final render."
    },
    walkthrough: {
      mode: "# product flow → narrated walkthrough",
      prompt: "Make a 45-second narrated demo of [app URL]. Explore it first, then show how a new user completes [task]. Use a disposable demo account, keep the real UI readable, add word-synced captions, and show me the evidence frames before the final render.",
      reply: "I’ll inspect the interactive page, define semantic actions on the narration clock, capture the flow explicitly against demo data, and compose the real UI with browser framing, captions, and a release-freshness check."
    },
    research: {
      mode: "# paper → sourced explainer",
      prompt: "Turn this paper into a 60-second explainer: [paper URL]. Separate the authors’ findings from inference, cite the source on screen, and keep the language accessible.",
      reply: "I’ll ground every factual claim in the paper, translate the core finding into plain language, and use visuals that clarify the method without overstating the result."
    },
    repo: {
      mode: "# repository → technical overview",
      prompt: "Read this repository and make a 45-second technical overview: [repository URL]. Explain what it does, show the architecture clearly, and end with how to get started.",
      reply: "I’ll inspect the README and project structure, focus the story on the real workflow, and turn the architecture into a clear narrated walkthrough with an actionable ending."
    },
    script: {
      mode: "# script → two-host reel",
      prompt: "Turn the script below into a fast two-host vertical reel. Keep the exchange natural, use distinct caption colors, and let the visuals change with each speaker.\\n\\n[paste script]",
      reply: "I’ll shape the dialogue into short, energetic turns, give each host a distinct voice and caption color, and cue the visual changes to the speaker handoffs."
    },
    urdu: {
      mode: "# Urdu dialogue → voice-directed reel",
      prompt: "Turn this Urdu dialogue into a warm two-host reel. Use the urdu-voice-director skill to preserve each speaker’s voice and make the conversation sound natural, keep clean spoken text in captions, and show me a preview before rendering.\\n\\n[paste Urdu dialogue]",
      reply: "I’ll refine the Urdu for believable spoken delivery without changing its meaning, keep performance direction separate from caption-safe text, and let Narova handle sentence timing, voices, captions, and the preview."
    },
    cloud: {
      mode: "# optional companion → premium voice",
      prompt: "Use my registered cloud TTS companion for the narrator — OpenAI with marin, or ElevenLabs with [voice-id]. Keep credentials out of the project config and show me a preview before rendering.",
      reply: "I’ll verify the companion you choose, keep its API key in the environment, apply provider-native voice controls without leaking them into captions, and preserve Narova’s normal cache, timing, captions, and render pipeline."
    }
  };
  var activePrompt = PROMPT_EXAMPLES.idea;
  var promptMode = document.getElementById("promptMode");
  var quickPromptText = document.getElementById("quickPromptText");
  var quickReplyText = document.getElementById("quickReplyText");
  document.querySelectorAll(".prompt-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var next = PROMPT_EXAMPLES[tab.getAttribute("data-prompt")];
      if (!next) return;
      activePrompt = next;
      document.querySelectorAll(".prompt-tab").forEach(function (item) {
        var selected = item === tab;
        item.classList.toggle("active", selected);
        item.setAttribute("aria-pressed", selected ? "true" : "false");
      });
      if (promptMode) promptMode.textContent = next.mode;
      if (quickPromptText) quickPromptText.textContent = next.prompt;
      if (quickReplyText) quickReplyText.textContent = next.reply;
    });
  });
  bindCopy("copyQuick", function () { return activePrompt.prompt; }, null);

  /* ---------------- WebGL hero ---------------- */
  (function gl() {
    var canvas = document.getElementById("gl");
    if (!canvas || REDUCED || TOUCH) { showFallback(); return; }
    var ctx = canvas.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" });
    if (!ctx) { showFallback(); return; }

    function showFallback() {
      var f = document.querySelector(".hero-fallback");
      if (f) f.style.display = "block";
      if (canvas) canvas.style.display = "none";
    }

    var VERT = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
    var FRAG = [
      "precision highp float;",
      "uniform vec2 u_res;uniform float u_t;uniform vec2 u_m;",
      "float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}",
      "float noise(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);",
      " return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}",
      "float fbm(vec2 p){float v=0.;float a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}",
      "void main(){",
      " vec2 uv=gl_FragCoord.xy/u_res;",
      " vec2 st=uv;st.x*=u_res.x/u_res.y;",
      " vec2 m=u_m;m.x*=u_res.x/u_res.y;",
      " float t=u_t*.07;",
      " vec3 col=vec3(.070,.024,.114);",
      " float n1=fbm(st*1.6+vec2(t,-t*.7));",
      " float n2=fbm(st*2.1+vec2(-t*.8,t)+3.7);",
      " float n3=fbm(st*1.3-vec2(t*.5)+7.3);",
      " col+=vec3(.84,.976,.30)*smoothstep(.50,.92,n1)*.23;",
      " col+=vec3(.31,.85,.91)*smoothstep(.45,.92,n2)*.21;",
      " col+=vec3(.95,.25,.54)*smoothstep(.53,.97,n3)*.23;",
      " float md=exp(-3.2*distance(st,m));",
      " col+=mix(vec3(.31,.85,.91),vec3(.95,.25,.54),.5+.5*sin(u_t*.3))*md*.30;",
      " col+=vec3(.84,.976,.30)*exp(-6.*distance(st,m))*.12;",
      " float band=0.;",
      " for(int i=0;i<3;i++){float fi=float(i);",
      "  float y=.05+fi*.033;",
      "  float w=sin(st.x*22.+u_t*(1.1+fi*.4)+fi*2.1)*.011*(.5+.5*sin(st.x*5.+u_t*.8));",
      "  band+=smoothstep(.0045,.0,abs(uv.y-y-w))*(.4-fi*.1);}",
      " col+=vec3(.84,.976,.30)*band*.55;",
      " float vig=smoothstep(1.25,.35,distance(uv,vec2(.5,.45)));",
      " col*=mix(.5,1.,vig);",
      " gl_FragColor=vec4(col,1.);",
      "}"
    ].join("\n");

    function shader(type, src) {
      var s = ctx.createShader(type);
      ctx.shaderSource(s, src); ctx.compileShader(s);
      if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) { return null; }
      return s;
    }
    var vs = shader(ctx.VERTEX_SHADER, VERT);
    var fs = shader(ctx.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) { showFallback(); return; }
    var prog = ctx.createProgram();
    ctx.attachShader(prog, vs); ctx.attachShader(prog, fs); ctx.linkProgram(prog);
    if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) { showFallback(); return; }
    ctx.useProgram(prog);

    var buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
    var loc = ctx.getAttribLocation(prog, "p");
    ctx.enableVertexAttribArray(loc);
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);

    var uRes = ctx.getUniformLocation(prog, "u_res");
    var uT = ctx.getUniformLocation(prog, "u_t");
    var uM = ctx.getUniformLocation(prog, "u_m");

    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    function resize() {
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      ctx.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener("resize", resize);

    var tx = 0.5, ty = 0.5, cx = 0.5, cy = 0.5;
    window.addEventListener("pointermove", function (e) {
      var r = canvas.getBoundingClientRect();
      tx = (e.clientX - r.left) / r.width;
      ty = 1 - (e.clientY - r.top) / r.height;
    });

    var visible = true, start = performance.now();
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
      }, { threshold: 0.02 }).observe(canvas);
    }
    (function frame(now) {
      requestAnimationFrame(frame);
      if (!visible) return;
      cx += (tx - cx) * 0.06; cy += (ty - cy) * 0.06;
      ctx.uniform2f(uRes, canvas.width, canvas.height);
      ctx.uniform1f(uT, (now - start) / 1000);
      ctx.uniform2f(uM, cx, cy);
      ctx.drawArrays(ctx.TRIANGLES, 0, 3);
    })(start);
  })();

})();
