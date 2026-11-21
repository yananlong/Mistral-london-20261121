"""Audio stage: music bed (lavfi) + optional voiceover.

Voiceover providers:
  - "stub":    no voiceover, bed only (offline dry runs)
  - "voxtral": shells out to the repo's voxtral/tts.py (Mistral API, needs
               MISTRAL_API_KEY and voxtral/.venv), one clip per script line,
               concatenated into a single track.
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def voiceover_track(lines: list[str], out_dir: Path, provider: str, voice: str) -> str | None:
    """Synthesize `lines` into one audio file inside out_dir. None if provider is stub."""
    lines = [l.strip() for l in lines if l.strip()]
    if not lines or provider == "stub":
        return None
    if provider == "voxtral":
        tts_py = REPO_ROOT / "voxtral" / ".venv" / "bin" / "python"
        script = REPO_ROOT / "voxtral" / "tts.py"
        if not (tts_py.exists() and script.exists()):
            raise RuntimeError(
                "voxtral provider needs voxtral/.venv and voxtral/tts.py "
                "(see SETUP_VOXTRAL.md) and MISTRAL_API_KEY set"
            )
        if not os.environ.get("MISTRAL_API_KEY"):
            raise RuntimeError("MISTRAL_API_KEY is not set (see SETUP_VOXTRAL.md)")
        out_dir.mkdir(parents=True, exist_ok=True)
        parts = []
        for i, line in enumerate(lines):
            part = out_dir / f"vo_{i:02d}.mp3"
            proc = subprocess.run(
                [str(tts_py), str(script), line, str(part), "--voice", voice],
                capture_output=True, text=True,
            )
            if proc.returncode != 0 or not part.exists():
                raise RuntimeError(f"voxtral tts failed for line {i}: {proc.stderr[-800:]}")
            parts.append(part)
        if len(parts) == 1:
            return str(parts[0])
        joined = out_dir / "vo_all.mp3"
        lst = out_dir / "vo_list.txt"
        lst.write_text("".join(f"file '{p.absolute()}'\n" for p in parts))
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
             "-c", "copy", str(joined)],
            capture_output=True, text=True, check=True,
        )
        return str(joined)
    raise RuntimeError(f"unknown audio provider {provider!r}")
