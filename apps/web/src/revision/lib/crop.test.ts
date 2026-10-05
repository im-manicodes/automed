import { bboxEnRecorte, cropRect, tamanoSalida } from './crop';

describe('cropRect', () => {
  it('agrega margen y respeta los bordes', () => {
    const r = cropRect({ x: 0.5, y: 0.5, w: 0.1, h: 0.05 }, 1000, 2000, { margenRel: 0.5, margenMinPx: 10 });
    expect(r.sx).toBeCloseTo(450);
    expect(r.sw).toBeCloseTo(200);
    expect(r.sy).toBeCloseTo(1000 - 50);
    expect(r.sh).toBeCloseTo(200);
  });
  it('limita en los bordes de la imagen', () => {
    const r = cropRect({ x: 0, y: 0.95, w: 0.2, h: 0.1 }, 1000, 1000);
    expect(r.sx).toBe(0);
    expect(r.sy + r.sh).toBeLessThanOrEqual(1000);
    expect(r.sw).toBeGreaterThan(0);
  });
  it('caja degenerada da recorte mínimo positivo', () => {
    const r = cropRect({ x: 0.3, y: 0.3, w: 0, h: 0 }, 100, 100, { margenMinPx: 0 });
    expect(r.sw).toBeGreaterThanOrEqual(1);
    expect(r.sh).toBeGreaterThanOrEqual(1);
  });
});

describe('bboxEnRecorte', () => {
  it('ubica la caja dentro del recorte', () => {
    const bbox = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
    const rect = cropRect(bbox, 1000, 1000, { margenRel: 1, margenMinPx: 0 });
    const b = bboxEnRecorte(bbox, 1000, 1000, rect);
    expect(b.x).toBeCloseTo(1 / 3);
    expect(b.w).toBeCloseTo(1 / 3);
  });
});

describe('tamanoSalida', () => {
  it('ajusta al ancho y limita el alto', () => {
    expect(tamanoSalida({ sx: 0, sy: 0, sw: 200, sh: 100 }, 400, 1000)).toEqual({ width: 400, height: 200 });
    expect(tamanoSalida({ sx: 0, sy: 0, sw: 100, sh: 400 }, 400, 200)).toEqual({ width: 50, height: 200 });
  });
});
