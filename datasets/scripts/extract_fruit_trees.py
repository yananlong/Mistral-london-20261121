"""Extract mapped fruit/nut trees, orchards and poisonous trees from an OSM .pbf.

Only trees whose OSM species/genus tag maps to an entry in phone/foraging/species.json are kept.
This is a "where to look" map built from named, mapped trees; it never identifies a plant.
Hazard trees (yew, cherry laurel, horse chestnut, laburnum, holly) are kept too, so the app can warn.

  phone/foraging/trees.geojson   Point features: species_id, edibility, match (species|genus), osm_taxon
  phone/foraging/orchards.geojson  landuse=orchard centroids (community orchards, allotments)

Usage: .tools/venv/bin/python -I scripts/extract_fruit_trees.py hub/osm/greater-london-latest.osm.pbf phone/foraging
Data © OpenStreetMap contributors, ODbL 1.0.
"""
import collections
import json
import re
import sys
from pathlib import Path

import osmium

KB = Path(__file__).resolve().parent.parent / "phone/foraging/species.json"

# normalised "genus species" (or "genus") -> species_id. Exact binomials first, then genus fallbacks.
# Ornamental-only taxa (Callery pear, Japanese flowering cherries, whitebeam, bird cherry) are left out on purpose.
SPECIES = {
    "malus domestica": "apple", "malus sylvestris": "crab_apple", "malus": "crab_apple",
    "pyrus communis": "pear",
    "prunus avium": "wild_cherry", "prunus cerasus": "wild_cherry", "prunus domestica": "plum",
    "prunus insititia": "plum", "prunus cerasifera": "cherry_plum", "prunus spinosa": "sloe",
    "prunus laurocerasus": "cherry_laurel",
    "crataegus monogyna": "hawthorn", "crataegus oxycantha": "hawthorn", "crataegus laevigata": "hawthorn",
    "sorbus aucuparia": "rowan", "sorbus auccuparia": "rowan",
    "sambucus nigra": "elder", "corylus avellana": "hazel", "corylus colurna": "hazel",
    "castanea sativa": "sweet_chestnut", "aesculus": "horse_chestnut",
    "juglans regia": "walnut", "juglans nigra": "walnut", "morus": "mulberry", "ficus carica": "fig",
    "mespilus germanica": "medlar", "amelanchier": "serviceberry",
    "taxus": "yew", "laburnum": "laburnum", "ilex aquifolium": "holly", "ilex": "holly",
}
# genus-level keys apply to any species in the genus (e.g. all Aesculus are toxic); others need the binomial
GENUS_WIDE = {k for k in SPECIES if " " not in k}


def norm(taxon):
    t = taxon.lower().replace("×", " ").replace("'", " ")
    t = re.sub(r"\bx\b", " ", t)
    words = [w for w in re.split(r"\s+", t) if w.isalpha()]
    return words


def classify(tags):
    raw = tags.get("species") or tags.get("taxon") or tags.get("genus") or ""
    w = norm(raw)
    if not w:
        return None, None, raw
    if len(w) >= 2 and f"{w[0]} {w[1]}" in SPECIES:
        return SPECIES[f"{w[0]} {w[1]}"], "species", raw
    if w[0] in GENUS_WIDE:
        return SPECIES[w[0]], ("genus" if len(w) == 1 else "species"), raw
    return None, None, raw


def main(pbf, outdir):
    kb = {s["id"]: s for s in json.loads(KB.read_text())["species"]}
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    trees, orchards, counts = [], [], collections.Counter()
    for obj in osmium.FileProcessor(pbf).with_locations().with_areas():
        tags = dict(obj.tags)
        if obj.is_node() and tags.get("natural") == "tree":
            sid, match, raw = classify(tags)
            if not sid:
                continue
            sp = kb[sid]
            counts[sid] += 1
            props = {"id": f"n{obj.id}", "species_id": sid, "common_name": sp["common_names"][0],
                     "edibility": sp["edibility"], "match": match, "osm_taxon": raw}
            trees.append({"type": "Feature", "properties": props, "geometry": {
                "type": "Point", "coordinates": [round(obj.location.lon, 6), round(obj.location.lat, 6)]}})
        elif obj.is_area() and tags.get("landuse") == "orchard":
            pts = [(n.lon, n.lat) for ring in obj.outer_rings() for n in ring]
            if not pts:
                continue
            lon, lat = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            oid = f"w{obj.orig_id()}" if obj.from_way() else f"r{obj.orig_id()}"
            orchards.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
                             "properties": {"id": oid, "name": tags.get("name"), "access": tags.get("access"),
                                            "trees": tags.get("trees"), "produce": tags.get("produce")}})
    meta = {"attribution": "© OpenStreetMap contributors, ODbL 1.0",
            "warning": "Mapped trees can be wrong, felled or ornamental cultivars. Confirm on site; never eat on the map alone. "
                       "Respect access: private gardens and most park trees need permission."}
    for name, fs in (("trees", trees), ("orchards", orchards)):
        (out / f"{name}.geojson").write_text(json.dumps({"type": "FeatureCollection", **meta, "features": fs},
                                                        ensure_ascii=False, separators=(",", ":")))
    for sid, n in counts.most_common():
        print(f"{sid:18s} {kb[sid]['edibility']:24s} {n:6d}")
    print(f"trees {len(trees)}, orchards {len(orchards)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
