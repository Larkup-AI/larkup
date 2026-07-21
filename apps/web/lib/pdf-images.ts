import * as pdfjsLib from 'pdfjs-dist';

export async function extractImagesFromPDF(
  file: File,
): Promise<{ base64: string; pageNumber: number; index: number }[]> {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const numPages = pdf.numPages;
  const images: { base64: string; pageNumber: number; index: number }[] = [];

  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const opList = await page.getOperatorList();

      const imageOps = [];
      for (let j = 0; j < opList.fnArray.length; j++) {
        if (
          opList.fnArray[j] === pdfjsLib.OPS.paintImageXObject ||
          opList.fnArray[j] === pdfjsLib.OPS.paintInlineImageXObject
        ) {
          imageOps.push(opList.argsArray[j][0]);
        }
      }

      let imgIndex = 0;
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
                base64: canvas.toDataURL('image/png'),
                pageNumber: i,
                index: imgIndex++,
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
                base64: canvas.toDataURL('image/png'),
                pageNumber: i,
                index: imgIndex++,
              });
            }
          }
        } catch (err) {
          console.error(`Error extracting image ${objId} on page ${i}`, err);
        }
      }
    } catch (err) {
      console.error(`Error processing page ${i}`, err);
    }
  }

  return images;
}
