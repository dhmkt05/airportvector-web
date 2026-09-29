"""Build the locality table used by /api/v1/locality from the India Post PIN code directory.

Source: "All India Pincode Directory with contact details along with Latitude and Longitude",
India Post via data.gov.in (Government Open Data License - India). Put the CSV at data-raw/pincode.csv.

    python scripts/build_localities.py            # Tamil Nadu (pilot)
    python scripts/build_localities.py --all      # all of India

Cleaning rules (a wrong locality name is worse than none):
  * keep rows with coordinates inside the state's bounding box
  * drop branch offices (BO) whose coordinates duplicate another office (placeholder positions)
  * drop offices more than 80 km from their district's median position
  * strip "S.O", "B.O", "H.O" suffixes, tidy capitalisation, de-duplicate
"""
import csv, json, math, re, statistics, sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data-raw" / "pincode.csv"
OUT = ROOT / "api" / "_data" / "localities.json"
STATES = {"TAMIL NADU": (8.0, 13.6, 76.2, 80.4)}   # lat_min, lat_max, lon_min, lon_max
INDIA = (6.0, 37.2, 68.0, 97.5)

SUFFIX = re.compile(r"\s+(?:g\.?\s?p\.?\s?o|s\.?\s?o|b\.?\s?o|h\.?\s?o|mdg|ndtso)\b.*$", re.I)


def clean_name(raw: str) -> str:
    name = SUFFIX.sub("", raw.strip()).strip(" .,-")
    if name.isupper() or name.islower():
        name = name.title()
    return re.sub(r"\s{2,}", " ", name)


def km(a, b, c, d):
    p1, p2 = math.radians(a), math.radians(c)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(d - b) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1, math.sqrt(h)))


def main(all_india: bool) -> None:
    rows = []
    with open(SRC, newline="", encoding="utf-8", errors="replace") as fh:
        for r in csv.DictReader(fh):
            r = {k.strip().lower(): (v or "").strip() for k, v in r.items()}
            state = r.get("statename", "").upper()
            try:
                lat, lon = float(r.get("latitude") or "x"), float(r.get("longitude") or "x")
            except ValueError:
                continue
            box = INDIA if all_india else STATES.get(state)
            if not box or not (box[0] <= lat <= box[1] and box[2] <= lon <= box[3]):
                continue
            rows.append({"name": clean_name(r.get("officename", "")), "type": r.get("officetype", "").upper(),
                         "pin": r.get("pincode", ""), "district": r.get("district", "").title(),
                         "state": state.title(), "lat": round(lat, 6), "lon": round(lon, 6)})
    n0 = len(rows)

    # placeholder coordinates: several offices at exactly the same point -> keep only non-BO offices there
    at = defaultdict(list)
    for r in rows:
        at[(r["lat"], r["lon"])].append(r)
    kept = []
    for group in at.values():
        kept += group if len(group) == 1 else [r for r in group if r["type"] != "BO"]
    n1 = len(kept)

    # outliers: far from the district's median position
    by_d = defaultdict(list)
    for r in kept:
        by_d[r["district"]].append(r)
    final = []
    for group in by_d.values():
        mlat = statistics.median(r["lat"] for r in group)
        mlon = statistics.median(r["lon"] for r in group)
        final += [r for r in group if km(r["lat"], r["lon"], mlat, mlon) <= 80]
    n2 = len(final)

    # de-duplicate same name + PIN
    seen, out = set(), []
    for r in sorted(final, key=lambda r: (r["type"] == "BO", r["name"])):
        key = (r["name"].lower(), r["pin"])
        if r["name"] and key not in seen:
            seen.add(key)
            out.append([r["name"], r["lat"], r["lon"], r["pin"], r["district"], r["state"], r["type"]])
    out.sort(key=lambda x: (x[5], x[4], x[0]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "source": "India Post, All India Pincode Directory (data.gov.in), Government Open Data License - India",
        "fields": ["name", "lat", "lon", "pin", "district", "state", "office_type"],
        "coverage": "India" if all_india else "Tamil Nadu",
        "rows": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"read {n0} -> placeholder-free {n1} -> outlier-free {n2} -> unique {len(out)}  ->  {OUT.relative_to(ROOT)} "
          f"({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main("--all" in sys.argv)
