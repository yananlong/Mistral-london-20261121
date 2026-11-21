"""Backend registry."""
from __future__ import annotations

from .base import VideoBackend
from .stub import StubBackend

KIND = {"stub": "clip"}

try:  # remotion backend needs node only at render time, not at import time
    from .remotion import RemotionBackend
    KIND["remotion"] = "scene"
    _REGISTRY = {"stub": StubBackend, "remotion": RemotionBackend}
except Exception:  # pragma: no cover
    _REGISTRY = {"stub": StubBackend}


def make_backend(name: str, cfg: dict) -> VideoBackend:
    if name not in _REGISTRY:
        raise RuntimeError(
            f"unknown video backend {name!r}; registered: {sorted(_REGISTRY)}. "
            "For Runway/Kling/Veo style APIs, add a 'clip' backend in backends/."
        )
    return _REGISTRY[name](cfg)


def backend_kind(name: str) -> str:
    return KIND[name]
