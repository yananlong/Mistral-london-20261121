#!/usr/bin/env python3
"""End-to-end Ask round-trip driver: replays phone/test/golden/ask_cases.json
against a live hub responder in BOTH modes (wait=true and async callback) and
writes a CSV with per-case ack/answer latencies for the demo run log.

Typical use on the Spark (see hub/README.md and TEST_MATRIX.md):

    ssh spark 'cd <repo> && HUB_BIND=127.0.0.1 HUB_PORT=8080 \
        HUB_MODEL=ministral-3:14b-instruct-2512-fp16 \
        HUB_ANSWER_TIMEOUT_SECONDS=180 python3 hub/responder.py & sleep 1'
    python3 scripts/ask_roundtrip.py --base http://<spark>:8080 --out ask_eval_results.csv

Stdlib only. Exit 0 if every case produced an answer ending with the
disclaimer, else 1.
"""

import argparse
import csv
import json
import os
import sys
import threading
import time
import urllib.request

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_CASES = os.path.join(REPO_ROOT, "phone", "test", "golden", "ask_cases.json")
DISCLAIMER = "AI answer from an open-weight model on the hub. Not verified emergency advice."


def post_json(url, payload, timeout=300):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return resp.status, (json.loads(body) if body else {}), time.monotonic() - t0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:8080")
    ap.add_argument("--cases", default=DEFAULT_CASES)
    ap.add_argument("--out", default="ask_eval_results.csv")
    ap.add_argument("--concurrency", type=int, default=4, help="matches OLLAMA_NUM_PARALLEL")
    args = ap.parse_args()

    with open(args.cases, encoding="utf-8") as fh:
        cases = json.load(fh)["cases"]

    rows = []
    lock = threading.Lock()

    def worker(case):
        rec = {"id": case["id"], "category": case.get("category", "")}
        try:
            # sync mode: full answer in one call
            status, body, wall = post_json(
                args.base + "/ask",
                {"sender": "roundtrip", "question": case["question"], "wait": True})
            rec.update(mode="wait", http_status=status, answer_latency_s=round(wall, 2),
                       answer=body.get("answer", ""),
                       ok=body.get("answer", "").endswith(DISCLAIMER))
        except Exception as e:  # noqa: BLE001
            rec.update(mode="wait", http_status=0, answer_latency_s=None, answer="", ok=False, error=str(e))
        # async mode: measure time from POST to callback via a local sink is covered
        # by hub/eval/run_eval.py --async-callbacks; here we only check the 202 ack.
        try:
            status, body, wall = post_json(
                args.base + "/ask",
                {"sender": "roundtrip", "question": case["question"],
                 "callback_url": "http://127.0.0.1:9/cb"})  # discard callback
            rec.update(async_status=status, ack=body.get("ack", ""), ack_latency_s=round(wall, 3),
                       ack_ok=body.get("ack") == "Received. Working on an answer.")
        except Exception as e:  # noqa: BLE001
            rec.update(async_status=0, ack="", ack_latency_s=None, ack_ok=False, error=str(e))
        with lock:
            rows.append(rec)
        # pace to respect OLLAMA_NUM_PARALLEL
        time.sleep(0.05)

    threads, active = [], 0
    for case in cases:
        t = threading.Thread(target=worker, args=(case,))
        t.start()
        threads.append(t)
        active += 1
        if active >= args.concurrency:
            threads[-active].join()
            active -= 1
    for t in threads:
        t.join()

    cols = ["id", "category", "mode", "http_status", "async_status", "ack", "ack_ok",
            "ack_latency_s", "answer_latency_s", "ok", "error", "answer"]
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    bad = [r for r in rows if not (r.get("ok") and r.get("ack_ok", True))]
    print(f"wrote {len(rows)} rows to {args.out}; {len(bad)} cases failed")
    for r in bad:
        print("FAIL:", r["id"], r.get("error", ""), r.get("http_status"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
