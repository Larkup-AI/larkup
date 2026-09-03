from __future__ import annotations

import json
import os
import unittest
from unittest.mock import Mock, patch

from app.services.brain import (
    AgentPlanner,
    ExtractionPlan,
    _post_agent_request,
    MODE_BOUNDS,
    _select_synthesis_observations,
    _source_inventory_chunks,
    _source_inventory_prompt,
    _validated_source_inventory,
    _synthesis_prompt,
    _fallback_knowledge_summary,
    _validated_knowledge_summary,
    fallback_plan,
    normalize_mode,
)


class AgentPlannerTests(unittest.TestCase):
    def test_source_inventory_chunks_cover_full_source_without_sampling_transcript(self) -> None:
        transcript = [
            {
                "startMs": index * 60_000,
                "endMs": index * 60_000 + 5_000,
                "text": f"utterance {index}",
            }
            for index in range(31)
        ]
        chunks = _source_inventory_chunks(
            duration_secs=31 * 60,
            transcript=transcript,
            semantic_observations=[],
            overlay_text=[],
        )

        self.assertEqual(len(chunks), 3)
        included = [
            item["text"]
            for chunk in chunks
            for item in chunk["spokenEvidence"]
        ]
        self.assertEqual(included, [item["text"] for item in transcript])

    def test_source_inventory_prompt_is_generic_and_preserves_source_units(self) -> None:
        prompt = _source_inventory_prompt(
            {
                "range": {"startMs": 0, "endMs": 10_000},
                "spokenEvidence": [],
                "visibleEvidence": [],
                "recurringVisibleText": [],
            }
        )
        instructions = prompt.split("\nINPUT:\n", 1)[0].lower()
        self.assertIn("questions actually asked", instructions)
        self.assertIn("slide", instructions)
        for domain_word in ("score", "team", "match", "lecture", "professor"):
            self.assertNotIn(domain_word, instructions)

    def test_source_inventory_validation_clamps_ranges_and_discards_invalid_items(self) -> None:
        items = _validated_source_inventory(
            {
                "items": [
                    {
                        "kind": "question",
                        "channel": "spoken",
                        "text": "What changed?",
                        "answer": "The value changed.",
                        "startMs": -100,
                        "endMs": 99_000,
                    },
                    {
                        "kind": "ordinary-conversation",
                        "channel": "spoken",
                        "text": "noise",
                        "answer": "",
                        "startMs": 1_000,
                        "endMs": 2_000,
                    },
                ]
            },
            10,
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["startMs"], 0)
        self.assertEqual(items[0]["endMs"], 10_000)

    def test_source_inventory_validation_rejects_ungrounded_and_answer_fragments(self) -> None:
        source_chunk = {
            "spokenEvidence": [
                {
                    "startMs": 1_000,
                    "endMs": 4_000,
                    "text": "في أي سنة حدث ذلك ثم قال المشارك الإجابة الصحيحة",
                }
            ],
            "visibleEvidence": [],
        }
        items = _validated_source_inventory(
            {
                "items": [
                    {
                        "kind": "question",
                        "channel": "spoken",
                        "text": "في أي سنة حدث ذلك",
                        "answer": "",
                        "startMs": 1_000,
                        "endMs": 3_000,
                    },
                    {
                        "kind": "question",
                        "channel": "spoken",
                        "text": "قال المشارك الإجابة الصحيحة",
                        "answer": "",
                        "startMs": 2_000,
                        "endMs": 4_000,
                    },
                    {
                        "kind": "question",
                        "channel": "spoken",
                        "text": "Who invented the missing machine?",
                        "answer": "",
                        "startMs": 2_000,
                        "endMs": 4_000,
                    },
                ]
            },
            10,
            source_chunk,
        )

        self.assertEqual([item["text"] for item in items], ["في أي سنة حدث ذلك"])

    @patch.dict(os.environ, {"LARKUP_VIDEO_AGENT_API_KEY": "test-key"}, clear=False)
    def test_source_inventory_maps_time_chunks_concurrently_and_merges_chronologically(self) -> None:
        planner = AgentPlanner()

        def complete(prompt: str, *_args, **_kwargs):
            payload = json.loads(prompt.split("\nINPUT:\n", 1)[1])
            start_ms = payload["range"]["startMs"]
            source_text = payload["spokenEvidence"][0]["text"]
            return (
                {
                    "items": [
                        {
                            "kind": "question",
                            "channel": "spoken",
                            "text": f"{source_text}?",
                            "answer": "",
                            "startMs": start_ms,
                            "endMs": start_ms + 1_000,
                        }
                    ]
                },
                {"promptTokens": 10, "completionTokens": 5},
            )

        with patch.object(planner, "_complete", side_effect=complete) as mocked:
            items = planner.extract_source_inventory(
                duration_secs=31 * 60,
                transcript=[
                    {"startMs": index * 60_000, "endMs": index * 60_000 + 1_000, "text": "x"}
                    for index in range(31)
                ],
                semantic_observations=[],
            )

        self.assertEqual(mocked.call_count, 3)
        self.assertEqual([item["startMs"] for item in items], [0, 900_000, 1_800_000])
        self.assertEqual(planner.diagnostics().requests, 3)
        self.assertEqual(planner.diagnostics().prompt_tokens, 30)

    def test_deterministic_summary_retains_people_states_context_and_story(self) -> None:
        summary = _fallback_knowledge_summary(
            [
                {
                    "startMs": 0,
                    "endMs": 5_000,
                    "text": (
                        "A presenter enters.\n"
                        "Present: Salma — host (identified by title card)\n"
                        "On screen: 'Round 1' — section title\n"
                        'Claim bindings: [{"subject":"counter","relation":"is","value":"1"}]'
                    ),
                },
                {
                    "startMs": 5_000,
                    "endMs": 10_000,
                    "text": "The presenter begins the first section.\nUncertainty: A small label is unreadable.",
                },
            ]
        )

        self.assertIn("opens with", summary["overview"])
        self.assertEqual(summary["participants"][0]["name"], "Salma")
        self.assertEqual(summary["stateHistory"][0]["state"], "counter is 1")
        self.assertEqual(
            [item["text"] for item in summary["narrative"]],
            ["A presenter enters.", "The presenter begins the first section."],
        )
        self.assertIn("Round 1", summary["context"][0]["fact"])
        self.assertEqual(summary["uncertainties"], ["A small label is unreadable."])

    @patch.dict(
        os.environ,
        {
            "LARKUP_VIDEO_AGENT_API_KEY": "test-key",
            "LARKUP_VIDEO_AGENT_PROVIDER": "google",
        },
        clear=False,
    )
    def test_synthesis_does_not_repeat_an_immediate_quota_rejection(self) -> None:
        planner = AgentPlanner()
        with patch.object(
            planner,
            "_complete",
            side_effect=RuntimeError("agent provider returned 429: quota"),
        ) as complete:
            summary = planner.synthesize_knowledge(
                brief={"goal": "index the source"},
                duration_secs=10,
                plan=fallback_plan("balanced", 10, False),
                semantic_observations=[
                    {"startMs": 0, "endMs": 10_000, "text": "A person enters."}
                ],
                transcript=[],
            )

        self.assertEqual(complete.call_count, 1)
        self.assertEqual(summary["keyEvents"][0]["event"], "A person enters.")

    def test_long_source_synthesis_keeps_room_for_complete_participant_and_topic_coverage(self) -> None:
        prompt = _synthesis_prompt(
            brief={"goal": "prepare for complete source questions"},
            duration_secs=10 * 60 * 60,
            plan=fallback_plan("balanced", 10 * 60 * 60, False),
            semantic_observations=[],
            transcript=[],
            overlay_text=[],
        )

        self.assertIn("64 participants", prompt)
        self.assertIn("64 events", prompt)
        self.assertIn("cover the whole supplied span", prompt)

    def test_synthesis_prompt_carries_no_vocabulary_for_one_kind_of_video(self) -> None:
        prompt = _synthesis_prompt(
            brief={"goal": "answer questions about this recording"},
            duration_secs=600,
            plan=fallback_plan("balanced", 600, True),
            semantic_observations=[],
            transcript=[],
            overlay_text=[],
        )

        # Only the instructions are checked; everything after INPUT is the
        # caller's own brief, which may legitimately name anything.
        instructions = prompt.split("\nINPUT:\n", 1)[0].lower()
        for domain_word in ("score", "goal", "team", "match", "replay", "lecture", "genre"):
            self.assertNotIn(domain_word, instructions, domain_word)

    def test_bounded_synthesis_keeps_both_ends_and_the_moments_that_changed(self) -> None:
        observations = [
            {"startMs": index * 1_000, "endMs": index * 1_000 + 500, "text": f"routine {index}"}
            for index in range(100)
        ]

        selected = _select_synthesis_observations(
            observations,
            [{"text": "Section 2", "firstSeenMs": 50_000, "lastSeenMs": 80_000, "observations": 4}],
            10,
        )

        selected_starts = {item["startMs"] for item in selected}
        self.assertLessEqual(len(selected), 10)
        self.assertIn(0, selected_starts)
        self.assertIn(50_000, selected_starts)
        self.assertIn(80_000, selected_starts)
        self.assertIn(99_000, selected_starts)

    @patch("app.services.brain.time.sleep")
    @patch("app.services.brain.requests.post")
    def test_agent_request_retries_a_transient_quota_window(
        self, post: Mock, sleep: Mock
    ) -> None:
        throttled = Mock(
            ok=False,
            status_code=429,
            text='{"error":{"retryDelay":"0.1s"}}',
            headers={},
        )
        completed = Mock(ok=True, status_code=200)
        post.side_effect = [throttled, completed]

        response = _post_agent_request(
            "https://provider.test",
            headers={},
            payload={},
            timeout_seconds=10,
        )

        self.assertIs(response, completed)
        self.assertEqual(post.call_count, 2)
        sleep.assert_called_once_with(0.5)

    def test_only_three_public_modes_are_accepted(self) -> None:
        self.assertEqual(normalize_mode("fast"), "fast")
        self.assertEqual(normalize_mode("balanced"), "balanced")
        self.assertEqual(normalize_mode("thorough"), "thorough")
        self.assertEqual(normalize_mode("deep"), "balanced")
        self.assertEqual(normalize_mode("unknown"), "balanced")

    def test_fallback_is_bounded_and_content_agnostic(self) -> None:
        plan = fallback_plan("balanced", 600, True)
        self.assertEqual(plan.mode, "balanced")
        self.assertTrue(plan.use_transcript)
        self.assertGreater(plan.sample_interval_secs, plan.priority_sample_interval_secs)
        self.assertEqual(plan.priority_ranges, [])

    def test_a_faster_mode_can_never_outwork_a_slower_one(self) -> None:
        # The agent chooses within its mode. If the modes' budgets overlapped,
        # a Fast run could legitimately take longer than a Balanced one, which
        # is exactly what someone picking Fast is choosing against.
        for faster, slower in (("fast", "balanced"), ("balanced", "thorough")):
            for key in ("sample", "priority", "clip"):
                # A larger interval or window means less work.
                self.assertGreaterEqual(
                    MODE_BOUNDS[faster][key][0],
                    MODE_BOUNDS[slower][key][1],
                    f"{faster} {key} may be denser than {slower}",
                )
            self.assertLessEqual(
                MODE_BOUNDS[faster]["frames"][1],
                MODE_BOUNDS[slower]["frames"][0],
                f"{faster} may send more frames per clip than {slower}",
            )

    def test_each_mode_forecasts_less_work_than_the_next(self) -> None:
        estimates = [
            fallback_plan(mode, 900, True).estimated_seconds
            for mode in ("fast", "balanced", "thorough")
        ]
        self.assertEqual(estimates, sorted(estimates), estimates)

    @patch.dict(
        os.environ,
        {
            "LARKUP_VIDEO_AGENT_PROVIDER": "vercel_ai_gateway",
            "LARKUP_VIDEO_AGENT_API_KEY": "test-key",
            "LARKUP_VIDEO_AGENT_MODEL": "openai/gpt-5-mini",
        },
        clear=False,
    )
    @patch("app.services.brain.requests.post")
    def test_validates_model_budgets_and_ranges(self, post: Mock) -> None:
        response = Mock(ok=True)
        response.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "summary": "Use the timestamped source signals.",
                                "extractionFocus": ["named participants", "state history"],
                                "useTranscript": True,
                                "useOcr": True,
                                "useObjectDetection": False,
                                "useSemanticVision": True,
                                "useVideoEmbeddings": False,
                                "useSceneCuts": False,
                                "sampleIntervalSecs": 0.01,
                                "prioritySampleIntervalSecs": 0.01,
                                "clipWindowSecs": 999,
                                "framesPerClip": 999,
                                "estimatedSeconds": 12,
                                "priorityRanges": [
                                    {"startSecs": 15, "endSecs": 30, "reason": "transcript change"},
                                    {"startSecs": 999, "endSecs": 1000, "reason": "outside"},
                                ],
                            }
                        )
                    }
                }
            ],
            "usage": {"prompt_tokens": 20, "completion_tokens": 10},
        }
        post.return_value = response
        planner = AgentPlanner()
        plan = planner.plan(
            brief={"indexingMode": "balanced", "goal": "track what changes"},
            duration_secs=120,
            width=1280,
            height=720,
            fps=30,
            has_audio=True,
            signals={"transcript": [{"startMs": 15_000, "text": "change"}]},
            visual_samples=[
                {"timeMs": 15_000, "dataUrl": "data:image/jpeg;base64,YQ=="}
            ],
        )
        self.assertEqual(plan.sample_interval_secs, MODE_BOUNDS['balanced']['sample'][0])
        self.assertEqual(
            plan.priority_sample_interval_secs, MODE_BOUNDS['balanced']['priority'][0]
        )
        self.assertEqual(plan.clip_window_secs, MODE_BOUNDS['balanced']['clip'][1])
        self.assertEqual(plan.frames_per_clip, MODE_BOUNDS['balanced']['frames'][1])
        self.assertEqual(len(plan.priority_ranges), 1)
        self.assertGreater(plan.estimated_seconds, 12)
        self.assertEqual(planner.diagnostics().prompt_tokens, 20)
        message_content = post.call_args.kwargs["json"]["messages"][0]["content"]
        self.assertTrue(
            any(item.get("type") == "image_url" for item in message_content)
        )
        self.assertEqual(post.call_args.kwargs["json"]["reasoning"], {"effort": "minimal"})

    @patch.dict(os.environ, {"LARKUP_VIDEO_AGENT_API_KEY": ""}, clear=False)
    def test_missing_key_degrades_to_a_safe_plan(self) -> None:
        planner = AgentPlanner()
        plan = planner.plan(
            brief={"indexingMode": "fast"},
            duration_secs=60,
            width=640,
            height=360,
            fps=30,
            has_audio=False,
        )
        self.assertIsInstance(plan, ExtractionPlan)
        self.assertTrue(planner.diagnostics().fallback)

    @patch.dict(
        os.environ,
        {
            "LARKUP_VIDEO_AGENT_PROVIDER": "google",
            "LARKUP_VIDEO_AGENT_API_KEY": "",
            "LARKUP_VIDEO_VISION_PROVIDER": "google",
            "LARKUP_VIDEO_VISION_API_KEY": "shared-direct-key",
            "AI_GATEWAY_API_KEY": "",
        },
        clear=False,
    )
    def test_same_provider_can_reuse_the_local_vision_credential(self) -> None:
        self.assertEqual(AgentPlanner().api_key, "shared-direct-key")

    @patch.dict(
        os.environ,
        {
            "LARKUP_VIDEO_AGENT_PROVIDER": "google",
            "LARKUP_VIDEO_AGENT_API_KEY": "direct-google-key",
            "LARKUP_VIDEO_AGENT_MODEL": "gemini-3.5-flash",
        },
        clear=False,
    )
    @patch("app.services.brain.requests.post")
    def test_google_planner_enforces_its_json_schema(self, post: Mock) -> None:
        response = Mock(ok=True)
        response.json.return_value = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "summary": "Source-grounded plan.",
                                        "extractionFocus": ["state changes"],
                                        "useTranscript": True,
                                        "useOcr": True,
                                        "useObjectDetection": False,
                                        "useSemanticVision": True,
                                        "useVideoEmbeddings": False,
                                        "useSceneCuts": True,
                                        "sampleIntervalSecs": 5,
                                        "prioritySampleIntervalSecs": 1.5,
                                        "clipWindowSecs": 24,
                                        "framesPerClip": 6,
                                        "priorityRanges": [],
                                    }
                                )
                            }
                        ]
                    }
                }
            ],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5},
        }
        post.return_value = response

        plan = AgentPlanner().plan(
            brief={"indexingMode": "balanced"},
            duration_secs=120,
            width=1280,
            height=720,
            fps=30,
            has_audio=True,
        )

        self.assertEqual(plan.summary, "Source-grounded plan.")
        generation_config = post.call_args.kwargs["json"]["generationConfig"]
        self.assertEqual(generation_config["responseMimeType"], "application/json")
        self.assertEqual(
            generation_config["thinkingConfig"], {"thinkingLevel": "minimal"}
        )
        self.assertNotIn("temperature", generation_config)
        self.assertEqual(generation_config["responseSchema"]["type"], "object")
        self.assertIn("summary", generation_config["responseSchema"]["properties"])
        self.assertNotIn("additionalProperties", str(generation_config["responseSchema"]))

    def test_final_summary_requires_and_clamps_timestamped_evidence(self) -> None:
        summary = _validated_knowledge_summary(
            {
                "overview": "Chronological source account.",
                "participants": [
                    {
                        "name": "Supported participant",
                        "role": "speaker",
                        "evidence": [{"startMs": -50, "endMs": 2_000}],
                    },
                    {"name": "Unsupported", "role": "unknown", "evidence": []},
                ],
                "stateHistory": [
                    {
                        "startMs": 8_000,
                        "endMs": 99_000,
                        "state": "A visible value changed.",
                        "confidence": "direct",
                    }
                ],
                "keyEvents": [],
                "narrative": [
                    {
                        "startMs": 9_000,
                        "endMs": 99_000,
                        "text": "The supported account reaches its closing moment.",
                        "confidence": "direct",
                    }
                ],
                "context": [],
                "uncertainties": [],
            },
            10,
        )
        self.assertEqual(len(summary["participants"]), 1)
        self.assertEqual(summary["participants"][0]["evidence"][0]["startMs"], 0)
        self.assertEqual(summary["stateHistory"][0]["endMs"], 10_000)
        self.assertEqual(summary["narrative"][0]["endMs"], 10_000)

    def test_synthesis_requests_source_language_continuous_story_notes(self) -> None:
        prompt = _synthesis_prompt(
            brief={"language": "auto", "detectedLanguage": "ar"},
            duration_secs=60,
            plan=fallback_plan("balanced", 60, True),
            semantic_observations=[
                {"startMs": 0, "endMs": 10_000, "text": "مقدم البرنامج يجلس على اليمين."}
            ],
            transcript=[
                {"startMs": 0, "endMs": 8_000, "text": "أهلا بكم أنا رجب ومعايا أحمد عز"}
            ],
            overlay_text=[],
        )

        self.assertIn('"sourceLanguage":"ar"', prompt)
        self.assertIn("continuous chronological account", prompt)
        self.assertIn("narrative:[{startMs,endMs,text", prompt)

    @patch.dict(os.environ, {"LARKUP_VIDEO_AGENT_API_KEY": "test-key"}, clear=False)
    def test_longitudinal_summary_gets_a_final_consistency_audit(self) -> None:
        draft = {
            "overview": "A changing source.",
            "participants": [],
            "stateHistory": [
                {"startMs": 0, "endMs": 2_000, "state": "Value is zero", "confidence": "direct"},
                {"startMs": 4_000, "endMs": 8_000, "state": "Value is one", "confidence": "direct"},
            ],
            "keyEvents": [
                {"startMs": 3_000, "endMs": 4_000, "event": "Value changes to one", "confidence": "direct"},
                {"startMs": 6_000, "endMs": 7_000, "event": "Replay claims another change", "confidence": "direct"},
            ],
            "context": [],
            "uncertainties": [],
        }
        audit = {
            "overview": "A changing source with one confirmed transition.",
            "stateDecisions": [
                {"index": 0, "keep": True, "replacementState": "Value is zero", "neutralState": "Value zero", "entityMappingSupported": True, "reason": "direct"},
                {"index": 1, "keep": True, "replacementState": "Value is one", "neutralState": "Value one", "entityMappingSupported": True, "reason": "direct"},
            ],
            "eventDecisions": [
                {"index": 0, "keep": True, "reason": "matches the ledger boundary"},
                {"index": 1, "keep": False, "reason": "the state is already established"},
            ],
            "participantDecisions": [],
            "contextDecisions": [],
            "uncertainties": ["One apparent change was not confirmed."],
        }
        planner = AgentPlanner()
        with patch.object(
            planner,
            "_complete",
            side_effect=[(draft, {}), (audit, {})],
        ) as complete:
            summary = planner.synthesize_knowledge(
                brief={"goal": "track changes"},
                duration_secs=10,
                plan=fallback_plan("balanced", 10, False),
                semantic_observations=[
                    {"startMs": 0, "endMs": 2_000, "text": "Value is zero."},
                    {"startMs": 4_000, "endMs": 8_000, "text": "Value is one."},
                ],
                transcript=[],
                overlay_text=[
                    {"text": "Step 2", "firstSeenMs": 4_000, "lastSeenMs": 8_000, "observations": 3}
                ],
            )

        # The audit dropped the second event, so only the confirmed one survives.
        self.assertEqual(len(summary["keyEvents"]), 1)
        self.assertEqual(summary["keyEvents"][0]["startMs"], 3_000)
        self.assertEqual(summary["keyEvents"][0]["event"], "Value changes to one")
        self.assertEqual(summary["overview"], "A changing source with one confirmed transition.")
        self.assertEqual(complete.call_count, 2)
        self.assertIn("recurringOnScreenText", complete.call_args_list[0].args[0])
        self.assertIn('"text":"Step 2"', complete.call_args_list[0].args[0])
        self.assertIn("candidateEvidence", complete.call_args_list[1].args[0])
        self.assertIn("does not identify who performed an earlier action", complete.call_args_list[0].args[0])
        self.assertIn("retroactively identifies the performer", complete.call_args_list[1].args[0])
        self.assertEqual(planner.diagnostics().requests, 2)

    @patch.dict(os.environ, {"LARKUP_VIDEO_AGENT_API_KEY": "test-key"}, clear=False)
    def test_audit_keeps_attribution_only_where_the_evidence_supports_it(self) -> None:
        draft = {
            "overview": "Entity B ends ahead.",
            "participants": [],
            "stateHistory": [
                {"startMs": 0, "endMs": 2_000, "state": "A holds 1", "confidence": "direct"},
                {"startMs": 4_000, "endMs": 6_000, "state": "B holds 2", "confidence": "direct"},
            ],
            "keyEvents": [{"startMs": 4_000, "endMs": 5_000, "event": "B reaches 2", "confidence": "direct"}],
            "context": [{"fact": "Entity A versus Entity C", "evidence": [{"startMs": 0, "endMs": 1_000}]}],
            "uncertainties": [],
        }
        audit = {
            "overview": "A holds 1, and a second value of 2 is visible without an owner.",
            "stateDecisions": [
                # The evidence attaches this value to A, so the attributed wording survives.
                {"index": 0, "keep": True, "replacementState": "A holds 1", "neutralState": "A value of 1 is shown", "entityMappingSupported": True, "reason": "label is adjacent"},
                # The evidence shows the value but not whose it is.
                {"index": 1, "keep": True, "replacementState": "B holds 2", "neutralState": "A value of 2 is shown", "entityMappingSupported": False, "reason": "no label for this value"},
            ],
            "eventDecisions": [{"index": 0, "keep": False, "reason": "attribution is unsupported"}],
            "participantDecisions": [],
            "contextDecisions": [
                {"index": 0, "keep": True, "replacementFact": "Entity A title graphic", "reason": "only A is visible"}
            ],
            "uncertainties": ["The second value has no visible owner."],
        }
        planner = AgentPlanner()
        with patch.object(planner, "_complete", side_effect=[(draft, {}), (audit, {})]):
            summary = planner.synthesize_knowledge(
                brief={"goal": "track labelled values"},
                duration_secs=10,
                plan=fallback_plan("balanced", 10, False),
                semantic_observations=[
                    {"startMs": 0, "endMs": 2_000, "text": "Label A sits beside the value 1."},
                    {"startMs": 4_000, "endMs": 6_000, "text": "A value of 2 is shown, unlabelled."},
                ],
                transcript=[],
                overlay_text=[],
            )

        self.assertEqual(summary["overview"], audit["overview"])
        self.assertEqual(summary["stateHistory"][0]["state"], "A holds 1")
        self.assertEqual(summary["stateHistory"][1]["state"], "A value of 2 is shown")
        self.assertEqual(summary["context"][0]["fact"], "Entity A title graphic")
        self.assertEqual(summary["keyEvents"], [])
        self.assertIn("The second value has no visible owner.", summary["uncertainties"])

    @patch.dict(
        os.environ,
        {
            "LARKUP_VIDEO_AGENT_PROVIDER": "vercel_ai_gateway",
            "LARKUP_VIDEO_AGENT_API_KEY": "test-key",
            "LARKUP_VIDEO_AGENT_MODEL": "openai/gpt-5-mini",
        },
        clear=False,
    )
    @patch("app.services.brain.requests.post")
    def test_synthesis_uses_strict_schema_and_retries_truncated_output(self, post: Mock) -> None:
        truncated = Mock(ok=True)
        truncated.json.return_value = {
            "choices": [{"finish_reason": "length", "message": {"content": '{"overview":'}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 3},
        }
        completed = Mock(ok=True)
        completed.json.return_value = {
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": json.dumps(
                            {
                                "overview": "A supported chronological account.",
                                "participants": [],
                                "stateHistory": [],
                                "keyEvents": [
                                    {
                                        "startMs": 1_000,
                                        "endMs": 2_000,
                                        "event": "A visible change occurs.",
                                        "confidence": "direct",
                                    }
                                ],
                                "context": [],
                                "uncertainties": [],
                            }
                        )
                    },
                }
            ],
            "usage": {"prompt_tokens": 15, "completion_tokens": 10},
        }
        post.side_effect = [truncated, completed]
        planner = AgentPlanner()
        summary = planner.synthesize_knowledge(
            brief={"goal": "index supported changes"},
            duration_secs=10,
            plan=fallback_plan("balanced", 10, False),
            semantic_observations=[
                {"startMs": 1_000, "endMs": 2_000, "text": "A visible change occurs."}
            ],
            transcript=[],
        )
        self.assertEqual(summary["keyEvents"][0]["startMs"], 1_000)
        self.assertEqual(planner.diagnostics().requests, 2)
        self.assertFalse(planner.diagnostics().fallback)
        response_format = post.call_args.kwargs["json"]["response_format"]
        self.assertEqual(response_format["type"], "json_schema")
        self.assertTrue(response_format["json_schema"]["strict"])


if __name__ == "__main__":
    unittest.main()
