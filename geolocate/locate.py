"""Where am I? Photos (and optional sensor readings) in, position estimate out. Runs offline on the Spark.

Usage:
  yolo/.venv/bin/python geolocate/locate.py photo.jpg [more.jpg] [--sensors sensors.json] [--vlm] [--json]
  yolo/.venv/bin/python geolocate/locate.py --scenes scenes.jsonl [--sensors sensors.json]   # skip perception

sensors.json follows the contract in fusion.py, e.g.
  {"last_fix": {"lat": 51.5007, "lon": -0.1246, "acc_m": 15, "age_s": 1800}, "walked_m": 900}
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from fusion import describe, estimate  # noqa: E402
from gazetteer import SqliteGazetteer  # noqa: E402

GAZETTEER = HERE.parent / "datasets" / "phone" / "geo" / "london_gazetteer.sqlite"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photos", nargs="*")
    ap.add_argument("--scenes", help="JSONL of scene observations (from perceive.py) instead of photos")
    ap.add_argument("--sensors", help="JSON file of sensor readings")
    ap.add_argument("--vlm", action="store_true")
    ap.add_argument("--hfov", type=float, default=None)
    ap.add_argument("--gazetteer", default=str(GAZETTEER))
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    scenes = []
    if a.scenes:
        scenes = [json.loads(l) for l in open(a.scenes) if l.strip()]
    if a.photos:
        from perceive import perceive
        scenes += [perceive(p, a.vlm, a.hfov) for p in a.photos]
    sensors = json.load(open(a.sensors)) if a.sensors else {}
    est = estimate(SqliteGazetteer(a.gazetteer), scenes, sensors)
    if a.json:
        print(json.dumps({"estimate": est, "scenes": scenes}))
    else:
        print(describe(est))
        if est["status"] != "no_evidence":
            print(f"loc: {est['lat']:.5f},{est['lon']:.5f}   confidence {est['confidence']}")


if __name__ == "__main__":
    main()
