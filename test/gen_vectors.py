"""Generate parity vectors from the Python reference implementation (v21/airportvector.py).

Usage:  python3 web/test/gen_vectors.py  >  web/test/vectors.json
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # leave v21/ untouched
for _cand in (os.environ.get("OAVG_PY_DIR", ""), os.path.join(HERE, "..", "..", "airportvector"), os.path.join(HERE, "..", "..", "v21")):
    if _cand and os.path.exists(os.path.join(_cand, "airportvector.py")):
        sys.path.insert(0, _cand)
        break
import airportvector as av  # noqa: E402

PRECS = list(av.PRECISIONS)


def attempt(fn, *args, **kw):
    try:
        return {"ok": fn(*args, **kw)}
    except av.OAVGError as exc:
        return {"err": str(exc)}


def main():
    rnd = random.Random(20260928)
    out = {"version": av.__version__}

    # ---- (a) points -------------------------------------------------------------
    pts = []
    for _ in range(2800):
        pts.append([rnd.uniform(-90, 90), rnd.uniform(-180, 180)])
    for _ in range(100):                                   # polar
        lat = rnd.uniform(85, 90) * rnd.choice((1, -1))
        pts.append([lat, rnd.uniform(-180, 180)])
    for _ in range(100):                                   # near the dateline
        lon = rnd.choice((180 - rnd.uniform(0, 0.5), -180 + rnd.uniform(0, 0.5)))
        pts.append([rnd.uniform(-90, 90), lon])
    pts += [[90.0, 0.0], [-90.0, 0.0], [90.0, 123.0], [-90.0, -77.0], [0.0, 180.0], [0.0, -180.0],
            [-17.8, 180.0], [-17.8, -180.0]]
    # every example point in v21/tests
    pts += [[10.7950461, 78.6793020], [51.5074, -0.1278], [23.5, 12.0], [0.0, -30.0],
            [-48.8767, -123.3933], [-75.85, 67.95], [13.0, 80.2], [10.80, 78.68], [10.5, 78.5]]
    pts += [[lat, float(lon)] for lat in (90.0, -90.0) for lon in range(-180, 181, 3)]
    random.seed(11)  # test_every_point_on_globe_gets_a_code
    pts += [[random.uniform(-90, 90), random.uniform(-180, 180)] for _ in range(300)]
    random.seed(5)   # test_nearest_matches_brute_force
    pts += [[random.uniform(-90, 90), random.uniform(-180, 180)] for _ in range(25)]
    random.seed(9)   # test_stable_roundtrip_with_same_anchor
    pts += [[random.uniform(-85, 85), random.uniform(-180, 180)] for _ in range(300)]

    encodes = []
    for lat, lon in pts:
        encodes.append({"lat": lat, "lon": lon, "codes": {p: attempt(av.encode, lat, lon, p) for p in PRECS},
                        "nearest": av.nearest_anchor(lat, lon).code})
    out["encode"] = encodes

    # forced-anchor encodes (test_roundtrip_every_band_every_precision style) + to/from grid
    forced, grids = [], []
    random.seed(42)
    for anchor in ("TRZ", "LAX", "PLZ", "USH"):
        for limit in (99_999, 999_999, 9_999_999):
            for _ in range(60):
                x, y = random.uniform(-limit, limit), random.uniform(-limit, limit)
                if (x * x + y * y) ** 0.5 > 14_000_000:
                    continue
                lat, lon = av.from_grid(anchor, x, y)
                gx, gy = av.to_grid(anchor, lat, lon)
                grids.append({"anchor": anchor, "x": x, "y": y, "lat": lat, "lon": lon, "gx": gx, "gy": gy})
                forced.append({"lat": lat, "lon": lon, "anchor": anchor,
                               "codes": {p: attempt(av.encode, lat, lon, p, anchor=anchor) for p in PRECS}})
    forced.append({"lat": -10.7629, "lon": 78.7177 - 180, "anchor": "TRZ",
                   "codes": {p: attempt(av.encode, -10.7629, 78.7177 - 180, p, anchor="TRZ") for p in PRECS}})
    out["encode_forced"] = forced
    out["grid"] = grids

    grid_codes = []
    for x, y, p in [(50_000, 50_000, "1km"), (50_000, -50_000, "1km"), (-50_000, -50_000, "1km"),
                    (-50_000, 50_000, "1km"), (150_000, 5, "1km"), (5, -150_000, "1km"), (-150_000, -5, "1km"),
                    (-5, 150_000, "1km"), (1_500_000, 0, "1km"), (0, -1_500_000, "1km"), (-1_500_000, -1, "1km"),
                    (-1_500_000, 0, "1km"), (99_999.9, 99_999.9, "1m"), (100_000.0, 0, "1m"),
                    (-8_899_000, 1_000, "1km"), (10_000_000, 0, "10m"), (0.3, 0.7, "1m"), (-0.0, -0.0, "1m"),
                    (123456.789, -9999999.999, "1m"), (7e-7, -7e-7, "1m")]:
        grid_codes.append({"x": x, "y": y, "p": p, "r": attempt(av.encode_grid, "TRZ", x, y, p)})
    out["encode_grid"] = grid_codes

    # ---- (b) decode ---------------------------------------------------------------
    codes = sorted({c["ok"] for e in encodes + forced for c in e["codes"].values() if "ok" in c})
    decodes = []
    for code in codes:
        anchor, x, y = av.decode_grid(code)
        lat, lon = av.from_grid(anchor, x, y)
        decodes.append({"code": code, "lat": lat, "lon": lon, "d6": list(av.decode(code)),
                        "dist_anchor": av.distance_from_anchor_m(code), "parse": _parse(code)})
    out["decode"] = decodes

    # ---- (c) describe -------------------------------------------------------------
    sample = rnd.sample(codes, 500) + ["TRZ-D04200355", "IPC-K104561248302", "TRZ-A00000000",
                                        "TRZ-D0000", "TRZ-A00250025", "TRZ-A0000", "TRZ-B00050005"]
    # codes whose distance lands on formatting ties (x.x5 km / x.5 km)
    for i in range(0, 40):
        sample.append(str(av.OAVGCode("TRZ", "ABCD"[i % 4], 0, i * 5, 0, 5)))
        sample.append(str(av.OAVGCode("LAX", "ABCD"[i % 4], 1, 12345 + i, 0, 2)))
    out["describe"] = [{"code": c, "s": av.describe(c)} for c in sample]

    # ---- (d) move / shorten / cell_polygon / distance ----------------------------
    moves = [{"code": "TRZ-D04200355", "e": e, "n": n, "r": attempt(av.move, "TRZ-D04200355", e, n)}
             for e, n in ((0, 50), (0, -50), (50, 0), (-50, 0), (430, 0), (10, -7))]
    moves += [{"code": c, "e": e, "n": n, "r": attempt(av.move, c, e, n)}
              for c, e, n in (("TRZ-A9900", 1, 0), ("TRZ-E100000", -1, 0), ("TRZ-D00000331", 1, 0),
                              ("TRZ-C00000000", 1, 1), ("TRZ-L99990001", -1, 0))]
    for code in rnd.sample(codes, 400):
        scale = rnd.choice((1, 10, 1000, 100000, 10 ** 7))
        e, n = rnd.randint(-scale, scale), rnd.randint(-scale, scale)
        moves.append({"code": code, "e": e, "n": n, "r": attempt(av.move, code, e, n)})
    out["move"] = moves

    shortens = []
    for code in rnd.sample(codes, 300) + ["TRZ-D0420303554"]:
        for p in PRECS:
            shortens.append({"code": code, "p": p, "r": attempt(av.shorten, code, p)})
    out["shorten"] = shortens

    out["polygon"] = [{"code": c, "poly": [list(pt) for pt in av.cell_polygon(c)]}
                      for c in rnd.sample(codes, 300) + ["TRZ-D04200355"]]

    pairs = [("TRZ-D04200355", "TRZ-D04200405"), ("TRZ-D04200355", av.encode(13.0, 80.2))]
    pairs += [tuple(rnd.sample(codes, 2)) for _ in range(300)]
    out["distance"] = [{"a": a, "b": b, "d": av.distance(a, b)} for a, b in pairs]
    dm = [[10.0, 20.0, -10.0, -160.0], [0.0, 0.0, 0.5, 179.7], [0.0, 0.0, 0.0, 180.0], [1, 2, 1, 2]]
    dm += [[rnd.uniform(-90, 90), rnd.uniform(-180, 180), rnd.uniform(-90, 90), rnd.uniform(-180, 180)]
           for _ in range(300)]
    for _ in range(50):  # nearly antipodal
        la, lo = rnd.uniform(-60, 60), rnd.uniform(-180, 180)
        dm.append([la, lo, -la + rnd.uniform(-0.3, 0.3), ((lo + 180 + rnd.uniform(-0.3, 0.3) + 180) % 360) - 180])
    out["distance_m"] = [{"args": a, "d": av.distance_m(*a)} for a in dm]

    # ---- (e) invalid codes / inputs ---------------------------------------------
    bad = ["TRZD04200355", "TRZ-M04200355", "TRZ-D0420035", "TRZ-D033", "TRZ-D042003550000", "TRZ-E0100",
           "TRZ-E050050", "TRZ-D042.03550", "XXX-D04200355", "TRZ-D0420O355", "",
           "TRZ-D٠٤٢٠٠٣٥٥", "ıpc-k104561248302",
           "TRZ-D０４２００３５５", "A" * 1000,
           "bad", "TRZ-D0420.0355.", "TRZ-.04200355", "TRZ-I0000000000", "TRZ-L0000000000000",
           "TRZ-D 04200355", "TRZ-D04200355x", "TR-D04200355", "TRZZ-D04200355", "TRZ_D04200355",
           "TRZ-D0420\t0355", "it's-bad", "TRZ-E0990009900", "TRZ-A" + "0" * 36]
    out["invalid"] = [{"code": c, "err": attempt(av.parse, c)["err"]} for c in bad]
    ok_odd = ["TRZ-D04200355\n\n", "  trz-d0420.0355  ", "trz-d0420.0355", "\tTRZ-D04200355\n", "TRZ-D04200355\x1f",
              "ipc-k104561248302", "TRZ-A00000000"]
    out["parse_ok"] = [{"code": c, "p": _parse(c)} for c in ok_odd]
    out["bad_encode"] = [
        {"args": [91, 0, "10m"], "err": attempt(av.encode, 91, 0).get("err")},
        {"args": [10.7950461, 78.6793020, "5m"], "err": attempt(av.encode, 10.7950461, 78.6793020, "5m").get("err")},
        {"args": [0, -181, "10m"], "err": attempt(av.encode, 0, -181).get("err")},
    ]

    # retired anchor behaviour
    reg = dict(av.registry())
    reg["QQQ"] = av.Anchor("QQQ", "Closed", 10.5, 78.5, "retired")
    av.use_registry(reg)
    out["retired"] = {"decode": list(av.decode_grid("QQQ-A00000000")[1:]),
                      "latlon": list(av.from_grid("QQQ", *av.decode_grid("QQQ-A00000000")[1:])),
                      "forced_err": attempt(av.encode, 10.5, 78.5, anchor="QQQ").get("err"),
                      "nearest": av.encode(10.5, 78.5)}
    av.use_registry(av.load_registry())
    json.dump(out, sys.stdout, separators=(",", ":"), ensure_ascii=False)


def _parse(code):
    c = av.parse(code)
    return {"anchor": c.anchor, "sector": c.sector, "band": c.band, "letter": c.letter, "x": c.x, "y": c.y,
            "base": c.base, "digits": c.digits, "cellSize": c.cell_size_m, "precision": c.precision,
            "display": c.display(), "code": str(c)}


if __name__ == "__main__":
    main()
