import unittest

from video.pipeline.timing import adjust_to_range, plan_durations, validate_total


class TestPlanDurations(unittest.TestCase):
    def test_sums_exactly(self):
        for total in (35.0, 38.0, 40.0):
            for weights in ([1, 1, 1], [1.0, 1.6, 1.6, 1.6, 2.2, 1.0], [3]):
                ds = plan_durations(total, weights)
                self.assertAlmostEqual(sum(ds), total, places=6)
                self.assertEqual(len(ds), len(weights))
                self.assertTrue(all(d >= 0.5 for d in ds))

    def test_proportions_respected(self):
        ds = plan_durations(38.0, [1.0, 2.0])
        self.assertLess(ds[0], ds[1])

    def test_invalid(self):
        with self.assertRaises(ValueError):
            plan_durations(0, [1])
        with self.assertRaises(ValueError):
            plan_durations(38, [])


class TestValidateTotal(unittest.TestCase):
    def test_edges(self):
        self.assertTrue(validate_total([35.0], 35, 40)[0])
        self.assertTrue(validate_total([40.0], 35, 40)[0])
        self.assertFalse(validate_total([34.9], 35, 40)[0])
        self.assertFalse(validate_total([40.1], 35, 40)[0])


class TestAdjustToRange(unittest.TestCase):
    def test_trims_to_max(self):
        ds = adjust_to_range([10, 10, 10, 10, 10], 35, 40)
        self.assertTrue(validate_total(ds, 35, 40)[0])

    def test_pads_to_min(self):
        ds = adjust_to_range([5, 5, 5], 35, 40)
        self.assertTrue(validate_total(ds, 35, 40)[0])

    def test_noop_when_in_range(self):
        ds = adjust_to_range([6, 6, 6, 6, 6, 8], 35, 40)
        self.assertTrue(validate_total(ds, 35, 40)[0])


if __name__ == "__main__":
    unittest.main()
