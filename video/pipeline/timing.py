"""Duration planning and validation.

The 35-40 s budget is enforced here, not in prompts: the director proposes
shot durations, `plan_durations`/`adjust_to_range` keep the sum inside the
window, and the QA node verifies the *rendered* file with ffprobe.
"""
from __future__ import annotations


def plan_durations(total_s: float, weights: list[float], quantum: float = 0.5) -> list[float]:
    """Split `total_s` across beats proportionally to `weights`, summing EXACTLY to total_s.

    Largest-remainder rounding on `quantum`-second steps (default 0.5 s), with a
    minimum of one step per beat, so the assembled cut always lands in range.
    """
    if total_s <= 0:
        raise ValueError("total_s must be > 0")
    if not weights or any(w <= 0 for w in weights):
        raise ValueError("weights must be non-empty and positive")
    steps = max(len(weights), round(total_s / quantum))
    wsum = sum(weights)
    raw = [steps * w / wsum for w in weights]
    base = [max(1, int(x)) for x in raw]
    diff = steps - sum(base)
    order = sorted(range(len(weights)), key=lambda i: raw[i] - int(raw[i]), reverse=True)
    i = 0
    while diff != 0 and i < 10000:
        idx = order[i % len(order)]
        if diff > 0:
            base[idx] += 1
            diff -= 1
        elif base[idx] > 1:
            base[idx] -= 1
            diff += 1
        i += 1
    return [round(b * quantum, 3) for b in base]


def validate_total(durations: list[float], lo: float, hi: float) -> tuple[bool, float]:
    """Return (ok, total) for a list of shot durations against the [lo, hi] window."""
    total = round(sum(durations), 3)
    return (lo - 1e-6 <= total <= hi + 1e-6), total


def adjust_to_range(durations: list[float], lo: float, hi: float) -> list[float]:
    """Trim the longest shots (or pad the last shot) so the sum lands inside [lo, hi].

    Used by the editor when the storyboard sum is out of range and by the QA fix
    loop when the rendered file drifted out of range.
    """
    ds = [float(d) for d in durations]
    if not ds:
        raise ValueError("no durations")
    total = sum(ds)
    if total > hi:
        excess = total - hi
        order = sorted(range(len(ds)), key=lambda i: ds[i], reverse=True)
        for i in order:
            if excess <= 1e-9:
                break
            cut = min(ds[i] - 1.0, excess)
            if cut > 0:
                ds[i] -= cut
                excess -= cut
        total = sum(ds)
    if total < lo:
        ds[-1] += lo - total
    return [round(d, 3) for d in ds]
