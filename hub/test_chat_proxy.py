#!/usr/bin/env python3
"""Tests for POST /api/chat, the Ollama-compatible endpoint for the Swift hub.

A real fake Ollama HTTP server stands behind the responder, so the whole
path runs: Swift-style request -> responder -> Ollama -> same response shape.
Run with:  cd hub && python3 -m unittest test_chat_proxy
"""

import http.client
import json
import logging
import os
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

import kb
import responder

logging.getLogger("hub.responder").setLevel(logging.CRITICAL)

SWIFT_SYSTEM = "Help someone facing an emergency. (the Swift hub's own prompt)"
FP16 = "ministral-3:14b-instruct-2512-fp16"


class FakeOllama(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), FakeOllamaHandler)
        self.requests = []
        self.mode = "ok"
        self.content = "1. Move to a safe place."
        self.delay = 0.0
        self.extra = {"done": True, "done_reason": "stop", "eval_count": 7}


class FakeOllamaHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.requests.append({"path": self.path, "payload": payload})
        time.sleep(self.server.delay)
        if self.server.mode == "error500":
            self.send_error(500)
            return
        if payload.get("stream"):
            lines = [
                json.dumps({"model": payload["model"], "message": {"role": "assistant", "content": w},
                            "done": False}).encode() + b"\n"
                for w in ("1. ", "Move ", "now.")
            ] + [json.dumps({"model": payload["model"], "message": {"role": "assistant", "content": ""},
                             "done": True, "done_reason": "stop"}).encode() + b"\n"]
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Connection", "close")
            self.end_headers()
            for line in lines:
                self.wfile.write(line)
                self.wfile.flush()
            return
        reply = {"model": payload["model"], "created_at": "2026-11-21T16:00:00Z",
                 "message": {"role": "assistant", "content": self.server.content}}
        reply.update(self.server.extra)
        body = json.dumps(reply).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the responder gave up on a slow reply (timeout test)


def swift_request(user, stream=False, model="ministral-3:14b-instruct-2512-q4_K_M"):
    """The body that OllamaClient.swift sends."""
    body = {
        "model": model,
        "keep_alive": -1,
        "messages": [{"role": "system", "content": SWIFT_SYSTEM},
                     {"role": "user", "content": user}],
        "options": {"num_predict": 400, "temperature": 0.3},
    }
    if stream is not None:
        body["stream"] = stream
    return body


class ChatProxyTestCase(unittest.TestCase):
    ENV = {"HUB_KB": "0"}

    def setUp(self):
        kb.reset_kb()
        self.addCleanup(kb.reset_kb)
        self.ollama = FakeOllama()
        threading.Thread(target=self.ollama.serve_forever, kwargs={"poll_interval": 0.05},
                         daemon=True).start()
        env = dict(self.ENV, OLLAMA_HOST="127.0.0.1:%d" % self.ollama.server_address[1])
        self.env = mock.patch.dict(os.environ, env)
        self.env.start()
        os.environ.pop("HUB_MODEL", None)
        self.server = responder.make_server("127.0.0.1", 0)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05},
                         daemon=True).start()

    def tearDown(self):
        for server in (self.server, self.ollama):
            server.shutdown()
            server.server_close()
        self.env.stop()

    def post(self, body, path="/api/chat"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        conn.request("POST", path, json.dumps(body), {"Content-Type": "application/json"})
        resp = conn.getresponse()
        raw = resp.read()
        conn.close()
        return resp.status, resp.getheader("Content-Type"), raw

    def upstream(self):
        return self.ollama.requests[-1]["payload"]


class TestChatProxy(ChatProxyTestCase):
    def test_non_stream_keeps_ollamas_shape_and_applies_the_hubs_prompt_and_model(self):
        status, ctype, raw = self.post(swift_request("How do I stop heavy bleeding?"))
        self.assertEqual(status, 200)
        self.assertTrue(ctype.startswith("application/json"))
        reply = json.loads(raw)
        # Ollama's shape, unchanged: the Swift client reads message.content
        self.assertEqual(reply["message"], {"role": "assistant", "content": "1. Move to a safe place."})
        self.assertEqual(reply["done"], True)
        self.assertEqual(reply["eval_count"], 7)
        self.assertEqual(reply["created_at"], "2026-11-21T16:00:00Z")
        # no ack and no label here: the Swift side adds them
        self.assertNotIn(responder.ACK, raw.decode())
        self.assertNotIn(responder.DISCLAIMER, raw.decode())
        sent = self.upstream()
        self.assertEqual(self.ollama.requests[-1]["path"], "/api/chat")
        self.assertEqual(sent["model"], FP16)  # forced, whatever the caller asked for
        self.assertIs(sent["stream"], False)
        self.assertEqual(sent["keep_alive"], -1)
        self.assertEqual([m["role"] for m in sent["messages"]], ["system", "user"])
        self.assertEqual(sent["messages"][0]["content"], responder.SYSTEM_PROMPT)
        self.assertNotIn(SWIFT_SYSTEM, json.dumps(sent))
        self.assertEqual(sent["messages"][1]["content"], "How do I stop heavy bleeding?")
        # the caller's options are kept; num_predict is capped; num_ctx is the
        # hub's 8192, the same as /ask, so Ollama never reloads between the two
        self.assertEqual(sent["options"], {"temperature": 0.3, "num_ctx": 8192,
                                           "num_predict": responder.num_predict()})

    def test_same_messages_and_model_as_ask(self):
        self.post(swift_request("How do I stop heavy bleeding?"))
        proxied = self.upstream()
        self.post({"sender": "p", "question": "How do I stop heavy bleeding?", "wait": True}, "/ask")
        for key in ("model", "messages", "keep_alive", "stream"):
            self.assertEqual(proxied[key], self.upstream()[key], key)

    def test_a_smaller_num_predict_from_the_caller_is_kept(self):
        body = swift_request("q")
        body["options"] = {"num_predict": 50, "temperature": 0.1, "seed": 7}
        self.post(body)
        self.assertEqual(self.upstream()["options"],
                         {"num_predict": 50, "temperature": 0.1, "seed": 7, "num_ctx": 8192})
        body["options"] = {"num_ctx": 4096}
        self.post(body)
        self.assertEqual(self.upstream()["options"]["num_ctx"], 4096)

    def test_fail_safe_forwards_the_original_request_when_the_override_throws(self):
        body = swift_request("How do I stop heavy bleeding?")
        with mock.patch.object(responder, "build_chat_payload", side_effect=RuntimeError("kb broke")):
            status, _, raw = self.post(body)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["message"]["content"], "1. Move to a safe place.")
        sent = self.upstream()
        self.assertEqual(sent["messages"], body["messages"])  # the caller's own prompt
        self.assertEqual(sent["options"], body["options"])
        self.assertEqual(sent["model"], FP16)  # still the pulled tag

    def test_deadline_is_inside_the_swift_hubs_120_s_model_timeout(self):
        self.assertLessEqual(responder.answer_timeout(), 110.0)

    def test_swift_location_sentence_and_loc_line_are_parsed(self):
        expected = "Where is water?\n\nAsker location (lat, lon): 51.5007, -0.1246"
        for user in (
            "Where is water?\n\nThe person's approximate location: 51.50070, -0.12460 (London, UK).",
            "Where is water?\nloc: 51.50070,-0.12460",
        ):
            self.post(swift_request(user))
            self.assertEqual(self.upstream()["messages"][1]["content"], expected)
        self.assertEqual(
            responder.parse_chat_user_content("A\nloc: 1,2\nB\nloc: 3,4x"), ("A\nloc: 1,2\nB\nloc: 3,4x", None))

    def test_markdown_is_stripped_and_a_cut_answer_loses_its_unfinished_sentence(self):
        self.ollama.content = "1. **Call 999** now.\n2. Press hard and do not"
        self.ollama.extra = {"done": True, "done_reason": "length"}
        status, _, raw = self.post(swift_request("q"))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw)["message"]["content"], "1. Call 999 now.")

    def test_stream_true_or_omitted_passes_ndjson_through(self):
        for stream in (True, None):
            status, ctype, raw = self.post(swift_request("q", stream=stream))
            self.assertEqual(status, 200)
            self.assertEqual(ctype, "application/x-ndjson")
            lines = [json.loads(l) for l in raw.decode().splitlines()]
            self.assertEqual("".join(l["message"]["content"] for l in lines), "1. Move now.")
            self.assertIs(lines[-1]["done"], True)
            self.assertIs(self.upstream()["stream"], True)
            self.assertEqual(self.upstream()["messages"][0]["content"], responder.SYSTEM_PROMPT)

    def test_errors(self):
        for body in ({"messages": []}, {"messages": [{"role": "system", "content": "x"}]},
                     {"model": "m"}, swift_request("   "), [1]):
            status, _, raw = self.post(body)
            self.assertEqual(status, 400, body)
            self.assertIn("error", json.loads(raw))
        self.ollama.mode = "error500"
        status, _, raw = self.post(swift_request("q"))
        self.assertEqual(status, 500)  # Ollama's status, so the Swift hub sends its error text
        self.ollama.mode = "ok"
        with mock.patch.dict(os.environ, {"OLLAMA_HOST": "127.0.0.1:9"}):
            status, _, raw = self.post(swift_request("q"))
        self.assertEqual(status, 502)
        self.ollama.delay = 0.6
        with mock.patch.dict(os.environ, {"HUB_ANSWER_TIMEOUT_SECONDS": "0.2"}):
            status, _, raw = self.post(swift_request("q"))
        self.assertEqual(status, 504)

    def test_question_is_cut_to_200_bytes(self):
        self.post(swift_request("x" * 500))
        self.assertEqual(self.upstream()["messages"][1]["content"], "x" * 200)


class TestChatProxyQueue(ChatProxyTestCase):
    ENV = {"HUB_KB": "0", "OLLAMA_NUM_PARALLEL": "1", "HUB_QUEUE_WAIT_SECONDS": "0.2"}

    def test_same_queue_as_ask_then_503_when_busy(self):
        self.ollama.delay = 0.8
        first = []
        t = threading.Thread(target=lambda: first.append(self.post(swift_request("q1"))))
        t.start()
        time.sleep(0.2)
        status, _, raw = self.post(swift_request("q2"))
        self.assertEqual(status, 503)
        self.assertIn("busy", json.loads(raw)["error"])
        # /ask shares the same slots
        status, _, raw = self.post({"sender": "p", "question": "q3", "wait": True}, "/ask")
        self.assertEqual(status, 503)
        t.join(5)
        self.assertEqual(first[0][0], 200)
        with mock.patch.dict(os.environ, {"HUB_QUEUE_WAIT_SECONDS": "3"}):
            results = []
            threads = [threading.Thread(target=lambda: results.append(self.post(swift_request("q"))[0]))
                       for _ in range(2)]
            for th in threads:
                th.start()
            for th in threads:
                th.join(10)
        self.assertEqual(results, [200, 200])  # the second one queued, then ran


class TestChatProxyLoopbackOnly(ChatProxyTestCase):
    def test_non_loopback_caller_is_refused(self):
        with mock.patch.object(responder.ipaddress, "ip_address") as ip:
            ip.return_value.is_loopback = False
            status, _, raw = self.post(swift_request("q"))
        self.assertEqual(status, 403)
        self.assertEqual(self.ollama.requests, [])


@unittest.skipUnless(
    os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "datasets", "phone", "pois", "london_pois.sqlite")),
    "datasets not present",
)
class TestChatProxyKnowledgeBase(ChatProxyTestCase):
    ENV = {"HUB_KB": "1"}

    def test_kb_facts_are_added_exactly_as_for_ask(self):
        user = ("Which way to the nearest hospital with an A&E?\n\n"
                "The person's approximate location: 51.50070, -0.12460 (London, UK).")
        self.post(swift_request(user))
        proxied = self.upstream()["messages"][1]["content"]
        self.assertIn("Facts from the hub's offline datasets", proxied)
        self.assertIn("St Thomas", proxied)
        self.post({"sender": "p", "wait": True,
                   "question": "Which way to the nearest hospital with an A&E?\nloc: 51.50070,-0.12460"},
                  "/ask")
        self.assertEqual(self.upstream()["messages"][1]["content"], proxied)


if __name__ == "__main__":
    unittest.main()
