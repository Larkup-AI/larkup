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


if __name__ == '__main__':
    unittest.main()
