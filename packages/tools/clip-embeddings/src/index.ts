/**
 * CLIP Embeddings — Coming Soon
 *
 * This tool will add native CLIP/SigLIP image embedding support to Larkup,
 * enabling direct image-to-image similarity search without text captioning.
 *
 * Planned features:
 * - CLIP and SigLIP model support
 * - Direct image-to-image similarity search
 * - Text-to-image search via shared embedding space
 * - ~200MB model download on first use
 *
 * @see README.md for roadmap details
 */

export function processImage(): never {
  throw new Error(
    'CLIP Embeddings is coming soon. ' +
      'For now, Larkup uses vision LLM captioning for image indexing.',
  );
}
