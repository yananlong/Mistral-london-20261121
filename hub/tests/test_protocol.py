"""Wire-protocol tests: round-trips, ``loc:`` parsing, disclaimer constant."""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import unittest

from hub import protocol


class TestProtocol(unittest.TestCase):
    def test_constants_are_exact(self):
        self.assertEqual(protocol.ACK_TEXT, "Received. Working on an answer.")
        self.assertEqual(
            protocol.DISCLAIMER, "AI answer from an offline model. Not verified emergency advice."
        )

    def test_question_roundtrip_without_loc(self):
        q = "How do I make river water safe to drink?"
        wire = protocol.format_question(q)
        self.assertEqual(wire, q)
        body, loc = protocol.split_loc(wire)
        self.assertEqual((body, loc), (q, None))
        parsed = protocol.parse_message(wire)
        self.assertEqual((parsed.kind, parsed.text, parsed.loc), ("question", q, None))

    def test_question_roundtrip_with_loc(self):
        q = "How do I make river water safe to drink?"
        loc = "51.50070,-0.12460"
        wire = protocol.format_question(q, loc)
        self.assertEqual(wire, q + "\nloc: " + loc)
        body, parsed_loc = protocol.split_loc(wire)
        self.assertEqual((body, parsed_loc), (q, loc))
        parsed = protocol.parse_message(wire)
        self.assertEqual((parsed.kind, parsed.text, parsed.loc), ("question", q, loc))

    def test_question_roundtrip_with_loc_tuple(self):
        wire = protocol.format_question("Q?", (51.5, -0.12))
        self.assertEqual(wire, "Q?\nloc: 51.5,-0.12")
        self.assertEqual(protocol.split_loc(wire), ("Q?", "51.5,-0.12"))

    def test_loc_line_parsing(self):
        self.assertEqual(protocol.parse_loc_line("loc: 51.50070,-0.12460"), (51.5007, -0.1246))
        self.assertEqual(protocol.parse_loc_line("LOC: 0,0"), (0.0, 0.0))
        self.assertEqual(protocol.parse_loc_line("loc: -33.86,151.21"), (-33.86, 151.21))
        # invalid shapes / ranges
        self.assertIsNone(protocol.parse_loc_line("loc:"))
        self.assertIsNone(protocol.parse_loc_line("loc: 91,0"))
        self.assertIsNone(protocol.parse_loc_line("loc: 0,181"))
        self.assertIsNone(protocol.parse_loc_line("loc: 1,2,3"))
        self.assertIsNone(protocol.parse_loc_line("loc: abc,def"))
        self.assertIsNone(protocol.parse_loc_line("hello"))
        self.assertIsNone(protocol.parse_loc_line(""))

    def test_is_loc_only(self):
        self.assertTrue(protocol.is_loc_only("loc: 51.5,-0.12"))
        self.assertFalse(protocol.is_loc_only("hello\nloc: 51.5,-0.12"))
        self.assertFalse(protocol.is_loc_only("hello"))
        self.assertFalse(protocol.is_loc_only(""))

    def test_loc_message_format(self):
        self.assertEqual(protocol.format_loc_message("51.5,-0.12"), "loc: 51.5,-0.12")
        self.assertEqual(
            protocol.format_loc_message("51.5,-0.12", "camp site"), "camp site\nloc: 51.5,-0.12"
        )
        parsed = protocol.parse_message("camp site\nloc: 51.5,-0.12")
        self.assertEqual((parsed.kind, parsed.text, parsed.loc), ("question", "camp site", "51.5,-0.12"))

    def test_format_loc(self):
        self.assertEqual(protocol.format_loc("51.50070,-0.12460"), "51.50070,-0.12460")
        self.assertEqual(protocol.format_loc((51.5, -0.12)), "51.5,-0.12")
        with self.assertRaises(ValueError):
            protocol.format_loc("not-a-loc")
        with self.assertRaises(ValueError):
            protocol.format_loc("91,0")

    def test_format_answer_appends_disclaimer_as_exact_last_line(self):
        ans = "1. Let the water settle.\n2. Boil for 1 minute."
        full = protocol.format_answer(ans)
        self.assertEqual(full, ans + "\n" + protocol.DISCLAIMER)
        self.assertEqual(full.rstrip("\n").splitlines()[-1], protocol.DISCLAIMER)
        self.assertTrue(protocol.has_disclaimer(full))
        self.assertFalse(protocol.has_disclaimer(ans))
        self.assertEqual(protocol.strip_disclaimer(full), ans)

    def test_format_answer_strips_trailing_newlines(self):
        self.assertEqual(protocol.format_answer("answer\n\n\n"), "answer\n" + protocol.DISCLAIMER)

    def test_format_ack(self):
        self.assertEqual(protocol.format_ack(), "Received. Working on an answer.")


if __name__ == "__main__":
    unittest.main()
