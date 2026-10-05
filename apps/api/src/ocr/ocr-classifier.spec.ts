import { classifyRegions, meanConfidence, regionsOf } from './ocr-classifier';
import type { OcrWord } from './ocr-engine.interface';

const w = (text: string, confidence: number): OcrWord => ({
  text,
  confidence,
  box: { x: 0, y: 0, w: 0.1, h: 0.1 },
});

describe('ocr-classifier', () => {
  it('marca dudoso solo bajo el umbral (el umbral exacto es ok)', () => {
    const r = classifyRegions([w('a', 0.84), w('b', 0.85), w('c', 0.99)], 0.85);
    expect(r.map((x) => x.status)).toEqual(['dudoso', 'ok', 'ok']);
  });

  it('respeta un umbral distinto', () => {
    const r = classifyRegions([w('a', 0.9)], 0.95);
    expect(r[0].status).toBe('dudoso');
  });

  it('usa líneas si existen, si no palabras, y descarta vacíos', () => {
    expect(
      regionsOf({ pageNumber: 1, words: [w('x', 1)], lines: [w('linea', 1)] }),
    ).toHaveLength(1);
    expect(
      regionsOf({ pageNumber: 1, words: [w('x', 1), w('  ', 1)], lines: [] }),
    ).toEqual([w('x', 1)]);
  });

  it('confianza media', () => {
    expect(meanConfidence([])).toBe(0);
    expect(meanConfidence([{ confidence: 0.5 }, { confidence: 1 }])).toBe(0.75);
  });
});
