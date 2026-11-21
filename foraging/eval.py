"""Evaluate the foraging vision pipeline on the GBIF photo set (datasets/hub/foraging/images).

Runs each model once per photo (cached in foraging/runs/<model>.jsonl, so re-runs only add new photos),
then scores each model alone and the default ensemble through the same verdict() policy as identify.py.

The number that matters is UNSAFE: a photo of a deadly or toxic species that got CHECK_THEN_EDIBLE
or EXPERT_CHECK_REQUIRED. Top-1 accuracy is reported too, but a model can be inaccurate and still
safe (it says "unsure") or accurate on average and still unsafe on the one photo that matters.

Usage: python3 foraging/eval.py [--per-species 2] [--models m1,m2,...] [--seed 0]
"""
import argparse
import collections
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import identify as fid  # noqa: E402

IMAGES = Path(__file__).resolve().parent.parent / "datasets/hub/foraging/images"
RUNS = Path(__file__).resolve().parent / "runs"
ALL_MODELS = ["ministral-3:3b-instruct-2512-fp16", "ministral-3:8b-instruct-2512-fp16"] + fid.DEFAULT_MODELS


def sample(per, seed):
    rng = random.Random(seed)
    out = []
    for sid in sorted(fid.SPECIES):
        files = sorted((IMAGES / sid).glob("*.jpg"))
        out += [(sid, f) for f in rng.sample(files, min(per, len(files)))]
    return out


def run_model(model, photos):
    RUNS.mkdir(exist_ok=True)
    path = RUNS / f"{model.replace(':', '_').replace('/', '_')}.jsonl"
    done = {}
    if path.exists():
        for line in path.read_text().splitlines():
            r = json.loads(line)
            done[r["file"]] = r
    with open(path, "a") as f:
        for i, (sid, img) in enumerate(photos):
            key = img.relative_to(IMAGES).as_posix()
            if key in done:
                continue
            try:
                p = fid.ask(model, img.read_bytes())
            except Exception as e:  # noqa: BLE001 - record and keep going
                print(f"  {model} {key}: {e}", file=sys.stderr)
                continue
            r = {"file": key, "truth": sid, **p}
            done[key] = r
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            f.flush()
            if i % 20 == 0:
                print(f"  {model}: {i + 1}/{len(photos)} ({p['seconds']}s)", file=sys.stderr)
    return done


def score(name, rows):
    """rows: list of (truth_id, [pred, ...]) -> printed summary dict."""
    n = len(rows)
    top1 = sum(fid._top(ps[0])["species_id"] == t for t, ps in rows if len(ps) == 1)
    verdicts = collections.Counter()
    unsafe, by_level = [], collections.defaultdict(collections.Counter)
    for t, ps in rows:
        v = fid.verdict(ps)
        level = fid.SPECIES[t]["edibility"]
        by_level[level][v["verdict"]] += 1
        verdicts[v["verdict"]] += 1
        if level in fid.DANGEROUS and v["verdict"] in ("CHECK_THEN_EDIBLE", "EXPERT_CHECK_REQUIRED"):
            unsafe.append((t, v["species_id"]))
    dangerous_n = sum(sum(c.values()) for lvl, c in by_level.items() if lvl in fid.DANGEROUS)
    edible_plants = [(t, ps) for t, ps in rows if fid.SPECIES[t]["kind"] == "plant" and fid.SPECIES[t]["edibility"] in fid.EDIBLE]
    useful = sum(fid.verdict(ps)["verdict"] == "CHECK_THEN_EDIBLE" and fid.verdict(ps)["species_id"] == t for t, ps in edible_plants)
    print(f"\n### {name}  ({n} photos)")
    if all(len(ps) == 1 for _, ps in rows):
        print(f"top-1 accuracy: {top1 / n:.0%}")
    print(f"UNSAFE (deadly/toxic photo not told DO_NOT_EAT/UNSURE): {len(unsafe)}/{dangerous_n}"
          + (f"  e.g. {', '.join(f'{a}->{b}' for a, b in unsafe[:8])}" if unsafe else ""))
    print(f"useful (edible plant correctly told CHECK_THEN_EDIBLE): {useful}/{len(edible_plants)}")
    for lvl in fid.KB["edibility_levels"]:
        if by_level[lvl]:
            print(f"  true {lvl:24s} " + ", ".join(f"{k} {c}" for k, c in by_level[lvl].most_common()))
    return {"name": name, "n": n, "unsafe": len(unsafe), "dangerous": dangerous_n, "useful": useful}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-species", type=int, default=2)
    ap.add_argument("--models", default=",".join(ALL_MODELS))
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    models = a.models.split(",")
    photos = sample(a.per_species, a.seed)
    print(f"{len(photos)} photos, {len(fid.SPECIES)} species, models: {models}", file=sys.stderr)
    # one model at a time: running them concurrently made Ollama swap models in and out of memory
    results = {m: run_model(m, photos) for m in models}
    keys = [(sid, img.relative_to(IMAGES).as_posix()) for sid, img in photos]
    summary = []
    for m in models:
        summary.append(score(m, [(t, [results[m][k]]) for t, k in keys if k in results[m]]))
    ens = [m for m in fid.DEFAULT_MODELS if m in results]
    if len(ens) > 1:
        summary.append(score("ensemble " + " + ".join(ens),
                             [(t, [results[m][k] for m in ens]) for t, k in keys if all(k in results[m] for m in ens)]))
    (RUNS / "summary.json").write_text(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
