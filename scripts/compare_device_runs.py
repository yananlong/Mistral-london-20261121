#!/usr/bin/env python3
"""Compare phone benchmark CSVs against per-device go/no-go limits (phone/TEST_PLAN.md).

Usage: python3 -I scripts/compare_device_runs.py bench-*.csv [--scores scores.csv] [--map LABEL=KEY ...]

CSV columns (EngineBenchmark.swift, shared with Android):
  timestamp,device,tier,phase,case_id,file,run,maxImageSide,prompt,stopReason,promptTokens,imageTokens,
  generatedTokens,loadSec,prefillSec,ttftSec,decodeTokPerSec,totalSec,imageEncodeProbeSec,peakFootprintMB,
  thermal,battery_pct,error,answer,usable
scores.csv columns: device,case_id,usable,scorer,notes   (usable = 1 or 0)
"""
import argparse
import csv
import math
import statistics
import sys
from collections import defaultdict

# Limits per device class. Keep in sync with phone/TEST_PLAN.md section 5.
LIMITS = {
    "iphone18pro": {"p95_total_s": 15.0, "p95_ttft_s": None, "min_usable": 8, "cases": 10,
                    "soak_runs": 20, "max_crashes": 0, "cpu_fallback_probe_s": 3.0},
    "iphone17":    {"p95_total_s": 25.0, "p95_ttft_s": None, "min_usable": 8, "cases": 10,
                    "soak_runs": 20, "max_crashes": 0, "cpu_fallback_probe_s": 3.0},
    "pixel9a":     {"p95_total_s": 35.0, "p95_ttft_s": 20.0, "min_usable": 8, "cases": 10,
                    "soak_runs": 20, "max_crashes": 0, "cpu_fallback_probe_s": None},
}
# Device strings that are not already a LIMITS key (machine identifiers etc.).
ALIASES = {"iPhone18,3": "iphone17", "iPhone18,5": "iphone17",
           "iPhone18,1": "iphone18pro", "iPhone18,2": "iphone18pro", "iPhone18,4": "iphone18pro"}
THROTTLE_DROP_PCT = 25.0  # decode tok/s drop, first 5 vs last 5 soak runs, called throttling
BAD_STOPS = {"deadline", "cancelled"}


def num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def p95(xs):  # nearest rank, same as EngineBenchmark.swift
    if not xs:
        return None
    s = sorted(xs)
    return s[min(len(s) - 1, math.ceil(0.95 * len(s)) - 1)]


def med(xs):
    return statistics.median(xs) if xs else None


def fmt(v, d=1, unit=""):
    return "-" if v is None else f"{v:.{d}f}{unit}"


def load(paths):
    groups = defaultdict(lambda: {"rows": [], "files": defaultdict(list)})
    for p in paths:
        with open(p, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                key = (r.get("device", "").strip(), r.get("tier", "").strip())
                groups[key]["rows"].append(r)
                groups[key]["files"][p].append(r)
    return groups


def load_scores(path):
    last = {}
    if path:
        with open(path, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                last[(r["device"].strip(), r["case_id"].strip())] = r["usable"].strip()
    return last


def analyse(device, tier, g, scores, remap):
    key = remap.get(device) or (device if device in LIMITS else ALIASES.get(device))
    lim = LIMITS.get(key)
    soak = [r for r in g["rows"] if r["phase"] == "soak"]
    wanted = lim["soak_runs"] if lim else 20
    # Crash accounting per file: error rows, deadline/cancel stops, and soak rows missing after a crash.
    crashes = 0
    for rows in g["files"].values():
        s = [r for r in rows if r["phase"] == "soak"]
        crashes += sum(1 for r in s if r.get("error") or r.get("stopReason") in BAD_STOPS)
        crashes += max(0, wanted - len(s))
    ok = [r for r in soak if not r.get("error") and r.get("stopReason") not in BAD_STOPS]
    tot = [num(r["totalSec"]) for r in ok if num(r["totalSec"]) is not None]
    ttft = [num(r["ttftSec"]) for r in ok if num(r["ttftSec"]) is not None]
    dec = [num(r["decodeTokPerSec"]) for r in ok if (num(r["decodeTokPerSec"]) or 0) > 0]
    probes = [num(r["imageEncodeProbeSec"]) for r in g["rows"] if (num(r["imageEncodeProbeSec"]) or -1) > 0]
    peak = [num(r["peakFootprintMB"]) for r in g["rows"] if num(r["peakFootprintMB"]) is not None]
    therm = [num(r["thermal"]) for r in g["rows"] if num(r["thermal"]) is not None]
    drop = None
    if len(dec) >= 10:
        a, b = statistics.mean(dec[:5]), statistics.mean(dec[-5:])
        drop = 100.0 * (a - b) / a if a else None
    marks = {c: v for (d, c), v in scores.items() if d == device}
    usable = sum(1 for v in marks.values() if v == "1")
    res = {"device": device or "?", "tier": tier or "?", "key": key, "runs": len(soak), "crashes": crashes,
           "med": med(tot), "p95": p95(tot), "ttft95": p95(ttft), "probe": med(probes), "dec": med(dec),
           "peak": max(peak) if peak else None, "thermal": max(therm) if therm else None, "drop": drop,
           "usable": usable, "scored": len(marks)}
    reasons, pending = [], []
    if not lim:
        res["verdict"] = "UNKNOWN"
        res["why"] = f"no limits for device '{device}'; use --map {device}=<{'|'.join(LIMITS)}>"
        return res
    if crashes > lim["max_crashes"]:
        reasons.append(f"crashes {crashes}")
    if len(soak) < wanted:
        reasons.append(f"soak rows {len(soak)}/{wanted}")
    if res["p95"] is None or res["p95"] > lim["p95_total_s"]:
        reasons.append(f"p95 {fmt(res['p95'])}s > {lim['p95_total_s']}s")
    if lim["p95_ttft_s"] is not None and (res["ttft95"] is None or res["ttft95"] > lim["p95_ttft_s"]):
        reasons.append(f"ttft p95 {fmt(res['ttft95'])}s > {lim['p95_ttft_s']}s")
    if lim["cpu_fallback_probe_s"] is not None and res["probe"] is not None and res["probe"] > lim["cpu_fallback_probe_s"]:
        reasons.append(f"CPU-fallback flag (encode median {fmt(res['probe'], 2)}s)")
    if res["scored"] < lim["cases"]:
        pending.append(f"scores {res['scored']}/{lim['cases']}")
    elif usable < lim["min_usable"]:
        reasons.append(f"usable {usable}/{lim['cases']}")
    res["verdict"] = "FAIL" if reasons else ("PENDING" if pending else "PASS")
    res["why"] = "; ".join(reasons + pending)
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="+", help="benchmark CSV files")
    ap.add_argument("--scores", help="scores.csv with hand-marked usable results")
    ap.add_argument("--map", action="append", default=[], metavar="LABEL=KEY",
                    help="treat device label LABEL as limits key KEY")
    a = ap.parse_args()
    remap = dict(m.split("=", 1) for m in a.map)
    groups = load(a.csv)
    scores = load_scores(a.scores)
    cols = ["device", "tier", "runs", "crash", "med_s", "p95_s", "ttft95_s", "enc_s", "dec_t/s", "peak_MB",
            "therm", "drop%", "usable", "verdict"]
    rows, whys = [], []
    for (dev, tier), g in sorted(groups.items()):
        r = analyse(dev, tier, g, scores, remap)
        rows.append([r["device"], r["tier"], str(r["runs"]), str(r["crashes"]), fmt(r["med"]), fmt(r["p95"]),
                     fmt(r["ttft95"]), fmt(r["probe"], 2), fmt(r["dec"]), fmt(r["peak"], 0),
                     "-" if r["thermal"] is None else f"{r['thermal']:.0f}", fmt(r["drop"], 0),
                     f"{r['usable']}/{r['scored']}" if r["scored"] else "-", r["verdict"]])
        throttle = r["drop"] is not None and r["drop"] > THROTTLE_DROP_PCT
        whys.append(f"{r['device']}/{r['tier']}: {r['why'] or 'all limits met'}"
                    + ("; THROTTLING (decode drop > %.0f%%)" % THROTTLE_DROP_PCT if throttle else ""))
    w = [max(len(c), *(len(x[i]) for x in rows)) for i, c in enumerate(cols)]
    line = lambda xs: "  ".join(x.ljust(w[i]) for i, x in enumerate(xs))
    print(line(cols))
    print(line(["-" * n for n in w]))
    for x in rows:
        print(line(x))
    print()
    for t in whys:
        print(t)
    print("\nenc_s = median image-encode probe; therm = hottest state (0 nominal .. 3 critical); "
          "drop% = decode tok/s, first 5 vs last 5 soak runs.")
    return 1 if any(x[-1] == "FAIL" for x in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
