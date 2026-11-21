"""The orchestrator: a small declarative graph executed by a zero-dependency
native executor.

    START -> director -> generate -> curate -+-> generate (retry loop)
                                     curate -+-> assemble -> qa -+-> assemble (fix loop)
                                                         qa -+-> review -> END

The same node/edge structure maps 1:1 onto LangGraph (Send fan-out for
generate, conditional edges for the loops, interrupt() at the review gate)
or onto Orca workers — the agent functions are plain `run(state, ctx)` and
do not depend on the executor. See video/FRAMEWORKS.md.
"""
from __future__ import annotations

import time

from . import review
from .agents import curator, director, editor, generator, qa
from .errors import PipelineError
from .schemas import StageTiming

NODES = {
    "director": director.run,
    "generate": generator.run,
    "curate": curator.run,
    "assemble": editor.run,
    "qa": qa.run,
    "review": review.run,
}


def route(prev: str, state, config: dict) -> str:
    """Next node, given the node that just ran. Terminates on non-running status."""
    if state.status != "running":
        return "END"
    if prev == "director":
        return "generate"
    if prev == "generate":
        return "curate"
    if prev == "curate":
        max_attempts = int(config.get("curator", {}).get("max_attempts", 3))
        if state.retry_shots and state.attempts.get("curate", 0) < max_attempts:
            return "generate"
        return "assemble"
    if prev == "assemble":
        return "qa"
    if prev == "qa":
        max_fix = int(config.get("assemble", {}).get("max_attempts", 2))
        if state.qa is not None and not state.qa.passed and state.attempts.get("assemble", 0) < max_fix:
            return "assemble"
        return "review"
    return "END"


def _max_attempts(node: str, config: dict) -> int:
    if node == "director":
        return int(config.get("director", {}).get("max_attempts", 3))
    return 2


def execute(state, ctx, max_steps: int = 60):
    """Run the graph in place; returns the final state object."""
    node = "director"
    steps = 0
    while node != "END" and steps < max_steps:
        steps += 1
        fn = NODES[node]
        t0 = time.monotonic()
        try:
            patch = fn(state, ctx) or {}
        except PipelineError as e:
            attempts = state.attempts.get(node, 0) + 1
            state.attempts[node] = attempts
            state.last_error = str(e)
            ctx.persist(state)
            if e.retryable and attempts < _max_attempts(node, ctx.config):
                continue  # same node again, with last_error as feedback
            state.status = "failed"
            ctx.persist(state)
            return state
        except Exception as e:  # unexpected: fail the run loudly, keep state
            state.attempts[node] = state.attempts.get(node, 0) + 1
            state.last_error = f"{type(e).__name__}: {e}"
            state.status = "failed"
            ctx.persist(state)
            raise
        state = state.model_copy(update=patch)
        state.timings.append(StageTiming(
            stage=node, node=node, started_at=t0,
            duration_s=round(time.monotonic() - t0, 3),
            detail={"attempt": state.attempts.get(node, 0) + 1},
        ))
        ctx.persist(state)
        node = route(node, state, ctx.config)
    if node != "END":
        state.status = "failed"
        state.last_error = f"exceeded {max_steps} steps"
        ctx.persist(state)
    return state
