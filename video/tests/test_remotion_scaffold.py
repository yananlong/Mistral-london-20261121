"""Remotion backend scaffold test: scene writing + generated Root/manifest files,
WITHOUT rendering (no node_modules / Chrome needed)."""
import tempfile
import unittest
from pathlib import Path

from video.pipeline.backends.remotion import RemotionBackend
from video.pipeline.config import load_config
from video.pipeline.schemas import ShotSpec


class _Ctx:
    def __init__(self, run_dir, config):
        self.run_dir = Path(run_dir)
        self.config = config


class TestRemotionScaffold(unittest.TestCase):
    def test_scene_and_main_files_generated(self):
        cfg = load_config(overrides={"backends": {"remotion": {"render": False, "preview_mode": "none"}}})
        with tempfile.TemporaryDirectory() as tmp:
            ctx = _Ctx(Path(tmp) / "run1", cfg)
            # prepare_studio needs video/studio/node_modules only for the symlink;
            # fall back gracefully when absent by creating the link target check off
            import video.pipeline.backends.remotion as rem
            orig = rem.STUDIO_ROOT
            try:
                studio_shared = Path(tmp) / "studio_shared"
                (studio_shared / "node_modules").mkdir(parents=True)
                (studio_shared / "package.json").write_text("{}")
                (studio_shared / "tsconfig.json").write_text("{}")
                rem.STUDIO_ROOT = studio_shared
                backend = RemotionBackend({"render": False, "preview_mode": "none"})
                studio = backend.prepare_studio(Path(tmp) / "run1", cfg)
                shot = ShotSpec(id="s01", beat="hook", duration_s=4.0, prompt="p", caption="c")
                code = "export const Scene = () => null;"
                cand = backend.generate(shot, {"name": "gen_a", "model": "m"},
                                        Path(tmp) / "clips", ctx, code=code, prompt="p")
                scene_file = studio / "src" / "scenes" / "s01.gen_a.tsx"
                self.assertTrue(scene_file.exists())
                self.assertIn("Scene", scene_file.read_text())
                self.assertTrue((studio / "src" / "scenes" / "manifest.json").exists())
                cands = (studio / "src" / "gen" / "candidates.tsx").read_text()
                self.assertIn("cand-s01-gen-a", cands)
                self.assertEqual(cand.backend, "remotion")
                self.assertEqual(cand.variant, "gen_a")

                # editor-side main composition from a fake EDL
                from video.pipeline.schemas import ClipCandidate, EDL, EDLEntry
                winner = ClipCandidate(
                    shot_id="s01", variant="gen_a", backend="remotion", model="m",
                    prompt_used="p", file="src/scenes/s01.gen_a.tsx",
                    duration_s=4.0, width=1920, height=1080)
                edl = EDL(entries=[EDLEntry(shot_id="s01", file=winner.file,
                                            duration_s=4.0, caption="c")],
                          total_duration_s=4.0)
                backend.write_main(Path(tmp) / "run1", cfg, [winner], edl)
                main = (studio / "src" / "gen" / "main.tsx").read_text()
                self.assertIn("Series", main)
                self.assertIn("durationInFrames: 120", main)  # 4s * 30fps
                self.assertIn("mainMeta", main)
            finally:
                rem.STUDIO_ROOT = orig


if __name__ == "__main__":
    unittest.main()
