# URL → verified source

Use this workflow whenever the prompt includes a URL. The URL is source
material, but not every URL is a brand. Classify it before scripting or art
direction so the right evidence drives the video.

## 1. Classify the source

- **Product, company, or organization site** → brand-led promo/explainer.
  Extract exact positioning, proof, palette, typography, logo, product/people
  imagery, UI, and visual grammar.
- **Article, essay, blog, or news page** → content-led explainer. Extract the
  title, author, publication date, thesis, supporting claims, caveats, linked
  evidence, and useful article figures/illustrations. Publisher branding is
  context, not automatically the video's theme.
- **Research paper, preprint, or PDF** → research walkthrough. Extract exact
  title/authors, research question, method, result, limitations, and the
  figures/tables needed to explain it. Distinguish author claims from your
  inference; do not style the whole video as the journal website.
- **Documentation, README, or repository** → technical explainer. Extract the
  documented behavior, version/context, examples, architecture diagrams, UI,
  and code facts relevant to the requested goal.
- **General page or mixed site** → infer its primary function from the visible
  content. If one URL contains several source types, choose the type that
  matches the user's requested story; ask only if that choice changes the
  whole deliverable and cannot be inferred.

Classification controls emphasis, not access. Every type still needs exact
content and useful visuals from the real source.

## 2. Inspect the authoritative material

Use two complementary primary reads when available:

1. Open the rendered page or PDF with the appropriate browser/document tool
   to see computed styles, responsive layout, loaded imagery, and visible copy.
2. Use `curl -L --fail --compressed` on the URL to save/read the actual
   response, then curl linked CSS, fonts, images, or the PDF itself as needed.
   Add a normal browser user-agent only when a server rejects curl's default;
   do not bypass authentication or access controls.

For example:

```bash
curl -L --fail --compressed 'https://example.com/' -o /tmp/source.html
curl -L --fail --compressed 'https://example.com/styles.css' -o /tmp/source.css
```

Quote URLs so query strings and shell metacharacters cannot execute. Store
durable selected assets in the project's `assets/`; `/tmp` is only for intake.

Use a WebFetch-style prose extractor only when direct curl/browser inspection
is blocked or as a secondary text aid. It is the fallback, not the primary
source: summaries can omit CSS/assets and can paraphrase or misstate titles,
taglines, claims, and qualifiers. Never use a summary alone for exact wording,
numbers, authorship, or visual identity. If the rendered page and curl differ
because content is client-rendered, trust visible DOM/network responses and
record the discrepancy rather than guessing.

For brand-led sources, record:

- Exact brand/product name, tagline, proof points, and CTA wording.
- Primary background, text, accent, and secondary colors from actual CSS or
  sampled rendered elements.
- Display/body font families and visibly used weights.
- Logo/wordmark/favicon, hero/product imagery, people, UI, and recurring shapes.

For content-led sources, record:

- Exact title, author(s), date/version, thesis or research question.
- Claims/results with their conditions, uncertainty, and limitations.
- Figures, tables, diagrams, screenshots, or examples that carry explanatory
  value, plus what each actually shows.
- Publication/site identity only when attribution or story context needs it.

Cross-check important wording or numbers in two source locations when
possible. Do not promote an abstract's framing into a stronger conclusion.
Keep quotations short; explain primarily in original wording.

## 3. The claims ledger — before any scripting

Every factual assertion the video will make must be traceable to the source.
Before `synth`, write `claims.md` in the project directory listing each
claim in the `vo` — every number, superlative, date, comparison, and market
statement — tagged as one of:

- **verbatim** — exact words from the source. Quote + URL (or saved file).
- **paraphrase** — faithfully restated, qualifiers intact. Source URL.
- **inference** — your own conclusion. Either cut it, or phrase it on screen
  and in the voice as opinion ("we'd bet…"), never as fact.

Rules:

- If a claim is not in the ledger, it does not go in the script. No
  exceptions for "obvious" marketing lines — "leading", "2,000+ products",
  "half of Pakistan's kitchens" are exactly the claims that get invented.
- Numbers keep their qualifiers and scope. "over 2,000 products listed" does
  not become "2,000+ products sold"; a city-level stat does not become a
  country-level one.
- Watch the extractor's summary too: WebFetch-style summaries can themselves
  inflate ("leading", rounded-up counts). The ledger tags claims against the
  rendered page / raw HTML, not against a summary.
- `narova check` sniffs `vo` for stats and superlatives and warns when no
  `claims.md` exists. Heuristic only — the ledger is the real gate.

### Sourcing is checkable; balance is not

A ledger full of accurate-but-one-sided claims passes every check and still
ships a biased video. When the topic is contested — politics, conflicts,
disputes, competing products — the ledger must cover the major perspectives,
not just the loudest one:

- For each side's key claim, find a source and ledger it the same way. If a
  perspective's claim cannot be sourced, say so in the video or leave the
  perspective out entirely — never fill the gap with unsourced sympathy.
- Give opposing facts comparable screen time and comparable wording. "X
  struck Y" and "Y struck X" should get the same grammatical dignity.
- Attribute contested assertions to their claimant ("the US says…", "Iran
  denies…") instead of stating them as settled fact.
- Before synth, re-read the `vo` top to bottom and ask: whose framing is
  this? If the answer is one side's, rewrite. No tool flags this — the
  strongest signal is your own read of the script and the snapshot frames.

## 4. Freeze useful assets locally

Create the project under `generated/<slug>/` when working in a repository.
Download selected source assets into its source-owned `assets/` directory:

```text
generated/<slug>/
├── reel.config.mjs
├── theme.css
├── assets/
│   ├── logo-or-figure.svg
│   ├── hero-or-chart.webp
│   └── fonts/brand.woff2
└── out/                    # regenerated; ignore in git
```

Prefer an original SVG/raster figure over a screenshot crop. Use a screenshot
when page composition or UI is itself the evidence. Optimize oversized raster
images with ffmpeg, but keep them as files; do not assemble a large base64
stylesheet. Preserve aspect ratios and legibility. Use only assets needed for
the requested video and respect source licensing/attribution constraints.

Narova copies `assets/` into `out/hf/assets/`. Reference files as
`assets/logo.svg`, `assets/figure-2.webp`, or `assets/fonts/brand.woff2`.
Inline SVG and small `data:` URIs also work. Never leave an `http(s)`
dependency in final scene HTML or theme CSS.

For a local brand font, add `@font-face` and use a generic fallback only:

```css
@font-face{font-family:"Brand Display";src:url("assets/fonts/display.woff2") format("woff2")}
:root{--serif:"Brand Display",serif;--sans:"Brand Sans",sans-serif}
```

Named fallbacks such as Georgia, Times New Roman, or Roboto can make
HyperFrames fetch and bundle extra families.

## 5. Translate evidence into a video

- **Brand-led:** match verified palette, typography, shape language, image
  treatment, and spacing. Use real brand assets where they add meaning. The
  video should be recognizable with captions off without tracing the webpage.
- **Article/paper-led:** build the visual language around the subject and
  source-native figures. Preserve attribution and uncertainty. Do not let the
  publisher's nav colors or logo overpower the actual idea.
- **Technical:** prefer architecture, UI, code, and data-flow visuals over
  generic marketing cards; keep version-sensitive facts explicit.

Before synth, verify:

- Source type was classified and the corresponding evidence drove the work.
- `claims.md` exists and every number, superlative, and factual assertion in
  the `vo` is in it, tagged verbatim / paraphrase / inference with a source.
- Names, titles, claims, metrics, authors, and dates match the source.
- Inference is labeled and limitations have not disappeared.
- Useful source-native visuals appear; irrelevant publisher chrome does not.
- Every image/font path is local and resolves from project `assets/`.
- The result could not become an unrelated topic's video by swapping copy.
