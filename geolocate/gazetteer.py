"""Look up place names in the offline gazetteer (SQLite on the phone and the Spark, JSON for the golden tests).

Both back ends expose the same four primitives; the fuzzy matching on top of them is shared and is the same
algorithm as phone/app/src/locate/geo/gazetteer.ts.
"""
import json
import math
import sqlite3

from normalize import normalize

KINDS = ("street", "bus_stop", "station", "poi", "landmark", "district")


def metres(lat1, lon1, lat2, lon2):
    """Equirectangular distance; within 0.1% of haversine at city scale."""
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6371000.0 * math.hypot(x, y)


def levenshtein(a, b, limit):
    """Edit distance, or limit + 1 as soon as it must exceed limit."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        best = cur[0]
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
            best = min(best, cur[j])
        if best > limit:
            return limit + 1
        prev = cur
    return prev[-1]


def district_compatible(sign, place):
    """'SW1' on a sign matches 'SW1A' in the gazetteer; 'SW1' does not match 'SW19'."""
    if not sign or not place:
        return True
    return place == sign or (place.startswith(sign) and place[len(sign):len(sign) + 1].isalpha())


class Gazetteer:
    MAX_MATCHES = 400

    def match(self, norm, districts=()):
        """Places whose name matches `norm`, each with a match score in (0, 1].

        Exact normalised match scores 1. Otherwise names that share the first three characters and are
        within max(1, len // 6) edits score 1 - edits / len. Postcode districts printed on the sign drop
        places in other districts, and keep places with no known district at 0.7."""
        if len(norm) < 3:
            return []
        rows = [(p, 1.0) for p in self.by_norm(norm)]
        if not rows:
            limit = max(1, len(norm) // 6)
            for p in self.by_key3(norm[:3]):
                d = levenshtein(norm, p["norm"], limit)
                if d <= limit:
                    rows.append((p, 1.0 - d / max(len(norm), len(p["norm"]))))
        out = []
        for p, s in rows:
            if districts:
                if not p["district"]:
                    s *= 0.7
                elif not any(district_compatible(d, p["district"]) for d in districts):
                    continue
            out.append((p, s))
        out.sort(key=lambda x: -x[1])
        return out[: self.MAX_MATCHES]

    def place_points(self, place):
        pts = self.points(place["id"]) if place["kind"] == "street" else []
        return pts or [(place["lat"], place["lon"])]


class SqliteGazetteer(Gazetteer):
    def __init__(self, path):
        self.db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        self.db.row_factory = sqlite3.Row

    def _rows(self, sql, args):
        return [dict(r) for r in self.db.execute(sql, args)]

    def by_norm(self, norm):
        return self._rows("SELECT * FROM places WHERE norm = ?", (norm,))

    def by_key3(self, key3):
        return self._rows("SELECT * FROM places WHERE key3 = ?", (key3,))

    def points(self, place_id):
        return [tuple(r) for r in self.db.execute("SELECT lat, lon FROM points WHERE place_id = ?", (place_id,))]

    def features_near(self, kind, lat, lon, radius_m):
        dlat = radius_m / 111320.0
        dlon = dlat / max(0.2, math.cos(math.radians(lat)))
        return [tuple(r) for r in self.db.execute(
            "SELECT lat, lon FROM features WHERE kind = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?",
            (kind, lat - dlat, lat + dlat, lon - dlon, lon + dlon))]


class MemoryGazetteer(Gazetteer):
    """The golden-test fixture: {"places": [...], "points": {"<id>": [[lat, lon], ...]}, "features": [[kind, lat, lon]]}."""

    def __init__(self, data):
        if isinstance(data, str):
            data = json.load(open(data))
        self.places = []
        for p in data["places"]:
            p = dict(p)
            p.setdefault("norm", normalize(p["name"]))
            p.setdefault("district", None)
            p.setdefault("ref", None)
            self.places.append(p)
        self._points = {int(k): [tuple(x) for x in v] for k, v in data.get("points", {}).items()}
        self._features = [tuple(f) for f in data.get("features", [])]

    def by_norm(self, norm):
        return [p for p in self.places if p["norm"] == norm]

    def by_key3(self, key3):
        return [p for p in self.places if p["norm"][:3] == key3]

    def points(self, place_id):
        return self._points.get(place_id, [])

    def features_near(self, kind, lat, lon, radius_m):
        return [(a, b) for k, a, b in self._features if k == kind and metres(lat, lon, a, b) <= radius_m]
