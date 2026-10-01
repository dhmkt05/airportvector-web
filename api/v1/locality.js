// GET /api/v1/locality?code=TRZ-55511-79566    or   ?lat=10.795&lon=78.679[&precision=4m]
// Returns, for a code or point (Tamil Nadu pilot):
//   place  - the village / hamlet / neighbourhood it is in (OpenStreetMap)   <- what a rider needs
//   postal - the nearest post office + PIN (India Post)                       <- what the post needs
//   label  - both in one line, the way Indian addresses are written: "Olaiyur, K. Sathanur PO 620021"
//   locality - same as postal (kept for older clients)
"use strict";
const OAVG = require("../_lib/oavg.cjs");
OAVG.loadRegistry(require("../../public/anchors.json"));
const DATA = require("../_data/localities.json");
let PLACES = null;
try { PLACES = require("../_data/places.json"); } catch (e) { PLACES = null; }   // optional layer

// how far a place "reaches", by OSM type: [in_km, max_km]
const REACH = {
  isolated_dwelling: [0.5, 1.0], hamlet: [1.0, 2.0], neighbourhood: [1.0, 2.0],
  quarter: [1.5, 2.5], locality: [1.5, 2.5], suburb: [1.5, 3.0], village: [1.5, 3.0], town: [3.0, 5.0],
};

const MAX_KM = 5;            // beyond this we don't claim a locality
const NEAR_KM = 1.5;         // "in" vs "near"
const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const CELL = 0.1;            // grid index cell size in degrees (~11 km)

// ---- spatial index: 0.1° buckets -----------------------------------------
const key = (i, j) => i * 100000 + j;
function buildIndex(rows, latIdx, lonIdx) {
  const g = new Map();
  for (const r of rows) {
    const k = key(Math.floor(r[latIdx] / CELL), Math.floor(r[lonIdx] / CELL));
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  return g;
}
function around(g, latIdx, lonIdx, lat, lon) {
  const i0 = Math.floor(lat / CELL), j0 = Math.floor(lon / CELL);
  const found = [];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const b = g.get(key(i0 + di, j0 + dj));
    if (b) for (const r of b) found.push([OAVG.distanceM(lat, lon, r[latIdx], r[lonIdx]) / 1000, r]);
  }
  return found;
}
const postGrid = buildIndex(DATA.rows, 1, 2);
const placeGrid = PLACES ? buildIndex(PLACES.rows, 3, 4) : null;

function nearest(lat, lon, n) {
  const found = around(postGrid, 1, 2, lat, lon);
  found.sort((a, b) => a[0] - b[0]);
  return found.slice(0, n).filter(([d]) => d <= MAX_KM);
}

// best place = smallest (distance / reach-of-its-type); a hamlet 800 m away beats a town 2 km away
function bestPlaces(lat, lon, n) {
  if (!placeGrid) return [];
  const scored = [];
  for (const [d, r] of around(placeGrid, 3, 4, lat, lon)) {
    const reach = REACH[r[2]] || [1.0, 2.0];
    if (d <= reach[1]) scored.push([d / reach[1], d, r, reach]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, n);
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
      code = OAVG.encode(lat, lon, q.get("precision") || "4m");
    } else {
      return send(res, 400, { error: "Pass ?code=TRZ-55511-79566 or ?lat=..&lon=.." });
    }
    const p = OAVG.parse(code);
    const a = OAVG.getAnchor(p.anchor);
    const g = OAVG.decodeGrid(code);
    const brg = (Math.atan2(g.x, g.y) * 180 / Math.PI + 360) % 360;
    const hits = nearest(lat, lon, 4);
    const toLoc = ([d, r]) => ({ name: r[0], pin: r[3], district: r[4], state: r[5], distance_km: round(d, 2),
                                 relation: d <= NEAR_KM ? "in" : "near" });
    const places = bestPlaces(lat, lon, 4);
    const toPlace = ([, d, r, reach]) => ({ name: r[0], name_ta: r[1] || undefined, type: r[2],
                                            distance_km: round(d, 2), relation: d <= reach[0] ? "in" : "near" });
    const place = places.length ? toPlace(places[0]) : null;
    const postal = hits.length ? toLoc(hits[0]) : null;
    let label = null;
    if (place && postal) {
      label = (place.relation === "near" ? "Near " : "") + place.name +
        (place.name.toLowerCase() === postal.name.toLowerCase() ? " " + postal.pin
                                                                 : ", " + postal.name + " PO " + postal.pin);
    } else if (place) {
      label = (place.relation === "near" ? "Near " : "") + place.name;
    } else if (postal) {
      label = (postal.relation === "near" ? "Near " : "") + postal.name + " PO " + postal.pin;
    }
    return send(res, 200, {
      code,
      display: p.display,
      code_1km: OAVG.shorten(code, "1km"),
      lat: round(lat, 6), lon: round(lon, 6),
      airport: { code: a.code, name: a.name, distance_km: round(Math.hypot(g.x, g.y) / 1000, 2),
                 direction: COMPASS[Math.floor((brg + 11.25) / 22.5) % 16] },
      describe: OAVG.describe(code),
      label,
      place,
      postal,
      locality: postal,
      nearby_places: places.slice(1).map(toPlace),
      nearby: hits.slice(1).map(toLoc),
      coverage: DATA.coverage + " (pilot)",
      note: (hits.length || place) ? undefined : `No named locality within ${MAX_KM} km in our data yet. Coverage: ${DATA.coverage} (pilot).`,
      attribution: "Post offices: " + DATA.source + "." +
        (PLACES ? " Places: \u00A9 OpenStreetMap contributors, ODbL." : "") +
        " Draft service - not for navigation or emergency use.",
    });
  } catch (err) {
    return send(res, 400, { error: err && err.message ? err.message : "Bad request" });
  }
}

module.exports = handler;
