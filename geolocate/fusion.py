"""Fuse everything the phone knows into one position estimate, with no network.

Inputs (the JSON contract the phone uses too; phone/app/src/locate/geo/types.ts has the same shapes):

  scenes:  one per photo, from geolocate/perceive.py on the Spark or the phone's perception module
    {"image": {"w", "h", "hfov_deg"?}, "heading_deg"?: compass heading when the photo was taken,
     "lines":   [{"text", "conf", "box"?: [x1, y1, x2, y2], "kind"?: "street"|"bus_stop"|"station"|"poi"|"landmark"}],
     "objects": [{"label", "conf", "box"}]}          # detector output, labels from perceive.VOCAB
  sensors:
    {"gnss"?:      {"lat", "lon", "acc_m", "age_s"},  # a satellite fix, if there is one
     "last_fix"?:  {"lat", "lon", "acc_m", "age_s"},  # the last good fix, when there is no current one
     "walked_m"?:  metres walked since last_fix, from the step counter
     "peers"?:     [{"name", "lat", "lon", "age_s"}], # peers heard DIRECTLY over Bluetooth that shared a loc: line
     "hub"?:       {"lat", "lon"}}                    # the hub's surveyed position, when it is heard directly

Output:
  {"status": "fix"|"ambiguous"|"no_evidence", "lat", "lon", "accuracy_m", "confidence",
   "evidence": [...], "alternatives": [...], "heading_deg", "heading_source"}

Method: every piece of evidence is a likelihood over the map. Text that matches the gazetteer is a mixture
of Gaussians around the matched places (around every sample point of a street); GNSS is a Gaussian; the
last fix plus walking is a disk; a peer or the hub heard over Bluetooth is a Gaussian of radio range;
a detected post box or phone box is a weak bonus where OSM has one within 40 m. Candidates are the
matched points and sensor anchors; the best few are refined on a 12 m grid; confidence is the best
hypothesis against the best hypothesis of every other 120 m cluster. A small floor (EPS) on every text
likelihood means one misread sign cannot veto the rest.
"""
import math

from gazetteer import metres
from normalize import districts_in, is_generic, is_region_line, normalize

SIGMA_M = {"street": 35.0, "bus_stop": 30.0, "station": 120.0, "poi": 40.0, "landmark": 250.0, "district": 1200.0}
EPS_TEXT = 0.02
EPS_PEER = 0.05
WALK_MPS = 1.4
BLE_SIGMA_M = 50.0
HUB_SIGMA_M = 80.0
PEER_MAX_AGE_S = 900
# detector label -> gazetteer feature kind; labels not here (hazards, cars) do not affect position
OBJECT_FEATURE = {"post_box": "post_box", "telephone_box": "telephone", "bus_stop_sign": "bus_stop",
                  "traffic_light": "traffic_signals", "station_sign": "station_entrance", "pharmacy_sign": "pharmacy",
                  "defibrillator": "defibrillator"}
OBJECT_RADIUS_M = 40.0
OBJECT_MISS = 0.35
MAX_POINTS_PER_PLACE = 60
CLUSTER_M = 120.0
REFINE_TOP = 5
REFINE_STEP_M = 12.0
REFINE_HALF = 4
CELL_M = 250.0
FIX_CONFIDENCE = 0.6


# ---------------------------------------------------------------- text -> observations

def _box(line):
    b = line.get("box")
    return b if b and len(b) == 4 else None


def sign_chains(lines):
    """Group OCR lines into sign blocks: a line continues the line above it when it starts within 1.2 line
    heights below it and overlaps it horizontally by 30%. Lines without a box (VLM output) are their own block."""
    items = [l for l in lines if l.get("text", "").strip() and not is_region_line(l["text"])]
    boxed = sorted([l for l in items if _box(l)], key=lambda l: (l["box"][1], l["box"][0]))
    chains = [[l] for l in items if not _box(l)]
    below, has_above = {}, set()
    for i, a in enumerate(boxed):
        ax1, ay1, ax2, ay2 = a["box"]
        ah, aw = max(1.0, ay2 - ay1), max(1.0, ax2 - ax1)
        best = None
        for j, b in enumerate(boxed):
            if j == i or j in has_above:
                continue
            bx1, by1, bx2, by2 = b["box"]
            gap = by1 - ay2
            if not (-0.5 * ah <= gap <= 1.2 * ah) or by1 <= (ay1 + ay2) / 2:
                continue
            overlap = min(ax2, bx2) - max(ax1, bx1)
            if overlap < 0.3 * min(aw, max(1.0, bx2 - bx1)):
                continue
            if best is None or gap < best[0]:
                best = (gap, j)
        if best:
            below[i] = best[1]
            has_above.add(best[1])
    for i in range(len(boxed)):
        if i in has_above:
            continue
        chain, k = [boxed[i]], i
        while k in below and len(chain) < 3:
            k = below[k]
            chain.append(boxed[k])
        chains.append(chain)
    return chains


def _phrase(chain):
    text = " ".join(l["text"].strip() for l in chain)
    conf = min(float(l.get("conf", 1.0)) for l in chain)
    boxes = [l["box"] for l in chain if _box(l)]
    box = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)] if boxes else None
    kind = next((l["kind"] for l in chain if l.get("kind")), None)
    return text, conf, box, kind


def _query(gaz, text, kind_hint):
    districts = districts_in(text)
    name = text.upper()
    for d in districts:
        name = name.replace(d, " ")
    norm = normalize(name)
    if len(norm) < 3 or is_generic(norm):
        return norm, districts, []
    if len(norm) <= 4:  # short words: exact matches only
        matches = [(p, s) for p, s in gaz.match(norm, districts) if s == 1.0]
    else:
        matches = gaz.match(norm, districts)
    if kind_hint:
        matches = [(p, s * (1.0 if p["kind"] == kind_hint else 0.6)) for p, s in matches]
    return norm, districts, matches


def observations_from_scene(gaz, scene):
    """One observation per sign block: the sub-phrase of the block that matches best (longer wins ties)."""
    out = []
    for chain in sign_chains(scene.get("lines", [])):
        best, used = None, set()
        for i in range(len(chain)):
            for j in range(len(chain), i, -1):
                text, conf, box, kind = _phrase(chain[i:j])
                norm, districts, matches = _query(gaz, text, kind)
                if not matches:
                    continue
                q = max(s for _, s in matches)
                key = (round(q, 1), len(norm.split()), q)
                if best is None or key > best[0]:
                    best = (key, dict(text=text, norm=norm, districts=districts, conf=conf, box=box,
                                      matches=matches), set(range(i, j)))
        if not best:
            continue
        out.append(best[1])
        used = best[2]
        # a confident whole-line match outside the chosen phrase is its own observation (shop name + street)
        for i, line in enumerate(chain):
            if i in used:
                continue
            text, conf, box, kind = _phrase([line])
            norm, districts, matches = _query(gaz, text, kind)
            if matches and max(s for _, s in matches) >= 0.9:
                out.append(dict(text=text, norm=norm, districts=districts, conf=conf, box=box, matches=matches))
    return out


# ---------------------------------------------------------------- likelihoods

class TextEvidence:
    """Mixture of Gaussians around every matched point, with a spatial hash so a candidate only looks nearby."""

    def __init__(self, gaz, obs, lat0):
        self.obs = obs
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.cells = {}
        self.points = []
        for place, s in obs["matches"]:
            pts = gaz.place_points(place)
            if len(pts) > MAX_POINTS_PER_PLACE:
                step = len(pts) / MAX_POINTS_PER_PLACE
                pts = [pts[int(k * step)] for k in range(MAX_POINTS_PER_PLACE)]
            sigma = SIGMA_M.get(place["kind"], 60.0)
            q = s * max(0.3, min(1.0, obs["conf"]))
            for lat, lon in pts:
                rec = (lat, lon, q, sigma, place)
                self.points.append(rec)
                self.cells.setdefault(self._cell(lat, lon), []).append(rec)
        widest = max((r[3] for r in self.points), default=0.0)
        self.reach = int(math.ceil(3 * widest / CELL_M))  # cells to search around a candidate

    def _cell(self, lat, lon):
        return int(math.floor(lon * self.kx / CELL_M)), int(math.floor(lat * 111320.0 / CELL_M))

    def best(self, lat, lon):
        """(value, point record) of the matched point that explains (lat, lon) best."""
        cx, cy = self._cell(lat, lon)
        top, top_rec = 0.0, None
        for dx in range(-self.reach, self.reach + 1):
            for dy in range(-self.reach, self.reach + 1):
                for rec in self.cells.get((cx + dx, cy + dy), ()):
                    d = metres(lat, lon, rec[0], rec[1])
                    if d > 3 * rec[3]:
                        continue
                    v = rec[2] * math.exp(-d * d / (2 * rec[3] * rec[3]))
                    if v > top:
                        top, top_rec = v, rec
        return top, top_rec

    def log_like(self, lat, lon):
        return math.log(EPS_TEXT + (1 - EPS_TEXT) * self.best(lat, lon)[0])


def _gauss_log(d, sigma, eps):
    return math.log(eps + (1 - eps) * math.exp(-d * d / (2 * sigma * sigma)))


def sensor_log_like(sensors, lat, lon):
    ll = 0.0
    g = sensors.get("gnss")
    if g:
        sigma = max(5.0, float(g.get("acc_m", 20))) + WALK_MPS * float(g.get("age_s", 0))
        ll += _gauss_log(metres(lat, lon, g["lat"], g["lon"]), sigma, 0.01)
    f = sensors.get("last_fix")
    if f and not g:
        walked = sensors.get("walked_m")
        reach = float(f.get("acc_m", 20)) + (float(walked) * 1.1 if walked is not None else WALK_MPS * float(f.get("age_s", 0)))
        d = metres(lat, lon, f["lat"], f["lon"])
        ll += 0.0 if d <= reach else -((d - reach) ** 2) / (2 * 40.0 ** 2)
    for p in sensors.get("peers", []) or []:
        if float(p.get("age_s", 0)) > PEER_MAX_AGE_S:
            continue
        sigma = BLE_SIGMA_M + WALK_MPS * float(p.get("age_s", 0))
        ll += _gauss_log(metres(lat, lon, p["lat"], p["lon"]), sigma, EPS_PEER)
    h = sensors.get("hub")
    if h:
        ll += _gauss_log(metres(lat, lon, h["lat"], h["lon"]), HUB_SIGMA_M, EPS_PEER)
    return ll


def object_log_like(gaz, objects, lat, lon):
    ll = 0.0
    for o in objects:
        kind = OBJECT_FEATURE.get(o["label"])
        if not kind:
            continue
        if not gaz.features_near(kind, lat, lon, OBJECT_RADIUS_M):
            ll += math.log(1 - min(0.9, float(o["conf"])) * (1 - OBJECT_MISS))
    return ll


def _anchors(sensors):
    pts = []
    for key in ("gnss", "last_fix", "hub"):
        if sensors.get(key):
            pts.append((sensors[key]["lat"], sensors[key]["lon"]))
    for p in sensors.get("peers", []) or []:
        if float(p.get("age_s", 0)) <= PEER_MAX_AGE_S:
            pts.append((p["lat"], p["lon"]))
    return pts


def bearing(lat1, lon1, lat2, lon2):
    y = math.sin(math.radians(lon2 - lon1)) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - \
        math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(math.radians(lon2 - lon1))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


# ---------------------------------------------------------------- the estimate

def estimate(gaz, scenes=(), sensors=None):
    sensors = sensors or {}
    obs = [dict(o, scene=i) for i, s in enumerate(scenes) for o in observations_from_scene(gaz, s)]
    objects = [o for s in scenes for o in s.get("objects", [])]
    anchors = _anchors(sensors)
    if not obs and not anchors:
        return {"status": "no_evidence", "evidence": [], "alternatives": [],
                "read": [l["text"] for s in scenes for l in s.get("lines", [])]}

    lat0 = anchors[0][0] if anchors else obs[0]["matches"][0][0]["lat"]
    evid = [TextEvidence(gaz, o, lat0) for o in obs]

    def score(lat, lon, with_objects=False):
        s = sensor_log_like(sensors, lat, lon) + sum(e.log_like(lat, lon) for e in evid)
        return s + object_log_like(gaz, objects, lat, lon) if with_objects else s

    cands = {(round(p[0], 6), round(p[1], 6)) for e in evid for p in e.points} | set(anchors)
    scored = sorted(((score(*c), c) for c in cands), reverse=True)

    # pick the best candidate of each distinct 120 m cluster, refine the top few on a grid
    heads = []
    for s, c in scored:
        if all(metres(c[0], c[1], h[1][0], h[1][1]) > CLUSTER_M for h in heads):
            heads.append((s, c))
        if len(heads) >= REFINE_TOP * 4:
            break
    refined = []
    for s, (lat, lon) in heads[:REFINE_TOP]:
        dlat = REFINE_STEP_M / 111320.0
        dlon = dlat / math.cos(math.radians(lat))
        grid = [(lat + i * dlat, lon + j * dlon) for i in range(-REFINE_HALF, REFINE_HALF + 1)
                for j in range(-REFINE_HALF, REFINE_HALF + 1)]
        pts = sorted(((score(a, b, True), (a, b)) for a, b in grid), reverse=True)
        refined.append(pts)
    others = [(s + object_log_like(gaz, objects, *c), c) for s, c in heads[REFINE_TOP:]]
    hyps = sorted([(pts[0][0], pts[0][1], pts) for pts in refined] + [(s, c, None) for s, c in others],
                  key=lambda h: -h[0])
    # merge hypotheses that refined into the same place
    merged = []
    for h in hyps:
        if all(metres(h[1][0], h[1][1], m[1][0], m[1][1]) > CLUSTER_M for m in merged):
            merged.append(h)
    top_s, (lat, lon), grid = merged[0]
    weights = [math.exp(h[0] - top_s) for h in merged]
    confidence = 1.0 / sum(weights)

    # accuracy: spread of the refined grid around the best point, floored by the tightest evidence used
    if grid:
        w = [(math.exp(s - top_s), c) for s, c in grid]
        tot = sum(x for x, _ in w)
        mlat = sum(x * c[0] for x, c in w) / tot
        mlon = sum(x * c[1] for x, c in w) / tot
        spread = math.sqrt(sum(x * metres(mlat, mlon, c[0], c[1]) ** 2 for x, c in w) / tot)
        lat, lon = mlat, mlon
    else:
        spread = CLUSTER_M

    evidence, floors, headings = [], [], []
    for o, e in zip(obs, evid):
        v, rec = e.best(lat, lon)
        if not rec or v < 0.05:
            evidence.append({"source": "text", "read": o["text"], "matched": None})
            continue
        d = metres(lat, lon, rec[0], rec[1])
        place = rec[4]
        floors.append(min(rec[3], 60.0))
        evidence.append({"source": "text", "read": o["text"], "matched": place["name"], "kind": place["kind"],
                         "district": place.get("district"), "ref": place.get("ref"), "distance_m": round(d)})
    g = sensors.get("gnss")
    if g:
        floors.append(max(5.0, float(g.get("acc_m", 20))))
        evidence.append({"source": "gnss", "acc_m": g.get("acc_m"), "distance_m": round(metres(lat, lon, g["lat"], g["lon"]))})
    if sensors.get("last_fix") and not g:
        f = sensors["last_fix"]
        evidence.append({"source": "last_fix", "age_s": f.get("age_s"), "walked_m": sensors.get("walked_m"),
                         "distance_m": round(metres(lat, lon, f["lat"], f["lon"]))})
    for p in sensors.get("peers", []) or []:
        if float(p.get("age_s", 0)) <= PEER_MAX_AGE_S:
            evidence.append({"source": "peer", "name": p.get("name"), "distance_m": round(metres(lat, lon, p["lat"], p["lon"]))})
            floors.append(BLE_SIGMA_M)
    if sensors.get("hub"):
        h = sensors["hub"]
        evidence.append({"source": "hub", "distance_m": round(metres(lat, lon, h["lat"], h["lon"]))})
        floors.append(HUB_SIGMA_M)
    for o in objects:
        kind = OBJECT_FEATURE.get(o["label"])
        if kind:
            near = gaz.features_near(kind, lat, lon, OBJECT_RADIUS_M)
            evidence.append({"source": "object", "label": o["label"], "conf": o["conf"], "osm_nearby": bool(near)})

    # heading: the compass if it was read; otherwise from a recognised place's direction in the photo
    heading, heading_source = None, None
    for s in scenes:
        if s.get("heading_deg") is not None:
            heading, heading_source = float(s["heading_deg"]) % 360, "compass"
    if heading is None:
        for o, e, ev in zip(obs, evid, evidence):
            v, rec = e.best(lat, lon)
            if not rec or not o["box"] or rec[4]["kind"] == "street" or ev.get("distance_m", 0) < 60:
                continue
            img = scenes[o["scene"]].get("image") or {}
            if not img.get("w") or not img.get("hfov_deg"):
                continue
            cx = (o["box"][0] + o["box"][2]) / 2 / img["w"]
            headings.append((bearing(lat, lon, rec[0], rec[1]) - (cx - 0.5) * img["hfov_deg"]) % 360)
        if headings:
            heading, heading_source = sorted(headings)[len(headings) // 2], "landmark_in_photo"

    accuracy = max(spread, min(floors) if floors else 50.0, 10.0)
    alternatives = []
    for h, wgt in zip(merged[1:4], weights[1:4]):
        if wgt * confidence < 0.02:
            continue
        near = [e.best(h[1][0], h[1][1])[1] for e in evid]
        label = ", ".join(sorted({r[4]["name"] + (f" ({r[4]['district']})" if r[4].get("district") else "") for r in near if r}))
        alternatives.append({"lat": round(h[1][0], 5), "lon": round(h[1][1], 5),
                             "confidence": round(wgt * confidence, 3), "label": label or None})
    explained = any(e.get("matched") for e in evidence) or g or sensors.get("last_fix") or sensors.get("peers") or sensors.get("hub")
    status = "fix" if confidence >= FIX_CONFIDENCE and explained else ("ambiguous" if explained else "no_evidence")
    return {"status": status, "lat": round(lat, 5), "lon": round(lon, 5), "accuracy_m": round(accuracy),
            "confidence": round(confidence, 3), "evidence": evidence, "alternatives": alternatives,
            "heading_deg": None if heading is None else round(heading), "heading_source": heading_source}


def describe(est):
    """One short plain-language paragraph for the Locate screen (and for the mesh, if the user shares it)."""
    if est["status"] == "no_evidence":
        return "Could not work out where you are from this. Try a street sign, a bus stop or a station name."
    parts = []
    for e in est["evidence"]:
        if e["source"] == "text" and e.get("matched"):
            extra = f" stop {e['ref']}" if e["kind"] == "bus_stop" and e.get("ref") else ""
            parts.append(f"read \"{e['read']}\" = {e['matched']}{extra}" + (f" {e['district']}" if e.get("district") else ""))
        elif e["source"] == "gnss":
            parts.append(f"satellite fix ±{e['acc_m']} m")
        elif e["source"] == "last_fix":
            parts.append(f"last fix {round((e['age_s'] or 0) / 60)} min ago")
        elif e["source"] == "peer":
            parts.append(f"near {e['name']}")
        elif e["source"] == "hub":
            parts.append("in range of the hub")
    head = "Probably here" if est["status"] == "fix" else "Not sure. Best guess"
    s = f"{head} (±{est['accuracy_m']} m): " + "; ".join(parts) + "."
    if est["alternatives"]:
        s += " Also possible: " + "; ".join(a["label"] or f"{a['lat']},{a['lon']}" for a in est["alternatives"][:2]) + "."
    if est.get("heading_deg") is not None:
        s += f" Facing about {est['heading_deg']}° ({est['heading_source'].replace('_', ' ')})."
    return s
