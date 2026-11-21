"""Hub-core tests with a fake transport and a fake inference client.

Covers ACK-then-answer ordering, the disclaimer, loc/talk relay, and the B2
fallback path when inference is down (still ACK + labelled fallback + disclaimer).
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import unittest

from hub import protocol
from hub.core import FALLBACK_ANSWER, HubCore
from hub.inference import InferenceError, InferenceTimeoutError
from hub.transport import Message, Transport


class FakeTransport(Transport):
    def __init__(self):
        self.sent = []  # list of (text, meta)
        self.callbacks = []
        self.started = False
        self.closed = False

    def send(self, message, meta=None):
        self.sent.append((message, meta or {}))

    def on_message(self, cb):
        self.callbacks.append(cb)

    def peers(self):
        return ["hub"]

    def start(self):
        self.started = True

    def close(self):
        self.closed = True

    def receive(self, message: Message):
        for cb in list(self.callbacks):
            cb(message)


class FakeInference:
    model = "fake-model"

    def __init__(self, answer="1. Do the thing.\n2. Done.", error=None):
        self.answer = answer
        self.error = error
        self.calls = []

    def complete(self, question, loc=None):
        self.calls.append((question, loc))
        if self.error is not None:
            raise self.error
        return self.answer

    def is_up(self):
        return self.error is None


def make_core(inference, logs=None):
    transport = FakeTransport()
    core = HubCore(transport, inference, log=(logs.append if logs is not None else (lambda line: None)))
    return core, transport


class TestQuestionFlow(unittest.TestCase):
    def test_ack_then_answer_order_and_disclaimer(self):
        core, transport = make_core(FakeInference("1. Boil.\n2. Cool."))
        core.handle(
            Message(
                text=protocol.format_question("How to purify water?", "51.5,-0.12"),
                kind="question",
                ask_id="t1",
            )
        )
        self.assertEqual(len(transport.sent), 2)
        (ack_text, ack_meta), (ans_text, ans_meta) = transport.sent
        # 1. ACK first, exact text
        self.assertEqual(ack_text, protocol.ACK_TEXT)
        self.assertEqual(ack_meta["kind"], "ack")
        self.assertEqual(ack_meta["ask_id"], "t1")
        # 2. answer second, ends with the exact disclaimer line
        self.assertEqual(ans_meta["kind"], "answer")
        self.assertEqual(ans_meta["ask_id"], "t1")
        self.assertEqual(ans_text, "1. Boil.\n2. Cool.\n" + protocol.DISCLAIMER)
        self.assertTrue(protocol.has_disclaimer(ans_text))
        # inference got the plain question + loc, without any disclaimer
        self.assertEqual(core.inference.calls, [("How to purify water?", "51.5,-0.12")])

    def test_question_without_loc(self):
        core, transport = make_core(FakeInference())
        core.handle(Message(text="Water?", kind="question", ask_id="t2"))
        self.assertEqual([m[1]["kind"] for m in transport.sent], ["ack", "answer"])
        self.assertEqual(core.inference.calls, [("Water?", None)])

    def test_start_dispatches_via_transport_callback(self):
        core, transport = make_core(FakeInference())
        core.start()
        try:
            self.assertTrue(transport.started)
            transport.receive(Message(text="Water?", kind="question", ask_id="t3"))
            self.assertTrue(core.wait_idle(timeout=5))
            self.assertEqual([m[1]["kind"] for m in transport.sent], ["ack", "answer"])
        finally:
            core.close()
        self.assertTrue(transport.closed)

    def test_logs_have_timestamps_and_cover_every_step(self):
        logs = []
        core, transport = make_core(FakeInference(), logs=logs)
        core.handle(Message(text="Q?", kind="question", ask_id="t9"))
        text = "\n".join(logs)
        for word in ("question", "ack", "model", "answer"):
            self.assertIn(word, text)
        for line in logs:
            self.assertRegex(line, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} \[")


class TestFallbackWhenInferenceDown(unittest.TestCase):
    """CONTRACT.md B2: no model reachable -> still ACK, labelled fallback, disclaimer."""

    def test_timeout_fallback(self):
        err = InferenceTimeoutError("inference server timed out after 0.5s")
        core, transport = make_core(FakeInference(error=err))
        core.handle(Message(text="Water?", kind="question", ask_id="t4"))
        kinds = [m[1]["kind"] for m in transport.sent]
        self.assertEqual(kinds, ["ack", "error", "answer"])
        self.assertEqual(transport.sent[0][0], protocol.ACK_TEXT)  # ACK still first
        error_data = transport.sent[1]
        self.assertIn("timed out", error_data[1]["error"])
        fallback = transport.sent[2][0]
        self.assertIn("no local model answered", fallback)
        self.assertTrue(protocol.has_disclaimer(fallback))
        self.assertEqual(fallback, protocol.format_answer(FALLBACK_ANSWER))

    def test_connection_refused_fallback(self):
        err = InferenceError("cannot reach inference server at http://127.0.0.1:8080: refused")
        core, transport = make_core(FakeInference(error=err))
        core.handle(Message(text="Water?", kind="question", ask_id="t5"))
        kinds = [m[1]["kind"] for m in transport.sent]
        self.assertEqual(kinds, ["ack", "error", "answer"])
        self.assertTrue(protocol.has_disclaimer(transport.sent[-1][0]))

    def test_fallback_logged_loudly(self):
        logs = []
        core, transport = make_core(FakeInference(error=InferenceError("boom")), logs=logs)
        core.handle(Message(text="Water?", kind="question", ask_id="t6"))
        text = "\n".join(logs)
        self.assertIn("INFERENCE FAILED", text)
        self.assertIn("fallback", text.lower())


class TestLocAndTalkRelay(unittest.TestCase):
    def test_loc_only_message_relayed_without_ack(self):
        core, transport = make_core(FakeInference())
        core.handle(Message(text="loc: 51.50070,-0.12460", kind="loc", peer="phoneA"))
        self.assertEqual(len(transport.sent), 1)
        text, meta = transport.sent[0]
        self.assertEqual(meta["kind"], "loc")
        self.assertEqual(meta["loc"], "51.50070,-0.12460")
        self.assertEqual(text, "loc: 51.50070,-0.12460")
        self.assertEqual(core.inference.calls, [])  # no model run for a location share

    def test_loc_message_with_note(self):
        core, transport = make_core(FakeInference())
        core.handle(Message(text="camp\nloc: 51.5,-0.12", kind="loc", peer="phoneA"))
        text, meta = transport.sent[0]
        self.assertEqual(meta["kind"], "loc")
        self.assertEqual(meta["loc"], "51.5,-0.12")
        self.assertEqual(text, "camp\nloc: 51.5,-0.12")

    def test_bare_loc_line_on_question_channel_is_a_loc_share(self):
        core, transport = make_core(FakeInference())
        core.handle(Message(text="loc: 1,2", kind="question", ask_id="x"))
        self.assertEqual([m[1]["kind"] for m in transport.sent], ["loc"])

    def test_talk_relayed(self):
        core, transport = make_core(FakeInference())
        core.handle(Message(text="hello mesh", kind="talk", peer="phoneB"))
        self.assertEqual(len(transport.sent), 1)
        text, meta = transport.sent[0]
        self.assertEqual((meta["kind"], text), ("talk", "hello mesh"))

    def test_empty_question_ignored(self):
        logs = []
        core, transport = make_core(FakeInference(), logs=logs)
        core.handle(Message(text="   ", kind="question", ask_id="t7"))
        self.assertEqual(transport.sent, [])
        self.assertTrue(any("empty question" in ln for ln in logs))


if __name__ == "__main__":
    unittest.main()
