"""Cut a bbox out of a remote PMTiles archive using HTTP range requests.

Pure-Python stand-in for `pmtiles extract`. Output is a normal PMTiles v3 file
that MapLibre Native (Android + iOS) opens via a pmtiles:// source.

Usage: .tools/venv/bin/python -I scripts/extract_pmtiles.py URL OUT.pmtiles MINLON MINLAT MAXLON MAXLAT MAXZOOM
Map data © OpenStreetMap contributors (ODbL); basemap by Protomaps.
"""
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import requests
from pmtiles.reader import Reader, deserialize_directory, find_tile
from pmtiles.tile import zxy_to_tileid
from pmtiles.writer import Writer

url, out = sys.argv[1], sys.argv[2]
minlon, minlat, maxlon, maxlat = map(float, sys.argv[3:7])
maxzoom = int(sys.argv[7])
session = requests.Session()


@lru_cache(maxsize=4096)  # directory ranges repeat across tiles
def get_bytes(offset, length):
    for attempt in range(5):
        r = session.get(url, headers={"Range": f"bytes={offset}-{offset + length - 1}"}, timeout=60)
        if r.status_code == 206:
            return r.content
    r.raise_for_status()
    raise RuntimeError(f"range request failed: {r.status_code}")


def lon2x(lon, z):
    return int((lon + 180) / 360 * 2 ** z)


def lat2y(lat, z):
    rad = math.radians(lat)
    return int((1 - math.asinh(math.tan(rad)) / math.pi) / 2 * 2 ** z)


reader = Reader(get_bytes)
header = reader.header()
metadata = reader.metadata()


@lru_cache(maxsize=4096)  # Reader.get re-parses every directory per tile; parse each once
def directory(offset, length):
    return deserialize_directory(get_bytes(offset, length))


def get_tile(z, x, y):
    tid = zxy_to_tileid(z, x, y)
    off, length = header["root_offset"], header["root_length"]
    for _ in range(4):
        e = find_tile(directory(off, length), tid)
        if not e:
            return None
        if e.run_length == 0:
            off, length = header["leaf_directory_offset"] + e.offset, e.length
        else:
            return get_bytes(header["tile_data_offset"] + e.offset, e.length)
    return None

coords = []
for z in range(0, maxzoom + 1):
    for x in range(lon2x(minlon, z), lon2x(maxlon, z) + 1):
        for y in range(lat2y(maxlat, z), lat2y(minlat, z) + 1):
            coords.append((zxy_to_tileid(z, x, y), z, x, y))
coords.sort()
print(f"{len(coords)} tiles to fetch")

# warm the directory cache sequentially, then fetch tiles in parallel
def fetch(c):
    return c[0], get_tile(c[1], c[2], c[3])

for c in coords[:: max(1, len(coords) // 50)]:
    fetch(c)
with ThreadPoolExecutor(16) as pool:
    tiles = list(pool.map(fetch, coords))

with open(out, "wb") as f:
    w = Writer(f)
    n = 0
    for tid, data in tiles:
        if data:
            w.write_tile(tid, data)
            n += 1
    header.update({
        "min_zoom": 0, "max_zoom": maxzoom,
        "min_lon_e7": int(minlon * 1e7), "min_lat_e7": int(minlat * 1e7),
        "max_lon_e7": int(maxlon * 1e7), "max_lat_e7": int(maxlat * 1e7),
        "center_zoom": min(12, maxzoom),
        "center_lon_e7": int((minlon + maxlon) / 2 * 1e7),
        "center_lat_e7": int((minlat + maxlat) / 2 * 1e7),
    })
    w.finalize(header, metadata)
print(f"wrote {n} tiles to {out}")
