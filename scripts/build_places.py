#!/usr/bin/env python3
"""Build api/_data/places.json (villages, hamlets, neighbourhoods) from an OpenStreetMap
Overpass export.

Input : data-raw/tn_places.json   (Overpass "raw data" JSON: {"elements":[{type,id,lat,lon,tags}]})
Output: api/_data/places.json     {source, license, coverage, fields, rows}

Data (c) OpenStreetMap contributors, ODbL 1.0. The output file is a derived database and
must stay under ODbL (keep it open, keep the credit). Do not mix private data into it.

Usage:  py scripts/build_places.py [--in data-raw/tn_places.json]
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data-raw" / "tn_places.json"
OUT = ROOT / "api" / "_data" / "places.json"

TYPES = {"town", "suburb", "village", "hamlet", "neighbourhood", "quarter", "locality", "isolated_dwelling"}
BOX = (8.0, 13.6, 76.2, 80.4)                 # Tamil Nadu, generous
TAMIL = re.compile(r"[஀-௿]")
LATIN = re.compile(r"[A-Za-z]")
DUP_M = 300                                    # same name within 300 m = same place


def km(a, b, c, d):
    p = math.pi / 180
    x = (d - b) * p * math.cos((a + c) / 2 * p)
    y = (c - a) * p
    return 6371.0 * math.hypot(x, y)


def pick_names(tags):
    """Return (english/latin name, tamil name). Either may be ''."""
    name = (tags.get("name") or "").strip()
    en = (tags.get("name:en") or "").strip()
    ta = (tags.get("name:ta") or "").strip()
    if not en and name and LATIN.search(name) and not TAMIL.search(name):
        en = name
    if not ta and name and TAMIL.search(name):
        ta = name
    if not en and name and TAMIL.search(name) and LATIN.search(name):   # "Olaiyur ஒலையூர்"
        en = TAMIL.sub("", name).strip(" -/()")
    en = re.sub(r"\s{2,}", " ", en).strip(" .,-")
    if en.isupper() or en.islower():
        en = en.title()
    return en, ta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default=str(SRC))
    args = ap.parse_args()
    src = Path(args.src)
    if not src.exists():
        sys.exit(f"Missing {src}. Export it from overpass-turbo.eu first (see README).")
    try:
        data = json.loads(src.read_text(encoding="utf-8"))
    except ValueError:
        sys.exit(f"{src.name} is not OpenStreetMap data (probably a server error page). "
                 "Run: py scripts/fetch_places.py")
    els = data.get("elements", [])

    rows, skipped = [], {"no_type": 0, "no_name": 0, "outside": 0}
    for e in els:
        if e.get("type") != "node" or "lat" not in e:
            continue
        t = e.get("tags", {})
        typ = t.get("place", "")
        if typ not in TYPES:
            skipped["no_type"] += 1
            continue
        lat, lon = float(e["lat"]), float(e["lon"])
        if not (BOX[0] <= lat <= BOX[1] and BOX[2] <= lon <= BOX[3]):
            skipped["outside"] += 1
            continue
        en, ta = pick_names(t)
        if not en and not ta:
            skipped["no_name"] += 1
            continue
        rows.append([en or ta, ta, typ, round(lat, 6), round(lon, 6), int(e["id"])])

    # merge Tamil-only points into a Latin-named twin within DUP_M metres (same place mapped twice)
    cell = lambda la, lo: (int(la * 100), int(lo * 100))          # ~1 km buckets
    buckets = {}
    for r in rows:
        if LATIN.search(r[0]):
            buckets.setdefault(cell(r[3], r[4]), []).append(r)
    kept = []
    for r in rows:
        if LATIN.search(r[0]):
            kept.append(r)
            continue
        ci, cj = cell(r[3], r[4])
        twin = None
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for c in buckets.get((ci + di, cj + dj), []):
                    if km(c[3], c[4], r[3], r[4]) * 1000 < DUP_M:
                        twin = c
        if twin is not None:
            if not twin[1]:
                twin[1] = r[1] or r[0]
        else:
            kept.append(r)
    rows = kept

    # de-duplicate: same (lower) name within DUP_M metres -> keep the first
    rows.sort(key=lambda r: (r[0].lower(), r[3], r[4]))
    out = []
    for r in rows:
        if out and out[-1][0].lower() == r[0].lower() and km(out[-1][3], out[-1][4], r[3], r[4]) * 1000 < DUP_M:
            continue
        out.append(r)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "source": "OpenStreetMap contributors",
        "license": "ODbL 1.0 (https://opendatacommons.org/licenses/odbl/)",
        "coverage": "Tamil Nadu",
        "fields": ["name", "name_ta", "type", "lat", "lon", "osm_id"],
        "rows": out,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by = {}
    for r in out:
        by[r[2]] = by.get(r[2], 0) + 1
    print(f"read {len(els)} elements -> {len(rows)} named places -> {len(out)} unique "
          f"({', '.join(f'{k} {v}' for k, v in sorted(by.items()))})  skipped {skipped}")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
