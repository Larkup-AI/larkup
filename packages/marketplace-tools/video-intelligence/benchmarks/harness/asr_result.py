"""Interpret canonical ASR outcomes without mistaking speech absence for transport failure."""
def transcribe(service, path, duration, empty_error):
    try:
        segments, language = service.transcribe(path, None, [], duration)
    except empty_error:
        diagnostics = service.last_diagnostics
        if diagnostics.get('chunkErrors', 0) or diagnostics.get('completedChunks', 0) != diagnostics.get('chunkCount', 0) or not diagnostics.get('chunkCount'):
            raise
        return {'transcript': [], 'detectedLanguage': None,
                'diagnostics': {**diagnostics, 'providerCalled': True, 'noUsableSpeech': True}}
    return {'transcript': segments, 'detectedLanguage': language, 'diagnostics': service.last_diagnostics}
