// GET /api/v1/locality?code=TRZ-D04200355      or   ?lat=10.795&lon=78.679[&precision=10m]
// Returns the nearest named locality (India Post, Tamil Nadu pilot) plus the code's airport context.
"use strict";
const OAVG = require("../_lib/oavg.cjs");
OAVG.loadRegistry(require("../../public/anchors.json"));
const DATA = require("../_data/localities.json");

const MAX_KM = 5;            // beyond this we don't claim a locality
const NEAR_KM = 1.5;         // "in" vs "near"
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const CELL = 0.1;            // grid index cell size in degrees (~11 km)

// ---- spatial index: 0.1° buckets -----------------------------------------
const grid = new Map();
const key = (i, j) => i * 100000 + j;
for (const r of DATA.rows) {
  const k = key(Math.floor(r[1] / CELL), Math.floor(r[2] / CELL));
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(r);
}

function nearest(lat, lon, n) {
  const i0 = Math.floor(lat / CELL), j0 = Math.floor(lon / CELL);
  const found = [];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const b = grid.get(key(i0 + di, j0 + dj));
    if (b) for (const r of b) found.push([OAVG.distanceM(lat, lon, r[1], r[2]) / 1000, r]);
  }
  found.sort((a, b) => a[0] - b[0]);
  return found.slice(0, n).filter(([d]) => d <= MAX_KM);
}

const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", status === 200 ? "public, max-age=3600, s-maxage=86400" : "no-store");
  res.end(JSON.stringify(body, null, 2));
}

function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "GET") return send(res, 405, { error: "Use GET" });
  const q = new URL(req.url, "http://x").searchParams;
  try {
    let code, lat, lon;
    if (q.get("code")) {
      code = OAVG.normalize(String(q.get("code")).slice(0, 40));
      ({ lat, lon } = OAVG.decode(code));
    } else if (q.get("lat") !== null && q.get("lon") !== null) {
      lat = Number(q.get("lat")); lon = Number(q.get("lon"));
      code = OAVG.encode(lat, lon, q.get("precision") || "10m");
    } else {
      return send(res, 400, { error: "Pass ?code=TRZ-D04200355 or ?lat=..&lon=.." });
    }
    const p = OAVG.parse(code);
    const a = OAVG.getAnchor(p.anchor);
    const g = OAVG.decodeGrid(code);
    const brg = (Math.atan2(g.x, g.y) * 180 / Math.PI + 360) % 360;
    const hits = nearest(lat, lon, 4);
    const toLoc = ([d, r]) => ({ name: r[0], pin: r[3], district: r[4], state: r[5], distance_km: round(d, 2),
                                 relation: d <= NEAR_KM ? "in" : "near" });
    return send(res, 200, {
      code,
      code_1km: OAVG.shorten(code, "1km"),
      lat: round(lat, 6), lon: round(lon, 6),
      airport: { code: a.code, name: a.name, distance_km: round(Math.hypot(g.x, g.y) / 1000, 2),
                 direction: COMPASS[Math.floor((brg + 11.25) / 22.5) % 16] },
      describe: OAVG.describe(code),
      locality: hits.length ? toLoc(hits[0]) : null,
      nearby: hits.slice(1).map(toLoc),
      coverage: DATA.coverage + " (pilot)",
      note: hits.length ? undefined : `No named locality within ${MAX_KM} km in our data yet. Coverage: ${DATA.coverage} (pilot).`,
      attribution: "Locality names: " + DATA.source + ". Draft service - not for navigation or emergency use.",
    });
  } catch (err) {
    return send(res, 400, { error: err && err.message ? err.message : "Bad request" });
  }
}

module.exports = handler;
