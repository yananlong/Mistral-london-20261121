"""OpenAI-compatible chat client for a local inference server (llama.cpp ``llama-server`` or Ollama).

Standard library only (``urllib.request``) — the demo Mac mini is offline, so no pip
packages at runtime. The server URL is::

    http://127.0.0.1:$HUB_INFERENCE_PORT/v1/chat/completions      (default port 8080)

Environment configuration:

========================  =============================================  ==========
Variable                  Meaning                                        Default
========================  =============================================  ==========
``HUB_MODEL``             model name sent in every request               ``ministral-3b``
``HUB_INFERENCE_PORT``    port of the local inference server             ``8080``
``HUB_INFERENCE_TIMEOUT`` per-request timeout in seconds                 ``120``
========================  =============================================  ==========

``complete(question, loc)`` returns the answer text WITHOUT the disclaimer line —
the disclaimer is appended by ``hub.core`` so it is always present, even on fallback
answers. Timeouts and errors raise typed exceptions (:class:`InferenceError` and its
subclass :class:`InferenceTimeoutError`).
"""

from __future__ import annotations

import json
import os
import socket
import urllib.error
import urllib.request

from . import protocol

DEFAULT_MODEL = "ministral-3b"
DEFAULT_PORT = 8080
DEFAULT_TIMEOUT = 120.0

# System prompt per BLUEPRINT_1.md "Ask: Mistral on an offline Mac mini":
# short numbered steps, plain language, most urgent action first, short answers
# (the mesh link is slow and the reader may be stressed).
SYSTEM_PROMPT = (
    "You are the assistant of an offline hub in a disaster area. "
    "You have no live information about the emergency; rely only on your training. "
    "Answer with short numbered steps in plain language. "
    "Put the most urgent action first. "
    "Keep the whole answer under 120 words and do not ask questions back."
)


class InferenceError(Exception):
    """The local inference server could not produce an answer."""


class InferenceTimeoutError(InferenceError):
    """The local inference server did not answer within the configured timeout."""


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _env_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if value in (None, ""):
        return default
    try:
        return float(value)
    except ValueError:
        return default


class ChatInference:
    """Minimal OpenAI-compatible chat client (``POST /v1/chat/completions``)."""

    def __init__(
        self,
        model: str | None = None,
        port: int | None = None,
        timeout: float | None = None,
        base_url: str | None = None,
        system_prompt: str | None = None,
    ) -> None:
        self.model = _env_str("HUB_MODEL", DEFAULT_MODEL) if model is None else model
        if base_url is not None:
            self.base_url = base_url.rstrip("/")
        else:
            if port is None:
                port = int(_env_float("HUB_INFERENCE_PORT", DEFAULT_PORT))
            self.base_url = f"http://127.0.0.1:{port}"
        self.timeout = float(
            timeout if timeout is not None else _env_float("HUB_INFERENCE_TIMEOUT", DEFAULT_TIMEOUT)
        )
        self.system_prompt = SYSTEM_PROMPT if system_prompt is None else system_prompt

    @property
    def completions_url(self) -> str:
        return self.base_url + "/v1/chat/completions"

    @property
    def models_url(self) -> str:
        return self.base_url + "/v1/models"

    def complete(self, question: str, loc=None) -> str:
        """Run one chat completion and return the answer text WITHOUT the disclaimer.

        ``loc`` is an optional ``"<lat>,<lon>"`` (or ``(lat, lon)``) attached to the
        user message as a ``loc:`` last line, exactly as it travels the mesh.

        Raises :class:`InferenceTimeoutError` on timeout, :class:`InferenceError`
        on any other failure (unreachable server, HTTP error, malformed response).
        """
        question = (question or "").strip()
        user_text = protocol.format_question(question, loc) if loc else question
        payload = {
            "model": self.model,
            "stream": False,
            "messages": [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": user_text},
            ],
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.completions_url,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read()
        except urllib.error.HTTPError as e:
            try:
                detail = e.read(200).decode("utf-8", "replace")
            except Exception:
                detail = ""
            raise InferenceError(
                f"inference server at {self.completions_url} returned HTTP {e.code}: {detail.strip()}"
            ) from e
        except (socket.timeout, TimeoutError) as e:
            raise InferenceTimeoutError(
                f"inference server at {self.base_url} timed out after {self.timeout:g}s"
            ) from e
        except urllib.error.URLError as e:
            reason = getattr(e, "reason", e)
            if isinstance(reason, (socket.timeout, TimeoutError)):
                raise InferenceTimeoutError(
                    f"inference server at {self.base_url} timed out after {self.timeout:g}s"
                ) from e
            raise InferenceError(f"cannot reach inference server at {self.base_url}: {reason}") from e
        except OSError as e:
            raise InferenceError(f"cannot reach inference server at {self.base_url}: {e}") from e

        try:
            obj = json.loads(body.decode("utf-8"))
            content = obj["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError) as e:
            raise InferenceError(
                f"unexpected response from {self.completions_url}: {body[:200]!r}"
            ) from e
        if not isinstance(content, str) or not content.strip():
            raise InferenceError(f"inference server at {self.base_url} returned an empty answer")
        return content.strip()

    def is_up(self, timeout: float = 2.0) -> bool:
        """Cheap liveness probe: ``GET /v1/models`` (supported by llama-server and Ollama)."""
        try:
            req = urllib.request.Request(self.models_url, method="GET")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return 200 <= resp.status < 300
        except urllib.error.HTTPError as e:
            e.close()
            return False
        except Exception:
            return False


_default_client: ChatInference | None = None


def complete(question: str, loc=None) -> str:
    """Module-level convenience: ``complete(question, loc)`` with a client configured from env."""
    global _default_client
    if _default_client is None:
        _default_client = ChatInference()
    return _default_client.complete(question, loc)
