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
        # the model's own copy is dropped (protocol/README.md): the label appears once
        self.assertEqual(body["answer"].count(responder.DISCLAIMER), 1)


def start_server(env=None):
    with mock.patch.dict(os.environ, env or {}):
        server = responder.make_server("127.0.0.1", 0)
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
    )
    thread.start()
    return server, thread


def post_to(port, payload, timeout=15):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    conn.request("POST", "/ask", json.dumps(payload), {"Content-Type": "application/json"})
    resp = conn.getresponse()
    raw = resp.read().decode("utf-8")
    conn.close()
    return resp.status, (json.loads(raw) if raw else None)


class TestQueueing(unittest.TestCase):
    """BLUEPRINT: the hub answers several questions in parallel and queues the rest."""

    def run_saturated(self, env, body):
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

        server, thread = start_server(env)
        port = server.server_address[1]
        try:
            with mock.patch.dict(os.environ, env), mock.patch(
                "urllib.request.urlopen", blocking_urlopen
            ):
                status1, body1 = post_to(port, {"sender": "a", "question": "q1",
                                                "callback_url": "http://127.0.0.1:9/cb"})
                self.assertEqual(status1, 202)
                self.assertEqual(body1["ack"], responder.ACK)
                self.assertTrue(ResponderTestCase.wait_for(entered.is_set, 5),
                                "the model call never started")
                body(port, callbacks, release)
        finally:
            release.set()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_second_asker_queues_and_is_answered_when_a_slot_frees(self):
        def body(port, callbacks, release):
            # the only slot is held: the next ask is still acked at once ...
            t0 = time.monotonic()
            status2, body2 = post_to(port, {"sender": "b", "question": "q2",
                                            "callback_url": "http://127.0.0.1:9/cb"})
            self.assertEqual(status2, 202)
            self.assertEqual(body2["ack"], responder.ACK)
            self.assertLess(time.monotonic() - t0, 0.5)
            time.sleep(0.2)
            self.assertEqual(callbacks, [])  # ... and waits in the queue
            release.set()
            self.assertTrue(ResponderTestCase.wait_for(lambda: len(callbacks) == 2, 5))
            self.assertEqual(sorted(c["payload"]["sender"] for c in callbacks), ["a", "b"])
            for c in callbacks:
                self.assertEqual(c["payload"]["status"], "answered")
                self.assertTrue(c["payload"]["answer"].endswith(responder.DISCLAIMER))

        self.run_saturated({"OLLAMA_NUM_PARALLEL": "1", "HUB_QUEUE_WAIT_SECONDS": "5"}, body)

    def test_busy_answer_after_bounded_queue_wait(self):
        def body(port, callbacks, release):
            # async: acked, then the busy answer arrives by callback
            status2, body2 = post_to(port, {"sender": "b", "question": "q2",
                                            "callback_url": "http://127.0.0.1:9/cb"})
            self.assertEqual(status2, 202)
            self.assertTrue(ResponderTestCase.wait_for(lambda: len(callbacks) == 1, 5))
            busy = callbacks[0]["payload"]
            self.assertEqual(busy["sender"], "b")
            self.assertEqual(busy["status"], "busy")
            self.assertIn("busy", busy["answer"])
            self.assertIn("retry", busy["answer"].lower())
            self.assertTrue(busy["answer"].startswith("No answer:"), busy["answer"])
            self.assertTrue(busy["answer"].endswith(responder.DISCLAIMER))
            # sync: 503 with the same busy answer, after the bounded wait
            t0 = time.monotonic()
            status3, body3 = post_to(port, {"sender": "c", "question": "q3", "wait": True})
            self.assertEqual(status3, 503)
            self.assertGreaterEqual(time.monotonic() - t0, 0.25)
            self.assertEqual(body3["status"], "busy")
            self.assertEqual(body3["answer"], busy["answer"])
            release.set()
            self.assertTrue(ResponderTestCase.wait_for(lambda: len(callbacks) == 2, 5))
            # the slot was released: the next ask is answered again
            status4, body4 = post_to(port, {"sender": "d", "question": "q4", "wait": True})
            self.assertEqual(status4, 200)
            self.assertEqual(body4["status"], "answered")

        self.run_saturated({"OLLAMA_NUM_PARALLEL": "1", "HUB_QUEUE_WAIT_SECONDS": "0.3"}, body)

    def test_full_queue_gets_the_busy_answer_at_once(self):
        def body(port, callbacks, release):
            t0 = time.monotonic()
            status, resp = post_to(port, {"sender": "c", "question": "q", "wait": True})
            self.assertEqual(status, 503)
            self.assertLess(time.monotonic() - t0, 1.0)
            self.assertEqual(resp["status"], "busy")

        self.run_saturated(
            {"OLLAMA_NUM_PARALLEL": "1", "HUB_QUEUE_WAIT_SECONDS": "30", "HUB_MAX_QUEUED": "0"},
            body,
        )

    def test_queue_wait_counts_against_the_total_deadline(self):
        # U-timeout: the model gets only what is left of HUB_ANSWER_TIMEOUT_SECONDS
        seen = []

        def slow_urlopen(req, timeout=None):
            if req.full_url.endswith("/api/chat"):
                seen.append(timeout)
                time.sleep(0.4)
                return FakeHTTPResponse(
                    json.dumps({"message": {"role": "assistant", "content": "1. ok."}})
                )
            return FakeHTTPResponse("{}")

        env = {"OLLAMA_NUM_PARALLEL": "1", "HUB_ANSWER_TIMEOUT_SECONDS": "2",
               "HUB_QUEUE_WAIT_SECONDS": "1.5"}
        server, thread = start_server(env)
        port = server.server_address[1]
        results = []
        try:
            with mock.patch.dict(os.environ, env), mock.patch(
                "urllib.request.urlopen", slow_urlopen
            ):
                threads = [
                    threading.Thread(target=lambda i=i: results.append(
                        post_to(port, {"sender": "s%d" % i, "question": "q", "wait": True})))
                    for i in range(2)
                ]
                for t in threads:
                    t.start()
                for t in threads:
                    t.join(10)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
        self.assertEqual([r[0] for r in results], [200, 200])
        self.assertEqual(len(seen), 2)
        self.assertLessEqual(max(seen), 2.0)
        self.assertLess(min(seen), 1.7)  # the queued one had less than the full 2 s left


class TestParallelAsks(ResponderTestCase):
    def test_u11_eight_async_asks_ack_fast_and_all_get_their_own_answer(self):
        callbacks = []

        def echo_urlopen(req, timeout=None):
            data = json.loads((req.data or b"{}").decode())
            if req.full_url.endswith("/api/chat"):
                time.sleep(0.3)
                return FakeHTTPResponse(json.dumps(
                    {"message": {"content": "1. Echo %s." % data["messages"][-1]["content"]}}
                ))
            callbacks.append(data)
            return FakeHTTPResponse("{}")

        acks = []

        def ask(i):
            t0 = time.monotonic()
            status, body = self.post_ask({
                "sender": "phone%d" % i, "question": "question-%d" % i,
                "callback_url": "http://127.0.0.1:9/cb",
            })
            acks.append((status, body.get("ack"), time.monotonic() - t0))

        with mock.patch("urllib.request.urlopen", echo_urlopen):
            t0 = time.monotonic()
            threads = [threading.Thread(target=ask, args=(i,)) for i in range(8)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(10)
            self.assertTrue(self.wait_for(lambda: len(callbacks) == 8, 5))
            wall = time.monotonic() - t0
        self.assertEqual(len(acks), 8)
        for status, ack, took in acks:
            self.assertEqual(status, 202)
            self.assertEqual(ack, responder.ACK)
            self.assertLess(took, 0.5)  # the ack never waits on the model or the queue
        for c in callbacks:
            n = c["sender"].replace("phone", "")
            self.assertIn("question-%s." % n, c["answer"])
        self.assertEqual(len({c["sender"] for c in callbacks}), 8)
        self.assertLess(wall, 2.0)  # 8 x 0.3 s serial would be 2.4 s: 4 ran in parallel


class TestModelFailures(ResponderTestCase):
    def both_modes(self, error):
        with mock.patch("urllib.request.urlopen", fake_urlopen_factory(
                model_error=error, callbacks=self.callbacks)):
            status, body = self.post_ask({
                "sender": "a", "question": "q?", "callback_url": "http://127.0.0.1:9/cb"})
            self.assertEqual(status, 202)
            self.assertEqual(body["ack"], responder.ACK)
            self.assertTrue(self.wait_for(lambda: len(self.callbacks) == 1))
            status, sync = self.post_ask({"sender": "a", "question": "q?", "wait": True})
        self.assertEqual(status, 502)
        cb = self.callbacks[0]["payload"]
        self.assertEqual(cb["status"], "error")
        self.assertEqual(sync["status"], "error")
        self.assertEqual(cb["answer"], sync["answer"])
        answer = sync["answer"]
        self.assertTrue(answer.startswith("No answer:"), answer)
        self.assertIn("retry", answer.lower())
        self.assertTrue(answer.endswith(responder.DISCLAIMER), answer)
        return answer, sync

    def test_u04_ollama_down(self):
        answer, sync = self.both_modes(urllib.error.URLError(ConnectionRefusedError()))
        self.assertIn("not reachable", answer)
        # internals stay in the log and the JSON error, not in the mesh answer
        self.assertNotIn("http://", answer)
        self.assertIn("unreachable", sync["error"])

    def test_u05_model_tag_not_pulled_404_and_500(self):
        answer, sync = self.both_modes(
            urllib.error.HTTPError("http://x/api/chat", 404, "model not found", {}, None))
        self.assertIn("not installed", answer)
        self.assertIn("404", sync["error"])
        self.callbacks.clear()
        answer, sync = self.both_modes(
            urllib.error.HTTPError("http://x/api/chat", 500, "boom", {}, None))
        self.assertIn("500", sync["error"])

    def test_u06_bad_model_responses(self):
        for raw in ("not json", "{}", json.dumps({"message": {"content": "  "}})):
            def urlopen(req, timeout=None, raw=raw):
                return FakeHTTPResponse(raw)
            with mock.patch("urllib.request.urlopen", urlopen):
                status, body = self.post_ask({"sender": "a", "question": "q?", "wait": True})
            self.assertEqual(status, 502, raw)
            self.assertTrue(body["answer"].endswith(responder.DISCLAIMER))


class TestAnswerShaping(ResponderTestCase):
    def sync_answer(self, raw, env=None):
        with mock.patch.dict(os.environ, env or {}), mock.patch(
            "urllib.request.urlopen", fake_urlopen_factory(model_reply=raw)
        ):
            status, body = self.post_ask({"sender": "p", "question": "q?", "wait": True})
        self.assertEqual(status, 200)
        return body["answer"]

    def model_part(self, answer):
        self.assertTrue(answer.endswith("\n" + responder.DISCLAIMER), answer)
        return answer[: -len(responder.DISCLAIMER) - 1]

    def test_ack_and_disclaimer_are_byte_exact_from_the_blueprint(self):
        self.assertEqual(responder.ACK, "Received. Working on an answer.")
        self.assertEqual(
            responder.DISCLAIMER,
            "AI answer from an open-weight model on the hub. Not verified emergency advice.",
        )

    def test_u07_truncation_never_ends_on_a_list_marker(self):
        raw = ("1. Move to higher ground now, away from the river\n"
               "2. Call 999 if anyone is trapped\n"
               "3. Do not walk or drive through flood water as six inches can knock "
               "you over and two feet can float a car away so stay out")
        part = self.model_part(self.sync_answer(raw, {"HUB_MAX_ANSWER_CHARS": "150"}))
        self.assertNotRegex(part, r"(?:^|\n)\s*\d+[.)]\s*$")
        self.assertTrue(part.endswith("2. Call 999 if anyone is trapped"), part)

    def test_truncation_units(self):
        t = responder.truncate_at_sentence
        self.assertEqual(t("1. Boil it. 2. Cool it down slowly please", 22), "1. Boil it.")
        # "3." right at the cut is a marker, not a sentence end
        self.assertEqual(t("1. Boil the water.\n2. Cool it.\n3. Drink it slowly", 34),
                         "1. Boil the water.\n2. Cool it.")
        # a decimal point is not a sentence end
        self.assertEqual(t("Add 0.5 litres of water now and stir it well", 6), "Add")
        self.assertEqual(t("short", 100, 100), "short")
        # the byte cut never splits a multi-byte character
        out = t("é" * 50, 100, 25)
        self.assertEqual(out, "é" * 12)

    def test_u08_answer_fits_the_mesh_byte_budget_with_the_disclaimer(self):
        raw = "é " * 650  # 1300 chars, 1950 bytes
        answer = self.sync_answer(raw)
        self.assertLessEqual(len(answer.encode("utf-8")), 1407)
        self.assertTrue(answer.endswith(responder.DISCLAIMER))
        raw = "1. " + "Keep warm and dry. " * 200
        answer = self.sync_answer(raw)
        self.assertLessEqual(len(answer.encode("utf-8")), 1407)
        self.assertTrue(self.model_part(answer).endswith("."))
        small = self.sync_answer(raw, {"HUB_MAX_ANSWER_BYTES": "300"})
        self.assertLessEqual(len(small.encode("utf-8")), 300)
        self.assertTrue(small.endswith(responder.DISCLAIMER))

    def test_num_predict_and_keep_alive_are_sent_and_sized_to_the_cap(self):
        payload = responder.build_chat_payload("q?", None)
        self.assertEqual(payload["options"]["num_ctx"], 8192)
        self.assertEqual(payload["options"]["num_predict"], (780 - 78 - 1) // 3)
        self.assertEqual(payload["keep_alive"], -1)
        self.assertIs(payload["stream"], False)
        with mock.patch.dict(os.environ, {"HUB_MAX_ANSWER_BYTES": "700"}):
            self.assertEqual(
                responder.build_chat_payload("q?", None)["options"]["num_predict"], 207)
        with mock.patch.dict(os.environ, {"HUB_NUM_PREDICT": "99"}):
            self.assertEqual(
                responder.build_chat_payload("q?", None)["options"]["num_predict"], 99)

    def test_u16_disclaimer_mid_text_and_at_end(self):
        raw = "1. Boil it.\n" + responder.DISCLAIMER + "\n2. Then cool it."
        answer = self.sync_answer(raw)
        self.assertEqual(answer, "1. Boil it.\n2. Then cool it.\n" + responder.DISCLAIMER)
        # a model that already ends with the label gets exactly one, as the last line
        answer = self.sync_answer("1. Boil it. " + responder.DISCLAIMER)
        self.assertEqual(answer, "1. Boil it.\n" + responder.DISCLAIMER)

    def test_markdown_is_stripped_to_plain_text(self):
        answer = self.sync_answer("## Steps\n1. **Call 999** now.\n2. Press on the wound.")
        self.assertEqual(
            self.model_part(answer), "Steps\n1. Call 999 now.\n2. Press on the wound.")

    def test_system_prompt_safety_rules(self):
        prompt = responder.build_chat_payload("q?", None)["messages"][0]["content"]
        for needle in ("numbered steps", "most urgent action first", "999",
                       "in danger right now", "Do not add this step when nobody is in danger",
                       "Never suggest drinking untreated water",
                       "The hub has offline maps", "Name only places given in those facts",
                       "no live alerts, news or feeds", "no matching place nearby",
                       "never name other hospitals", "The mesh only reaches people nearby",
                       "(litres, metres, °C)", "no Markdown"):
            self.assertIn(needle, prompt)

    def test_sync_answer_carries_the_ack_for_callers_without_a_callback(self):
        with mock.patch("urllib.request.urlopen", fake_urlopen_factory(model_reply="1. ok.")):
            status, body = self.post_ask({"sender": "p", "question": "q?", "wait": True})
        self.assertEqual(status, 200)
        self.assertEqual(body["ack"], responder.ACK)
        self.assertEqual(body["status"], "answered")


class TestAnswerParts(ResponderTestCase):
    """BitChat drops a private message over 255 UTF-8 bytes, so answers go as "(i/n) " parts."""

    LABEL = "AI answer from an open-weight model on the hub. Not verified emergency advice."

    def ask_sync(self, raw, env=None, reply_extra=None):
        def urlopen(req, timeout=None):
            body = {"message": {"content": raw}}
            body.update(reply_extra or {})
            return FakeHTTPResponse(json.dumps(body))
        with mock.patch.dict(os.environ, env or {}), mock.patch("urllib.request.urlopen", urlopen):
            return self.post_ask({"sender": "p", "question": "q?", "wait": True})

    def check_parts(self, body):
        parts = body["parts"]
        n = len(parts)
        self.assertGreaterEqual(n, 2)
        self.assertLessEqual(n, 5)
        for i, part in enumerate(parts, 1):
            self.assertLessEqual(len(part.encode("utf-8")), 255, part)
            self.assertTrue(part.startswith("(%d/%d) " % (i, n)), part)
            self.assertRegex(part, r"(?s)^\((\d)/(\d)\) (.*)$")  # the phone's parser
        self.assertEqual(parts[-1], "(%d/%d) %s" % (n, n, self.LABEL))  # label last, alone
        self.assertEqual(responder.assemble_parts(parts), body["answer"])
        self.assertTrue(body["answer"].endswith("\n" + self.LABEL))
        self.assertEqual(body["answer"].count(self.LABEL), 1)

    def test_short_answer_matches_the_protocol_vector(self):
        raw = ("1. Let the water settle, then pour the clear part through a cloth.\n"
               "2. Bring it to a rolling boil for at least 1 minute.")
        status, body = self.ask_sync(raw)
        self.assertEqual(status, 200)
        # protocol/vectors.json composeAnswer[0] (PR #17)
        self.assertEqual(body["parts"], ["(1/2) " + raw, "(2/2) " + self.LABEL])
        self.assertEqual(body["answer"], raw + "\n" + self.LABEL)
        self.check_parts(body)

    def test_long_answer_is_split_on_lines_into_parts_of_at_most_255_bytes(self):
        raw = "\n".join("%d. Keep warm, stay dry and check on your neighbours often." % i
                        for i in range(1, 12))
        status, body = self.ask_sync(raw)
        self.assertEqual(status, 200)
        self.check_parts(body)
        self.assertGreaterEqual(len(body["parts"]), 3)
        for part in body["parts"][:-1]:
            self.assertRegex(part.split(") ", 1)[1], r"^\d+\. ")  # each part starts a step

    def test_non_ascii_and_one_long_line(self):
        for raw in ("é " * 650, "水" * 900, "word " * 400, "1. " + "ñandú añade " * 90):
            status, body = self.ask_sync(raw)
            self.assertEqual(status, 200)
            self.check_parts(body)
            self.assertLessEqual(len(body["answer"].encode("utf-8")), 780)

    def test_too_many_lines_are_capped_with_an_ellipsis(self):
        raw = "\n".join("%d. %s" % (i, "x" * 200) for i in range(1, 4))
        status, body = self.ask_sync(raw, {"HUB_MAX_ANSWER_PARTS": "3"})
        self.assertEqual(len(body["parts"]), 3)
        self.assertTrue(body["parts"][1].endswith("…"))
        self.assertEqual(body["parts"][2], "(3/3) " + self.LABEL)
        for part in body["parts"]:
            self.assertLessEqual(len(part.encode("utf-8")), 255)
        self.assertEqual(responder.assemble_parts(body["parts"]), body["answer"])

    def test_split_answer_units(self):
        self.assertEqual(responder.split_answer("a\nb"), ["a\nb"])
        chunks = responder.split_answer("a" * 249 + "\n" + "b" * 10)
        self.assertEqual(chunks, ["a" * 249, "b" * 10])
        chunks = responder.split_answer("é" * 200)  # 400 bytes, no space
        self.assertEqual(chunks, ["é" * 124, "é" * 76])
        self.assertEqual(responder.prefix_bytes("aé", 2), "a")

    def test_callback_body_carries_the_same_parts(self):
        raw = "\n".join("%d. Keep warm and dry tonight, and stay together." % i for i in range(1, 9))
        with mock.patch("urllib.request.urlopen",
                        fake_urlopen_factory(model_reply=raw, callbacks=self.callbacks)):
            status, _ = self.post_ask({"sender": "p", "question": "q?",
                                       "callback_url": "http://127.0.0.1:9/cb"})
            self.assertEqual(status, 202)
            self.assertTrue(self.wait_for(lambda: len(self.callbacks) == 1))
            _, sync = self.post_ask({"sender": "p", "question": "q?", "wait": True})
        cb = self.callbacks[0]["payload"]
        self.assertEqual(cb["parts"], sync["parts"])
        self.assertEqual(cb["answer"], sync["answer"])
        self.check_parts(cb)

    def test_failures_send_the_single_protocol_error_message(self):
        self.assertEqual(responder.HUB_ERROR_TEXT,
                         "The hub could not answer right now. Please try again.")
        err = urllib.error.HTTPError("http://x/api/chat", 404, "nf", {}, None)
        with mock.patch("urllib.request.urlopen",
                        fake_urlopen_factory(model_error=err, callbacks=self.callbacks)):
            status, sync = self.post_ask({"sender": "p", "question": "q?", "wait": True})
            self.post_ask({"sender": "p", "question": "q?",
                           "callback_url": "http://127.0.0.1:9/cb"})
            self.assertTrue(self.wait_for(lambda: len(self.callbacks) == 1))
        self.assertEqual(status, 502)
        self.assertEqual(sync["parts"], [responder.HUB_ERROR_TEXT])
        self.assertEqual(self.callbacks[0]["payload"]["parts"], [responder.HUB_ERROR_TEXT])
        # a model that returns only the label has not answered
        status, body = self.ask_sync(self.LABEL)
        self.assertEqual(status, 502)
        self.assertEqual(body["parts"], [responder.HUB_ERROR_TEXT])

    def test_answer_cut_by_num_predict_drops_the_unfinished_sentence(self):
        raw = "1. Call 999 now.\n2. Press hard on the wound.\n3. Keep the person warm and do not"
        status, body = self.ask_sync(raw, reply_extra={"done_reason": "length"})
        self.assertEqual(status, 200)
        self.assertEqual(body["parts"][0], "(1/2) 1. Call 999 now.\n2. Press hard on the wound.")
        status, body = self.ask_sync(raw, reply_extra={"done_reason": "stop"})
        self.assertIn("do not", body["answer"])

    def test_question_is_cut_to_200_bytes_not_rejected(self):
        with mock.patch("urllib.request.urlopen", fake_urlopen_factory(
                model_reply="1. ok.", ollama_requests=self.ollama_requests)), \
                mock.patch.dict(os.environ, {"HUB_KB": "0"}):
            status, _ = self.post_ask({"sender": "p", "wait": True,
                                       "question": "é" * 150 + "\nloc: 51.50070,-0.12460"})
        self.assertEqual(status, 200)
        user = self.ollama_requests[0]["payload"]["messages"][1]["content"]
        self.assertTrue(user.startswith("é" * 100 + "\n"), user[:120])
        self.assertIn("51.5007", user)


class TestAsyncNeedsCallback(ResponderTestCase):
    def test_u09_async_without_callback_url_is_400(self):
        with mock.patch("urllib.request.urlopen",
                        fake_urlopen_factory(model_reply="x", ollama_requests=self.ollama_requests)):
            status, body = self.post_ask({"sender": "p", "question": "q?"})
            self.assertEqual(status, 400)
            self.assertIn("callback_url", body["error"])
            status, _ = self.post_ask({"sender": "p", "question": "q?", "wait": False})
            self.assertEqual(status, 400)
        self.assertEqual(self.ollama_requests, [])


class TestEgressAndConfig(ResponderTestCase):
    def test_u13a_only_ollama_and_the_callback_are_ever_contacted(self):
        urls = []
        state = {"error": None}

        def recording_urlopen(req, timeout=None):
            urls.append(req.full_url)
            if req.full_url.endswith("/api/chat"):
                if state["error"] is not None:
                    raise state["error"]
                return FakeHTTPResponse(json.dumps({"message": {"content": "1. ok."}}))
            return FakeHTTPResponse("{}")

        cb = "http://127.0.0.1:9/cb"
        with mock.patch.dict(os.environ, {"OLLAMA_HOST": "10.0.0.2:11434"}), mock.patch(
            "urllib.request.urlopen", recording_urlopen
        ):
            for err in (None, urllib.error.URLError(ConnectionRefusedError()),
                        socket.timeout("timed out")):
                state["error"] = err
                before = len(urls)
                self.post_ask({"sender": "a", "question": "q?", "callback_url": cb})
                self.assertTrue(self.wait_for(lambda: len(urls) >= before + 2))
                self.post_ask({"sender": "a", "question": "q?", "wait": True})
        self.assertEqual(set(urls), {"http://10.0.0.2:11434/api/chat", cb})

    def test_default_model_is_the_pulled_fp16_tag_and_is_overridable(self):
        with mock.patch.dict(os.environ):
            os.environ.pop("HUB_MODEL", None)
            self.assertEqual(responder.model_name(), "ministral-3:14b-instruct-2512-fp16")
            os.environ["HUB_MODEL"] = "ministral-3:14b-instruct-2512-q8_0"
            self.assertEqual(responder.build_chat_payload("q", None)["model"],
                             "ministral-3:14b-instruct-2512-q8_0")

    def test_ollama_host_falls_back_to_the_local_link_ip(self):
        with mock.patch.dict(os.environ):
            for k in ("OLLAMA_HOST", "SPARK_LOCAL_LINK_IP", "HUB_BIND"):
                os.environ.pop(k, None)
            self.assertEqual(responder.ollama_base_url(), "http://127.0.0.1:11434")
            self.assertEqual(responder.default_bind(), "127.0.0.1")
            os.environ["SPARK_LOCAL_LINK_IP"] = "10.0.0.2"
            self.assertEqual(responder.ollama_base_url(), "http://10.0.0.2:11434")
            self.assertEqual(responder.default_bind(), "10.0.0.2")
            os.environ["OLLAMA_HOST"] = "127.0.0.1:11435"
            self.assertEqual(responder.ollama_base_url(), "http://127.0.0.1:11435")

    def test_u13b_cloud_tags_and_public_ollama_hosts_are_refused_at_startup(self):
        for env in ({"HUB_MODEL": "ministral-3:14b-cloud"}, {"HUB_MODEL": "gpt-oss:cloud"},
                    {"OLLAMA_HOST": "0.0.0.0:11434"}, {"OLLAMA_HOST": "https://8.8.8.8"}):
            with mock.patch.dict(os.environ, env), self.assertRaises(SystemExit, msg=env):
                responder.validate_numeric_env()
        for env in ({"OLLAMA_HOST": "127.0.0.1:11435"}, {"OLLAMA_HOST": "169.254.10.2:11434"},
                    {"OLLAMA_HOST": "192.168.5.2:11434"}, {"OLLAMA_HOST": "spark.local:11434"}):
            with mock.patch.dict(os.environ, env):
                responder.validate_numeric_env()

    def test_default_timeouts(self):
        with mock.patch.dict(os.environ):
            for k in ("HUB_ANSWER_TIMEOUT_SECONDS", "HUB_QUEUE_WAIT_SECONDS"):
                os.environ.pop(k, None)
            self.assertEqual(responder.answer_timeout(), 100.0)
            self.assertEqual(responder.queue_wait_seconds(), 25.0)
            # worst measured run: 256 tokens at 3.5 tok/s with four in parallel
            worst_run = responder.num_predict() / 3.5
            self.assertLess(responder.queue_wait_seconds() + worst_run,
                            responder.answer_timeout())

    def test_loopback_callbacks_are_accepted_for_ssh_tunnel_testing(self):
        # remote testing: ssh -R 9000:127.0.0.1:9000 puts the tester's
        # listener on the Spark's loopback
        with mock.patch.dict(os.environ):
            os.environ.pop("HUB_CALLBACK_ALLOW_HOSTS", None)
            for url in ("http://127.0.0.1:9000/cb", "http://127.8.9.10:9000/cb",
                        "http://[::1]:9000/cb", "http://localhost:9000/cb"):
                # peer_host is a non-loopback address: loopback is allowed by itself
                self.assertTrue(responder.callback_host_allowed(url, "10.0.0.9"), url)
        for url in ("http://127.0.0.1:9000/cb", "http://[::1]:9000/cb"):
            callbacks = []
            with mock.patch("urllib.request.urlopen",
                            fake_urlopen_factory(model_reply="1. ok.", callbacks=callbacks)):
                status, body = self.post_ask(
                    {"sender": "sim", "question": "q?", "callback_url": url})
                self.assertEqual(status, 202, body)
                self.assertTrue(self.wait_for(lambda: len(callbacks) == 1))
            self.assertEqual(callbacks[0]["url"], url)
            self.assertEqual(callbacks[0]["payload"]["status"], "answered")


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
