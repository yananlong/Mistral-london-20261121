import unittest

from pydantic import ValidationError

from video.pipeline.schemas import (CandidateScore, ShotReview, ShotSpec,
                                    Storyboard)


def _sb(total=38.0, n=6):
    per = round(total / n, 3)
    shots = [ShotSpec(id=f"s{i+1:02d}", beat="b", duration_s=per) for i in range(n)]
    # fix rounding so the sum is exactly total
    shots[-1].duration_s = round(total - per * (n - 1), 3)
    return Storyboard(title="t", shots=shots, duration_min_s=35.0, duration_max_s=40.0)


class TestStoryboard(unittest.TestCase):
    def test_valid(self):
        sb = _sb(38.0)
        self.assertAlmostEqual(sb.total_duration_s, 38.0, places=2)

    def test_out_of_range_rejected(self):
        with self.assertRaises(ValidationError):
            _sb(41.0)
        with self.assertRaises(ValidationError):
            _sb(34.0)

    def test_too_many_shots_rejected(self):
        with self.assertRaises(ValidationError):
            _sb(38.0, n=25)


class TestShotReview(unittest.TestCase):
    def test_winner_must_be_scored(self):
        score = CandidateScore(on_brief=8, motion=8, artifacts=9, consistency=8, legibility=9)
        ShotReview(shot_id="s01", scores={"gen_a": score}, winner="gen_a")
        with self.assertRaises(ValidationError):
            ShotReview(shot_id="s01", scores={"gen_a": score}, winner="gen_b")


if __name__ == "__main__":
    unittest.main()
