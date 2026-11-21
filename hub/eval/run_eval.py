#!/usr/bin/env python3
"""Run the Ask eval case set against a live hub responder (wait=true and async modes).

Stdlib only (the hub is offline). Usage on the Spark:

    ssh spark 'cd <repo> && HUB_BIND=127.0.0.1 HUB_MODEL=ministral-3:14b-instruct-2512-fp16 \
        python3 hub/responder.py & sleep 1; curl -sf http://127.0.0.1:8080/health'
    python3 hub/eval/run_eval.py --base http://<spark>:8080 --out hub/eval/results.jsonl
    python3 hub/eval/score_eval.py hub/eval/results.jsonl

Cases come from phone/test/golden/ask_cases.json (single source of truth).
"""

import argparse
import json
import os
import sys
import threading
import time
import urllib.request

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_CASES = os.path.join(REPO_ROOT, "phone", "test", "golden", "ask_cases.json")


def post_json(url, payload, timeout):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return resp.status, json.loads(body) if body else {}, time.monotonic() - t0


class CallbackSink(threading.Thread):
    """Minimal HTTP sink for async callback deliveries (--async-callbacks)."""

    def __init__(self, port):
        super().__init__(daemon=True)
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        self.deliveries = []
        sink = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                sink.deliveries.append(json.loads(raw.decode("utf-8")))
                self.send_response(200)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *a):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", port), H)
        self.port = self.server.server_address[1]

    def run(self):
        self.server.serve_forever(poll_interval=0.05)

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


def run_case(base, case, repeat, parallel_sink=None):
    rows = []
    for i in range(repeat):
        payload = {"sender": "eval", "question": case["question"]}
        if parallel_sink is not None:
            payload["callback_url"] = f"http://127.0.0.1:{parallel_sink.port}/cb"
        else:
            payload["wait"] = True
        try:
            status, body, wall = post_json(base + "/ask", payload, timeout=300)
            answer = body.get("answer", "")
            rows.append({
                "id": case["id"], "category": case.get("category", ""),
                "repeat": i, "http_status": status, "wall_s": round(wall, 2),
                "answer_chars": len(answer), "answer_bytes": len(answer.encode("utf-8")),
                "answer": answer,
            })
        except Exception as e:  # noqa: BLE001 - record any failure as a row
            rows.append({"id": case["id"], "category": case.get("category", ""),
                         "repeat": i, "http_status": 0, "wall_s": None,
                         "answer_chars": 0, "answer_bytes": 0, "error": str(e), "answer": ""})
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:8080", help="hub responder base URL")
    ap.add_argument("--cases", default=DEFAULT_CASES)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "results.jsonl"))
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--parallel", type=int, default=1, help="run N cases concurrently (async mode when >1)")
    ap.add_argument("--async-callbacks", action="store_true",
                    help="use async mode with a local callback sink instead of wait=true")
    args = ap.parse_args()

    with open(args.cases, encoding="utf-8") as fh:
        cases = json.load(fh)["cases"]

    sink = None
    if args.async_callbacks or args.parallel > 1:
        sink = CallbackSink(0)
        sink.start()

    all_rows = []
    lock = threading.Lock()

    def worker(case):
        rows = run_case(args.base, case, args.repeat, sink)
        with lock:
            all_rows.extend(rows)

    threads = []
    for case in cases:
        t = threading.Thread(target=worker, args=(case,))
        t.start()
        threads.append(t)
        if sink is not None and len(threads) % args.parallel == 0:
            for x in threads[-args.parallel:]:
                x.join()
    for t in threads:
        t.join()

    if sink is not None:
        deadline = time.monotonic() + 300
        expected = len(cases) * args.repeat
        while len(sink.deliveries) < expected and time.monotonic() < deadline:
            time.sleep(0.2)
        for i, d in enumerate(sink.deliveries):
            all_rows.append({"id": "async-delivery", "category": "delivery", "repeat": i,
                             "http_status": 200, "wall_s": None, "answer_chars": len(d.get("answer", "")),
                             "answer_bytes": len(d.get("answer", "").encode("utf-8")),
                             "answer": d.get("answer", ""), "sender": d.get("sender")})
        sink.stop()

    with open(args.out, "w", encoding="utf-8") as fh:
        for row in all_rows:
            fh.write(json.dumps(row) + "\n")
    print(f"wrote {len(all_rows)} rows to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
