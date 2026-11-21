"""Inference-client tests against a loopback stub server (no real model involved)."""

import json
import os
import socket
import sys
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from hub import protocol
from hub.inference import (
    SYSTEM_PROMPT,
    ChatInference,
    InferenceError,
    InferenceTimeoutError,
)


class StubHandler(BaseHTTPRequestHandler):
    """Tiny OpenAI-compatible stub: POST /v1/chat/completions and GET /v1/models."""

    reply = "1. Step one.\n2. Step two."
    delay = 0.0
    status = 200
    down = False
    captured = []

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)
        type(self).captured.append(json.loads(raw.decode("utf-8")))
        if type(self).delay:
            time.sleep(type(self).delay)
        if type(self).status != 200:
            self.send_response(type(self).status)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        data = json.dumps(
            {"choices": [{"message": {"role": "assistant", "content": type(self).reply}}]}
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if type(self).down:
            self.send_response(503)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        data = b'{"data": [{"id": "stub-model"}]}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def unused_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class TestChatInference(unittest.TestCase):
    def setUp(self):
        StubHandler.reply = "1. Step one.\n2. Step two."
        StubHandler.delay = 0.0
        StubHandler.status = 200
        StubHandler.down = False
        StubHandler.captured = []
        self.httpd = HTTPServer(("127.0.0.1", 0), StubHandler)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.client = ChatInference(model="test-model", port=self.port, timeout=5.0)

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def test_complete_returns_content_without_disclaimer(self):
        answer = self.client.complete("How do I purify water?", "51.5,-0.12")
        self.assertEqual(answer, "1. Step one.\n2. Step two.")
        self.assertFalse(protocol.has_disclaimer(answer))

    def test_request_payload_shape(self):
        self.client.complete("How do I purify water?", "51.5,-0.12")
        payload = StubHandler.captured[-1]
        self.assertEqual(payload["model"], "test-model")
        self.assertFalse(payload["stream"])
        self.assertEqual(payload["messages"][0]["role"], "system")
        self.assertEqual(payload["messages"][0]["content"], SYSTEM_PROMPT)
        self.assertEqual(
            payload["messages"][1],
            {"role": "user", "content": "How do I purify water?\nloc: 51.5,-0.12"},
        )
        self.assertIn("numbered steps", SYSTEM_PROMPT)
        self.assertIn("most urgent action first", SYSTEM_PROMPT)

    def test_complete_without_loc(self):
        self.client.complete("Question?")
        self.assertEqual(StubHandler.captured[-1]["messages"][1]["content"], "Question?")

    def test_timeout_raises_typed_error(self):
        StubHandler.delay = 1.0
        client = ChatInference(model="m", port=self.port, timeout=0.3)
        with self.assertRaises(InferenceTimeoutError):
            client.complete("slow?")

    def test_unreachable_server_raises_inference_error(self):
        client = ChatInference(model="m", port=unused_port(), timeout=1.0)
        with self.assertRaises(InferenceError) as ctx:
            client.complete("hi")
        self.assertNotIsInstance(ctx.exception, InferenceTimeoutError)

    def test_http_error_raises_inference_error(self):
        StubHandler.status = 500
        with self.assertRaises(InferenceError) as ctx:
            self.client.complete("hi")
        self.assertIn("HTTP 500", str(ctx.exception))

    def test_is_up(self):
        self.assertTrue(self.client.is_up())
        StubHandler.down = True
        self.assertFalse(self.client.is_up())
        self.assertFalse(ChatInference(model="m", port=unused_port(), timeout=0.5).is_up())

    def test_env_configuration(self):
        os.environ["HUB_MODEL"] = "env-model"
        os.environ["HUB_INFERENCE_PORT"] = str(self.port)
        os.environ["HUB_INFERENCE_TIMEOUT"] = "7.5"
        try:
            client = ChatInference()
            self.assertEqual(client.model, "env-model")
            self.assertEqual(client.base_url, f"http://127.0.0.1:{self.port}")
            self.assertEqual(client.completions_url, f"http://127.0.0.1:{self.port}/v1/chat/completions")
            self.assertEqual(client.timeout, 7.5)
        finally:
            del os.environ["HUB_MODEL"]
            del os.environ["HUB_INFERENCE_PORT"]
            del os.environ["HUB_INFERENCE_TIMEOUT"]

    def test_defaults(self):
        client = ChatInference()
        self.assertEqual(client.model, "ministral-3b")
        self.assertEqual(client.base_url, "http://127.0.0.1:8080")
        self.assertEqual(client.timeout, 120.0)


if __name__ == "__main__":
    unittest.main()
