import asyncio
import json
import unittest

from harness.adapters import Gemini, TwelveLabs, answer_result, extracted_answer
from harness.transport import Response


class Context:
    def __init__(self, provider):
        self.route = {'provider': provider, 'model': 'pegasus1.5' if provider == 'twelvelabs' else 'gemini-3.8-flash', 'secretAlias': 'alias'}
        self.variant = {'maxOutputTokens': 512, 'temperature': 0, 'inputProtocol': {'api': 'interactions'}}
        self.source = {'durationMs': 8000}
        self.attempt = {'id': 'attempt-fixture'}
        self.resume = None
        self.calls, self.handles = [], []

    async def call(self, method, suffix, **kwargs):
        self.calls.append((method, suffix, kwargs))
        return Response(202, {}, json.dumps({'task_id' if self.route['provider'] == 'twelvelabs' else 'id': 'remote-fixture'}).encode(), 1)

    def handle(self, value):
        self.handles.append(value)

    async def poll(self, suffix, field, done, failed, **kwargs):
        assert self.handles or self.resume
        if self.route['provider'] == 'twelvelabs':
            return {'status': 'ready', 'data': '{"option":"B"}'}
        return {'status': 'completed', 'model': self.route['model'],
                'steps': [{'type': 'thought', 'content': [{'type': 'text', 'text': 'Do not score thought.'}]},
                          {'type': 'model_output', 'content': [{'type': 'text', 'text': '{"option":"B"}'}]}]}

    def meter(self, *args, **kwargs):
        return {'actual': None}


class AdapterTest(unittest.TestCase):
    def test_asset_submission_is_fenced_and_saved_before_polling(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            c = Context('twelvelabs')
            c.path = Path(directory) / 'source.mp4'
            c.path.write_bytes(b'development media fixture')
            async def submit(method, suffix, **kwargs):
                c.calls.append((method, suffix, kwargs))
                return Response(201, {}, b'{"id":"asset-fixture"}', 1)
            c.call = submit
            result = asyncio.run(TwelveLabs().prepare(c))
            self.assertTrue(c.calls[0][2]['paid'])
            self.assertEqual(c.handles, [{'assetId': 'asset-fixture'}])
            self.assertEqual(result['assetId'], 'asset-fixture')

    def test_twelve_video_discriminator_and_saved_handle(self):
        c = Context('twelvelabs')
        result = asyncio.run(TwelveLabs().answer(c, {'question': 'Which shape?', 'options': ['square', 'triangle']}, {'assetId': 'fixture-asset'}))
        doc = c.calls[0][2]['document']
        self.assertEqual(doc['video'], {'type': 'asset_id', 'asset_id': 'fixture-asset'})
        self.assertEqual(doc['custom_id'], 'attempt-fixture')
        self.assertEqual(c.handles, [{'taskId': 'remote-fixture'}])
        self.assertEqual(result['answer'], '{"option":"B"}')

    def test_recovered_twelve_task_is_polled_not_resubmitted(self):
        c = Context('twelvelabs')
        c.resume = {'taskId': 'already-submitted'}
        asyncio.run(TwelveLabs().answer(c, {'question': '?', 'options': ['a', 'b']}, {'assetId': 'asset'}))
        self.assertEqual(c.calls, [])

    def test_gemini_background_interaction_persists_before_poll_and_ignores_thought(self):
        c = Context('gemini')
        result = asyncio.run(Gemini().answer(c, {'question': '?', 'options': ['a', 'b']},
                                            {'uri': 'https://generativelanguage.googleapis.com/files/fixture', 'mimeType': 'video/mp4'}))
        self.assertEqual(c.calls[0][1], '/interactions')
        self.assertTrue(c.calls[0][2]['document']['background'])
        self.assertEqual(c.handles, [{'interactionId': 'remote-fixture'}])
        self.assertEqual(result['answer'], '{"option":"B"}')

    def test_recovered_interaction_does_not_create_another_paid_request(self):
        c = Context('gemini')
        c.resume = {'interactionId': 'saved'}
        asyncio.run(Gemini().answer(c, {'question': '?', 'options': ['a', 'b']}, {'uri': 'uri', 'mimeType': 'video/mp4'}))
        self.assertEqual(c.calls, [])

    def test_provider_thought_text_cannot_become_official_answer(self):
        payload = {'steps': [{'type': 'thought', 'content': [{'type': 'text', 'text': '{"option":"A"}'}]}]}
        self.assertEqual(extracted_answer(payload, 'gemini'), '')


if __name__ == '__main__':
    unittest.main()
