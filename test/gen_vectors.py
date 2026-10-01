"""Generate parity vectors from the Python reference implementation (airportvector v4).

Usage:  python3 web/test/gen_vectors.py  >  web/test/vectors.json
"""
import json
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True  # leave the library checkout untouched
for _cand in (os.environ.get("OAVG_PY_DIR", ""), os.path.join(HERE, "..", "..", "airportvector", "python", "src")):
    if _cand and os.path.exists(os.path.join(_cand, "airportvector", "__init__.py")):
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
    # every example point in the Python tests
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

    # forced-anchor encodes (test_roundtrip_every_zone_every_precision style) + to/from grid
    forced, grids = [], []
    random.seed(42)
    for anchor in ("TRZ", "LAX", "PLZ", "USH"):
        for limit in (120_000, 360_000, 3_000_000, 9_000_000):
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
    for x, y, p in [(0.0, 0.0, "4m"), (0.4, -0.4, "4m"), (-0.0, -0.0, "4m"), (0.3, 0.7, "4m"), (7e-7, -7e-7, "4m"),
                    (60_000, 60_000, "1km"), (60_000, -60_000, "1km"), (-60_000, -60_000, "1km"),
                    (-60_000, 60_000, "1km"), (0, 60_000, "1km"), (60_000, 0, "1km"), (0, -60_000, "1km"),
                    (-60_000, 0, "1km"), (121_499.9, 0, "4m"), (121_500.0, 0, "4m"), (-121_500.0, 0, "4m"),
                    (-364_499.0, 0, "1km"), (364_500.0, 1.0, "37m"), (9_841_000, 0, "4m"), (9_841_500, 0, "4m"),
                    (123456.789, -9999999.999, "4m"), (40_500.0, 40_500.0, "4m"), (-40_500.0, -40_500.0, "4m"),
                    (13_500.0, -4_500.0, "12m"), (1e-9, 1e-9, "4m"), (-1e-9, 1e-9, "4m")]:
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
    sample = rnd.sample(codes, 500) + ["TRZ-55511-79566", "IPC-84772643-65933", "TRZ-55555-55555", "TRZ-55555"]
    # codes near formatting ties (x.x5 km / x.5 km)
    for i in range(0, 40):
        sample.append(av.encode_grid("TRZ", i * 50.0, 0.0, "4m"))
        sample.append(av.encode_grid("LAX", -12_345_00.0 - i * 1000, 0.0, "1km"))
    out["describe"] = [{"code": c, "s": av.describe(c)} for c in sample]

    # ---- (d) move / shorten / cell_polygon / distance ----------------------------
    moves = [{"code": "TRZ-55511-79566", "e": e, "n": n, "r": attempt(av.move, "TRZ-55511-79566", e, n)}
             for e, n in ((0, 50), (0, -50), (50, 0), (-50, 0), (1400, 0), (10, -7))]
    edge = av.encode_grid("TRZ", 121_000.0, 0.0, "1km")
    moves += [{"code": c, "e": e, "n": n, "r": attempt(av.move, c, e, n)}
              for c, e, n in ((edge, 1, 0), (edge, 0, 0), ("TRZ-655555", -1, 0), ("TRZ-55555", 1, 1),
                              ("TRZ-55555-55555", -1, -1), (av.encode_grid("TRZ", 9_840_000, 0, "1km"), 5, 0))]
    for code in rnd.sample(codes, 400):
        scale = rnd.choice((1, 10, 1000, 100000, 10 ** 7))
        e, n = rnd.randint(-scale, scale), rnd.randint(-scale, scale)
        moves.append({"code": code, "e": e, "n": n, "r": attempt(av.move, code, e, n)})
    out["move"] = moves

    shortens = []
    for code in rnd.sample(codes, 300) + ["TRZ-55511-79566"]:
        for p in PRECS:
            shortens.append({"code": code, "p": p, "r": attempt(av.shorten, code, p)})
    out["shorten"] = shortens

    out["polygon"] = [{"code": c, "poly": [list(pt) for pt in av.cell_polygon(c)]}
                      for c in rnd.sample(codes, 300) + ["TRZ-55511-79566"]]

    pairs = [("TRZ-55511-79566", "TRZ-55511-79563"), ("TRZ-55511-79566", av.encode(13.0, 80.2))]
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
    bad = ["TRZ-5551", "TRZ-55511-795661", "TRZ-55510-79566", "TRZ-55511796660", "TRZ-1234567891-11111",
           "XXX-55511-79566", "TRZ-D04200355", "TRZ-55511-7956O", "", "TRZ-٥٥٥١١", "TRZ-５５５١١", "A" * 1000,
           "bad", "TRZ-55511-79566-1", "TRZ--", "TR-55511-79566", "TRZZ-55511-79566", "TRZ_55511_79566",
           "TRZ-55511\t79566", "it's-bad", "TRZ-55511x79566", "trz 5551", "TRZ 12345678912 12345",
           "TRZ-55511 795 66", "TRZ-" + "1" * 36]
    out["invalid"] = [{"code": c, "err": attempt(av.parse, c)["err"]} for c in bad]
    ok_odd = ["TRZ-55511-79566\n\n", "  trz 55511 79566  ", "trz5551179566", "\tTRZ-55511-79566\n",
              "TRZ-55511-79566\x1f", "ipc 84772643 65933", "TRZ-555511-79566", "TRZ 55511.795", "IMP-684476",
              "TRZ55511", "TRZ 55555"]
    out["parse_ok"] = [{"code": c, "p": _parse(c)} for c in ok_odd]
    out["bad_encode"] = [
        {"args": [91, 0, "4m"], "err": attempt(av.encode, 91, 0).get("err")},
        {"args": [10.7950461, 78.6793020, "5m"], "err": attempt(av.encode, 10.7950461, 78.6793020, "5m").get("err")},
        {"args": [0, -181, "4m"], "err": attempt(av.encode, 0, -181).get("err")},
    ]

    # retired anchor behaviour
    reg = dict(av.registry())
    reg["QQQ"] = av.Anchor("QQQ", "Closed", 10.5, 78.5, "retired")
    av.use_registry(reg)
    out["retired"] = {"decode": list(av.decode_grid("QQQ-55555-55555")[1:]),
                      "latlon": list(av.from_grid("QQQ", *av.decode_grid("QQQ-55555-55555")[1:])),
                      "forced_err": attempt(av.encode, 10.5, 78.5, anchor="QQQ").get("err"),
                      "nearest": av.encode(10.5, 78.5)}
    av.use_registry(av.load_registry())
    json.dump(out, sys.stdout, separators=(",", ":"), ensure_ascii=False)


def _parse(code):
    c = av.parse(code)
    return {"anchor": c.anchor, "coarse": c.coarse, "fine": c.fine, "extra": c.extra, "levels": c.levels,
            "zoneM": c.zone_m, "cellSize": c.cell_size_m, "precision": c.precision, "leadingFives": c.leading_fives,
            "display": c.display(), "code": str(c)}


if __name__ == "__main__":
    main()
