import unittest
from harness.answer_contract import final_answer_prompt

class AnswerEvidenceTests(unittest.TestCase):
    def test_paging_does_not_repeat_display_payloads_or_the_same_timeline(self):
        reading = {'atSecs': 17, 'text': 'The dial changes.'}
        evidence = {'pages': [
            {'evidence': [{'id': 'a', 'timeRange': {'startSecs': 17, 'endSecs': 18}, 'payload': {'text': 'north'}}], 'ui': {'displayOnly': 'presentation-blob'}, 'temporalContext': {'readings': [reading]}},
            {'evidence': [{'id': 'b', 'timeRange': {'startSecs': 29, 'endSecs': 30}, 'payload': {'text': 'south'}}], 'temporalContext': {'readings': [reading, {'atSecs': 29, 'text': 'The dial changes back.'}]}},
        ]}
        prompt = final_answer_prompt({'question': 'What changed?', 'options': ['north', 'south']}, evidence)
        self.assertNotIn('presentation-blob', prompt)
        self.assertEqual(prompt.count('The dial changes.'), 1)
        self.assertIn('The dial changes back.', prompt)
        self.assertIn('north', prompt)
        self.assertIn('south', prompt)
        self.assertIn('ui', evidence['pages'][0], 'source input is immutable')

    def test_conflicting_readings_and_repeated_events_at_distinct_times_survive(self):
        evidence = {'pages': [{'temporalContext': {'readings': [
            {'atSecs': 8, 'text': 'open'}, {'atSecs': 8, 'text': 'closed'}, {'atSecs': 31, 'text': 'open'},
        ]}}]}
        prompt = final_answer_prompt({'question': 'What happened?', 'options': ['x', 'y']}, evidence)
        self.assertIn('closed', prompt)
        self.assertEqual(prompt.count('open'), 2)

    def test_quoted_ocr_navigation_survives_missing_spaces_and_line_breaks(self):
        from harness.answer_contract import investigation_source_context
        for label in ['SYSTEMREADY', 'SYSTEM\nREADY', 'ＳＹＳＴＥＭＲＥＡＤＹ']:
            notes = [{'startMs': i * 1000, 'endMs': i * 1000 + 500,
                'text': 'Which color does the sign display after the system changes?'} for i in range(70)]
            notes[45] = {'startMs': 45000, 'endMs': 45500, 'text': 'Banner: ' + label}
            context = investigation_source_context({'semanticObservations': notes},
                'Which color does the sign display after "SYSTEM READY" changes?')
            self.assertTrue(any(item['startSecs'] == 45 for item in context['relevantTimeline']))

    def test_navigation_includes_raw_ocr_and_localizes_quoted_state_pairs(self):
        from harness.answer_contract import investigation_source_context
        raw = {'durationMs': 2500000, 'semanticObservations': [
            {'startMs': 1900000, 'endMs': 1910000, 'text': 'SECOND STATE appears in another section.'}],
            'visualObservations': [
                {'timeMs': 321250, 'ocr': [{'text': 'FIRSTSTATE', 'confidence': .95}]},
                {'timeMs': 326500, 'ocr': [{'text': 'SECOND STATE', 'confidence': .95}]},
            ]}
        context = investigation_source_context(raw, 'What changes from "FIRST STATE" to "SECOND STATE"?')
        self.assertTrue(any('FIRSTSTATE' in r['text'] for r in context['relevantTimeline']))
        window = context['quotedAnchorWindows'][0]
        self.assertLessEqual(window['startSecs'], 321.25)
        self.assertGreaterEqual(window['endSecs'], 326.5)
        self.assertLessEqual(window['endSecs'] - window['startSecs'], 60)
