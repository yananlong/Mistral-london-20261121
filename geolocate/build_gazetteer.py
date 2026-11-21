"""Build the offline London gazetteer that the phone uses to turn what the camera reads into a position.

Input is the Geofabrik Greater London extract that datasets/scripts/fetch_all.sh already downloads.
Output is one SQLite file that ships with the phone tier (both iOS and Android ship SQLite):

  places(id, kind, name, norm, key3, ref, district, lat, lon, osm)
      kind = street | bus_stop | station | poi | landmark | district
      norm = normalised name (geolocate/normalize.py; phone/app/src/locate/geo/normalize.ts is the same rules)
      key3 = first 3 characters of norm, indexed, so fuzzy lookups only scan names that start the same way
      ref  = bus stop letter (OSM local_ref, e.g. "C"), station network, or poi type
      district = postcode district (e.g. "SW1A" -> stored as "SW1A"; streets get the commonest district of
                 the addresses on that street within the cluster)
  points(place_id, lat, lon)
      extra sample points along each street cluster (about every 30 m), so "near Whitehall" means near the
      street itself, not near its centroid
  features(kind, lat, lon)
      unnamed street furniture the detector can see: post_box, telephone, bus_stop, traffic_signals,
      defibrillator, pharmacy, fire_hydrant, station_entrance
  meta(key, value)

Usage:
  datasets/.tools/venv/bin/python -I geolocate/build_gazetteer.py \
      datasets/hub/osm/greater-london-latest.osm.pbf datasets/phone/geo/london_gazetteer.sqlite
Data (c) OpenStreetMap contributors, ODbL 1.0.
"""
import math
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

import osmium

sys.path.insert(0, str(Path(__file__).resolve().parent))
from normalize import DISTRICT_RE, normalize  # noqa: E402

STREET_HIGHWAYS = {"motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential",
                   "living_street", "pedestrian", "service", "footway", "cycleway", "path", "steps", "road",
                   "trunk_link", "primary_link", "secondary_link", "tertiary_link"}
# footway/path/service ways are only kept when they carry a name, which in London means a real alley,
# court or mews that has its own street sign.
POI_AMENITY = {"pub", "bar", "restaurant", "cafe", "fast_food", "bank", "pharmacy", "place_of_worship",
               "school", "college", "university", "library", "cinema", "theatre", "hospital", "police",
               "fire_station", "post_office", "community_centre", "townhall", "marketplace", "arts_centre"}
FEATURES = {
    ("amenity", "post_box"): "post_box",
    ("amenity", "telephone"): "telephone",
    ("highway", "bus_stop"): "bus_stop",
    ("highway", "traffic_signals"): "traffic_signals",
    ("emergency", "defibrillator"): "defibrillator",
    ("amenity", "pharmacy"): "pharmacy",
    ("emergency", "fire_hydrant"): "fire_hydrant",
    ("railway", "subway_entrance"): "station_entrance",
    ("railway", "train_station_entrance"): "station_entrance",
}
SAMPLE_M = 30.0          # keep a street point at least this far from the previous kept one
CLUSTER_M = 250.0        # ways with the same name closer than this are one street
DISTRICT_SEARCH_M = 600  # addresses this close to a street cluster vote on its postcode district


def metres(lat1, lon1, lat2, lon2):
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000.0 * math.hypot(x, y)


def district_of(postcode):
    if not postcode:
        return None
    m = DISTRICT_RE.match(postcode.strip().upper())
    return m.group(0) if m else None


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways_by_name = defaultdict(list)   # norm -> [(display name, [(lat, lon), ...])]
        self.named = []                          # (kind, name, ref, district, lat, lon, osm)
        self.features = []                       # (kind, lat, lon)
        self.addresses = defaultdict(list)       # norm street -> [(lat, lon, district)]

    def _point(self, kind, name, ref, tags, lat, lon, osm):
        self.named.append((kind, name, ref, district_of(tags.get("addr:postcode")), lat, lon, osm))

    def _common(self, tags, lat, lon, osm):
        for (k, v), kind in FEATURES.items():
            if tags.get(k) == v:
                self.features.append((kind, lat, lon))
        street, pc = tags.get("addr:street"), district_of(tags.get("addr:postcode"))
        if street and pc:
            self.addresses[normalize(street)].append((lat, lon, pc))
        name = tags.get("name")
        if not name:
            return
        if tags.get("highway") == "bus_stop" or (tags.get("public_transport") == "platform" and tags.get("bus") == "yes"):
            self._point("bus_stop", name, tags.get("local_ref") or tags.get("naptan:Indicator"), tags, lat, lon, osm)
        elif tags.get("railway") in ("station", "halt") or tags.get("public_transport") == "station":
            self._point("station", name, tags.get("network") or tags.get("operator"), tags, lat, lon, osm)
        elif tags.get("tourism") in ("attraction", "museum", "gallery", "viewpoint") or "historic" in tags \
                or tags.get("man_made") in ("tower", "clock", "obelisk") or tags.get("leisure") == "park" \
                or tags.get("place") in ("square",) or tags.get("building") in ("cathedral", "church"):
            self._point("landmark", name, tags.get("tourism") or tags.get("historic") or tags.get("leisure"),
                        tags, lat, lon, osm)
        elif tags.get("amenity") in POI_AMENITY or "shop" in tags or tags.get("tourism") == "hotel":
            self._point("poi", name, tags.get("amenity") or ("shop=" + tags["shop"] if "shop" in tags else "hotel"),
                        tags, lat, lon, osm)

    def node(self, n):
        if not n.tags:
            return
        tags = dict(n.tags)
        self._common(tags, n.location.lat, n.location.lon, f"n{n.id}")

    def way(self, w):
        tags = dict(w.tags)
        if not tags:
            return
        try:
            pts = [(nd.lat, nd.lon) for nd in w.nodes if nd.location.valid()]
        except osmium.InvalidLocationError:
            return
        if not pts:
            return
        hw = tags.get("highway")
        if hw in STREET_HIGHWAYS and tags.get("name") and tags.get("area") != "yes":
            self.ways_by_name[normalize(tags["name"])].append((tags["name"], pts))
            return
        if hw:
            return
        lat = sum(p[0] for p in pts) / len(pts)
        lon = sum(p[1] for p in pts) / len(pts)
        self._common(tags, lat, lon, f"w{w.id}")


def cluster_ways(ways):
    """Join ways with the same name into street clusters: union-find over ways that put a node in the same
    or a neighbouring CLUSTER_M grid cell, so the order the ways arrive in does not matter."""
    parent = list(range(len(ways)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    kx = 111320.0 * math.cos(math.radians(51.5))
    owner = {}
    for i, (_, pts) in enumerate(ways):
        for lat, lon in pts:
            cx, cy = int(lon * kx // CLUSTER_M), int(lat * 111320.0 // CLUSTER_M)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    j = owner.get((cx + dx, cy + dy))
                    if j is not None:
                        parent[find(i)] = find(j)
            owner.setdefault((cx, cy), i)
    groups = defaultdict(list)
    for i, (name, pts) in enumerate(ways):
        groups[find(i)].append((name, pts))
    clusters = []
    for members in groups.values():
        name = Counter(n for n, _ in members).most_common(1)[0][0]
        clusters.append([name, [p for _, pts in members for p in pts]])
    return clusters


def sample(pts):
    kept = [pts[0]]
    for p in pts[1:]:
        if metres(kept[-1][0], kept[-1][1], p[0], p[1]) >= SAMPLE_M:
            kept.append(p)
    return kept


def main(pbf, out):
    c = Collector()
    c.apply_file(pbf, locations=True, idx="flex_mem")
    print(f"named ways {sum(len(v) for v in c.ways_by_name.values())} under {len(c.ways_by_name)} names, "
          f"named points {len(c.named)}, features {len(c.features)}", file=sys.stderr)

    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        out.unlink()
    db = sqlite3.connect(out)
    db.executescript("""
        CREATE TABLE places (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, norm TEXT NOT NULL,
                             key3 TEXT NOT NULL, ref TEXT, district TEXT, lat REAL NOT NULL, lon REAL NOT NULL, osm TEXT);
        CREATE TABLE points (place_id INTEGER NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL);
        CREATE TABLE features (kind TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    """)

    district_pts = defaultdict(list)
    for addrs in c.addresses.values():
        for lat, lon, d in addrs:
            district_pts[d].append((lat, lon))

    n_streets = n_points = 0
    for norm, ways in c.ways_by_name.items():
        if not norm:
            continue
        addrs = c.addresses.get(norm, [])
        for name, pts in cluster_ways(ways):
            pts = sample(pts)
            lat = sum(p[0] for p in pts) / len(pts)
            lon = sum(p[1] for p in pts) / len(pts)
            votes = Counter(d for alat, alon, d in addrs
                            if any(metres(alat, alon, p[0], p[1]) < DISTRICT_SEARCH_M for p in pts[::4] + [pts[-1]]))
            district = votes.most_common(1)[0][0] if votes else None
            cur = db.execute("INSERT INTO places (kind,name,norm,key3,ref,district,lat,lon,osm) VALUES (?,?,?,?,?,?,?,?,?)",
                             ("street", name, norm, norm[:3], None, district, lat, lon, None))
            db.executemany("INSERT INTO points VALUES (?,?,?)", [(cur.lastrowid, p[0], p[1]) for p in pts])
            n_streets += 1
            n_points += len(pts)

    for kind, name, ref, district, lat, lon, osm in c.named:
        norm = normalize(name)
        if norm:
            db.execute("INSERT INTO places (kind,name,norm,key3,ref,district,lat,lon,osm) VALUES (?,?,?,?,?,?,?,?,?)",
                       (kind, name, norm, norm[:3], ref, district, lat, lon, osm))

    # Postcode districts as places too: a sign that shows only "SW1" still narrows the search.
    for d, pts in district_pts.items():
        if len(pts) < 5:
            continue
        lat = sorted(p[0] for p in pts)[len(pts) // 2]
        lon = sorted(p[1] for p in pts)[len(pts) // 2]
        db.execute("INSERT INTO places (kind,name,norm,key3,ref,district,lat,lon,osm) VALUES (?,?,?,?,?,?,?,?,?)",
                   ("district", d, d.lower(), d.lower()[:3], str(len(pts)), d, lat, lon, None))

    db.executemany("INSERT INTO features VALUES (?,?,?)", c.features)
    db.executescript("""
        CREATE INDEX places_key3 ON places(key3);
        CREATE INDEX places_norm ON places(norm);
        CREATE INDEX points_place ON points(place_id);
        CREATE INDEX features_kind_lat ON features(kind, lat);
    """)
    db.executemany("INSERT INTO meta VALUES (?,?)", [
        ("source", Path(pbf).name), ("licence", "ODbL 1.0"), ("attribution", "(c) OpenStreetMap contributors"),
        ("normalize_version", "1"), ("streets", str(n_streets)), ("street_points", str(n_points)),
    ])
    db.commit()
    counts = db.execute("SELECT kind, COUNT(*) FROM places GROUP BY kind").fetchall()
    fcounts = db.execute("SELECT kind, COUNT(*) FROM features GROUP BY kind").fetchall()
    db.execute("VACUUM")
    db.close()
    print("places", dict(counts), "\nfeatures", dict(fcounts), f"\n{out} {out.stat().st_size / 1e6:.1f} MB", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
