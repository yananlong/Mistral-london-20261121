"""Tests for the hub knowledge base (kb.py) against the repo's datasets/.

Run from hub/: PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v
"""

import logging
import os
import tempfile
import unittest
from unittest import mock

import kb
import responder

logging.getLogger("hub.kb").setLevel(logging.CRITICAL)  # expected warnings in tests

DATASETS = kb.default_datasets_dir()
FEEDS = os.path.join(DATASETS, "feeds", "latest")
WESTMINSTER = {"lat": 51.50070, "lon": -0.12460}
HAVE_DATA = os.path.exists(os.path.join(DATASETS, "phone", "pois", "london_pois.sqlite"))


@unittest.skipUnless(HAVE_DATA, "datasets/ not present")
class TestKnowledgeBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.kb = kb.KnowledgeBase(DATASETS)

    def test_q04_nearest_drinking_water_is_the_424m_fountain_to_the_se(self):
        facts = self.kb.poi_facts("Where is the nearest drinking water tap?", WESTMINSTER)
        self.assertEqual(len(facts), 3)
        first = facts[0]
        self.assertIn("n6334504580", first["source"])
        self.assertIn("420 m SE", first["text"])
        self.assertIn("London Drinking Fountain Fund", first["text"])
        rows = self.kb.pois.nearest("water", WESTMINSTER["lat"], WESTMINSTER["lon"])
        self.assertEqual(rows[0]["id"], "n6334504580")
        self.assertAlmostEqual(rows[0]["dist"], 424, delta=5)
        self.assertEqual(rows[0]["bearing"], "SE")
        self.assertLessEqual(rows[0]["dist"], rows[1]["dist"])

    def test_q18_nearest_a_and_e_is_st_thomas(self):
        facts = self.kb.poi_facts("Which way to the nearest hospital with an A&E?", WESTMINSTER)
        self.assertTrue(facts)
        self.assertIn("St Thomas' Hospital", facts[0]["text"])
        self.assertIn("hospital with A&E", facts[0]["text"])
        rows, confirmed = self.kb.pois.nearest_hospitals_ae(WESTMINSTER["lat"], WESTMINSTER["lon"])
        self.assertTrue(confirmed)
        self.assertEqual(rows[0]["name"], "St Thomas' Hospital")
        self.assertAlmostEqual(rows[0]["dist"], 440, delta=15)

    def test_no_loc_means_no_pois(self):
        self.assertEqual(self.kb.poi_facts("Where is the nearest drinking water tap?", None), [])
        facts = self.kb.facts("Where is the nearest drinking water tap?", None)
        self.assertFalse(any("london_pois" in f["source"] for f in facts))

    def test_how_to_question_with_loc_gets_no_pois(self):
        facts = self.kb.facts("How do I make river water safe to drink?", WESTMINSTER)
        self.assertFalse(any("london_pois" in f["source"] for f in facts))
        self.assertTrue(any("water-and-sanitation" in f["source"] for f in facts))

    def test_guide_retrieval_bleach_water(self):
        facts = self.kb.guide_facts("bleach water")
        self.assertTrue(facts)
        top = facts[0]
        self.assertIn("water-and-sanitation-scripts-for-broadcast-media.json", top["source"])
        self.assertIn("quarter of a teaspoon", top["text"])
        self.assertIn("10 litres", top["text"])

    def test_off_topic_question_gets_no_guides(self):
        self.assertEqual(self.kb.guide_facts("Who will win the football tonight?"), [])

    def test_context_budget(self):
        for q in ("How do I make water safe to drink?", "Is the food in my fridge still safe?"):
            block = kb.format_facts(self.kb.facts(q, WESTMINSTER))
            self.assertLess(len(block), kb.MAX_CONTEXT_CHARS + 400)

    def test_food_bank_uses_givefood(self):
        facts = self.kb.poi_facts("Where is the nearest food bank?", WESTMINSTER)
        self.assertTrue(facts)
        self.assertIn("givefood", facts[0]["source"])

    def test_feeds_off_by_default(self):
        self.assertIsNone(self.kb.bulletin)
        facts = self.kb.facts("Are there flood warnings for London right now?", None)
        self.assertFalse(any(f["source"].startswith("feeds/") for f in facts))


class TestKeywordMapping(unittest.TestCase):
    def cat(self, q):
        rule = kb.match_poi_rule(q)
        return rule and rule[0]

    def test_categories(self):
        cases = {
            "Where is the nearest drinking water tap?": "water",
            "Where can I find a water fountain?": "water",
            "Which way to the nearest hospital with an A&E?": "medical",
            "Where is the nearest pharmacy?": "medical",
            "Where can I see a doctor?": "medical",
            "Where is the nearest defibrillator?": "aed",
            "Is there an AED near me?": "aed",
            "Where is the nearest rest centre?": "shelter",
            "Where is a warm space nearby?": "shelter",
            "Where is the nearest food bank?": "food",
            "Where can I find a toilet?": "toilets",
            "Where can I get petrol?": "fuel",
            "Where is the nearest police station?": "emergency_services",
            "Where is the nearest fire station?": "emergency_services",
            "Where can I charge my phone?": "power",
        }
        for q, want in cases.items():
            self.assertEqual(self.cat(q), want, q)

    def test_hospital_prefers_hospital_types(self):
        _, types, _ = kb.match_poi_rule("nearest A&E please")
        self.assertIn("amenity=hospital", types)

    def test_no_place_intent_no_rule(self):
        self.assertIsNone(kb.match_poi_rule("How do I make water safe to drink?"))
        self.assertIsNone(kb.match_poi_rule("Who will win the football tonight?"))

    def test_bearing_and_rounding(self):
        self.assertEqual(kb.bearing_compass(51.5, -0.12, 51.6, -0.12), "N")
        self.assertEqual(kb.bearing_compass(51.5, -0.12, 51.5, -0.02), "E")
        self.assertEqual(kb.round10(424.4), 420)


@unittest.skipUnless(os.path.isdir(FEEDS), "feeds snapshot not present")
class TestBulletin(unittest.TestCase):
    def setUp(self):
        self.b = kb.Bulletin(FEEDS)

    def test_snapshot_labelled_and_matched_only_on_topic(self):
        facts = self.b.facts("Is the Piccadilly line running?")
        self.assertTrue(facts)
        self.assertIn("Recorded snapshot (not live)", facts[0]["text"])
        self.assertIn("UTC", facts[0]["text"])
        self.assertIn("Piccadilly", facts[0]["text"])
        self.assertEqual(self.b.facts("How do I make water safe to drink?"), [])

    def test_floods_none_in_london(self):
        facts = self.b.facts("Are there flood warnings for London right now?")
        self.assertIn("none in London", facts[0]["text"])

    def test_power_cut_by_postcode(self):
        facts = self.b.facts("When will the power come back in Pinner, HA7 2?")
        self.assertIn("INCD-648841-Z", facts[0]["text"])


class TestDegradation(unittest.TestCase):
    def tearDown(self):
        kb.reset_kb()

    def test_missing_dataset_dir_does_not_crash(self):
        with tempfile.TemporaryDirectory() as d:
            missing = os.path.join(d, "nope")
            kb.reset_kb()
            with mock.patch.dict(os.environ, {"HUB_DATASETS_DIR": missing, "HUB_KB": "1"}):
                self.assertIsNone(kb.get_kb())
                self.assertEqual(responder.build_user_content("Where is water?", WESTMINSTER),
                                 "Where is water?\n\nAsker location (lat, lon): 51.5007, -0.1246")
            kb.reset_kb()
            with mock.patch.dict(os.environ, {"HUB_DATASETS_DIR": d, "HUB_KB": "1"}):
                self.assertIsNone(kb.get_kb())  # empty dir: nothing loads, no crash

    @unittest.skipUnless(HAVE_DATA, "datasets/ not present")
    def test_concurrent_first_calls_all_get_the_kb(self):
        import threading
        kb.reset_kb()
        got = []
        with mock.patch.dict(os.environ, {"HUB_DATASETS_DIR": DATASETS, "HUB_KB": "1"}):
            ts = [threading.Thread(target=lambda: got.append(kb.get_kb())) for _ in range(4)]
            for t in ts:
                t.start()
            for t in ts:
                t.join()
        self.assertEqual(len(got), 4)
        self.assertTrue(all(g is not None and g is got[0] for g in got))

    def test_hub_kb_0_disables(self):
        kb.reset_kb()
        with mock.patch.dict(os.environ, {"HUB_KB": "0"}):
            self.assertIsNone(kb.get_kb())

    @unittest.skipUnless(HAVE_DATA, "datasets/ not present")
    def test_user_content_carries_numbered_facts(self):
        kb.reset_kb()
        env = {"HUB_DATASETS_DIR": DATASETS, "HUB_KB": "1"}
        with mock.patch.dict(os.environ, env):
            os.environ.pop("HUB_FEEDS_DIR", None)
            content = responder.build_user_content("Where is the nearest drinking water tap?",
                                                   WESTMINSTER)
        self.assertTrue(content.startswith("Where is the nearest drinking water tap?"))
        self.assertIn("Facts from the hub's offline datasets", content)
        self.assertIn("\n1. Nearest drinking water", content)
        self.assertIn("Source:", content)
        self.assertNotIn("loc:", content)


if __name__ == "__main__":
    unittest.main()
