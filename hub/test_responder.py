#!/usr/bin/env python3
"""Tests for responder.py with a stubbed Ollama (urllib is monkeypatched).

Run from this directory: python3 -m unittest
"""

import http.client
import json
import logging
import os
import socket
import threading
import time
import unittest
import urllib.error
from unittest import mock

import responder

logging.getLogger("hub.responder").setLevel(logging.CRITICAL)  # expected warnings in tests

# These tests cover the responder contract without dataset facts; test_kb.py covers the KB.
_no_kb = mock.patch.object(responder.kb, "get_kb", return_value=None)


def setUpModule():
    _no_kb.start()


def tearDownModule():
    _no_kb.stop()


class FakeHTTPResponse:
    """Just enough of urllib's response object for responder.py."""

    def __init__(self, body, status=200):
        self._body = body if isinstance(body, bytes) else body.encode("utf-8")
        self.status = status

    def read(self, *args):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def fake_urlopen_factory(model_reply=None, model_error=None, ollama_requests=None,
                         callbacks=None):
    """A urllib.request.urlopen replacement.

    URLs ending in /api/chat answer like the local Ollama server; every other
    URL is recorded as a callback POST (the {sender, answer} delivery).
    """

    def fake_urlopen(req, timeout=None):
        url = req.full_url
        data = req.data or b""
        if url.endswith("/api/chat"):
            if ollama_requests is not None:
                ollama_requests.append(
                    {"url": url, "timeout": timeout,
                     "payload": json.loads(data.decode("utf-8"))}
                )
            if model_error is not None:
                raise model_error
            return FakeHTTPResponse(
                json.dumps({"message": {"role": "assistant", "content": model_reply}})
            )
        if callbacks is not None:
            callbacks.append({"url": url, "payload": json.loads(data.decode("utf-8"))})
        return FakeHTTPResponse("{}")

    return fake_urlopen


class ResponderTestCase(unittest.TestCase):
    """Runs the real responder HTTP server on an ephemeral port."""

    def setUp(self):
        self.server = responder.make_server("127.0.0.1", 0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        self.thread.start()
        self.ollama_requests = []
        self.callbacks = []

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, method, path, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        headers = {"Content-Type": "application/json"} if body is not None else {}
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read().decode("utf-8")
        conn.close()
        return resp.status, (json.loads(raw) if raw else None)

    def post_ask(self, payload):
        return self.request("POST", "/ask", json.dumps(payload))

    def post_raw(self, body):
        return self.request("POST", "/ask", body)

    @staticmethod
    def wait_for(predicate, timeout=5.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return True
            time.sleep(0.02)
        return False


class TestHealth(ResponderTestCase):
    def test_health_returns_ok(self):
        status, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"status": "ok"})

    def test_unknown_get_is_404(self):
        status, _ = self.request("GET", "/nope")
        self.assertEqual(status, 404)


class TestAsyncFlow(ResponderTestCase):
    def test_ack_then_answer_via_callback(self):
        reply = "1. Let the water settle.\n2. Boil it for 1 minute."
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply=reply, ollama_requests=self.ollama_requests,
                                 callbacks=self.callbacks),
        ):
            status, body = self.post_ask({
                "sender": "phoneA",
                "question": "How do I make river water safe to drink?",
                "callback_url": "http://mac.local:9000/callback",
            })
            self.assertEqual(status, 202)
            self.assertEqual(body, {"status": "accepted", "ack": responder.ACK})
            self.assertTrue(
                self.wait_for(lambda: len(self.callbacks) == 1),
                "callback with the answer never arrived",
            )
        cb = self.callbacks[0]
        self.assertEqual(cb["url"], "http://mac.local:9000/callback")
        self.assertEqual(cb["payload"]["sender"], "phoneA")
        answer = cb["payload"]["answer"]
        self.assertIn("1. Let the water settle.", answer)
        self.assertIn("2. Boil it for 1 minute.", answer)
        self.assertTrue(answer.endswith(responder.DISCLAIMER), answer)
        # exactly one model call, shaped per the blueprint
        self.assertEqual(len(self.ollama_requests), 1)
        call = self.ollama_requests[0]
        self.assertTrue(call["url"].endswith("/api/chat"))
        req = call["payload"]
        self.assertEqual(req["model"], responder.DEFAULT_MODEL)
        self.assertIs(req["stream"], False)
        self.assertEqual(req["options"]["num_ctx"], 8192)
        self.assertEqual(req["messages"][0]["role"], "system")
        self.assertIn("numbered steps", req["messages"][0]["content"])
        self.assertEqual(req["messages"][1]["role"], "user")
        self.assertEqual(
            req["messages"][1]["content"], "How do I make river water safe to drink?"
        )

    def test_model_timeout_posts_retry_error_answer(self):
        err = urllib.error.URLError(socket.timeout("timed out"))
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_error=err, callbacks=self.callbacks),
        ):
            status, body = self.post_ask({
                "sender": "phoneA",
                "question": "Is the river water safe?",
                "callback_url": "http://mac.local:9000/callback",
            })
            self.assertEqual(status, 202)
            self.assertEqual(body["ack"], responder.ACK)
            self.assertTrue(
                self.wait_for(lambda: len(self.callbacks) == 1),
                "error callback never arrived",
            )
        answer = self.callbacks[0]["payload"]["answer"]
        self.assertEqual(self.callbacks[0]["payload"]["sender"], "phoneA")
        self.assertIn("retry", answer.lower())
        self.assertTrue(answer.endswith(responder.DISCLAIMER), answer)


class TestSyncFlow(ResponderTestCase):
    def test_wait_true_returns_full_answer(self):
        reply = "1. Rinse the wound with clean water.\n2. Press firmly with a cloth."
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply=reply, ollama_requests=self.ollama_requests),
        ):
            status, body = self.post_ask({
                "sender": "phoneB",
                "question": "How do I stop heavy bleeding?",
                "wait": True,
            })
        self.assertEqual(status, 200)
        self.assertEqual(body["sender"], "phoneB")
        self.assertIn("1. Rinse the wound", body["answer"])
        self.assertTrue(body["answer"].endswith(responder.DISCLAIMER), body["answer"])
        self.assertEqual(len(self.callbacks), 0)

    def test_wait_true_model_error_returns_502_with_retry_answer(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_error=TimeoutError("too slow")),
        ):
            status, body = self.post_ask({
                "sender": "phoneB",
                "question": "How do I stop heavy bleeding?",
                "wait": True,
            })
        self.assertEqual(status, 502)
        self.assertIn("retry", body["answer"].lower())
        self.assertTrue(body["answer"].endswith(responder.DISCLAIMER), body["answer"])

    def test_loc_line_is_stripped_and_passed_as_structured_data(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply="1. Move uphill.",
                                 ollama_requests=self.ollama_requests),
        ):
            status, _ = self.post_ask({
                "sender": "phoneA",
                "question": "Where should I go?\nloc: 51.50070,-0.12460",
                "wait": True,
            })
        self.assertEqual(status, 200)
        user_msg = self.ollama_requests[0]["payload"]["messages"][1]["content"]
        self.assertNotIn("loc:", user_msg)
        self.assertIn("Where should I go?", user_msg)
        self.assertIn("51.5007", user_msg)
        self.assertIn("-0.1246", user_msg)

    def test_loc_json_field_is_used_when_text_has_no_loc_line(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply="ok", ollama_requests=self.ollama_requests),
        ):
            status, _ = self.post_ask({
                "sender": "phoneA",
                "question": "Any flooding near me?",
                "loc": "51.5,-0.12",
                "wait": True,
            })
        self.assertEqual(status, 200)
        user_msg = self.ollama_requests[0]["payload"]["messages"][1]["content"]
        self.assertNotIn("loc:", user_msg)
        self.assertIn("51.5", user_msg)
        self.assertIn("-0.12", user_msg)

    def test_disclaimer_appended_when_model_omits_it(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply="1. Boil the water."),
        ):
            status, body = self.post_ask({
                "sender": "p", "question": "q?", "wait": True,
            })
        self.assertEqual(status, 200)
        self.assertEqual(body["answer"], "1. Boil the water.\n" + responder.DISCLAIMER)

    def test_disclaimer_not_duplicated_when_model_includes_it(self):
        raw = "1. Boil the water.\n" + responder.DISCLAIMER
        with mock.patch(
            "urllib.request.urlopen", fake_urlopen_factory(model_reply=raw)
        ):
            status, body = self.post_ask({
                "sender": "p", "question": "q?", "wait": True,
            })
        self.assertEqual(status, 200)
        self.assertEqual(body["answer"], raw)

    def test_answer_truncated_at_sentence_boundary(self):
        raw = ("First sentence here. Second sentence follows. "
               "Third sentence is much longer than the cap.")
        with mock.patch.dict(os.environ, {"HUB_MAX_ANSWER_CHARS": "60"}), mock.patch(
            "urllib.request.urlopen", fake_urlopen_factory(model_reply=raw)
        ):
            status, body = self.post_ask({
                "sender": "p", "question": "q?", "wait": True,
            })
        self.assertEqual(status, 200)
        answer = body["answer"]
        self.assertTrue(answer.endswith("\n" + responder.DISCLAIMER), answer)
        model_part = answer[: -len(responder.DISCLAIMER) - 1]
        self.assertLessEqual(len(model_part), 60)
        self.assertTrue(model_part.endswith("."), model_part)
        self.assertNotIn("Third sentence", model_part)

    def test_env_selects_ollama_endpoint_model_and_context(self):
        env = {
            "OLLAMA_HOST": "192.168.5.2:11434",
            "HUB_MODEL": "test-model:latest",
            "OLLAMA_CONTEXT_LENGTH": "4096",
        }
        with mock.patch.dict(os.environ, env), mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply="ok", ollama_requests=self.ollama_requests),
        ):
            status, _ = self.post_ask({"sender": "p", "question": "q?", "wait": True})
        self.assertEqual(status, 200)
        call = self.ollama_requests[0]
        self.assertEqual(call["url"], "http://192.168.5.2:11434/api/chat")
        self.assertEqual(call["payload"]["model"], "test-model:latest")
        self.assertEqual(call["payload"]["options"]["num_ctx"], 4096)


class TestMalformedInput(ResponderTestCase):
    def test_invalid_json_body_is_400(self):
        status, body = self.post_raw("{not json")
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_non_object_body_is_400(self):
        status, _ = self.post_raw(json.dumps([1, 2]))
        self.assertEqual(status, 400)

    def test_missing_question_is_400(self):
        status, _ = self.post_ask({"sender": "phoneA"})
        self.assertEqual(status, 400)

    def test_empty_sender_is_400(self):
        status, _ = self.post_ask({"sender": "   ", "question": "q?"})
        self.assertEqual(status, 400)

    def test_bad_loc_field_is_400(self):
        status, _ = self.post_ask({"sender": "p", "question": "q?", "loc": "abc"})
        self.assertEqual(status, 400)

    def test_loc_only_question_is_400(self):
        status, _ = self.post_ask({"sender": "p", "question": "loc: 51.5,-0.1"})
        self.assertEqual(status, 400)

    def test_out_of_range_loc_line_is_400(self):
        status, _ = self.post_ask({"sender": "p", "question": "q?\nloc: 123.0,0.0"})
        self.assertEqual(status, 400)

    def test_missing_body_is_400(self):
        status, _ = self.request("POST", "/ask")
        self.assertEqual(status, 400)

    def test_unknown_post_path_is_404(self):
        status, _ = self.request("POST", "/nope", "{}")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
