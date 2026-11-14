"""PC-only subprocess: invoke the canonical transcription service in an isolated environment."""
import json
import os
import sys
from pathlib import Path

request = json.load(sys.stdin)
sys.path.insert(0, request['runtime'])
os.environ.update(DEEPGRAM_API_KEY=request['apiKey'], LARKUP_VIDEO_TRANSCRIPTION_PROVIDER='deepgram',
                  LARKUP_VIDEO_DEEPGRAM_MODEL=request['model'], LARKUP_VIDEO_DEEPGRAM_AUTO_MODEL=request['model'],
                  LARKUP_VIDEO_TRANSCRIPTION_FALLBACK='', LARKUP_VIDEO_TRANSCRIPTION_CONCURRENCY='2',
                  LARKUP_VIDEO_TRANSCRIPTION_CHUNK_SECONDS='300')
from app.services.transcription import TranscriptionService
service = TranscriptionService('cpu')
segments, language = service.transcribe(Path(request['path']), None, [], request['durationSecs'])
print(json.dumps({'transcript': segments, 'detectedLanguage': language, 'diagnostics': service.last_diagnostics}))
