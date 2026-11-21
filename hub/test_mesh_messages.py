#!/usr/bin/env python3
"""The hub's mesh messages fit BitChat's 255-byte packet limit and follow protocol/README.md.

Run from this directory: python3 -m unittest
"""

import json
import os
import re
import unittest
from unittest import mock

import responder
from test_responder import ResponderTestCase, fake_urlopen_factory

VECTORS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "protocol", "vectors.json")
PART = re.compile(r"^\((\d)/(\d)\) ", re.DOTALL)
LIMIT = 255
LABEL = responder.DISCLAIMER


def assert_mesh_safe(test, messages):
    test.assertTrue(messages)
    for m in messages:
        test.assertLessEqual(len(m.encode("utf-8")), LIMIT, m)
    if messages == [responder.HUB_ERROR_TEXT]:
        return
    total = len(messages)
    for i, m in enumerate(messages, 1):
        match = PART.match(m)
        test.assertIsNotNone(match, m)
        test.assertEqual((int(match.group(1)), int(match.group(2))), (i, total))
    test.assertEqual(messages[-1], f"({total}/{total}) {LABEL}")


class TestContractVectors(unittest.TestCase):
    def test_matches_every_compose_answer_vector(self):
        with open(VECTORS, encoding="utf-8") as f:
            cases = json.load(f)["composeAnswer"]
        for case in cases:
            expected = case["messages"] or [responder.HUB_ERROR_TEXT]
            self.assertEqual(responder.mesh_messages(case["modelOutput"]), expected)

    def test_long_emoji_answer_stays_under_the_packet_limit(self):
        raw = "\n".join(
            f"{i}. Keep the casualty warm 🧣🔥 and check breathing " + "🚑" * 60 for i in range(1, 30)
        )
        self.assertGreater(len(raw.encode("utf-8")), 3000)
        assert_mesh_safe(self, responder.mesh_messages(raw))


class TestMessagesOverHttp(ResponderTestCase):
    def test_sync_answer_carries_mesh_messages(self):
        reply = "\n".join(f"{i}. Boil the water for one full minute before you drink it." for i in range(1, 12))
        with mock.patch("urllib.request.urlopen", fake_urlopen_factory(model_reply=reply)):
            status, body = self.post_ask({"sender": "phoneA", "question": "Water?", "wait": True})
        self.assertEqual(status, 200)
        self.assertGreater(len(body["messages"]), 2)
        assert_mesh_safe(self, body["messages"])

    def test_callback_carries_mesh_messages(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_reply="1. Press hard on the wound.", callbacks=self.callbacks),
        ):
            self.post_ask({"sender": "phoneA", "question": "Bleeding?", "callback_url": "http://mac.local:9000/cb"})
            self.assertTrue(self.wait_for(lambda: len(self.callbacks) == 1))
        messages = self.callbacks[0]["payload"]["messages"]
        self.assertEqual(messages, ["(1/2) 1. Press hard on the wound.", f"(2/2) {LABEL}"])

    def test_model_failure_sends_the_contract_error_text(self):
        with mock.patch(
            "urllib.request.urlopen",
            fake_urlopen_factory(model_error=TimeoutError("too slow"), callbacks=self.callbacks),
        ):
            status, body = self.post_ask({"sender": "phoneA", "question": "Water?", "wait": True})
            self.post_ask({"sender": "phoneB", "question": "Water?", "callback_url": "http://mac.local:9000/cb"})
            self.assertTrue(self.wait_for(lambda: len(self.callbacks) == 1))
        self.assertEqual(status, 502)
        self.assertEqual(body["messages"], [responder.HUB_ERROR_TEXT])
        self.assertEqual(self.callbacks[0]["payload"]["messages"], [responder.HUB_ERROR_TEXT])


if __name__ == "__main__":
    unittest.main()
