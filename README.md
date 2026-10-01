# airportvector-web

Source for **[airportvector.org](https://airportvector.org)** — the showcase site and live demo for the
[Open Airport Vector Grid (OAVG)](https://github.com/dhmkt05/airportvector) location code.

- Static site: plain HTML, CSS and JavaScript. **No build step, no server, no API keys.**
- `public/oavg.js` — browser port of the reference library (v4.0.0, keypad grid), parity-tested against Python on 120,000+ checks.
- `public/anchors.json` — 4,133 commercial airports (OurAirports, public domain).
- Map: MapLibre GL (from unpkg, pinned + SRI hash) with free OpenFreeMap tiles.

## Run locally

```
cd public
python -m http.server 8000
```
Then open http://localhost:8000

## Deploy

Pushed to GitHub → Vercel deploys automatically (`vercel.json` sets `public/` as the output folder and adds security headers).

## Parity test (optional)

Needs Python 3 with the main repo checked out next to this one (`../airportvector`):
```
python test/gen_vectors.py > test/vectors.json
node test/parity.mjs
```

After changing `public/oavg.js`, regenerate the API copy: `node scripts/build_api_lib.mjs`.

## License

Business Source License 1.1 — see `LICENSE.md`.
