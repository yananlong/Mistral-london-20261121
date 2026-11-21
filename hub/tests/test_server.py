"""HTTP/SSE endpoint tests: spin the dev transport up on an ephemeral port with a
fake inference client, drive it over real HTTP, and read the SSE stream."""

import http.client
import json
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from hub import protocol
from hub.core import HubCore
from hub.inference import InferenceError
from hub.server import DevTransport


class FakeInference:
    model = "fake-model"

    def __init__(self, error=None):
        self.error = error
        self.calls = []

    def complete(self, question, loc=None):
        self.calls.append((question, loc))
        if self.error is not None:
            raise self.error
        return "1. Let it settle.\n2. Boil for 1 minute."

    def is_up(self):
        return self.error is None


def http_req(port, method, path, obj=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    body = json.dumps(obj).encode("utf-8") if obj is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    conn.request(method, path, body=body, headers=headers)
    resp = conn.getresponse()
    raw = resp.read()
    headers = dict(resp.getheaders())
    conn.close()
    return resp.status, headers, raw


def open_sse(port, ask_id):
    """Open the SSE stream; returns (connection, response) with headers already read."""
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    conn.request("GET", f"/v1/events?id={ask_id}")
    resp = conn.getresponse()
    return conn, resp


def read_events(resp, stop_kinds=("answer",), max_events=10, timeout=5.0):
    """Read SSE lines from an HTTPResponse until one of stop_kinds or timeout."""
    events = []
    name = None
    deadline = time.time() + timeout
    while time.time() < deadline and len(events) < max_events:
        try:
            raw = resp.readline()
        except Exception:
            break
        if not raw:
            break
        line = raw.decode("utf-8").rstrip("\r\n")
        if line.startswith("event:"):
            name = line[len("event:"):].strip()
        elif line.startswith("data:"):
            events.append((name, json.loads(line[len("data:"):].strip())))
            if name in stop_kinds:
                break
    return events


class ServerTestCase(unittest.TestCase):
    def setUp(self):
        self.logs = []
        self.inference = FakeInference()
        self.transport = DevTransport("127.0.0.1", 0, inference=self.inference, log=self.logs.append)
        self.core = HubCore(self.transport, self.inference, log=self.logs.append)
        self.core.start()
        self.port = self.transport.port
        self.base = f"http://127.0.0.1:{self.port}"

    def tearDown(self):
        self.core.close()

    # ------------------------------------------------------------- helpers
    def post(self, path, obj):
        status, headers, raw = http_req(self.port, "POST", path, obj)
        return status, headers, json.loads(raw.decode("utf-8"))

    def get(self, path):
        status, headers, raw = http_req(self.port, "GET", path)
        return status, headers, json.loads(raw.decode("utf-8"))


class TestAskOverSSE(ServerTestCase):
    def test_ask_yields_ack_then_answer_ending_with_disclaimer(self):
        conn, resp = open_sse(self.port, "t1")
        try:
            self.assertEqual(resp.status, 200)
            self.assertIn("text/event-stream", resp.getheader("Content-Type"))
            self.assertEqual(resp.getheader("Access-Control-Allow-Origin"), "*")

            status, headers, body = self.post(
                "/v1/ask",
                {"id": "t1", "text": "How do I make river water safe to drink?", "loc": "51.50070,-0.12460"},
            )
            self.assertEqual(status, 202)
            self.assertEqual(body["status"], "accepted")

            events = read_events(resp, stop_kinds=("answer",))
            kinds = [kind for kind, _ in events]
            self.assertEqual(kinds[:2], ["ack", "answer"])

            ack = events[0][1]
            self.assertEqual(ack["ask_id"], "t1")
            self.assertEqual(ack["text"], protocol.ACK_TEXT)

            answer = events[1][1]
            self.assertEqual(answer["ask_id"], "t1")
            self.assertEqual(
                answer["text"],
                "1. Let it settle.\n2. Boil for 1 minute.\n" + protocol.DISCLAIMER,
            )
            self.assertTrue(protocol.has_disclaimer(answer["text"]))

            # the model was called with the question text and the loc, no disclaimer
            self.assertEqual(
                self.inference.calls,
                [("How do I make river water safe to drink?", "51.50070,-0.12460")],
            )
        finally:
            conn.close()

        # terminal log shows question, ack, model run and answer
        logtext = "\n".join(self.logs)
        for word in ("question", "ack", "model", "answer"):
            self.assertIn(word, logtext)

    def test_ask_without_loc(self):
        conn, resp = open_sse(self.port, "t2")
        try:
            status, _, _ = self.post("/v1/ask", {"id": "t2", "text": "Water?", "loc": None})
            self.assertEqual(status, 202)
            events = read_events(resp, stop_kinds=("answer",))
            self.assertEqual([k for k, _ in events], ["ack", "answer"])
            self.assertEqual(self.inference.calls, [("Water?", None)])
        finally:
            conn.close()

    def test_fallback_when_inference_down(self):
        """CONTRACT.md B2 over real HTTP: ack, error, then fallback answer + disclaimer."""
        self.inference.error = InferenceError("cannot reach inference server at http://127.0.0.1:8080")
        conn, resp = open_sse(self.port, "t3")
        try:
            status, _, _ = self.post("/v1/ask", {"id": "t3", "text": "Water?"})
            self.assertEqual(status, 202)
            events = read_events(resp, stop_kinds=("answer",), max_events=10)
            kinds = [k for k, _ in events]
            self.assertEqual(kinds, ["ack", "error", "answer"])
            self.assertEqual(events[0][1]["text"], protocol.ACK_TEXT)
            self.assertIn("cannot reach inference server", events[1][1]["error"])
            fallback = events[2][1]["text"]
            self.assertIn("no local model answered", fallback)
            self.assertTrue(protocol.has_disclaimer(fallback))
        finally:
            conn.close()
        self.assertIn("INFERENCE FAILED", "\n".join(self.logs))


class TestOtherEndpoints(ServerTestCase):
    def test_health_up_and_down(self):
        status, headers, body = self.get("/v1/health")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        self.assertEqual(body, {"ok": True, "model": "fake-model", "inference": "up"})
        self.inference.error = InferenceError("down")
        status, _, body = self.get("/v1/health")
        self.assertEqual(body["inference"], "down")

    def test_peers_includes_hub_and_sse_subscribers(self):
        status, _, body = self.get("/v1/peers")
        self.assertEqual(status, 200)
        self.assertTrue(body["hub"])
        self.assertEqual(body["peers"], ["hub"])
        conn, resp = open_sse(self.port, "phone7")
        try:
            time.sleep(0.2)
            status, _, body = self.get("/v1/peers")
            self.assertIn("phone7", body["peers"])
            self.assertIn("hub", body["peers"])
        finally:
            conn.close()

    def test_loc_and_talk_relay_over_sse(self):
        conn, resp = open_sse(self.port, "mesh")
        try:
            status, _, _ = self.post("/v1/loc", {"loc": "51.5,-0.12", "note": "camp"})
            self.assertEqual(status, 202)
            status, _, _ = self.post("/v1/talk", {"text": "hello mesh"})
            self.assertEqual(status, 202)
            events = read_events(resp, stop_kinds=("talk",), max_events=5)
            kinds = [k for k, _ in events]
            self.assertEqual(kinds, ["loc", "talk"])
            loc_ev = events[0][1]
            self.assertEqual(loc_ev["loc"], "51.5,-0.12")
            self.assertEqual(loc_ev["from"], "phone")
            self.assertEqual(loc_ev["text"], "camp\nloc: 51.5,-0.12")
            talk_ev = events[1][1]
            self.assertEqual(talk_ev["text"], "hello mesh")
            self.assertEqual(talk_ev["from"], "phone")
            # no model run for loc/talk
            self.assertEqual(self.inference.calls, [])
        finally:
            conn.close()

    def test_validation_errors(self):
        status, _, body = self.post("/v1/ask", {"text": ""})
        self.assertEqual(status, 400)
        status, _, body = self.post("/v1/ask", {"id": "x", "text": "hi", "loc": "not-a-loc"})
        self.assertEqual(status, 400)
        self.assertIn("loc", body["error"])
        status, _, _ = self.post("/v1/loc", {"note": "no loc here"})
        self.assertEqual(status, 400)
        status, _, _ = self.post("/v1/talk", {})
        self.assertEqual(status, 400)

    def test_unknown_paths_404(self):
        status, _, body = http_req(self.port, "GET", "/v1/nope")
        self.assertEqual(status, 404)
        status, _, body = http_req(self.port, "POST", "/v1/nope", {"a": 1})
        self.assertEqual(status, 404)

    def test_options_preflight_cors(self):
        status, headers, _ = http_req(self.port, "OPTIONS", "/v1/ask")
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")
        self.assertIn("POST", headers.get("Access-Control-Allow-Methods", ""))

    def test_generated_ask_id_when_missing(self):
        conn, resp = open_sse(self.port, "auto")
        try:
            status, _, body = self.post("/v1/ask", {"text": "Water?"})
            self.assertEqual(status, 202)
            self.assertTrue(body["id"])
            events = read_events(resp, stop_kinds=("answer",))
            self.assertEqual(events[0][1]["ask_id"], body["id"])
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
