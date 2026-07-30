# Narova product walkthrough showcase

This project drives the local Orbit fixture in
`skills/narova/tool/evals/fixtures/product-app/` and produces the shipped
`assets/narova-product-walkthrough-demo.mp4`.

Run the fixture on `127.0.0.1:4173`, then:

```bash
export NAROVA_DEMO_URL=http://127.0.0.1:4173/
narova synth
narova walkthrough capture orbit
narova check --release
narova build --reuse
```
