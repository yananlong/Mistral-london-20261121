#!/usr/bin/env python3
"""Check the loc: line grammar agrees between phone/app (locLine.ts) and hub/responder.py.

Extracts the TS regex literal from locLine.ts and LOC_LINE_RE from responder.py,
then runs a sample battery through both. Exit 1 on any drift.

Run from the repo root: python3 scripts/check_loc_line_compat.py
"""

import os
import re
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOC_TS = os.path.join(REPO_ROOT, "phone", "app", "src", "locate", "locLine.ts")
RESP = os.path.join(REPO_ROOT, "hub", "responder.py")

SAMPLES = [
    "loc: 51.50070,-0.12460",
    "LOC:  51.50 , -0.12 ",
    "loc:51.5,-0.1",
    "loc: -90,180",
    "loc: 90.00001,-0.1",
    "loc: 0x33,0",
    "loc: 5e1,0",
    "loc: NaN,0",
    "loc: +51.5,-0.1",
    "myloc: 1,2",
    "loc: 1",
    "hello",
]


def main():
    ts_src = open(LOC_TS, encoding="utf-8").read()
    m = re.search(r"const LOC_LINE_RE_TS = /(.+?)/([a-z]*)", ts_src)
    if not m:
        print("FAIL: LOC_LINE_RE_TS not found in locLine.ts")
        return 1
    ts_re = re.compile(m.group(1), re.IGNORECASE if "i" in m.group(2) else 0)

    sys.path.insert(0, os.path.dirname(RESP))
    import responder
    hub_re = responder.LOC_LINE_RE

    drift = []
    for s in SAMPLES:
        a, b = bool(ts_re.match(s.strip())), bool(hub_re.match(s.strip()))
        if a != b:
            drift.append((s, a, b))
        print(f"  {s!r:<32} phone={a} hub={b}")
    if drift:
        print("FAIL: loc: grammar drift:", drift)
        return 1
    print("ok: loc: line grammar matches on all samples")
    return 0


if __name__ == "__main__":
    sys.exit(main())
