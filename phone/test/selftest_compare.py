#!/usr/bin/env python3
"""Self-test for scripts/compare_device_runs.py: synthetic CSVs must produce
PASS / FAIL / PENDING verdicts with exit codes 0 / 1 as documented.

Run from the repo root: python3 phone/test/selftest_compare.py
Stdlib only, no device needed.
"""

import csv
import os
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
COMPARE = os.path.join(REPO_ROOT, "scripts", "compare_device_runs.py")

HEADER = ["timestamp", "device", "tier", "phase", "case_id", "file", "run", "maxImageSide", "prompt",
          "stopReason", "promptTokens", "imageTokens", "generatedTokens", "loadSec", "prefillSec",
          "ttftSec", "decodeTokPerSec", "totalSec", "imageEncodeProbeSec", "peakFootprintMB",
          "thermal", "battery_pct", "error", "answer", "usable"]


def make_csv(path, device="pixel9a", tier="lean", total=20.0, ttft=8.0, soak_rows=20, stop="end_of_generation"):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(HEADER)
        for i in range(soak_rows):
            w.writerow(["2026-11-21T16:00:00Z", device, tier, "soak", f"case-{i % 10}", f"case-{i % 10}.jpg",
                        i + 1, 512, "prompt", stop, 100, 200, 128, 5.0, 2.0, ttft, 10.0, total,
                        6.0, 3000, 0, 90, "", "an answer", ""])


def make_scores(path, device="pixel9a", usable=9):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["device", "case_id", "usable", "scorer", "notes"])
        for i in range(10):
            w.writerow([device, f"case-{i}", "1" if i < usable else "0", "A", ""])


def run(compare_args):
    p = subprocess.run([sys.executable, "-I", COMPARE] + compare_args,
                       capture_output=True, text=True)
    return p.returncode, p.stdout


def main():
    failures = []
    with tempfile.TemporaryDirectory() as d:
        # PASS case: 20 soak rows, p95 20s <= 35s, ttft 8 <= 20, 9/10 usable
        csv_ok = os.path.join(d, "bench-pass.csv")
        scores_ok = os.path.join(d, "scores.csv")
        make_csv(csv_ok)
        make_scores(scores_ok)
        rc, out = run([csv_ok, "--scores", scores_ok])
        if rc != 0 or "PASS" not in out:
            failures.append(f"PASS case: rc={rc} out={out[-400:]}")

        # FAIL: p95 too slow (total=40 > 35)
        csv_slow = os.path.join(d, "bench-slow.csv")
        make_csv(csv_slow, total=40.0)
        rc, out = run([csv_slow, "--scores", scores_ok])
        if rc == 0 or "FAIL" not in out:
            failures.append(f"slow case should FAIL: rc={rc}")

        # FAIL: only 18 soak rows (crash)
        csv_crash = os.path.join(d, "bench-crash.csv")
        make_csv(csv_crash, soak_rows=18)
        rc, out = run([csv_crash, "--scores", scores_ok])
        if rc == 0 or "FAIL" not in out:
            failures.append(f"crash case should FAIL: rc={rc}")

        # FAIL: only 7/10 usable
        scores_low = os.path.join(d, "scores-low.csv")
        make_scores(scores_low, usable=7)
        rc, out = run([csv_ok, "--scores", scores_low])
        if rc == 0 or "FAIL" not in out:
            failures.append(f"low-usable case should FAIL: rc={rc}")

        # PENDING: no scores file
        rc, out = run([csv_ok])
        if "PENDING" not in out:
            failures.append(f"no-scores case should be PENDING: rc={rc} out={out[-300:]}")

    if failures:
        print("SELFTEST FAILURES:")
        for f in failures:
            print(" -", f)
        return 1
    print("selftest_compare: all PASS/FAIL/PENDING expectations met")
    return 0


if __name__ == "__main__":
    sys.exit(main())
