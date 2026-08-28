from __future__ import annotations

import unittest
from unittest.mock import Mock, patch

from app.services.vision import (
    ClipCaptionRequest,
    GatewayVisionClient,
    SemanticVisionService,
    _build_prompt,
    _parse_response,
)


class GatewayResponseParsingTests(unittest.TestCase):
    def test_named_person_prompt_requires_identity_grounding(self) -> None:
        prompt = _build_prompt(
            [ClipCaptionRequest("clip_0", 0, 6_000, [])],
            "",
            ["What was the named person wearing?"],
            {"clip_0": "A name is spoken while two people are visible."},
        )
        self.assertIn("bare mention alone is not enough", prompt)
        self.assertIn("Spoken context for this clip", prompt)

    def test_named_entities_are_explicitly_sent_to_the_visual_reader(self) -> None:
        prompt = _build_prompt(
            [ClipCaptionRequest("clip_0", 0, 6_000, [])],
            "identify the requested person",
            ["What was this person wearing?"],
            known_entities=["A named participant"],
        )
        self.assertIn("Named people or entities that require visual grounding", prompt)
        self.assertIn("A named participant", prompt)

    def test_bulk_gateway_uses_minimal_reasoning_to_preserve_answer_latency(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_APIKEY": "test-key"}, clear=True):
            client = GatewayVisionClient()
            response = Mock(ok=True, status_code=200)
            response.json.return_value = {
                "choices": [{"message": {"content": '{"clips":[{"clipIndex":0,"summary":"ok"}]}'}}]
            }
            clip = ClipCaptionRequest("clip_0", 0, 6_000, [(0, object())])
            with patch.object(client, "_urls_for_clip", return_value=["https://frames.example/0.jpg"]):
                with patch("app.services.vision._post_with_retry", return_value=response) as post:
                    client._describe_batch([clip], "", [])
        self.assertEqual(client.model, "google/gemini-3-flash")
        self.assertEqual(post.call_args.args[3]["reasoning"], {"effort": "minimal"})
        self.assertEqual(post.call_args.args[3]["max_tokens"], 2_560)

    def test_keeps_structured_claims_and_uncertainty_as_retrievable_text(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6000, [])]
        results = _parse_response(
            '{"clips":[{"clipIndex":0,"summary":"The screen shows a final announcement.",'
            '"supportedClaims":["A result is displayed."],'
            '"uncertainty":"The winner name is not legible."}]}',
            batch,
        )
        text, confidence = results["clip_0"]
        self.assertIn("The screen shows a final announcement.", text)
        self.assertIn("A result is displayed.", text)
        self.assertIn("winner name is not legible", text)
        self.assertGreater(confidence, 0)

    def test_ignores_out_of_range_clip_index(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6000, [])]
        results = _parse_response('{"clips":[{"clipIndex":5,"summary":"stray"}]}', batch)
        self.assertEqual(results, {})

    def test_non_json_response_yields_no_results_rather_than_guessing(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6000, [])]
        results = _parse_response("No final outcome is visibly established.", batch)
        self.assertEqual(results, {})

    def test_maps_multiple_clip_indices_back_to_their_ids(self) -> None:
        batch = [
            ClipCaptionRequest("clip_0", 0, 6000, []),
            ClipCaptionRequest("clip_1", 6000, 12000, []),
        ]
        results = _parse_response(
            '{"clips":[{"clipIndex":1,"summary":"second clip event"},'
            '{"clipIndex":0,"summary":"first clip event"}]}',
            batch,
        )
        self.assertEqual(results["clip_0"][0], "first clip event")
        self.assertEqual(results["clip_1"][0], "second clip event")


class SemanticVisionServiceCoverageTests(unittest.TestCase):
    def test_passes_time_aligned_speech_to_the_visual_reader(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_APIKEY": "test-key"}, clear=True):
            vision = SemanticVisionService(enabled=True, disabled=False)
            with patch.object(vision._client, "describe_clips", return_value={}) as describe:
                vision.describe_clips(
                    {"clip_0": (1_000, 4_000, [(1_000, object())])},
                    brief={},
                    transcript=[
                        {"startMs": 500, "endMs": 1_500, "text": "outside"},
                        {"startMs": 2_000, "endMs": 3_000, "text": "inside"},
                        {"startMs": 5_000, "endMs": 6_000, "text": "after"},
                    ],
                )
        self.assertEqual(describe.call_args.args[3], {"clip_0": "outside inside"})

    def test_passes_known_entities_to_the_visual_reader(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_APIKEY": "test-key"}, clear=True):
            vision = SemanticVisionService(enabled=True, disabled=False)
            with patch.object(vision._client, "describe_clips", return_value={}) as describe:
                vision.describe_clips(
                    {"clip_0": (0, 6_000, [(0, object())])},
                    brief={"knownEntities": ["A named participant"]},
                )
        self.assertEqual(describe.call_args.args[4], ["A named participant"])

    def test_disabled_without_gateway_key_reports_diagnostic_not_silent_failure(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            vision = SemanticVisionService(enabled=True, disabled=False)
            observations = vision.describe_clips(
                {"clip_0": (0, 6000, [(0, object())])}, brief={}
            )
        self.assertEqual(observations, [])
        self.assertIn("AI_GATEWAY_APIKEY", vision.last_error or "")

    def test_produces_one_observation_per_clip_not_a_single_global_cap(self) -> None:
        """Regression test for the original bug: coverage used to be capped at
        one semantic observation for an entire video regardless of length."""
        clips = {f"clip_{i:05d}": (i * 6000, (i + 1) * 6000, [(i * 6000, object())]) for i in range(20)}
        with patch.dict("os.environ", {"AI_GATEWAY_APIKEY": "test-key"}, clear=True):
            vision = SemanticVisionService(enabled=True, disabled=False)
            fake_captions = {clip_id: (f"event in {clip_id}", 0.6) for clip_id in clips}
            with patch.object(vision._client, "describe_clips", return_value=fake_captions):
                observations = vision.describe_clips(clips, brief={})
        self.assertEqual(len(observations), 20)
        covered_ms = sorted((observation.start_ms, observation.end_ms) for observation in observations)
        self.assertEqual(covered_ms[0][0], 0)
        self.assertEqual(covered_ms[-1][1], 120_000)


if __name__ == "__main__":
    unittest.main()
