"""Extract emergency-relevant POIs from an OSM .pbf into GeoJSON + SQLite.

Output is platform-neutral so the same files ship in the Android and iOS apps:
  phone/pois/<category>.geojson      one FeatureCollection per category
  phone/pois/london_pois.sqlite      table `pois` (both platforms ship SQLite)

Usage: .tools/venv/bin/python -I scripts/extract_pois.py hub/osm/greater-london-latest.osm.pbf phone/pois
Data © OpenStreetMap contributors, ODbL 1.0.
"""
import json
import sqlite3
import sys
from pathlib import Path

import osmium

# category -> list of (key, value or None for "any value")
CATEGORIES = {
    "aed": [("emergency", "defibrillator")],
    "medical": [("amenity", v) for v in ("hospital", "pharmacy", "doctors", "clinic", "dentist")]
               + [("healthcare", "pharmacy"), ("healthcare", "hospital")],
    "water": [("amenity", "drinking_water"), ("amenity", "water_point"),
              ("man_made", "water_tap"), ("natural", "spring")],
    "toilets": [("amenity", "toilets")],
    "shelter": [("emergency", "assembly_point"), ("amenity", "shelter"),
                ("social_facility", "shelter"), ("amenity", "community_centre"),
                ("amenity", "library"), ("amenity", "place_of_worship")],
    "food": [("shop", "supermarket"), ("shop", "convenience"), ("amenity", "food_sharing"),
             ("amenity", "give_box"), ("social_facility", "food_bank")],
    "power": [("amenity", "charging_station")],
    "fuel": [("amenity", "fuel")],
    "emergency_services": [("amenity", "police"), ("amenity", "fire_station"),
                           ("emergency", "ambulance_station")],
}
KEEP_TAGS = {"name", "opening_hours", "phone", "website", "addr:street", "addr:housenumber",
             "addr:postcode", "wheelchair", "access", "indoor", "level", "description",
             "defibrillator:location", "drinking_water", "fee", "operator", "brand",
             "dispensing", "emergency", "healthcare", "religion", "capacity"}


def classify(tags):
    for cat, rules in CATEGORIES.items():
        for k, v in rules:
            if tags.get(k) == v:
                return cat, f"{k}={v}"
    return None, None


def centroid(coords):
    if not coords:
        return None
    return (sum(c[0] for c in coords) / len(coords), sum(c[1] for c in coords) / len(coords))


def main(pbf, outdir):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    feats = {c: [] for c in CATEGORIES}

    fp = osmium.FileProcessor(pbf).with_locations().with_areas()
    for obj in fp:
        tags = dict(obj.tags)
        cat, sub = classify(tags)
        if not cat:
            continue
        if obj.is_node():
            lonlat, oid = (obj.location.lon, obj.location.lat), f"n{obj.id}"
        elif obj.is_way():
            pts = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
            lonlat, oid = centroid(pts), f"w{obj.id}"
        elif obj.is_area() and not obj.from_way():
            pts = [(n.lon, n.lat) for ring in obj.outer_rings() for n in ring]
            lonlat, oid = centroid(pts), f"r{obj.orig_id()}"
        else:
            continue  # areas built from ways were already handled as ways
        if not lonlat:
            continue
        props = {"id": oid, "category": cat, "type": sub}
        props.update({k: v for k, v in tags.items() if k in KEEP_TAGS})
        feats[cat].append({"type": "Feature",
                           "geometry": {"type": "Point", "coordinates": [round(lonlat[0], 6), round(lonlat[1], 6)]},
                           "properties": props})

    db_path = out / "london_pois.sqlite"
    db_path.unlink(missing_ok=True)
    db = sqlite3.connect(db_path)
    db.executescript("""
        CREATE TABLE pois (id TEXT PRIMARY KEY, category TEXT NOT NULL, type TEXT NOT NULL,
                           name TEXT, lat REAL NOT NULL, lon REAL NOT NULL,
                           opening_hours TEXT, tags TEXT NOT NULL);
        CREATE INDEX pois_cat_lat_lon ON pois(category, lat, lon);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    """)
    for cat, fs in feats.items():
        (out / f"{cat}.geojson").write_text(json.dumps(
            {"type": "FeatureCollection",
             "attribution": "© OpenStreetMap contributors, ODbL 1.0",
             "features": fs}, ensure_ascii=False, separators=(",", ":")))
        for f in fs:
            p = f["properties"]
            lon, lat = f["geometry"]["coordinates"]
            db.execute("INSERT OR IGNORE INTO pois VALUES (?,?,?,?,?,?,?,?)",
                       (p["id"], cat, p["type"], p.get("name"), lat, lon, p.get("opening_hours"),
                        json.dumps(p, ensure_ascii=False)))
        print(f"{cat:20s} {len(fs):6d}")
    db.executemany("INSERT INTO meta VALUES (?,?)",
                   [("source", Path(pbf).name), ("licence", "ODbL 1.0"),
                    ("attribution", "© OpenStreetMap contributors")])
    db.commit()
    db.execute("VACUUM")
    db.close()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
