"""RunContext + the top-level run_pipeline() entry point used by the CLI and tests."""
from __future__ import annotations

import json
import time
from pathlib import Path

from .backends import make_backend
from .graph import execute
from .llm import make_llm
from .schemas import Brief, RunState


class RunContext:
    def __init__(self, run_dir: Path, config: dict, llm, auto_approve: bool):
        self.run_dir = Path(run_dir)
        self.config = config
        self.llm = llm
        self.auto_approve = auto_approve
        self._backends: dict[str, object] = {}

    def backend(self, name: str):
        if name not in self._backends:
            self._backends[name] = make_backend(name, self.config.get("backends", {}).get(name, {}))
        return self._backends[name]

    def backend_kind_of(self, entry) -> str:
        from .backends import backend_kind
        backend_name = getattr(entry, "backend", None) or "stub"
        return backend_kind(backend_name)

    def llm_for(self, gen: dict):
        """A generator variant may override the LLM (different model per agent)."""
        if "llm" in gen:
            merged = {**self.config, "llm": {**self.config.get("llm", {}), **gen["llm"]}}
            return make_llm(merged)
        return self.llm

    def persist(self, state: RunState) -> None:
        self.run_dir.mkdir(parents=True, exist_ok=True)
        (self.run_dir / "state.json").write_text(state.model_dump_json(indent=2))
        with (self.run_dir / "timing.jsonl").open("a") as f:
            for t in state.timings[-1:]:
                f.write(t.model_dump_json() + "\n")


def run_pipeline(config: dict, brief: dict, run_id: str | None = None,
                 out_root: str | None = None) -> RunState:
    """Execute the full graph. Returns the final RunState (also in runs/<id>/state.json)."""
    run_id = run_id or time.strftime("run-%Y%m%d-%H%M%S")
    root = Path(out_root or config.get("run", {}).get("out_root", "video/runs"))
    run_dir = (root / run_id).absolute()
    run_dir.mkdir(parents=True, exist_ok=True)
    llm = make_llm(config)
    state = RunState(run_id=run_id, brief=Brief(**brief), config=config)
    ctx = RunContext(run_dir, config, llm,
                     auto_approve=bool(config.get("run", {}).get("auto_approve", False)))
    ctx.persist(state)
    state = execute(state, ctx)
    (run_dir / "manifest.json").write_text(state.model_dump_json(indent=2))
    return state
