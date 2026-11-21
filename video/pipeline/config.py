"""Config loading: config.default.json + optional config.local.json (gitignored) + overrides."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Optional

VIDEO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = VIDEO_ROOT / "config.default.json"


def deep_merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load_config(path: Optional[str] = None, overrides: Optional[dict] = None) -> dict:
    """Load config.default.json, then config.local.json next to it (gitignored),
    then an explicit path, then in-memory overrides (deep-merged, highest priority)."""
    cfg = json.loads(DEFAULT_CONFIG_PATH.read_text())
    local = VIDEO_ROOT / "config.local.json"
    if local.exists():
        cfg = deep_merge(cfg, json.loads(local.read_text()))
    if path:
        cfg = deep_merge(cfg, json.loads(Path(path).read_text()))
    if overrides:
        cfg = deep_merge(cfg, overrides)
    return cfg
