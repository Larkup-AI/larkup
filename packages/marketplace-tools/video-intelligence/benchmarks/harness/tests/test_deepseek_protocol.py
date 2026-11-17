import unittest
from harness.answer_contract import structured_answer_options


class StructuredProviderProtocolTest(unittest.TestCase):
    def test_deepseek_uses_supported_json_object_and_bounded_reasoning(self):
        options = structured_answer_options('deepseek', {'options': ['First', 'Second']})
        self.assertEqual(options['response_format'], {'type': 'json_object'})
        self.assertEqual(options['reasoning_effort'], 'none')

    def test_schema_capable_provider_retains_letter_and_null_constraints(self):
        options = structured_answer_options('gateway', {'options': ['First', 'Second']})
        schema = options['response_format']['json_schema']['schema']
        self.assertEqual(schema['properties']['option']['enum'], ['A', 'B', None])
        self.assertEqual(set(schema['required']), {'option', 'explanation', 'evidence'})
        self.assertNotIn('reasoning_effort', options)

    def test_runtime_deepseek_projects_gateway_schema_without_losing_constraints(self):
        from harness.provider_relay import runtime_payload
        original = {'messages': [{'role': 'user', 'content': 'Extract source evidence as JSON.'}],
                    'response_format': {'type': 'json_schema', 'json_schema': {'name': 'evidence',
                        'schema': {'type': 'object', 'required': ['events']}}}}
        projected = runtime_payload(original, {'provider': 'deepseek', 'model': 'reasoner'}, ['text'], 'none')
        self.assertEqual(projected['response_format'], {'type': 'json_object'})
        self.assertIn('events', str(projected['messages']))
        self.assertEqual(original['response_format']['type'], 'json_schema')

    def test_planner_rejects_structural_values_without_crashing(self):
        from harness.answer_contract import parse_investigation_directive
        import json
        for scope, goal in [(['focused'], 'answer'), ('source', ['enumerate']), ({}, 'trace')]:
            self.assertIsNone(parse_investigation_directive(json.dumps({'scope': scope, 'goal': goal})))
        self.assertIsNone(parse_investigation_directive('[]'))
        valid = {'scope': 'temporal', 'goal': 'compare', 'evidence': ['speech']}
        self.assertEqual(parse_investigation_directive(json.dumps(valid)), valid)
