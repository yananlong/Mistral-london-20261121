#!/usr/bin/env python3
"""Download the offline London map tiles that LocateScreen renders via LocalTile.

Blueprint (BLUEPRINT_1.md, "Locate"): download map tiles for the demo region
before the disaster, e.g. from OpenStreetMap. This script does exactly that:
it pulls standard OSM raster tiles for a small zoom pyramid over the demo
region and stores them where the app bundle expects them:

    phone/app/maptiles/london/{z}/{x}/{y}.jpg   (or .png without `sips`)

Bundling for the native shells (see phone/TESTFLIGHT.md):
  - iOS: add phone/app/maptiles/ to the app target in Xcode (folder reference),
    so the bundle root contains maptiles/london/...
  - Android: copy phone/app/maptiles/ into android/app/src/main/assets/

`src/locate/tiles.ts` TILE_PATH_TEMPLATE must match the extension produced
here (.jpg when macOS `sips` converts, .png otherwise).

Tile usage: one-off hackathon fetch of a few hundred tiles with a proper
User-Agent and throttling. Do NOT bulk-download bigger areas from
tile.openstreetmap.org (usage policy); for larger regions use a commercial
or self-hosted tile service. Map data (c) OpenStreetMap contributors (ODbL) -
the app shows the attribution on the map.

Usage: python3 scripts/fetch_map_tiles.py [--out DIR] [--max-zoom 16] [--keep-png]
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

# --- Demo region (must match src/locate/tiles.ts) ---------------------------
DEMO_CENTER = (51.5074, -0.1278)          # lat, lon - central London (BLUEPRINT example coords)
FULL_BOUNDS = (-0.52, 51.28, 0.34, 51.72)  # minLon, minLat, maxLon, maxLat - greater London
CORE_HALF = 0.05                            # central detail area half-size in degrees
TINY_HALF = 0.015                           # highest-zoom core half-size
MIN_ZOOM = 11
DEFAULT_MAX_ZOOM = 16

TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
USER_AGENT = "firefish-demo/1.0 (https://github.com/yananlong/Mistral-london-20261121)"
ATTRIBUTION = "(c) OpenStreetMap contributors"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def lon2x(lon, z):
    return (lon + 180.0) / 360.0 * 2 ** z


def lat2y(lat, z):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * 2 ** z


def tile_range(bounds, z):
    minlon, minlat, maxlon, maxlat = bounds
    x0 = int(math.floor(lon2x(minlon, z)))
    x1 = int(math.floor(lon2x(maxlon, z)))
    y0 = int(math.floor(lat2y(maxlat, z)))
    y1 = int(math.floor(lat2y(minlat, z)))
    return x0, x1, y0, y1


def bounds_for_zoom(z, max_zoom):
    lat, lon = DEMO_CENTER
    if z <= 12:
        return FULL_BOUNDS
    if z <= max_zoom - 1:
        return (lon - CORE_HALF, lat - CORE_HALF, lon + CORE_HALF, lat + CORE_HALF)
    return (lon - TINY_HALF, lat - TINY_HALF, lon + TINY_HALF, lat + TINY_HALF)


def fetch_one(session_headers, url, dest, min_interval, lock, state):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        with lock:
            state["skipped"] += 1
        return
    for attempt in range(5):
        with lock:
            wait = max(0.0, min_interval - (time.monotonic() - state["last"]))
            time.sleep(wait)
            state["last"] = time.monotonic()
        try:
            req = urllib.request.Request(url, headers=session_headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                if r.status != 200:
                    raise RuntimeError(f"HTTP {r.status}")
                data = r.read()
            # OSM serves an "Access blocked" placeholder image instead of
            # failing cleanly; a real tile is a PNG of a sane size.
            if not data.startswith(PNG_SIGNATURE) or len(data) < 1000:
                raise RuntimeError(f"not a real tile ({len(data)}B, blocked?)")
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "wb") as f:
                f.write(data)
            with lock:
                state["downloaded"] += 1
            return
        except Exception as e:  # noqa: BLE001 - retry any fetch error
            # A 403/429 means the tile server rate-limited us: back off hard.
            time.sleep(5.0 if "403" in str(e) or "429" in str(e) else 1.0 * (attempt + 1))
            if attempt == 4:
                with lock:
                    state["failed"] += 1
                    state["errors"].append(f"{url}: {e}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "maptiles"))
    ap.add_argument("--min-zoom", type=int, default=MIN_ZOOM)
    ap.add_argument("--max-zoom", type=int, default=DEFAULT_MAX_ZOOM)
    ap.add_argument("--keep-png", action="store_true", help="do not convert to JPEG with sips")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    tiles = []  # (z, x, y)
    for z in range(args.min_zoom, args.max_zoom + 1):
        x0, x1, y0, y1 = tile_range(bounds_for_zoom(z, args.max_zoom), z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                tiles.append((z, x, y))
    print(f"Fetching {len(tiles)} tiles (z{args.min_zoom}-z{args.max_zoom}) into {out}")

    headers = {"User-Agent": USER_AGENT}
    lock = threading.Lock()
    state = {"last": 0.0, "downloaded": 0, "skipped": 0, "failed": 0, "errors": []}
    jobs = []
    for z, x, y in tiles:
        url = TILE_URL.format(z=z, x=x, y=y)
        dest = os.path.join(out, "london", str(z), str(x), f"{y}.png")
        jobs.append((url, dest))
    # Stay well under OSM's tile-usage-policy rate (~2 req/s sustained max).
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda j: fetch_one(headers, j[0], j[1], 0.55, lock, state), jobs))
    print(f"downloaded={state['downloaded']} skipped={state['skipped']} failed={state['failed']}")
    for e in state["errors"][:10]:
        print("  ERR", e, file=sys.stderr)

    ext = ".png"
    if not args.keep_png and shutil.which("sips"):
        converted = 0
        for z, x, y in tiles:
            png = os.path.join(out, "london", str(z), str(x), f"{y}.png")
            jpg = png[:-4] + ".jpg"
            if not os.path.exists(png):
                continue
            r = subprocess.run(
                ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "80", png, "--out", jpg],
                capture_output=True,
            )
            if r.returncode == 0 and os.path.exists(jpg):
                os.remove(png)
                converted += 1
            else:
                print(f"  sips failed for {png}, keeping PNG", file=sys.stderr)
        if converted:
            ext = ".jpg"
        print(f"converted {converted} tiles to JPEG q80")
    elif not args.keep_png:
        print("sips not found: keeping PNG (set TILE_PATH_TEMPLATE extension to .png)", file=sys.stderr)

    total = 0
    count = 0
    for root, _dirs, files in os.walk(out):
        for f in files:
            if f.endswith((".png", ".jpg")):
                total += os.path.getsize(os.path.join(root, f))
                count += 1
    manifest = {
        "source": TILE_URL,
        "attribution": ATTRIBUTION,
        "demoCenter": {"lat": DEMO_CENTER[0], "lon": DEMO_CENTER[1]},
        "fullBounds": FULL_BOUNDS,
        "zooms": [args.min_zoom, args.max_zoom],
        "tileCount": count,
        "bytes": total,
        "extension": ext,
        "generatedUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"done: {count} tiles, {total/1e6:.1f} MB, template 'maptiles/london/{{z}}/{{x}}/{{y}}{ext}'")
    print(json.dumps(manifest, indent=2))
    if state["failed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
