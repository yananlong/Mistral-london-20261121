"""QA node: verify the rendered file with ffprobe against the spec."""
from __future__ import annotations

import os

from ..media import probe_video
from ..schemas import Check, QAReport


def run(state, ctx) -> dict:
    p = probe_video(state.final)
    video = ctx.config["video"]
    lo, hi = state.brief.duration_min_s, state.brief.duration_max_s
    audio_cfg = ctx.config.get("assemble", {}).get("audio", {})
    want_audio = bool(audio_cfg.get("bed", True)) or state.brief.voiceover
    checks = [
        Check(name="duration_in_range",
              ok=lo - 0.05 <= p["duration_s"] <= hi + 0.05,
              detail=f'{p["duration_s"]}s must be in [{lo}, {hi}]s'),
        Check(name="resolution",
              ok=(p["width"], p["height"]) == (int(video["width"]), int(video["height"])),
              detail=f'{p["width"]}x{p["height"]}'),
        Check(name="fps", ok=abs(p["fps"] - float(video["fps"])) < 1.0, detail=f'{p["fps"]}'),
        Check(name="has_audio", ok=p["has_audio"] == want_audio,
              detail=f'has_audio={p["has_audio"]} expected={want_audio}'),
        Check(name="nonempty", ok=p["bytes"] > 10_000, detail=f'{p["bytes"]} bytes'),
    ]
    if state.edl is not None:
        def _exists(f: str) -> bool:
            return (os.path.exists(f) or os.path.exists(ctx.run_dir / f)
                    or os.path.exists(ctx.run_dir / "studio" / f))
        missing = [e.shot_id for e in state.edl.entries if e.file and not _exists(e.file)]
        checks.append(Check(name="edl_files_exist", ok=not missing, detail=f"missing={missing}"))
    passed = all(c.ok for c in checks)
    report = QAReport(
        passed=passed, duration_s=p["duration_s"], duration_min_s=lo, duration_max_s=hi,
        width=p["width"], height=p["height"], fps=p["fps"], has_audio=p["has_audio"],
        file=state.final, checks=checks,
    )
    return {"qa": report, "attempts": {**state.attempts, "assemble": state.attempts.get("assemble", 0) + 1}}
