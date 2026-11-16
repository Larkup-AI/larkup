import unittest
from pathlib import Path
from harness.asr_result import transcribe

class EmptySpeech(RuntimeError): pass

class Service:
    def __init__(self, errors=0):
        self.last_diagnostics = dict(chunkCount=1, completedChunks=1, chunkErrors=errors)
    def transcribe(self, *args): raise EmptySpeech()

class ASRResultTest(unittest.TestCase):
    def test_confirmed_empty_speech_preserves_visual_only_processing(self):
        result = transcribe(Service(), Path('fixture.mp4'), 60, EmptySpeech)
        self.assertEqual(result['transcript'], [])
        self.assertTrue(result['diagnostics']['providerCalled'])
        self.assertTrue(result['diagnostics']['noUsableSpeech'])
    def test_partial_failed_transcription_remains_an_error(self):
        with self.assertRaises(EmptySpeech): transcribe(Service(errors=1), Path('fixture.mp4'), 60, EmptySpeech)
