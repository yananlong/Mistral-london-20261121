#!/usr/bin/env python3
"""Extra P0 tests for responder.py (gaps found in review of PR 11).

Run from this directory: python3 -m unittest discover -s . -v
Reuses the server harness from test_responder.py.
"""

import http.client
import json
import os
import threading
import time
import unittest
import urllib.error
from unittest import mock

import responder
from test_responder import ResponderTestCase, fake_urlopen_factory, FakeHTTPResponse


class TestConcurrency(ResponderTestCase):
    def test_20_parallel_async_all_callbacks(self):
        """20 simultaneous async /ask: all 202, all callbacks arrive, no cross-talk."""
        lock = threading.Lock()
        callbacks = []

        def factory(req, timeout=None):
            url = req.full_url
            if url.endswith("/api/chat"):
                time.sleep(0.2)  # slow model => overlapping worker threads
                payload = json.loads(req.data.decode("utf-8"))
                q = payload["messages"][-1]["content"]
                return FakeHTTPResponse(json.dumps(
                    {"message": {"role": "assistant", "content": "echo: " + q}}))
            with lock:
                callbacks.append(json.loads(req.data.decode("utf-8")))
            return FakeHTTPResponse("{}")

        with mock.patch("urllib.request.urlopen", side_effect=factory):
            results = []
            rlock = threading.Lock()

            def ask(i):
                status, body = self.post_ask(
                    {"sender": f"s{i}", "question": f"q{i}", "callback_url": f"http://peer{i}/cb"})
                with rlock:
                    results.append((status, body, i))

            threads = [threading.Thread(target=ask, args=(i,)) for i in range(20)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            self.assertTrue(all(s == 202 for s, _, _ in results))
            self.assertTrue(all(b["ack"] == responder.ACK for _, b, _ in results))
            self.assertTrue(self.wait_for(lambda: len(callbacks) == 20, timeout=15))
            by_sender = {c["sender"]: c["answer"] for c in callbacks}
            for i in range(20):
                self.assertIn(f"s{i}", by_sender)
                self.assertIn(f"q{i}", by_sender[f"s{i}"])
                self.assertTrue(by_sender[f"s{i}"].endswith(responder.DISCLAIMER))

    def test_10_parallel_wait_true_no_crosstalk(self):
        def factory(req, timeout=None):
            payload = json.loads(req.data.decode("utf-8"))
            q = payload["messages"][-1]["content"]
            return FakeHTTPResponse(json.dumps(
                {"message": {"role": "assistant", "content": "echo: " + q}}))

        with mock.patch("urllib.request.urlopen", side_effect=factory):
            results = []
            rlock = threading.Lock()

            def ask(i):
                status, body = self.post_ask({"sender": f"s{i}", "question": f"q{i}", "wait": True})
                with rlock:
                    results.append((status, body))

            threads = [threading.Thread(target=ask, args=(i,)) for i in range(10)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(len(results), 10)
            for status, body in results:
                self.assertEqual(status, 200)
                self.assertTrue(body["answer"].endswith(responder.DISCLAIMER))
                self.assertIn(body["sender"][1:], body["answer"])  # own question echoed


class TestCallbackFailure(ResponderTestCase):
    def test_callback_failure_is_logged_and_server_stays_healthy(self):
        """A failed callback must not kill the worker or the server (no retry today: documented)."""
        def factory(req, timeout=None):
            if req.full_url.endswith("/api/chat"):
                return FakeHTTPResponse(json.dumps(
                    {"message": {"role": "assistant", "content": "hi"}}))
            raise urllib.error.HTTPError(req.full_url, 500, "boom", None, None)

        with mock.patch("urllib.request.urlopen", side_effect=factory):
            status, body = self.post_ask(
                {"sender": "s1", "question": "q", "callback_url": "http://peer/cb"})
            self.assertEqual(status, 202)
            time.sleep(0.5)
            status, body = self.request("GET", "/health")
            self.assertEqual(status, 200)
            self.assertEqual(body, {"status": "ok"})


class TestModelErrors(ResponderTestCase):
    def test_ollama_http_404_wait_true_returns_502_with_retry_answer(self):
        """The real misconfig: HUB_MODEL tag not pulled => Ollama 404 => 502 + retry answer."""
        err = urllib.error.HTTPError("http://x/api/chat", 404, "model not found", None, None)
        with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen_factory(model_error=err)):
            status, body = self.post_ask({"sender": "s1", "question": "q", "wait": True})
            self.assertEqual(status, 502)
            self.assertIn("retry", body["answer"].lower())
            self.assertTrue(body["answer"].endswith(responder.DISCLAIMER))

    def test_ollama_http_404_async_posts_retry_callback(self):
        err = urllib.error.HTTPError("http://x/api/chat", 404, "model not found", None, None)
        callbacks = []
        with mock.patch("urllib.request.urlopen",
                        side_effect=fake_urlopen_factory(model_error=err, callbacks=callbacks)):
            status, _ = self.post_ask({"sender": "s1", "question": "q", "callback_url": "http://peer/cb"})
            self.assertEqual(status, 202)
            self.assertTrue(self.wait_for(lambda: len(callbacks) == 1, timeout=5))
            self.assertIn("retry", callbacks[0]["payload"]["answer"].lower())

    def test_ollama_malformed_response_returns_error_not_empty_200(self):
        for bad in (b"not json", b'{"message": {}}', b'{"message": {"content": "   "}}'):
            def factory(req, timeout=None, bad=bad):
                if req.full_url.endswith("/api/chat"):
                    return FakeHTTPResponse(bad)
                return FakeHTTPResponse("{}")
            with mock.patch("urllib.request.urlopen", side_effect=factory):
                status, body = self.post_ask({"sender": "s1", "question": "q", "wait": True})
                self.assertEqual(status, 502)
                self.assertTrue(body["answer"].endswith(responder.DISCLAIMER))


class TestRobustness(ResponderTestCase):
    def test_bad_env_value_does_not_hang_asker(self):
        """HUB_ANSWER_TIMEOUT_SECONDS=abc must not leave the asker hanging (was: silence)."""
        callbacks = []
        with mock.patch.dict(os.environ, {"HUB_ANSWER_TIMEOUT_SECONDS": "abc"}), \
             mock.patch("urllib.request.urlopen",
                        side_effect=fake_urlopen_factory(model_reply="hi", callbacks=callbacks)):
            status, _ = self.post_ask({"sender": "s1", "question": "q", "callback_url": "http://peer/cb"})
            self.assertEqual(status, 202)
            self.assertTrue(self.wait_for(lambda: len(callbacks) == 1, timeout=5),
                            "callback with error answer must arrive even on bad env")
            self.assertTrue(callbacks[0]["payload"]["answer"].endswith(responder.DISCLAIMER))

    def test_413_then_new_connection_works(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=15)
        big = b'{"sender":"s","question":"' + b"x" * (responder.MAX_BODY_BYTES) + b'"}'
        conn.request("POST", "/ask", body=big, headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        resp.read()
        conn.close()
        self.assertEqual(resp.status, 413)
        status, body = self.request("GET", "/health")  # fresh connection must be sane
        self.assertEqual(status, 200)


class TestDisclaimer(ResponderTestCase):
    def test_disclaimer_is_always_last(self):
        """Model puts the disclaimer mid-answer => final answer still ENDS with it."""
        reply = "1. Boil water. " + responder.DISCLAIMER + " 2. Then filter it."
        with mock.patch("urllib.request.urlopen",
                        side_effect=fake_urlopen_factory(model_reply=reply)):
            status, body = self.post_ask({"sender": "s1", "question": "q", "wait": True})
            self.assertEqual(status, 200)
            self.assertTrue(body["answer"].endswith(responder.DISCLAIMER))
            self.assertEqual(body["answer"].count(responder.DISCLAIMER), 1)


if __name__ == "__main__":
    unittest.main()
