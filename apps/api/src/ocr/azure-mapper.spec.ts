import { mapAzurePage } from './azure-mapper';

describe('mapAzurePage', () => {
  it('normaliza polígonos y promedia la confianza de las palabras de cada línea', () => {
    const r = mapAzurePage(
      {
        width: 200,
        height: 100,
        words: [
          {
            content: 'Hola',
            polygon: [20, 10, 60, 10, 60, 30, 20, 30],
            confidence: 0.9,
            span: { offset: 0, length: 4 },
          },
          {
            content: 'mundo',
            polygon: [70, 10, 120, 10, 120, 30, 70, 30],
            confidence: 0.5,
            span: { offset: 5, length: 5 },
          },
        ],
        lines: [
          {
            content: 'Hola mundo',
            polygon: [20, 10, 120, 10, 120, 30, 20, 30],
            spans: [{ offset: 0, length: 10 }],
          },
        ],
      },
      2,
    );
    expect(r.pageNumber).toBe(2);
    expect(r.words[0].box).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
    expect(r.lines?.[0].text).toBe('Hola mundo');
    expect(r.lines?.[0].confidence).toBeCloseTo(0.7);
    expect(r.lines?.[0].box.w).toBeCloseTo(0.5);
  });

  it('página vacía o sin tamaño: sin resultados', () => {
    expect(mapAzurePage(undefined, 1)).toEqual({
      pageNumber: 1,
      words: [],
      lines: [],
    });
    expect(
      mapAzurePage({ words: [{ content: 'x', polygon: [0, 0, 1, 1] }] }, 1)
        .words,
    ).toEqual([]);
  });
});
