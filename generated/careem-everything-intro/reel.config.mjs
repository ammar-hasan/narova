// Careem — one-minute brand intro sourced from careem.com.
// Visual evidence: CareemSans, rounded service tiles, the green/deep-green
// identity, and the blue/green/purple/dark-blue Go/Eat/Get/Pay system.
export default {
  title: "Careem — The Everything App",
  size: "16:9",
  assets: "assets",
  voices: {
    n: {
      backend: "piper",
      speaker: "en_US-hfc_female-medium",
      color: "#008A4A",
      label: "Careem guide",
    },
  },
  theme: {
    mode: "light",
    accent: "#00A85A",
    bg: "#F4F8FB",
    css: "theme.css",
  },
  chrome: false,
  timing: {
    gapSentence: 0.18,
    gapTurn: 0.32,
    lead: 0.14,
    tail: 0.46,
    tempo: 1.1,
  },
  scenes: [
    {
      id: "hello",
      vo: [
        { who: "n", text: "Your day has places, cravings, errands, and people to pay." },
        { who: "n", text: "Careem calls itself the everything app. So, let's open the box." },
      ],
      body: `<div class="hero-stage">
          <div class="float-object pin cue" data-cue="0"><span></span></div>
          <div class="float-object burger cue" data-cue="0"><i></i><b></b><em></em></div>
          <div class="float-object bag cue" data-cue="0"><span>GET</span></div>
          <div class="float-object wallet cue" data-cue="0"><span>PAY</span></div>
          <img class="careem-logo reveal" src="assets/careem-logo.webp" alt="Careem">
          <div class="everything cue" data-cue="1">The everything app.</div>
          <img class="wink-mark cue" data-cue="1" src="assets/wink.webp" alt="">
        </div>`,
    },
    {
      id: "oneapp",
      vo: [
        { who: "n", text: "Open Careem and the shortcuts line up: Go, Eat, Get, and Pay." },
        { who: "n", text: "One home screen, ready for whatever comes next." },
      ],
      body: `<div class="phone-scene">
          <div class="phone-copy">
            <div class="kicker reveal">ONE APP</div>
            <h2 class="scene-title reveal">A whole day,<br><span>one home.</span></h2>
            <div class="service-chips cue" data-cue="1">
              <b class="chip-go">GO</b><b class="chip-eat">EAT</b><b class="chip-get">GET</b><b class="chip-pay">PAY</b>
            </div>
          </div>
          <div class="app-shot reveal"><img src="assets/careem-app.webp" alt="Careem app home screen"></div>
          <div class="search-bubble cue" data-cue="1">What do you need?</div>
        </div>`,
    },
    {
      id: "go",
      vo: [
        { who: "n", text: "Start with Go: rides, taxis, bikes, car rentals, and school rides." },
        { who: "n", text: "Morning commute or quick hop. Pick your way across town." },
      ],
      body: `<div class="service-card go-card">
          <div class="service-copy">
            <div class="service-word reveal">Go</div>
            <div class="service-any reveal">anywhere</div>
            <div class="mini-tags cue" data-cue="0"><span>Rides</span><span>Taxi</span><span>Bike</span><span>Rental</span></div>
          </div>
          <div class="road-world">
            <div class="road reveal"><i></i><i></i><i></i></div>
            <div class="mini-car cue" data-cue="0"><b></b><i></i><i></i></div>
            <div class="map-pin cue" data-cue="1"><span></span></div>
            <div class="city cue" data-cue="1"><i></i><i></i><i></i><i></i></div>
          </div>
          <img class="corner-arrow cue" data-cue="1" src="assets/arrow.webp" alt="">
        </div>`,
    },
    {
      id: "eat",
      vo: [
        { who: "n", text: "Hungry now, planning later, or hunting a table?" },
        { who: "n", text: "Food and DineOut make Eat the tasty corner of Careem." },
      ],
      body: `<div class="service-card eat-card">
          <div class="eat-object reveal">
            <div class="bun top"></div><div class="lettuce"></div><div class="patty"></div><div class="cheese"></div><div class="bun bottom"></div>
          </div>
          <div class="service-copy right-copy">
            <div class="service-word reveal">Eat</div>
            <div class="service-any reveal">anytime</div>
            <div class="mini-tags cue" data-cue="1"><span>Food</span><span>DineOut</span></div>
          </div>
          <div class="plate-ring cue" data-cue="0"></div>
          <img class="corner-arrow cue" data-cue="1" src="assets/arrow.webp" alt="">
        </div>`,
    },
    {
      id: "get",
      vo: [
        { who: "n", text: "Need groceries, electronics, flowers, pharmacy items, home services, or a parcel moved?" },
        { who: "n", text: "Get turns that untidy list into one neat shortcut." },
      ],
      body: `<div class="service-card get-card">
          <div class="service-copy">
            <div class="service-word reveal">Get</div>
            <div class="service-any reveal">anything</div>
          </div>
          <div class="parcel-stack">
            <div class="parcel p1 cue" data-cue="0"><span>GROCERIES</span></div>
            <div class="parcel p2 cue" data-cue="0"><span>FLOWERS</span></div>
            <div class="parcel p3 cue" data-cue="0"><span>PHARMACY</span></div>
            <div class="parcel p4 cue" data-cue="1"><span>ELECTRONICS</span></div>
          </div>
          <div class="check-pop cue" data-cue="1">TO-DO ✓</div>
          <img class="corner-arrow cue" data-cue="1" src="assets/arrow.webp" alt="">
        </div>`,
    },
    {
      id: "pay",
      vo: [
        { who: "n", text: "Pay brings payments, donations, and money transfers into the same flow." },
        { who: "n", text: "Pay, donate, or send money without leaving Careem." },
      ],
      body: `<div class="service-card pay-card">
          <div class="service-copy">
            <div class="service-word reveal">Pay</div>
            <div class="service-any reveal">anyone</div>
            <div class="mini-tags cue" data-cue="0"><span>Pay</span><span>Donations</span><span>Send money</span></div>
          </div>
          <div class="pay-orbit">
            <div class="pay-core reveal">PAY</div>
            <div class="money-node n1 cue" data-cue="0">↗</div>
            <div class="money-node n2 cue" data-cue="1">♥</div>
            <div class="money-node n3 cue" data-cue="1">✓</div>
          </div>
          <img class="corner-arrow invert-arrow cue" data-cue="1" src="assets/arrow.webp" alt="">
        </div>`,
    },
    {
      id: "close",
      vo: [
        { who: "n", text: "Go anywhere. Eat anytime. Get anything. Pay anyone." },
        { who: "n", text: "Different errands, one bright green wink, one app ready for your next move." },
      ],
      body: `<div class="closing-grid">
          <div class="close-tile t-go cue" data-cue="0"><b>Go</b><span>anywhere</span></div>
          <div class="close-tile t-eat cue" data-cue="0"><b>Eat</b><span>anytime</span></div>
          <div class="close-tile t-get cue" data-cue="0"><b>Get</b><span>anything</span></div>
          <div class="close-tile t-pay cue" data-cue="0"><b>Pay</b><span>anyone</span></div>
          <div class="close-center reveal">
            <img src="assets/wink.webp" alt="">
            <div>The everything app.</div>
            <div class="careem-url cue" data-cue="1">careem.com</div>
          </div>
        </div>`,
    },
  ],
};
