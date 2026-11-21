"""Wire protocol for hub <-> phone messages (CONTRACT.md §2, BLUEPRINT_1.md "Message format").

Messages are short plain text — no images or audio over the mesh.

A **question** is one or more lines of text plus an optional last line
``loc: <lat>,<lon>``::

    How do I make river water safe to drink?
    loc: 51.50070,-0.12460

The hub answers a question with exactly two messages, in order:

1. the ACK line ``Received. Working on an answer.``
2. the answer text ending with the exact disclaimer line
   ``AI answer from an offline model. Not verified emergency advice.``

A **location share** is a single message whose body is just ``loc: <lat>,<lon>``,
optionally prefixed with one short note line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Exact protocol constants (CONTRACT.md §2 — do not reword, the frontend matches them).
ACK_TEXT = "Received. Working on an answer."
DISCLAIMER = "AI answer from an offline model. Not verified emergency advice."
LOC_PREFIX = "loc:"

_LOC_RE = re.compile(r"^loc:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$", re.IGNORECASE)


def parse_loc_line(line: str | None) -> tuple[float, float] | None:
    """Parse a single ``loc: <lat>,<lon>`` line.

    Returns ``(lat, lon)`` as floats, or ``None`` when the line is not a valid
    location (wrong shape, non-numeric, or out of range).
    """
    if not line:
        return None
    m = _LOC_RE.match(line.strip())
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    return lat, lon


def format_loc(loc) -> str:
    """Normalize a location to the canonical ``<lat>,<lon>`` string.

    Accepts a ``"<lat>,<lon>"`` string (validated, returned unchanged so
    round-trips are exact) or a ``(lat, lon)`` pair. Raises ``ValueError``
    for anything else.
    """
    if isinstance(loc, str):
        s = loc.strip()
        if parse_loc_line(LOC_PREFIX + " " + s) is None:
            raise ValueError(f"invalid location: {loc!r}")
        return s
    if isinstance(loc, (tuple, list)) and len(loc) == 2:
        try:
            lat, lon = float(loc[0]), float(loc[1])
        except (TypeError, ValueError):
            raise ValueError(f"invalid location: {loc!r}") from None
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            raise ValueError(f"location out of range: {loc!r}")
        return f"{lat},{lon}"
    raise ValueError(f"invalid location: {loc!r}")


def split_loc(text: str) -> tuple[str, str | None]:
    """Split a message into ``(body, loc)``.

    If the last non-empty line is a ``loc:`` line, it is removed from the body
    and returned as the ``loc`` string (``"<lat>,<lon>"``); otherwise ``loc``
    is ``None``.
    """
    lines = (text or "").splitlines()
    idx = len(lines) - 1
    while idx >= 0 and not lines[idx].strip():
        idx -= 1
    if idx < 0:
        return "", None
    if parse_loc_line(lines[idx]) is not None:
        loc = lines[idx].strip()[len(LOC_PREFIX):].strip()
        body = "\n".join(lines[:idx]).rstrip()
        return body, loc
    return (text or "").strip(), None


def format_question(text: str, loc=None) -> str:
    """Build a question message: the text, plus a ``loc:`` last line when ``loc`` is given."""
    body = (text or "").strip()
    if loc is None or loc == "":
        return body
    return f"{body}\n{LOC_PREFIX} {format_loc(loc)}"


def is_loc_only(text: str) -> bool:
    """True when the whole message is a single ``loc:`` line (a pure location share)."""
    stripped = (text or "").strip()
    if not stripped or "\n" in stripped:
        return False
    return parse_loc_line(stripped) is not None


def format_loc_message(loc, note: str | None = None) -> str:
    """Build a location-share message: ``loc: <lat>,<lon>``, optionally with a note line above."""
    line = f"{LOC_PREFIX} {format_loc(loc)}"
    if note and note.strip():
        return f"{note.strip()}\n{line}"
    return line


def format_ack() -> str:
    """The hub's first reply to a question (exact text)."""
    return ACK_TEXT


def format_answer(answer_text: str) -> str:
    """Append the mandatory disclaimer as the exact last line of an answer."""
    body = (answer_text or "").rstrip("\n")
    return f"{body}\n{DISCLAIMER}"


def has_disclaimer(text: str) -> bool:
    """True when the last non-empty line of ``text`` is exactly the disclaimer."""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    return bool(lines) and lines[-1] == DISCLAIMER


def strip_disclaimer(text: str) -> str:
    """Remove the disclaimer line if present (inverse of :func:`format_answer`)."""
    lines = (text or "").rstrip("\n").splitlines()
    if lines and lines[-1].strip() == DISCLAIMER:
        lines = lines[:-1]
    return "\n".join(lines).rstrip("\n")


@dataclass
class ParsedMessage:
    """Best-effort parse of a raw mesh text (no transport metadata available)."""

    kind: str          # "question" | "loc"
    text: str          # question text (body without the loc line)
    loc: str | None    # "<lat>,<lon>" string when a loc line is present


def parse_message(text: str) -> ParsedMessage:
    """Classify a raw message: a bare ``loc:`` line is a location share, anything else a question."""
    if is_loc_only(text):
        _, loc = split_loc(text)
        return ParsedMessage(kind="loc", text="", loc=loc)
    body, loc = split_loc(text)
    return ParsedMessage(kind="question", text=body, loc=loc)
