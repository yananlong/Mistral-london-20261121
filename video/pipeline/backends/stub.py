"""Stub backend: renders a placeholder clip per shot with ffmpeg (testsrc2).

No API keys, no Chrome, runs in CI. The clip has EXACTLY the storyboard
duration, so the 35-40 s timing path is exercised for real. `latency_s` and
`cost_per_s` from the generator config are recorded on the candidate (not
slept), and the `project` command uses them to simulate real API latencies.
"""
from __future__ import annotations

import hashlib
import time
from pathlib import Path

from ..media import make_poster, probe_video
from ..schemas import ClipCandidate, ShotSpec
from .base import VideoBackend


class StubBackend(VideoBackend):
    name = "stub"
    kind = "clip"

    def generate(self, shot: ShotSpec, variant: dict, out_dir: Path, ctx,
                 code: str | None = None, prompt: str = "") -> ClipCandidate:
        import subprocess

        video = ctx.config["video"]
        w, h, fps = int(video["width"]), int(video["height"]), int(video["fps"])
        out_dir.mkdir(parents=True, exist_ok=True)
        vname = variant["name"]
        hue = int(hashlib.sha256(vname.encode()).hexdigest(), 16) % 360
        out = out_dir / f"{shot.id}.{vname}.mp4"
        t0 = time.monotonic()
        cmd = [
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", f"testsrc2=size={w}x{h}:rate={fps}:duration={shot.duration_s}",
            "-vf", f"hue=h={hue},format=yuv420p",
            "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
            "-movflags", "+faststart",
            "-metadata", f"comment={shot.id}|{vname}",
            str(out),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"stub ffmpeg failed: {proc.stderr[-1000:]}")
        wall = time.monotonic() - t0
        p = probe_video(out)
        poster = ""
        if self.cfg.get("poster", True):
            poster_path = out_dir / f"{shot.id}.{vname}.png"
            make_poster(out, poster_path)
            poster = str(poster_path)
        hsh = int(hashlib.sha256(f"{shot.id}|{vname}".encode()).hexdigest(), 16)
        return ClipCandidate(
            shot_id=shot.id,
            variant=vname,
            backend=self.name,
            model=variant.get("model", "stub"),
            prompt_used=prompt,
            file=str(out),
            poster=poster,
            duration_s=p["duration_s"],
            width=p["width"],
            height=p["height"],
            bytes=p["bytes"],
            generation_seconds=wall,
            cost_credits=round(shot.duration_s * float(variant.get("cost_per_s", 0)), 3),
            metrics={
                "motion": round(0.5 + (hsh % 50) / 100.0, 2),
                "sharpness": round(0.6 + ((hsh >> 8) % 40) / 100.0, 2),
            },
        )
