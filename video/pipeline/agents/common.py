"""Shared helpers for agents."""
from __future__ import annotations

import json
from pathlib import Path

from ..errors import PipelineError

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"


def load_prompt(name: str) -> str:
    p = PROMPTS / f"{name}.md"
    if p.exists():
        return p.read_text()
    raise PipelineError(f"missing prompt file {p}", retryable=False)


def extract_json(text: str) -> dict:
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise PipelineError(f"LLM output has no JSON object: {text[:300]!r}")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise PipelineError(f"LLM output is not valid JSON: {e}\n{text[:300]!r}")
