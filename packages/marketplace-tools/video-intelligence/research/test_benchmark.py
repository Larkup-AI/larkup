from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from benchmark import answer_index, digest, finite_metric, prepare, report, run_case


class BenchmarkTests(unittest.TestCase):
    def test_all_four_public_annotation_shapes_and_source_hashes(self):
        fixtures = [
            ("video-mme", [{"videoID": "source", "questions": [{"question_id": "q", "question": "Which?", "options": ["A. One", "B. Two"], "answer": "B"}]}], None),
            ("longvideobench", [{"id": "q", "video_path": "source.mp4", "question": "Which?", "candidates": ["One", "Two"], "correct_choice": 1}], None),
            ("mlvu", [{"video": "source.mp4", "question": "Which?", "candidates": ["One", "Two"], "answer": "Two"}], None),
            ("egoschema", [{"q_uid": "source", "question": "Which?", **{f"option {i}": str(i) for i in range(5)}}], {"source": 1}),
        ]
        with TemporaryDirectory() as directory:
            media = Path(directory)
            (media / "source.mp4").write_bytes(b"synthetic test media")
            for dataset, rows, labels in fixtures:
                with self.subTest(dataset=dataset):
                    case = prepare(dataset, rows, media, "validation", labels)[0]
                    self.assertEqual(case["answer"], 1)
                    self.assertEqual(case["media"]["sha256"], digest(media / "source.mp4"))

    def test_missing_labels_and_paths_outside_media_root_are_rejected(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            row = {"id": "q", "video_path": "source.mp4", "question": "Q", "candidates": ["a", "b"]}
            with self.assertRaisesRegex(ValueError, "Hidden labels"):
                prepare("longvideobench", [row], root, "test")
            row.update(correct_choice=1, video_path="../outside.mp4")
            with self.assertRaisesRegex(ValueError, "within the media root"):
                prepare("longvideobench", [row], root, "validation")

    def test_adapter_never_receives_labels_or_evaluator_metadata(self):
        case = {"id": "q", "dataset": "synthetic", "split": "test", "task": "mcq",
                "question": "Q", "options": ["One", "Two"], "answer": 1,
                "privateEvaluatorNotes": "golden answer", "media": {"sha256": "test", "path": "fixture"}}
        code = ("import json,sys; d=json.load(sys.stdin); "
                "assert set(d['case']) == {'id','question','options','media'}; "
                "print(json.dumps({'status':'ok','prediction':'B','indexCostUsd':0.02,'queryCostUsd':0.01}))")
        result = run_case(case, [sys.executable, "-c", code], 5, {"cacheMode": "cold"})
        self.assertEqual(result["correct"], 1)
        self.assertAlmostEqual(result["totalCostUsd"], 0.03)
        self.assertIsNone(result["ttfbSeconds"])

    def test_infrastructure_failures_stop_before_scoring(self):
        case = {"id": "q", "question": "Q", "options": ["a", "b"], "media": {}}
        with self.assertRaisesRegex(RuntimeError, "infrastructure failure"):
            run_case(case, [sys.executable, "-c", "print('{\"status\":\"error\"}')"], 5, {})
        with self.assertRaises(subprocess.TimeoutExpired):
            run_case(case, [sys.executable, "-c", "import time; time.sleep(1)"], 0.01, {})

    def test_strict_scoring_never_searches_explanation_for_the_correct_letter(self):
        for value in ["The answer might be B or A", "(A)", True, -1]:
            with self.assertRaises(ValueError):
                answer_index(value, ["One", "Two"])
        self.assertEqual(answer_index("F", list("abcdef")), 5)

    def test_unknown_or_nonfinite_cost_is_never_reported_as_free(self):
        self.assertIsNone(finite_metric({}, "cost"))
        for value in [float("nan"), float("inf"), -1, True]:
            with self.assertRaises(ValueError):
                finite_metric({"cost": value}, "cost")
        with TemporaryDirectory() as directory:
            root = Path(directory)
            report([{"dataset": "synthetic", "split": "test", "task": "mcq",
                     "correct": 1, "wallSeconds": 0.2, "totalCostUsd": None}], root, {})
            self.assertIn("unknown", (root / "blog.md").read_text())
            self.assertEqual({p.name for p in root.iterdir()}, {"blog.md", "results.csv", "data"})


if __name__ == "__main__":
    unittest.main()
