import contextlib
import io
import json
import os
import runpy
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch


class AudioPreflightTest(unittest.TestCase):
    def test_silent_video_skips_speech_provider_and_preserves_empty_transcript(self):
        request = dict(path='/fixture/silent.mp4', runtime='/fixture/runtime', apiKey='private-fixture',
                       durationSecs=3000, model='nova-3')
        provider = MagicMock(side_effect=AssertionError('A silent source must never call transcription'))
        output = io.StringIO()
        with patch('sys.stdin', io.StringIO(json.dumps(request))), patch('subprocess.run', return_value=SimpleNamespace(stdout='{"streams":[]}')) as probe, patch.dict(sys.modules, {'app.services.transcription': SimpleNamespace(TranscriptionService=provider)}), contextlib.redirect_stdout(output):
            with self.assertRaises(SystemExit) as status:
                runpy.run_path(str(Path(__file__).parents[1] / 'asr_local.py'))
        self.assertEqual(status.exception.code, 0)
        self.assertEqual(json.loads(output.getvalue())['transcript'], [])
        self.assertFalse(json.loads(output.getvalue())['diagnostics']['providerCalled'])
        provider.assert_not_called()
        self.assertIn('ffprobe', probe.call_args.args[0])
        self.assertNotIn('private-fixture', output.getvalue())

    def test_audio_video_still_uses_canonical_transcription(self):
        request = dict(path='/fixture/speech.mp4', runtime='/fixture/runtime', apiKey='private-fixture',
                       durationSecs=8, model='nova-3')
        provider = MagicMock()
        segments = [{'startMs': 0, 'endMs': 2000, 'text': 'Original speech'}]
        provider.return_value.transcribe.return_value = segments, 'en'
        provider.return_value.last_diagnostics = {'provider': 'deepgram'}
        output = io.StringIO()
        with patch('sys.stdin', io.StringIO(json.dumps(request))), patch('subprocess.run', return_value=SimpleNamespace(stdout='{"streams":[{"index":1}]}')), patch.dict(sys.modules, {'app.services.transcription': SimpleNamespace(TranscriptionService=provider)}), patch.dict(os.environ), patch.object(sys, 'path', list(sys.path)), contextlib.redirect_stdout(output):
            runpy.run_path(str(Path(__file__).parents[1] / 'asr_local.py'))
        provider.return_value.transcribe.assert_called_once_with(Path(request['path']), None, [], 8)
        self.assertEqual(json.loads(output.getvalue())['transcript'], segments)


if __name__ == '__main__':
    unittest.main()
