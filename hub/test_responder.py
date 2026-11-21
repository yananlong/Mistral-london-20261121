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


class TestDisclaimerSuffix(ResponderTestCase):
    def test_disclaimer_echoed_mid_answer_still_ends_with_it(self):
        # a crafted question can make the model echo the label mid-answer;
        # the delivered answer must still END with the disclaimer
        reply = "1. Boil water. %s 2. Then filter it." % responder.DISCLAIMER
        with mock.patch(
            "urllib.request.urlopen", fake_urlopen_factory(model_reply=reply)
        ):
            status, body = self.post_ask({"sender": "p", "question": "q?", "wait": True})
        self.assertEqual(status, 200)
        self.assertTrue(body["answer"].endswith(responder.DISCLAIMER), body["answer"])
        self.assertEqual(body["answer"].count(responder.DISCLAIMER), 2)


class TestConcurrencyCap(unittest.TestCase):
    def test_429_when_saturated_and_slot_released_afterwards(self):
        entered = threading.Event()
        release = threading.Event()
        callbacks = []

        def blocking_urlopen(req, timeout=None):
            url = req.full_url
            if url.endswith("/api/chat"):
                entered.set()
                release.wait(10)
                return FakeHTTPResponse(
                    json.dumps({"message": {"role": "assistant", "content": "1. ok."}})
                )
            callbacks.append({"url": url, "payload": json.loads((req.data or b"{}").decode())})
            return FakeHTTPResponse("{}")

        with mock.patch.dict(os.environ, {"OLLAMA_NUM_PARALLEL": "1"}):
            server = responder.make_server("127.0.0.1", 0)
        port = server.server_address[1]
        thread = threading.Thread(
            target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        thread.start()

        def post(payload):
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
            conn.request("POST", "/ask", json.dumps(payload),
                         {"Content-Type": "application/json"})
            resp = conn.getresponse()
            raw = resp.read().decode("utf-8")
            conn.close()
            return resp.status, (json.loads(raw) if raw else None)

        try:
            with mock.patch("urllib.request.urlopen", blocking_urlopen):
                status1, body1 = post({"sender": "a", "question": "q1",
                                       "callback_url": "http://127.0.0.1:9/cb"})
                self.assertEqual(status1, 202)
                self.assertEqual(body1["ack"], responder.ACK)
                self.assertTrue(ResponderTestCase.wait_for(entered.is_set, 5),
                                "the model call never started")
                # the only slot is held: async and wait asks are refused with 429
                status2, body2 = post({"sender": "b", "question": "q2",
                                       "callback_url": "http://127.0.0.1:9/cb"})
                self.assertEqual(status2, 429)
                self.assertEqual(body2["status"], "busy")
                self.assertIn("retry", body2["answer"].lower())
                self.assertTrue(body2["answer"].endswith(responder.DISCLAIMER), body2)
                status3, body3 = post({"sender": "c", "question": "q3", "wait": True})
                self.assertEqual(status3, 429)
                self.assertTrue(body3["answer"].endswith(responder.DISCLAIMER), body3)
                release.set()
                self.assertTrue(ResponderTestCase.wait_for(lambda: len(callbacks) == 1, 5),
                                "the first answer was never delivered")
                self.assertTrue(callbacks[0]["payload"]["answer"].endswith(responder.DISCLAIMER))
                # the slot was released: the next ask is accepted again
                status4, _ = post({"sender": "d", "question": "q4",
                                  "callback_url": "http://127.0.0.1:9/cb"})
                self.assertEqual(status4, 202)
                self.assertTrue(ResponderTestCase.wait_for(lambda: len(callbacks) == 2, 5))
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


class TestBroadExceptionHandling(ResponderTestCase):
    def test_unexpected_error_wait_mode_returns_502_retry_answer(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_error=RuntimeError("boom")),
        ):
            status, body = self.post_ask({"sender": "p", "question": "q?", "wait": True})
        self.assertEqual(status, 502)
        self.assertIn("boom", body["error"])
        self.assertIn("retry", body["answer"].lower())
        self.assertTrue(body["answer"].endswith(responder.DISCLAIMER), body["answer"])

    def test_unexpected_error_async_mode_still_calls_back(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_error=ValueError("weird"), callbacks=self.callbacks),
        ):
            status, body = self.post_ask({
                "sender": "p", "question": "q?", "callback_url": "http://127.0.0.1:9/cb",
            })
            self.assertEqual(status, 202)
            self.assertEqual(body["ack"], responder.ACK)
            self.assertTrue(
                self.wait_for(lambda: len(self.callbacks) == 1),
                "no callback after an unexpected error",
            )
        answer = self.callbacks[0]["payload"]["answer"]
        self.assertIn("retry", answer.lower())
        self.assertTrue(answer.endswith(responder.DISCLAIMER), answer)

    def test_bad_numeric_env_falls_back_instead_of_crashing(self):
        env = {
            "OLLAMA_CONTEXT_LENGTH": "abc",
            "HUB_MAX_ANSWER_CHARS": "0",
            "HUB_ANSWER_TIMEOUT_SECONDS": "xyz",
        }
        with mock.patch.dict(os.environ, env), mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply="1. ok.", ollama_requests=self.ollama_requests),
        ):
            status, body = self.post_ask({"sender": "p", "question": "q?", "wait": True})
        self.assertEqual(status, 200)
        self.assertTrue(body["answer"].endswith(responder.DISCLAIMER), body["answer"])
        # defaults applied, truncation not disabled by HUB_MAX_ANSWER_CHARS=0
        self.assertEqual(self.ollama_requests[0]["payload"]["options"]["num_ctx"], 8192)


class TestStartupValidation(unittest.TestCase):
    def test_validate_numeric_env_exits_on_bad_values(self):
        env = {"OLLAMA_CONTEXT_LENGTH": "abc", "HUB_MAX_ANSWER_CHARS": "0", "HUB_PORT": "99999"}
        with mock.patch.dict(os.environ, env):
            with self.assertRaises(SystemExit):
                responder.validate_numeric_env()

    def test_validate_numeric_env_accepts_good_values(self):
        env = {
            "HUB_PORT": "8080",
            "HUB_ANSWER_TIMEOUT_SECONDS": "30",
            "HUB_MAX_ANSWER_CHARS": "800",
            "OLLAMA_CONTEXT_LENGTH": "4096",
            "OLLAMA_NUM_PARALLEL": "4",
        }
        with mock.patch.dict(os.environ, env):
            responder.validate_numeric_env()  # must not raise

    def test_wildcard_bind_forms_refused(self):
        for bad in ("0.0.0.0", "::", "0:0:0:0:0:0:0:0", "[::]", ""):
            self.assertTrue(responder.is_wildcard_bind(bad), bad)
        for good in ("127.0.0.1", "10.0.0.2", "192.168.5.2", "fe80::1", "spark.local"):
            self.assertFalse(responder.is_wildcard_bind(good), good)


class TestCallbackAllowlist(ResponderTestCase):
    def test_public_ip_callback_is_400(self):
        status, body = self.post_ask({
            "sender": "p", "question": "q?",
            "callback_url": "http://8.8.8.8:9000/cb", "wait": True,
        })
        self.assertEqual(status, 400)
        self.assertIn("callback_url", body["error"])

    def test_public_hostname_callback_is_400(self):
        status, body = self.post_ask({
            "sender": "p", "question": "q?",
            "callback_url": "https://evil.example.com/cb", "wait": True,
        })
        self.assertEqual(status, 400)
        self.assertIn("not allowed", body["error"])

    def test_env_allowlist_host_is_allowed(self):
        env = {"HUB_CALLBACK_ALLOW_HOSTS": "peer.example.com,10.9.9.9:9000"}
        with mock.patch.dict(os.environ, env), mock.patch(
            "urllib.request.urlopen", fake_urlopen_factory(model_reply="ok")
        ):
            status, _ = self.post_ask({
                "sender": "p", "question": "q?",
                "callback_url": "http://peer.example.com:9000/cb", "wait": True,
            })
        self.assertEqual(status, 200)

    def test_local_targets_are_allowed(self):
        # the test client connects from 127.0.0.1, so that is also the peer host
        with mock.patch(
            "urllib.request.urlopen", fake_urlopen_factory(model_reply="ok")
        ):
            for url in (
                "http://127.0.0.1:9000/cb",
                "http://192.168.5.10:9000/cb",
                "http://[fe80::1]:9000/cb",
                "http://mac.local:9000/cb",
                "http://localhost/cb",
            ):
                status, _ = self.post_ask({
                    "sender": "p", "question": "q?", "callback_url": url, "wait": True,
                })
                self.assertEqual(status, 200, url)

    def test_callback_host_allowed_unit(self):
        self.assertTrue(responder.callback_host_allowed("http://127.0.0.1:9/cb"))
        self.assertTrue(responder.callback_host_allowed("http://10.0.0.5:9/cb"))
        self.assertTrue(responder.callback_host_allowed("http://[fe80::1]:9/cb"))
        self.assertTrue(responder.callback_host_allowed("http://mac.local:9/cb"))
        self.assertTrue(responder.callback_host_allowed("http://192.168.1.20:9/cb",
                                                         peer_host="192.168.1.20"))
        self.assertFalse(responder.callback_host_allowed("http://8.8.8.8/cb"))
        self.assertFalse(responder.callback_host_allowed("http://evil.example.com/cb"))
        self.assertFalse(responder.callback_host_allowed("ftp://127.0.0.1/x"))
        self.assertFalse(responder.callback_host_allowed("http://127.0.0.1:99999/x"))
        with mock.patch.dict(os.environ, {"HUB_CALLBACK_ALLOW_HOSTS": "hub-peer.example.org"}):
            self.assertTrue(
                responder.callback_host_allowed("http://hub-peer.example.org:9000/cb")
            )


class TestLocLineParsing(ResponderTestCase):
    def test_multiple_loc_lines_are_400(self):
        status, body = self.post_ask({"sender": "p", "question": "q?\nloc: 1,2\nloc: 3,4"})
        self.assertEqual(status, 400)
        self.assertIn("loc", body["error"])

    def test_mid_body_loc_line_stays_in_the_question(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply="ok", ollama_requests=self.ollama_requests),
        ):
            status, _ = self.post_ask({
                "sender": "p", "question": "first\nloc: 1,2\nlast", "wait": True,
            })
        self.assertEqual(status, 200)
        user_msg = self.ollama_requests[0]["payload"]["messages"][1]["content"]
        self.assertIn("loc: 1,2", user_msg)  # not stripped from mid-body
        self.assertNotIn("Asker location", user_msg)  # loc is None

    def test_trailing_loc_line_is_stripped(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply="ok", ollama_requests=self.ollama_requests),
        ):
            status, _ = self.post_ask({
                "sender": "p", "question": "What now?\nloc: 51.5,-0.1", "wait": True,
            })
        self.assertEqual(status, 200)
        user_msg = self.ollama_requests[0]["payload"]["messages"][1]["content"]
        self.assertNotIn("loc:", user_msg)
        self.assertIn("Asker location (lat, lon): 51.5, -0.1", user_msg)


class TestFieldSizeCaps(ResponderTestCase):
    def test_huge_question_is_400(self):
        status, body = self.post_ask({
            "sender": "p", "question": "x" * (responder.MAX_QUESTION_CHARS + 1),
        })
        self.assertEqual(status, 400)
        self.assertIn("question", body["error"])

    def test_huge_sender_is_400(self):
        status, body = self.post_ask({
            "sender": "s" * (responder.MAX_SENDER_CHARS + 1), "question": "q?",
        })
        self.assertEqual(status, 400)
        self.assertIn("sender", body["error"])


class Test413ClosesConnection(ResponderTestCase):
    def test_413_marks_connection_close_and_server_stays_healthy(self):
        # Send only the headers of an oversized body: the server must answer
        # 413 without reading the body, and must mark the connection close so
        # the unread body cannot corrupt a keep-alive connection.
        sock = socket.create_connection(("127.0.0.1", self.port), timeout=15)
        headers = (
            "POST /ask HTTP/1.1\r\n"
            "Host: 127.0.0.1\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: %d\r\n"
            "\r\n" % (responder.MAX_BODY_BYTES + 1)
        )
        sock.sendall(headers.encode("ascii"))
        raw = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            raw += chunk
        sock.close()
        head, _, body = raw.partition(b"\r\n\r\n")
        self.assertIn(b" 413 ", head.split(b"\r\n")[0] + b" ")
        self.assertIn(b"Connection: close", head)
        self.assertIn(b"too large", body)
        # the server is still healthy on a fresh connection
        status, resp_body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(resp_body, {"status": "ok"})


if __name__ == "__main__":
    unittest.main()
