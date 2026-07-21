// Bazaar Technologies — fun ~55s intro. Every claim traces to bazaartech.com
// homepage copy (tagline, "at your doorstep", "Bazaar for everyone",
// "essentials across 30+ categories", "widest local product range",
// "daily low pricing", "next day delivery", Bazaar Pro, Keenu). Palette,
// fonts, wordmark and imagery sampled from the live site (see assets/).
export default {
  title: "Bazaar — Everyday Essentials",
  size: "16:9",
  assets: "assets",
  voices: {
    a: { backend: "piper", speaker: "en_US-ryan-high",        color: "#0a6ad6", label: "host · Zain" },
    b: { backend: "piper", speaker: "en_US-hfc_female-medium", color: "#d6342a", label: "host · Mira" },
  },
  theme: { accent: "#0a6ad6", bg: "#f4f9ff", css: "theme.css" },
  timing: { gapSentence: 0.18, gapTurn: 0.36, lead: 0.15, tail: 0.5, tempo: 1.16 },

  scenes: [
    {
      id: "hook",
      vo: [
        { who: "a", text: "Atta, chai, biryani masala, a fresh bar of soap — the whole month's essentials." },
        { who: "b", text: "One app, at your doorstep. That's Bazaar." },
      ],
      body: `<div class="objects">
          <img class="obj o-tl reveal" src="assets/items.png" alt="">
        </div>
        <div class="s-title">
          <div class="eyebrow reveal">BAZAAR TECHNOLOGIES</div>
          <img class="wm cue" data-cue="1" src="assets/logo-blue-ink.svg" alt="Bazaar">
          <p class="lede cue" data-cue="1">Everyday essentials, at your doorstep.</p>
        </div>`,
    },

    {
      id: "promise",
      vo: [
        { who: "b", text: "Bazaar's promise is right there on the tin." },
        { who: "a", text: "Making everyday life more affordable, and effortless." },
      ],
      body: `<div class="s-center">
          <div class="eyebrow reveal">THE PROMISE</div>
          <h1 class="display cue" data-cue="1" style="font-size:5.2vw;max-width:15em">Everyday life —<br><span class="grad">affordable &amp; effortless.</span></h1>
        </div>`,
    },

    {
      id: "app",
      vo: [
        { who: "a", text: "Open the app and you get the widest local product range, all in one place." },
        { who: "b", text: "Essentials across thirty-plus categories — with daily low pricing." },
      ],
      body: `<div class="app-split">
          <div class="app-copy">
            <div class="eyebrow reveal">ONE APP</div>
            <h2 class="display reveal" style="font-size:3.3vw">Everything<br>you need,<br><span class="grad">in one tap.</span></h2>
            <div class="tags cue" data-cue="1" style="justify-content:flex-start;margin-top:.4vw">
              <span class="tag">Widest local range</span>
              <span class="tag gold">30+ categories</span>
            </div>
          </div>
          <div class="phone reveal"><img src="assets/phone.png" alt="Bazaar app"></div>
        </div>`,
    },

    {
      id: "deal",
      vo: [
        { who: "b", text: "Everything under a thousand rupees." },
        { who: "a", text: "Ordered today, at your doorstep the very next day. Simple." },
      ],
      body: `<div class="s-center">
          <div class="eyebrow reveal">DAILY LOW PRICING</div>
          <div class="rs-line reveal">Everything under</div>
          <div class="rs-num reveal">RS.<span class="under">1000</span></div>
          <div class="tags cue" data-cue="1">
            <span class="tag red">Next-day delivery</span>
            <span class="tag ghost">to your doorstep</span>
          </div>
        </div>`,
    },

    {
      id: "more",
      vo: [
        { who: "a", text: "And it's not just homes. Bazaar Pro handles procurement for businesses across Pakistan." },
        { who: "b", text: "With Keenu, they built Pakistan's first integrated e-commerce and payments platform." },
      ],
      body: `<div class="s-center">
          <div class="eyebrow reveal">MORE THAN GROCERIES</div>
          <div class="duo" style="margin-top:1.8vw">
            <div class="card reveal">
              <span class="pill">FOR BUSINESS</span>
              <div class="k">Bazaar Pro</div>
              <div class="v">Procurement for shops, offices, and restaurants across Pakistan.</div>
            </div>
            <div class="card blue cue" data-cue="1">
              <span class="pill">E-COMMERCE + PAYMENTS</span>
              <div class="k">Powered by Keenu</div>
              <div class="v">Pakistan's first integrated e-commerce and payments platform.</div>
            </div>
          </div>
        </div>`,
    },

    {
      id: "close",
      vo: [
        { who: "b", text: "Groceries, essentials, payments — Bazaar for everyone." },
        { who: "a", text: "Everyday life, more affordable and effortless. Come see for yourself." },
      ],
      body: `<div class="objects">
          <img class="obj o-br reveal" src="assets/items.png" alt="">
        </div>
        <div class="s-center">
          <img class="wm reveal" src="assets/logo-blue-ink.svg" alt="Bazaar" style="width:19vw">
          <p class="lede reveal" style="margin-top:.4vw">Making everyday life more affordable and effortless.</p>
          <div class="url cue" data-cue="1">bazaartech.com</div>
        </div>`,
    },
  ],
};
