import concurrent.futures
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from harness.common import atomic
from harness.provider_relay import Relay


class RelayTest(unittest.TestCase):
    def test_asr_deduplicates_one_source_without_blocking_unrelated_provider_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            package = Path(directory)
            benchmark = package / 'benchmarks'
            atomic(benchmark / 'benchmark.env', 'KEY_ONE=private-speech-fixture\n', raw=True)
            atomic(package / 'runtime/app/services/transcription.py', '# canonical test fixture', raw=True)
            source = dict(id='source', path='sources/video.mp4', sha256='fixture', durationMs=8000)
            atomic(benchmark / 'data/datasets/test.json', {'sources': [source]})
            atomic(benchmark / 'data/sources/video.mp4', 'fixture', raw=True)
            spec = dict(provider='deepgram', model='nova-3', secretAlias='KEY_ONE')
            atomic(benchmark / 'data/configs/active.json', {'variants': {'tool': {'roles': {'audio': spec}}}})
            relay = Relay(benchmark, 'private-capability')
            observed = []

            def speech(*args, **kwargs):
                def other_provider():
                    acquired = relay.lock.acquire(timeout=.2)
                    observed.append(acquired)
                    if acquired:
                        relay.lock.release()
                probe = threading.Thread(target=other_provider)
                probe.start()
                probe.join()
                time.sleep(.02)
                return SimpleNamespace(returncode=0, stdout=json.dumps({'transcript': [], 'detectedLanguage': 'en'}))

            request = dict(sourceId='source', sha256='fixture', audio=spec, attemptId='attempt')
            with patch('harness.provider_relay.subprocess.run', side_effect=speech) as run:
                with concurrent.futures.ThreadPoolExecutor(2) as pool:
                    answers = list(pool.map(relay.asr, [request, request]))
            self.assertEqual(run.call_count, 1)
            self.assertEqual(observed, [True])
            self.assertEqual(sorted(a['reused'] for a in answers), [False, True])
            self.assertNotIn('private-speech-fixture', relay.usage.read_text())




class RuntimeRoleProjectionTest(unittest.TestCase):
    def test_text_brain_keeps_signals_but_never_receives_image_bytes(self):
        from harness.provider_relay import runtime_payload
        original={'model':'host-default','reasoning':{'effort':'minimal'},'messages':[{'role':'user','content':[{'type':'text','text':'OCR at 2s: label. Inspect the indexed visual evidence.'},{'type':'image_url','image_url':{'url':'data:image/jpeg;base64,private-frame'}}]}]}
        spec={'provider':'deepinfra','model':'text-reasoner'}
        projected=runtime_payload(original,spec,['text'])
        self.assertNotIn('image_url',json.dumps(projected));self.assertNotIn('private-frame',json.dumps(projected))
        self.assertIn('OCR at 2s',json.dumps(projected));self.assertIn('text-only',json.dumps(projected))
        self.assertIn('image_url',json.dumps(original))
        self.assertEqual(projected['model'],'text-reasoner')

    def test_google_compatible_payload_does_not_receive_gateway_only_reasoning(self):
        from harness.provider_relay import runtime_payload
        payload={'reasoning':{'effort':'minimal'},'messages':[{'role':'user','content':[{'type':'image_url','image_url':{'url':'data:image/jpeg;base64,frame'}}]}]}
        projected=runtime_payload(payload,{'provider':'gemini_openai','model':'reader'},['text','image'])
        self.assertNotIn('reasoning',projected);self.assertIn('image_url',json.dumps(projected))
        gateway=runtime_payload(payload,{'provider':'vercel_ai_gateway','model':'reader'},['text','image'])
        self.assertEqual(gateway['reasoning'],{'effort':'minimal'})

class RuntimeFundingFallbackTest(unittest.TestCase):
    def test_known_credit_rejection_can_use_only_predeclared_equivalent_backend(self):
        from unittest.mock import Mock
        from harness.common import DomainError
        relay=object.__new__(Relay)
        relay.forward=Mock(side_effect=[DomainError('CREDIT_EXHAUSTED'),'ok'])
        context={'attemptId':'attempt','roles':{'vision':{'provider':'vercel_ai_gateway','model':'reader','secretAlias':'first'}},
                 'roleFallbacks':{'vision':[{'provider':'deepinfra','model':'Reader','secretAlias':'second','verifiedEquivalent':True}]}}
        result=relay.runtime_forward(context,'vision','/chat/completions','POST',b'{"model":"host"}',{'content-type':'application/json'})
        self.assertEqual(result,'ok');self.assertEqual(relay.forward.call_count,2)
        second=relay.forward.call_args
        self.assertEqual(second.args[1],'second');self.assertEqual(json.loads(second.args[3])['model'],'Reader')

    def test_unknown_paid_outcome_is_never_replayed_on_another_backend(self):
        from unittest.mock import Mock
        from harness.common import DomainError
        relay=object.__new__(Relay);relay.forward=Mock(side_effect=DomainError('REMOTE_OUTCOME_UNKNOWN',unknown=True))
        context={'attemptId':'attempt','roles':{'vision':{'provider':'vercel_ai_gateway','model':'reader','secretAlias':'first'}},'roleFallbacks':{'vision':[{'provider':'deepinfra','model':'reader','secretAlias':'second','verifiedEquivalent':True}]}}
        with self.assertRaises(DomainError):relay.runtime_forward(context,'vision','/chat/completions','POST',b'{}',{'content-type':'application/json'})
        self.assertEqual(relay.forward.call_count,1)


if __name__ == '__main__':
    unittest.main()
