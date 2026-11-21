"""Curator agent: scores every candidate per shot, picks a winner, flags retries.

One LLM call reviews all shots at once (context stays small). The orchestrator
loops back to the generators for `retry_shots` up to curator.max_attempts.
"""
from __future__ import annotations

from ..errors import PipelineError
from ..schemas import ShotReview
from .common import extract_json, load_prompt


def run(state, ctx) -> dict:
    if state.storyboard is None:
        raise PipelineError("no storyboard yet", retryable=False)
    cur = ctx.config.get("curator", {})
    min_total = int(cur.get("min_total_score", 30))
    cands: dict[str, list[dict]] = {}
    for c in state.candidates:
        cands.setdefault(c.shot_id, []).append(c.model_dump(mode="json"))
    attempt = state.attempts.get("curate", 0) + 1
    payload = {
        "style_guide": state.storyboard.style_guide,
        "rubric": cur.get("rubric", ""),
        "min_total_score": min_total,
        "attempt": attempt,
        "shots": [s.model_dump(mode="json") for s in state.storyboard.shots],
        "candidates": cands,
    }
    raw = ctx.llm.complete(
        "curator", load_prompt("curator"),
        "Score every candidate of every shot and pick one winner per shot. Return JSON only.",
        payload,
    )
    data = extract_json(raw)
    reviews: dict[str, ShotReview] = {}
    for sid, r in (data.get("reviews") or {}).items():
        try:
            reviews[sid] = ShotReview(**r)
        except Exception as e:
            raise PipelineError(f"invalid review for shot {sid}: {e}")
    missing = [s.id for s in state.storyboard.shots if s.id not in reviews]
    if missing:
        raise PipelineError(f"curator did not review shots: {missing}")
    retry = [
        sid for sid, r in reviews.items()
        if r.retry or r.scores[r.winner].total < min_total
    ]
    return {
        "reviews": reviews,
        "retry_shots": retry,
        "attempts": {**state.attempts, "curate": attempt},
        "last_error": "",
    }
