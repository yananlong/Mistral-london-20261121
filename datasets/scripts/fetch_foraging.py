"""Download labelled photos and reference text for every species in phone/foraging/species.json.

Photos, CC0 or CC BY only (no NC/ND), UK first, then anywhere if the UK has too few:
  fungi:  GBIF occurrence search (mostly iNaturalist research-grade observations)
  plants: iNaturalist API, research grade, annotated "Flowers and Fruits = Fruits or Seeds", because a
          forager photographs the fruit; most unfiltered plant photos show only leaves or flowers
  hub/foraging/images/<species_id>/<gbif occurrence id | inat<observation id>>.jpg
  hub/foraging/images/attribution.jsonl   one line per photo: licence, creator, source page
Text: Wikipedia REST summary per species (CC BY-SA 4.0), for hub retrieval.
  hub/foraging/wiki/<species_id>.json

Used as the evaluation set for foraging/eval.py, not shipped to phones.
Usage: python3 -I scripts/fetch_foraging.py [PER_SPECIES=30]
Resumable: existing photos are kept and counted.
"""
import concurrent.futures as cf
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KB = ROOT / "phone/foraging/species.json"
IMG = ROOT / "hub/foraging/images"
WIKI = ROOT / "hub/foraging/wiki"
PER = int(sys.argv[1]) if len(sys.argv) > 1 else 30
UA = "offline-emergency-dataset/0.1 (hackathon research)"
OK_LICENCES = ("creativecommons.org/publicdomain/zero", "creativecommons.org/licenses/by/")


def get_json(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - retry any network error
            if attempt == 3:
                print(f"FAIL {url}: {e}", file=sys.stderr)
                return None
            time.sleep(2 ** attempt)


def download(url, out):
    tmp = out.with_suffix(".tmp")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            f.write(r.read())
        tmp.rename(out)
        return True
    except Exception as e:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        print(f"FAIL {url}: {e}", file=sys.stderr)
        return False


def licence_ok(lic):
    return bool(lic) and any(k in lic for k in OK_LICENCES) and "-nc" not in lic and "-nd" not in lic


def sized(url):
    # iNaturalist serves original/large/medium/small; "large" (1024 px) is plenty for the vision encoder
    return url.replace("/original.", "/large.") if "inaturalist" in url else url


def candidates(taxon_key, country):
    """Yield (occurrence, media) pairs with an acceptable media licence."""
    offset = 0
    while offset < 1500:
        q = {"taxonKey": taxon_key, "mediaType": "StillImage", "basisOfRecord": "HUMAN_OBSERVATION",
             "license": ["CC0_1_0", "CC_BY_4_0"], "limit": 300, "offset": offset}
        if country:
            q["country"] = country
        d = get_json("https://api.gbif.org/v1/occurrence/search?" + urllib.parse.urlencode(q, doseq=True))
        if not d or not d.get("results"):
            return
        for occ in d["results"]:
            for m in occ.get("media", []):
                if m.get("type") == "StillImage" and m.get("identifier") and licence_ok(m.get("license", "")):
                    yield occ, m
                    break
        if d.get("endOfRecords"):
            return
        offset += 300


def inat_candidates(name, uk):
    """Yield (observation, photo) for research-grade observations annotated as fruiting."""
    for page in range(1, 6):
        q = {"taxon_name": name, "term_id": 12, "term_value_id": 14, "photo_license": "cc0,cc-by",
             "quality_grade": "research", "per_page": 100, "page": page, "order_by": "votes"}
        if uk:
            q["place_id"] = 6857  # United Kingdom
        d = get_json("https://api.inaturalist.org/v1/observations?" + urllib.parse.urlencode(q))
        time.sleep(1.0)  # iNaturalist asks for <= 1 request/s
        if not d or not d.get("results"):
            return
        for obs in d["results"]:
            for ph in obs.get("photos", []):
                if ph.get("license_code") in ("cc0", "cc-by") and ph.get("url"):
                    yield obs, ph
                    break
        if page * 100 >= d.get("total_results", 0):
            return


def fetch_plant(sp):
    out = IMG / sp["id"]
    out.mkdir(parents=True, exist_ok=True)
    seen, rows = {p.stem for p in out.glob("inat*.jpg")}, []
    for uk in (True, False):
        for obs, ph in inat_candidates(sp["scientific_name"], uk):
            if len(seen) >= PER:
                break
            oid = f"inat{obs['id']}"
            if oid in seen:
                continue
            seen.add(oid)
            if download(ph["url"].replace("/square.", "/large."), out / f"{oid}.jpg"):
                lic = ph["license_code"]
                rows.append({"species_id": sp["id"], "file": f"{sp['id']}/{oid}.jpg", "inat_observation": obs["id"],
                             "scientific_name_inat": (obs.get("taxon") or {}).get("name"), "country": "GB" if uk else None,
                             "licence": "http://creativecommons.org/publicdomain/zero/1.0/" if lic == "cc0" else "http://creativecommons.org/licenses/by/4.0/",
                             "creator": ph.get("attribution"), "source": f"https://www.inaturalist.org/observations/{obs['id']}",
                             "publisher": "iNaturalist", "life_stage": "fruits or seeds"})
            else:
                seen.discard(oid)
        if len(seen) >= PER:
            break
    return sp["id"], len(seen), rows


def fetch_species(sp):
    match = get_json("https://api.gbif.org/v1/species/match?" + urllib.parse.urlencode({"name": sp["scientific_name"]}))
    if not match or "usageKey" not in match:
        return sp["id"], 0, []
    key = match.get("acceptedUsageKey", match["usageKey"])
    out = IMG / sp["id"]
    out.mkdir(parents=True, exist_ok=True)
    have = {p.stem for p in out.glob("*.jpg")}
    rows, seen = [], set(have)
    for country in ("GB", None):
        for occ, m in candidates(key, country):
            if len(seen) >= PER:
                break
            gid = str(occ["key"])
            if gid in seen:
                continue
            seen.add(gid)
            if download(sized(m["identifier"]), out / f"{gid}.jpg"):
                rows.append({"species_id": sp["id"], "file": f"{sp['id']}/{gid}.jpg", "gbif_occurrence": gid,
                             "scientific_name_gbif": occ.get("scientificName"), "country": occ.get("countryCode"),
                             "licence": m.get("license"), "creator": m.get("creator") or m.get("rightsHolder"),
                             "source": m.get("references") or f"https://www.gbif.org/occurrence/{gid}",
                             "publisher": m.get("publisher") or occ.get("datasetName")})
            else:
                seen.discard(gid)
        if len(seen) >= PER:
            break
    return sp["id"], len(seen), rows


def fetch_wiki(sp):
    out = WIKI / f"{sp['id']}.json"
    if out.exists():
        return
    title = urllib.parse.quote(sp["scientific_name"].replace(" ", "_"))
    d = get_json(f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}")
    if d and d.get("extract"):
        out.write_text(json.dumps({"species_id": sp["id"], "title": d.get("title"), "extract": d["extract"],
                                   "url": d.get("content_urls", {}).get("desktop", {}).get("page"),
                                   "licence": "CC BY-SA 4.0", "attribution": "Wikipedia contributors"},
                                  ensure_ascii=False, indent=1))


def main():
    species = json.loads(KB.read_text())["species"]
    IMG.mkdir(parents=True, exist_ok=True)
    WIKI.mkdir(parents=True, exist_ok=True)
    attr = IMG / "attribution.jsonl"
    fungi = [s for s in species if s["kind"] == "fungus"]
    plants = [s for s in species if s["kind"] == "plant"]
    with cf.ThreadPoolExecutor(6) as ex, open(attr, "a") as f:
        # fungi in parallel (GBIF); plants one at a time (iNaturalist rate limit)
        for sid, n, rows in list(ex.map(fetch_species, fungi)) + [fetch_plant(s) for s in plants]:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(f"{'ok  ' if n >= PER else 'LOW '} {sid}: {n} photos")
    for sp in species:  # sequential: Wikipedia rate-limits parallel REST calls (429)
        fetch_wiki(sp)
        time.sleep(1.5)
    print(f"wiki summaries: {len(list(WIKI.glob('*.json')))}/{len(species)}")


if __name__ == "__main__":
    main()
