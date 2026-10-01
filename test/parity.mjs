// Parity test: web/public/oavg.js vs the Python reference (vectors from gen_vectors.py).
// Usage:  python3 web/test/gen_vectors.py > web/test/vectors.json && node web/test/parity.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
vm.runInThisContext(fs.readFileSync(path.join(pub, 'oavg.js'), 'utf8'), { filename: 'oavg.js' });
const OAVG = globalThis.OAVG;
const anchors = JSON.parse(fs.readFileSync(path.join(pub, 'anchors.json'), 'utf8'));
const V = JSON.parse(fs.readFileSync(path.join(here, 'vectors.json'), 'utf8'));
OAVG.loadRegistry(anchors);

const DEG_TOL = 1e-9, M_TOL = 1e-6;
// distances: 1 micrometre, or 1e-13 relative (Vincenty is ill-conditioned for nearly antipodal points)
const distTol = (d) => Math.max(M_TOL, 1e-13 * Math.abs(d));
const results = [];
let failed = 0;
function section(name) {
  const r = { name, total: 0, pass: 0, exact: null, fails: [] };
  results.push(r);
  return {
    check(ok, detail) { r.total++; if (ok) r.pass++; else { failed++; if (r.fails.length < 10) r.fails.push(detail); } },
    exact(ok) { r.exact = (r.exact || 0) + (ok ? 1 : 0); },
  };
}
function run(fn) {
  try { return { ok: fn() }; } catch (e) {
    if (!(e instanceof OAVG.OAVGError)) return { crash: String(e && e.stack || e) };
    return { err: e.message };
  }
}
const sameResult = (py, js) => ('ok' in py) ? ('ok' in js && js.ok === py.ok) : ('err' in js);
const sameMsg = (py, js) => !('err' in py) || js.err === py.err;

// (a) encode
{
  const s = section('encode (nearest anchor) x6 precisions'), n = section('nearestAnchor');
  for (const e of V.encode) {
    for (const [p, py] of Object.entries(e.codes)) {
      const js = run(() => OAVG.encode(e.lat, e.lon, p));
      s.check(sameResult(py, js) && sameMsg(py, js), { lat: e.lat, lon: e.lon, p, py, js });
    }
    const na = OAVG.nearestAnchor(e.lat, e.lon).code;
    n.check(na === e.nearest, { lat: e.lat, lon: e.lon, py: e.nearest, js: na });
  }
  const f = section('encode (forced anchor) x6 precisions');
  for (const e of V.encode_forced) {
    for (const [p, py] of Object.entries(e.codes)) {
      const js = run(() => OAVG.encode(e.lat, e.lon, p, e.anchor));
      f.check(sameResult(py, js) && sameMsg(py, js), { e, p, py, js });
    }
  }
  const g = section('toGrid / fromGrid');
  for (const e of V.grid) {
    const ll = OAVG.fromGrid(e.anchor, e.x, e.y), xy = OAVG.toGrid(e.anchor, e.lat, e.lon);
    g.check(Math.abs(ll.lat - e.lat) < DEG_TOL && Math.abs(ll.lon - e.lon) < DEG_TOL &&
            Math.abs(xy.x - e.gx) < M_TOL && Math.abs(xy.y - e.gy) < M_TOL, { e, ll, xy });
    g.exact(ll.lat === e.lat && ll.lon === e.lon && xy.x === e.gx && xy.y === e.gy);
  }
  const eg = section('encodeGrid');
  for (const e of V.encode_grid) {
    const js = run(() => OAVG.encodeGrid('TRZ', e.x, e.y, e.p));
    eg.check(sameResult(e.r, js) && sameMsg(e.r, js), { e, js });
  }
}

// (b) decode + parse + distanceFromAnchorM
{
  const d = section('decode (1e-9 deg)'), p = section('parse fields'), da = section('distanceFromAnchorM');
  let maxDiff = 0;
  for (const e of V.decode) {
    const ll = OAVG.decode(e.code);
    const diff = Math.max(Math.abs(ll.lat - e.lat), Math.abs(ll.lon - e.lon));
    maxDiff = Math.max(maxDiff, diff);
    d.check(diff < DEG_TOL, { code: e.code, py: [e.lat, e.lon], js: ll });
    d.exact(ll.lat === e.lat && ll.lon === e.lon);
    const c = OAVG.parse(e.code);
    p.check(Object.keys(e.parse).every((k) => c[k] === e.parse[k]), { py: e.parse, js: c });
    const dist = OAVG.distanceFromAnchorM(e.code);
    da.check(Math.abs(dist - e.dist_anchor) < M_TOL, { code: e.code, py: e.dist_anchor, js: dist });
    da.exact(dist === e.dist_anchor);
  }
  results.find((r) => r.name.startsWith('decode')).maxDiff = maxDiff;
}

// (c) describe
{
  const s = section('describe (exact string)');
  for (const e of V.describe) {
    const js = run(() => OAVG.describe(e.code));
    s.check(js.ok === e.s, { code: e.code, py: e.s, js });
  }
}

// (d) move / shorten / cellPolygon / distance
{
  const m = section('move'), sh = section('shorten'), pg = section('cellPolygon (1e-9 deg)');
  const di = section('distance (codes)'), dm = section('distanceM (1 um / 1e-13 rel)');
  for (const e of V.move) {
    const js = run(() => OAVG.move(e.code, e.e, e.n));
    m.check(sameResult(e.r, js) && sameMsg(e.r, js), { e, js });
  }
  for (const e of V.shorten) {
    const js = run(() => OAVG.shorten(e.code, e.p));
    sh.check(sameResult(e.r, js) && sameMsg(e.r, js), { e, js });
  }
  for (const e of V.polygon) {
    const poly = OAVG.cellPolygon(e.code);
    const ok = poly.length === 4 && poly.every((pt, k) =>
      Math.abs(pt[0] - e.poly[k][0]) < DEG_TOL && Math.abs(pt[1] - e.poly[k][1]) < DEG_TOL);
    pg.check(ok, { code: e.code, py: e.poly, js: poly });
    pg.exact(poly.every((pt, k) => pt[0] === e.poly[k][0] && pt[1] === e.poly[k][1]));
  }
  for (const e of V.distance) {
    const d = OAVG.distance(e.a, e.b);
    di.check(Math.abs(d - e.d) < distTol(e.d), { e, js: d });
    di.exact(d === e.d);
  }
  for (const e of V.distance_m) {
    const d = OAVG.distanceM(...e.args);
    dm.check(Math.abs(d - e.d) < distTol(e.d), { e, js: d });
    dm.exact(d === e.d);
  }
}

// (e) invalid codes, odd-but-valid inputs, bad encode args, retired anchors
{
  const iv = section('invalid codes throw OAVGError'), msg = section('invalid code error messages');
  for (const e of V.invalid) {
    const js = run(() => OAVG.parse(e.code));
    iv.check('err' in js, { code: e.code, js });
    msg.check(js.err === e.err, { code: e.code, py: e.err, js: js.err });
  }
  const po = section('parse of odd-but-valid input');
  for (const e of V.parse_ok) {
    const js = run(() => OAVG.parse(e.code));
    po.check(js.ok && Object.keys(e.p).every((k) => js.ok[k] === e.p[k]), { e, js });
  }
  const be = section('bad encode inputs');
  for (const e of V.bad_encode) {
    const js = run(() => OAVG.encode(...e.args));
    be.check(js.err === e.err, { e, js });
  }
  // inputs JSON cannot carry: NaN / Infinity / strings / booleans (Python raises OAVGError for all)
  for (const args of [['10', '78'], [true, 78.0], [NaN, 78.0], [10.0, Infinity]]) {
    be.check('err' in run(() => OAVG.encode(...args)), { args });
  }
  be.check('err' in run(() => OAVG.move('TRZ-55511-79566', 1.5, 0)), 'move 1.5');
  be.check('err' in run(() => OAVG.move('TRZ-55511-79566', true, 0)), 'move true');
  be.check('err' in run(() => OAVG.encodeGrid('TRZ', 5, NaN)), 'encodeGrid NaN');
  be.check('err' in run(() => OAVG.parse(42)), 'parse number');

  const rt = section('retired anchor');
  OAVG.loadRegistry(anchors.concat([{ code: 'QQQ', lat: 10.5, lon: 78.5, name: 'Closed', status: 'retired' }]));
  const g = OAVG.decodeGrid('QQQ-55555-55555'), ll = OAVG.decode('QQQ-55555-55555');
  rt.check(g.x === V.retired.decode[0] && g.y === V.retired.decode[1], { g });
  rt.check(Math.abs(ll.lat - V.retired.latlon[0]) < DEG_TOL && Math.abs(ll.lon - V.retired.latlon[1]) < DEG_TOL, { ll });
  rt.check(run(() => OAVG.encode(10.5, 78.5, '4m', 'QQQ')).err === V.retired.forced_err, 'forced retired');
  rt.check(OAVG.encode(10.5, 78.5) === V.retired.nearest, 'nearest skips retired');
  OAVG.loadRegistry(anchors);
}

// performance: nearestAnchor
const pts = V.encode.slice(0, 2000);
for (const e of pts.slice(0, 200)) OAVG.nearestAnchor(e.lat, e.lon);   // warm-up
const t0 = performance.now();
for (const e of pts) OAVG.nearestAnchor(e.lat, e.lon);
const perCall = (performance.now() - t0) / pts.length;

console.log(`OAVG.js ${OAVG.version} vs Python ${V.version}\n`);
for (const r of results) {
  const extra = [r.exact !== null ? `bit-exact ${r.exact}/${r.total}` : '', r.maxDiff !== undefined ? `max diff ${r.maxDiff.toExponential(2)} deg` : '']
    .filter(Boolean).join(', ');
  console.log(`${r.pass === r.total ? 'PASS' : 'FAIL'}  ${String(r.pass).padStart(6)}/${String(r.total).padEnd(6)} ${r.name}${extra ? '  (' + extra + ')' : ''}`);
  for (const f of r.fails) console.log('      ', JSON.stringify(f).slice(0, 400));
}
console.log(`\nnearestAnchor: ${perCall.toFixed(3)} ms/call (avg over ${pts.length} points)`);
const total = results.reduce((a, r) => a + r.total, 0);
console.log(failed ? `\n${failed} MISMATCHES out of ${total} checks` : `\nALL ${total} CHECKS PASS`);
process.exit(failed ? 1 : 0);
