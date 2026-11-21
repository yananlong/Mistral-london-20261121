"""Name normalisation shared by the gazetteer builder, the Spark reference pipeline and the phone.

The phone port is phone/app/src/locate/geo/normalize.ts. Both must give the same output for
geolocate/golden/normalize.json; `python3 -m unittest geolocate.test_geolocate` and the jest suite check it.

Rules, in order:
  1. lower case; "&" -> " and "; curly quotes -> straight; drop apostrophes ("St John's" -> "st johns")
  2. anything that is not a-z or 0-9 becomes a space; collapse spaces
  3. expand abbreviations token by token (ABBREV). "st" is "saint" when it is the first token and more
     tokens follow, otherwise "street"
  4. drop a leading "the"
"""
import re

ABBREV = {
    "rd": "road", "ave": "avenue", "av": "avenue", "sq": "square", "ln": "lane", "pl": "place",
    "cres": "crescent", "cr": "crescent", "gdns": "gardens", "gdn": "garden", "terr": "terrace", "ter": "terrace",
    "ct": "court", "dr": "drive", "gr": "grove", "gro": "grove", "pk": "park", "hse": "house", "stn": "station",
    "mkt": "market", "bdy": "broadway", "bldgs": "buildings", "cl": "close", "wk": "walk", "embk": "embankment",
    "hl": "hill", "gt": "great", "lt": "little", "nth": "north", "sth": "south", "upr": "upper", "lwr": "lower",
}
# Postcode districts that appear in the Greater London extract. Signs print the district, e.g. "SW1" or "E14".
DISTRICT_RE = re.compile(r"(?:EC|WC|NW|SE|SW|BR|CR|DA|EN|HA|IG|KT|RM|SM|TW|UB|WD|E|N|W)[0-9]{1,2}[A-Z]?(?=\s|$)")


def normalize(text):
    s = text.lower().replace("&", " and ").replace("’", "'").replace("‘", "'").replace("'", "")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    toks = s.split()
    out = []
    for i, t in enumerate(toks):
        if t == "st":
            out.append("saint" if i == 0 and len(toks) > 1 else "street")
        else:
            out.append(ABBREV.get(t, t))
    if out and out[0] == "the" and len(out) > 1:
        out = out[1:]
    return " ".join(out)


BOROUGHS = {
    "barking and dagenham", "barnet", "bexley", "brent", "bromley", "camden", "croydon", "ealing", "enfield",
    "greenwich", "hackney", "hammersmith and fulham", "haringey", "harrow", "havering", "hillingdon", "hounslow",
    "islington", "kensington and chelsea", "kingston upon thames", "lambeth", "lewisham", "merton", "newham",
    "redbridge", "richmond upon thames", "southwark", "sutton", "tower hamlets", "waltham forest", "wandsworth",
    "westminster", "city of london", "city of westminster",
}
# A phrase made only of these words names nothing: "ROAD", "THE STREET", "ENTRANCE".
GENERIC = {
    "street", "road", "avenue", "lane", "place", "square", "crescent", "gardens", "terrace", "court", "drive", "grove",
    "close", "walk", "way", "row", "hill", "park", "the", "and", "of", "to", "london", "city", "borough", "royal",
    "council", "entrance", "exit", "out", "north", "south", "east", "west", "station", "no", "entry", "only", "open", "closed", "please", "stop", "bus", "keep", "clear", "private", "car", "parking",
}


def is_region_line(text):
    """True for the borough line on a street sign, e.g. 'CITY OF WESTMINSTER' or 'London Borough of Camden'."""
    n = normalize(text)
    for prefix in ("london borough of ", "royal borough of ", "borough of "):
        if n.startswith(prefix):
            n = n[len(prefix):]
    if n.endswith(" council"):
        n = n[: -len(" council")]
    return n in BOROUGHS


def is_generic(norm):
    return all(t in GENERIC or t.isdigit() for t in norm.split())


def districts_in(text):
    """Postcode districts printed in a line of sign text, e.g. 'WHITEHALL SW1' -> ['SW1']."""
    return DISTRICT_RE.findall(text.upper())
