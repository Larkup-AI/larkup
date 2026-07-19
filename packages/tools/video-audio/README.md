# Video & Audio

> Index video and audio files with AI-powered transcription and frame analysis.

## What It Does

This tool processes video and audio files for your knowledge base:

- **Video**: Extracts audio for transcription + keyframes for visual scene description
- **Audio**: Transcribes speech to text with timestamped segments
- **YouTube**: Import videos directly from YouTube URLs

## Requirements

- **ffmpeg** must be installed on your system
  - macOS: `brew install ffmpeg`
  - Ubuntu/Debian: `sudo apt install ffmpeg`
  - Windows: Download from [ffmpeg.org](https://ffmpeg.org/download.html)

## How It Works

### Video Pipeline
1. **Extract audio** → WAV (16kHz mono) via ffmpeg
2. **Transcribe audio** → Timestamped text chunks via Whisper API
3. **Extract keyframes** → One frame every N seconds (configurable)
4. **Caption frames** → Vision LLM describes each keyframe
5. **Index** → Combined transcript + scene descriptions become searchable documents

### Audio Pipeline
1. **Transcribe** → Speech-to-text via Whisper API or local Whisper
2. **Chunk** → Split into 30-second segments with timestamps
3. **Index** → Each chunk becomes a searchable document

## Transcription Options

| Method | Pros | Cons |
|--------|------|------|
| **AI Provider API** (default) | Fast, accurate, easy setup | Requires API key, costs per minute |
| **Local Whisper** | Free, offline, private | Slower, requires ~75MB model download |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Frame interval | 10s | Extract one keyframe every N seconds |
| Transcription method | API | Use AI provider API or local Whisper |
