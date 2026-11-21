"""Hub knowledge base: dataset-grounded facts for the Ask flow.

Three offline sources, all read from the hub's datasets/ directory:

* POIs: nearest places (water, A&E, AED, shelter, ...) from
  phone/pois/london_pois.sqlite (OpenStreetMap), plus GiveFood food banks.
  Only used when the question carries a loc and asks for a place.
* Guides: BM25 over chunks of the GOV.UK broadcast scripts
  (phone/guides/govuk/*.json) and Be Ready pages (phone/guides/beready/*.html).
* Bulletin (opt-in, HUB_FEEDS_DIR): short facts from a recorded feed snapshot
  (EA floods, Met Office, GOV.UK alerts, TfL, UKPN/NGED, UKHSA). Always
  labelled as a recorded snapshot with its time, never as live.

facts(question, loc) returns a list of {"text", "source"} dicts. Python 3
standard library only; nothing here touches the network.
"""

import csv
import glob
import json
import logging
import math
import os
import re
import sqlite3
import time
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

log = logging.getLogger("hub.kb")

POI_K = 3
POI_RADIUS_M = 3000.0
FOODBANK_RADIUS_M = 5000.0
GUIDE_K = 3
GUIDE_MIN_SCORE = 7.0  # BM25; tuned on evals/HUB.md Q01-Q30
GUIDE_REL_SCORE = 0.6  # keep chunks scoring >= 60% of the best one
GUIDE_MIN_COVERAGE = 0.35  # share of the query's IDF mass a chunk must match
CHUNK_WORDS = 160
MAX_CONTEXT_CHARS = 6000  # ~1,500 tokens at ~4 chars/token

# --- POIs -------------------------------------------------------------------

PLACE_INTENT_RE = re.compile(
    r"\b(where|nearest|closest|near me|nearby|close by|which way|how far|"
    r"directions?|find|get to|locate|go to)\b",
    re.I,
)

# (category, regex, preferred OSM types or None, label). First match wins.
POI_RULES = [
    ("aed", r"\b(defib\w*|aed)\b", None, "defibrillator (AED)"),
    ("medical", r"\b(a ?& ?e|a and e|accident and emergency|emergency department|hospital)\b",
     ("amenity=hospital", "healthcare=hospital"), "hospital"),
    ("medical", r"\b(pharmac\w*|chemist)\b", ("amenity=pharmacy", "healthcare=pharmacy"), "pharmacy"),
    ("medical", r"\b(doctors?|gp|clinic|surgery|medical)\b", ("amenity=doctors", "amenity=clinic"),
     "doctor or clinic"),
    ("food", r"\bfood ?banks?\b", ("social_facility=food_bank", "amenity=food_sharing", "amenity=give_box"),
     "food bank"),
    ("water", r"\b(taps?|fountains?|drinking water|water points?|refill|water)\b", None,
     "drinking water"),
    ("shelter", r"\b(shelters?|rest cent(re|er)s?|warm (space|hub|bank)s?|community cent(re|er)|"
     r"somewhere to (sleep|stay)|assembly point)\b", None, "shelter or community space"),
    ("toilets", r"\b(toilets?|loos?|wc|lavator\w*|restrooms?|bathrooms?)\b", None, "toilet"),
    ("fuel", r"\b(fuel|petrol|diesel|filling station|gas station)\b", None, "fuel station"),
    ("emergency_services", r"\bpolice\b", ("amenity=police",), "police station"),
    ("emergency_services", r"\bfire station\b", ("amenity=fire_station",), "fire station"),
    ("emergency_services", r"\bambulance station\b", ("emergency=ambulance_station",),
     "ambulance station"),
    ("power", r"\b(charg\w*|power|electricity|socket)\b", None, "charging point"),
    ("food", r"\b(food|supermarket|shop|groceries)\b", None, "food shop"),
]
POI_RULES = [(c, re.compile(r, re.I), t, lbl) for c, r, t, lbl in POI_RULES]

COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def match_poi_rule(question):
    """Return the first (category, types, label) the question asks for, or None."""
    if not PLACE_INTENT_RE.search(question):
        return None
    for cat, rx, types, label in POI_RULES:
        if rx.search(question):
            return cat, types, label
    return None


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def bearing_compass(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    deg = (math.degrees(math.atan2(x, y)) + 360.0) % 360.0
    return COMPASS[int((deg + 22.5) // 45) % 8]


def round10(m):
    return int(round(m / 10.0) * 10)


class PoiIndex:
    def __init__(self, sqlite_path, foodbanks_path=None):
        self.path = sqlite_path
        uri = "file:%s?mode=ro" % os.path.abspath(sqlite_path)
        self.db = sqlite3.connect(uri, uri=True, check_same_thread=False)
        self.db.execute("SELECT 1 FROM pois LIMIT 1").fetchall()
        self.foodbanks = []
        if foodbanks_path and os.path.exists(foodbanks_path):
            with open(foodbanks_path, encoding="utf-8") as f:
                for feat in json.load(f).get("features", []):
                    try:
                        lon, lat = feat["geometry"]["coordinates"][:2]
                        p = feat.get("properties") or {}
                        self.foodbanks.append((float(lat), float(lon), p))
                    except (KeyError, TypeError, ValueError):
                        continue

    def nearest(self, category, lat, lon, types=None, k=POI_K, radius_m=POI_RADIUS_M):
        dlat = radius_m / 111320.0
        dlon = radius_m / (111320.0 * max(0.01, math.cos(math.radians(lat))))
        sql = ("SELECT id, type, name, lat, lon, opening_hours, tags FROM pois "
               "WHERE category = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?")
        args = [category, lat - dlat, lat + dlat, lon - dlon, lon + dlon]
        if types:
            sql += " AND type IN (%s)" % ",".join("?" * len(types))
            args += list(types)
        rows = []
        for pid, ptype, name, plat, plon, hours, tags in self.db.execute(sql, args):
            d = haversine_m(lat, lon, plat, plon)
            if d <= radius_m:
                try:
                    tags = json.loads(tags) if tags else {}
                except ValueError:
                    tags = {}
                rows.append({"id": pid, "type": ptype, "name": name, "lat": plat, "lon": plon,
                             "opening_hours": hours, "tags": tags, "dist": d,
                             "bearing": bearing_compass(lat, lon, plat, plon)})
        rows.sort(key=lambda r: r["dist"])
        return rows[:k] if k else rows

    def nearest_hospitals_ae(self, lat, lon, k=POI_K):
        rows = self.nearest("medical", lat, lon, ("amenity=hospital", "healthcare=hospital"), k=0)
        ae = [r for r in rows if str(r["tags"].get("emergency", "")).lower() == "yes"]
        return (ae[:k], True) if ae else ([r for r in rows if r["tags"].get("emergency") != "no"][:k], False)

    def nearest_foodbanks(self, lat, lon, k=POI_K, radius_m=FOODBANK_RADIUS_M):
        out = []
        for plat, plon, p in self.foodbanks:
            if abs(plat - lat) > 0.1 or abs(plon - lon) > 0.15:
                continue
            d = haversine_m(lat, lon, plat, plon)
            if d <= radius_m:
                out.append({"dist": d, "bearing": bearing_compass(lat, lon, plat, plon),
                            "lat": plat, "lon": plon, "p": p})
        out.sort(key=lambda r: r["dist"])
        return out[:k]


def describe_poi(r, label):
    name = r["name"] or "unnamed %s" % r["type"].split("=", 1)[-1].replace("_", " ")
    bits = ["%s: %d m %s of the asker" % (name, round10(r["dist"]), r["bearing"])]
    t = r["tags"]
    street = t.get("addr:street")
    if street:
        bits.append(("%s %s" % (t.get("addr:housenumber", ""), street)).strip())
    if r["opening_hours"]:
        bits.append("opening hours %s" % r["opening_hours"])
    if t.get("operator"):
        bits.append("operator %s" % t["operator"])
    if t.get("emergency") == "yes" and label == "hospital":
        bits.append("has emergency department (OSM emergency=yes)")
    bits.append("at %.5f,%.5f" % (r["lat"], r["lon"]))
    return ", ".join(bits)


# --- guides -----------------------------------------------------------------

STOPWORDS = set(
    "a about after all also am an and any are as at be been before being but by can could "
    "did do does doing don't for from had has have having he her here hers him his how i "
    "i'm if in into is it it's its just me more most my no nor not now of off on once only "
    "or other our out over own same she should so some such than that the their them then "
    "there these they this those through to too under until up very was we were what when "
    "where which while who whom why will with would you your yours can't i've we've way right now "
    "tell get got make need know help use someone something thing things please us one".split()
)
TOKEN_RE = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")


def stem(w):
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 3 and w.endswith(suf):
            return w[: -len(suf)]
    return w


def tokenize(text):
    return [stem(w) for w in TOKEN_RE.findall(text.lower().replace("’", "'"))
            if w not in STOPWORDS]


class _TextExtractor(HTMLParser):
    """Collects text as (heading, paragraph) blocks; skips script/style/nav."""

    BLOCK = {"p", "li", "h1", "h2", "h3", "h4", "td", "th", "div", "section", "tr", "br", "dd", "dt"}
    SKIP = {"script", "style", "nav", "noscript", "svg", "figure", "header", "footer", "form", "button"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []  # (kind, text) kind in {"h", "p"}
        self.buf = []
        self.skip = 0
        self.in_heading = False

    def _flush(self):
        text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        self.buf = []
        if text:
            self.blocks.append(("h" if self.in_heading else "p", text))

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self._flush()
            self.in_heading = tag in ("h1", "h2", "h3", "h4")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self._flush()
            self.in_heading = False

    def handle_data(self, data):
        if not self.skip:
            self.buf.append(data)


def html_blocks(markup):
    p = _TextExtractor()
    p.feed(markup)
    p.close()
    p._flush()
    return p.blocks


def chunk_blocks(blocks, title, size=CHUNK_WORDS):
    """Group blocks into ~size-word chunks; each chunk keeps its section heading."""
    chunks, cur, cur_words, heading = [], [], 0, ""

    def emit():
        if cur:
            chunks.append({"heading": heading, "text": " ".join(cur)})

    for kind, text in blocks:
        if kind == "h":
            emit()
            cur, cur_words, heading = [], 0, text
            continue
        words = text.split()
        while words:
            room = size - cur_words
            if room <= 0 or (cur_words and len(words) > room and cur_words >= size * 0.6):
                emit()
                cur, cur_words = [], 0
                room = size
            piece = words[:room] if len(words) > size else words
            cur.append(" ".join(piece))
            cur_words += len(piece)
            words = words[len(piece):]
    emit()
    return chunks


def load_govuk(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    body = (d.get("details") or {}).get("body") or ""
    return d.get("title") or os.path.basename(path), html_blocks(body)


def load_beready(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        s = f.read()
    start = s.find('id="main-content"')
    if start < 0:
        start = 0
    end = s.find("</article>", start)
    if end < 0:
        end = s.find("</main>", start)
    main = s[start:end if end > 0 else len(s)]
    # The page title is the first h1; drop the secondary nav and anything before the h1.
    h1 = main.find("<h1")
    if h1 >= 0:
        main = main[h1:]
    blocks = html_blocks("<div " + main if not main.startswith("<") else main)
    title = next((t for k, t in blocks if k == "h"), os.path.basename(path))
    return "Be Ready: " + title, blocks


class GuideIndex:
    """Okapi BM25 over guide chunks, built once in memory."""

    def __init__(self, guides_dir, k1=1.4, b=0.75):
        t0 = time.time()
        self.chunks = []
        files = sorted(glob.glob(os.path.join(guides_dir, "govuk", "*.json")))
        files += sorted(glob.glob(os.path.join(guides_dir, "beready", "*.html")))
        for path in files:
            try:
                title, blocks = (load_govuk if path.endswith(".json") else load_beready)(path)
            except (OSError, ValueError) as e:
                log.warning("skipping guide %s: %s", path, e)
                continue
            rel = os.path.relpath(path, os.path.dirname(os.path.dirname(guides_dir)))
            for c in chunk_blocks(blocks, title):
                if len(c["text"].split()) < 12:
                    continue
                c["title"], c["source"] = title, rel
                self.chunks.append(c)
        self.k1, self.b = k1, b
        self.tf, self.df, self.len = [], {}, []
        for c in self.chunks:
            toks = tokenize(c["title"] + " " + c["heading"] + " " + c["text"])
            tf = {}
            for t in toks:
                tf[t] = tf.get(t, 0) + 1
            self.tf.append(tf)
            self.len.append(len(toks))
            for t in tf:
                self.df[t] = self.df.get(t, 0) + 1
        n = len(self.chunks) or 1
        self.avgdl = (sum(self.len) / n) if self.len else 1.0
        self.idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in self.df.items()}
        self.build_seconds = time.time() - t0

    def search(self, query, k=GUIDE_K, min_score=GUIDE_MIN_SCORE, min_coverage=GUIDE_MIN_COVERAGE):
        q = set(tokenize(query))
        # Query terms the guides never use count at full IDF, so a question about
        # something the guides do not cover (e.g. bleeding) matches nothing.
        unseen_idf = math.log(1 + len(self.chunks) + 0.5)
        q_mass = sum(self.idf.get(t, unseen_idf) for t in q) or 1.0
        scored = []
        for i, tf in enumerate(self.tf):
            s, matched = 0.0, 0.0
            norm = self.k1 * (1 - self.b + self.b * self.len[i] / self.avgdl)
            for t in q:
                f = tf.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + norm)
                    matched += self.idf[t]
            if s > 0 and matched / q_mass >= min_coverage:
                scored.append((s, i))
        scored.sort(reverse=True)
        if not scored or scored[0][0] < min_score:
            return []
        top = scored[0][0]
        return [dict(self.chunks[i], score=round(s, 2)) for s, i in scored[:k]
                if s >= max(min_score, GUIDE_REL_SCORE * top)]


# --- recorded bulletin (opt-in) ---------------------------------------------

TFL_LINES = ["bakerloo", "central", "circle", "district", "dlr", "elizabeth", "hammersmith",
             "jubilee", "metropolitan", "northern", "piccadilly", "victoria", "waterloo",
             "overground", "liberty", "lioness", "mildmay", "suffragette", "weaver", "windrush",
             "tram"]
POSTCODE_RE = re.compile(r"\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d)([A-Z]{2})?\b", re.I)


class Bulletin:
    def __init__(self, feeds_dir):
        self.dir = feeds_dir
        self.snapshot = "unknown time"
        idx = os.path.join(feeds_dir, "_index.jsonl")
        if os.path.exists(idx):
            with open(idx, encoding="utf-8") as f:
                for line in f:
                    try:
                        ts = json.loads(line).get("fetched_utc")
                    except ValueError:
                        continue
                    if ts:
                        m = re.match(r"(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)", ts)
                        self.snapshot = ("%s-%s-%s %s:%s UTC" % m.groups()) if m else ts
                        break

    def _read_json(self, name):
        p = os.path.join(self.dir, name)
        if not os.path.exists(p):
            return None
        with open(p, encoding="utf-8") as f:
            return json.load(f)

    def _fact(self, text, source):
        return {"text": "Recorded snapshot (not live), as of %s: %s" % (self.snapshot, text),
                "source": "feeds/" + source}

    def facts(self, question):
        q = question.lower()
        out = []
        try:
            if re.search(r"\bflood", q):
                out += self._floods()
            if re.search(r"\b(weather|rain|storm|wind|snow|ice|fog|met office)\b", q):
                out += self._metoffice()
            if re.search(r"\b(emergency alerts?|alert)\b", q):
                out += self._govuk_alerts()
            lines = [l for l in TFL_LINES if re.search(r"\b%s\b" % l, q)]
            if lines or re.search(r"\b(tube|underground|tfl)\b", q):
                out += self._tfl(lines)
            if re.search(r"\b(power cut|power (come|be) back|power outage|electricity|no power|"
                         r"power is (off|out)|blackout)\b", q) or (
                    re.search(r"\bpower\b", q) and POSTCODE_RE.search(question)):
                out += self._power(question)
            if re.search(r"\b(heat|heatwave|cold weather|cold alert|ukhsa)\b", q):
                out += self._ukhsa()
        except (OSError, ValueError, ET.ParseError, KeyError, TypeError) as e:
            log.warning("bulletin read failed: %s", e)
        return out

    def _floods(self):
        d = self._read_json("ea_flood_warnings.json")
        if d is None:
            return []
        items = d.get("items", [])
        london = [i for i in items if "london" in json.dumps(i).lower()]
        areas = "; ".join("%s (%s)" % (i.get("description", "?"), i.get("severity", "?"))
                          for i in items[:5])
        text = "Environment Agency had %d flood warnings/alerts in England, %s in London. %s%s" % (
            len(items), "%d" % len(london) if london else "none", "Examples: " + areas if items else "",
            "." if items else "")
        return [self._fact(text, "ea_flood_warnings.json")]

    def _rss_titles(self, name):
        p = os.path.join(self.dir, name)
        if not os.path.exists(p):
            return None
        root = ET.parse(p).getroot()
        return [(i.findtext("title") or "").strip() for i in root.iter("item")]

    def _metoffice(self):
        out = []
        se = self._rss_titles("metoffice_warnings_se.atom")
        if se is not None:
            out.append(self._fact("Met Office warnings for London & South East: %s." % (
                "; ".join(se) if se else "none"), "metoffice_warnings_se.atom"))
        uk = self._rss_titles("metoffice_warnings_uk.atom")
        if uk:
            out.append(self._fact("Met Office UK warnings: %s." % "; ".join(uk[:3]),
                                  "metoffice_warnings_uk.atom"))
        return out

    def _govuk_alerts(self):
        p = os.path.join(self.dir, "govuk_emergency_alerts.atom")
        if not os.path.exists(p):
            return []
        ns = {"a": "http://www.w3.org/2005/Atom"}
        entries = ET.parse(p).getroot().findall("a:entry", ns)
        if not entries:
            return [self._fact("GOV.UK Emergency Alerts feed listed no alerts.", "govuk_emergency_alerts.atom")]
        latest = max(entries, key=lambda e: e.findtext("a:updated", "", ns))
        summary = (latest.findtext("a:summary", "", ns) or "").strip()
        return [self._fact("most recent GOV.UK Emergency Alert: %s. %s" % (
            latest.findtext("a:title", "", ns).strip(), summary[:200]), "govuk_emergency_alerts.atom")]

    def _tfl(self, lines):
        d = self._read_json("tfl_line_status.json")
        if not d:
            return []
        out = []
        for line in d:
            name = line.get("name", "")
            key = name.lower()
            if lines and not any(l in key for l in lines):
                continue
            sts = line.get("lineStatuses") or []
            desc = ", ".join(sorted({s.get("statusSeverityDescription", "") for s in sts}))
            if not lines and desc == "Good Service":
                continue
            reason = next((s.get("reason") for s in sts if s.get("reason")), "")
            out.append(self._fact("TfL %s: %s. %s" % (name, desc, re.sub(r"\s+", " ", reason)[:220]),
                                  "tfl_line_status.json"))
        return out[:4]

    def _power(self, question):
        m = POSTCODE_RE.search(question)
        if not m:
            return []
        outward, sector = m.group(1).upper(), m.group(2)
        want = "%s %s" % (outward, sector)
        out = []
        ukpn = self._read_json("ukpn_live_faults.json") or []
        for r in ukpn:
            pcs = (r.get("postcodesaffected") or "").upper()
            if want in pcs:
                out.append(self._fact(
                    "UK Power Networks %s, %s power cut affecting %s (%s customers), "
                    "estimated restoration %s." % (
                        r.get("incidentreference"), str(r.get("powercuttype", "")).lower(),
                        r.get("postcodesaffected"), r.get("nocustomeraffected"),
                        r.get("estimatedrestorationdate") or r.get(
                            "incidenttypetbcestimatedfriendlydescription") or "unknown"),
                    "ukpn_live_faults.json"))
        p = os.path.join(self.dir, "nged_live_power_cuts.csv")
        if os.path.exists(p):
            with open(p, encoding="utf-8", newline="") as f:
                for r in csv.DictReader(f):
                    if want in (r.get("postcode") or "").upper():
                        out.append(self._fact(
                            "National Grid (NGED) %s, %s, estimated restoration %s." % (
                                r.get("fault_id"), r.get("status"), r.get("etr") or "unknown"),
                            "nged_live_power_cuts.csv"))
        if not out:
            out.append(self._fact("no UKPN or NGED power cut listed for %s." % want, "ukpn_live_faults.json"))
        return out[:3]

    def _ukhsa(self):
        out = []
        for name, kind in (("ukhsa_heat_alerts.json", "heat-health"), ("ukhsa_cold_alerts.json", "cold-health")):
            d = self._read_json(name)
            if not d:
                continue
            ldn = [r for r in d if r.get("geography_name") == "London"]
            if ldn:
                out.append(self._fact("UKHSA %s alert for London: %s." % (kind, ldn[0].get("status")), name))
        return out


# --- facade -----------------------------------------------------------------


class KnowledgeBase:
    def __init__(self, datasets_dir, feeds_dir=None):
        t0 = time.time()
        self.datasets_dir = datasets_dir
        self.pois = self.guides = self.bulletin = None
        sqlite_path = os.path.join(datasets_dir, "phone", "pois", "london_pois.sqlite")
        try:
            self.pois = PoiIndex(sqlite_path, os.path.join(datasets_dir, "phone", "givefood",
                                                           "foodbanks.geojson"))
        except (sqlite3.Error, OSError, ValueError) as e:
            log.warning("KB: POIs unavailable (%s): %s", sqlite_path, e)
        guides_dir = os.path.join(datasets_dir, "phone", "guides")
        if os.path.isdir(guides_dir):
            self.guides = GuideIndex(guides_dir)
            if not self.guides.chunks:
                log.warning("KB: no guide chunks under %s", guides_dir)
                self.guides = None
        else:
            log.warning("KB: guides unavailable: %s", guides_dir)
        if feeds_dir:
            if os.path.isdir(feeds_dir):
                self.bulletin = Bulletin(feeds_dir)
            else:
                log.warning("KB: HUB_FEEDS_DIR %s is not a directory", feeds_dir)
        self.build_seconds = time.time() - t0
        log.info("KB ready in %.2fs: pois=%s guide_chunks=%d bulletin=%s", self.build_seconds,
                 bool(self.pois), len(self.guides.chunks) if self.guides else 0, bool(self.bulletin))

    @property
    def available(self):
        return bool(self.pois or self.guides or self.bulletin)

    def poi_facts(self, question, loc):
        if not self.pois or not loc:
            return []
        rule = match_poi_rule(question)
        if not rule:
            return []
        cat, types, label = rule
        lat, lon = loc["lat"], loc["lon"]
        src = "OpenStreetMap via phone/pois/london_pois.sqlite"
        if label == "food bank":
            fb = self.pois.nearest_foodbanks(lat, lon)
            if fb:
                return [{"text": "Nearest food bank (GiveFood): %s, %d m %s of the asker, address %s" % (
                    r["p"].get("name", "?"), round10(r["dist"]), r["bearing"],
                    re.sub(r"\s*[\r\n]+\s*", ", ", r["p"].get("address", "")).strip(", ")),
                         "source": "phone/givefood/foodbanks.geojson"} for r in fb]
        note = ""
        if label == "hospital":
            rows, confirmed = self.pois.nearest_hospitals_ae(lat, lon)
            label = "hospital with A&E" if confirmed else "hospital (A&E not confirmed in OSM)"
        else:
            rows = self.pois.nearest(cat, lat, lon, types)
        if not rows:
            return [{"text": "No %s is listed within %d km of the asker in the hub's map data." % (
                label, POI_RADIUS_M / 1000), "source": src}]
        out = []
        for i, r in enumerate(rows):
            prefix = "Nearest %s" % label if i == 0 else "Next %s" % label
            out.append({"text": "%s%s: %s" % (prefix, note, describe_poi(r, label.split(" ")[0])),
                        "source": "%s (OSM %s)" % (src, r["id"])})
        return out

    def guide_facts(self, question):
        if not self.guides:
            return []
        return [{"text": "%s%s" % (("[%s] " % c["heading"]) if c["heading"] else "", c["text"]),
                 "source": "%s (%s)" % (c["title"], c["source"])}
                for c in self.guides.search(question)]

    def facts(self, question, loc=None):
        out = []
        for fn in (lambda: self.poi_facts(question, loc),
                   lambda: self.bulletin.facts(question) if self.bulletin else [],
                   # A place question answered from the map needs no guide text.
                   lambda: [] if out else self.guide_facts(question)):
            try:
                out += fn()
            except Exception as e:  # a KB failure must never stop an answer
                log.warning("KB lookup failed: %s", e)
        # Enforce the context budget: drop the lowest-priority (last) facts first.
        kept, used = [], 0
        for f in out:
            n = len(f["text"]) + len(f["source"]) + 16
            if used + n > MAX_CONTEXT_CHARS:
                continue
            kept.append(f)
            used += n
        return kept


def format_facts(facts):
    lines = ["Facts from the hub's offline datasets (use these for any place, distance or "
             "number; do not invent others):"]
    for i, f in enumerate(facts, 1):
        lines.append("%d. %s (Source: %s)" % (i, f["text"], f["source"]))
    return "\n".join(lines)


def default_datasets_dir():
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "datasets")


_KB = None
_KB_LOADED = False


def get_kb():
    """The process-wide KB, built once; None when disabled or nothing loaded."""
    global _KB, _KB_LOADED
    if _KB_LOADED:
        return _KB
    _KB_LOADED = True
    if os.environ.get("HUB_KB", "1").strip() == "0":
        log.info("KB disabled (HUB_KB=0)")
        return None
    ddir = os.environ.get("HUB_DATASETS_DIR") or default_datasets_dir()
    if not os.path.isdir(ddir):
        log.warning("KB: datasets dir %s not found; answering without KB", ddir)
        return None
    try:
        kb = KnowledgeBase(ddir, os.environ.get("HUB_FEEDS_DIR") or None)
    except Exception as e:  # never crash the hub over the KB
        log.warning("KB build failed; answering without KB: %s", e)
        return None
    _KB = kb if kb.available else None
    return _KB


def reset_kb():
    global _KB, _KB_LOADED
    _KB, _KB_LOADED = None, False
