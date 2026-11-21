"""Human review gate: writes a review packet and waits for a verdict.

The packet runs/<id>/review/REVIEW.md summarises the storyboard, every
candidate with its curator scores, the chosen winners, the EDL, QA and the
stage timings, with links to the artifacts (final.mp4, captions.srt, previews).

A human (or the orchestrator) then writes runs/<id>/review/verdict.json:
  {"status": "approved"}            -> pipeline ends, status=approved
  {"status": "changes_requested", "notes": "..."} -> status=changes_requested
With run.auto_approve=true (smoke tests) the gate approves itself.
"""
from __future__ import annotations

import json
from pathlib import Path


def write_packet(run_dir: Path, state) -> Path:
    review_dir = Path(run_dir) / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    verdict_path = review_dir / "verdict.json"
    if not verdict_path.exists():
        verdict_path.write_text(json.dumps({"status": "pending", "notes": ""}, indent=2))

    lines = [
        f"# Review packet — run `{state.run_id}`",
        "",
        f"- Status: **{state.status}**",
        f"- Brief: {state.brief.title} — target {state.brief.target_duration_s}s "
        f"(allowed {state.brief.duration_min_s}-{state.brief.duration_max_s}s)",
        f"- Features: {', '.join(state.brief.features) or '—'}",
        f"- Final render: `{state.final}`",
        "",
        "## Stage timings",
        "",
        "| stage | seconds | detail |",
        "|---|---|---|",
    ]
    for t in state.timings:
        detail = json.dumps(t.detail)[:120]
        lines.append(f"| {t.stage} | {t.duration_s:.2f} | {detail} |")
    if state.storyboard:
        lines += ["", "## Storyboard", "",
                  "| shot | beat | duration_s | caption |", "|---|---|---|---|"]
        for s in state.storyboard.shots:
            lines.append(f"| {s.id} | {s.beat} | {s.duration_s} | {s.caption} |")
        lines.append(f"\nTotal: **{state.storyboard.total_duration_s}s**")
    lines += ["", "## Curator decisions", "",
              "| shot | winner | total/50 | retry | rationale |", "|---|---|---|---|---|"]
    for sid, r in state.reviews.items():
        total = r.scores[r.winner].total
        lines.append(f"| {sid} | {r.winner} | {total} | {r.retry} | {r.rationale[:100]} |")
    lines += ["", "## Candidates", "",
              "| shot | variant | file | duration_s | gen_s | credits |", "|---|---|---|---|---|---|"]
    for c in state.candidates:
        lines.append(f"| {c.shot_id} | {c.variant} | `{c.file}` | {c.duration_s} | "
                     f"{c.generation_seconds:.1f} | {c.cost_credits} |")
    if state.qa:
        lines += ["", "## QA", ""]
        for c in state.qa.checks:
            lines.append(f"- {'PASS' if c.ok else 'FAIL'} {c.name}: {c.detail}")
        lines.append(f"\nRendered duration: **{state.qa.duration_s}s** "
                     f"(allowed {state.qa.duration_min_s}-{state.qa.duration_max_s}s)")
    lines += [
        "",
        "## To approve",
        "",
        "```sh",
        f"echo '{{\"status\": \"approved\"}}' > {verdict_path}",
        "```",
        "",
    ]
    path = review_dir / "REVIEW.md"
    path.write_text("\n".join(lines))
    return path


def read_verdict(run_dir: Path) -> str:
    v = Path(run_dir) / "review" / "verdict.json"
    if not v.exists():
        return "pending"
    try:
        return json.loads(v.read_text()).get("status", "pending")
    except Exception:
        return "pending"


def run(state, ctx) -> dict:
    verdict = read_verdict(ctx.run_dir)
    if ctx.auto_approve or verdict == "approved":
        status = "approved"
    elif verdict == "changes_requested":
        status = "changes_requested"
    else:
        status = "awaiting_review"
    write_packet(ctx.run_dir, state.model_copy(update={"status": status}))
    return {"status": status}
