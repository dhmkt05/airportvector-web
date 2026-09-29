#!/usr/bin/env python3
"""Download Tamil Nadu places from OpenStreetMap (Overpass API) into data-raw/tn_places.json,
check the result is real data, then run build_places.py.

Usage:  py scripts/fetch_places.py
Data (c) OpenStreetMap contributors, ODbL 1.0.
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUERY = (ROOT / "scripts" / "tn_places.overpassql").read_text(encoding="utf-8")
OUT = ROOT / "data-raw" / "tn_places.json"
SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
HEADERS = {
    "User-Agent": "AirportVector/1.0 (+https://airportvector.org)",
    "Accept": "application/json, */*",
}


def fetch(url):
    full = url + "?" + urllib.parse.urlencode({"data": QUERY})
    req = urllib.request.Request(full, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=400) as r:
        return r.read()


def main():
    OUT.parent.mkdir(exist_ok=True)
    for url in SERVERS:
        print(f"Downloading from {url} (can take 1-3 minutes)...", flush=True)
        t = time.time()
        try:
            body = fetch(url)
        except urllib.error.HTTPError as e:
            print(f"  failed: HTTP {e.code} {e.reason}")
            continue
        except Exception as e:  # network, timeout
            print(f"  failed: {e}")
            continue
        try:
            data = json.loads(body)
            n = len(data["elements"])
        except Exception:
            print(f"  failed: server did not return data ({len(body)} bytes): {body[:120]!r}")
            continue
        if n < 1000:
            print(f"  failed: only {n} places - server probably timed out, trying next")
            continue
        OUT.write_bytes(body)
        print(f"  OK: {n} places, {len(body) // 1024} KB in {time.time() - t:.0f}s -> {OUT.relative_to(ROOT)}")
        break
    else:
        sys.exit("All servers failed. Wait a few minutes and run again.")

    print("Building api/_data/places.json ...", flush=True)
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_places.py")], check=True)


if __name__ == "__main__":
    main()
