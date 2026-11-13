from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from unittest import TestCase
from unittest.mock import patch

import numpy as np

from app.services.frame_store import FrameStore


class FrameStoreTests(TestCase):
    def test_lossless_roundtrip_order_slices_and_concurrent_readers(self) -> None:
        original = np.random.default_rng(31).integers(0, 256, (24, 32, 3), dtype=np.uint8)
        with FrameStore() as store:
            frames = store.save([(700, original), (1_200, original)])
            original_copy = original.copy()
            original[:] = 0
            self.assertEqual([t for t, _ in frames], [700, 1_200])
            self.assertEqual(frames[-1][0], 1_200)
            self.assertFalse(frames[0][1].flags.writeable)
            self.assertEqual(len(frames[:1]), 1)
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: frames[0][1], range(4)))
            for frame in results:
                np.testing.assert_array_equal(frame, original_copy)
            self.assertEqual(store.diagnostics()["frames"], 2)
            self.assertGreater(store.diagnostics()["bytes"], 0)
            directory = store.path
        self.assertFalse(directory.exists())

    def test_failed_jobs_remove_temporary_source_frames(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "job failed"):
            with FrameStore() as store:
                directory = store.path
                store.save([(0, np.zeros((4, 4, 3), dtype=np.uint8))])
                raise RuntimeError("job failed")
        self.assertFalse(directory.exists())

    def test_write_failure_is_explicit_and_cleans_up(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "could not be written"):
            with FrameStore() as store, patch("numpy.save", side_effect=OSError("fixture disk full")):
                directory = store.path
                store.save([(0, np.zeros((4, 4, 3), dtype=np.uint8))])
        self.assertFalse(directory.exists())


class PipelineFrameStoreTests(TestCase):
    def test_finished_clips_are_lazy_for_parallel_consumers_and_cleaned_after_job(self) -> None:
        from pathlib import Path
        from types import SimpleNamespace
        from contextlib import ExitStack
        from app.services.frame_store import StoredFrames
        from app.services.pipeline import Probe, run_pipeline
        from app.services.scene import ClipBounds

        clip_plan = [ClipBounds(f"clip_{i}", i * 10, (i + 1) * 10) for i in range(3)]
        frame = np.full((16, 16, 3), 70, dtype=np.uint8)
        samples = [(t, frame, i + 1, 6) for i, t in enumerate([0, 5_000, 10_000, 15_000, 20_000, 25_000])]
        stores = []
        def make_store():
            store = FrameStore()
            stores.append(store)
            return store

        def describe(clips, *_args):
            self.assertEqual(len(clips), 3)
            for _, _, frames in clips.values():
                self.assertIsInstance(frames, StoredFrames)
                for _, read in frames:
                    np.testing.assert_array_equal(read, frame)
            return [SimpleNamespace(start_ms=start, end_ms=end, text="دليل بصري", confidence=0.9)
                    for start, end, _ in clips.values()]

        target = "app.services.pipeline."
        with ExitStack() as stack:
            stack.enter_context(patch.dict("os.environ", {"LARKUP_VIDEO_VISION_API_KEY": "test-fixture"}))
            stack.enter_context(patch(target + "FrameStore", side_effect=make_store))
            stack.enter_context(patch(target + "probe_video", return_value=Probe(30, 16, 16, 1, False)))
            stack.enter_context(patch(target + "_scout_video", return_value=({}, [], [])))
            stack.enter_context(patch(target + "_iter_frames", return_value=iter(samples)))
            stack.enter_context(patch(target + "SceneDetector.plan_clips", return_value=clip_plan))
            vision = stack.enter_context(patch(target + "SemanticVisionService")).return_value
            vision.last_error = None
            vision.describe_clips.side_effect = describe
            result, _ = run_pipeline(
                Path("fixture.mp4"),
                {"interactive": True, "indexingMode": "fast", "skipVideoEmbeddings": True,
                 "requireSemanticVision": True, "language": "ar"},
                Path("unused"), "cpu", lambda *_args: None, disable_heavy_operators=True,
            )
        self.assertEqual(result["processingDiagnostics"]["frameStore"]["frames"], 6)
        self.assertEqual(result["coverage"]["selectedSemanticClips"], 3)
        self.assertEqual(result["semanticObservations"][0]["text"], "دليل بصري")
        self.assertTrue(all(not store.path.exists() for store in stores))
