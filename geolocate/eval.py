"""End-to-end eval on the Commons photos in golden/commons_photos.json: photo -> perception -> fusion -> metres off.

Each photo runs in two situations from the disaster scenario:
  cold     the photo alone: no satellite fix, no last fix, no peers (a fresh phone in airplane mode, indoors
           until now, or GNSS still searching without assistance data)
  dead_reckoning  no current fix; the last fix was 30 min ago, 1 km north-east of the truth, and the step counter
           says 1.5 km walked since. This is what the phone knows after walking away from a shelter.

A photo passes when it gives status "fix" within 100 m of the truth, or, for a photo whose note says it should
not fix on its own, when it does not claim a fix. Usage:
  yolo/.venv/bin/python geolocate/eval.py PHOTO_DIR [--fetch] [--vlm] [--json]
"""
import argparse
import json
import math
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fusion import estimate  # noqa: E402
from gazetteer import SqliteGazetteer, metres  # noqa: E402
from locate import GAZETTEER  # noqa: E402

GOLDEN = HERE / "golden" / "commons_photos.json"
PASS_M = 100.0


def offset(lat, lon, north_m, east_m):
    return lat + north_m / 111320.0, lon + east_m / (111320.0 * math.cos(math.radians(lat)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo_dir")
    ap.add_argument("--fetch", action="store_true", help="download missing photos from Wikimedia Commons first")
    ap.add_argument("--vlm", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    d = Path(a.photo_dir)
    d.mkdir(parents=True, exist_ok=True)
    photos = json.loads(GOLDEN.read_text())["photos"]
    if a.fetch:
        for p in photos:
            if not (d / p["file"]).exists():
                req = urllib.request.Request(p["url"], headers={"User-Agent": "geolocate-eval/0.1"})
                (d / p["file"]).write_bytes(urllib.request.urlopen(req, timeout=60).read())
    cache = d / ("scenes_vlm.json" if a.vlm else "scenes.json")
    scenes = json.loads(cache.read_text()) if cache.exists() else {}
    missing = [p for p in photos if p["file"] not in scenes]
    if missing:
        import contextlib
        from perceive import perceive
        with contextlib.redirect_stdout(sys.stderr):
            for p in missing:
                scenes[p["file"]] = perceive(d / p["file"], use_vlm=a.vlm)
        cache.write_text(json.dumps(scenes, indent=1))

    gaz = SqliteGazetteer(GAZETTEER)
    rows = []
    for p in photos:
        must_not_fix = "should NOT give a fix" in p["note"]
        fix_lat, fix_lon = offset(p["lat"], p["lon"], 707, 707)
        situations = {
            "cold": {},
            "dead_reckoning": {"last_fix": {"lat": fix_lat, "lon": fix_lon, "acc_m": 15, "age_s": 1800}, "walked_m": 1500},
        }
        for name, sensors in situations.items():
            est = estimate(gaz, [scenes[p["file"]]], sensors)
            err = metres(est["lat"], est["lon"], p["lat"], p["lon"]) if "lat" in est else None
            if must_not_fix:
                ok = est["status"] != "fix" or (err is not None and err <= PASS_M)
            else:
                ok = est["status"] == "fix" and err is not None and err <= PASS_M
            rows.append({"file": p["file"], "situation": name, "status": est["status"], "error_m": None if err is None else round(err),
                         "accuracy_m": est.get("accuracy_m"), "confidence": est.get("confidence"), "pass": ok,
                         "matched": [e["matched"] for e in est["evidence"] if e.get("matched")]})
    if a.json:
        print(json.dumps(rows, indent=1))
        return
    print(f"{'photo':30} {'situation':15} {'status':11} {'err m':>7} {'±m':>5} {'conf':>5}  pass  matched")
    for r in rows:
        print(f"{r['file'][:30]:30} {r['situation']:15} {r['status']:11} {str(r['error_m']):>7} {str(r['accuracy_m']):>5} "
              f"{str(r['confidence']):>5}  {'yes ' if r['pass'] else 'NO  '}  {', '.join(r['matched'])[:60]}")
    for s in ("cold", "dead_reckoning"):
        rs = [r for r in rows if r["situation"] == s]
        print(f"{s}: {sum(r['pass'] for r in rs)}/{len(rs)} pass")


if __name__ == "__main__":
    main()
