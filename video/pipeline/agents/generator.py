"""Generator agents: fan-out over (shot x generator variant) in parallel.

Each variant is one agent with its own backend/model/style. For the Remotion
backend the agent first asks its LLM to write the scene component
("scene_writer"), then hands the code to the backend which writes the file
and renders a preview for the curator.
"""
from __future__ import annotations

import asyncio

from ..errors import PipelineError
from .common import extract_json, load_prompt


def run(state, ctx) -> dict:
    if state.storyboard is None:
        raise PipelineError("no storyboard yet", retryable=False)
    only = set(state.retry_shots)
    shots = [s for s in state.storyboard.shots if not only or s.id in only]
    gens = ctx.config["generators"]
    sem = asyncio.Semaphore(int(ctx.config.get("concurrency", 4)))

    async def one(shot, gen):
        async with sem:
            backend = ctx.backend(gen["backend"])
            prompt = (
                f"{shot.prompt}\n"
                f"Beat: {shot.beat}. Caption on screen: {shot.caption!r}.\n"
                f"Variant style: {gen.get('style', '')}\n{gen.get('style_suffix', '')}"
            )
            code = None
            if backend.kind == "scene":
                llm = ctx.llm_for(gen)
                raw = llm.complete(
                    "scene_writer", load_prompt("scene_writer"),
                    "Write ONE Remotion scene component. Return JSON {\"code\": ...}.",
                    {"shot": shot.model_dump(mode="json"), "variant": gen,
                     "video": ctx.config["video"], "design_refs": ctx.config.get("design_refs", [])},
                )
                parsed = extract_json(raw)
                code = parsed.get("code") or raw
            return backend.generate(shot, gen, ctx.run_dir / "clips", ctx, code=code, prompt=prompt)

    async def gather_all():
        tasks = [one(s, g) for s in shots for g in gens]
        return await asyncio.gather(*tasks)

    results = asyncio.run(gather_all())
    return {"candidates": [*state.candidates, *results], "retry_shots": []}
