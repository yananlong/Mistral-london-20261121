"""CLI:

  python3 -m video.pipeline smoke                 # offline end-to-end test (stub LLM + stub clips)
  python3 -m video.pipeline run --brief b.md      # real run (config.local.json picks llm/backends)
  python3 -m video.pipeline project               # simulate schedule/cost with configured latencies
  python3 -m video.pipeline validate --run DIR    # re-check QA of an existing run
  python3 -m video.pipeline backends              # list registered video backends

Exit codes: 0 approved/ok, 2 awaiting human review, 1 failed.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import load_config
from .media import probe_video
from .project import project
from .runner import run_pipeline

DEFAULT_BRIEF = {
    "title": "firefish feature video (smoke)",
    "target_duration_s": 38.0,
    "duration_min_s": 35.0,
    "duration_max_s": 40.0,
    "audience": "hackathon judges",
    "features": ["Talk", "Locate", "Ask"],
    "tone": "calm, documentary",
    "voiceover": True,
    "notes": "stub smoke run — replace with a real brief after design lands",
}


def _brief_from_file(path: str) -> dict:
    p = Path(path)
    if p.suffix == ".json":
        return json.loads(p.read_text())
    # minimal markdown convention: first "# " line = title; bullets under "## Features"
    text = p.read_text()
    brief = dict(DEFAULT_BRIEF)
    brief["title"] = next((l[2:].strip() for l in text.splitlines() if l.startswith("# ")), p.stem)
    feats, in_feats = [], False
    for l in text.splitlines():
        if l.startswith("## "):
            in_feats = "feature" in l.lower()
        elif in_feats and l.strip().startswith("- "):
            feats.append(l.strip()[2:].strip())
    if feats:
        brief["features"] = feats
    return brief


def _print_report(state) -> None:
    print(f"\nrun {state.run_id}  status={state.status}")
    if state.final:
        p = probe_video(state.final)
        print(f"final: {state.final}  ({p['duration_s']}s, {p['width']}x{p['height']}, "
              f"audio={p['has_audio']})")
    if state.qa:
        for c in state.qa.checks:
            print(f"  QA {'PASS' if c.ok else 'FAIL'} {c.name}: {c.detail}")
    print("stage timings:")
    for t in state.timings:
        print(f"  {t.stage:<10} {t.duration_s:7.2f}s")
    print(f"review packet: {Path('video/runs') / state.run_id / 'review' / 'REVIEW.md'}")
    if state.last_error:
        print(f"last_error: {state.last_error}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="video.pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("smoke", help="offline end-to-end stub run")
    p_run = sub.add_parser("run", help="real pipeline run")
    p_run.add_argument("--brief", required=True)
    p_run.add_argument("--config", default=None, help="extra config JSON (merged last)")
    p_run.add_argument("--out", default=None, help="run output root (default video/runs)")
    p_run.add_argument("--auto-approve", action="store_true")
    p_run.add_argument("--id", default=None, help="run id")
    sub.add_parser("project", help="simulate schedule + cost, no API calls")
    p_val = sub.add_parser("validate", help="re-run QA on an existing run")
    p_val.add_argument("--run", required=True)
    sub.add_parser("backends")

    args = ap.parse_args(argv)

    if args.cmd == "backends":
        from .backends import KIND, _REGISTRY
        for name in sorted(_REGISTRY):
            print(f"{name:<10} kind={KIND[name]}")
        return 0

    if args.cmd == "project":
        cfg = load_config()
        rep = project(cfg, DEFAULT_BRIEF)
        print(f"planned {rep['planned_shots']} shots, total video {rep['total_video_s']}s "
              f"(target {rep['target_duration_s']}s)")
        print(f"projected wall clock: {rep['wall_clock_s']}s "
              f"(generation span {rep['generation_span_s']}s, critical path: {rep['critical_path']})")
        print(f"estimated cost: {rep['estimated_cost_credits']} credits")
        print(f"{'stage':<10} {'start':>8} {'end':>8}  detail")
        for e in rep["timeline"]:
            print(f"{e['stage']:<10} {e['start']:8.1f} {e['end']:8.1f}  {e['detail']}")
        return 0

    if args.cmd == "validate":
        state = json.loads((Path(args.run) / "state.json").read_text())
        p = probe_video(state["final"])
        lo, hi = state["brief"]["duration_min_s"], state["brief"]["duration_max_s"]
        ok = lo - 0.05 <= p["duration_s"] <= hi + 0.05
        print(f"{state['final']}: {p['duration_s']}s in [{lo},{hi}] -> {'PASS' if ok else 'FAIL'}")
        return 0 if ok else 1

    if args.cmd == "smoke":
        cfg = load_config(overrides={"run": {"out_root": "video/runs", "auto_approve": True},
                                     "llm": {"provider": "stub"}})
        state = run_pipeline(cfg, DEFAULT_BRIEF, run_id="smoke")
        _print_report(state)
        return 0 if state.status == "approved" else (2 if state.status == "awaiting_review" else 1)

    if args.cmd == "run":
        cfg = load_config(args.config)
        if args.auto_approve:
            cfg = {**cfg, "run": {**cfg.get("run", {}), "auto_approve": True}}
        brief = _brief_from_file(args.brief)
        state = run_pipeline(cfg, brief, run_id=args.id, out_root=args.out)
        _print_report(state)
        return 0 if state.status == "approved" else (2 if state.status == "awaiting_review" else 1)

    return 1


if __name__ == "__main__":
    sys.exit(main())
