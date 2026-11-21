"""Editor agent: winners -> EDL -> rendered final.mp4 (+ captions.srt + audio).

Two assembly paths depending on the backend kind of the winning candidates:
  - "clip"  (stub / AI video APIs): ffmpeg normalize + concat + audio mix
  - "scene" (remotion): write the single `main` composition and render it once
"""
from __future__ import annotations

from pathlib import Path

from .. import audio as audio_mod
from ..backends import backend_kind
from ..backends.remotion import RemotionBackend
from ..errors import PipelineError
from ..media import concat_video, mix_audio, normalize_segment, write_srt
from ..schemas import EDL, EDLEntry
from ..timing import adjust_to_range, validate_total


def run(state, ctx) -> dict:
    sb = state.storyboard
    if sb is None:
        raise PipelineError("no storyboard yet", retryable=False)
    entries: list[EDLEntry] = []
    winners = []
    for s in sb.shots:
        r = state.reviews.get(s.id)
        if r is None:
            raise PipelineError(f"no review for shot {s.id}", retryable=False)
        cands = [c for c in state.candidates if c.shot_id == s.id and c.variant == r.winner]
        if not cands:
            raise PipelineError(
                f"no candidate matches winner variant {r.winner!r} for shot {s.id}", retryable=False
            )
        winners.append(cands[-1])
        entries.append(EDLEntry(shot_id=s.id, file=cands[-1].file,
                                duration_s=s.duration_s, caption=s.caption))

    ok, total = validate_total([e.duration_s for e in entries],
                               sb.duration_min_s, sb.duration_max_s)
    if not ok:  # keep the rendered file inside the window even if the plan drifted
        adj = adjust_to_range([e.duration_s for e in entries],
                              sb.duration_min_s, sb.duration_max_s)
        for e, d in zip(entries, adj):
            e.duration_s = d
        total = round(sum(adj), 3)
    edl = EDL(entries=entries, total_duration_s=total)

    kind = backend_kind(winners[0].backend)
    if kind == "scene":
        final = _assemble_remotion(state, ctx, winners, edl)
    else:
        final = _assemble_clips(state, ctx, winners, edl)

    # captions sidecar (start/end per shot, cumulative)
    if ctx.config.get("assemble", {}).get("captions", True):
        t, srt_entries = 0.0, []
        for e in edl.entries:
            srt_entries.append((t, t + e.duration_s, e.caption or e.shot_id))
            t += e.duration_s
        write_srt(srt_entries, ctx.run_dir / "captions.srt")

    return {"edl": edl, "final": final}


def _voiceover(state, ctx) -> str | None:
    audio_cfg = ctx.config.get("assemble", {}).get("audio", {})
    if not state.brief.voiceover or not audio_cfg.get("voiceover", True):
        return None
    lines = [s.voiceover_line for s in state.storyboard.shots if s.voiceover_line.strip()]
    if not lines:
        lines = [state.storyboard.voiceover_script] if state.storyboard.voiceover_script.strip() else []
    return audio_mod.voiceover_track(
        lines, ctx.run_dir / "audio", audio_cfg.get("provider", "stub"), audio_cfg.get("voice", "")
    )


def _assemble_clips(state, ctx, winners, edl) -> str:
    video = ctx.config["video"]
    w, h, fps = int(video["width"]), int(video["height"]), int(video["fps"])
    seg_dir = ctx.run_dir / "segments"
    seg_dir.mkdir(parents=True, exist_ok=True)
    segments = []
    for e, cand in zip(edl.entries, winners):
        seg = seg_dir / f"{e.shot_id}.mp4"
        normalize_segment(cand.file, seg, e.duration_s, w, h, fps)
        segments.append(seg)
    video_only = ctx.run_dir / "video_only.mp4"
    concat_video(segments, video_only)
    final = ctx.run_dir / "final.mp4"
    audio_cfg = ctx.config.get("assemble", {}).get("audio", {})
    bed = bool(audio_cfg.get("bed", True))
    vo = _voiceover(state, ctx)
    if bed or vo:
        mix_audio(video_only, final, edl.total_duration_s, voiceover=vo, bed=bed)
    else:
        shutil_copy(video_only, final)
    return str(final)


def _assemble_remotion(state, ctx, winners, edl) -> str:
    backend = ctx.backend("remotion")
    if not isinstance(backend, RemotionBackend):
        raise PipelineError("remotion backend not registered", retryable=False)
    backend.write_main(ctx.run_dir, ctx.config, winners, edl)
    video_only = ctx.run_dir / "video_only.mp4"
    backend.render_main(ctx.run_dir, ctx.config, video_only)
    final = ctx.run_dir / "final.mp4"
    audio_cfg = ctx.config.get("assemble", {}).get("audio", {})
    bed = bool(audio_cfg.get("bed", True))
    vo = _voiceover(state, ctx)
    if bed or vo:
        mix_audio(video_only, final, edl.total_duration_s, voiceover=vo, bed=bed)
    else:
        shutil_copy(video_only, final)
    return str(final)


def shutil_copy(src: Path, dst: Path) -> None:
    import shutil
    shutil.copy2(src, dst)
