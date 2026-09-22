import * as pdfjsLib from 'pdfjs-dist';

export async function extractImagesFromPDF(
  file: File,
): Promise<{ base64: string; pageNumber: number; index: number }[]> {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const numPages = pdf.numPages;
  const images: { base64: string; pageNumber: number; index: number }[] = [];

  let imageIndex = 0;
  const toDataUrl = (source: HTMLCanvasElement) => {
    const maxDimension = 1_600;
    const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
    if (scale === 1) return source.toDataURL('image/jpeg', 0.86);

    const resized = document.createElement('canvas');
    resized.width = Math.max(1, Math.round(source.width * scale));
    resized.height = Math.max(1, Math.round(source.height * scale));
    resized.getContext('2d')?.drawImage(source, 0, 0, resized.width, resized.height);
    return resized.toDataURL('image/jpeg', 0.86);
  };

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      // A PDF page is a composite visual: diagrams are commonly vector
      // drawings, while their caption, legend, and table may be text or
      // separate XObjects. Indexing XObjects individually loses that context
      // and makes image zero (often a cover) look like the best preview.
      // One crisp rendered page preserves the complete source relationship.
      const baseViewport = page.getViewport({ scale: 1 });
      const desiredLongestEdge = 1_600;
      const scale = Math.min(
        2.5,
        Math.max(1, desiredLongestEdge / Math.max(baseViewport.width, baseViewport.height)),
      );
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await page.render({ canvas, viewport }).promise;
      images.push({ base64: toDataUrl(canvas), pageNumber: i, index: imageIndex++ });
    } catch (err) {
      console.error(`Error processing page ${i}`, err);
    }
  }

  return images;
}
