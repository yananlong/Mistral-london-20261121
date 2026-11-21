"""Video backend interface.

kind = "clip":  the backend returns one video file per shot (stub ffmpeg,
                or an AI video API); the editor concatenates them with ffmpeg.
kind = "scene": the backend is Remotion; the generator agent writes a React
                scene component per shot, the backend renders previews for the
                curator, and the editor renders ONE final composition.
"""
from __future__ import annotations

from pathlib import Path

from ..schemas import ClipCandidate, ShotSpec


class VideoBackend:
    name = "base"
    kind = "clip"

    def __init__(self, cfg: dict):
        self.cfg = cfg

    def generate(self, shot: ShotSpec, variant: dict, out_dir: Path, ctx,
                 code: str | None = None, prompt: str = "") -> ClipCandidate:
        raise NotImplementedError
