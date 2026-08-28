# CLIP Image Search — Coming Soon

> Direct image-to-image and text-to-image similarity search using CLIP/SigLIP models.

## What This Will Do

Currently, Larkup indexes images by generating text captions via your configured vision LLM (GPT-4o, Claude, Gemini, etc.) and embedding those captions with your text embedding model. This works well for most use cases.

CLIP Embeddings will add a **native visual similarity** layer on top of this:

- **Image → Image search**: Upload a query image, find visually similar images in your corpus
- **Text → Image search**: Describe what you're looking for, get matching images via the shared CLIP embedding space
- **No captioning required**: Images are embedded directly — no LLM calls needed for indexing

## Technical Details

- **Models**: OpenCLIP (ViT-B/32, ViT-L/14) and SigLIP (for better zero-shot performance)
- **Storage**: CLIP vectors stored alongside text vectors in your vector store
- **Size**: ~200MB model download on first use
- **Performance**: Sub-second query time on standard hardware

## Roadmap

1. Basic CLIP embedding support (ViT-B/32)
2. SigLIP model support
3. Hybrid search: combine text similarity + visual similarity
4. Fine-tuning support for domain-specific image search

## Status

🚧 **Coming Soon** — This tool is under development. Watch for updates in the Larkup marketplace.
