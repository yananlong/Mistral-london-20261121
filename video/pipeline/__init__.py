"""Multi-agent Remotion video pipeline (see video/README.md)."""
from .config import load_config
from .runner import run_pipeline

__all__ = ["load_config", "run_pipeline"]
