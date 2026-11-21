"""End-to-end smoke test: full orchestration with the stub LLM + stub ffmpeg
backend, into a temp dir. Validates the graph (including the curator retry
loop), the 35-40 s timing on the RENDERED file, the review packet and the
timing log. Runs offline; needs ffmpeg + pydantic only."""
import json
import tempfile
import unittest
from pathlib import Path

from video.pipeline.config import load_config
from video.pipeline.media import probe_video
from video.pipeline.project import project
from video.pipeline.runner import run_pipeline

BRIEF = {
    "title": "smoke test video",
    "target_duration_s": 38.0,
    "duration_min_s": 35.0,
    "duration_max_s": 40.0,
    "features": ["Talk", "Locate", "Ask"],
    "voiceover": False,
}


def _cfg(out_root):
    return load_config(overrides={
        "run": {"out_root": out_root, "auto_approve": True},
        "llm": {"provider": "stub"},
        "video": {"width": 640, "height": 360, "fps": 24},
        "backends": {"stub": {"poster": False}},
        "assemble": {"audio": {"bed": True, "voiceover": False, "provider": "stub"}},
    })


class TestSmokeRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.state = run_pipeline(_cfg(cls.tmp.name), BRIEF, run_id="test")
        cls.run_dir = Path(cls.tmp.name) / "test"

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_status_approved(self):
        self.assertEqual(self.state.status, "approved")

    def test_rendered_duration_in_35_40(self):
        p = probe_video(self.state.final)
        self.assertGreaterEqual(p["duration_s"], 35.0 - 0.05)
        self.assertLessEqual(p["duration_s"], 40.0 + 0.05)

    def test_storyboard_in_range(self):
        sb = self.state.storyboard
        self.assertIsNotNone(sb)
        self.assertGreaterEqual(sb.total_duration_s, 35.0)
        self.assertLessEqual(sb.total_duration_s, 40.0)

    def test_curator_retry_loop_happened(self):
        # stub curator forces one retry on shot 3 at attempt 1
        self.assertGreaterEqual(self.state.attempts.get("curate", 0), 2)
        stages = [t.stage for t in self.state.timings]
        self.assertGreaterEqual(stages.count("generate"), 2)

    def test_all_shots_have_winner(self):
        self.assertEqual(set(self.state.reviews),
                         {s.id for s in self.state.storyboard.shots})
        for sid, r in self.state.reviews.items():
            self.assertIn(r.winner, r.scores)

    def test_candidates_generated_per_variant(self):
        variants = {g["name"] for g in self.state.config["generators"]}
        got = {(c.shot_id, c.variant) for c in self.state.candidates}
        for s in self.state.storyboard.shots:
            for v in variants:
                self.assertIn((s.id, v), got)

    def test_artifacts_written(self):
        for name in ("state.json", "manifest.json", "timing.jsonl", "final.mp4",
                     "captions.srt", "review/REVIEW.md", "review/verdict.json"):
            self.assertTrue((self.run_dir / name).exists(), name)
        timing = [json.loads(l) for l in (self.run_dir / "timing.jsonl").read_text().splitlines()]
        self.assertGreaterEqual(len(timing), 5)

    def test_qa_passed(self):
        self.assertIsNotNone(self.state.qa)
        self.assertTrue(self.state.qa.passed)


class TestProjection(unittest.TestCase):
    def test_project_runs(self):
        cfg = load_config()
        rep = project(cfg, BRIEF)
        self.assertGreater(rep["wall_clock_s"], 0)
        self.assertGreater(rep["estimated_cost_credits"], 0)
        self.assertAlmostEqual(sum(rep["shot_durations_s"]), 38.0, places=2)
        self.assertTrue(any(e["stage"] == "generate" for e in rep["timeline"]))


if __name__ == "__main__":
    unittest.main()
