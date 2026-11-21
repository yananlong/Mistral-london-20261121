#!/usr/bin/env python3
"""Cross-language contract test: phone/app protocol strings and loc parsing vs hub/responder.py.

The phone app (phone/app/src/transport/SimulatedTransport.ts) and the hub
(hub/responder.py) must agree on the wire protocol:
  - the ack text (HUB_ACK_TEXT == responder.ACK)
  - the answer label (HUB_ANSWER_LABEL == responder.DISCLAIMER)
  - the loc: line grammar (locLine.ts regex vs responder.LOC_LINE_RE)

This test regex-extracts the constants from the TypeScript sources and asserts
equality, then replays every case in phone/test/golden/ask_cases.json through
the real responder server (stubbed Ollama) the way the Mac BitChat peer would.

Run from the hub directory: python3 -m unittest test_contract_phone -v
"""

import json
import os
import re
import unittest
from unittest import mock

import responder
from test_responder import ResponderTestCase, fake_urlopen_factory

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SIM_TRANSPORT = os.path.join(REPO_ROOT, "phone", "app", "src", "transport", "SimulatedTransport.ts")
LOC_LINE_TS = os.path.join(REPO_ROOT, "phone", "app", "src", "locate", "locLine.ts")
ASK_CASES = os.path.join(REPO_ROOT, "phone", "test", "golden", "ask_cases.json")


def ts_const(source, name):
    m = re.search(name + r"\s*=\s*'((?:[^'\\]|\\.)*)'", source)
    assert m, f"constant {name} not found in TypeScript source"
    return m.group(1).replace("\\'", "'")


class TestProtocolConstants(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(SIM_TRANSPORT, encoding="utf-8") as fh:
            cls.sim = fh.read()
        with open(LOC_LINE_TS, encoding="utf-8") as fh:
            cls.locts = fh.read()

    def test_ack_text_matches(self):
        self.assertEqual(ts_const(self.sim, "HUB_ACK_TEXT"), responder.ACK)

    def test_answer_label_matches(self):
        self.assertEqual(ts_const(self.sim, "HUB_ANSWER_LABEL"), responder.DISCLAIMER)

    def test_loc_line_regex_matches(self):
        """The phone's loc: line grammar must accept exactly what the hub accepts."""
        m = re.search(r"const LOC_LINE_RE_TS = /(.+?)/([a-z]*)", self.locts)
        self.assertIsNotNone(m, "LOC_LINE_RE_TS regex literal not found in locLine.ts")
        ts_pattern, ts_flags = m.group(1), m.group(2)
        py_flags = re.IGNORECASE if "i" in ts_flags else 0
        ts_re = re.compile(ts_pattern, py_flags)
        samples = [
            "loc: 51.50070,-0.12460", "LOC:  51.50 , -0.12 ", "loc:51.5,-0.1",
            "loc: -90,180", "loc: 90.00001,-0.1", "loc: 0x33,0", "loc: 5e1,0",
            "loc: NaN,0", "myloc: 1,2", "loc: 1", "hello",
        ]
        for s in samples:
            self.assertEqual(bool(ts_re.match(s.strip())), bool(responder.LOC_LINE_RE.match(s.strip())),
                             f"loc grammar drift on {s!r}: phone={bool(ts_re.match(s.strip()))} hub={bool(responder.LOC_LINE_RE.match(s.strip()))}")


class TestAskCasesAgainstResponder(ResponderTestCase):
    """Replay every golden Ask case through the real server (stubbed model)."""

    @classmethod
    def setUpClass(cls):
        with open(ASK_CASES, encoding="utf-8") as fh:
            cls.cases = json.load(fh)["cases"]

    def test_cases_file_is_valid(self):
        ids = [c["id"] for c in self.cases]
        self.assertEqual(len(ids), len(set(ids)), "duplicate case ids")
        for c in self.cases:
            self.assertIn("question", c)
            self.assertIn("must_not", c)
            if "expect_http_status" not in c:
                self.assertTrue(c["must_not"], f"case {c['id']} needs at least one must_not")

    def test_wait_true_roundtrip_every_case(self):
        ollama_requests = []
        with mock.patch("urllib.request.urlopen",
                        side_effect=fake_urlopen_factory(
                            model_reply="1. Do the thing.\n" + responder.DISCLAIMER,
                            ollama_requests=ollama_requests)):
            for case in self.cases:
                with self.subTest(case=case["id"]):
                    expected_status = case.get("expect_http_status", 200)
                    status, body = self.post_ask(
                        {"sender": "phone-a", "question": case["question"], "wait": True})
                    self.assertEqual(status, expected_status, body)
                    if expected_status == 200:
                        self.assertTrue(body["answer"].endswith(responder.DISCLAIMER))
                        self.assertLessEqual(
                            len(body["answer"].encode("utf-8")),
                            responder.MAX_BODY_BYTES and 1200 + 1 + len(responder.DISCLAIMER))

    def test_loc_line_stripped_and_passed_as_structured_data(self):
        ollama_requests = []
        case = next(c for c in self.cases if c["id"] == "loc-water")
        with mock.patch("urllib.request.urlopen",
                        side_effect=fake_urlopen_factory(
                            model_reply="answer", ollama_requests=ollama_requests)):
            status, _ = self.post_ask(
                {"sender": "phone-a", "question": case["question"], "wait": True})
            self.assertEqual(status, 200)
            user_msg = ollama_requests[-1]["payload"]["messages"][-1]["content"]
            self.assertNotIn("loc:", user_msg)
            self.assertIn("Asker location (lat, lon): 51.5007, -0.1246", user_msg)

    def test_async_ack_then_callback(self):
        callbacks = []
        with mock.patch("urllib.request.urlopen",
                        side_effect=fake_urlopen_factory(
                            model_reply="the answer", callbacks=callbacks)):
            status, body = self.post_ask(
                {"sender": "phone-a", "question": "How do I make water safe?",
                 "callback_url": "http://mac-peer/cb"})
            self.assertEqual(status, 202)
            self.assertEqual(body["ack"], responder.ACK)
            self.assertTrue(self.wait_for(lambda: len(callbacks) == 1, timeout=5))
            payload = callbacks[0]["payload"]
            self.assertEqual(payload["sender"], "phone-a")
            self.assertTrue(payload["answer"].endswith(responder.DISCLAIMER))


if __name__ == "__main__":
    unittest.main()
