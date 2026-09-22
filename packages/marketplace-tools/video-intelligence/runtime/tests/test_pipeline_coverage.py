from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services.brain import fallback_plan
from app.services.pipeline import (
    _anonymous_presence_ledger,
    _apply_video_embedding_policy,
    _link_chronological_notes,
    _reconciled_visible_subjects,
    _require_semantic_coverage,
)
from app.db.schemas import VideoIndexingBrief


class SemanticCoverageGateTests(unittest.TestCase):
    def test_anonymous_presence_ledger_keeps_measurement_separate_from_identity(self) -> None:
        ledger = _anonymous_presence_ledger(
            [
                {
                    "timeMs": 1_000,
                    "objects": [
                        {"label": "person", "trackId": 1},
                        {"label": "person", "trackId": 2},
                        {"label": "dog", "trackId": 3},
                    ],
                },
                {
                    "timeMs": 2_000,
                    "objects": [
                        {"label": "person", "trackId": 1},
                        {"label": "dog", "trackId": 3},
                    ],
                },
            ],
            [
                {
                    "trackId": 1,
                    "label": "person",
                    "startMs": 1_000,
                    "endMs": 2_000,
                    "observations": 2,
                    "confidence": 0.9,
                },
                {
                    "trackId": 2,
                    "label": "person",
                    "startMs": 1_000,
                    "endMs": 1_000,
                    "observations": 1,
                    "confidence": 0.8,
                },
            ],
            5.0,
        )

        self.assertEqual(ledger["method"], "object-detection-anonymous-tracking")
        self.assertEqual(ledger["sampleIntervalSecs"], 5.0)
        self.assertEqual(ledger["tracks"][0]["timestampsMs"], [1_000, 2_000])
        person = next(item for item in ledger["labels"] if item["label"] == "person")
        self.assertEqual(person["distinctTrackCount"], 2)
        self.assertEqual(person["maximumSimultaneous"], 2)
        self.assertEqual(person["simultaneousTimestampsMs"], [1_000])

    def test_reconciles_only_frame_grounded_visible_subject_protocol_entries(self) -> None:
        subjects = _reconciled_visible_subjects(
            [
                {
                    "startMs": 1_000,
                    "endMs": 4_000,
                    "text": "Present: Discussed Name — never proof of visibility\n"
                    'Visible subject: {"identity":"Mina","identityBasis":"source-named","startMs":1000,"endMs":2000}',
                },
                {
                    "startMs": 4_000,
                    "endMs": 7_000,
                    "text": 'Visible subject: {"identity":"mina","identityBasis":"source-described","startMs":5000,"endMs":7000}',
                },
            ]
        )

        self.assertEqual([subject["identity"] for subject in subjects], ["Mina"])
        self.assertEqual(subjects[0]["identityBasis"], "source-named")
        self.assertEqual(
            subjects[0]["appearances"],
            [
                {"startMs": 1_000, "endMs": 2_000, "confidence": "direct"},
                {"startMs": 5_000, "endMs": 7_000, "confidence": "direct"},
            ],
        )
        self.assertEqual(subjects[0]["observedDurationMs"], 3_000)

    def test_reconciles_a_named_anchor_with_its_parenthesized_visual_reminder(self) -> None:
        subjects = _reconciled_visible_subjects(
            [
                {
                    "startMs": 0,
                    "endMs": 1_000,
                    "text": 'Visible subject: {"identity":"Mina","identityBasis":"source-named","startMs":0,"endMs":0}',
                },
                {
                    "startMs": 2_000,
                    "endMs": 3_000,
                    "text": 'Visible subject: {"identity":"Mina (person in green)","identityBasis":"source-described","startMs":2000,"endMs":2000}',
                },
            ]
        )

        self.assertEqual([subject["identity"] for subject in subjects], ["Mina"])
        self.assertEqual(subjects[0]["observationCount"], 2)

    def test_semantic_notes_are_ordered_without_fake_context(self) -> None:
        linked = _link_chronological_notes(
            [
                {"startMs": 10_000, "endMs": 20_000, "text": "A second event."},
                {"startMs": 0, "endMs": 10_000, "text": "The opening event.\nDetail."},
            ]
        )

        self.assertEqual(linked[0]["startMs"], 0)
        self.assertEqual(linked[0]["text"], "The opening event.\nDetail.")
        self.assertEqual(linked[1]["text"], "A second event.")

    def test_accepts_complete_and_bounded_partial_coverage(self) -> None:
        _require_semantic_coverage(expected=100, actual=100, provider_error=None)
        _require_semantic_coverage(expected=78, actual=75, provider_error="three batches omitted")

    def test_rejects_an_empty_or_mostly_missing_visual_index(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "semantic vision coverage 0/84"):
            _require_semantic_coverage(
                expected=84,
                actual=0,
                provider_error="provider rate limit exceeded",
            )
        with self.assertRaisesRegex(RuntimeError, "required 80/100"):
            _require_semantic_coverage(expected=100, actual=79, provider_error=None)

    def test_does_not_require_unplanned_semantic_vision(self) -> None:
        _require_semantic_coverage(expected=0, actual=0, provider_error="disabled")

    def test_bounded_verification_contract_requires_semantic_vision(self) -> None:
        brief = VideoIndexingBrief.model_validate(
            {"requireSemanticVision": True, "continuousSequence": True, "maxFrames": 18}
        )
        self.assertTrue(brief.require_semantic_vision)
        self.assertTrue(brief.model_dump(by_alias=True)["requireSemanticVision"])
        self.assertTrue(brief.continuous_sequence)
        self.assertTrue(brief.model_dump(by_alias=True)["continuousSequence"])
        self.assertEqual(brief.max_frames, 18)
        self.assertEqual(brief.model_dump(by_alias=True)["maxFrames"], 18)

    def test_bounded_interactive_contract_survives_worker_validation(self) -> None:
        brief = VideoIndexingBrief.model_validate(
            {"interactive": True, "indexingMode": "fast", "maxFrames": 10}
        )
        self.assertTrue(brief.interactive)
        self.assertTrue(brief.model_dump(by_alias=True)["interactive"])

    def test_full_index_always_builds_configured_retrieval_vectors(self) -> None:
        plan = fallback_plan("balanced", 60, True)
        with patch.dict(
            "os.environ",
            {"LARKUP_VIDEO_EMBEDDING_PROVIDER": "gateway-gemini-embedding-2"},
            clear=True,
        ):
            updated = _apply_video_embedding_policy(plan, {})

        self.assertTrue(updated.use_video_embeddings)

    def test_bounded_inspection_and_disabled_provider_skip_retrieval_vectors(self) -> None:
        plan = fallback_plan("balanced", 60, True)
        self.assertFalse(
            _apply_video_embedding_policy(
                plan,
                {"skipVideoEmbeddings": True},
                "gateway-gemini-embedding-2",
            ).use_video_embeddings
        )
        self.assertFalse(
            _apply_video_embedding_policy(plan, {}, "disabled").use_video_embeddings
        )


if __name__ == "__main__":
    unittest.main()
