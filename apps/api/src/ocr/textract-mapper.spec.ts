import type { Block } from '@aws-sdk/client-textract';
import { mapTextractBlock, mapTextractBlocks } from './textract-mapper';

const block = (over: Partial<Block>): Block => ({
  BlockType: 'LINE',
  Text: 'Total 120.50',
  Confidence: 87.5,
  Geometry: {
    BoundingBox: { Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.05 },
  },
  ...over,
});

describe('textract-mapper', () => {
  it('convierte BoundingBox y Confidence (0..100) a caja y confianza 0..1', () => {
    expect(mapTextractBlock(block({}))).toEqual({
      text: 'Total 120.50',
      confidence: 0.875,
      box: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
    });
  });

  it('recorta cajas que se salen de la página', () => {
    const m = mapTextractBlock(
      block({
        Geometry: {
          BoundingBox: { Left: -0.02, Top: 0.97, Width: 1.1, Height: 0.1 },
        },
      }),
    )!;
    expect(m.box.x).toBe(0);
    expect(m.box.w).toBe(1);
    expect(m.box.y).toBeCloseTo(0.97);
    expect(m.box.h).toBeCloseTo(0.03);
  });

  it('ignora bloques sin texto o sin geometría', () => {
    expect(mapTextractBlock(block({ Text: undefined }))).toBeNull();
    expect(mapTextractBlock(block({ Geometry: undefined }))).toBeNull();
  });

  it('separa LINE y WORD y descarta otros tipos', () => {
    const r = mapTextractBlocks(
      [
        block({ BlockType: 'PAGE' }),
        block({ BlockType: 'LINE', Text: 'a b' }),
        block({ BlockType: 'WORD', Text: 'a', Confidence: 50 }),
        block({ BlockType: 'WORD', Text: 'b', Confidence: 99 }),
        block({ BlockType: 'TABLE' }),
      ],
      3,
    );
    expect(r.pageNumber).toBe(3);
    expect(r.lines).toHaveLength(1);
    expect(r.words.map((w) => w.text)).toEqual(['a', 'b']);
    expect(r.words[0].confidence).toBe(0.5);
  });
});
