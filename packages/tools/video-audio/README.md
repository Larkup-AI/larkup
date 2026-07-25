# Video & Audio

> Index video and audio files with AI-powered transcription and frame analysis.

## What It Does

This tool processes video and audio files for your knowledge base:

- **Video**: Combines multilingual transcription, adaptive visual sampling, OCR, and timestamped evidence
- **Audio**: Transcribes speech to text with timestamped segments
- **YouTube**: Import videos directly from YouTube URLs

## Requirements

- **ffmpeg** must be installed on your system
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html)
- **yt-dlp is only required for YouTube URLs** (local files and direct URLs do not require it)

## How It Works

### Video Pipeline

1. **Extract audio** → WAV (16kHz mono) via ffmpeg
2. **Transcribe audio** → Timestamped text via the selected audio provider
3. **Extract frames** → Duration-aware anchors, scene changes, and a frame-budget-reserved dense ending pass
4. **Analyze sequences** → A vision LLM connects actions, OCR, state changes, and results
5. **Index** → A whole-media summary and independent timestamped evidence become searchable

### Audio Pipeline

1. **Transcribe** → Speech-to-text via OpenAI, Groq, Deepgram, ElevenLabs, or local Whisper; large API inputs are split into ≤10-minute uploads
2. **Chunk** → Split into 30-second segments with timestamps
3. **Index** → A complete-recording summary plus timestamped evidence becomes searchable

## Transcription Options

| Method                 | Pros                       | Cons                                               |
| ---------------------- | -------------------------- | -------------------------------------------------- |
| **Audio Provider API** | Fast, accurate, easy setup | Requires that provider's API key, costs per minute |
| **Local Whisper**      | Free, offline, private     | Slower, requires ~75MB model download              |

The Audio Provider is required and independent from the chat/vision and embedding providers; the
tool never silently falls back to OpenAI. With Deepgram, `auto` uses known source language, infers
Arabic from an Arabic media title, and otherwise enables provider language detection; set an
explicit code such as `ar`, `ar-EG`, `en`, or `de` when needed.

## Configuration

| Setting        | Default | Description                                                                      |
| -------------- | ------- | -------------------------------------------------------------------------------- |
| Frame interval | 10s     | Baseline cadence; adaptive scene and reserved ending frames are added separately |
| Audio provider | None    | OpenAI, Groq, Deepgram, ElevenLabs, or Local Whisper                             |
| Audio language | `auto`  | Infer Arabic from the title, detect supported languages, or use an explicit code |
