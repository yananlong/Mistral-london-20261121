"""Director agent: brief -> storyboard (shot list with durations summing to 35-40 s)."""
from __future__ import annotations

from ..errors import PipelineError
from ..schemas import Storyboard
from .common import extract_json, load_prompt


def run(state, ctx) -> dict:
    system = load_prompt("director")
    payload = {
        "brief": state.brief.model_dump(mode="json"),
        "video": ctx.config["video"],
        "duration": ctx.config["duration"],
        "design_refs": ctx.config.get("design_refs", []),
        "last_error": state.last_error,
    }
    raw = ctx.llm.complete("director", system, "Produce the storyboard. Return JSON only.", payload)
    data = extract_json(raw)
    data["duration_min_s"] = state.brief.duration_min_s
    data["duration_max_s"] = state.brief.duration_max_s
    try:
        sb = Storyboard(**data)
    except Exception as e:
        raise PipelineError(f"invalid storyboard from director: {e}")
    return {"storyboard": sb, "last_error": ""}
