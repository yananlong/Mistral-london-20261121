"""ffmpeg/ffprobe helpers (stdlib subprocess only)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"command failed ({proc.returncode}): {' '.join(cmd)}\n{proc.stderr[-2000:]}"
        )


def ffprobe_json(path: str | Path) -> dict:
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_format", "-show_streams", str(path),
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {proc.stderr[-1000:]}")
    return json.loads(proc.stdout)


def _fps(frac: str) -> float:
    try:
        num, den = frac.split("/")
        return float(num) / float(den) if float(den) else 0.0
    except Exception:
        return 0.0


def probe_video(path: str | Path) -> dict:
    """duration_s, width, height, fps, has_audio, bytes for a media file."""
    data = ffprobe_json(path)
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    if v is None:
        raise RuntimeError(f"no video stream in {path}")
    dur = float(data.get("format", {}).get("duration") or v.get("duration") or 0.0)
    return {
        "duration_s": round(dur, 3),
        "width": int(v.get("width", 0)),
        "height": int(v.get("height", 0)),
        "fps": round(_fps(v.get("r_frame_rate", "0/1")), 3),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
        "bytes": int(data.get("format", {}).get("size", 0) or 0),
    }


def normalize_segment(src: str | Path, dst: str | Path, duration_s: float,
                      w: int, h: int, fps: int) -> None:
    """Re-encode `src` into a segment of EXACTLY duration_s at w x h @ fps (pad with
    cloned last frame if the source is shorter, trim if longer)."""
    _run([
        "ffmpeg", "-y", "-i", str(src),
        "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
               f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},"
               f"tpad=stop_mode=clone:stop_duration={duration_s}",
        "-t", str(duration_s),
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(dst),
    ])


def concat_video(segments: list[str | Path], dst: str | Path) -> None:
    """Concatenate video-only segments (re-encode for clean timestamps)."""
    list_file = Path(dst).parent / "concat_list.txt"
    list_file.write_text("".join(f"file '{Path(s).absolute()}'\n" for s in segments))
    _run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p", "-an", str(dst),
    ])


def mix_audio(video_in: str | Path, dst: str | Path, total_s: float,
              voiceover: str | Path | None = None, bed: bool = True) -> None:
    """Mux video with a quiet music bed (lavfi sine) and an optional voiceover track."""
    cmd = ["ffmpeg", "-y", "-i", str(video_in)]
    if bed:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=196:sample_rate=44100:duration={total_s}"]
    if voiceover:
        cmd += ["-i", str(voiceover)]
    n_audio = int(bed) + int(bool(voiceover))
    if n_audio == 0:
        _run(["ffmpeg", "-y", "-i", str(video_in), "-c", "copy", "-movflags", "+faststart", str(dst)])
        return
    if n_audio == 1:
        filt = "[1:a]volume=0.12,loudnorm=I=-16:TP=-1.5:LRA=11[a]"
        maps = ["-map", "0:v", "-map", "[a]"]
    else:
        filt = ("[1:a]volume=0.12[bed];"
                "[bed][2:a]amix=inputs=2:duration=first:normalize=0,"
                "loudnorm=I=-16:TP=-1.5:LRA=11[a]")
        maps = ["-map", "0:v", "-map", "[a]"]
    _run(cmd + ["-filter_complex", filt] + maps +
         ["-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
          "-t", str(total_s), "-movflags", "+faststart", str(dst)])


def make_poster(src: str | Path, dst: str | Path, t: float = 0.5) -> None:
    _run(["ffmpeg", "-y", "-ss", str(t), "-i", str(src), "-frames:v", "1", str(dst)])


def write_srt(entries: list[tuple[float, float, str]], dst: str | Path) -> None:
    """entries: (start_s, end_s, text)."""
    def ts(s: float) -> str:
        h = int(s // 3600); m = int((s % 3600) // 60); sec = s % 60
        return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".", ",")
    parts = [
        f"{i + 1}\n{ts(a)} --> {ts(b)}\n{text}\n"
        for i, (a, b, text) in enumerate(entries)
    ]
    Path(dst).write_text("\n".join(parts))
