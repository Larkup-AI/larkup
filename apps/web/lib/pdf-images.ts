import * as pdfjsLib from 'pdfjs-dist';

export async function extractImagesFromPDF(
  file: File,
): Promise<{ base64: string; pageNumber: number; index: number }[]> {
  // Keep extraction self-contained. The previous CDN worker could fail behind
  // a firewall or offline, silently leaving PDFs with no indexed visuals.
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
    // Embedded PDF artwork can be several thousand pixels wide. Vision models
    // do not need the raw print-resolution asset and sending it makes PDF
    // ingestion slow and unreliable. Preserve diagrams while bounding input.
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
      const opList = await page.getOperatorList();
      const pageStartCount = images.length;

      const imageOps = [];
      for (let j = 0; j < opList.fnArray.length; j++) {
        if (
          opList.fnArray[j] === pdfjsLib.OPS.paintImageXObject ||
          opList.fnArray[j] === pdfjsLib.OPS.paintInlineImageXObject
        ) {
          imageOps.push(opList.argsArray[j][0]);
        }
      }

      for (const objId of imageOps) {
        try {
          const img = await new Promise<any>((resolve) => {
            try {
              page.objs.get(objId, (result: any) => resolve(result));
            } catch (e) {
              resolve(null);
            }
          });
          if (img && img.bitmap) {
            const canvas = document.createElement('canvas');
            canvas.width = img.bitmap.width || img.width;
            canvas.height = img.bitmap.height || img.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(img.bitmap, 0, 0);
              images.push({
                base64: toDataUrl(canvas),
                pageNumber: i,
                index: imageIndex++,
              });
            }
          } else if (img && img.data && img.width && img.height) {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              const imageData = new ImageData(
                new Uint8ClampedArray(img.data),
                img.width,
                img.height,
              );
              ctx.putImageData(imageData, 0, 0);
              images.push({
                base64: toDataUrl(canvas),
                pageNumber: i,
                index: imageIndex++,
              });
            }
          }
        } catch (err) {
          console.error(`Error extracting image ${objId} on page ${i}`, err);
        }
      }

      // Diagrams and slides in PDFs are commonly vector artwork, not embedded
      // bitmap objects. When image indexing is explicitly enabled, render such
      // a page as one bounded visual so its labels and structure remain
      // available to the vision model and to chat previews.
      if (images.length === pageStartCount) {
        try {
          const viewport = page.getViewport({ scale: 1 });
          const maxDimension = 1_600;
          const scale = Math.min(1, maxDimension / Math.max(viewport.width, viewport.height));
          const renderedViewport = page.getViewport({ scale: Math.max(scale, 0.1) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(renderedViewport.width));
          canvas.height = Math.max(1, Math.round(renderedViewport.height));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            await page.render({ canvas, viewport: renderedViewport }).promise;
            images.push({ base64: toDataUrl(canvas), pageNumber: i, index: imageIndex++ });
          }
        } catch (err) {
          console.error(`Error rendering PDF page ${i} for visual indexing`, err);
        }
      }
    } catch (err) {
      console.error(`Error processing page ${i}`, err);
    }
  }

  return images;
}
