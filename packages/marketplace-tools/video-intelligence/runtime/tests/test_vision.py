from __future__ import annotations

import time
import unittest
from unittest.mock import Mock, patch

import numpy as np

from app.services.vision import (
    MAX_VISION_FRAME_WIDTH,
    ClipCaptionRequest,
    GeminiVisionClient,
    GatewayVisionClient,
    SemanticVisionService,
    _build_prompt,
    _frame_to_url,
    _parse_response,
    _post_with_retry,
    _precision_frames,
    _timeout_for_images,
)


class GatewayResponseParsingTests(unittest.TestCase):
    def test_daily_quota_exhaustion_does_not_wait_or_retry(self) -> None:
        session = Mock()
        response = Mock(status_code=429, text="quotaId: GenerateRequestsPerDayPerProject")
        response.headers = {}
        session.post.return_value = response

        with self.assertRaisesRegex(RuntimeError, "429"):
            _post_with_retry(session, "https://provider.example", {}, {}, attempts=3)

        session.post.assert_called_once()

    def test_frame_upload_payload_downscales_oversized_frames(self) -> None:
        frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
        with patch("app.services.vision.cv2.imencode", return_value=(True, np.asarray([1, 2, 3]))) as encode:
            _frame_to_url(frame, None, "frames")
        encoded_frame = encode.call_args.args[1]
        self.assertEqual(encoded_frame.shape[1], MAX_VISION_FRAME_WIDTH)

    def test_named_person_prompt_requires_identity_grounding(self) -> None:
        prompt = _build_prompt(
            [ClipCaptionRequest("clip_0", 0, 6_000, [])],
            "",
            ["What was the named person wearing?"],
            {"clip_0": "A name is spoken while two people are visible."},
        )
        # An identity must come from the source, and must not migrate between
        # people -- but a source that does name someone should be believed,
        # because refusing to record a shown name is what made notes useless.
        self.assertIn("record the name and record what established it", prompt)
        self.assertIn("not merely because you are being cautious", prompt)
        self.assertIn("Keep an individual's name distinct from a collective one", prompt)
        self.assertIn("never a person's name", prompt)
        self.assertIn("Do not transfer a name, number, or caption from one person", prompt)
        self.assertIn("retroactively identify whoever acted in an earlier wide shot", prompt)
        self.assertIn("Aligned evidence context for this clip", prompt)
        self.assertIn("dominant language of the synchronized speech", prompt)

    def test_prompt_asks_for_meaning_and_layout_without_encoding_a_kind_of_video(self) -> None:
        prompt = _build_prompt(
            [ClipCaptionRequest("clip_0", 0, 6_000, [])],
            "",
            ["Who won?"],
        )
        # The note must say what something is, not that it was on screen.
        self.assertIn("carry the MEANING of what is happening", prompt)
        self.assertIn("Never write a note that only lists what objects are in frame", prompt)
        self.assertIn("say what each is attached to", prompt)
        self.assertIn("Read positions off the pixels", prompt)
        self.assertIn("reading direction never moves", prompt)
        self.assertIn("mark anything you are concluding rather than reading", prompt)
        for domain_word in (
            "sports",
            "broadcast",
            "replay",
            "match",
            "team",
            "score",
            "lecture",
            "meeting",
            "Zamalek",
        ):
            self.assertNotIn(domain_word.lower(), prompt.lower(), domain_word)

    def test_note_detail_scales_with_the_requested_coverage(self) -> None:
        clip = [ClipCaptionRequest("clip_0", 0, 6_000, [])]
        fast = _build_prompt(clip, "", [], depth="fast")
        balanced = _build_prompt(clip, "", [], depth="balanced")
        thorough = _build_prompt(clip, "", [], depth="thorough")

        self.assertIn("one or two sentences per clip", fast)
        self.assertIn("a short paragraph per clip", balanced)
        self.assertIn("a full paragraph per clip", thorough)
        self.assertIn("at most 3 entities", fast)
        self.assertIn("at most 12 entities", thorough)
        # An unrecognized mode must still produce a usable note budget.
        self.assertIn("a short paragraph per clip", _build_prompt(clip, "", [], depth="???"))

    def test_user_hint_directs_the_notes_without_narrowing_them(self) -> None:
        prompt = _build_prompt(
            [ClipCaptionRequest("clip_0", 0, 6_000, [])],
            "the running total and who changes it",
            [],
        )
        self.assertIn("What the person reading these notes cares about", prompt)
        self.assertIn("the running total and who changes it", prompt)
        self.assertIn("without skipping anything else that happens", prompt)

    def test_prompt_separates_source_questions_from_the_analysis_question(self) -> None:
        prompt = _build_prompt(
            [ClipCaptionRequest("clip_0", 0, 6_000, [])],
            "find the final result",
            ["Who won?"],
        )

        self.assertIn("Record every question actually spoken or visibly written", prompt)
        self.assertIn("instructions to you, never sourceQuestions", prompt)
        self.assertIn("Set claimQuestion to the supplied question exactly", prompt)

    def test_notes_reach_the_indexed_text_above_the_claim_protocol(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6_000, [])]
        text, _confidence = _parse_response(
            """{"clips":[{"clipIndex":0,
                "summary":"The visitors take the lead.",
                "entities":[{"name":"A. Rivera","what":"the player who scores",
                             "howIdentified":"caption reading A. RIVERA 9"}],
                "visibleText":[{"text":"HOME 0 - 1 AWAY","means":"the away side now leads"}],
                "events":[{"what":"the displayed total changes from 0-0 to 0-1","basis":"read"},
                          {"what":"the crowd is reacting to the goal","basis":"inferred"}],
                "claimQuestion":"Who scored?","claimVerdict":"direct",
                "claimAnswer":"A. Rivera","claimBindings":[]}]}""",
            batch,
        )["clip_0"]

        self.assertIn("The visitors take the lead.", text)
        self.assertIn("Present: A. Rivera — the player who scores", text)
        self.assertIn("identified by caption reading A. RIVERA 9", text)
        self.assertIn("On screen: 'HOME 0 - 1 AWAY' — the away side now leads", text)
        self.assertIn("Happened: the displayed total changes from 0-0 to 0-1", text)
        self.assertIn("Happened (inferred): the crowd is reacting", text)
        # Retrieval strips the claim envelope, so the notes have to precede it.
        self.assertLess(text.index("Present: A. Rivera"), text.index("Claim question:"))

    def test_source_questions_and_answers_reach_the_indexed_text(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6_000, [])]
        text, _confidence = _parse_response(
            """{"clips":[{"clipIndex":0,"summary":"A quiz round is underway.",
                "sourceQuestions":[
                  {"text":"ما اسم اللاعب؟","answer":"محمد صلاح","basis":"spoken"},
                  {"text":"Which badge is this?","answer":"","basis":"visible"}],
                "visibleText":[{"text":"Which badge is this?","means":"quiz prompt"}],
                "claimQuestion":"List every question","claimVerdict":"partial",
                "claimAnswer":"","claimBindings":[]}]}""",
            batch,
            {"clip_0": "المذيع يسأل: ما اسم اللاعب؟"},
        )["clip_0"]

        self.assertIn("Source question (spoken): ما اسم اللاعب؟", text)
        self.assertIn("Source answer: محمد صلاح", text)
        self.assertIn("Source question (visible): Which badge is this?", text)
        self.assertNotIn("Source answer: \n", text)
        self.assertLess(text.index("Source question (spoken)"), text.index("Claim question:"))

    def test_source_question_must_be_present_in_its_claimed_channel(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6_000, [])]
        text, _confidence = _parse_response(
            """{"clips":[{"clipIndex":0,"summary":"A score changes.",
                "sourceQuestions":[
                  {"text":"What are the updated scores?","answer":"400 and 600","basis":"visible"},
                  {"text":"من فاز؟","answer":"الفريق الثاني","basis":"spoken"}],
                "visibleText":[{"text":"400 | 600","means":"scores"}],
                "claimQuestion":"What are the updated scores?","claimVerdict":"direct",
                "claimAnswer":"400 and 600","claimBindings":[]}]}""",
            batch,
            {"clip_0": "حديث عادي لا يتضمن سؤالا"},
        )["clip_0"]

        self.assertNotIn("Source question", text)
        self.assertIn("Claim question: What are the updated scores?", text)

    def test_a_note_without_the_new_fields_still_parses(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6_000, [])]
        parsed = _parse_response(
            '{"clips":[{"clipIndex":0,"summary":"Something happens.",'
            '"claimQuestion":"Q","claimVerdict":"partial","claimAnswer":"","claimBindings":[]}]}',
            batch,
        )
        self.assertIn("Something happens.", parsed["clip_0"][0])

    def test_precision_frames_span_the_clip_within_the_image_budget(self) -> None:
        frames = [
            (index * 1_000, np.full((100, 200, 3), index, dtype=np.uint8)) for index in range(8)
        ]

        precise = _precision_frames(frames, max_source_frames=4)

        self.assertEqual(len(precise), 4)
        self.assertEqual(precise[0][0], 0)
        self.assertEqual(precise[-1][0], 7_000)
        self.assertEqual([time_ms for time_ms, _ in precise], sorted(time_ms for time_ms, _ in precise))
        # Frames are passed through untouched so the reader sees real pixels.
        self.assertEqual(precise[0][1].shape, (100, 200, 3))

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
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            client = GatewayVisionClient()
            response = Mock(ok=True, status_code=200)
            response.json.return_value = {
                "choices": [{"message": {"content": '{"clips":[{"clipIndex":0,"summary":"ok"}]}'}}]
            }
            clip = ClipCaptionRequest("clip_0", 0, 6_000, [(0, object())])
            with patch.object(client, "_urls_for_clip", return_value=["https://frames.example/0.jpg"]):
                with patch("app.services.vision._post_with_retry", return_value=response) as post:
                    client._describe_batch([clip], "", [])
        self.assertEqual(client.model, "google/gemini-3.6-flash")
        self.assertEqual(client.max_concurrency, 24)
        self.assertEqual(post.call_args.args[3]["reasoning"], {"effort": "minimal"})
        self.assertEqual(post.call_args.args[3]["max_tokens"], 8_192)

    def test_dense_interactive_read_has_enough_output_room_for_valid_json(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            client = GatewayVisionClient()
            response = Mock(ok=True, status_code=200)
            response.json.return_value = {
                "choices": [{"message": {"content": '{"clips":[{"clipIndex":0,"summary":"ok"}]}'}}]
            }
            clip = ClipCaptionRequest(
                "clip_0", 0, 6_000, [(index, object()) for index in range(9)]
            )
            with patch.object(client, "_urls_for_clip", return_value=["https://frames.example/0.jpg"] * 9):
                with patch("app.services.vision._post_with_retry", return_value=response) as post:
                    client.describe_clips([clip], "", [], interactive=True)
        # Current readers spend most of a small budget before emitting content,
        # so a tight ceiling returns unparseable JSON rather than a short answer.
        self.assertEqual(post.call_args.args[3]["max_tokens"], 4_096)

    def test_permanent_gateway_failure_aborts_queued_clip_batches(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "AI_GATEWAY_API_KEY": "test-key",
                "LARKUP_VIDEO_GATEWAY_BATCH_SIZE": "1",
                "LARKUP_VIDEO_GATEWAY_CONCURRENCY": "1",
            },
            clear=True,
        ):
            client = GatewayVisionClient()
            denied = Mock(ok=False, status_code=402, text="insufficient funds")
            clips = [
                ClipCaptionRequest(
                    f"clip_{index}", index * 1_000, index * 1_000 + 500, [(0, object())]
                )
                for index in range(4)
            ]
            with patch.object(
                client, "_urls_for_clip", return_value=["https://frames.example/0.jpg"]
            ):
                with patch(
                    "app.services.vision._post_with_retry", return_value=denied
                ) as post:
                    result = client.describe_clips(clips, "", [])

        self.assertEqual(result, {})
        self.assertEqual(post.call_count, 1)
        self.assertIn("402", client.last_error or "")

    def test_native_gemini_uses_selected_google_key_and_inline_frames(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "LARKUP_VIDEO_VISION_PROVIDER": "google",
                "LARKUP_VIDEO_VISION_API_KEY": "google-key",
                "LARKUP_VIDEO_SEMANTIC_VISION_MODEL": "google/gemini-3.6-flash",
            },
            clear=True,
        ):
            client = GeminiVisionClient()
            response = Mock(ok=True, status_code=200)
            response.json.return_value = {
                "steps": [
                    {
                        "type": "model_output",
                        "content": [
                            {
                                "type": "text",
                                "text": '{"clips":[{"clipIndex":0,"summary":"ok"}]}',
                            }
                        ],
                    }
                ]
            }
            clip = ClipCaptionRequest("clip_0", 0, 6_000, [(0, np.zeros((10, 10, 3), dtype=np.uint8))])
            with patch("app.services.vision._post_with_retry", return_value=response) as post:
                result = client._describe_batch([clip], "", [])
        self.assertEqual(result["clip_0"][0], "ok")
        self.assertTrue(post.call_args.args[1].endswith("/interactions"))
        self.assertEqual(post.call_args.args[2]["x-goog-api-key"], "google-key")
        self.assertEqual(client.max_concurrency, 4)
        self.assertEqual(client.batch_size, 1)
        self.assertEqual(client.max_images_per_request, 8)
        self.assertEqual(client.limiter.limit, 12)
        payload = post.call_args.args[3]
        self.assertEqual(payload["model"], "gemini-3.6-flash")
        self.assertEqual(
            payload["generation_config"]["thinking_level"], "minimal"
        )
        self.assertEqual(payload["response_format"]["schema"]["type"], "object")
        self.assertTrue(any(item["type"] == "image" for item in payload["input"]))
        self.assertEqual(post.call_args.kwargs["attempts"], 3)
        # The deadline is sized to the single frame this batch sends.
        self.assertEqual(post.call_args.kwargs["timeout_secs"], _timeout_for_images(1))

    def test_native_gemini_25_bulk_reader_disables_hidden_thinking(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "LARKUP_VIDEO_VISION_PROVIDER": "google",
                "LARKUP_VIDEO_VISION_API_KEY": "google-key",
                "LARKUP_VIDEO_SEMANTIC_VISION_MODEL": "gemini-2.5-flash",
            },
            clear=True,
        ):
            client = GeminiVisionClient()
            response = Mock(ok=True, status_code=200)
            response.json.return_value = {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": '{"clips":[{"clipIndex":0,"summary":"ok"}]}'
                                }
                            ]
                        }
                    }
                ]
            }
            clip = ClipCaptionRequest(
                "clip_0", 0, 6_000, [(0, np.zeros((10, 10, 3), dtype=np.uint8))]
            )
            with patch("app.services.vision._post_with_retry", return_value=response) as post:
                client._describe_batch([clip], "", [])

        generation_config = post.call_args.args[3]["generationConfig"]
        self.assertEqual(
            generation_config["thinkingConfig"], {"thinkingBudget": 0}
        )
        self.assertEqual(generation_config["temperature"], 0)

    def test_native_gemini_rotates_to_managed_fallback_key_on_quota(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "LARKUP_VIDEO_VISION_PROVIDER": "google",
                "LARKUP_VIDEO_VISION_API_KEY": "primary-key",
                "LARKUP_VIDEO_GOOGLE_FALLBACK_API_KEY": "fallback-key",
            },
            clear=True,
        ):
            client = GeminiVisionClient()
            response = Mock(ok=True, status_code=200)
            response.json.return_value = {
                "steps": [{"type": "model_output", "content": [{"type": "text", "text": '{"clips":[{"clipIndex":0,"summary":"ok"}]}'}]}]
            }
            clip = ClipCaptionRequest(
                "clip_0", 0, 6_000, [(0, np.zeros((10, 10, 3), dtype=np.uint8))]
            )
            with patch(
                "app.services.vision._post_with_retry",
                side_effect=[RuntimeError("gateway returned 429: quota"), response],
            ) as post:
                result = client._describe_batch([clip], "", [])

        self.assertEqual(result["clip_0"][0], "ok")
        self.assertEqual(post.call_count, 2)
        self.assertEqual(post.call_args_list[0].args[2]["x-goog-api-key"], "primary-key")
        self.assertEqual(post.call_args_list[1].args[2]["x-goog-api-key"], "fallback-key")

    def test_request_deadline_grows_with_the_images_in_the_request(self) -> None:
        # A one-frame request must not wait as long as a twenty-frame one, and
        # a large batch must not be cut off before the provider can answer.
        self.assertLess(_timeout_for_images(1), _timeout_for_images(20))
        self.assertGreaterEqual(_timeout_for_images(20), 120)
        self.assertLessEqual(_timeout_for_images(1_000), 240)

    def test_omitted_clips_are_re_requested_concurrently(self) -> None:
        import threading

        active = 0
        peak = 0
        lock = threading.Lock()

        def respond(*_args: object, **_kwargs: object) -> Mock:
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.05)
            with lock:
                active -= 1
            response = Mock(ok=True, status_code=200)
            response.json.return_value = {
                "choices": [{"message": {"content": '{"clips":[{"clipIndex":0,"summary":"ok"}]}'}}]
            }
            return response

        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            client = GatewayVisionClient()
            clips = [
                ClipCaptionRequest(f"clip_{index}", index * 1_000, index * 1_000 + 500, [(0, object())])
                for index in range(4)
            ]
            with patch.object(client, "_urls_for_clip", return_value=["https://frames.example/0.jpg"]):
                with patch("app.services.vision._post_with_retry", side_effect=respond):
                    recovered = client._describe_each(clips, "", [], None, None, None)

        self.assertEqual(len(recovered), 4)
        self.assertGreater(peak, 1, "recovery requests must not run one after another")

    def test_native_gemini_recovers_only_an_omitted_clip(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "LARKUP_VIDEO_VISION_PROVIDER": "google",
                "LARKUP_VIDEO_VISION_API_KEY": "google-key",
            },
            clear=True,
        ):
            client = GeminiVisionClient()
            partial = Mock(ok=True, status_code=200)
            partial.json.return_value = {
                "steps": [{"type": "model_output", "content": [{"type": "text", "text": '{"clips":[{"clipIndex":0,"summary":"first"}]}'}]}]
            }
            recovered = Mock(ok=True, status_code=200)
            recovered.json.return_value = {
                "steps": [{"type": "model_output", "content": [{"type": "text", "text": '{"clips":[{"clipIndex":0,"summary":"second"}]}'}]}]
            }
            clips = [
                ClipCaptionRequest("clip_0", 0, 6_000, [(0, np.zeros((10, 10, 3), dtype=np.uint8))]),
                ClipCaptionRequest("clip_1", 6_000, 12_000, [(6_000, np.zeros((10, 10, 3), dtype=np.uint8))]),
            ]
            with patch("app.services.vision._post_with_retry", side_effect=[partial, recovered]) as post:
                result = client._describe_batch(clips, "", [])

        self.assertEqual(set(result), {"clip_0", "clip_1"})
        self.assertEqual(result["clip_1"][0], "second")
        self.assertEqual(post.call_count, 2)

    def test_splits_dense_clips_before_sending_parallel_gateway_requests(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            client = GatewayVisionClient()
        clips = [
            ClipCaptionRequest(f"clip_{index}", 0, 6_000, [(frame, object()) for frame in range(16)])
            for index in range(3)
        ]
        batches = client._batches_for(clips)
        self.assertEqual([len(batch) for batch in batches], [1, 1, 1])
        self.assertTrue(all(sum(len(clip.frames) for clip in batch) <= client.max_images_per_request for batch in batches))

    def test_partial_parallel_caption_results_preserve_a_coverage_diagnostic(self) -> None:
        with patch.dict(
            "os.environ",
            {"AI_GATEWAY_API_KEY": "test-key", "LARKUP_VIDEO_GATEWAY_BATCH_SIZE": "1"},
            clear=True,
        ):
            client = GatewayVisionClient()
            clips = [
                ClipCaptionRequest("clip_0", 0, 6_000, [(0, object())]),
                ClipCaptionRequest("clip_1", 6_000, 12_000, [(6_000, object())]),
            ]

            def partial_result(batch, *_args, **_kwargs):
                if batch[0].clip_id == "clip_0":
                    return {"clip_0": ("validated scene", 0.58)}
                client.last_error = "one parallel batch failed"
                return {}

            with patch.object(client, "_describe_batch", side_effect=partial_result):
                results = client.describe_clips(clips, "", [])

        self.assertIn("clip_0", results)
        self.assertIn("1/2 clips", client.last_error or "")
        self.assertIn("parallel batch failed", client.last_error or "")

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

    def test_keeps_direct_claim_verdict_separate_from_intermediate_observations(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6000, [])]
        results = _parse_response(
            '{"clips":[{"clipIndex":0,"summary":"A score is visible.",'
            '"claimQuestion":"What is the final result?","claimVerdict":"partial",'
            '"claimAnswer":""}]}',
            batch,
        )
        text, _ = results["clip_0"]
        self.assertIn("Claim question: What is the final result?", text)
        self.assertIn("Claim verdict: partial", text)
        self.assertNotIn("Claim answer:", text)
        self.assertIn("Observed context (not a complete answer)", text)

    def test_partial_claims_are_lower_confidence_direct_components(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6000, [])]
        results = _parse_response(
            '{"clips":[{"clipIndex":0,"summary":"A transition is visible.",'
            '"supportedClaims":["The displayed value changes."],'
            '"claimQuestion":"List every change.","claimVerdict":"partial",'
            '"claimAnswer":""}]}',
            batch,
        )
        text, confidence = results["clip_0"]
        self.assertIn("Direct component: The displayed value changes.", text)
        self.assertLess(confidence, 0.5)

    def test_preserves_generic_direct_claim_bindings_for_corroboration(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6000, [])]
        results = _parse_response(
            '{"clips":[{"clipIndex":0,"summary":"A final metric slide is visible.",'
            '"claimQuestion":"What was the final accuracy?","claimVerdict":"direct",'
            '"claimAnswer":"Model Aurora reached 92%.",'
            '"claimBindings":[{"subject":"Model Aurora","relation":"reached",'
            '"value":"92%"}]}]}',
            batch,
        )
        text, _ = results["clip_0"]
        self.assertIn("Claim answer: Model Aurora reached 92%.", text)
        self.assertIn(
            'Claim bindings: [{"subject":"Model Aurora","relation":"reached","value":"92%"}]',
            text,
        )

    def test_ignores_out_of_range_clip_index(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6000, [])]
        results = _parse_response('{"clips":[{"clipIndex":5,"summary":"stray"}]}', batch)
        self.assertEqual(results, {})

    def test_non_json_response_yields_no_results_rather_than_guessing(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6000, [])]
        results = _parse_response("No final outcome is visibly established.", batch)
        self.assertEqual(results, {})

    def test_keeps_a_valid_json_object_after_gateway_preface(self) -> None:
        batch = [ClipCaptionRequest("clip_0", 0, 6000, [])]
        results = _parse_response(
            'Here is the requested JSON: {"clips":[{"clipIndex":0,"summary":"visible title"}]}',
            batch,
        )
        self.assertEqual(results["clip_0"][0], "visible title")

    def test_gateway_retries_one_invalid_structured_reply_without_schema(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            client = GatewayVisionClient()
            invalid = Mock(ok=True, status_code=200)
            invalid.json.return_value = {"choices": [{"message": {"content": "not json"}}]}
            recovered = Mock(ok=True, status_code=200)
            recovered.json.return_value = {
                "choices": [{"message": {"content": '{"clips":[{"clipIndex":0,"summary":"visible result"}]}'}}]
            }
            clip = ClipCaptionRequest("clip_0", 0, 6_000, [(0, object())])
            with patch.object(client, "_urls_for_clip", return_value=["https://frames.example/0.jpg"]):
                with patch("app.services.vision._post_with_retry", side_effect=[invalid, recovered]) as post:
                    result = client._describe_batch([clip], "", [])
        self.assertEqual(result["clip_0"][0], "visible result")
        self.assertNotIn("response_format", post.call_args_list[1].args[3])

    def test_gateway_recovers_only_an_omitted_clip(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            client = GatewayVisionClient()
            partial = Mock(ok=True, status_code=200)
            partial.json.return_value = {
                "choices": [{"message": {"content": '{"clips":[{"clipIndex":0,"summary":"first"}]}'}}]
            }
            recovered = Mock(ok=True, status_code=200)
            recovered.json.return_value = {
                "choices": [{"message": {"content": '{"clips":[{"clipIndex":0,"summary":"second"}]}'}}]
            }
            clips = [
                ClipCaptionRequest("clip_0", 0, 6_000, [(0, object())]),
                ClipCaptionRequest("clip_1", 6_000, 12_000, [(6_000, object())]),
            ]
            with patch.object(
                client, "_urls_for_clip", side_effect=lambda clip: [f"https://frames.example/{clip.clip_id}.jpg"]
            ):
                with patch("app.services.vision._post_with_retry", side_effect=[partial, recovered]) as post:
                    result = client._describe_batch(clips, "", [])

        self.assertEqual(set(result), {"clip_0", "clip_1"})
        self.assertEqual(result["clip_1"][0], "second")
        self.assertEqual(post.call_count, 2)

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
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
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
        self.assertEqual(
            describe.call_args.args[3],
            {"clip_0": "Synchronized speech: outside inside"},
        )

    def test_passes_high_confidence_time_aligned_ocr_to_the_visual_reader(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            vision = SemanticVisionService(enabled=True, disabled=False)
            with patch.object(vision._client, "describe_clips", return_value={}) as describe:
                vision.describe_clips(
                    {"clip_0": (1_000, 4_000, [(1_000, object())])},
                    brief={},
                    visual_observations=[
                        {"timeMs": 2_000, "ocr": [{"text": "NAME LABEL", "confidence": 0.98}]},
                        {"timeMs": 2_500, "ocr": [{"text": "noise", "confidence": 0.4}]},
                        {"timeMs": 5_000, "ocr": [{"text": "outside", "confidence": 0.99}]},
                    ],
                )
        context = describe.call_args.args[3]["clip_0"]
        self.assertIn("Machine-read visible text", context)
        self.assertIn("2.0s 'NAME LABEL'", context)
        self.assertNotIn("noise", context)
        self.assertNotIn("outside", context)

    def test_passes_known_entities_to_the_visual_reader(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            vision = SemanticVisionService(enabled=True, disabled=False)
            with patch.object(vision._client, "describe_clips", return_value={}) as describe:
                vision.describe_clips(
                    {"clip_0": (0, 6_000, [(0, object())])},
                    brief={"knownEntities": ["A named participant"]},
                )
        self.assertEqual(describe.call_args.args[4], ["A named participant"])

    def test_thorough_verification_uses_reasoning_model_by_default(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            vision = SemanticVisionService(enabled=True, disabled=False)
            with patch.object(vision._client, "describe_clips", return_value={}) as describe:
                vision.describe_clips(
                    {"clip_0": (0, 6_000, [(0, object())])},
                    brief={"indexingMode": "thorough", "interactive": True},
                )
        self.assertTrue(describe.call_args.kwargs["use_reasoning_model"])
        request = describe.call_args.args[0][0]
        self.assertEqual(len(request.frames), 1)

    def test_offline_thorough_indexing_keeps_the_bulk_reader(self) -> None:
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
            vision = SemanticVisionService(enabled=True, disabled=False)
            with patch.object(vision._client, "describe_clips", return_value={}) as describe:
                vision.describe_clips(
                    {"clip_0": (0, 6_000, [(0, object())])},
                    brief={"indexingMode": "thorough"},
                )
        self.assertFalse(describe.call_args.kwargs["use_reasoning_model"])

    def test_thorough_verification_can_opt_out_of_reasoning_model(self) -> None:
        with patch.dict(
            "os.environ",
            {"AI_GATEWAY_API_KEY": "test-key", "LARKUP_VIDEO_USE_REASONING_VISION_MODEL": "false"},
            clear=True,
        ):
            vision = SemanticVisionService(enabled=True, disabled=False)
            with patch.object(vision._client, "describe_clips", return_value={}) as describe:
                vision.describe_clips(
                    {"clip_0": (0, 6_000, [(0, object())])},
                    brief={"indexingMode": "thorough", "interactive": True},
                )
        self.assertFalse(describe.call_args.kwargs["use_reasoning_model"])

    def test_disabled_without_gateway_key_reports_diagnostic_not_silent_failure(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            vision = SemanticVisionService(enabled=True, disabled=False)
            observations = vision.describe_clips(
                {"clip_0": (0, 6000, [(0, object())])}, brief={}
            )
        self.assertEqual(observations, [])
        self.assertIn("vision provider API key", vision.last_error or "")

    def test_produces_one_observation_per_clip_not_a_single_global_cap(self) -> None:
        """Regression test for the original bug: coverage used to be capped at
        one semantic observation for an entire video regardless of length."""
        clips = {f"clip_{i:05d}": (i * 6000, (i + 1) * 6000, [(i * 6000, object())]) for i in range(20)}
        with patch.dict("os.environ", {"AI_GATEWAY_API_KEY": "test-key"}, clear=True):
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
