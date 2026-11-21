"""LLM providers for the pipeline agents.

One provider per run (config llm.provider), optionally overridden per
generator agent (generators[i].llm) so the two generator agents can use
different models. Providers:
  - stub:    deterministic canned answers, offline dry runs / CI
  - ollama:  local model on the DGX Spark (see hub/), stdlib HTTP
  - mistral: hosted Mistral API, MISTRAL_API_KEY (see SETUP_VOXTRAL.md)
"""
from __future__ import annotations

import json
import os
import urllib.request

from .errors import PipelineError


class BaseLLM:
    name = "base"

    def complete(self, agent: str, system: str, user: str, payload: dict | None = None) -> str:
        """Return the agent's raw text output (agents parse JSON out of it)."""
        raise NotImplementedError


class StubLLM(BaseLLM):
    name = "stub"

    def complete(self, agent: str, system: str, user: str, payload: dict | None = None) -> str:
        from .stub_brain import answer
        return answer(agent, payload or {}, user)


class OllamaLLM(BaseLLM):
    name = "ollama"

    def __init__(self, model: str = "ministral-3:14b-instruct-2512-fp16", base_url: str | None = None):
        self.model = model
        self.base_url = (base_url or os.environ.get("OLLAMA_HOST") or "http://127.0.0.1:11434").rstrip("/")

    def complete(self, agent: str, system: str, user: str, payload: dict | None = None) -> str:
        msgs = [
            {"role": "system", "content": system},
            {"role": "user", "content": user + "\n\nINPUT JSON:\n" + json.dumps(payload or {}, ensure_ascii=False)},
        ]
        req = urllib.request.Request(
            self.base_url + "/api/chat",
            data=json.dumps({"model": self.model, "messages": msgs, "format": "json", "stream": False}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=900) as r:
            body = json.loads(r.read())
        return body["message"]["content"]


class MistralLLM(BaseLLM):
    name = "mistral"

    def __init__(self, model: str = "mistral-large-latest", api_key: str | None = None):
        self.model = model
        self.key = api_key or os.environ.get("MISTRAL_API_KEY")
        if not self.key:
            raise PipelineError("MISTRAL_API_KEY is not set (see SETUP_VOXTRAL.md)", retryable=False)

    def complete(self, agent: str, system: str, user: str, payload: dict | None = None) -> str:
        msgs = [
            {"role": "system", "content": system},
            {"role": "user", "content": user + "\n\nINPUT JSON:\n" + json.dumps(payload or {}, ensure_ascii=False)},
        ]
        req = urllib.request.Request(
            "https://api.mistral.ai/v1/chat/completions",
            data=json.dumps({
                "model": self.model,
                "messages": msgs,
                "response_format": {"type": "json_object"},
            }).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.key}"},
        )
        with urllib.request.urlopen(req, timeout=900) as r:
            body = json.loads(r.read())
        return body["choices"][0]["message"]["content"]


def make_llm(cfg: dict) -> BaseLLM:
    p = cfg.get("llm", {})
    provider = p.get("provider", "stub")
    if provider == "stub":
        return StubLLM()
    if provider == "ollama":
        return OllamaLLM(model=p.get("model", "ministral-3:14b-instruct-2512-fp16"), base_url=p.get("base_url"))
    if provider == "mistral":
        return MistralLLM(model=p.get("model", "mistral-large-latest"), api_key=p.get("api_key"))
    raise PipelineError(f"unknown llm provider {provider!r}", retryable=False)
