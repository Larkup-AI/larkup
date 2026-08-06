/** Provider-neutral OCR contracts. The Web worker injects credentials/adapters. */
export interface OcrBlock {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
  language?: string;
  direction?: 'ltr' | 'rtl' | 'ttb';
}

export interface OcrResult {
  blocks: OcrBlock[];
  provider?: string;
  model?: string;
}

export interface OcrAdapter {
  recognize(input: {
    imagePath: string;
    languages?: string[];
    signal?: AbortSignal;
  }): Promise<OcrResult>;
}

/** Reject malformed provider output before it can become durable evidence. */
export function validateOcrResult(result: OcrResult): OcrResult {
  return {
    ...result,
    blocks: result.blocks.filter(
      (block) =>
        Boolean(block.text?.trim()) &&
        [block.left, block.top, block.width, block.height, block.confidence].every(
          Number.isFinite,
        ) &&
        block.width >= 0 &&
        block.height >= 0 &&
        block.confidence >= 0 &&
        block.confidence <= 1,
    ),
  };
}
