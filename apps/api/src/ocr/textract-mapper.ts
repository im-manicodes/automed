import type { Block } from '@aws-sdk/client-textract';
import type { OcrBox, OcrPageResult, OcrWord } from './ocr-engine.interface';

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Textract ya entrega BoundingBox normalizado (Left/Top/Width/Height en 0..1 sobre la imagen)
 * y Confidence en 0..100. Se recortan al rango [0,1] y se pasa la confianza a 0..1.
 */
export function mapTextractBlock(block: Block): OcrWord | null {
  const bb = block.Geometry?.BoundingBox;
  if (!bb || !block.Text) return null;
  const x = clamp01(bb.Left ?? 0);
  const y = clamp01(bb.Top ?? 0);
  return {
    text: block.Text,
    confidence: clamp01((block.Confidence ?? 0) / 100),
    box: {
      x,
      y,
      w: Math.min(clamp01(bb.Width ?? 0), 1 - x),
      h: Math.min(clamp01(bb.Height ?? 0), 1 - y),
    } satisfies OcrBox,
  };
}

export function mapTextractBlocks(
  blocks: Block[] | undefined,
  pageNumber: number,
): OcrPageResult {
  const words: OcrWord[] = [];
  const lines: OcrWord[] = [];
  for (const b of blocks ?? []) {
    if (b.BlockType !== 'WORD' && b.BlockType !== 'LINE') continue;
    const m = mapTextractBlock(b);
    if (!m) continue;
    (b.BlockType === 'WORD' ? words : lines).push(m);
  }
  return { pageNumber, words, lines };
}
